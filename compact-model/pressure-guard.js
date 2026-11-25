/**
 * compact-model 的可选压力保护。
 *
 * 一句话：到阈值 → 必须压；压不动 → 打 error 日志并放行本步，从不拒绝。
 *
 * 背景：内置 compaction-basic 的自动压缩失败时不抛给用户（lib/index.js 把
 * 异常吞成 "step compaction failed ... continuing the turn"，请求照发），
 * 且摘要请求本身可能被 pi-ai 的 silent-overflow 误判成
 * CONTEXT_WINDOW_EXCEEDED（provider 正常返回但 input+cacheRead > 声明窗口），
 * 于是压缩永远失败、超大请求一次次发出去。本组件在决策层补上这条不变量：
 *
 *   对每个 agent/pre-step（每轮模型的请求前）：
 *   1. pressure < window×ratio → 完全不介入（零日志）。
 *   2. pressure ≥ threshold → 必须执行压缩；压完重测，达标才放行。
 *   3. 压不动 → 机械剪枝兜底；仍超阈值 → 打 error 日志并放行。1.4.35 起本组件没有
 *      任何 reject 路径：reject 在 agent-loop 里会吞掉已被取走的用户消息，且不发
 *      agent/error，等于会话无声死亡。
 *
 * 压力怎么算（关键）：tokenMeter.measure() 的 totalTokens 只在
 * baseline.kind === 'usage' 时可信（复用服务端上报）；否则是 4 字符/token
 * 估算，中文和大工具输出会低估 30%~60%。所以估算模式下取
 * max(测量值, 最近一次服务端真实 usage) × estimatedSafetyFactor 作为压力。
 * lastUsageTotal 是「下一条请求至少这么大」的硬下界（上一条 prompt +
 * 上一条输出都在里面），堵住「真实 322k、自估 218k」的漏洞。首请求没有
 * header/usage → 直接放行（还没有东西可压）。
 *
 * 溢出兜底（agent/request-error）：provider 确认 CONTEXT_WINDOW_EXCEEDED 时
 * prune + compactIfNeeded('context-overflow')，为**后续**回合腾空间；
 * 本次请求的错误原样返回，**不重发同一个请求**（与 autoRetry 无关：autoRetry 只重试自动压缩的摘要请求）。
 *
 * 挂钩点（全部源码核对过，0.2.1-rc.1）：
 *   * agent/pre-step 瀑布（dsh-agent-loop preStep，payload 必带 agent——
 *     agentEvents 的 fused 注入；本组件从不返回 reject）；
 *   * agent/request-error 瀑布（requestStream finish.kind==='error'/'aborted'
 *     时发射；本组件只用它补压缩，不返回 retry）；
 *   * agent/status idle（每轮回 idle，用于清 per-turn 预算与步骤去重表）；
 *   * session.requestHeader()（routedTarget 同款：config.provider/model/maxTokens）；
 *   * ctx.llm.resolveModelInfo(provider, model, signal) → context.contextWindow，
 *     拿不到时退回 session.requestContext().contextWindow（自定义 provider 常走这条）；
 *   * ctx.tokenMeter.measure(session) → { totalTokens, baseline{kind,tokens,usage} }；
 *   * ctx.get('compaction').compactIfNeeded({session,options:{}}, trigger, signal)
 *     ——内部只用 agent.session / agent.options，最小 agent 即可（源码核对：
 *     reservedCompletionTokens 只读 session.requestHeader().config.maxTokens，
 *     summarizeWithLlm 读 session.requestHeader/toolHistory/id + agent.options）；
 *   * ctx.get('toolResultPruner').pruneSession(session) → { pruned, charsRemoved }；
 *   * 压缩并发锁冲突抛 ManualCompactionError，code === 'busy' → 吞掉放行。
 *
 * 与内置 compaction-basic 的关系：
 *   * 注册顺序上本行在核心行之后 → 本组件的 pre-step 判定天然排在它的
 *     自动压缩之后（监督者模式：先看它压没压，压完还超我才动手）。
 *   * 它的 compactIfNeeded('pressure') 内部有自己的阈值闸（其 config 的
 *     thresholdRatio，默认 0.8 且 −32768 headroom）：本组件的 thresholdRatio
 *     若调得比它低，它在阈值下会返回 null 不压，本组件就会直接走
 *     只剪枝并放行——所以本组件的 ratio 不应低于内置 ratio（mode A 单一路径
 *     时也不例外）。
 *   * 推荐 mode A：profile 里给 compaction-basic 配 auto: false（只留
 *     compactNow 给 /compact），自动触发由本组件独占。
 *
 * 明确做不到的（别让后人误解）：
 *   * 改不了 pi-ai 的 silent-overflow 误判，也改不了 token-meter 的
 *     CHARS_PER_TOKEN=4 估算。本组件只在决策层保证「不静默放行」。
 *   * 声明窗口错的时候（不走模型目录的路由按 DEFAULT_CONTEXT_WINDOW 算），
 *     压缩大概率压不动，此时策略就是剪枝 + error 日志 + 放行。
 *   * 没有硬停：1.4.26 的 reject 会话死锁已于 1.4.35 整段删除。
 *   * 不调 compactNow（要求 idle + runMaintenance；pre-step 里有打开的
 *     turn），只调 compactIfNeeded。
 *
 * 工程注意（keep-effort 0.4.54 的教训）：
 *   * 不声明 export const inject——它是激活门槛，声明的服务在本行作用域
 *     不可见时整行 fiber 永不 ACTIVE、apply 不跑、全链路静默失效。全部
 *     服务在监听器内按请求 ctx.get 懒读（get 未提供时返回 undefined，
 *     不抛），缺了就 fail-open 放行。
 *   * 事件注册直接 ctx.on（compaction-basic 同款，核心 agent 作用域瀑布
 *     对普通 ctx.on 监听可见），随行 fiber 自动卸载，无需手工 disposer。
 *
 * 总开关 = 本行 Loader 行开关；pressureGuardEnabled 是独立的子开关。**1.4.26 起
 * 默认关闭**：它在压不动时只记 error 日志并放行，不再有任何硬停路径。
 * 关掉它只停用这一层保护，不影响 followSelection（摘要跟随选择器）与 chunkedCompaction（分片压缩）。
 * （非 volatile，随行重载生效）。dryRun 只告警不动作，仅供验收阈值。
 */

