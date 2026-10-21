---
name: visualize
description: Use when the user asks you to draw, diagram, chart, sketch, or visualize anything — architecture, flows, sequences, timelines, comparisons, data. Emit ```svg or ```mermaid fences that the dsh-polish "visualize" component renders inline in chat.
---

# Visualize（dsh-polish 聊天可视化）

把"画图"请求变成**聊天消息里的代码围栏**，由 dsh-polish 的 visualize 组件在聊天界面里渲染成图。
前提：用户已启用 dsh-polish 的 `dsh-polish:visualize` 行（插件 → dsh-polish → visualize，默认关闭）。

## 选哪种围栏

| 场景 | 围栏 |
|---|---|
| 流程图 / 时序图 / 类图 / 状态机 / ER / 甘特 / 饼图 / 时间线 / 看板 / git 图 / C4 | ` ```mermaid ` |
| 精确版式、数据图表、艺术化示意图、需要配色和排版控制 | ` ```svg ` |

拿不准就用 mermaid——它容错高、自带布局；mermaid 表达不了的（自定义坐标图表、装饰性插图）才写 SVG。

## Mermaid 规则

- 围栏第一行直接写图类型（`flowchart LR`、`sequenceDiagram`、`gantt`、`pie`、`timeline`、`classDiagram`、`stateDiagram-v2`、`erDiagram`、`journey`、`kanban`、`gitGraph`、`quadrantChart`、`xychart-beta`、`requirementDiagram`、`mindmap`、`C4Context` …）。
- 节点文字含特殊字符时用引号：`A["登录 (POST)"] --> B`。
- 中文标签直接写，无需转义。
- 一张图只表达一个主题；超过 ~25 个节点就拆成多张图。
- 不要写 `%%` 注释里放重要信息（用户看到的图不含注释）。

### 示例

\`\`\`mermaid
flowchart LR
  U["用户"] --> GW["网关"]
  GW --> S1["服务 A"]
  GW --> S2["服务 B"]
  S1 --> DB[("数据库")]
  S2 --> Q["消息队列"]
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant C as 客户端
  participant A as API
  participant P as 支付
  C->>A: 下单
  A->>P: 创建支付单
  P-->>A: 支付链接
  A-->>C: 302 跳转
\`\`\`

## SVG 规则（重要——会被安全消毒）

组件会把 SVG **严格消毒**后以 `<img>` 静态光栅化展示：

- **禁止**（会被直接删掉）：`<script>`、`<foreignObject>`、`<image>`、`<object>`、`<embed>`、`<iframe>`、任何 `on*` 事件属性、外链 `href`（`http…`/`//…`）、`style` 里的 `url(…)`/`javascript:`/`expression(…)`。
- **保留**：`<defs>` 渐变/滤镜、`<text>` 文字、`<animate>`/`<animateTransform>`/`<animateMotion>`（SMIL 动画在 `<img>` 里照常播放，且不占页面主线程）。
- 必须带 `viewBox`（组件用它在插入前定好宽高比，防抖动）。
- 尺寸克制：内容 ≤ 100000 字符，目标宽度 600–900px。
- 不依赖外部字体/图片（`<img>` 上下文只吃文档内资源）；文字用系统无衬线字体即可。
- 颜色给两套思路：背景未知（跟随主题），所以**不要用整块背景色**，用线条 + 中性色 + 1–2 个强调色；深浅背景都能读（避免纯黑/纯白大色块，用 `#3a3f4b` 这类中间灰 + 强调色）。

### 示例

\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320" font-family="sans-serif">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4f8ef7"/>
      <stop offset="1" stop-color="#9b6df2"/>
    </linearGradient>
  </defs>
  <text x="360" y="34" text-anchor="middle" font-size="20" fill="#c9d1d9">部署架构（示意）</text>
  <g stroke="#8b949e" stroke-width="1.5" fill="none">
    <rect x="40"  y="80"  width="180" height="70" rx="10"/>
    <rect x="280" y="80"  width="180" height="70" rx="10"/>
    <rect x="520" y="80"  width="160" height="70" rx="10"/>
    <path d="M220 115 H 280 M460 115 H 520"/>
  </g>
  <g font-size="16" fill="#c9d1d9" text-anchor="middle">
    <text x="130" y="121">客户端</text>
    <text x="370" y="121">网关</text>
    <text x="600" y="121">服务集群</text>
  </g>
  <rect x="280" y="220" width="180" height="60" rx="10" fill="url(#g1)" opacity="0.25" stroke="#9b6df2" stroke-width="1.5"/>
  <text x="370" y="256" text-anchor="middle" font-size="16" fill="#c9d1d9">数据库</text>
  <path d="M370 150 V 220" stroke="#8b949e" stroke-width="1.5" fill="none"/>
  <circle cx="370" cy="115" r="4" fill="#4f8ef7">
    <animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite"/>
  </circle>
</svg>
\`\`\`

## 通用

- 图 + 一两句说明；不要为图配大段重复的文字描述。
- 多张图按逻辑顺序分开发，每张一个独立围栏。
- 用户说"改成横版/换个配色/加个节点"时，输出**更新后的完整围栏**（围栏是不可变快照，不 diff）。
- 围栏之外的正文正常写；不要解释消毒规则，除非用户问。
