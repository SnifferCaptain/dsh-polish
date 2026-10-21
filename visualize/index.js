import z from '@deepseek-ai/schemastery'

/**
 * 聊天可视化（组件 I）：把聊天消息里的 ```svg / ```mermaid 代码围栏渲染成图。
 *
 * —— 架构 ——
 *   本组件的 Host 半侧只有两件事：声明 volatile 配置 + 隐藏自动设置页。
 *   全部行为在浏览器半侧（lib/client.js 的 visualize 段）：DOM 级增强
 *   `div.md-code-block > pre > code`，svg 过严格消毒后走
 *   `<img data:image/svg+xml>` 静态光栅化；mermaid 首次见到才懒加载
 *   包内 chunk（client.mermaid.js，官方 11.17.0 IIFE 构建，无 CDN），
 *   串行队列 + requestIdleCallback 渲染。Host 不参与任何渲染决策。
 *
 * —— 开关层级 ——
 *   行开关 = 总开关（本行在 bundle patch 里默认 disabled——稳定前不启用）。
 *   `svg` / `mermaid` 是两个 volatile 实时子开关：行启用后两者默认生效，
 *   在 插件 → dsh-polish → visualize 详情页里关掉任意一个立即停掉对应
 *   渲染（客户端每次设置同步时重读），无需重启。
 *
 * —— 失败方向 ——
 *   任何渲染异常都停在原代码块（错误文案显示在卡片工具条），绝不破坏
 *   DSH 的消息 UI；mermaid chunk 加载失败只影响 mermaid 块，svg 不受牵连。
 */
export const Config = z.object({
  /** 渲染 ```svg 围栏（volatile 实时子开关，默认开）。 */
  svg: z.boolean().default(true).volatile(),
  /** 渲染 ```mermaid 围栏（volatile 实时子开关，默认开）。 */
  mermaid: z.boolean().default(true).volatile(),
})

export function apply(ctx) {
  // 隐藏自动设置页：设置入口只在 插件 → dsh-polish → visualize 详情页。
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
