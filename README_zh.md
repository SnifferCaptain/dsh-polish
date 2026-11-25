# dsh-polish

DSH 的一组可独立开关的增强组件。组件以一个 Cordis bundle 发布，不修改 DSH 核心源码；每个功能都可以通过插件管理器单独启用或停用。

[English README](README.md)

## 组件状态

> `✔` 可用；`❌` 已知不可用；`⚠` 有条件、风险或等待验证；`—` 已停止维护或默认停用。

| 组件 | 状态 | 用途 | 已知风险 / 边界 | 维护策略 |
| --- | :---: | --- | --- | --- |
| `thinking-renderer` | ✔ | 展示思考流、耗时和自动跟随 | 依赖 DSH 思考行的 DOM / data 属性 | 随 DSH DOM 契约变化维护 |
| `thinking-depth` | ✔ | 把自带推理等级改成滑条 | 只对声明了 `reasoning` 的模型显示；依赖自带菜单结构 | 保持对官方面板的低侵入 |
| `composer-history` | ✔ | 在输入框召回上一条消息 | 依赖 composer slot | 仅修兼容性问题 |
| `workspace-lru` | ✔ | 工作区切换、最近使用排序 | 需要工作区服务和本地状态 | 继续减少对页面结构的依赖 |
| `timer` | — | 定时器相关能力 | DSH 官方自动化任务已覆盖该场景；本组件默认停用 | 停止维护，不再做兼容开发 |
| `notify` | ✔ | 任务完成、需要处理时播放提示音或发送通知 | 系统通知受浏览器 / 桌面权限影响；提示音不依赖通知权限 | 当前环境已验证可用，保持 best-effort |
| `mode-switch` | ✔ | 在会话菜单切换 `standard`、`ptc`、`cordis`、`minimal` | cold session 切换需要先恢复 Agent | 维护 preset 切换兼容性 |
| `skill-loader` | ✔ | 从个人 skills 目录加载 `SKILL.md` | 可能与官方 skill filesystem 重复注册 | 保持根目录去重 |
| `prompts` | ✔ | 管理按模式划分的系统提示词和工具提示 | `minimal` 的 persona 是完整提示词；自定义 `replace` 会顶替它 | 维护 DSH preset 兼容性 |
| `shell-local` | ✔ | 提供本地 shell 能力 | 当前可用性依赖部署权限和沙箱策略 | 只修明确的安全边界，不增加隐式执行 |
| `visualize` | ✔ | 渲染 Mermaid 和 SVG 图形 | SVG 会经过严格消毒；Mermaid 使用仓库内置版本 | 跟随上游 Mermaid 版本升级并回归验证 |
| `keep-effort` | ✔ | 按会话和模型分别记住推理强度 | 依赖模型选择投影；持久化失败不能影响主会话 | 维护模型选择兼容；持久化失败时保持 fail-open |
| `session-slim` | ✔ | 总结旧会话并创建可见的新会话 | 只有 replacement 完成可见性、模型、工作区和工具检查后才归档旧会话 | 维护会话生命周期和持久化兼容性 |
| `compact-model` | ✔ | 压缩摘要跟随选择模型、超窗分片滚动、超阈值保护、自动失败重试——四个独立开关 | 超阈值保护默认关闭：开启后先压缩、压不下去再剪枝，仍超限只记日志并放行，从不拒绝本步 | 维护压缩与模型选择兼容性 |
| `ptc-log-repair` | — | 打开历史报「PTC dispatch repeats subCallId」时自愈日志 | 只修数据（后一次执行占用的 id 整组改名，原子写 + 时间戳备份）；其他损坏原样抛出 | 跟踪 DSH 会话格式读端校验变化 |
| `better-model-config` | ✔ | 在官方「模型」页**行内**扩展：逐模型协议（换到同网关兄弟路线）、参考表填充空字段、思考开关（可逆）、/v1 双向自动修复 | 单一入口（官方编辑器）；写入官方 `llm-pi-ai` 配置；编辑器打开期间排队、关闭即落盘；价格仅显示 | 跟进官方模型页 DOM 锚点（哈希类子串）与 pi-ai 配置 schema |
| `workspace-guard` | ✔ | 观察宿主权威的会话列表，把「工作区成员表里丢了」的已持久化会话按 canonical cwd 补回所属工作区 | 只补不删：从不修改会话日志、从不把会话移出工作区；这是**补偿**不是根因拦截——覆盖成员表的那次写入在核心里，插件拦不住，只能在写完之后再补 | 跟随 DSH 工作区注册表与会话持久化接口变化 |

