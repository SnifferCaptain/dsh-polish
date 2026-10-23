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
| `keep-effort` | ✔ | 记住会话的模型推理强度 | 依赖模型选择投影；持久化失败不能影响主会话 | 维护模型选择兼容和失败回滚 |
| `session-slim` | ✔ | 总结旧会话并创建可见的新会话 | 只有 replacement 完成可见性、模型、工作区和工具检查后才归档旧会话 | 维护会话生命周期和持久化兼容性 |

## 功能说明

### 提示词管理

`prompts` 提供两类提示词配置：

- **系统提示词**：每个 Agent preset 都有自己的只读内置模板，包括 `standard`、`ptc`、`cordis` 和 `minimal`；用户创建的模板单独列出。
- **工具提示**：只修改工具描述文本，不改变工具参数、工具名称或执行行为。

内置模板直接来自 DSH 的 preset 定义，不需要调用模型探测。系统提示词支持追加和整份替换；由于 `minimal` 的默认 persona 是完整提示词，选择整份替换时会顶替该 persona，这是该模式的明确语义。

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
dsh plugin --profile web add https://github.com/SnifferCaptain/dsh-polish/releases/download/v1.0.2/dsh-polish-1.0.2.tgz
```

安装后：

- 更新已有版本时可以直接安装新的 bundle；
- Host 安装结果显示 `application: applied` 才表示安装已应用；
- Host 代码更新通常需要重启 DSH 宿主进程；
- 纯 Client 修改在刷新页面后生效；只有确认 web watcher 正在运行时才可期待 HMR。

### 从 npm 安装

该包也按 npm bundle 结构准备：

```powershell
dsh plugin --profile web add dsh-polish@1.0.2
```

### 本地构建和打包

在源码 checkout 中执行：

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

命令会生成 `release/dsh-polish-<version>.tgz`。

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

不要直接手工编辑生成的 `lib/client.js` 或 `lib/client.mermaid.js`。

### 测试

测试保留在本地开发 checkout 中，不进入公开 Git 仓库。当前本地基线为：

```text
720 checks
```

本地存在 `test/` 目录时执行：

```powershell
node test/harness.cjs
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

当前功能基线为 **v1.0.2**。发布历史以 Git tags 为准。

## 已知边界

- `timer` 已停止维护并默认停用；需要定时任务时使用 DSH 官方自动化任务；
- `shell-local` 的可用性依赖部署权限和沙箱策略；其历史补丁来源不完全属于本组件；
- `notify` 的系统通知是否出现取决于浏览器或桌面权限；提示音功能不依赖该权限；
- `visualize` 的 Mermaid 能力依赖 vendored 的上游版本；升级 Mermaid 后应重新执行完整构建和回归测试；
- Host 插件升级受 Node.js ESM 缓存影响，必要时需要完整重启 DSH，而不是只刷新页面。

## License

本项目使用 MIT License，许可证声明见 [package.json](package.json) 的 `license` 字段。
