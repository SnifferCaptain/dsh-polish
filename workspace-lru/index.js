import z from '@deepseek-ai/schemastery'

/**
 * 工作区 LRU 排序（组件 D）：侧边栏按「项目」分组保留不变，但把各分组按其
 * 所含会话的最近更新时间（LRU）重排——最近用的分组置顶。浏览器半侧轮询
 * workspaces / sessions 两个 store，算出每个工作区的 LRU，再用 DSH 自带的
 * 持久化重排（remote.workspace.insertBefore）落地，交给原生渲染，不碰 DOM。
 *
 * 这里的 `Config` 只承载可即时生效（volatile）的设置项，命名空间即本行条目
 * id（`dsh-polish:workspace-lru`）。`auto: false` 表示设置入口只出现在
 * 插件 → dsh-polish → 工作区 LRU 排序 的详情页上。
 */
export const Config = z.object({
  /** 是否按会话最近更新时间对工作区分组做 LRU 重排。 */
  enabled: z.boolean().default(true).volatile(),
  /** 独立子开关（默认开启）：会话头部的子智能体目录按各子会话最近活动时间
   *  （byId[child].updatedAt，无活动时回退目录条目的 createdAt）就地重排为
   *  LRU 顺序。与 `enabled` 相互独立——工作区重排关闭时子智能体重排仍可单独
   *  开启；行开关仍是两者的总闸。关闭后恢复 DSH 原生的创建时间顺序。 */
  subagent: z.boolean().default(true).volatile(),
})

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