## 功能说明

### 提示词管理

`prompts` 提供两类提示词配置：

- **系统提示词**：每个 Agent preset 都有自己的只读内置模板，包括 `standard`、`ptc`、`cordis` 和 `minimal`；用户创建的模板单独列出。模板正文支持变量 `{{model}}`（当前模型名）和 `{{provider}}`（提供方），在每次模型调用装配时实时代入（与 DSH 内置的同名变量同源）；其余 `{{...}}` 原样保留、不做解析——组件自己完成代入并保持 section 非插值，因此模板里写错变量名不会让装配抛错、不影响 API 可用性。
- **工具提示**：只修改工具描述文本，不改变工具参数、工具名称或执行行为。

内置模板直接来自 DSH 的 preset 定义，不需要调用模型探测。系统提示词支持追加和整份替换；由于 `minimal` 的默认 persona 是完整提示词，选择整份替换时会顶替该 persona，这是该模式的明确语义。

“工具提示”页通过只读 Host 路由读取全局注册表，以及每个已声明 Agent preset 的工具作用域。打开“工具提示”页时读取一次；此后只有用户明确点击刷新才会重新读取。它不再从 live session 的模型装配中探测工具，后台会话也不会在编辑过程中改动列表。存在未保存的工具提示修改时，刷新会被拒绝。目录是已声明全局工具与 preset 工具的稳定并集；只在 live session 中临时受限或产生的工具，明确不纳入这个可编辑目录。

#### 上下文嵌入（1.4.17）

除了系统/工具提示词，DSH 还会注入若干**每请求都可见**的上下文：`Current runtime context.` 运行时快照（工作目录、沙箱策略、审批策略、Harness checkout、Web GUI 地址）、技能目录消息、时间上下文消息、模型切换提示，以及压缩时发给压缩模型的末尾指令。「上下文嵌入」页按这五类各给一行，每一类都能直接调整：

- **运行时快照 section**——`working-directory:current`、`sandbox:policy`、`approval:policy`、`harness:source`、`app:web-surface` 各自支持 `keep`（原样）、`off`（从快照中移除该 section）、静态项还支持 `custom`（自定义文案）。custom 模板支持变量 `{{cwd}}`（工作目录投影，实时）、`{{checkout}}` 与 `{{webUrl}}`（插件加载时从 DSH 自己渲染的文案里捕获一次）、`{{model}}`/`{{provider}}`；其余 `{{...}}` 原样保留（fail-open）。`sandbox:policy`/`approval:policy` 是会话中可变的动态状态，v1 只提供 keep/off——静态 custom 文案会陈旧。
- **技能提示 / 时间提示 / 模型切换提示**——各自支持 `keep`、`off`（提交前整条删除）、`custom`（原位改写消息文本；保留 message id 与目录 source——DSH 自己的 digest 逻辑看到的目录仍然稳定，日志不累积副本）。目录模板可用 `{{entries}}`、`{{count}}`、`{{note}}`；时间模板可用 `{{turn}}`、`{{step}}`、`{{timestamp}}`。
- **压缩提示（1.4.17 新增）**——压缩指令不是 system prompt section，而是压缩请求末尾的一条 user 消息，因此本组件在 `llm/stream` 里改写它（`purpose='compaction'`；分片预处理 `compaction-chunk` 保持核心原文，否则每片会按整段历史的口径缩写）。`keep` = 核心原文；`custom` = 用你的模板替换，变量 `{{model}}`、`{{provider}}`、`{{turns}}`（回放消息条数）。被压缩的历史本身不受影响；「填入最近值」把上次实际指令复制进编辑器。
- **总开关**——运行时快照整体关闭时，通过 DSH 官方的 `suppressRuntimeContext()` 扩展点压制全部 optional context；只有 required 的工作目录 section 需要显式置空。
- **隔离**——所有默认值都是 keep/开，即**零改写**：不注册 shadow context、不挂会改写请求的 pre-step 监听器、不压制任何东西。唯一常驻的是只读 `session/event` 观察者（为每行的「最近实际注入值」入账，不改请求字节）。关闭整行（或禁用插件）后行为与原来完全一致。配置热变更在下一个模型步生效；已提交的消息永不改写（日志 append-only）。
- **改不动的部分**——快照的包装句与「不再适用」的清除句是 DSH 核心硬编码字符串，提交点无钩子，因此整体关闭的极限 = 模型收到一次清除句后静默。

