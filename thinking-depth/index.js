import z from '@deepseek-ai/schemastery'

/**
 * 思考深度（组件 B）：输入框工具行上的思考强度滑条。
 *
 * 档位**不在这里**：档位来自模型自己声明的 reasoning efforts
 * （`session.modelCatalog()` 里每个模型的 `reasoning.efforts`），写入走
 * `session.selectModel`。所以本命名空间只承载"怎么显示"：
 *
 *   - 是否在输入框工具行显示该控件；
 *   - 档位色阶（浅蓝 → 深蓝 → 紫 / 品牌蓝 / 灰阶）；
 *   - 是否在滑条上方显示当前档位名。
 *
 * 字段全部 volatile：改完立即生效，命名空间就是本行 id
 * （`dsh-polish:thinking-depth`）；`auto: false` 表示不占用「设置」侧边栏。
 */
export const Config = z.object({
  /** 是否在输入框工具行显示思考强度控件。 */
  showInComposer: z.boolean().default(true).volatile(),
  /** 档位色阶：blue-purple / brand / mono。 */
  palette: z.string().default('blue-purple').volatile(),
  /** 是否在滑条上方显示当前档位名。 */
  labels: z.boolean().default(true).volatile(),
})

export function apply(ctx) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
}
