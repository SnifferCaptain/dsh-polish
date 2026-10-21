import z from '@deepseek-ai/schemastery'

/**
 * 完成/待处理提醒（组件 E）：当当前会话「一轮任务完成」或「模型在等你
 * （审批 / 计划确认 / 提问）」时，可选地播放提示音 + 弹一条系统通知。
 *
 * 四个开关相互独立、默认全关：
 *   - completeSound / completeNotify：任务完成时（turn 以 completed 结束）
 *   - attentionSound / attentionNotify：需要处理时（approval / plan-review / question）
 *
 * 这里只挂 volatile 的开关值（浏览器半侧经 ctx.configForms 读同一份）；`auto: false`
 * 表示不在「设置」侧边栏自动生成页面——设置入口只在 插件 → dsh-polish → 完成/待处理提醒
 * 的详情页上。检测（会话事件轮询）、合成提示音（Web Audio）、系统通知
 * （Web Notification）都在浏览器半侧完成，所以本组件像其它纯 client 组件一样，
 * 刷新即可生效，不需要重启 Host。
 */
export const Config = z.object({
  /** 任务完成时播放提示音。 */
  completeSound: z.boolean().default(false).volatile(),
  /** 任务完成时弹系统通知。 */
  completeNotify: z.boolean().default(false).volatile(),
  /** 需要处理（审批/计划/提问）时播放提示音。 */
  attentionSound: z.boolean().default(false).volatile(),
  /** 需要处理（审批/计划/提问）时弹系统通知。 */
  attentionNotify: z.boolean().default(false).volatile(),
})

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