#### 全部注入通道与最近值（1.4.7)

「上下文嵌入」页的这张表是**实况清单**，不是「只读清单」：观察到的上下文消息按 `kind` 聚合（次数 / form / 最近时间 / 最近正文，超过 260 字符可展开）。可编辑消息行也展示最近一次实际持久注入正文，并可复制到自定义模板；运行时快照各段区分“最近持久注入值”（含 `source.sections`，有值时以它为准）和“最近装配值（提交前）”。

- **可改**：`model-selection`（模型切换提示，`keep`/`off`/`custom`，模板变量 `{{text}}` `{{kind}}` `{{model}}` `{{provider}}`）、`skill-catalog`、`time-context`、`runtime-context`——行内直接写明「在上方『XX』里改」。
- **只读**：核心子系统直接 `session.append` 的协议消息（目标轮提醒、计划模式、子代理回执/消息、后台作业、定时提醒、checkpoint、撤回、PTC、审批/提问回复、团队/Webhook 等），每一条都在行内给出「谁写的 / 为什么删不得 / 会破坏什么不变量」。模板/custom 改写对这类消息一律不生效。
- **未收录也不丢**：观察器不再按登记表过滤，任何新 `kind` 都原样入账并标注「未收录」；本插件自己的 `dsh-polish-session-slim` 与核心的 `fallback` 就是 1.4.2 固定登记表漏掉、1.4.3 补上的两种（来自对两份真实会话日志的全量解码）。
- **临时压缩提示**：另有同步 `llm/stream` 观察器展示 `purpose=compaction` / `compaction-chunk` 请求末尾的用户指令。最多保存这条指令的 4000 字符和路由元数据，不保存前面的会话历史、工具或完整模型输入；它原样返回 stream。
- **捕获边界**：session/event 不回扫旧日志，次数从观察器启动后开始计；0 表示“当前 volatile 快照里没观察到”，不代表 DSH 从未注入。技能目录提醒、已加载技能正文、压缩摘要 checkpoint 和未知 kind 都各自列出。
- 注入通道与压缩观察器不改写被观察的消息或请求字节。

### 会话瘦身

`session-slim` 将长会话压缩为 checkpoint，并创建一个新的可见会话。正常流程如下：

1. 读取侧栏可见的会话和完整 lineage；
2. 使用配置的 compact 模型生成摘要；
3. 创建 replacement session 并写入摘要；
4. 继承原会话的工作区、模型、effort 和 Agent preset；
5. 以受保护的 `system/message` surface head 创建 checkpoint，避免重启后的 v4 日志校验失败；
6. 确认 replacement 已经出现在正常会话列表，并且拥有原模式的工具；
7. 如果旧会话是当前主会话，先让 replacement 接管 main view，避免设置面板因短暂没有当前会话而关闭；
8. 只有确认成功后，才归档旧会话和相关子代理。

如果 compact 路线遇到余额、鉴权或限流类 provider 错误，组件会尝试回退到该会话最后使用的模型路线。所有创建、挂载和可见性失败都应保留旧会话，不静默删除原数据。0.4.98 起，replacement 的 seed 先建立空的受保护 `system/message` head，避免第一次真实系统提示词写入后在 DSH 重启时被判为损坏日志。0.4.99 起，当前主会话会在归档前由 replacement 接管。0.4.100 起，上箭头召回在编辑器异步回写期间仍按 recall 索引向更早的 user 消息移动。1.0.0 起，插件启动后会延迟执行一次只读 session catalog 刷新，覆盖 Host persistence 恢复晚于 Client 初次 list 的情况。

