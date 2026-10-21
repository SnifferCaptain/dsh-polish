import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/**
 * 计时器（组件 D）：给模型两个工具——
 *   timer_set(分钟, 循环次数?, 到点文本?)  起一个内存倒计时；
 *   timer_cancel(id)                       取消一个计时器。
 * 到点时把「到点文本」作为一条**用户消息**注入该会话（`agent.followup`），
 * 触发一轮模型处理——相当于一个定时的自我提醒。
 *
 * **非持久（v1）**：计时器只存 host 进程内存，随本行（`dsh-polish:timer`）的
 * Loader 行开/关而生灭——行开注册工具 + 起计时，行关 fiber 收起、工具与计时器
 * 全部清理；DSH 重启即清空（不做 durable 存储）。
 *
 * —— 0.4.49：默认停用（官方功能已覆盖）——
 *   DSH 已内建官方「自动化任务」（dsh-schedule + dsh-tool-schedule +
 *   dsh-client-ui-schedule）：schedule_create / schedule_list /
 *   schedule_update / schedule_delete 工具 + 侧栏「自动化任务」页面
 *   （搜索 / 筛选 / 改名改指令改运行时间 / 任务运行记录 / 删除 / 打开原会话），
 *   支持 after / at / every / daily / weekly / cron 六种规则，跨宿主重启
 *   持久，重启后补发最近一次未运行投递；投递回原会话走的正是与本组件
 *   相同的 resolveAgent → followup → flush 路径；有活动任务的会话行首时钟
 *   标记与本组件时钟图标同占 `sidebar.session.row.leading` 槽位（悬停列出任务）。
 *   官方功能完整覆盖并严格强于本组件（持久 / 墙钟时间 / 补发 / 页面 / 历史），
 *   故 bundle 的 cordis.patch.yml 里本行默认 `disabled: true`，设置页有替代
 *   说明。代码原样保留：想恢复旧行为（内存倒计时、重启即清），打开本行行开关
 *   即可，行为与 0.4.48 及以前完全一致。
 *
 * 组件总开关 = 本行的 Loader 行开关（served/off）：行开 → `apply` 运行、注册
 * 工具；行关 → fiber 收起、工具 + 计时器全清。`enabled` 是该开关在设置页的
 * 镜像，在行激活时读取（host 半对设置变化不重跑，所以行开关才是最可靠的总开关）。
 *
 * —— 极简模式（minimal 预设）排除（v0.4.20）——
 *   「极简模式」= DSH 内建 agent 预设 `minimal`，定义就是「Agent 仅使用终端工具」。
 *   工具是**按作用域可见**的：一个作用域的工具 = 全局层 + 该作用域链路（dsh-scope）。
 *   本行若像以前那样**全局注册**，timer 会顺着作用域链路**继承进每一个预设**
 *   （包括 minimal）——所以极简模式会看到 timer，违背它「只用终端工具」的定义。
 *   因此这里改成**按 agent 注册**：监听 `agent/created`（含本行加载前已存在的
 *   `ctx.agents.list()`），用 `agentPresets.composedPreset(agent.ctx)` 读该 agent
 *   当前绑定的预设 id——**只有非 minimal 的 agent** 才 `agent.ctx.tools.register`
 *   注册两个工具；minimal 的 agent 不注册 → 工具列表里彻底没有 timer。
 *   会话中途换预设（`agent-preset/selected`）与 agent 卸载（`agent/disposed`）时
 *   相应重算/清理。工具 `execute` 仍靠执行上下文 `exec.agent.session.id` 定位会话，
 *   所以按 agent 注册后 session 感知不变。
 *
 * —— 其余写法对齐同在本 profile 里、确认能注册模型工具的 bundle（dsh-browser）：
 *   import { defineTool } from '@deepseek-ai/dsh-tools'   // bundle 走 app 的 node_modules，可导入
 *   export const inject = ['tools', ...]                   // 声明注入 tools，ctx.tools 才可用
 *   agent.ctx.tools.register(defineTool({ name, description, parameters,
 *                                         output: { schema, render }, execute }))  // output 必填
 * 到点注入对齐 @deepseek-ai/dsh-schedule：
 *   sessionController.resolveAgent(sessionId)
 *     -> agent.followup(createUserMessage({ content, source }))
 *     -> sessions.flush(agent.session)
 */
