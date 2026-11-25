/**
 * compact-model（组件 N）：压缩摘要用「模型选择器当前选中的模型」。
 *
 * 为什么内建不够：dsh-compaction-basic 的摘要调用按
 *   ① 本行 summarizationProvider/Model 静态配置
 *   ② 会话最近一次真实请求的路线（requestHeader().config）
 *   ③ agent options
 * 的优先级选模型。模型选择器的完整选择在下一次 prompt-assembly 边界生效；
 * 正在运行的 step 保留它已装配的模型与 effort。
 *
 * 本组件监听 `llm/stream` 瀑布（DSH 的流式调用路由扩展点），只处理带
 * `options.purpose === 'compaction'` 的摘要调用。没有打开中的 step 时，摘要
 * 跟随会话选择器的 pending ?? lastUsed；如果 step 仍打开（尤其是上下文溢出
 * 恢复），则保留 compaction-basic 根据当前 request/header 选出的路线，不让
 * step 运行期间刚提交的模型选择抢先生效。step 关闭后，pending 选择才用于
 * 后续压缩/请求。
 *
 * 重路由时就地改写 options.provider / options.model，并同步对齐
 * reasoningEffort（目标带 effort → 覆盖；未带 → 删除旧值，避免旧模型 effort
 * 在新模型上触发 UNSUPPORTED_REASONING_EFFORT）。随后原样 next() 放行。
 *
 * 1.0.10（2026-10-24）线上取证与架构变更：
 * 1.0.9 用 ctx.sessions.get(id) + sessionProjections.stateOf(session,
 * 'modelSelection') 读选择并取 state.lastUsed。两个线上事实使该路径是死的：
 *   a. 线上 ctx.sessions 服务（dsh-api-session-controller client 版）没有
 *      .get() 方法（API 是 retain()/using()），typeof 守卫恒为 null；
 *   b. stateOf 需要 Session 对象为键，投影注册表不提供 id 查找；且
 *      lastUsed = 最后一次请求头，恰是用户刚切走的「老模型」——新选择
 *      在 pending 槽里，lastUsed 读不到。
 * 于是 1.0.9 的线上行为实际退化为 ③ 全局默认回退（10-24 09:52 压缩实证：
 * 该会话最后请求头是 a100/qwen，摘要却是 commandcode/flash == 当时全局
 * 默认，且恰好等于选择器刚选的值）。
 * 1.0.10 改为多源实时缓存：
 *   ① sessionProjections.onChanged 变更馈送（注册表在本 fiber 可见时）：
 *      modelSelection 视图每次变化都以 (session, key, value, seq) 回调，
 *      value.next = pending ?? lastUsed——选择器切换当下即入缓存；
 *   ② agent/request 瀑布镜像（keep-effort 已证明可达的路径）：每个会话
 *      最近一次真实请求实际解析出的路线；
 *   ③ 全局默认（保留）。
 * 另订阅 session/event 作探针（本 fiber 可见则同时喂数据：model/selection
 * = 切换当下、request/header = 请求实际路线）；每次压缩 pass 都把完整决策
 * 链 + 服务可见性探针写入 <dshHome>/compact-model-diag.json——线上行为
 * 异常时直接读文件核对，不用再猜。
 *
 * 1.0.11（2026-10-29）线上取证与架构再变更（「切换模型后 compact 有概率直接失败」）：
 * 1.3.1 安装后的 compact-model-diag.json 给出决定性证据：
 *   visibility: sessions=false, projections=false；eventCounts.onChange=0；
 *   全部压缩 pass 的决策链里 sel 缓存恒空，目标一律退化到 ②last-route / ③default。
 * 即 1.0.10 的主源（投影 onChange 馈送）在本宿主 fiber 里根本不可见，
 * 压缩目标永远等于「最近一次真实请求的路线」= modelSelection.lastUsed——
 * 恰好是用户刚切走的老模型（选择器切换只写 pending，lastUsed 要等下一次
 * 真实请求才提交）。老模型若已死（切模型的典型动机）→ compact 直接失败；
 * 而直接发消息读的是选择器实时值（pending ?? lastUsed）→ 正常。用户反馈
 * 的「有概率」= 老模型是否仍可用 / 切换后是否先发过一条消息。
 * 对照 session-slim（用户指出它从不遇到该问题）：它每次调用**拉取**
 * ctx.sessions.list.getSnapshot().byId[id].projectionValues（view 形状
 * {lastUsed, next}，next = pending ?? lastUsed = 「下一次请求要用的模型」），
 * 且调用前用 llm.resolveCallConfig 校验路线。1.0.11 照此改造：
 *   ①' 热会话：快照 byId 拉取（只读零 I/O）——与正常消息同源，切换当下即生效；
 *   ①'' 冷会话（不在快照）：投影缓存文件 <dshHome>/storages/session_projcache/
 *       sessions/<id>.json（state 形状 {lastUsed, pending}；pending 跨重启持久，
 *       即「DSH 重启前最后一次切换的意图」）；
 *   ① 推送缓存（保留，降级为快照不可用时的来源）；② ③ 不变。
 *   inject 增加 sessions（session-slim 行在本宿主以同样 inject 稳定激活，
 *   可用性已实证）。
 *
 * 1.0.12（同日，紧急回滚一次自伤）：1.0.11 把 llm/stream 监听器改成了
 * async function 去做 await resolveCallConfig 校验——这是致命的：cordis
 * waterfall 直接返回监听器返回值（不 await），llm 调用方用 yield* 消费，
 * Promise 不是 async iterable → 所有模型回合炸「yield* (intermediate value)
 * is not async iterable」。1.0.12 监听器恢复同步（这是硬约束，注释里已写明），
 * 校验逻辑整体移除：压缩目标路线是否可用交给真正的调用去暴露，与正常消息
 * 的失败方式完全一致——本组件不再做任何异步前置判断。
 *
 * 1.0.13：修正 1.0.11 的取数点。线上诊断显示本宿主（DSH 0.2.1-rc.1）的
 * ctx.sessions 是 SessionStore（get(id) → Session，list 是方法），根本没有
 * 客户端那种 list.getSnapshot()/projectionValues 快照存储；照抄 session-slim
 * 的客户端取数路径在本宿主恒为 undefined。改为直接读**会话日志**：
 * 倒序找最近一条 model/selection（= pending）与 request/header（= lastUsed），
 * 并在没有打开中 step 时按 pending ?? lastUsed 解析；冷会话仍读投影缓存文件。
 * 热源 via 标记为 'session-log'。
 *
 * 1.0.14：修正运行中 step 的切换时机。官方模型选择只在下一次 prompt-assembly
 * 边界生效，打开中的 step 必须保留它已装配的路线；context-overflow 恢复仍在
 * 当前 step 内，因此跳过 selector 改道，保留 compaction-basic 的当前路线。
 * step 闭合后的手动压缩或下一步压力压缩仍使用 pending 选择。
 *
 * 1.0.15（2026-11-02，线上死锁取证）：上下文一旦超过目标模型声明窗口，官方
 * 压缩与下一条请求互为死锁——摘要请求要重放整个待压缩区间，它自己就超窗，
 * 于是每次压缩都失败、每次请求都溢出。本组件在 purpose='compaction' 的流上
 * 按预算切片、滚动折叠（详见文件内「1.0.15」注释块），并把「provider 已返回
 * stop + 正文、仅用量超过声明窗口」的 silent-overflow 误判按成功放行；无正文
 * 的真溢出仍原样报错。诊断文件新增 chunked / accept-silent-overflow 记录。
 *
 * 1.0.16（2026-11-02，线上两个问题）：
 *  a. 「Cannot read properties of undefined (reading 'replayState')」——分片续写在
 *     消息序列里插入了一条合成的 assistant 消息（携带上一段摘要），但没有
 *     `source`。LlmRuntime.forAdapter 对每条 assistant 消息读
 *     `message.source.replayState`，于是第二片一开始就 TypeError，整个压缩失败。
 *     合成消息现在带上 `source: { kind:'model', provider, model }`（与真实
 *     assistant 消息同形，replayState 缺省 → 适配器按纯文本处理）。
 *  b. 两个功能各自独立开关（此前只有一个总开关，关掉「分片」就把「跟随选择器」
 *     一起关了）：`followSelection`（压缩跟随选择器当前模型）与
 *     `chunkedCompaction`（超窗分片滚动 + silent-overflow 放行）分别读写，
 *     两者都关时监听器只剩透传，行为与未安装本组件一致。
 *
 * 只动压缩调用：purpose !== 'compaction' 的正常模型回合绝不触碰，会话仍用
 * 它自己选择的模型。
 * Fail-safe：options 被冻结、服务缺失、任何读取异常 → 原样放行 + warn 一次。
 * 本组件绝不让压缩调用因为自己而失败。
 *
 * 覆盖全部三个压缩入口（/compact 手动、压力自动、上下文溢出恢复——它们收敛
 * 到同一个 summarizeWithLlm → ctx.llm.stream）。
 *
 * 总开关 = 本行 Loader 行开关（行开 → apply 运行、监听注册；行关 → 监听随
 * 行卸载自动移除，恢复 DSH 原生压缩行为）。压力保护另有默认关闭的配置开关
 * 只读状态路由 GET /api/dshp/compact-model/status
 * 返回全局默认选择 + 可见性探针 + 事件计数 + 最近 20 条改道记录（验证/排障）。
 */