### 压缩

`compact-model` 有四个**各自独立**的开关（行配置页），另有重试次数/首次等待两个数字项。

- **使用当前选择的模型压缩**（`followSelection`，默认开）：压缩摘要跟随模型选择器当前选中的路线，只作用于压缩调用，不改普通回复。
- **超窗时分片滚动压缩**（`chunkedCompaction`，默认关）：官方摘要会把整个待压缩区间一次性重放，所以「上下文已经超过目标模型声明窗口」的会话永远压不动（摘要请求本身就超窗）。打开时在 tool 配对安全边界上切片、把上一片 checkpoint 折叠进下一片；provider 返回 `stop` + 全文、只是用量超过声明窗口而被 pi-ai 判成 silent overflow 的调用按成功放行，只有无正文的真溢出才继续报错。
- 两个开关互不牵连：关掉分片只回到官方一次性重放，改道仍然生效；两个都关 = 纯透传（等同未安装本组件）。1.0.16 修复了分片续写的合成 assistant 消息缺少 `source` 导致的 `Cannot read properties of undefined (reading 'replayState')` 崩溃。
- **压缩前检查上下文阈值**（`pressureGuardEnabled`，默认关）：沿用官方压缩默认阈值 0.8，先压缩、压不下去再剪枝兜底，每轮最多强制压缩两次；仍超限只记 error 日志并放行，不会拒绝本步（1.4.35 起代码里没有任何拒绝路径：拒绝会吞掉已取走的用户消息且不报错，会话看起来就是死了）。需要时在压缩行里打开。
- 行开关控制整个组件。

### 增强模型配置

`better-model-config`（1.4.22）**只在官方「模型」页上原地扩展，不另设任何第二入口**：在展开某个模型行的「模型选项」之前，页面与官方**逐像素一致**（提供商卡片里只有一个 `display:none` 的路线锚点，不占位、不可见、不可交互）；点开某个模型行的箭头展开「模型选项」后，该面板里才多出一行字段（逐模型协议、按默认填充、按需出现的 /v1 修复、一枚价格小标签），排版沿用官方那套 12px 标签 + 32px 控件的栅格。它写入的仍是官方 `llm-pi-ai` 配置（`providers.<route>.*`），用官方编辑器同样的 path-ops + revision 校验，不注册路线、适配器或独立设置页。