export const Config = z.object({
  /** 计时器总开关（镜像本行 Loader 行开关，在行激活时读取）。 */
  enabled: z.boolean().default(true).volatile(),
  /**
   * 运行时通道（volatile，不落盘）：当前有活动倒计时的会话 id 列表。
   * host 半在 set/cancel/到点时写入；client 半读取以在会话行首画时钟图标。
   * volatile＝只存内存、重启即清，和计时器本身「非持久」一致。
   * 不出现在设置表单里（表单只渲染 TIMER_FIELDS 的字段）。
   */
  activeTimerSessionIds: z.array(z.string()).default([]).volatile(),
  /**
   * 运行时通道（volatile，不落盘）：sessionId -> 该会话「下一个」计时器触发的
   * 本地时间戳（毫秒）。与 activeTimerSessionIds 同源、同一次 update 写出。
   * client 半在悬停会话行首时钟图标时用它算「还剩多久」+「几点钟触发」。
   * 一个会话有多个计时器时取最早触发的那个。不出现在设置表单里。
   */
  activeTimerFireAt: z.dict(z.number()).default({}).volatile(),
})

// 本行要用的服务：
//   settings        （隐藏自动设置页 + 活动会话通道）
//   tools           （声明注入；按 agent 注册走 agent.ctx.tools，这里保留以兼容）
//   timer           （ctx.interval 计时）
//   sessionController（到点解析会话 agent）
//   sessions        （落盘）
//   agents          （枚举/查活着的 agent：list() / get(id)）
//   agentPresets    （读某 agent 当前预设 id：composedPreset(agent.ctx)）
export const inject = ['settings', 'tools', 'timer', 'sessionController', 'sessions', 'agents', 'agentPresets']

