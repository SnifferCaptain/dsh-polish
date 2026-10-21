import z from '@deepseek-ai/schemastery'

/**
 * 思考渲染（组件 A）：把"思考过程"行渲染成可滚动的 N 行预览，
 * 并在思考结束后自动收起。
 *
 * 这里的 `Config` 只承载**可即时生效（volatile）**的设置项：DSH 的
 * 设置服务会为带 volatile 字段的条目生成表单，命名空间就是本行的
 * 条目 id（`dsh-polish:thinking-renderer`），浏览器半侧再通过
 * `ctx.configForms` 读到同一份值。
 *
 * `auto: false` 表示不在「设置」侧边栏里自动生成页面——本组件的
 * 设置入口只出现在 插件 → dsh-polish → 思考渲染 的详情页上。
 */
export const Config = z.object({
  /** 思考进行中时预览区显示的行数。 */
  lines: z.natural().min(1).max(20).default(4).volatile(),
  /** 思考结束后自动收起的过渡时长（毫秒），0 表示立即收起。 */
  collapseMs: z.natural().max(2000).default(140).volatile(),
  /** 思考进行中是否自动展开该行。 */
  autoOpen: z.boolean().default(true).volatile(),
  /** 思考进行中、预览展开时是否在标题行显示已用时间（秒）。 */
  showTime: z.boolean().default(true).volatile(),
  /**
   * 预览窗口换行/新增内容时，滑到最新行所花的时间（毫秒）。
   * 0 = 即时跳到底部；>0 = 实时 rAF 驱动的指数逼近（EMA/pure pursuit），
   * 约 t 毫秒内收敛，流式持续时柔顺拖尾，与流式帧率无关。
   */
  followMs: z.natural().max(2000).default(300).volatile(),
})

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