// --------------------------------------------------------------- 纯决策核心
// （自包含、无模块闭包依赖：harness 直接 extractFunction 跑矩阵）

/** Sum disjoint provider usage buckets without double-counting reasoning output. */
function usageTotal(usage) {
  if (!usage || typeof usage !== 'object') return 0
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0) + (usage.outputTokens ?? 0)
}

/**
 * 最近一次服务端上报的真实用量（surface 里最新的 assistant/message）。
 * nodes 是 session.surface.nodes（模型可见序的 seq 数组），eventAt 是
 * session.eventAt(seq)（核心自身仍在用的同步读，0.2.x 内稳定）。
 * 返回 0 表示还没有任何带 usage 的历史（首请求）。
 */
function lastUsageTotal(nodes, eventAt) {
  if (!Array.isArray(nodes) || typeof eventAt !== 'function') return 0
  const start = Math.max(0, nodes.length - 4096)
  for (let i = nodes.length - 1; i >= start; i -= 1) {
    const ev = eventAt(nodes[i])
    if (ev?.type === 'assistant/message' && ev.data?.usage !== undefined) {
      return usageTotal(ev.data.usage)
    }
  }
  return 0
}

/**
 * 压力：usage 基线可信时直接用测量值；估算基线取 max(测量值, 真实下界)
 * × 保守系数（ceil 对齐向上）。measurement 是 tokenMeter.measure() 的结果。
 */
function pressureOf(measurement, lastUsage, safetyFactor) {
  if (!measurement || typeof measurement !== 'object') return { tokens: 0, kind: 'none', floor: 0 }
  if (measurement.baseline?.kind === 'usage') {
    return { tokens: measurement.totalTokens ?? 0, kind: 'usage', floor: measurement.totalTokens ?? 0 }
  }
  const floor = Math.max(measurement.totalTokens ?? 0, lastUsage ?? 0)
  const factor = safetyFactor >= 1 ? safetyFactor : 1
  return { tokens: Math.ceil(floor * factor), kind: 'estimated', floor }
}

/**
 * 主闸：'pass' 放行；'budget' 本轮强制预算用完（记 error 日志并放行）；
 * 'enforce' 必须压。decide 过的 dryRun 不在这里（dryRun 不消耗预算）。
 */
function decideGate(pressure, threshold, forced, maxForced) {
  if (pressure.tokens < threshold) return 'pass'
  if (forced >= maxForced) return 'budget'
  return 'enforce'
}

export { usageTotal, lastUsageTotal, pressureOf, decideGate }

// -------------------------------------------------------------------- 配置

const DEFAULTS = {
  enabled: false,
  thresholdRatio: 0.8,
  estimatedSafetyFactor: 1.3,
  // 默认关：剪枝会改写历史 tool result，剪完即使低于阈值也没压缩，前缀缓存随之失效。
  pruneBeforeCompact: false,
  maxForcedPerTurn: 2,
}

// -------------------------------------------------------------------- 主体

