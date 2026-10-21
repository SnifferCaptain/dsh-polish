import z from '@deepseek-ai/schemastery'

/**
 * keep-effort（组件 K）：按 (会话, 模型) 记忆推理强度（reasoning effort）。
 *
 * 痛点：会话内切换模型（预设切换 / 模型选择）时，DSH 只应用「选择」自带
 * 的 effort——UI 切模型不选 effort 时，新模型的 defaultEffort 会被自动填充
 * （dsh-llm resolveCallConfig 会物化默认值），用户之前在该模型上实际使用
 * 的强度就丢了。
 *
 * 行为：
 *   * 记录：每个 (会话, 模型) 记住最近一次请求实际携带的 reasoning effort
 *     （只记有意义的字符串；值未变不触发写盘）。注意：agent/request 瀑布
 *     里的 config 经常**不带** effort——选择未显式携带时，模型自己的默认值
 *     是 prepareCall 在瀑布**之后**才物化的（effective = requested ??
 *     reasoning.defaultEffort），所以记录取「瀑布值 ?? resolveCallConfig
 *     物化默认」（per-route 缓存，fail-soft），记忆才能在每次请求都累积。
 *   * 继承：当路由 (provider/model) 变化、且新选择没有携带显式 effort
 *     （或 carryOnDefault 开着时只携带新模型自己的默认值——即 UI 切模型
 *     未选 effort 的自动填充场景）时，恢复该模型在本会话最近用过的 effort。
 *   * 词表：每个模型只继承**自己**记录过的值，provider 之间的 effort 词表
 *     差异（qwen off/low/medium/xhigh；gpt-6.1-sol 无 off；…）因此天然不
 *     冲突；记录值若已不再被支持，静默跳过（llm.resolveCallConfig 校验，
 *     不钳制、不映射）。
 *   * 静默：effort-only 的变化不触发核心的 [model changed] 通知（pre-step
 *     只比较路由），继承对用户无感知。
 *
 * 持久化：记录写在本行配置 effortRecords（非 volatile，重启保留）；5s 防抖
 * 写盘 + 行卸载时 best-effort 兜底；最多保留 MAX_SESSIONS 个最近会话
 * （按最近使用顺序淘汰最旧的）。
 *
 * 诊断（0.4.43）：行配置另存一个 diagnostics 小字段（非 volatile，同防抖
 * 写盘）——apply 完成标记、钩子触发计数、最近一次继承决策的全部输入与结论、
 * 最近异常。行为静默是这个组件的设计（继承对用户无感知），代价是「为什么没
 * 生效」无从查起；该字段就是查这个的：重启后让组件跑几个模型切换，直接在
 * 插件页/patch 文件读 diagnostics 即可看到每次决策的路由/当前值/记忆值/
 * 模型默认值/支持性/结论。
 *
 * 总开关 = 本行 Loader 行开关（行开 → apply 运行、注册 agent/request 监听；
 * 行关 → fiber 收起、监听移除，记录已持久化、下次行开自动恢复）。
 * enabled 是该开关在设置页的镜像；carryOnDefault 是激活时读取的行为开关
 * （改它需要行重载）。
 *
 * 挂钩点（均为核心官方 seam，源码验证）：
 *   * agent/request 瀑布（dsh-agent-loop prepareRequest 发射；核心自己的
 *     model-selection 逻辑、dsh-webhook / dsh-session-reference 插件都从
 *     根 ctx 挂 agent 作用域瀑布；dsh-scope 的 invariant 强制 payload 必带
 *     agent）；
 *   * agent.session.requestHeader()——最近一次持久化请求头（config +
 *     adapterDefaults）；
 *   * llm.resolveCallConfig——能力校验（不支持的显式 effort 在任何 provider
 *     I/O 前拒绝，UNSUPPORTED_REASONING_EFFORT；独立查询不绑定 dispatch）。
 *
 * fail-open：任何异常（payload 缺 agent、header 读取失败、能力校验报错、
 * 持久化写失败）都只告警并原样放行——绝不弄坏模型调用。
 *
 * 0.4.53（rc.1 静默失效修复）：
 *   * 根因——rc.1 的 settings.update 校验「运行期只能写 volatile 字段」
 *     （dsh-settings：“Config field \"…\" is not volatile”）；本组件
 *     effortRecords/diagnostics 是当时唯一两个漏标 .volatile() 的字段，
 *     于是每次写盘必失败 → 退避 → 停手，记忆从未落盘。已补标记。
 *   * apply 全程 fail-soft（configure/interval/卸载 effect 的注册异常
 *     不再中断 apply，记入诊断 setupError）。
 *   * settings.update 不再假设返回 thenable（沙箱守卫包装下裸调 .then
 *     会把每次 flush 变失败→退避→停手→永不写盘）。
 *   * apply 尾部立即写盘一次并带 version——激活后几秒内 patch 文件应
 *     出现 config 块，块缺失即「行未被激活」，不用再猜。
 *
 * 0.4.54（行激活修复 + llm 缺失时降级运行）：
 *   * 0.4.53 装机后行仍无 config 块、记忆不生效——apply 从未执行。
 *     cordis 的 inject 是**激活门槛**（Plugin 文档：“it only loads while
 *     all are available”）：声明的服务在本行作用域不可见时，行 fiber
 *     永远停在非 ACTIVE，apply 不跑、监听不挂、settings 不可写（写必抛
 *     “Plugin entry … is no longer configurable”）——全链路静默失效。
 *     `llm` 是全 bundle 唯一未被其他行证明可注入的服务。
 *   * 修法：inject 只留 settings/timer（本 bundle 多行已依赖、可注入有
 *     实证），监听器内按请求**懒读** `ctx.llm`：可用 → 行为与 0.4.53
 *     完全一致；不可用 → 降级运行（只记显式值、仅严格模式继承、不查
 *     能力/默认值），诊断记 `llm: false`，重启后从 config 块可辨模式。
 *   * 模块顶部加一行装载标记（module loaded @version）：重启后从日志
 *     直接区分「模块没加载（import 失败，日志有 loader 错误堆栈）/
 *     加载了但行没激活 / 激活了（随后看 config 块与诊断）」。
 */