import z from '@deepseek-ai/schemastery'
import { writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyPressureGuard } from './pressure-guard.js'

export const inject = ['agentDefaultModel', 'settings', 'connection', 'sessions']

export const Config = z.object({
  /**
   * 功能一：压缩摘要跟随模型选择器的当前选择（本组件最初的职责）。
   * 关掉它，压缩回到官方路线（最近一次请求头里的模型 / 静态配置）。
   */
  followSelection: z.boolean().default(true),
  /**
   * 功能二：摘要请求本身超窗时的分片滚动压缩 + silent-overflow 放行。
   * 关掉它，压缩回到官方「一次性重放整个待压缩区间」。
   */
  chunkedCompaction: z.boolean().default(false),
  /**
   * 功能二（独立开关）：上下文逼近/超过窗口时先压缩，压不下去再剪枝兜底；仍超限只记 error
   * 日志并放行本步，从不拒绝（1.4.35 起没有任何 reject 路径：reject 会吞掉已取走
   * 的用户消息，会话看起来死了）。默认关（1.4.26 起）；需要时在压缩行里显式打开。
   */
  pressureGuardEnabled: z.boolean().default(false),
  /**
   * 功能三（1.0.17）：自动压缩失败后自动重试。
   * 只作用于「自动」压缩——turn 打开期间发生的压力压缩与上下文溢出恢复；
   * 空闲会话的手动 /compact 不重试（失败了用户自己看得见，能手动再来一次）。
   */
  autoRetry: z.boolean().default(false),
  /** 自动重试的额外次数（不含首次），0 = 关闭重试。 */
  autoRetryAttempts: z.number().step(1).min(0).max(4).default(2),
  /** 首次重试前的等待毫秒数，之后按次数线性放大。 */
  autoRetryDelayMs: z.number().step(100).min(0).max(20000).default(1200),
})

var STATUS_PATH = '/api/dshp/compact-model/status'
var MAX_REROUTES = 20
var MAX_PASSES = 20
// 选择事件倒序扫描上限；step 生命周期只需扫描到最近的 step/turn 边界。
var LOG_SCAN_LIMIT = 4000
var VERSION = '1.0.17'
var DIAG_NAME = 'compact-model-diag.json'

