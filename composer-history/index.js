import z from '@deepseek-ai/schemastery'

/**
 * 上箭头召回（组件 C）：输入框为空时按 ↑ 把本会话最近一条「用户」消息
 * 填进输入框；召回（未改动）态里 ↑ 继续往更早翻、↓ 往回翻，一旦改动即退出
 * （文本变普通草稿），Esc 清空，Enter 照旧发送。
 *
 * 这里的 `Config` 只承载可即时生效（volatile）的设置项，命名空间即本行条目
 * id（`dsh-polish:composer-history`），浏览器半侧经 `ctx.configForms` 读到
 * 同一份值。`auto: false` 表示不在「设置」侧边栏自动生成页面——设置入口只
 * 出现在 插件 → dsh-polish → 上箭头召回 的详情页上。
 */
export const Config = z.object({
  /** 是否启用上箭头召回本会话的用户消息。 */
  enabled: z.boolean().default(true).volatile(),
})

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
