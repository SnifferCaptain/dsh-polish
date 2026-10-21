# dsh-polish

DSH 的一组可独立开关的增强组件：思考展示、会话操作、提示词、技能、通知和会话瘦身。组件不改 DSH 核心源码，入口由 `cordis.patch.yml` 注册。

## 组件状态

> `✔` 可用；`❌` 已知不可用；`⚠` 有条件、风险或等待验证；`—` 已停止维护或默认停用。

| 组件 | 状态 | 用途 | 已知风险 / Bug | 更新计划 |
| --- | :---: | --- | --- | --- |
| `thinking-renderer` | ✔ | 展示思考流、耗时和自动跟随 | 依赖 DSH 思考行的 DOM / data 属性 | 随 DSH DOM 契约变化维护 |
| `thinking-depth` | ✔ | 把自带推理等级改成滑条 | 只对声明了 `reasoning` 的模型显示；依赖自带菜单结构 | 优先保持对官方面板的低侵入 |
| `composer-history` | ✔ | 在输入框召回上一条消息 | 依赖 composer slot | 仅修兼容性问题 |
| `workspace-lru` | ✔ | 工作区切换、最近使用排序 | 需要工作区服务和本地状态 | 0.4.90 修掉重排竞态（存储更新即重排，不再看展开态）；继续减少对页面结构的依赖 |
| `timer` | — | 提供定时器相关能力 | 官方自动化任务已覆盖该场景；本组件已默认停用 | **停止维护**，不再做兼容开发；需要时使用 DSH 官方自动化任务 |
| `notify` | ✔ | 提供通知提示 | 系统通知仍受桌面 / 浏览器权限影响；提示音不依赖通知权限 | 当前环境已验证可用；继续保持 best-effort，不扩大权限 |
| `mode-switch` | ✔ | 在会话菜单切换 `standard`、`ptc`、`cordis`、`minimal` | cold session 切换需要先恢复 Agent；失败必须保留原模式 | 继续补 preset 切换回归测试 |
| `skill-loader` | ✔ | 从个人 skills 目录加载 `SKILL.md` | 与官方 skill filesystem 同时扫描会重复注册 | 维持根目录去重和字面量触发 |
| `prompts` | ✔ | 按 agent preset 管理系统提示词和工具提示 | `minimal` 的 persona 是 `complete`（它的整份提示词就是 persona 本身），选自定义模板会**顶替**它——界面已写明 | 0.4.91–0.4.94：每模式内置模板直接取自 DSH 自己的 preset 定义（无需探测）；`replace` 改为同名顶替 persona 槽位，两个 complete section 的冲突在结构上消失；去掉全局注册，跨模式泄漏消失 |
| `shell-local` | ✔ | 提供本地 shell 能力 | 当前 DSH 可正常使用；组件编写前已有独立补丁，因此无法把全部现状完全归因于本组件，权限和沙箱边界仍需保留 | 维持当前可用状态，只修明确的安全边界，不增加隐式执行 |
| `visualize` | ✔ | 把聊天中的 ```mermaid / ```svg 代码围栏渲染成图 | 当前已验证 Mermaid 与 SVG 均可渲染；SVG 会经过严格消毒；Mermaid 不走 CDN | 上游 Mermaid **11.17.0** 已随仓库 vendored：`vendor/mermaid-11.17.0.min.js`；上游项目：[mermaid-js/mermaid](https://github.com/mermaid-js/mermaid)。按上游版本升级时重新构建并回归验证 |
| `keep-effort` | ✔ | 保留会话推理强度 | 依赖模型选择投影；持久化失败不能影响主会话 | 当前环境已验证可用；后续只维护模型选择兼容和失败回滚 |
| `session-slim` | ✔ | 总结旧会话并创建可见的新会话 | 必须先确认 lineage、工作区和侧栏可见性；任一步不确定都不归档旧会话 | 0.4.90 修掉 replacement 不出现；0.4.91 修掉 provider 余额不足导致 summarizing 失败；0.4.97 修掉 replacement 未挂载 preset 工具（创建时补同模式 setup / preset mount，并记录工具数 old → new），均已通过回归验证 |

## 当前实现重点

### 提示词

- 模板库固定包含 4 个只读内置项：`standard 默认模板`、`ptc 默认模板`、`cordis 默认模板`、`minimal 默认模板`；自定义模板另列，旧数据里的 `default` 会按当前模式归一化为对应的 `builtin:<mode>`。
- 每个 mode 的默认模板是自己的内置项（单射 `mode -> builtin:<mode>`）；preset 识别来自装配 Agent 会话 header 的 `agentPreset`（创建时按 preset 选择写入、持久化在 jsonl），而不是全局当前选项。`composedPreset(context.scope)` 因 `context.scope` 是 agent（scope key，非 context）恒返回 undefined，不能作预览分桶依据，故仅留作 fallback。这样 `minimal` 不会误显示 `standard` 的预览。
- `minimal` 的默认系统提示词由 DSH preset 自己提供，带 `complete: true`。dsh-polish **不再注册第二个 complete section**：「整份替换」改为**同名顶替** persona 槽位（`deployment:persona-prefix`），DSH 的合并规则是「同名 section 由更近的作用域顶替」，所以全场只剩一个 complete section，`multiple complete prompt sections` 这类崩溃在结构上不可能再发生。
- 四个内置模板的**内容**直接来自 DSH 自己的 preset 定义：宿主读 `agentPresets.readDocument()` 取 persona 行，并用该模式**正在跑的** agent 的 generation scope 装配出整份提示词（不调模型、不新建 agent、不需要任何一次「探测」）。内容经设置行与 `GET /api/dshp/prompts/builtins` 两条通道发布，页面挂载即取。
- 每个 agent 一份注册（没有全局注册）——否则选了内置模板的 agent 会继承 standard 的自定义文本，泄漏到别的模式。
- 工具提示只改写描述文本，不改变工具参数或执行行为。列表来源是模型装配时实际看到的工具并集；插件重载后会从已保存的并集恢复。

### 会话瘦身

事务顺序是：

1. 读取可见会话和完整 lineage；
2. 总结原会话；
3. 创建并写入新会话；
4. 重新挂回 canonical workspace，继承模型和 effort；
5. seed 写入一轮已完成的 turn，使 `sessionListMetadata.blank = false`；保持新 Agent 存活（live idle，与 DSH fork 同形），确认新会话是 live agent、未 blank 且出现在 `sessionController.list()`；
6. 只有确认 replacement 真正满足侧栏可见条件后，才归档子代理和旧主会话。

任何创建、挂载、模型继承、改名、停止或可见性检查失败，都会留下阶段、错误码和副作用记录，旧主会话不应被静默移除。session-slim 只显示 DSH 正常侧栏可见的 session，不把完整持久化语料中的孤儿记录当成可操作会话。

0.4.97 起，replacement 创建时会复用该模式的 preset setup，把 preset 的工具挂到新 agent 作用域；任务结果会记录工具数 `旧 → 新`，若新会话工具数异常为 0 会给出警告。

compact 模型路线：页面上的选择**改完即生效**（不再需要另点保存），页面直接写明「瘦身使用：provider/model」——「测试调用」与瘦身因此永远是同一条路线。调用失败时错误里带实际路线；若失败是 provider 侧（余额 / 鉴权 / 限流），自动回退到**该会话自己最后用过的路线**并在任务详情里写明，只有回退也不可用才判失败。

## 版本

- 当前：`0.4.97`（功能修复版本；tag `v0.4.97`，提交 `4bcd6fe`）。
- 发布流程见下方「发布前检查」；产物是 `release/dsh-polish-<version>.tgz`，直接 `install_bundle` 安装，不需要先 remove。
- v1.0.0 的门槛见上方「v1.0.0 发布前的待办」。

## 安装与更新

在包目录执行：

```powershell
npm run build:client
npm run check:client
node test/harness.cjs
npm pack --pack-destination release
```

然后直接安装生成的 `release/dsh-polish-<version>.tgz`。更新已安装 bundle 时直接 `install_bundle`，不需要先 remove；安装结果中的 `application: applied` 才表示已应用。Host 侧更新如提示重启，按提示重启；纯 Client 修改需在确认 `pnpm run dev:web` watcher 正在运行时才可期待 HMR，否则刷新当前 GUI 页面。

## 发布前检查

```powershell
node scripts/build-client.cjs --check
node test/harness.cjs
npm run pack:release
node _hash-check.cjs
node _check-live.mjs
```

检查重点：

- 新会话在正常会话列表中可见后，旧会话才会归档；
- session-slim 不展示 ghost / stale session；
- 工具列表不会回退成单一会话，也不显示宿主诊断、revision 或 form 状态；
- `minimal` 与其他 preset 的默认系统提示词保持独立；
- context 单位使用十进制 SI，`子代理` 列保持独立。

## v1.0.0 发布前的待办（2026-10-21 现状）

| # | 事项 | 现状 | 是否阻塞 v1.0.0 |
| --- | --- | --- | :---: |
| 1 | 版本控制 | **已完成**：包目录已 `git init`（分支 `main`），当前功能修复提交 `4bcd6fe`，tag `v0.4.97`，`.gitignore` 排除发布物与缓存 | 否 |
| 2 | 发布物 | 只有本地 `release/*.tgz`（81 个），没有远端仓库、没有 npm 发布 | 否（内部插件可接受），但要写清分发方式 |
| 3 | 工作目录卫生 | **已清理**：临时文件移到工作区 `_artifacts/`，包目录只剩产品文件 | 否 |
| 4 | 文档一致性 | README 组件表已更新；`todo.md` 的历史章节编码损坏（GBK 混入），需重写或转码 | 否，但影响交接 |
| 5 | 自动化 UI 回归 | 712 条断言覆盖宿主/客户端源码与行为；真实 GUI 仍靠人工核验（每轮 3 项） | 否，建议 v1.0.0 后补 |
| 6 | DSH 核心限制 | `composedPreset(context.scope)` 恒为 undefined（scope key 不是 context）；preset 的 `composeAgent` / `presetForObservation` 是 controller 内部 | 否（已用 `agent.session.header.agentPreset` 绕过） |
| 7 | 宿主半边生效方式 | 插件模块被 Node 的 ESM 缓存持有：升级后**客户端立即生效、宿主需重启 DSH 进程** | 否，但必须写进升级说明 |
| 8 | 已知残留风险 | `timer` 已停止维护并默认停用；`notify`、`shell-local`、`visualize`、`keep-effort` 当前均标记为 ✔。其中 `shell-local` 的现状无法完全归因于本组件，因为组件编写前已有独立补丁；`visualize` 的 Mermaid 11.17.0 已 vendored | 否；只保留外部权限和上游版本变化说明 |

结论：**功能面已经收敛，阻塞项已清零**。现已确认可用的组件包括 `keep-effort`、`notify`、`visualize`、`shell-local`；其中 `shell-local` 的当前可用性不能完全归因到 dsh-polish，因为它在本组件编写前已有独立补丁，但当前 DSH 实际使用正常。`timer` 已停止维护并默认停用，官方自动化任务是替代方案。版本控制已补齐，当前功能修复基线为 `v0.4.97`。发布 v1.0.0 只差把 `package.json` 版本改成 `1.0.0`、跑一遍发布前检查并打 `v1.0.0` tag。

## 目录速览

```text
cordis.patch.yml       Loader 入口和组件注册
lib/index.js           Host 生成入口
lib/client.js          Client 生成入口（不要手改）
src/client/            Client 源码
prompts/               提示词与工具提示 Host 逻辑
session-slim/          会话瘦身 Host 逻辑
test/harness.cjs       回归测试
release/               本地打包产物
```

## 范围

这是增强组件集，不是 DSH 核心的替代实现。组件可以单独关闭；关闭后应恢复 DSH 自带行为。涉及权限、模型、Agent 生命周期或会话持久化的组件都采用 fail-closed 策略：无法确认状态时保留原数据，并把失败交给用户处理，而不是假报成功。
