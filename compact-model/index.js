/**
 * compact-model（组件 N）：压缩摘要用「模型选择器当前选中的模型」。
 *
 * 为什么内建不够：dsh-compaction-basic 的摘要调用按
 *   ① 本行 summarizationProvider/Model 静态配置
 *   ② 会话最近一次真实请求的路线（requestHeader().config，即「上一次使用的模型」）
 *   ③ agent options
 * 的优先级选模型。用户在模型选择器里换模型（典型场景：老模型不再可用，必须
 * 换新模型）并不会立刻改写 ②——选择先进 pending 槽，要等下一次真实请求
 * （request/header）才提交为 lastUsed。于是 /compact（以及压力自动压缩、
 * 上下文溢出恢复）继续打向死掉的老模型 → 一直失败。
 *
 * 本组件做什么：监听 `llm/stream` 瀑布——DSH 官方的「routing」扩展点，
 * 每一个流式模型调用（含压缩摘要）都经过它，且 `next()` 链读到的 options
 * 与监听器拿到的是同一个对象，就地改写即生效。压缩调用带
 * `options.purpose === 'compaction'` 标记（compaction-basic 的
 * summarizeWithLlm 硬编码），据此识别；命中后按优先级解析目标：
 *   ① 该会话 modelSelection 的实时缓存（选择器当前指向 = pending ?? lastUsed，
 *      即「下一次请求要用的模型」；用户切换当下即写入，无需等下一次请求）；
 *   ② 该会话最近一次真实请求实际解析出的路线（agent/request 镜像）；
 *   ③ agentDefaultModel.currentSelection()（全局默认选择，回退）。
 * 目标与本次调用路线不同时，就地改写 options.provider / options.model，并
 * 同步对齐 reasoningEffort（选择带 effort → 覆盖；选择没带 → 删除旧值——
 * 新模型不支持旧 effort 时 llm.resolveCallWithInfo 会硬拒
 * UNSUPPORTED_REASONING_EFFORT，带着死模型的 effort 比不带更容易失败）。
 * 随后原样 next() 放行。
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
 * 只动压缩调用：purpose !== 'compaction' 的正常模型回合绝不触碰，会话仍用
 * 它自己选择的模型。
 * Fail-safe：options 被冻结、服务缺失、任何读取异常 → 原样放行 + warn 一次。
 * 本组件绝不让压缩调用因为自己而失败。
 *
 * 覆盖全部三个压缩入口（/compact 手动、压力自动、上下文溢出恢复——它们收敛
 * 到同一个 summarizeWithLlm → ctx.llm.stream）。
 *
 * 总开关 = 本行 Loader 行开关（行开 → apply 运行、监听注册；行关 → 监听随
 * 行卸载自动移除，恢复 DSH 原生压缩行为）。本行无用户可见设置表单
 * （自动设置页隐藏）。只读状态路由 GET /api/dshp/compact-model/status
 * 返回全局默认选择 + 可见性探针 + 事件计数 + 最近 20 条改道记录（验证/排障）。
 */

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const inject = ['agentDefaultModel', 'settings', 'connection']

var STATUS_PATH = '/api/dshp/compact-model/status'
var MAX_REROUTES = 20
var MAX_PASSES = 20
var VERSION = '1.0.10'
var DIAG_NAME = 'compact-model-diag.json'

export function apply(ctx) {
  var reroutes = []
  var warned = {}
  var passes = []
  var appliedAt = Date.now()

  // ── 服务可见性探针（写进诊断文件 + 状态路由，回答「线上为什么是 null」）──
  var sessions = null
  var projections = null
  var llm = null
  try { sessions = ctx.sessions } catch (error) {}
  try { projections = ctx.sessionProjections } catch (error) {}
  try { llm = ctx.llm } catch (error) {}
  var visibility = {
    sessions: !!sessions,
    sessionsGet: sessions ? typeof sessions.get : undefined,
    sessionsRetain: sessions ? typeof sessions.retain : undefined,
    sessionsUsing: sessions ? typeof sessions.using : undefined,
    projections: !!projections,
    projectionsStateOf: projections ? typeof projections.stateOf : undefined,
    projectionsOnChanged: projections ? typeof projections.onChanged : undefined,
    agentDefaultModel: !!ctx.agentDefaultModel,
    llm: !!llm,
  }
  var eventCounts = { onChange: 0, sessionEvent: 0, agentRequest: 0 }

  // ── ① 实时选择器缓存：sessionId -> 选择（含 effort，缺失为 undefined）──
  var selCache = new Map()
  // ── ② 最近真实请求路线镜像：sessionId -> 路线（含 effort）──
  var routeCache = new Map()

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

  // ── 诊断文件：<dshHome>/compact-model-diag.json（每次 pass 刷新）──
  // 宿主 dsh-app-boot 提供的 dshHomePath 是函数（dsh-home-paths：
  // configured > $DSH_HOME > ~/.dsh，无参调用 = home 根）；也容忍字符串值。
  function diagPath() {
    try {
      var hp = ctx.dshHomePath
      if (typeof hp === 'function') {
        var home = hp()
        if (typeof home === 'string' && home.length > 0) return join(home, DIAG_NAME)
      } else if (typeof hp === 'string' && hp.length > 0) {
        return join(hp, DIAG_NAME)
      }
    } catch (error) {}
    try {
      var root = process.env && process.env.DSH_HOME
      if (typeof root === 'string' && root.length > 0) return join(root, DIAG_NAME)
      var up = process.env && process.env.USERPROFILE
      if (typeof up === 'string' && up.length > 0) return join(up, '.dsh', DIAG_NAME)
    } catch (error) {}
    return null
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

  // 隐藏自动设置页：本行没有用户可见的设置表单（总开关 = Loader 行开关）。
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

  // 压缩目标解析：① 实时选择器 → ② 最近真实路线 → ③ 全局默认。
  function resolveTarget(sessionId, from) {
    var trace = { from: from, sel: null, route: null, defaultSel: null, target: null }
    var target = null
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      var sel = selCache.get(sessionId)
      var route = routeCache.get(sessionId)
      if (sel) {
        trace.sel = sel
        target = { provider: sel.provider, model: sel.model, reasoningEffort: sel.reasoningEffort, source: 'selector' }
      } else if (route) {
        trace.route = route
        target = { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort, source: 'last-route' }
      }
    }
    if (!target) {
      target = defaultSelection()
      trace.defaultSel = target
    }
    trace.target = target ? target.provider + '/' + target.model : null
    recordPass(sessionId, trace)
    return target
  }

  // 组件核心：全局 llm/stream 瀑布。监听器只在该调用是压缩摘要（purpose =
  // 'compaction'）且解析出的目标与本次路线不同、且 options 可写时改写；
  // 其余一律原样 next()。this 绑定为 LlmRuntime（Cordis waterfall 约定），
  // 这里用不到。
  ctx.on('llm/stream', function (options, next) {
    try {
      if (
        options &&
        options.purpose === 'compaction' &&
        typeof options.provider === 'string' &&
        typeof options.model === 'string'
      ) {
        var from = options.provider + '/' + options.model
        var target = resolveTarget(options.sessionId, from)
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
    return next()
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