// 纯决策核心（自包含；harness 直接 eval 跑矩阵）：
//   prevConfig          最近持久化 header 的 config（可为 null：首请求/刚恢复）
//   provider/model      当前解析出的路由
//   currentEffort       当前解析携带的 effort（可为 undefined）
//   rememberedEffort    该模型在本会话最近用过的 effort（可为 undefined）
//   carryOnDefault      当前 effort 是「新模型自己的默认值」时是否也继承
//   modelDefaultEffort  当前模型自己的 defaultEffort（可为 undefined）
// 返回要应用的 effort；null = 不动当前解析。
function decideCarry(prevConfig, provider, model, currentEffort, rememberedEffort, carryOnDefault, modelDefaultEffort) {
  if (!provider || !model) return null
  if (typeof rememberedEffort !== 'string' || rememberedEffort === '') return null
  // 同路由：核心循环已会继承上一个显式 effort（agent-loop prepareRequest），不动。
  if (prevConfig && prevConfig.provider === provider && prevConfig.model === model) return null
  // 新选择没带 effort（UI 没选）→ 直接继承。
  if (currentEffort === undefined) return rememberedEffort
  // 新选择带了显式 effort：只有「恰好是新模型自己的默认值」（UI 切模型自动
  // 填充）才算「用户没有真正选 effort」；其余是用户显式选择 → 让位。
  if (!carryOnDefault) return null
  if (currentEffort === rememberedEffort) return null
  if (modelDefaultEffort !== undefined && currentEffort === modelDefaultEffort) return rememberedEffort
  return null
}

export { decideCarry }

export const Config = z.object({
  /** 总开关（本行 Loader 行开关的镜像，行激活时读取）。 */
  enabled: z.boolean().default(true).volatile(),
  /**
   * 新选择只携带新模型自己的 defaultEffort（UI 切模型未选 effort 的自动填充
   * 场景，常见）时也继承。关 = 严格模式：仅当新选择完全不带 effort 才继承。
   * 行激活时读取，改它需要行重载。
   */
  carryOnDefault: z.boolean().default(true).volatile(),
  /**
   * 持久化记录：sessionId -> (provider/model -> effort)。host 半防抖写入，
   * 设置页可直接检视；最多 MAX_SESSIONS 个会话（最近使用顺序淘汰）。
   * 0.4.53：必须 .volatile()——rc.1 的 settings.update 只允许运行期写
   * volatile 字段，否则抛 `Config field "effortRecords" is not volatile`，
   * 每次 flush 失败 → 退避 → 停手，记忆永远不落盘。
   */
  effortRecords: z.dict(z.dict(z.string())).default({}).volatile(),
  /**
   * 诊断快照（0.4.43）：apply 标记 / 钩子计数 / 最近一次决策详情 / 最近异常。
   * 只写不读（程序侧），值类型不定，故用松散字典（schemastery 3.18 无
   * unknown，any 即对应物）。运行期写盘，同样必须 .volatile()。
   */
  diagnostics: z.dict(z.any()).default({}).volatile(),
})