export function apply(ctx, config = {}) {
  if (config.pressureGuardEnabled === true) applyPressureGuard(ctx, { enabled: true })

  var reroutes = []
  var warned = {}
  var passes = []
  var appliedAt = Date.now()

  // ── 服务可见性探针（写进诊断文件 + 状态路由，回答「线上为什么是 null」）──
  var sessions = null
  var projections = null
  try { sessions = ctx.sessions } catch (error) {}
  try { projections = ctx.sessionProjections } catch (error) {}
  var visibility = {
    sessions: !!sessions,
    sessionsGet: sessions ? typeof sessions.get : undefined,
    sessionsRetain: sessions ? typeof sessions.retain : undefined,
    sessionsUsing: sessions ? typeof sessions.using : undefined,
    sessionsListType: sessions && sessions.list ? typeof sessions.list : undefined,
    projections: !!projections,
    projectionsStateOf: projections ? typeof projections.stateOf : undefined,
    projectionsOnChanged: projections ? typeof projections.onChanged : undefined,
    agentDefaultModel: !!ctx.agentDefaultModel,
  }
  var eventCounts = { onChange: 0, sessionEvent: 0, agentRequest: 0 }

  // ── ① 实时选择器缓存：sessionId -> 选择（含 effort，缺失为 undefined）──
  var selCache = new Map()
  // ── ② 最近真实请求路线镜像：sessionId -> 路线（含 effort）──
  var routeCache = new Map()
  // ── ③ turn 开合状态：区分「自动压缩」与「手动压缩」的唯一依据。
  //    自动压缩（压力压缩 / 溢出恢复）永远发生在打开的 turn 内；手动 /compact
  //    在空闲会话的 maintenance 里跑，没有打开的 turn。
  var turnOpen = new Map()

  // 容忍三种值形状：view {lastUsed,next} / state {lastUsed,pending} / {val:...} 包装。
  // view.next 与 state.pending 都可能为 null（新会话未选过）→ 返回 null。
  function pickSelection(v) {
    if (!v || typeof v !== 'object') return null
    if ('val' in v) return pickSelection(v.val)
    var cand = v.next !== undefined ? v.next : v.pending
    if (!cand || typeof cand !== 'object') return null
    if (typeof cand.provider !== 'string' || cand.provider.length === 0) return null
    if (typeof cand.model !== 'string' || cand.model.length === 0) return null
    return {
      provider: cand.provider,
      model: cand.model,
      reasoningEffort: typeof cand.reasoningEffort === 'string' && cand.reasoningEffort ? cand.reasoningEffort : undefined,
    }
  }

  function cacheSelection(sessionId, sel, tag) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || !sel) return
    selCache.set(sessionId, {
      provider: sel.provider,
      model: sel.model,
      reasoningEffort: sel.reasoningEffort,
      at: Date.now(),
      tag: tag,
    })
  }

  // ①-a modelSelection 变更馈送（注册表在本 fiber 可见时）。注册表把订阅
  // effect 挂在它自己的 ctx 上，所以这里要自己持一个 effect 负责行卸载时
  // 调 disposer。
  var feedDisposer = null
  try {
    if (projections && typeof projections.onChanged === 'function') {
      feedDisposer = projections.onChanged(function (session, key, value) {
        eventCounts.onChange++
        try {
          if (key !== 'modelSelection' || !session || typeof session.id !== 'string') return
          var sel = pickSelection(value)
          if (sel) cacheSelection(session.id, sel, 'onChange')
        } catch (error) {}
      })
    }
  } catch (error) {
    visibility.onChangedErr = String((error && error.message) || error)
  }
  if (typeof feedDisposer === 'function') {
    ctx.effect(function () {
      return function () {
        try { feedDisposer() } catch (error) {}
      }
    }, 'dsh-polish: compact-model projection feed disposer')
  }

  // ①-b session/event 探针（同时喂数据，若本 fiber 真能收到会话事件）：
  // model/selection = 切换当下；request/header = 该次请求的实际路线。
  try {
    ctx.on('session/event', function (session, event) {
      eventCounts.sessionEvent++
      try {
        if (!session || typeof session.id !== 'string' || !event || typeof event.type !== 'string') return
        if (event.type === 'turn/start') turnOpen.set(session.id, true)
        else if (event.type === 'turn/end') turnOpen.set(session.id, false)
        if (event.type === 'model/selection') {
          var d = event.data || {}
          if (typeof d.provider === 'string' && d.provider.length > 0 && typeof d.model === 'string' && d.model.length > 0) {
            cacheSelection(session.id, {
              provider: d.provider,
              model: d.model,
              reasoningEffort: typeof d.reasoningEffort === 'string' && d.reasoningEffort ? d.reasoningEffort : undefined,
            }, 'sessionEvent')
          }
        } else if (event.type === 'request/header') {
          var h = event.data && event.data.header
          if (typeof h === 'string') { try { h = JSON.parse(h) } catch (e2) { h = null } }
          var c = h && h.config
          if (c && typeof c.provider === 'string' && c.provider.length > 0 && typeof c.model === 'string' && c.model.length > 0) {
            routeCache.set(session.id, {
              provider: c.provider,
              model: c.model,
              reasoningEffort: typeof c.reasoningEffort === 'string' ? c.reasoningEffort : undefined,
              at: Date.now(),
              tag: 'sessionEvent',
            })
          }
        }
      } catch (error) {}
    })
  } catch (error) {
    visibility.sessionEventErr = String((error && error.message) || error)
  }

  // ② agent/request 瀑布镜像（keep-effort 已证明本类插件 fiber 可达该瀑布）：
  // next() 之后的 resolved 就是该请求实际解析出的路线（已含核心模型选择
  // 逻辑应用后的结果）。
  try {
    ctx.on('agent/request', async function (payload, next) {
      var resolved = await next()
      try {
        eventCounts.agentRequest++
        var agent = payload && payload.agent
        var sid = agent && agent.session && agent.session.id
        if (
          typeof sid === 'string' && sid.length > 0 &&
          resolved && typeof resolved.provider === 'string' && resolved.provider.length > 0 &&
          typeof resolved.model === 'string' && resolved.model.length > 0
        ) {
          routeCache.set(sid, {
            provider: resolved.provider,
            model: resolved.model,
            reasoningEffort: typeof resolved.reasoningEffort === 'string' ? resolved.reasoningEffort : undefined,
            at: Date.now(),
            tag: 'agentRequest',
          })
        }
      } catch (error) {}
      return resolved
    })
  } catch (error) {
    visibility.agentRequestErr = String((error && error.message) || error)
  }

  // ③ 全局默认选择（模型选择器的默认模型；选择器当前值的权威来源之一）。
  function defaultSelection() {
    try {
      var selection = ctx.agentDefaultModel.currentSelection()
      if (
        selection &&
        typeof selection.provider === 'string' && selection.provider.length > 0 &&
        typeof selection.model === 'string' && selection.model.length > 0
      ) {
        return {
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: typeof selection.reasoningEffort === 'string' && selection.reasoningEffort ? selection.reasoningEffort : undefined,
          source: 'default',
        }
      }
    } catch (error) {}
    return null
  }

  // ── 1.0.11 主源：按需拉取的实时选择（session-slim 同款，不依赖服务可见性）──
  // 选择值形状：view {lastUsed, next}（next = pending ?? lastUsed）或
  // state {lastUsed, pending}。取数优先级 next → pending → lastUsed：
  // 前两者是「下一次请求要用的模型」（与正常消息同源），lastUsed 是兜底
  // （最坏情况 = 原生压缩的行为，不会更差）。
  function pickLiveSelection(view) {
    if (!view || typeof view !== 'object') return null
    var cand = null
    if (view.next && typeof view.next === 'object') cand = view.next
    else if (view.pending && typeof view.pending === 'object') cand = view.pending
    else if (view.lastUsed && typeof view.lastUsed === 'object') cand = view.lastUsed
    if (!cand) return null
    if (typeof cand.provider !== 'string' || cand.provider.length === 0) return null
    if (typeof cand.model !== 'string' || cand.model.length === 0) return null
    return {
      provider: cand.provider,
      model: cand.model,
      reasoningEffort: typeof cand.reasoningEffort === 'string' && cand.reasoningEffort ? cand.reasoningEffort : undefined,
    }
  }

  function dshHome() {
    try {
      var hp = ctx.dshHomePath
      if (typeof hp === 'function') {
        var home = hp()
        if (typeof home === 'string' && home.length > 0) return home
      } else if (typeof hp === 'string' && hp.length > 0) {
        return hp
      }
    } catch (error) {}
    try {
      var root = process.env && process.env.DSH_HOME
      if (typeof root === 'string' && root.length > 0) return root
      var up = process.env && process.env.USERPROFILE
      if (typeof up === 'string' && up.length > 0) return join(up, '.dsh')
    } catch (error) {}
    return null
  }

  // 找最近的 step/turn 生命周期边界。模型选择只在下一次 prompt-assembly
  // 边界生效；step/start 后到 step/end 前的任何选择仍是 pending，不能改写当前步。
  function openStepFromEvents(events) {
    for (var i = events.length - 1; i >= 0; i--) {
      var ev = events[i]
      if (!ev || typeof ev !== 'object') continue
      if (ev.type === 'step/start') return true
      if (ev.type === 'step/end' || ev.type === 'turn/start' || ev.type === 'turn/end') return false
    }
    return false
  }

  // 从活会话日志尾部倒序找最近一次 model/selection（pending）与 request/header
  // （lastUsed）。另外读 step 生命周期，供 overflow recovery 保留当前步路线。
  // 本宿主 ctx.sessions 是 SessionStore，没有 list.getSnapshot 那种客户端快照。
  function liveViewFromLog(session) {
    var events = null
    try {
      if (session && typeof session.snapshotEvents === 'function') events = session.snapshotEvents()
    } catch (error) {}
    if (!events || typeof events.length !== 'number') return null
    var stepOpen = openStepFromEvents(events)
    if (events.length === 0) return { lastUsed: null, pending: null, stepOpen: stepOpen }
    var pending = null
    var lastUsed = null
    var floor = events.length - LOG_SCAN_LIMIT
    if (floor < 0) floor = 0
    for (var i = events.length - 1; i >= floor; i--) {
      var ev = events[i]
      if (!ev || typeof ev !== 'object') continue
      if (!pending && ev.type === 'model/selection') {
        var d = ev.data || {}
        if (typeof d.provider === 'string' && d.provider && typeof d.model === 'string' && d.model) {
          pending = { provider: d.provider, model: d.model, reasoningEffort: d.reasoningEffort }
        }
      } else if (!lastUsed && ev.type === 'request/header') {
        var cfg = ev.data && ev.data.header ? ev.data.header.config : null
        if (cfg && typeof cfg.provider === 'string' && cfg.provider && typeof cfg.model === 'string' && cfg.model) {
          lastUsed = { provider: cfg.provider, model: cfg.model, reasoningEffort: cfg.reasoningEffort }
        }
      }
      if (pending && lastUsed) break
    }
    if (!pending && !lastUsed && !stepOpen) return null
    return { lastUsed: lastUsed, pending: pending, stepOpen: stepOpen }
  }

  // 每次压缩调用时拉取该会话的实时选择。返回 {sel, via, stepOpen} 或 null。
  // 热：活会话日志（只读内存快照，零 I/O）；冷：投影缓存文件（pending 跨重启
  // 持久，形状 record.rows.modelSelection.val = {lastUsed, pending}）。
  function snapshotSelection(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    try {
      var store = ctx.sessions
      var session = store && typeof store.get === 'function' ? store.get(sessionId) : null
      if (session) {
        var view = liveViewFromLog(session)
        var sel = pickLiveSelection(view)
        if (view && (sel || view.stepOpen)) return { sel: sel, via: 'session-log', stepOpen: view.stepOpen }
      }
    } catch (error) {}
    try {
      var home = dshHome()
      if (home) {
        var file = join(home, 'storages', 'session_projcache', 'sessions', sessionId + '.json')
        var rec = JSON.parse(readFileSync(file, 'utf8'))
        var rows = rec && rec.record ? rec.record.rows : null
        var val = rows && rows.modelSelection ? rows.modelSelection.val : null
        var cold = pickLiveSelection(val)
        if (cold) return { sel: cold, via: 'projcache', stepOpen: false }
      }
    } catch (error) {}
    return null
  }

  // ── 诊断文件：<dshHome>/compact-model-diag.json（每次 pass 刷新）──
  // 宿主 dsh-app-boot 提供的 dshHomePath 是函数（dsh-home-paths：
  // configured > $DSH_HOME > ~/.dsh，无参调用 = home 根）；也容忍字符串值。
  function diagPath() {
    var home = dshHome()
    return home ? join(home, DIAG_NAME) : null
  }
  // 串行化写入（同一次压缩 pass 会触发多次 flush，并发写同一文件会交错损坏）；
  // 快照在调用时取，保证落盘的是触发时点的状态。
  var flushChain = Promise.resolve()
  function flushDiag() {
    var p
    try { p = diagPath() } catch (error) { return }
    if (!p) return
    var snapshot
    try {
      snapshot = JSON.stringify({
        version: VERSION,
        appliedAt: appliedAt,
        visibility: visibility,
        eventCounts: eventCounts,
        passes: passes,
      }, null, 1)
    } catch (error) { return }
    flushChain = flushChain.then(function () {
      return writeFile(p, snapshot)
    }).catch(function () {})
  }
  function recordPass(sessionId, trace) {
    try {
      var entry = { ts: Date.now(), sessionId: typeof sessionId === 'string' ? sessionId.slice(-12) : '' }
      for (var k in trace) entry[k] = trace[k]
      passes.push(entry)
      if (passes.length > MAX_PASSES) passes.shift()
      flushDiag()
    } catch (error) {}
  }

  // 设置由 Plugins 页的本行配置表单展示；不生成重复的自动设置页。
  ctx.effect(function () {
    ctx.settings.configure({ auto: false }, ctx.fiber)
  })

  function warnOnce(key, message) {
    if (warned[key]) return
    warned[key] = true
    if (Object.keys(warned).length > 32) delete warned[key]
    try {
      ctx.logger.warn('[dsh-polish:compact-model] ' + message)
    } catch (error) {}
  }

  // 压缩目标解析（1.0.11 起主源是 hook 里的 snapshotSelection；这里是
  // 快照不可用时的降级链）：① 推送选择缓存 → ② 最近真实路线 → ③ 全局默认。
  function resolveCached(sessionId) {
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      var sel = selCache.get(sessionId)
      if (sel) return { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort, source: 'selector-cache' }
      var route = routeCache.get(sessionId)
      if (route) return { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort, source: 'last-route' }
    }
    var def = defaultSelection()
    return def
  }

  // ── 1.0.15：摘要请求装不进目标窗口时的滚动分片压缩 ─────────────────────
  // 线上实证（2026-11-02，session 887e87917ea1，日志可复查）：上下文 ~511k，
  // 路由模型 commandcode/deepseek/deepseek-v4.1-flash 声明窗口 384000。压力
  // 压缩每步都命中阈值（0.8×384000=307200），但官方摘要请求按设计重放整个
  // 待压缩区间（system 前缀 + 全部消息 + 指令），provider 实测
  // input+cacheRead ≈ 507k > 384k；pi-ai 的 silent-overflow 判定把这次
  // 「stop + 完整正文」的摘要改写成 CONTEXT_WINDOW_EXCEEDED，连续 16 次失败，
  // turn 最终以 error 收尾。官方 compaction-basic 无法自救：它把整个区间一次
  // 发给同一个模型，摘要请求本身必然超窗——上下文一旦越过声明窗口，压缩与
  // 请求互为死锁。
  //
  // 本组件只在 purpose === 'compaction' 的流上接管，且不改官方事务：
  //   ① 估算 messages 的 token；不超预算 → 原样 next()（保留 KV 前缀缓存）。
  //   ② 超预算 → 在安全边界（user 消息 / 不含 tool-call 的 assistant）上顺序
  //      切片；每片 = system + 上一片摘要 + 本片消息 + 原指令，滚动折叠。上一
  //      片摘要用 <compacted-summary> 包装——官方指令已定义该标签的合并语义
  //      （保留仍成立的事实、合并新信息），续写结果仍是同一份结构化 checkpoint。
  //   ③ 合成的 chunk 流（block-start / text-delta / usage / finish{stop}）交给
  //      官方调用方，由官方事务照常提交 checkpoint。
  // 另外：单个调用若仍撞上 silent-overflow（provider 返回 stop + 正文，只是
  // 用量超过声明窗口），保留正文放行——那是声明窗口偏小，不是真溢出（真溢出
  // 的 provider error 不会带正文）。两种情况都写进诊断文件。
  var CHUNK_PURPOSE = 'compaction-chunk'
  // 自动重试自己重发的那次压缩请求用这个 Symbol 打标：监听器见到标记直接放行，
  // 不再二次包装（否则会自己套自己，无限重试）。
  var RETRY_MARK = Symbol.for('dsh-polish.compact-auto-retry')
  var SILENT_OVERFLOW_PREFIX = 'pi-ai detected context overflow for model'

  /** 中英混排的保守 token 估算：CJK ≈ 1 token/字，其余 ≈ 1/2.8 token/字符（宁大勿小）。 */
  function estimateTextTokens(text) {
    var cjk = 0
    var other = 0
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i)
      if (
        (c >= 0x2e80 && c <= 0x9fff) ||
        (c >= 0xac00 && c <= 0xd7af) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe4f) ||
        (c >= 0xff00 && c <= 0xffef)
      ) cjk += 1
      else other += 1
    }
    return Math.ceil(cjk + other / 2.8)
  }

  function estimateMessageTokens(message) {
    if (!message) return 0
    try {
      return estimateTextTokens(JSON.stringify(message))
    } catch (error) {
      return 0
    }
  }

  /** 切片只能落在不拆开 tool-call / tool-result 对的位置。 */
  function safeSplitBefore(messages, index) {
    var message = messages[index]
    if (!message) return false
    if (message.role === 'user') return true
    if (message.role !== 'assistant') return false
    var blocks = Array.isArray(message.content) ? message.content : []
    for (var i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].type === 'tool-call') return false
    }
    return true
  }

  /**
   * 规划滚动切片。返回 null 表示保持官方单次调用（不需要或无法切片）。
   * @param messages 官方 buildSummarizationInput 的消息序列（system 头 + 区间 + 指令）
   * @param window 目标模型的声明上下文窗口
   * @param toolsTokens 随请求携带的 tools/toolHistory 估算
   * @param maxTokens 本次摘要的输出上限
   */
  function planCompactionSlices(messages, window, toolsTokens, maxTokens) {
    if (!Array.isArray(messages) || messages.length < 3) return null
    var head = messages[0] && messages[0].role === 'system' ? messages[0] : null
    var instruction = messages[messages.length - 1]
    if (!instruction) return null
    var start = head ? 1 : 0
    var end = messages.length - 1
    if (end - start < 2) return null
    var output = typeof maxTokens === 'number' && maxTokens > 0 ? maxTokens : 8192
    var windowMargin = window - output - 8192
    // 切片目标 0.55：估算本身有误差，留一倍余量；宁可多切一片。
    var budget = Math.floor(windowMargin * 0.55)
    if (!(budget > 16000)) return null
    var fixed = estimateMessageTokens(head) + estimateMessageTokens(instruction) + 2048 + (toolsTokens || 0)
    var available = budget - fixed
    if (available < 8000) return null
    var tokens = []
    var total = fixed
    for (var i = start; i < end; i++) {
      var estimate = estimateMessageTokens(messages[i]) + 8
      tokens.push(estimate)
      total += estimate
    }
    // 只有「预计会撞上窗口」（>80%）才改成分片；其余保持官方单次调用。
    if (total <= Math.floor(windowMargin * 0.8)) return null
    var slices = []
    var current = []
    var currentTokens = 0
    for (var index = 0; index < tokens.length; index++) {
      var message = messages[start + index]
      if (current.length > 0 && currentTokens + tokens[index] > available && safeSplitBefore(messages, start + index)) {
        slices.push(current)
        current = []
        currentTokens = 0
      }
      current.push(message)
      currentTokens += tokens[index]
    }
    if (current.length > 0) slices.push(current)
    if (slices.length <= 1) return null
    return { head: head, instruction: instruction, slices: slices, budget: budget }
  }

  function addUsage(total, usage) {
    if (!usage || typeof usage !== 'object') return total
    var next = total || { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    next.inputTokens += usage.inputTokens || 0
    next.outputTokens += usage.outputTokens || 0
    next.totalTokens += usage.totalTokens || 0
    if (usage.cacheReadTokens) next.cacheReadTokens = (next.cacheReadTokens || 0) + usage.cacheReadTokens
    if (usage.cacheWriteTokens) next.cacheWriteTokens = (next.cacheWriteTokens || 0) + usage.cacheWriteTokens
    return next
  }

  function isSilentOverflow(reason) {
    return !!(
      reason &&
      reason.kind === 'error' &&
      reason.failure &&
      reason.failure.code === 'CONTEXT_WINDOW_EXCEEDED' &&
      typeof reason.failure.message === 'string' &&
      reason.failure.message.indexOf(SILENT_OVERFLOW_PREFIX) === 0
    )
  }

  /** 跑一次子流，收集正文与用量；silent-overflow 但已有正文 → 按成功返回。 */
  async function collectCompactionText(llm, subOptions) {
    var text = ''
    var usage = null
    var finish = null
    for await (var chunk of llm.stream(subOptions)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string' && chunk.block.text.length > text.length) text = chunk.block.text
      else if (chunk.type === 'usage') usage = chunk.usage || usage
      else if (chunk.type === 'finish') finish = chunk
    }
    if (finish && finish.reason && finish.reason.kind === 'error') {
      if (isSilentOverflow(finish.reason) && text.trim().length > 0) {
        return { text: text, usage: usage, acceptedOverflow: true }
      }
      var failure = finish.reason.failure || {}
      var error = new Error(failure.message || 'compaction chunk failed')
      if (failure.code) error.code = failure.code
      throw error
    }
    if (finish && finish.reason && finish.reason.kind === 'max-tokens') {
      var truncated = new Error('chunked compaction truncated at the token cap (incomplete checkpoint)')
      truncated.code = 'MAX_TOKENS'
      throw truncated
    }
    return { text: text, usage: usage, acceptedOverflow: false }
  }

  /**
   * 包装一次压缩摘要流：先探测目标窗口并规划切片，再决定走分片还是原样放行。
   * 立即返回异步迭代器（不是 Promise）——调用方用 `for await` 消费。
   */
  function makeCompactionStream(llm, options, upstream, sessionId, getUpstream) {
    return (async function* () {
      var window
      try {
        var info = await llm.resolveModelInfo(options.provider, options.model, options.signal)
        window = info && info.context ? info.context.contextWindow : undefined
      } catch (error) {}
      var toolsTokens = 0
      try {
        if (Array.isArray(options.tools)) toolsTokens += estimateTextTokens(JSON.stringify(options.tools))
        if (options.toolHistory !== undefined) toolsTokens += estimateMessageTokens({ toolHistory: options.toolHistory })
      } catch (error) {}
      var plan =
        typeof window === 'number' && Number.isInteger(window) && window > 0
          ? planCompactionSlices(options.messages, window, toolsTokens, options.maxTokens)
          : null

      if (!plan || typeof llm.stream !== 'function') {
        // 单次调用；顺手把「已返回正文但用量超过声明窗口」的误判放行。
        // 重试时 upstream 为空，从 getUpstream() 重新取一条下游流。
        var source = upstream || (typeof getUpstream === 'function' ? getUpstream() : null)
        if (!source) throw new Error('compaction upstream unavailable')
        var text = ''
        var finish = null
        for await (var chunk of source) {
          if (!chunk || typeof chunk !== 'object') {
            yield chunk
            continue
          }
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
          if (chunk.type === 'finish') {
            finish = chunk
            continue
          }
          yield chunk
        }
        if (finish && isSilentOverflow(finish.reason) && text.trim().length > 0) {
          warnOnce('accept-silent-overflow', '摘要正文已完整返回但用量超过声明窗口，按成功放行（声明窗口偏小，不是真溢出）')
          recordPass(sessionId, { action: 'accept-silent-overflow', chars: text.length })
          yield { type: 'finish', reason: { kind: 'stop' } }
        } else if (finish) {
          yield finish
        }
        return
      }

      var previous = ''
      var usage = null
      var accepted = 0
      // 合成 assistant 消息必须与真实消息同形：LlmRuntime.forAdapter 会遍历每条
      // assistant 消息读 message.source.replayState，缺 source 直接 TypeError
      // （1.0.15 线上崩溃点）。这里带上目标路线作为 source，replayState 缺省。
      var syntheticSource = { kind: 'model', provider: options.provider, model: options.model }
      for (var index = 0; index < plan.slices.length; index++) {
        var slice = plan.slices[index]
        var messages = []
        if (plan.head) messages.push(plan.head)
        if (index > 0) {
          messages.push({
            role: 'assistant',
            source: syntheticSource,
            content: [{ type: 'text', text: '<compacted-summary>\n' + previous + '\n</compacted-summary>' }],
          })
          messages.push({
            role: 'user',
            content: [{ type: 'text', text: 'The conversation above continues. Fold the following earlier messages into the same checkpoint, keeping every section; merge into it rather than restating it.' }],
          })
        }
        for (var offset = 0; offset < slice.length; offset++) messages.push(slice[offset])
        messages.push(plan.instruction)
        var sub = {}
        for (var key in options) {
          if (key !== 'messages' && key !== 'purpose') sub[key] = options[key]
        }
        sub.purpose = CHUNK_PURPOSE
        sub.messages = messages
        var part = await collectCompactionText(llm, sub)
        // 空片不能覆盖前一片的 checkpoint：直接报错（会被自动重试或原样失败），
        // 不静默丢掉已经折叠进来的内容。
        if (!part.text || part.text.trim().length === 0) throw new Error('chunked compaction slice produced no text')
        if (part.acceptedOverflow) accepted += 1
        previous = part.text
        usage = addUsage(usage, part.usage)
      }
      if (!previous || previous.trim().length === 0) throw new Error('chunked compaction produced no text summary content')
      recordPass(sessionId, {
        action: 'chunked',
        chunks: plan.slices.length,
        window: window,
        budget: plan.budget,
        acceptedOverflow: accepted,
      })
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: previous }
      if (usage) yield { type: 'usage', usage: usage }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }

  // ── 1.0.17：自动压缩失败后的自动重试 ──────────────────────────────────
  // 官方 agent/pre-step 的自动压缩把异常吞成一条 logger.warn 就继续走，
  // 于是「压缩失败一次」直接变成「这一轮带着超窗上下文硬发」。这里在真正失败
  // 的那一层（摘要请求本身）重试。

  /** 这次压缩是不是「自动」的：turn 打开中 = 压力压缩 / 溢出恢复。 */
  function autoRetryGate(options) {
    if (config.autoRetry !== true) return false
    var sid = options && typeof options.sessionId === 'string' ? options.sessionId : null
    if (!sid) return false
    return turnOpen.get(sid) === true
  }

  /** 重试预算：额外次数 0..4，等待 0..20s。 */
  function autoRetryBudget() {
    var attempts = Number(config.autoRetryAttempts)
    if (!Number.isFinite(attempts) || attempts < 0) attempts = 2
    attempts = Math.min(4, Math.floor(attempts))
    var waitMs = Number(config.autoRetryDelayMs)
    if (!Number.isFinite(waitMs) || waitMs < 0) waitMs = 1200
    return { attempts: attempts, waitMs: Math.min(20000, Math.floor(waitMs)) }
  }

  /** 哪些失败值得重试：取消、以及「配置就错」的确定性错误不重试。 */
  function autoRetryable(error, options) {
    if (!error) return false
    var signal = options && options.signal
    if (signal && signal.aborted === true) return false
    if (error.name === 'AbortError') return false
    if (error.code === 'ABORT_ERR') return false
    var message = String(error.message || '')
    if (message.indexOf('no provider/model available') >= 0) return false
    if (message.indexOf('no context capacity') >= 0) return false
    if (message.indexOf('no open turn') >= 0) return false
    return true
  }

  /** 可被 signal 打断的等待。 */
  function autoRetryDelay(ms, signal) {
    if (!(ms > 0)) return Promise.resolve()
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(finish, ms)
      function detach() {
        clearTimeout(timer)
        if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', abort)
      }
      function finish() {
        detach()
        resolve()
      }
      function abort() {
        detach()
        var error = new Error('auto-retry cancelled')
        error.name = 'AbortError'
        reject(error)
      }
      if (signal && typeof signal.addEventListener === 'function') {
        if (signal.aborted === true) {
          abort()
          return
        }
        signal.addEventListener('abort', abort)
      }
    })
  }

  /**
   * 重发同一次压缩请求：重试必须拿到一条**新的**下游流。
   * 复用第一次的流是错的——它已经被消费（或在分片分支里被丢弃），再迭代只会
   * 立刻结束，等于「假装重试成功」。
   * @returns 新的异步流；下游拿不到流时返回 null。
   */
  function reissueCompaction(nextFactory, options) {
    try {
      var stream = typeof nextFactory === 'function' ? nextFactory() : null
      if (stream) return stream
    } catch (error) {}
    // 兜底：重新走一遍 llm 服务（带 RETRY_MARK，本监听器直接放行，不二次包装）。
    var llm = null
    try { llm = ctx.get('llm') } catch (error) {}
    if (!llm) { try { llm = ctx.llm } catch (error) {} }
    if (!llm || typeof llm.stream !== 'function') return null
    var copy = {}
    for (var key in options) copy[key] = options[key]
    copy[RETRY_MARK] = true
    return llm.stream(copy)
  }

  /**
   * 自动重试包装：非自动压缩时与 1.0.16 完全一致（仅分片包装）。
   * 自动压缩失败时按预算重发；用尽后抛出最后一次错误，行为与未重试一致。
   */
  function makeAutoRetryStream(llm, options, first, nextFactory, sessionId, chunked) {
    function inner(source) {
      return chunked ? makeCompactionStream(llm, options, source, sessionId, nextFactory) : source || nextFactory()
    }
    if (!autoRetryGate(options)) return inner(first)
    var budget = autoRetryBudget()
    return (async function* () {
      var attempt = 0
      var source = first
      for (;;) {
        // emitted：是否已经把任何内容交给消费者。一旦交出过，就不能再重试——
        // 否则消费者会拿到两份摘要。
        var emitted = false
        try {
          for await (var chunk of inner(source)) {
            // 非分片路径下 provider 的失败是以 finish{error} 的形式交出来的，不是抛异常。
            // 还没输出过内容时把它转成异常，交给下面的重试；否则原样交出。
            if (!emitted && attempt < budget.attempts && isRetryableErrorFinish(chunk, options)) {
              throw errorFromFinish(chunk)
            }
            // block-start / finish 不携带正文，不算「已输出」；正文或其它内容块才会造成重复摘要。
            if (chunk && chunk.type !== 'finish' && chunk.type !== 'block-start') emitted = true
            yield chunk
          }
          if (attempt > 0) recordPass(sessionId, { action: 'auto-retry-ok', attempt: attempt, attempts: budget.attempts })
          return
        } catch (error) {
          if (emitted || attempt >= budget.attempts || !autoRetryable(error, options)) throw error
          attempt += 1
          recordPass(sessionId, {
            action: 'auto-retry',
            attempt: attempt,
            attempts: budget.attempts,
            error: String((error && error.message) || error).slice(0, 200),
          })
          await autoRetryDelay(budget.waitMs * attempt, options.signal)
          source = reissueCompaction(nextFactory, options)
          if (!source) {
            var missing = new Error('auto-retry unavailable: no downstream stream')
            missing.code = 'NO_DOWNSTREAM'
            throw missing
          }
        }
      }
    })()
  }

  /** finish{error} 且不是 silent-overflow（那种由 collectCompactionText 放行）→ 可重试。 */
  function isRetryableErrorFinish(chunk, options) {
    if (!chunk || chunk.type !== 'finish' || !chunk.reason || chunk.reason.kind !== 'error') return false
    if (isSilentOverflow(chunk.reason)) return false
    return autoRetryable(errorFromFinish(chunk), options)
  }

  function errorFromFinish(chunk) {
    var failure = (chunk && chunk.reason && chunk.reason.failure) || {}
    var error = new Error(String(failure.message || 'compaction request failed'))
    if (failure.code !== undefined) error.code = failure.code
    return error
  }

  // 组件核心：全局 llm/stream 瀑布。监听器只在该调用是压缩摘要（purpose =
  // 'compaction'）且解析出的目标与本次路线不同、且 options 可写时改写；
  // 其余一律原样 next()。this 绑定为 LlmRuntime（Cordis waterfall 约定），
  // 这里用不到。
  // 必须保持同步！waterfall 直接返回监听器的返回值（不 await），调用方用
  // yield* 消费——返回 Promise 会立刻炸「yield* (intermediate value) is not
  // async iterable」。所以这里不做任何异步校验：目标路线是否存在由真正的
  // 调用去暴露，和正常消息的失败方式完全一致。
  ctx.on('llm/stream', function (options, next) {
    // 自动重试自己重发的请求：直接放行，避免自我包装。
    if (options && options[RETRY_MARK] === true) return next()
    var compaction = !!(options && options.purpose === 'compaction')
    // 两个功能各自独立：followSelection 只控制改道，chunkedCompaction 只控制
    // 分片/超窗放行。任意一个关掉，另一个照常工作（1.0.16）。
    var followSelection = config.followSelection !== false
    var chunkedCompaction = config.chunkedCompaction === true
    // 统一的放行出口：先同步拿到下游流（保持 waterfall 语义），只有压缩摘要、
    // 分片开关打开且有完整消息时才包一层分片逻辑；包层本身返回异步迭代器，
    // 绝不是 Promise。
    function pass() {
      var stream = next()
      if (!compaction) return stream
      var llm = null
      try { llm = ctx.get('llm') } catch (error) {}
      if (!llm) { try { llm = ctx.llm } catch (error) {} }
      if (!llm || typeof llm.stream !== 'function' || typeof llm.resolveModelInfo !== 'function') return stream
      var chunked = chunkedCompaction && Array.isArray(options.messages) && options.messages.length >= 3
      // 1.0.17：自动压缩（turn 打开中）即使不分片也要包一层，才有重试。
      if (!chunked && !autoRetryGate(options)) return stream
      try {
        return makeAutoRetryStream(llm, options, stream, next, options.sessionId, chunked)
      } catch (error) {
        return stream
      }
    }
    try {
      if (
        compaction &&
        followSelection &&
        options &&
        typeof options.provider === 'string' &&
        typeof options.model === 'string'
      ) {
        var from = options.provider + '/' + options.model
        // ①' 主源：按需拉取选择器实时值。若 step 尚未闭合（例如
        // agent/request-error 内的 overflow recovery），选择仍是 pending；遵循
        // 官方「下一次 prompt-assembly 才生效」时序，保留当前 compaction 路线。
        var live = snapshotSelection(options.sessionId)
        if (live && live.stepOpen) {
          recordPass(options.sessionId, {
            from: from,
            target: live.sel ? live.sel.provider + '/' + live.sel.model : null,
            effective: from,
            source: live.via,
            action: 'active-step-preserved',
          })
          return pass()
        }
        var target = live && live.sel ? live.sel : resolveCached(options.sessionId)
        if (target && live && live.sel) target.source = live.via
        recordPass(options.sessionId, {
          from: from,
          target: target ? target.provider + '/' + target.model : null,
          source: target ? target.source : null,
        })
        if (target && (target.provider !== options.provider || target.model !== options.model)) {
          if (Object.isFrozen(options)) {
            warnOnce('frozen:' + from, 'compaction options 已冻结，跳过改道（' + from + '）')
            recordPass(options.sessionId, {
              from: from,
              action: 'frozen',
              target: target.provider + '/' + target.model,
              source: target.source,
            })
          } else {
            var to = target.provider + '/' + target.model
            options.provider = target.provider
            options.model = target.model
            if (target.reasoningEffort !== undefined) options.reasoningEffort = target.reasoningEffort
            else delete options.reasoningEffort
            reroutes.push({
              at: Date.now(),
              sessionId: typeof options.sessionId === 'string' ? options.sessionId.slice(-12) : '',
              from: from,
              to: to,
              source: target.source,
            })
            if (reroutes.length > MAX_REROUTES) reroutes.shift()
            recordPass(options.sessionId, { from: from, to: to, source: target.source, action: 'reroute' })
            try {
              ctx.logger.info('[dsh-polish:compact-model] 压缩改道 ' + from + ' -> ' + to + '（source=' + target.source + '）')
            } catch (error) {}
          }
        } else {
          recordPass(options.sessionId, {
            from: from,
            action: 'unchanged',
            target: target ? target.provider + '/' + target.model : null,
            source: target ? target.source : null,
          })
        }
      }
    } catch (error) {
      // Fail-safe：任何异常都不许打断压缩调用本身。
      warnOnce('error:' + ((error && error.message) || error), '监听异常，原样放行：' + ((error && error.message) || error))
    }
    return pass()
  })

  // 只读状态路由：全局默认选择 + 可见性探针 + 事件计数 + 最近改道记录。
  ctx.effect(
    function () {
      if (!ctx.connection || !ctx.connection.fetch || typeof ctx.connection.fetch.register !== 'function') return
      ctx.connection.fetch.register({
        path: STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async function () {
          var defaultSel = null
          try { defaultSel = ctx.agentDefaultModel.currentSelection() } catch (error) {}
          return new Response(JSON.stringify({
            ok: true,
            active: true,
            version: VERSION,
            appliedAt: appliedAt,
            visibility: visibility,
            features: {
              followSelection: config.followSelection !== false,
              chunkedCompaction: config.chunkedCompaction === true,
              pressureGuardEnabled: config.pressureGuardEnabled === true,
              autoRetry: config.autoRetry === true,
              autoRetryAttempts: autoRetryBudget().attempts,
              autoRetryDelayMs: autoRetryBudget().waitMs,
            },
            eventCounts: eventCounts,
            defaultSelection: defaultSel,
            reroutes: reroutes.slice(),
          }), {
            status: 200,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          })
        },
      })
    },
    'dsh-polish: compact-model status route',
  )

  // apply 完成即写一次初始状态（可见性 + 计数）：零压缩时诊断文件也可用。
  flushDiag()
}