export function applyPressureGuard(ctx, config) {
  const cfg = { ...DEFAULTS, ...(config ?? {}) }
  if (!cfg.enabled) return

  const logger = ctx.logger
  let overflowCodePromise
  function contextWindowExceededCode() {
    if (!overflowCodePromise) {
      overflowCodePromise = import('@deepseek-ai/dsh-llm')
        .then((module) => module.CONTEXT_WINDOW_EXCEEDED_CODE)
        .catch((error) => {
          logger.warn(`[dsh-polish:compact-model:pressure-guard] overflow recovery unavailable: ${error?.message ?? error}`)
          return undefined
        })
    }
    return overflowCodePromise
  }
  // 监听器的统一外壳：异常只记日志；若还没把控制权交给下游，就放行本步。
  function guardedListener(log, name, next0, run) {
    let handed = false
    const hand = () => {
      handed = true
      return next0()
    }
    return (async () => {
      try {
        return await run(hand)
      } catch (error) {
        log.error(`[dsh-polish:compact-model:pressure-guard] ${name} failed; passing through: ${error?.message ?? error}`)
        return handed ? undefined : next0()
      }
    })()
  }
  const service = (name) => {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }

  // 同一步只判一次（pre-step 被调两次时只压一次）；idle 时随 per-agent 清理。
  const seenSteps = new Set()
  // 每轮强制压缩预算（防死循环）：agent.id -> 已强制次数。
  const forcedPerTurn = new Map()
  const warnedNoWindow = new Set()

  function measure(session) {
    const meter = service('tokenMeter')
    if (meter === undefined || typeof meter.measure !== 'function') return undefined
    return meter.measure(session)
  }

  /** 声明窗口：模型目录或最近一次请求上下文；都没有 → undefined。 */
  async function contextWindowOf(llm, session, signal) {
    const routed = session.requestHeader()?.config
    if (llm !== undefined && typeof llm.resolveModelInfo === 'function' && routed?.provider && routed?.model) {
      const info = await llm.resolveModelInfo(routed.provider, routed.model, signal).catch(() => undefined)
      const declared = info?.context?.contextWindow
      if (typeof declared === 'number' && declared > 0) return declared
    }
    // 自定义 provider 常常不在目录里；request/context 里带着自己的窗口。
    const fromContext = session.requestContext?.()?.contextWindow
    if (typeof fromContext === 'number' && fromContext > 0) return fromContext
    return undefined
  }

  function exhausted(signal, reason, p, threshold, window, next, sessionId) {
    const detail = `reason=${reason} pressure=${p.tokens}(${p.kind}) threshold=${threshold} window=${window}`
    logger.error(`[dsh-polish:compact-model:pressure-guard] context above threshold; passing through (${detail})`)
    return next()
  }

  // ------------------------------------------------------------ pre-step 守卫
  // 监听器主体包进 guardedListener：任何异常都只记日志并放行，不穿出监听器。
  ctx.on('agent/pre-step', (event, next) => guardedListener(logger, 'agent/pre-step', next, (hand) => preStepGuard(event, hand)))
  async function preStepGuard({ agent, turn, step, signal }, next) {
    if (signal?.aborted) return next()
    const stepKey = `${agent.id}:${turn}:${step}`
    if (seenSteps.has(stepKey)) return next()
    seenSteps.add(stepKey)

    // 首请求（尚无持久化 header）：没有 routed target、没有可压的东西 → 放行。
    const session = agent.session ?? service('sessions')?.get(agent.id)
    if (session === undefined || session.requestHeader() === undefined) return next()

    const measurement = measure(session)
    if (measurement === undefined) return next()
    const llm = service('llm')
    const window = await contextWindowOf(llm, session, signal).catch(() => undefined)
    if (!window) {
      // 没有窗口就无法判断「超没超」。至少留下一次可诊断的日志，而不是静默放行。
      const key = `${agent.id}`
      if (!warnedNoWindow.has(key)) {
        warnedNoWindow.add(key)
        logger.warn(`[dsh-polish:compact-model:pressure-guard] no context window for session=${session.id}; automatic compaction cannot be judged (model=${session.requestHeader()?.config?.model ?? '?'})`)
      }
      return next()
    }
    const threshold = Math.floor(window * cfg.thresholdRatio)

    // 压力每次都从当前 surface 现算：压缩/剪枝会 shadow 掉旧的 usage 事件，
    // 复用压缩前的下界会把「已经压下去了」误判成「仍然超阈值」。
    function currentPressure() {
      const current = measure(session)
      if (current === undefined) return undefined
      return pressureOf(current, lastUsageTotal(session.surface.nodes, (seq) => session.eventAt(seq)), cfg.estimatedSafetyFactor)
    }

    const p = currentPressure()
    if (p === undefined) return next()
    const gate = decideGate(p, threshold, forcedPerTurn.get(agent.id) ?? 0, cfg.maxForcedPerTurn)
    if (gate === 'pass') return next()

    if (gate === 'budget') {
      return exhausted(signal, 'turn-budget', p, threshold, window, next, session.id)
    }

    if (cfg.dryRun) {
      logger.warn(`[dsh-polish:compact-model:pressure-guard] would compact ${p.tokens} >= ${threshold} (window=${window}, kind=${p.kind}, session=${session.id})`)
      return next()
    }
    forcedPerTurn.set(agent.id, (forcedPerTurn.get(agent.id) ?? 0) + 1)
    logger.warn(`[dsh-polish:compact-model:pressure-guard] pressure ${p.tokens} >= ${threshold} (window=${window}, kind=${p.kind}, forced=${forcedPerTurn.get(agent.id)}/${cfg.maxForcedPerTurn}, session=${session.id}): enforcing compaction`)

    const prune = service('toolResultPruner')
    if (cfg.pruneBeforeCompact && prune !== undefined && typeof prune.pruneSession === 'function') {
      prune.pruneSession(session)
      const prunedPressure = currentPressure()
      if (prunedPressure !== undefined && prunedPressure.tokens < threshold) return next()
    }

    const compaction = service('compaction')
    if (compaction === undefined || typeof compaction.compactIfNeeded !== 'function') {
      return exhausted(signal, 'no-compaction-service', p, threshold, window, next, session.id)
    }

    try {
      // 最小 agent（{session, options:{}}）：compactIfNeeded 内部只用
      // agent.session 与 agent.options（源码核对，见头部）；绝不调 compactNow。
      await compaction.compactIfNeeded({ session, options: {} }, 'pressure', signal)
    } catch (error) {
      if (error?.code === 'busy') {
        // 已有压缩在跑（并发安全）：交给它，不报错。
        logger.info(`[dsh-polish:compact-model:pressure-guard] compaction busy; deferring to the running compaction (session=${session.id})`)
        return next()
      }
      logger.error(`[dsh-polish:compact-model:pressure-guard] compaction failed: ${error?.message ?? error}`)
    }
    if (signal?.aborted) return next()

    const afterCompaction = currentPressure() ?? p
    if (afterCompaction.tokens < threshold) return next()

    // 机械兜底（摘要请求被误判成溢出时 compactIfNeeded 压不动，这里是出路）。
    if (prune !== undefined && typeof prune.pruneSession === 'function') {
      prune.pruneSession(session)
      const afterPrune = currentPressure()
      if (afterPrune !== undefined && afterPrune.tokens < threshold) {
        logger.info(`[dsh-polish:compact-model:pressure-guard] prune fallback brought pressure under threshold (session=${session.id})`)
        return next()
      }
    }

    return exhausted(signal, 'still-over-threshold', afterCompaction, threshold, window, next, session.id)
  }

  // ------------------------------------------------ 溢出兜底（压缩，不重试）
  // 用户明确要求：压缩失败不要自动重试。这里只在 provider 已确认超窗时补一次
  // 压缩，让**后续**回合还有空间；本次请求的错误原样返回，绝不重发同一个请求。
  ctx.on('agent/request-error', (event, next) => guardedListener(logger, 'agent/request-error', next, (hand) => overflowRecovery(event, hand)))
  async function overflowRecovery({ agent, failure, signal }, next) {
    if (signal?.aborted) return next()
    // 动态导入失败时 code 为 undefined；此时绝不能把 undefined 当成「超窗」去压缩。
    const overflowCode = await contextWindowExceededCode()
    if (!overflowCode || failure?.code !== overflowCode) return next()
    const session = agent.session ?? service('sessions')?.get(agent.id)
    if (session === undefined) return next()

    const before = session.surface.replaceGeneration
    try {
      service('toolResultPruner')?.pruneSession?.(session)
      await service('compaction')?.compactIfNeeded?.({ session, options: {} }, 'context-overflow', signal)
    } catch (error) {
      logger.error(`[dsh-polish:compact-model:pressure-guard] overflow compaction failed: ${error?.message ?? error}`)
    }
    if (session.surface.replaceGeneration > before) {
      logger.info(`[dsh-polish:compact-model:pressure-guard] compacted after a provider-confirmed overflow (session=${session.id}); the failed request is not retried`)
    }
    return next()
  }

  // ---------------------------------------------------------- 轮界清理
  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    forcedPerTurn.delete(agent.id)
    warnedNoWindow.delete(agent.id)
    const prefix = `${agent.id}:`
    for (const key of seenSteps) {
      if (key.startsWith(prefix)) seenSteps.delete(key)
    }
  })
}