export function apply(ctx, config) {
  var enabled = !config || config.enabled !== false

  // 隐藏自动设置页；本行详情页由 bundle 的浏览器半注册（TimerPage）。
  ctx.effect(function () {
    ctx.settings.configure({ auto: false }, ctx.fiber)
  })

  if (!enabled) return

  // 内存态：id -> { dispose, sessionId }（行关/重启即清空）。
  var timers = new Map()
  // sessionId -> 该会话当前活动计时器个数（>0 即需要在行首画时钟图标）。
  var sessionCounts = new Map()

  // 把「有活动计时器的会话 id」写进 volatile 设置；client 半据此画图标。
  // 只在 set/cancel/最后一个到点时写，不在每个 tick 写，避免频繁同步。
  function syncActiveSessions() {
    var ids = []
    // 每个会话「最早触发」的时间戳（多计时器取 min），从活着的 timers 里算，
    // 保证和 ids 同源、同一次 update 写出；client 悬停时钟图标时直接用它。
    var earliest = {}
    timers.forEach(function (t) {
      if (!t || !t.sessionId || typeof t.fireAt !== 'number') return
      var cur = earliest[t.sessionId]
      if (cur === undefined || t.fireAt < cur) earliest[t.sessionId] = t.fireAt
    })
    var fireAtMap = {}
    sessionCounts.forEach(function (count, sessionId) {
      if (count > 0) {
        ids.push(sessionId)
        if (typeof earliest[sessionId] === 'number') fireAtMap[sessionId] = earliest[sessionId]
      }
    })
    ctx.settings
      .update('dsh-polish:timer', { activeTimerSessionIds: ids, activeTimerFireAt: fireAtMap })
      .catch(function (error) {
        console.warn('[dshp timer] 同步活动会话失败：' + (error && error.message ? error.message : String(error)))
      })
  }
  function noteSessionAdd(sessionId) {
    sessionCounts.set(sessionId, (sessionCounts.get(sessionId) || 0) + 1)
    syncActiveSessions()
  }
  function noteSessionRemove(sessionId) {
    var count = (sessionCounts.get(sessionId) || 0) - 1
    if (count <= 0) sessionCounts.delete(sessionId)
    else sessionCounts.set(sessionId, count)
    syncActiveSessions()
  }

  function uid(prefix) {
    return prefix + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  }

  // 到点：解析该会话的 agent → 把文本作为用户消息 followup 进去 → flush 落盘。
  // （会话若已关闭，resolveAgent 返回 { error }，静默跳过。）
  function fire(sessionId, text) {
    ctx.sessionController
      .resolveAgent(sessionId)
      .then(function (resolved) {
        if (!resolved || (typeof resolved === 'object' && 'error' in resolved)) {
          console.warn('[dshp timer] 到点但解析不到该会话的 agent（会话可能已关闭），跳过')
          return
        }
        resolved.agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: text }],
            source: { kind: 'dsh-polish-timer' },
          }),
        )
        return ctx.sessions.flush(resolved.agent.session)
      })
      .catch(function (error) {
        console.warn('[dshp timer] 注入失败：' + (error && error.message ? error.message : String(error)))
      })
  }

  // 卸载（行关/HMR）时兜底清理所有未触发的计时器（ctx.interval 的 effect 也会随
  // 本行收起，这里是双保险）。
  ctx.effect(
    function () {
      return function () {
        timers.forEach(function (t) {
          t.dispose()
        })
        timers.clear()
        sessionCounts.clear()
        // 行关/收起：清空「活动会话」通道（best-effort）。client 端在行未服务
        // 时读不到该字段，所以即使这里没写成，图标也不会残留。
        try {
          ctx.settings
            .update('dsh-polish:timer', { activeTimerSessionIds: [], activeTimerFireAt: {} })
            .catch(function () {})
        } catch (error) {}
      }
    },
    'dsh-polish: timer cleanup',
  )

  // 工具定义（共享上述内存态），只定义一次，随后**按 agent 注册**（见下）。
  // 注意：不再是全局 `ctx.tools.register`——那样会继承进 minimal 预设。
  var timerSetTool = defineTool({
    name: 'timer_set',
    description:
      '创建一个倒计时计时器。到点时会把 message 作为一条「用户消息」注入当前会话、' +
      '触发一轮模型处理（相当于一个定时的自我提醒）。适合「N 分钟后提醒我做 X」这类需求。',
    parameters: {
      minutes: { type: 'number', required: true, description: '倒计时时长，单位分钟，>0 的数字（可为小数，如 0.5）。' },
      repeats: { type: 'number', description: '循环次数，缺省 1（单次）；每次间隔 minutes 分钟。' },
      message: { type: 'string', description: '到点发送的文本；强烈建议自己写清楚要提醒的内容，别留空用缺省。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          minutes: { type: 'number' },
          repeats: { type: 'number' },
          message: { type: 'string' },
          nextFireAt: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: function (_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    execute: function (args, exec) {
      var agent = exec && exec.agent
      if (!agent || !agent.session) return { ok: false, error: '无法确定当前会话' }
      var sessionId = agent.session.id
      var minutes = Number(args.minutes)
      if (!isFinite(minutes) || minutes <= 0) return { ok: false, error: 'minutes 必须是 >0 的数字' }
      var repeats = args.repeats === undefined ? 1 : Math.max(1, Math.floor(Number(args.repeats)))
      var text = typeof args.message === 'string' && args.message.trim() !== '' ? args.message : '计时 ' + minutes + ' 分钟结束'
      var id = uid('timer-')
      var delayMs = Math.max(1, Math.round(minutes * 60000))
      var fired = 0
      var dispose = ctx.interval(
        function () {
          fired += 1
          fire(sessionId, text)
          if (fired >= repeats) {
            dispose()
            timers.delete(id)
            noteSessionRemove(sessionId)
          } else {
            // 循环计时：刷新「下一次触发」时间戳，client 端悬停显示随之更新。
            var t = timers.get(id)
            if (t) {
              t.fireAt = Date.now() + delayMs
              syncActiveSessions()
            }
          }
        },
        delayMs,
      )
      timers.set(id, { dispose: dispose, sessionId: sessionId, fireAt: Date.now() + delayMs, delayMs: delayMs })
      noteSessionAdd(sessionId)
      return {
        ok: true,
        id: id,
        minutes: minutes,
        repeats: repeats,
        message: text,
        nextFireAt: new Date(Date.now() + delayMs).toISOString(),
      }
    },
  })

  var timerCancelTool = defineTool({
    name: 'timer_cancel',
    description: '取消一个之前用 timer_set 创建的计时器（传它的 id）。',
    parameters: {
      id: { type: 'string', required: true, description: 'timer_set 返回的 id。' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          id: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: function (_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    execute: function (args) {
      var t = timers.get(args.id)
      if (!t) return { ok: false, error: '找不到计时器 id：' + args.id }
      t.dispose()
      timers.delete(args.id)
      if (t.sessionId) noteSessionRemove(t.sessionId)
      return { ok: true, id: args.id }
    },
  })

  // —— 按 agent 注册：极简（minimal 预设）不注册，其余照常 ——
  // registeredByAgent: agentId -> [disposer(timer_set), disposer(timer_cancel)]。
  // 注册是 agent.ctx 作用域里的 effect：agent 卸载时作用域收起、工具自动随之卸载，
  // 这里再持有 disposer 是为了「会话中途从 non-minimal 切到 minimal」时能即时摘除。
  var registeredByAgent = new Map()

  function registerForAgent(agent) {
    if (!agent || !agent.id || !agent.ctx) return
    if (registeredByAgent.has(agent.id)) return
    try {
      var dSet = agent.ctx.tools.register(timerSetTool)
      var dCancel = agent.ctx.tools.register(timerCancelTool)
      registeredByAgent.set(agent.id, [dSet, dCancel])
    } catch (error) {
      console.warn('[dshp timer] 按 agent 注册工具失败：' + (error && error.message ? error.message : String(error)))
    }
  }
  function unregisterForAgent(agent) {
    if (!agent || !agent.id) return
    var ds = registeredByAgent.get(agent.id)
    if (!ds) return
    registeredByAgent.delete(agent.id)
    ds.forEach(function (d) {
      try {
        if (typeof d === 'function') d()
      } catch (error) {}
    })
  }
  // 读该 agent 当前绑定的预设 id；非 minimal → 注册，minimal → 摘除。
  // composedPreset 读取失败时**按 non-minimal 处理**（宁可给 timer，也不误伤普通会话）。
  function syncAgentTimer(agent) {
    if (!agent) return
    var presetId
    try {
      presetId = ctx.agentPresets.composedPreset(agent.ctx)
    } catch (error) {
      presetId = void 0
    }
    if (presetId === 'minimal') unregisterForAgent(agent)
    else registerForAgent(agent)
  }

  // 本行加载前已存在的 agent（恢复的会话等）：先枚举一遍。
  try {
    ctx.agents.list().forEach(function (agent) {
      syncAgentTimer(agent)
    })
  } catch (error) {
    console.warn('[dshp timer] 枚举现有 agent 失败：' + (error && error.message ? error.message : String(error)))
  }

  // 新建 agent：按预设决定是否注册。
  ctx.on('agent/created', function (payload) {
    var agent = payload && payload.agent
    if (agent) syncAgentTimer(agent)
  })
  // agent 卸载：清 bookkeeping（工具随 agent 作用域自动卸载；这里删记录，防泄漏）。
  ctx.on('agent/disposed', function (payload) {
    var agent = payload && payload.agent
    if (agent) unregisterForAgent(agent)
  })
  // 会话中途换预设（best-effort）：重算该会话 agent 的工具。
  ctx.on('agent-preset/selected', function (sessionId) {
    try {
      var agent = ctx.agents.get(sessionId)
      if (agent) syncAgentTimer(agent)
    } catch (error) {}
  })
}
