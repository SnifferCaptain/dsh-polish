import z from '@deepseek-ai/schemastery'

/**
 * 切换会话模式（组件 F）：在会话「...」菜单里加一组「切换模式」项，
 * 把一个会话切到任意 agent 预设（内建 + 用户自定义）。
 *
 * 为什么 DSH 自带切不了：内建的 `select` 方法对「已开聊的会话」硬拦截
 *   （throw "This session has already started"）——它只给空白会话开放，
 * 所以 UI 一直切不了已进行的会话。底层真正做切换的是
 *   `agentPresets.recompose(agent.ctx, preset)`：mount → bind → rebind 作用域
 * 父 + collect 旧 generation（**干净替换**成那组工具，旧的被清掉），且**没有
 * blank 检查**（它的文档明说「caller 自己负责 blank 检查」）。这里直接调它，
 * 就能给正在进行的会话换预设 = 换成那组工具（会破该会话的 prompt 缓存，正是
 * 「总比换不了模式、调不到工具强」的预期取舍）。
 *
 * —— host <-> client 通道（volatile 设置，和 timer 的时钟图标同范式）——
 *   client 在「...」菜单列出所有预设（remote.agentPresets.list()）；用户点某个
 * 预设 → client 写本行 volatile 设置 `dsh-polish:mode-switch: { request:
 * {sessionId, preset, nonce} }`；本 host 半每 1s 轮询 `ctx.settings.describe()`，
 * 看到新 nonce 后先取 live agent；DSH 重启后若会话是 cold，则用
 * `sessionController.resolveAgent(sessionId)` 恢复，再 `recompose(agent.ctx, preset)`，
 * 写回 `{ result: {nonce, ok, error} }`；client 轮询读到 result（打日志），用户从
 * 会话顶部状态栏看新模式。
 *
 * —— 与 timer 的极简排除联动 ——
 *   `recompose` 只 emit `tools/change`、**不** append `agent-preset/selected`
 * （只有 `select` 会 append），所以单纯 recompose 不会触发 timer（0.4.20）里
 * 监听 `agent-preset/selected` 的按 agent 重算。这里在 recompose 成功后**手动
 * append `agent-preset/selected`**：既把这次切换如实记进会话日志，又让 timer 的
 * 既有监听器重算 → 一个被切到 minimal 的会话会随之摘掉 timer 工具（保持
 * 「极简=仅终端工具」的一致性）。
 *
 * 切的是当前会话的运行时作用域，并在成功后追加 `agent-preset/selected` 作为 durable 记录；
 * 行关/重启不会把已处理的历史记录抹掉，但本行的轮询 + 菜单会随 Loader 状态变化。
 */
export const Config = z.object({
  /** 总开关（镜像本行 Loader 行开关，在行激活时读取）。 */
  enabled: z.boolean().default(true).volatile(),
  /** 运行时通道（volatile）：client 写的切换请求。host 轮询读取、处理后不主动清。
   *  schemastery 没有 .optional()——对象字段靠 .default({}) 提供「缺省为空」的回退，
   *  这样命名空间里还没有 request/result 时校验通过（值 = {}）。 */
  request: z
    .object({
      sessionId: z.string(),
      preset: z.string(),
      nonce: z.number(),
      action: z.string().default('switch'),
    })
    .default({})
    .volatile(),
  /** 运行时通道（volatile）：host 写回处理结果及可读取的当前预设。 */
  result: z
    .object({
      nonce: z.number(),
      ok: z.boolean(),
      error: z.string(),
      sessionId: z.string().default(''),
      currentPreset: z.string().default(''),
    })
    .default({})
    .volatile(),
})

// settings（轮询读 describe + 写回 update）、agents（先取 live agent）、
// sessionController（cold 会话按需 resume）、agentPresets（recompose 切换）、
// timer（ctx.interval 轮询）。
export const inject = ['settings', 'agents', 'sessionController', 'agentPresets', 'timer']