// 本行要用的服务（0.4.54：llm 不再是硬依赖）：
//   settings （持久化记录 effortRecords + 隐藏自动设置页）
//   timer    （ctx.interval 防抖写盘）
// cordis 的 inject 是激活门槛（“it only loads while all are available”）——
// llm 若在本行作用域不可见，整行 fiber 永不 ACTIVE、apply 永不执行。故
// llm 改为监听器内按请求懒读 ctx.llm（见 getLlm 调用处）：可用则行为
// 不变，不可用则降级运行并记入诊断（llm: false）。
export const inject = ['settings', 'timer']

const ROW_ID = 'dsh-polish:keep-effort'
const MAX_SESSIONS = 100
const FLUSH_INTERVAL_MS = 5000
// 进诊断快照（只变一次）：patch 文件里的块属于哪一版代码，一眼可辨。
const VERSION = '0.4.98'

// 0.4.54 装载标记：每次模块装载一行（含 HMR 重载）。日志里有这行而
// patch 文件无 config 块 → 模块已装载、apply 未执行（行 fiber 激活问题）；
// 连这行都没有 → 模块 import 失败（日志里会有 loader 错误堆栈）。
console.warn('[dshp keep-effort] module loaded @' + VERSION)

export function apply(ctx, config) {
  var enabled = !config || config.enabled !== false
  var carryOnDefault = !config || config.carryOnDefault !== false

  // 隐藏自动设置页（记录字段不是表单输入项，不需要表单）。
  // 0.4.53：双层 fail-soft——页面策略纯属外观，注册或激活时的任何异常
  // （如 HMR 重载后 "already configured" 重复注册）都不得让 apply 中断，
  // 否则后面的监听挂不上，整个组件静默失效且无从查起。
  try {
    ctx.effect(function () {
      try { ctx.settings.configure({ auto: false }, ctx.fiber) } catch (error) {}
    })
  } catch (error) {}

  if (!enabled) return

  // sessionId -> Map(provider/model -> effort)；Map 插入序 = 最近使用序。
  var records = new Map()
  var dirty = false

  // 写盘失败预算（0.4.46 事故修复）：ctx.settings.update 会开启一次 HMR
  // 事务；插件重载期间事务未收尾时写入被拒（"HMR transactions cannot be
  // nested"）。旧实现失败后把脏标记置回、每 5s 重试并打一行日志 → 写盘
  // 风暴（实测 1054 次失败后 host 堆涨到 2.2GB，FATAL heap OOM，exit 134）。
  // 现在改为指数退避 + 次数上限 + 只记前几行；下一次真实路由变化重置预算。
  var flushFailures = 0
  var flushBlockedUntil = 0
  var flushParked = false
  var MAX_FLUSH_FAILURES = 20

  // 每请求都变的计数器只留内存，绝不进 diag——diag 一旦每请求都变，
  // 就会永远「脏」，于是每 5s 一次 settings 写盘（= 一次 HMR 事务），
  // 这正是上面风暴的持续供能端。
  var liveFired = 0
  var liveLastAt = 0

  // 诊断快照（0.4.43）：内容变化才置脏，随同一防抖写盘。值保持扁平
  // 字符串/数字/布尔，方便在插件页/patch 文件里直接读。Config 代理在
  // 某些 HMR 状态下会带可调用的 getter（如 diagnostics.get）；绝不能把
  // 函数原样放回 settings.update，否则 schemastery 会拒绝整个 Config 写入。
  function plainDiagnostics(input) {
    var out = {}
    if (!input || typeof input !== 'object') return out
    Object.keys(input).forEach(function (key) {
      var value = input[key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) out[key] = value
    })
    return out
  }
  var diag = plainDiagnostics(config && config.diagnostics)
  // 旧版本把 fired/at/flushError 这类每请求（或每次失败）都变的键写进了
  // diag；恢复时一律丢掉——留着它们 diag 永远「脏」，就成了每 5s 一次
  // settings 写盘（一次 HMR 事务）。
  delete diag.fired
  delete diag.at
  delete diag.flushError
  var diagDirty = false
  function noteDiag(patch) {
    var next = Object.assign({}, diag, patch)
    if (JSON.stringify(next) !== JSON.stringify(diag)) {
      diag = next
      diagDirty = true
    }
  }

  // 恢复持久化记录（best-effort：任何异常都从空开始，内存路径照常工作）。
  try {
    var persisted = config && config.effortRecords
    if (persisted && typeof persisted === 'object') {
      Object.keys(persisted).forEach(function (sessionId) {
        var byModel = persisted[sessionId]
        if (!byModel || typeof byModel !== 'object') return
        var m = new Map()
        Object.keys(byModel).forEach(function (key) {
          var e = byModel[key]
          if (typeof e === 'string' && e !== '') m.set(key, e)
        })
        if (m.size > 0) records.set(sessionId, m)
      })
    }
    while (records.size > MAX_SESSIONS) records.delete(records.keys().next().value)
    noteDiag({ restoredSessions: records.size })
  } catch (error) {
    noteDiag({ lastError: '恢复记录：' + (error && error.message ? error.message : String(error)) })
    console.warn('[dshp keep-effort] 恢复持久化记录失败：' + (error && error.message ? error.message : String(error)))
  }

  function record(sessionId, provider, model, effort) {
    if (!sessionId || !provider || !model) return
    if (typeof effort !== 'string' || effort === '') return
    var key = provider + '/' + model
    var byModel = records.get(sessionId)
    if (!byModel) byModel = new Map()
    if (byModel.get(key) === effort) return // 值未变 → 不触发写盘
    byModel.set(key, effort)
    records.delete(sessionId) // 刷新最近使用序
    records.set(sessionId, byModel)
    if (records.size > MAX_SESSIONS) records.delete(records.keys().next().value)
    dirty = true
    // 真实的路由变化 = 新的写盘机会：清掉失败预算，卡死的情况下也能自愈。
    flushFailures = 0
    flushBlockedUntil = 0
    flushParked = false
  }

  // 写盘失败的统一出口：保留脏标记（记录不能丢），但绝不立刻重试。
  function flushFailed(error) {
    dirty = true
    diagDirty = true
    flushFailures += 1
    if (flushFailures > MAX_FLUSH_FAILURES) {
      flushParked = true // 彻底停手：不再开任何一次 HMR 事务
      if (flushFailures === MAX_FLUSH_FAILURES + 1) {
        console.warn(
          '[dshp keep-effort] 持久化已连续失败 ' +
            MAX_FLUSH_FAILURES +
            ' 次，暂停写盘（记录保留在内存，下一次路由变化后重试）',
        )
      }
      return
    }
    var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(flushFailures - 1, 5)))
    flushBlockedUntil = Date.now() + delay
    if (flushFailures <= 3) {
      console.warn(
        '[dshp keep-effort] 持久化记录失败（第 ' +
          flushFailures +
          ' 次，' +
          delay +
          'ms 后再试）：' +
          (error && error.message ? error.message : String(error)),
      )
    }
  }

  function flush() {
    if (!dirty && !diagDirty) return
    if (flushParked) return // 已停手：等下一次真实路由变化再恢复
    if (Date.now() < flushBlockedUntil) return // 退避窗口内不碰 HMR 事务
    dirty = false
    diagDirty = false
    var obj = {}
    records.forEach(function (byModel, sessionId) {
      var inner = {}
      byModel.forEach(function (effort, key) {
        inner[key] = effort
      })
      obj[sessionId] = inner
    })
    var patch = { effortRecords: obj }
    if (Object.keys(diag).length > 0) patch.diagnostics = Object.assign({}, diag)
    var update
    try {
      update = ctx.settings.update(ROW_ID, patch)
    } catch (error) {
      flushFailed(error)
      return
    }
    // 0.4.53：不假设返回值是 thenable——沙箱守卫包装下若返回非 Promise，
    // 裸调 .then 会同步抛错，把每次 flush 都变成失败（退避→停手→永不写盘）。
    // 无异常即视为已受理；thenable 才挂成败回调。
    if (update && typeof update.then === 'function') {
      update.then(function () {
        flushFailures = 0
        flushBlockedUntil = 0
        flushParked = false
      }, flushFailed)
    } else {
      flushFailures = 0
      flushBlockedUntil = 0
      flushParked = false
    }
  }

  // 防抖写盘（行 fiber 收起时 interval 自动清理）；卸载时 best-effort 兜底。
  // 0.4.53：两者都 fail-soft——它们只服务持久化，失败时记录进诊断
  // （setupError），核心的内存继承（上方监听）不受影响。
  try {
    ctx.interval(flush, FLUSH_INTERVAL_MS)
  } catch (error) {
    noteDiag({ setupError: 'interval: ' + ((error && error.message) || error) })
    console.warn('[dshp keep-effort] interval 注册失败：' + ((error && error.message) || error))
  }
  try {
    ctx.effect(
      function () {
        return function () {
          try {
            flush()
          } catch (error) {}
        }
      },
      'dsh-polish: keep-effort flush on unload',
    )
  } catch (error) {
    noteDiag({ setupError: 'unload-effect: ' + ((error && error.message) || error) })
    console.warn('[dshp keep-effort] 卸载兜底 effect 注册失败：' + ((error && error.message) || error))
  }

  // (provider, model) 是否支持该 effort？resolveCallConfig 对不支持的显式
  // effort 在任何 provider I/O 前拒绝（“no clamping or aliasing is
  // performed”）；任何错误（含 provider 暂不可用）→ 视为不支持 → 静默跳过
  // 本次继承（fail-open，请求原样通过）。0.4.54：llm 按请求传入——本行作用
  // 域拿不到 llm 服务时 fail-open 视为支持（记录值本来就是同一路由上真实
  // 用过的值，回放到同一路由不会引入新的不兼容）。
  function supportsEffort(llm, provider, model, effort) {
    if (!llm) return Promise.resolve(true)
    return llm
      .resolveCallConfig({ provider: provider, model: model, reasoningEffort: effort })
      .then(function () {
        return true
      })
      .catch(function () {
        return false
      })
  }
  // 当前模型自己的 defaultEffort：resolveCallConfig 会物化默认值（与 UI 切
  // 模型自动填充同一机制：effective = requested ?? reasoning.defaultEffort）；
  // 模型没有声明默认值（或 llm 不可用）时返回 undefined。
  function defaultEffortOf(llm, provider, model) {
    if (!llm) return Promise.resolve(undefined)
    return llm
      .resolveCallConfig({ provider: provider, model: model })
      .then(function (cfg) {
        return cfg && cfg.reasoningEffort
      })
      .catch(function () {
        return undefined
      })
  }
  // 同一模型默认值极少变：按路由缓存物化结果（上限到了整体清空重来），
  // 避免每次无 effort 的请求都打一次能力查询。缓存失真的代价只是记忆值
  // 暂时等于旧默认——用户显式选择永远以记录覆盖，不会受影响。llm 不可用
  // 时不缓存（避免把「查不了」固化成「没有默认值」）。
  var defaultCache = new Map()
  function effectiveDefaultOf(llm, provider, model) {
    if (!llm) return Promise.resolve(undefined)
    var key = provider + '/' + model
    if (defaultCache.has(key)) return Promise.resolve(defaultCache.get(key))
    return defaultEffortOf(llm, provider, model).then(function (value) {
      if (defaultCache.size > 64) defaultCache.clear()
      defaultCache.set(key, value)
      return value
    })
  }

  // 组件核心：agent 作用域瀑布（append，在核心自己的 model-selection 监听
  // 之后跑——那一个在 agent 创建时注册）。payload 必带 agent（dsh-scope
  // invariant 保证）；agent.session.requestHeader() 取最近持久化请求头。
  ctx.on('agent/request', async (payload, next) => {
    var resolved = await next() // 错误自然上抛，绝不吞
    try {
      liveFired += 1
      liveLastAt = Date.now()
      // 「监听有没有被调到」只需一个一次性的时间戳：firstFiredAt 只变一次，
      // 不会让 diag 永远脏。
      if (!diag.firstFiredAt) noteDiag({ firstFiredAt: liveLastAt })
      // 0.4.54：llm 懒读（不再进 inject——它是激活门槛，拿不到时整行不
      // 激活）。拿不到 → null → 降级运行；可用性进诊断一次，重启后从
      // config 块的 llm 字段可辨当时处于哪种模式。
      var llm = null
      try {
        llm = ctx.llm
      } catch (error) {
        llm = null
      }
      if (diag.llm === undefined) noteDiag({ llm: !!llm })
      var agent = payload && payload.agent
      if (!agent || !agent.session) {
        noteDiag({ lastDecision: 'no-agent' })
        return resolved
      }
      var provider = resolved && resolved.provider
      var model = resolved && resolved.model
      if (!provider || !model) {
        noteDiag({ lastDecision: 'no-route' })
        return resolved
      }
      var sessionId = agent.session.id
      var prevConfig
      try {
        var header = agent.session.requestHeader()
        prevConfig = header && header.config
      } catch (error) {
        prevConfig = null
      }
      var finalEffort = resolved.reasoningEffort
      var sameRoute = !!(prevConfig && prevConfig.provider === provider && prevConfig.model === model)
      var byModel = records.get(sessionId)
      var remembered = byModel ? byModel.get(provider + '/' + model) : undefined
      var current = resolved.reasoningEffort
      var modelDefault = undefined
      var supported = undefined
      var decision = 'none'
      if (!sameRoute) {
        if (remembered !== undefined) {
          // 只有「当前值有、且与记忆不同」时才需要查新模型自己的默认值；
          // 其余分支用不到（decideCarry 在用到之前就已返回）。
          if (current !== undefined && current !== remembered) modelDefault = await effectiveDefaultOf(llm, provider, model)
          var carry = decideCarry(prevConfig, provider, model, current, remembered, carryOnDefault, modelDefault)
          if (carry !== null) {
            supported = await supportsEffort(llm, provider, model, carry)
            if (supported) {
              finalEffort = carry
              decision = 'carry:' + carry
            } else {
              decision = 'unsupported:' + carry
            }
          } else {
            decision = current === undefined ? 'no-carry(undefined)' : 'explicit-kept'
          }
        } else {
          decision = 'no-remember'
        }
      } else {
        decision = 'same-route'
      }
      // 记录本次请求实际携带的值（继承决策之后）。瀑布 config 常常不带
      // effort（模型默认值在 prepareCall 里才物化）——用物化默认补齐，记忆
      // 才能在「UI 切模型未选 effort」的常见路径上累积。
      var recordedEffort = finalEffort
      if (recordedEffort === undefined) recordedEffort = await effectiveDefaultOf(llm, provider, model)
      record(sessionId, provider, model, recordedEffort)
      noteDiag({
        lastRoute: provider + '/' + model,
        lastPrev: prevConfig ? prevConfig.provider + '/' + prevConfig.model : '',
        lastCurrent: current === undefined ? '' : String(current),
        lastRemembered: remembered === undefined ? '' : String(remembered),
        lastModelDefault: modelDefault === undefined ? '' : String(modelDefault),
        lastSupported: supported,
        lastDecision: decision,
        lastSession: String(sessionId).slice(-12),
      })
      if (finalEffort === resolved.reasoningEffort) return resolved
      return Object.assign({}, resolved, { reasoningEffort: finalEffort })
    } catch (error) {
      noteDiag({ lastError: String((error && error.message) || error) })
      console.warn('[dshp keep-effort] 继承决策异常，原样放行：' + (error && error.message ? error.message : String(error)))
      return resolved
    }
  })

  // apply 走到这里 = 监听已挂上。标记进诊断：重启后 firstFiredAt 缺失就是
  // 投递问题（监听没被调到），有值则看 lastDecision 链路。
  noteDiag({ appliedAt: Date.now(), enabled: true, version: VERSION })
  // 0.4.53：立即写盘（不等 5s 防抖）——apply 成功与否应在行激活后几秒内
  // 就能从 patch 文件的 config 块（含 version/setupError）直接读出；
  // 块仍缺失 = 行根本没被 Loader 激活，不用再猜。
  try {
    flush()
  } catch (error) {}
}
