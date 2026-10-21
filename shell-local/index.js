import z from '@deepseek-ai/schemastery'

/**
 * Shell 本地模式 / opencode 模式（组件 H）：让内建沙箱 shell 执行器绕过 OS
 * 级沙箱包装，命令以 harness 进程的文件权限直接运行——与 OpenCode 跑 shell
 * 的行为一致。
 *
 * —— 为什么"借道"而不是换掉 ctx.shell ——
 *   DSH 的 ctx.shell 只允许一个实现：加载第二个会在挂载时抛错（cordis 标准
 *   duplicate-service 行为），而 profile 层的换法（禁用 pwsh-sandbox + 插入
 *   local 执行器）是两条静态行，无法用一个开关联动、DSH 更新改条目 id 还会
 *   直接失配。本组件不注册任何新执行器，只在运行时接管现有执行器的
 *   execute()：SandboxPwshExecutor.execute 自带 `policy.mode ===
 *   'danger-full-access'` 分支（跳过 confine、直接走基类 PwshLocalExecutor
 *   的非约束路径——与 profile shim 的执行路径逐字节相同）。这里只把传入
 *   spec 的 policy mode 改写成 danger-full-access 再调原方法；`sandboxMode`
 *   getter 原样保留，权限预设、工具描述、审批链路都不变。
 *
 * —— 效果边界（与 profile shim 完全一致）——
 *   * pwsh 命令本身（含其派生的 python/node/git）不受 OS 沙箱约束——这是
 *     用户明确要求的"半开放"权限；
 *   * 文件工具层（write/edit 走的 dsh-fs-sandbox）不受影响，仍按 workspace
 *     围界；
 *   * 行关闭 / 设置关闭 / 插件卸载时恢复原 execute，系统沙箱照旧（可恢复）。
 *
 * —— 开关层级 ——
 *   行开关 = 总开关（本行在 bundle patch 里默认 disabled）。`enabled` 是
 *   volatile 实时细开关：行启用后默认生效，在详情页关掉不必重启——Host
 *   每 1.5s 轮询本行设置，恢复执行器。
 *
 * —— 失败方向 ——
 *   任何异常都回落到系统沙箱（安全方向）并停止重试；执行器不再是沙箱型
 *   （不暴露 sandboxMode，例如 profile 已换成 local shim）时本组件是空操作。
 */
export const Config = z.object({
  /** 实时开关（volatile）：行服务中时默认生效；关掉立即恢复系统沙箱，无需
   *  重启。总开关是行开关（本行默认 disabled）。 */
  enabled: z.boolean().default(true).volatile(),
})

var NS = 'dsh-polish:shell-local'
var POLL_MS = 1500
var MARK = '__dshpShellLocal'

export function apply(ctx, config) {
  // 隐藏自动设置页：设置入口只在 插件 → dsh-polish → shell-local 详情页。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  ctx.inject(['shell', 'settings', 'timer'], (child) => {
    var executor = child.shell
    // 只对"沙箱型执行器"生效（暴露 sandboxMode 能力事实 + execute 方法）。
    // 部署已跑 local 执行器（或没有 shell）时：什么都不做，避免无谓包装。
    if (!executor || typeof executor.sandboxMode !== 'string' || typeof executor.execute !== 'function') return

    var original = executor.execute
    var active = false
    var failed = false

    function activate() {
      if (active) return
      var wrapper = function (spec) {
        if (spec && spec.sandboxPolicy && typeof spec.sandboxPolicy === 'object' && spec.sandboxPolicy.mode !== 'danger-full-access') {
          return original.call(this, { ...spec, sandboxPolicy: { ...spec.sandboxPolicy, mode: 'danger-full-access' } })
        }
        return original.call(this, spec)
      }
      wrapper[MARK] = true
      executor.execute = wrapper
      active = true
    }

    function deactivate() {
      if (!active) return
      active = false
      // 只删自己装的包装（own property），落回原型上的原方法。
      if (executor.execute && executor.execute[MARK]) delete executor.execute
    }

    // 读本行 volatile 设置的当前值（host 侧同步读，mode-switch 同范式）。
    function desiredEnabled() {
      try {
        var rows = child.settings.describe()
        for (var i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].ns === NS && rows[i].value) return rows[i].value.enabled !== false
        }
      } catch (error) {}
      return false
    }

    function poll() {
      if (failed) return
      try {
        if (desiredEnabled()) activate()
        else deactivate()
      } catch (error) {
        // 激活路径异常：回落系统沙箱并停止重试（安全方向）。
        try {
          deactivate()
        } catch (e2) {}
        failed = true
        console.warn('[dshp shell-local] 接管失败，保持系统沙箱：', error && error.message ? error.message : error)
      }
    }

    poll()
    var interval = typeof child.interval === 'function' ? child.interval(poll, POLL_MS) : null
    child.effect(
      function () {
        return function () {
          try {
            if (interval) interval.dispose()
          } catch (error) {}
          try {
            deactivate()
          } catch (error) {}
        }
      },
      'dsh-polish: shell-local cleanup',
    )
  })
}