export function apply(ctx, config) {
  var enabled = !config || config.enabled !== false

  // 隐藏自动设置页：本行没有用户可见的设置表单（总开关 = Loader 行开关）。
  ctx.effect(function () {
    ctx.settings.configure({ auto: false }, ctx.fiber)
  })

  if (!enabled) return

  var NS = 'dsh-polish:mode-switch'
  var lastHandledNonce = 0
  var lastWrittenNonce = 0
  var busy = false

  // 读本行 volatile 设置的当前值（host 侧同步读；返回 [{ns, revision, value}]）。
  function findValue() {
    try {
      var list = ctx.settings.describe()
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].ns === NS) return list[i].value ? list[i].value : null
      }
    } catch (error) {}
    return null
  }

  // 写回处理结果（client 轮询读取）。update 是打补丁：只写 result，保留 request。
  function writeResult(result) {
    if (result && typeof result.nonce === 'number') {
      if (result.nonce < lastHandledNonce || result.nonce < lastWrittenNonce) return
      lastWrittenNonce = result.nonce
    }
    try {
      var update = ctx.settings.update(NS, { result: result })
      if (update && typeof update.catch === 'function') update.catch(function () {})
    } catch (error) {}
  }

  function errorText(error, fallback) {
    if (error && typeof error.message === 'string' && error.message) return error.message
    if (error && error.error && typeof error.error.message === 'string' && error.error.message) return error.error.message
    if (error && typeof error.code === 'string' && error.code) return error.code
    if (error !== undefined && error !== null && String(error)) return String(error)
    return fallback
  }

  function settle(value, onSuccess, onFailure) {
    if (!value || typeof value.then !== 'function') {
      onSuccess(value)
      return
    }
    try {
      // Use the native two-argument form and also observe a returned catchable
      // chain. This handles both real Promises and Cordis-style thenables.
      var chain = value.then(onSuccess, onFailure)
      if (chain && typeof chain.catch === 'function') chain.catch(onFailure)
    } catch (error) {
      onFailure(error)
    }
  }

  function finishFailure(request, error, fallback) {
    busy = false
    var msg = errorText(error, fallback)
    console.warn('[dshp mode-switch] 会话 ' + request.sessionId + ' 切换失败：' + msg)
    writeResult({ nonce: request.nonce, ok: false, error: msg, sessionId: request.sessionId, currentPreset: '' })
  }

  function finishSuccess(request, agent) {
    try {
      // 记录这次切换 + 触发 timer 的按 agent 重算（见文件头「与 timer 联动」）。
      if (agent && agent.session && typeof agent.session.append === 'function') {
        agent.session.append('agent-preset/selected', { agentPreset: request.preset })
      }
      busy = false
      console.warn('[dshp mode-switch] 会话 ' + request.sessionId + ' 已切换到预设 ' + request.preset)
      writeResult({ nonce: request.nonce, ok: true, error: '', sessionId: request.sessionId, currentPreset: request.preset })
    } catch (error) {
      finishFailure(request, error, '切换完成但写入会话记录失败')
    }
  }

  function recompose(request, agent) {
    if (!agent || !agent.ctx) {
      finishFailure(request, null, '找不到该会话（可能已关闭）')
      return
    }
    try {
      var result = ctx.agentPresets.recompose(agent.ctx, request.preset)
      settle(
        result,
        function () { finishSuccess(request, agent) },
        function (error) { finishFailure(request, error, '预设切换失败') },
      )
    } catch (error) {
      finishFailure(request, error, '预设切换失败')
    }
  }

  function resolveAgent(request) {
    var agent = null
    try {
      agent = ctx.agents.get(request.sessionId)
    } catch (error) {}
    if (agent && agent.ctx) {
      recompose(request, agent)
      return
    }

    // A visible history row can outlive its in-memory Agent after a full DSH
    // restart. ResolveAgent resumes that cold session and returns { agent } or
    // { error }; do not report a false "closed" result before trying it.
    var controller = ctx.sessionController
    if (!controller || typeof controller.resolveAgent !== 'function') {
      finishFailure(request, null, '找不到该会话（可能已关闭）')
      return
    }
    try {
      var pending = controller.resolveAgent(request.sessionId)
      settle(
        pending,
        function (resolved) {
          var resumed = resolved && resolved.agent ? resolved.agent : resolved && resolved.ctx ? resolved : null
          if (!resumed) {
            finishFailure(request, resolved && resolved.error ? resolved.error : resolved, '无法恢复该会话')
            return
          }
          recompose(request, resumed)
        },
        function (error) { finishFailure(request, error, '无法恢复该会话') },
      )
    } catch (error) {
      finishFailure(request, error, '无法恢复该会话')
    }
  }

  function resolveCurrentPreset(request) {
    var agent = null
    try { agent = ctx.agents.get(request.sessionId) } catch (error) {}
    if (!agent || !agent.ctx) {
      writeResult({ nonce: request.nonce, ok: false, error: '当前会话未运行，暂时无法读取模式', sessionId: request.sessionId, currentPreset: '' })
      return
    }
    try {
      var preset = ctx.agentPresets.composedPreset(agent.ctx)
      writeResult({ nonce: request.nonce, ok: true, error: '', sessionId: request.sessionId, currentPreset: typeof preset === 'string' ? preset : '' })
    } catch (error) {
      writeResult({ nonce: request.nonce, ok: false, error: errorText(error, '读取当前模式失败'), sessionId: request.sessionId, currentPreset: '' })
    }
  }

  function poll() {
    if (busy) return
    var value = findValue()
    var request = value && value.request ? value.request : null
    if (!request || typeof request.nonce !== 'number' || request.nonce <= lastHandledNonce) return
    lastHandledNonce = request.nonce
    if (request.action === 'current') {
      resolveCurrentPreset(request)
      return
    }
    busy = true
    resolveAgent(request)
  }

  poll()
  var interval = ctx.interval(poll, 1000)
  ctx.effect(
    function () {
      return function () {
        try {
          interval.dispose()
        } catch (error) {}
      }
    },
    'dsh-polish: mode-switch poll cleanup',
  )
}