- **逐模型协议（1.4.22）**：pi-ai 的 `api` 是**路线级**字段，所以「这个模型说 anthropic-messages」只能靠搬家实现——把该模型移到同网关的兄弟路线（`<路线>-<后缀>`，沿用同一份 `apiKeyEnv`/`headers`），地址按协议边界自动补/去 `/v1`；搬回基础路线就是选基础路线的协议。路线级「协议」仍归官方编辑器，这里的是**逐模型**那一份。
- **思考开关（1.4.29 起）**：模型展开面板里的开关决定「这个模型能不能被开关思考」，不是直接开/关思考。关 = `reasoningEfforts: false`（先把原档位表备份，再开时原样放回；原本没写过则开回去就是删除该字段，继续继承目录能力）；开 = 声明 off + 一档。已有 ≥2 个非 off 档位时，档位表是更细的开关，粗开关只显示状态不可点。思考深度是另一个控件，仍由官方「推理等级」行负责。
- **参考表只用于填充 + 一枚价格**：`better-model-config/model-defaults.jsonc` 记录常见模型的能力与价格。键是模型 id 或名称，查询忽略大小写以及 `-` `.` 空格（`qwen-3.8-27b` ≡ `Qwen3-8-27B`）。点「按默认填充」把该模型**仍为空**的字段初始化（名称/上下文/最大输出/输入类型/思考档位；已有值绝不覆盖），填充结果会列出填了哪些字段；已一致时提示「没有可填的空字段」。表中唯一**只显示不写配置**的是价格，所以页面上只留一枚 `¥x / ¥y` 小标签，其余查表结果不再铺到界面里。
- **/v1 自动修复（双向）**：Anthropic 路线地址不应以 `/v1` 结尾（SDK 自己会补），OpenAI 路线地址需要 `/v1`（或别的 `/vN`）结尾。提示与一键修复都在模型展开面板里，且**只在地址确实不对时出现**（正确时该按钮隐藏），因此不展开模型不会有任何多出来的东西。
- **写入时机（防覆盖）**：官方编辑器打开时持有路线草稿、点「保存」才落盘，此刻直写会被旧草稿覆盖。所以所有动作在编辑器打开期间**排队**（扩展条显示「已排队」），**编辑器一关闭立即**按最新快照原子落盘；编辑器关闭时的动作立即执行。
- **参考表维护**：`model-defaults.jsonc` 是 JSONC（可写注释），能力数据来自 pi-ai 内置目录，价格来自 token-usage 价格表。解析向前兼容：未知列会忽略，新行无需改代码即可生效；两个条目声称同一键时，该键按歧义处理并丢弃。这张表可直接在本仓库维护。
- **DOM 约定（易碎点）**：扩展条注入官方模型行，锚点为官方哈希 CSS 类子串（`li[class*="_rowCard"]`、`div[class*="_modelEntry"]`）、行内第一个 `<input>`（模型 id）与本组件的 `data-dshp-bmc-route` 标记。这些锚点钉在 DSH 0.2.1-rc.5 的构建上；**升级 DSH 后若官方模型页结构变化，扩展条会安静地消失（不报错、不写错配置）**，需要按本 README 的锚点重新核对。
- 行开关可实时隐藏全部扩展；关闭后官方页与原生完全一致。

### 可视化

`visualize` 会识别聊天消息中的 Mermaid / SVG 代码围栏并在消息中渲染：

- Mermaid 使用仓库内置的 **11.17.0** 版本，不依赖 CDN；
- 上游项目：[mermaid-js/mermaid](https://github.com/mermaid-js/mermaid)；
- vendored 文件：[vendor/mermaid-11.17.0.min.js](vendor/mermaid-11.17.0.min.js)；
- SVG 经过严格消毒后再展示；
- 任一图形渲染失败时保留原始代码块，不破坏消息界面。

### 其他组件

思考展示、推理等级、消息召回、工作区 LRU、模式切换、技能加载、通知、本地 shell 和推理强度持久化的当前状态见上方组件表。所有组件都遵循“可以单独关闭，关闭后尽量恢复 DSH 原生行为”的原则。

## 安装

### 从 GitHub Release tarball 安装

Git 仓库有意不追踪 `lib/`、`test/` 和其他生成/开发文件。因此，从 GitHub 发布的 tarball 是 GitHub 渠道的推荐安装源：

```powershell
dsh plugin --profile web add https://github.com/SnifferCaptain/dsh-polish/releases/download/v1.5.0/dsh-polish-1.5.0.tgz
```

安装后：

- 更新已有版本时可以直接安装新的 bundle；
- Host 安装结果显示 `application: applied` 才表示安装已应用；
- Host 代码更新通常需要重启 DSH 宿主进程；
- 纯 Client 修改在刷新页面后生效；只有确认 web watcher 正在运行时才可期待 HMR。

### 从 npm 安装

从 npm 安装时，以下命令会选择 npm 上最新发布的版本；该版本可能落后于 GitHub Release：

```powershell
dsh plugin --profile web add dsh-polish@latest
```

### 本地构建和打包

在源码 checkout 中执行：

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

命令会生成 `release/dsh-polish-<version>.tgz`。

`build:client` 会先由 `locale/*.jsonc` 重新生成 UI 词条字典（`src/client/shared/i18n.js`），再生成 Host/Client 入口；不要手工编辑生成的字典。

### 发布包边界

npm 包使用 `package.json` 的 `files` 白名单，而不是把整个仓库打进去。包内只保留运行时需要的内容：Host / Client 构建产物、组件 Host 入口、`cordis.patch.yml`、随包发布的 skills 和两个 README。

以下内容不进入 npm tarball 和/或 Git 仓库：

- `test/`：本地回归测试，不提交到公开 Git 仓库；
- `src/`：Client 源码，仅在源码仓库中维护；
- `scripts/`：构建脚本，仅在源码 checkout 中使用；
- `lib/`：打包前本地生成，进入 npm/Release tarball，但不提交到 Git；
- `build/`、`dist/`、`coverage/`、`tools/`、`release/`：构建、测试或本地发布辅助产物；
- `vendor/`：源码构建时使用的 Mermaid 输入，运行时使用已生成的 `lib/client.mermaid.js`；
- `.agents/`、缓存、临时文件、日志和 `todo.md`。

## 兼容性

当前包声明的运行环境：

- DSH：`>=0.2.0-rc.1 <0.3.0`；
- Node.js：使用 DSH 提供的 Node.js / pnpm 环境构建；
- `@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/dsh-llm`、`@deepseek-ai/dsh-tools` 为可选 peer dependency，由 DSH 运行环境提供。

## 开发

### 目录结构

```text
cordis.patch.yml       Cordis bundle 入口和组件注册
src/client/            Client 源码
locale/                UI 词条字典（zh/en，JSONC 源 + 生成的 JS）
<component>/           各组件的 Host 入口和 package.json
scripts/               Client 构建脚本
vendor/                vendored 的第三方运行时输入
skills/                随组件发布的模型技能
README.md              英文项目说明
README_zh.md           中文项目说明
```

构建生成的 `lib/` 已被 Git 忽略，打包前必须在本地生成。

### 修改 Client 代码

Client 源码位于 `src/client/`。修改后必须重新生成 `lib/client.js`，因为回归检查和发布包读取的是构建产物：

```powershell
npm run build:client
npm run check:client
```

不要直接手工编辑生成的 `lib/client.js`、`lib/client.mermaid.js` 或 `src/client/shared/i18n.js`。

### UI 词条化

用户可见的 Client 文案集中在 `locale/zh.jsonc` 与 `locale/en.jsonc`（语言 = 文件名，JSONC 允许注释）。构建时生成 `src/client/shared/i18n.js`（纯 JS 字典 + `t(key, {…})`），缺失键回退 zh，再回退 key 本身。词条在渲染期解析，因此在 DSH 里切换界面语言后，已打开的设置页文案实时切换、无需重挂。提示词模板名与正文属于数据而非 UI 文案，保持原语言。

### 测试

测试保留在维护者的本地 `test/` 目录中，不提交到公开 Git 仓库，也不包含在发布包里。在维护者的 checkout 中运行完整测试：

```powershell
npm test
```

测试覆盖组件入口、配置契约、生成的 Client 输出、关键行为和部分 Client DOM 行为；真实模型调用、浏览器权限和桌面通知仍需要在目标 DSH 环境中验证。

## 发布检查清单

发布 GitHub Release tarball 或 npm 版本前：

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

还应验证：

- `lib/client.js` 与源码构建结果一致；
- Host 与 Client 入口都能加载；
- session-slim 创建 replacement 后旧会话不会提前归档；
- prompt preset 之间不会互相泄漏；
- Mermaid chunk 与主 Client bundle 都包含在 tarball 中；
- 对最终包扫描个人路径、凭据和开发文件；
- 在干净 DSH profile 中安装 tarball，并验证 `application: applied` 与实际页面行为。

当前包版本：**v1.5.0**。发布历史以 Git tags 为准。

## 已知边界

- `timer` 已停止维护并默认停用；需要定时任务时使用 DSH 官方自动化任务；
- `shell-local` 的可用性依赖部署权限和沙箱策略；其历史补丁来源不完全属于本组件；
- `notify` 的系统通知是否出现取决于浏览器或桌面权限；提示音功能不依赖该权限；
- `visualize` 的 Mermaid 能力依赖 vendored 的上游版本；升级 Mermaid 后应重新执行完整构建和回归测试；
- Host 插件升级受 Node.js ESM 缓存影响，必要时需要完整重启 DSH，而不是只刷新页面。

## License

本项目使用 MIT License，许可证声明见 [package.json](package.json) 的 `license` 字段。
