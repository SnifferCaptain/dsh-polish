import z from '@deepseek-ai/schemastery'

/**
 * 自定义系统提示词（组件 J）：在「设置 → 提示词设置」里管理一个自定义提示词
 * 库，并把选中的那一个注入进每个会话实际发出的系统提示词。
 *
 * —— 注入机制（dsh-system-prompt 的两阶段装配）——
 *   DSH 的系统提示词不是单个字符串：agent 每次模型调用时由
 *   `systemPrompt.assemble(scope)` 收集全部已注册 section（harness 身份、
 *   部署 persona、工具说明、部署 persona 后缀……），跑一遍
 *   `system-prompt/assemble` 事件水幕后按序渲染。本组件挂一条水幕监听器
 *   做「预览捕获」，并用 `systemPrompt.section()` 注册自己的 section：
 *     · 附加模式（append，默认）：order 0、interpolate: false —— 落在
 *       部署 persona 前缀之后、一切工具说明之前，默认提示词原样保留；
 *     · 整份替换模式（replace）：`complete: true` —— 装配后 DSH 只保留这
 *       一个 section，整份提示词 = 用户的文本。⚠️ 若部署自身也声明了
 *       complete section，两个 complete 会令装配抛错（模型调用失败），
 *       界面里有显式提示，默认用附加模式。
 *   section 的 text 是「每次装配时求值」的闭包：它实时读本行设置里
 *   当前激活条目的 content —— 所以编辑内容不需要重新注册；只有
 *   激活项 id 或 mode 变化才重新注册（注册/注销由 1s 轮询驱动，与
 *   mode-switch 同一范式）。
 *
 *   模板变量（1.4.1）：{{model}}（当前模型名）/ {{provider}}（提供方）
 *   由本组件在 section text 求值时**自己**代入——值取自装配 context 的
 *   agent options，与 DSH 内置 model/provider 变量同源（dsh-agent-loop
 *   注册的那两个），随每次请求实时变化。之所以不交给 DSH 内置插值
 *   （section 保持 interpolate: false）：DSH 的插值是**严格**的，
 *   模板里出现未注册的 {{变量}} 会让整次装配抛错 = 模型调用失败；
 *   这里未知变量/无值的变量保持 {{...}} 原文，永不抛错（fail-open）。
 *
 * —— 预览（volatile 通道）——
 *   水幕监听器在每次装配时把 sections 拆成两层，写入本行 volatile 设置
 *   的 `preview` 字段，客户端页面轮询读取并展示（附「复制当前提示词」，
 *   复制的是当前查看的那一层）。预览只随模型调用刷新（装配就是模型调用
 *   本身），页面里如实说明。
 *
 *   0.4.40 预览只保留「系统提示词」本身（用户反馈：这是提示词组件，工具
 *   相关的东西全部去掉）：
 *     · 模板层（template）：非工具 section 的原始 text（`{{变量}}` 原样
 *       保留，不插值）——这才是「系统提示词」本体；附变量名→当前值映射，
 *       让用户看清哪些是运行时填的（如 {{model}} = 当前模型名）。
 *     · 最终形态层（final）：同一批非工具 section 的 renderPrompt 渲染
 *       （`{{变量}}` 代入当前值）——模型实际收到的提示词正文（运行时
 *       上下文快照由 agent loop 在请求时另行附加，不在此列）。
 *   两层都不含 `tool:*` / `tools:*` / `mcp-*` section（工具使用须知；工具
 *   JSON 定义本就走 assembly.tools 独立通道传给 API）——它们不展示在本
 *   组件的任何视图里；DSH 实际下发时仍按核心行为附带，本组件不改 DSH。
 *   每层都有「当前生效 / 默认提示词（不含本组件 section）」两个来源。
 *
 * —— 工具提示（0.4.45，第二个标签页）——
 *   目的：不改变工具定义（parameters/行为/执行），只改写模型看到的工具
 *   **描述文本**，借此控制模型的调用意愿（例：给 create_goal 追加「仅当
 *   用户在当前消息中明确要求时才允许创建目标」，抑制模型自行其是）。
 *   落点：同一条 system-prompt/assemble 水幕——PromptAssembly 按设计就带
 *   tools（ToolSchema[]，description 是 wire 字段），水幕监听器被官方实践
 *   文档允许「重写」（只有增删工具才禁止走这里）。监听器在 next() 之后：
 *   先 capture（工具列表捕获的是**原始**描述，给用户参照），再把
 *   toolPrompts 里配置过的工具 description 按模式改写后返回。
 *   · append（默认）：原描述 + 空行 + 用户文本；replace：整份换掉原描述。
 *   · 每次装配实时读本行设置（与 section 文本同范式）——保存后下一次
 *     模型调用即生效，无需重启；空文本 = 该工具不改动（原样通过）。
 *   · 工具提示页通过 Client fetch 路由读取 ctx.tools.schemas()
 *     不依赖 session 探测，也不写入 volatile toolPreview。
 *
 * —— renderPrompt 的取用 ——
 *   预览用 dsh-system-prompt 导出的模块级函数 `renderPrompt` 渲染（与
 *   模型所见逐字一致）。它不是服务方法、ctx 上拿不到，而 dsh-system-prompt
 *   又不在本包的声明依赖里（pnpm 严格模式），所以这里动态 import：
 *   运行时 DSH 组合里永远有它，import 成功就用原版；失败则退回一个宽松
 *   的内置渲染器（未知变量保留字面量），预览不中断。
 *
 * —— 全部注入通道（1.4.3）——
 *   除上面三类，框架还会注入 goal 提醒、子代理回执、代理消息、作业通知、
 *   定时提醒、压缩 checkpoint、撤回、PTC、模型切换提示等 user/developer
 *   消息。本组件用**只读观察**（session/event）把它们按 kind 聚合成
 *   contextPreview.injected，页面「上下文嵌入」把这些通道汇成一张**实况表**
 *   （次数/表单/最近时间/最近正文，可展开全文），并按真实能力标注
 *   「可改 / 只读」：可改的行直接写出上方哪个开关管它，只读的行写明谁写入、
 *   删掉会破坏什么不变量。1.4.3 起观察器不再按登记表过滤，新 kind 会以
 *   「未收录」原样列出，不会被静默丢弃。
 *   其中 model-selection / skill-catalog / time-context / runtime-context 有
 *   开关；其余由核心子系统直接 append，删改会破坏其协议不变量，因此只展示。
 */

/**
 * 工具描述改写（纯函数，harness 直接测）：按 overrides（toolName -> 用户
 * 文本）改写 tools（ToolSchema[]）的 description。append = 原描述 + 空行 +
 * 文本；replace = 整份换成文本。空/空白文本、未命中的名字一律不改动；
 * 没有任何改动时返回原数组（同一引用），调用方据此决定是否换 assembly。
 */
export function applyToolPrompt(tools, overrides, mode) {
  if (!Array.isArray(tools) || tools.length === 0) return tools
  if (!overrides || typeof overrides !== 'object') return tools
  var replace = mode === 'replace'
  var out = null
  var lastIdx = -1
  for (var i = 0; i < tools.length; i++) {
    var tool = tools[i]
    if (!tool || typeof tool.name !== 'string') continue
    var text = overrides[tool.name]
    if (typeof text !== 'string' || text.trim() === '') continue
    var base = typeof tool.description === 'string' ? tool.description : ''
    var next = replace ? text : base ? base + '\n\n' + text : text
    if (out === null) {
      out = []
      for (var k = 0; k < i; k++) out.push(tools[k])
    }
    out.push(Object.assign({}, tool, { description: next }))
    lastIdx = i
  }
  if (out === null) return tools
  for (var j = lastIdx + 1; j < tools.length; j++) out.push(tools[j])
  return out
}

export const Config = z.object({
  /** 实时总开关（镜像 Loader 行开关之外的第二道闸；在行激活时读取）。 */
  enabled: z.boolean().default(true).volatile(),
  /**
   * 0.4.54 volatile 补标（rc.1）：下面四个字段全部由**客户端页面**在运行期
   * 写入（切换 active / custom 增删改 / 工具提示保存）。rc.1 的 settings
   * 管线（dsh-settings update/mutate）运行期只允许写 volatile 字段，非
   * volatile 写入被直接拒绝——症状即工具提示页「保存被拒绝，请重试」。
   * volatile 字段同样落盘（patch 文件），且运行期写入无需行 remount。
   */
  /** 当前激活的自定义提示词 id；`default` = 使用 DSH 默认系统提示词。 */
  active: z.string().default('default').volatile(),
  /** 每个 agent preset 选择共享提示词库中的一个 id；default = DSH 内置。 */
  activeByPreset: z.dict(z.string()).default({}).volatile(),
  /** 自定义提示词库（客户端页面维护，整体原子写入）。 */
  custom: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        /** 'append' = 附加在默认提示词前部；'replace' = 整份替换。 */
        mode: z.string().default('append'),
        /** 提示词正文（上限 20000 字符，客户端校验）。 */
        content: z.string(),
      }),
    )
    .default([])
    .volatile(),
  /** 工具提示（0.4.45，持久）：toolName -> 用户文本。空/空白文本 = 不改动
   *  该工具；未列出的工具一律原样。客户端「工具提示」标签页维护。 */
  toolPrompts: z.dict(z.string()).default({}).volatile(),
  /** 工具提示模式（持久）：'append' = 追加到原描述末尾（默认，保留原
   *  功能说明）；'replace' = 整份替换原描述（模型只看到用户文本）。 */
  toolPromptMode: z.string().default('append').volatile(),
  /** 1.4.36：工具提示词「应用到模式」。列表里没有的模式完全不改写工具描述（DSH 原样）。
   *  用途：插件反复插拔时，未勾选模式的会话提示词不会跟着来回变，保住缓存命中。
   *  默认四个模式全选 = 与 1.4.35 行为一致。运行期由客户端写入，因此 volatile。 */
  toolPromptModes: z.array(z.string()).default(['standard', 'ptc', 'cordis', 'minimal']).volatile(),
  /** 运行时通道（volatile）：水幕捕获的提示词两层结构（均不含工具 section）。
   *  effective/defaultText = 最终形态（非工具 section 的 renderPrompt 渲染）；
   *  effectiveTemplate/defaultTemplate = 模板层（同一批 section 原始 text，
   *  {{变量}} 不插值）；variables = 模板占位符的当前值映射（供页面图例）。 */
  preview: z
    .object({
      effective: z.string().default(''),
      defaultText: z.string().default(''),
      effectiveTemplate: z.string().default(''),
      defaultTemplate: z.string().default(''),
      variables: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .default([]),
      updatedAt: z.number().default(0),
    })
    .default({})
    .volatile(),
  /** 按 agent preset 分桶的最新预览；preview 保留为 standard/旧客户端兼容镜像。 */
  previewByPreset: z.dict(z.any()).default({}).volatile(),
  /**
   * 0.4.91：4 个内置模板（每模式一个）的**真实内容**——宿主直接从 DSH 自己的
   * preset 定义里读出来（readDocument 拿 persona 行 + preset scope 装配拿整份
   * 提示词），不需要任何一次模型调用。客户端用它做「无探测预览」。
   */
  builtins: z
    .array(
      z.object({
        id: z.string(),
        mode: z.string(),
        label: z.string(),
        /** 该模式的 DSH 默认提示词（渲染后：变量已代入）。 */
        text: z.string().default(''),
        /** 模板形态（{{变量}} 原样保留）。 */
        template: z.string().default(''),
        /** 该模式的 persona 前缀（DSH 自己的定义）。 */
        persona: z.string().default(''),
        /** DSH 的 persona 是否 complete（minimal = true：它就是整份提示词）。 */
        complete: z.boolean().default(false),
        /** 'assemble' = 整份默认提示词（preset scope 装配）；'persona' = 只有 persona 前缀。 */
        source: z.string().default(''),
        note: z.string().default(''),
      }),
    )
    .default([])
    .volatile(),
  /**
   * 1.4.1 上下文嵌入（volatile）：控制三类框架注入的上下文消息如何嵌入每次
   * 请求——runtime-context 快照（逐 section）、skill-catalog（技能目录）、
   * time-context（采样时间）。全部默认值 = 与 DSH 原行为完全一致（keep =
   * 零注册、零干预）。客户端「上下文嵌入」tab 维护。
   * 1.4.2 起新增只读的 session/event 观察者（contextPreview.injected）：
   * 它不改写任何消息、不改变请求字节，只为「全部注入通道」清单提供数据。
   *   · runtimeContext.enabled = false：压制全部 optional context（required
   *     的 working-directory:current 同时置空）→ 模型只收到一次 CLEARED 句。
   *   · sections[name] = { mode: 'keep'|'off'|'custom', template }；keep 时
   *     核心注册的 text 函数是唯一来源（本组件不注册任何东西）。
   *   · skillCatalog/timeContext/modelSelection = { mode: 'keep'|'off'|'custom',
   *     template }。modelSelection 的正文（[model changed: A → B]）由核心
   *     dsh-agent 在 agent/pre-step 追加到 decision.messages，属纯提示内容，
   *     删改不影响任何协议状态。
   */
  contextEmbedding: z
    .object({
      runtimeContext: z
        .object({
          enabled: z.boolean().default(true),
          sections: z.dict(z.any()).default({}),
        })
        .default({}),
      skillCatalog: z.object({ mode: z.string().default('keep'), template: z.string().default('') }).default({}),
      timeContext: z.object({ mode: z.string().default('keep'), template: z.string().default('') }).default({}),
      modelSelection: z.object({ mode: z.string().default('keep'), template: z.string().default('') }).default({}),
      // 1.4.17：压缩指令。mode='custom' 时本组件在 llm/stream 里把
      // purpose=compaction 请求末尾那条 user 指令替换成 template（变量
      // {{model}}/{{provider}}/{{turns}} 实时代入，未知变量原样保留）。
      compaction: z.object({ mode: z.string().default('keep'), template: z.string().default('') }).default({}),
      // 1.4.18：压缩检查点的前缀句。核心 frameSummary() 把
      // CHECKPOINT_PREAMBLE + "\n\n<compacted-summary>" 写成第一条 text 块，
      // 后面才是摘要正文。本组件在 agent/pre-step 里只换前缀句，标签与摘要
      // 正文原样保留（结构不变，模型看到的仍是同一份检查点）。
      checkpoint: z.object({ mode: z.string().default('keep'), template: z.string().default('') }).default({}),
    })
    .default({})
    .volatile(),
  /** volatile preview channels: contexts = latest real system-prompt/assemble values;
   *  runtimeSnapshot = sections from the persisted runtime-context user message (the
   *  authoritative value the next request can replay); injected = all observed
   *  user/developer message kinds, including loaded skills and checkpoints;
   *  compaction = only the final directive of a transient compaction LLM request,
   *  never the replayed conversation. All are read-only observations.
   *  Schemastery 3.18 has no .optional(): these nested objects explicitly default
   *  to undefined so a missing snapshot stays absent rather than becoming {}. */
  contextPreview: z
    .object({
      contexts: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
      runtimeSnapshot: z
        .object({
          sessionId: z.string().default(''),
          messageId: z.string().default(''),
          eventSeq: z.number().default(0),
          form: z.string().default('snapshot'),
          capturedAt: z.number().default(0),
          text: z.string().default(''),
          sections: z.array(z.object({ name: z.string(), text: z.string() })).default([]),
        })
        .default(undefined),
      compaction: z
        .object({
          sessionId: z.string().default(''),
          purpose: z.string().default(''),
          provider: z.string().default(''),
          model: z.string().default(''),
          inputMessageCount: z.number().default(0),
          instructionChars: z.number().default(0),
          instruction: z.string().default(''),
          truncated: z.boolean().default(false),
          capturedAt: z.number().default(0),
        })
        .default(undefined),
      injected: z
        .array(
          z.object({
            kind: z.string(),
            sessionId: z.string().default(''),
            form: z.string().default(''),
            count: z.number().default(0),
            lastAt: z.number().default(0),
            text: z.string().default(''),
          }),
        )
        .default([]),
      updatedAt: z.number().default(0),
    })
    .default({})
    .volatile(),
})

// settings（读写配置）、systemPrompt（section 注册 + assemble 水幕）、
// tools（稳定的全局工具目录）和 connection（打开/手动刷新时的只读路由）。
// sessionProjections（1.4.1）：{{cwd}} 变量读会话工作目录投影
// （dsh-agent-loop / dsh-agent-preset-registry 同款 core 依赖；运行期缺失时
// {{cwd}} fail-open 到 session.header.cwd）。webApp 故意**不**进 inject：
// headless 部署没有它，加了会令整行加载失败；{{webUrl}} 改由加载期装配
// 捕获的 app:web-surface 文案取值（运行期 ctx.webApp 存在时优先用）。
export const inject = ['settings', 'systemPrompt', 'agents', 'agentPresets', 'connection', 'tools', 'sessionProjections']

export function apply(ctx, config) {
  var enabled = !config || config.enabled !== false

  // 隐藏自动设置页：用户可见的表单在「设置 → 提示词设置」+ 行详情页总开关。
  ctx.effect(function () {
    ctx.settings.configure({ auto: false }, ctx.fiber)
  })

  if (!enabled) return

  var NS = 'dsh-polish:prompts'
  var SECTION_NAME = 'dsh-polish:custom-prompt'

  // ---- 渲染器：优先原版 renderPrompt（动态 import，失败退回宽松渲染）。
  var renderReal = null
  try {
    import('@deepseek-ai/dsh-system-prompt').then(
      function (mod) {
        if (mod && typeof mod.renderPrompt === 'function') renderReal = mod.renderPrompt
      },
      function () {},
    )
  } catch (error) {}

  function substituteVariables(text, variables) {
    if (typeof text !== 'string') return ''
    return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, function (whole, name) {
      var value = variables ? variables[name] : undefined
      return value === undefined || value === null ? whole : String(value)
    })
  }

  // 1.4.1：用户模板里的 {{model}} / {{provider}} —— 本组件在 section text
  // 求值时代入（section 保持 interpolate: false，DSH 的严格插值碰不到我们
  // 的文本）。取值口径与 DSH 内置同名变量完全一致：装配 context 的
  // agent options（dsh-agent-loop 注册的 model/provider 变量读的就是
  // context.agent?.options.*）。未知变量或无值的变量保持 {{...}} 原文：
  // 永不抛错、永不改变 API 可用性（fail-open）。
  var TEMPLATE_VARIABLES = {
    model: function (context) {
      var options = context && context.agent && context.agent.options
      if (!options || options.model === undefined || options.model === null) {
        // 1.4.17：无 agent 的装配（preset scope 的预览/探测）也要能解析
        // {{model}}，否则页面预览会把占位符原样显示成「解析失败」。
        var fallback = ctxDefaultRoute()
        if (fallback && fallback.model) return String(fallback.model)
        return undefined
      }
      var v = String(options.model)
      return v.length > 0 ? v : undefined
    },
    provider: function (context) {
      var options = context && context.agent && context.agent.options
      if (!options || options.provider === undefined || options.provider === null) {
        var fallback = ctxDefaultRoute()
        if (fallback && fallback.provider) return String(fallback.provider)
        return undefined
      }
      var v = String(options.provider)
      return v.length > 0 ? v : undefined
    },
  }

  /** 当前默认模型选择（无 agent 装配时给 {{model}}/{{provider}} 兜底）。 */
  function ctxDefaultRoute() {
    try {
      var model = ctx.agentDefaultModel
      if (!model || typeof model.currentSelection !== 'function') return null
      var selection = model.currentSelection()
      if (!selection || typeof selection !== 'object') return null
      return {
        model: typeof selection.model === 'string' && selection.model !== '' ? selection.model : null,
        provider: typeof selection.provider === 'string' && selection.provider !== '' ? selection.provider : null,
      }
    } catch (error) {}
    return null
  }
  function interpolateTemplate(text, context) {
    if (typeof text !== 'string' || text.indexOf('{{') < 0) return text
    return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, function (whole, name) {
      var fn = TEMPLATE_VARIABLES[name]
      if (!fn) return whole
      var value
      try {
        value = fn(context)
      } catch (error) {
        value = undefined
      }
      return value === undefined ? whole : value
    })
  }

  function renderLenient(sections, variables) {
    var out = []
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i]
      if (!s) continue
      var text = s.interpolate === false ? s.text : substituteVariables(s.text, variables)
      if (typeof text === 'string' && text.length > 0) out.push(text)
    }
    return out.join('\n\n')
  }

  function renderSections(sections, variables) {
    if (typeof renderReal === 'function') {
      try {
        return renderReal({ sections: sections, variables: variables })
      } catch (error) {}
    }
    return renderLenient(sections, variables)
  }

  // ---- 读本行设置的当前行（host 侧同步读）。
  function findRow() {
    try {
      var list = ctx.settings.describe()
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].ns === NS) return list[i]
      }
    } catch (error) {}
    return null
  }

  function findValue() {
    var row = findRow()
    return row && row.value ? row.value : null
  }

  // =====================================================================
  // 0.4.91 内置模板：直接从 DSH 自己的 preset 定义取，不需要「探测」
  // （用户反馈：「极简模式需要探测才能有模板——难道不能自己从 DSH 代码里拿到？」）
  //   · persona 行：ctx.agentPresets.readDocument(id) → YAML → prefix/complete
  //   · 整份默认提示词：ctx.agentPresets.acquireScope(id) → 该 preset 的 scope
  //     key → ctx.systemPrompt.assemble({scope:key}) → 非工具 section 渲染。
  //     不调用模型、不建 agent；DSH 自己的 complete persona 会让装配结果只剩
  //     它（minimal 就是这样：整份提示词 = persona 一行）。
  // =====================================================================
  var PERSONA_PREFIX_SECTION = 'deployment:persona-prefix'
  // ptc 模式的两段协议：规则（tools:ptc-only，order 800）与按本 agent 工具生成的
  // SDK 声明（tools:sdk，order 5000）。「整份替换」用 complete section 会把它们
  // 一并丢掉（DSH 只保留 complete 段），模型就看不到 SDK 与「只能调 run_code」。
  var PTC_ONLY_SECTION = 'tools:ptc-only'
  var PTC_SDK_SECTION = 'tools:sdk'
  function isPtcReplace(presetId, spec) {
    return presetId === 'ptc' && !!spec && spec.mode === 'replace'
  }
  var BUILTIN_MODES = [
    { id: 'standard', label: 'standard 默认模板' },
    { id: 'ptc', label: 'ptc 默认模板' },
    { id: 'cordis', label: 'cordis 默认模板' },
    { id: 'minimal', label: 'minimal 默认模板' },
  ]
  // 内置模板的静态缓存：presetId -> {persona, text, template, at}
  var builtinCache = {}
  var builtinRefreshBusy = false
  var builtinRefreshAt = 0
  var BUILTIN_TTL_MS = 30000
  // 0.4.92：单步超时（内置模板解析的任何一步都不得拖住发布）
  var BUILTIN_STEP_TIMEOUT_MS = 4000
  // 探测（装配 preset scope）用的 scope key：这些装配不是某个 agent 的装配，
  // 不能进预览捕获，否则会污染「当前生效 / 默认」两层。
  var probeScopes = new Set()
  // 用显式 assemble 的 AbortSignal 标识 agent-scope 探测。scope 本身是
  // agent 的真实 ScopeKey，不能靠改成伪 key 来隔离；超时包装器也不会取消
  // 底层 Promise，所以 token 必须一直标记到那次 assemble 真正 settle。
  var probeSignals = new WeakSet()
  function isProbeAssembly(context) {
    if (!context) return false
    try {
      if (context.scope && probeScopes.has(context.scope)) return true
    } catch (error) {}
    try {
      return !!(context.signal && probeSignals.has(context.signal))
    } catch (error) {
      return false
    }
  }

  function stripYamlScalar(value) {
    var v = String(value === undefined || value === null ? '' : value).trim()
    if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') return v.slice(1, -1)
    if (v.length >= 2 && v.charAt(0) === "'" && v.charAt(v.length - 1) === "'") return v.slice(1, -1).replace(/''/g, "'")
    return v
  }

  /** 从 preset 的组合 YAML 里读出 persona 行（prefix / suffix / complete）。 */
  function readPersonaRow(text) {
    var lines = String(text || '').split(/\r?\n/)
    var nameIdx = -1
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('dsh-persona') >= 0 && /name\s*:/.test(lines[i])) {
        nameIdx = i
        break
      }
    }
    if (nameIdx < 0) return null
    var baseIndent = lines[nameIdx].match(/^\s*/)[0].length
    var prefix = null
    var suffix = null
    var complete = false
    var i2 = nameIdx + 1
    while (i2 < lines.length) {
      var line = lines[i2]
      if (line.trim() === '') {
        i2++
        continue
      }
      var indent = line.match(/^\s*/)[0].length
      var trimmed = line.trim()
      if (indent <= baseIndent && trimmed.charAt(0) === '-') break
      var m = /^(prefix|suffix|complete)\s*:\s*(.*)$/.exec(trimmed)
      if (m) {
        var key = m[1]
        var rest = m[2].trim()
        if (key === 'complete') {
          complete = rest === 'true' || rest === 'yes' || rest === 'on'
        } else if (rest === '' || rest === '|' || rest === '|-' || rest === '|+' || rest === '>' || rest === '>-' || rest === '>+') {
          var buf = []
          var blockIndent = -1
          var j = i2 + 1
          while (j < lines.length) {
            var bl = lines[j]
            if (bl.trim() === '') {
              buf.push('')
              j++
              continue
            }
            var bi = bl.match(/^\s*/)[0].length
            if (bi <= indent) break
            if (blockIndent < 0) blockIndent = bi
            buf.push(bl.slice(blockIndent))
            j++
          }
          var blockText = buf.join('\n').replace(/\s+$/, '')
          if (key === 'prefix') prefix = blockText
          else suffix = blockText
          i2 = j
          continue
        } else if (key === 'prefix') {
          prefix = stripYamlScalar(rest)
        } else {
          suffix = stripYamlScalar(rest)
        }
      }
      i2++
    }
    return { prefix: prefix, suffix: suffix, complete: complete }
  }

  /** 该 preset 的 persona 定义（来自 DSH 自己的 preset 文档；缓存）。 */
  function presetPersona(presetId) {
    var entry = builtinCache[presetId]
    return entry && entry.persona ? entry.persona : null
  }

  /** 该 preset 的 persona 是否 complete（minimal = true）。 */
  function personaIsComplete(presetId) {
    var persona = presetPersona(presetId)
    return !!(persona && persona.complete)
  }

  /** 该模式的 DSH 默认提示词（静态，来自 preset 定义；无探测）。 */
  function builtinTextFor(presetId) {
    var entry = builtinCache[presetId]
    return entry && typeof entry.text === 'string' ? entry.text : ''
  }

  function builtinTemplateFor(presetId) {
    var entry = builtinCache[presetId]
    return entry && typeof entry.template === 'string' ? entry.template : ''
  }

  /**
   * 0.4.92：单步超时。内置模板的解析**绝不能拖住发布**——DSH 的
   * acquireScope -> retain -> diagnostic -> loader.await() 在 loader 忙时可以
   * 一直挂着（0.4.91 实测：四个内置模板一个都没发布出来）。任何一步超过
   * BUILTIN_STEP_TIMEOUT_MS 就当它失败，继续下一个。
   */
  function withBuiltinTimeout(promise, fallback) {
    return new Promise(function (resolve) {
      var settled = false
      var timer = setTimeout(function () {
        if (settled) return
        settled = true
        resolve(fallback)
      }, BUILTIN_STEP_TIMEOUT_MS)
      Promise.resolve(promise).then(
        function (value) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(value)
        },
        function () {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(fallback)
        },
      )
    })
  }

  // dsh-scope（拿 live agent 的 scope 键用；动态 import，拿不到就退化）
  var scopeModulePromise = null
  function loadScopeModule() {
    if (!scopeModulePromise) {
      scopeModulePromise = import('@deepseek-ai/dsh-scope').then(
        function (mod) {
          return mod && typeof mod.scopeOf === 'function' ? mod : null
        },
        function () {
          return null
        },
      )
    }
    return scopeModulePromise
  }

  /**
   * 0.4.92：读一个 ctx 的 scope 键（dsh-scope 用 Symbol('dsh.scope') 打标）。
   * 直接找符号 → 不依赖 '@deepseek-ai/dsh-scope' 能不能被解析（插件可能解析不到）。
   */
  function scopeKeyOfCtx(ctxObj) {
    try {
      if (!ctxObj) return null
      var syms = Object.getOwnPropertySymbols(ctxObj)
      for (var i = 0; i < syms.length; i++) {
        var description = syms[i].description || String(syms[i])
        if (description === 'dsh.scope') return ctxObj[syms[i]]
      }
    } catch (error) {}
    return null
  }

  /** 这个 section 是不是本组件自己的（内置模板文本里不能含它）。
   *  context = 本次装配的 context（可选）：section text 求值时已把
   *  {{model}}/{{provider}} 代入，text 可能不再逐字包含原始模板 ——
   *  用同一 context 把模板代入一遍再比（无 agent 时两者相同）。 */
  function isOwnSection(section, context) {
    if (!section) return false
    if (section.name === SECTION_NAME) return true
    if (section.name === PERSONA_PREFIX_SECTION) {
      var value = findValue()
      var spec = null
      try {
        spec = currentSpec('standard')
      } catch (error) {}
      var content = spec && typeof spec.content === 'string' ? spec.content : ''
      if (!content) return false
      var text = String(section.text || '')
      if (text.indexOf(content) >= 0) return true
      var resolved
      try {
        resolved = interpolateTemplate(content, context)
      } catch (error) {
        resolved = content
      }
      if (resolved !== content && text.indexOf(resolved) >= 0) return true
    }
    return false
  }

  /** 在一个 scope 里装配一次提示词并抽出非工具 section（不调模型）。 */
  function assembleInScope(key) {
    if (!key) return null
    try {
      probeScopes.add(key)
    } catch (error) {}
    var p = (async function () {
      var aCtx = { scope: key }
      var assembly = await ctx.systemPrompt.assemble(aCtx)
      var sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
      var body = []
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i]
        if (!sec || isToolSection(sec.name)) continue
        if (isOwnSection(sec, aCtx)) continue
        if (typeof sec.text === 'string' && sec.text.length > 0) body.push(sec)
      }
      return { text: renderSections(body, (assembly && assembly.variables) || {}), template: joinRaw(body) }
    })()
    return p.finally(function () {
      try {
        probeScopes.delete(key)
      } catch (error) {}
    })
  }

  /**
   * 0.4.92：该模式自己的默认提示词。
   *   首选：**已在跑的**该模式 agent 的 generation scope
   *   （scopeParentOf(scopeOf(agent.ctx)) —— 正是 preset 树自己的作用域；
   *   这样装配出来的是「这个模式自己的提示词」，不含任何 agent 私有的
   *   自定义 section，也不调用模型、不新建 agent、不 retain/dispose 任何东西）。
   *   次选：acquireScope（可能挂起 → 超时放弃）。
   *   都没有 → 返回 null（退回 persona 前缀）。
   */
  async function assemblePresetPrompt(presetId) {
    var scopeMod = await loadScopeModule()
    if (scopeMod) {
      var agents = []
      try {
        agents = ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
      } catch (error) {}
      for (var i = 0; i < agents.length; i++) {
        var agent = agents[i]
        if (!agent || !agent.ctx) continue
        var preset = null
        try {
          preset = ctx.agentPresets && typeof ctx.agentPresets.composedPreset === 'function' ? ctx.agentPresets.composedPreset(agent.ctx) : null
        } catch (error) {}
        if (preset !== presetId) continue
        var key = null
        try {
          var own = scopeMod.scopeOf(agent.ctx)
          key = typeof scopeMod.scopeParentOf === 'function' ? scopeMod.scopeParentOf(own) : own
        } catch (error) {}
        if (!key) key = scopeKeyOfCtx(agent.ctx)
        if (!key) continue
        var assembled = await withBuiltinTimeout(assembleInScope(key), null)
        if (assembled && assembled.text) return assembled
      }
    }
    if (!ctx.agentPresets || typeof ctx.agentPresets.acquireScope !== 'function') return null
    var lease = null
    var leaseKey = null
    try {
      lease = await withBuiltinTimeout(ctx.agentPresets.acquireScope(presetId), null)
      if (!lease) return null
      leaseKey = lease.key
      if (!leaseKey) return null
      return await withBuiltinTimeout(assembleInScope(leaseKey), null)
    } catch (error) {
      return null
    } finally {
      if (lease && typeof lease[Symbol.asyncDispose] === 'function') {
        try {
          await lease[Symbol.asyncDispose]()
        } catch (disposeError) {}
      }
    }
  }

  /** 刷新 4 个内置模板的静态内容（30s 一次；用户改了 preset 会跟着变）。 */
  async function refreshBuiltins() {
    if (builtinRefreshBusy) return
    builtinRefreshBusy = true
    try {
      var next = {}
      for (var i = 0; i < BUILTIN_MODES.length; i++) {
        var mode = BUILTIN_MODES[i]
        var persona = null
        try {
          if (ctx.agentPresets && typeof ctx.agentPresets.readDocument === 'function') {
            var doc = await withBuiltinTimeout(ctx.agentPresets.readDocument(mode.id), null)
            if (doc && typeof doc.content === 'string') persona = readPersonaRow(doc.content)
          }
        } catch (error) {}
        var assembled = await withBuiltinTimeout(assemblePresetPrompt(mode.id), null)
        var text = assembled && assembled.text ? assembled.text : ''
        var template = assembled && assembled.template ? assembled.template : ''
        var source = text ? 'assemble' : ''
        // 装配没拿到 persona（preset scope 的层级与预期不同）→ 退回 persona 前缀，
        // 并如实标注来源（不谎称是整份提示词）。
        var personaText = persona && typeof persona.prefix === 'string' ? persona.prefix : ''
        if (personaText && text && text.indexOf(personaText) < 0) {
          text = ''
          template = ''
          source = ''
        }
        if (!text && personaText) {
          text = personaText
          template = personaText
          source = 'persona'
        }
        next[mode.id] = {
          persona: persona,
          text: text,
          template: template,
          source: source,
          at: Date.now(),
        }
        // 0.4.92：每解析完一个模式就发布一次——一个模式卡住不影响其余三个。
        builtinCache = Object.assign({}, builtinCache, next)
        publishBuiltins()
      }
      builtinCache = next
      builtinRefreshAt = Date.now()
      publishBuiltins()
    } catch (error) {
    } finally {
      builtinRefreshBusy = false
    }
  }

  /** 四个内置模板的当前内容（快照；路由与设置通道共用）。 */
  function builtinsSnapshot() {
    var out = []
    for (var i = 0; i < BUILTIN_MODES.length; i++) {
      var mode = BUILTIN_MODES[i]
      var entry = builtinCache[mode.id] || {}
      var persona = entry.persona || null
      var complete = !!(persona && persona.complete)
      out.push({
        id: 'builtin:' + mode.id,
        mode: mode.id,
        label: mode.label,
        text: typeof entry.text === 'string' ? entry.text : '',
        template: typeof entry.template === 'string' ? entry.template : '',
        persona: persona && typeof persona.prefix === 'string' ? persona.prefix : '',
        complete: complete,
        source: typeof entry.source === 'string' ? entry.source : '',
        note: complete
          ? '该模式的 DSH 提示词是整份（persona complete）：自定义模板会顶替它。'
          : '该模式的 DSH 默认提示词（persona + DSH 内置段落）。',
      })
    }
    return out
  }

  /** 把内置模板内容发布到 volatile 通道（客户端据此做无探测预览）。 */
  function publishBuiltins() {
    try {
      var value = findValue()
      var current = value && Array.isArray(value.builtins) ? value.builtins : []
      var out = builtinsSnapshot()
      if (JSON.stringify(current) === JSON.stringify(out)) return
      stampWrite(ctx.settings.update(NS, { builtins: out }))
    } catch (error) {}
  }

  function scheduleBuiltinRefresh() {
    if (builtinRefreshBusy) return
    if (Date.now() - builtinRefreshAt < BUILTIN_TTL_MS) return
    builtinRefreshAt = Date.now()
    try {
      var promise = refreshBuiltins()
      if (promise && typeof promise.catch === 'function') promise.catch(function () {})
    } catch (error) {}
  }

  // 部署版不暴露调试诊断；保留空函数以兼容写入回执调用点。
    function stampWrite(promise) {
    try {
      if (promise && typeof promise.catch === 'function') promise.catch(function () {})
    } catch (error) {}
  }
  var lastPreviewPreset = 'standard'
  function writePreview(patch, presetId) {
    try {
      var bucket = typeof presetId === 'string' && presetId ? presetId : 'standard'
      var current = findValue()
      var byPreset = current && current.previewByPreset && typeof current.previewByPreset === 'object' ? current.previewByPreset : {}
      var prev = byPreset[bucket] && typeof byPreset[bucket] === 'object' ? byPreset[bucket] : null
      if (prev && prev.effective === patch.effective && prev.defaultText === patch.defaultText) return
      var nextByPreset = Object.assign({}, byPreset)
      nextByPreset[bucket] = patch
      var update = { previewByPreset: nextByPreset }
      // 兼容旧客户端与刷新按钮：standard 继续镜像到 preview。
      if (bucket === 'standard') update.preview = patch
      var promise = ctx.settings.update(NS, update)
      if (promise && typeof promise.catch === 'function') {
        promise.catch(function (error) {
          void error
        })
      }
    } catch (error) {}
  }
  // ---- 水幕捕获：每次装配拆两层（模板 / 最终形态，均不含工具 section），
  //      变化才写回。
  var lastEffective = null
  var lastDefault = null
  var activeMode = ''

  // 提示词文本使用 5s 稳定门控：首次捕获立即显示，候选内容需连续
  // 观察满 5s 才替换预览，避免装配过程中的短暂中间态污染页面。
  var PROMPTS_STABLE_MS = 5000
  var previewCandidatePair = null // 候选文本对（effective + defaultText）
  var previewCandidateAt = 0

  /**
   * Read a stable catalog without touching live Agents or sessions.
   * The global layer contains external tools; DSH's built-in tools are declared
   * inside preset scopes, so acquire each retained preset scope and union those
   * declarations. This is a preset registry read, not session probing.
   */
  async function readToolCatalog() {
    var raw = []
    try {
      if (ctx.tools && typeof ctx.tools.schemas === 'function') {
        var globalSchemas = ctx.tools.schemas()
        if (Array.isArray(globalSchemas)) raw = raw.concat(globalSchemas)
      }
    } catch (error) {}
    try {
      if (ctx.agentPresets && typeof ctx.agentPresets.list === 'function' && typeof ctx.agentPresets.acquireScope === 'function') {
        var presets = await withBuiltinTimeout(ctx.agentPresets.list(), [])
        if (Array.isArray(presets)) {
          for (var p = 0; p < presets.length; p++) {
            var preset = presets[p]
            var presetId = preset && typeof preset.id === 'string' ? preset.id : ''
            if (!presetId) continue
            var lease = null
            try {
              lease = await withBuiltinTimeout(ctx.agentPresets.acquireScope(presetId), null)
              if (lease && lease.key && ctx.tools && typeof ctx.tools.schemas === 'function') {
                var scopedSchemas = ctx.tools.schemas(lease.key)
                if (Array.isArray(scopedSchemas)) raw = raw.concat(scopedSchemas)
              }
            } catch (error) {
              // One broken preset must not hide the global or other preset tools.
            } finally {
              if (lease && typeof lease[Symbol.asyncDispose] === 'function') {
                try {
                  await lease[Symbol.asyncDispose]()
                } catch (disposeError) {}
              }
            }
          }
        }
      }
    } catch (error) {}
    var seen = {}
    var list = []
    for (var i = 0; i < raw.length; i++) {
      var tool = raw[i]
      if (!tool || typeof tool.name !== 'string' || !tool.name || seen[tool.name]) continue
      seen[tool.name] = true
      list.push({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description.slice(0, 6000) : '',
      })
    }
    list.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    })
    return list
  }

  /** Tool schemas are read through this explicit Host route; no session assembly is involved. */
  /** 工具相关 section 的判定：tool:*（每工具一段使用须知）、tools:*
   *  （sdk 总说明）、mcp-*（MCP 服务器）。这是提示词组件——工具相关内容
   *  不展示在任何预览视图里；它们的 JSON 定义走 assembly.tools 独立通道
   *  传给 API，本组件不碰。 */
  function isToolSection(name) {
    // 1.4.35：tools:ptc-only 是 ptc 模式的**协议规则**（「只有 run_code 可直接调用」），
    // 属于该模式的提示词正文而不是工具说明——它必须出现在预览与内置模板里，
    // 用户才能看到、编辑、预设它。
    if (name === PTC_ONLY_SECTION) return false
    return (
      typeof name === 'string' &&
      (name.indexOf('tool:') === 0 || name.indexOf('tools:') === 0 || name.indexOf('mcp-') === 0)
    )
  }

  /**
   * 0.4.91：这个 section 是不是本组件的？
   *   · 自定义名字（dsh-polish:custom-prompt）→ 一定是。
   *   · persona 槽位（deployment:persona-prefix）→ 文本里含当前自定义内容
   *     才是（否则那是 preset 自己的 persona）。
   */
  function isMineSection(section, spec, context) {
    if (!section || !spec) return false
    if (section.name === SECTION_NAME) return true
    if (section.name === PERSONA_PREFIX_SECTION) {
      var text = String(section.text || '')
      var content = String(spec.content || '')
      if (!content) return false
      if (text.indexOf(content) >= 0) return true
      // 1.4.1：装配时 section text 已把 {{model}}/{{provider}} 代入，
      // 用同一 context 代入模板再比一遍（无 agent 时两者相同）。
      var resolved
      try {
        resolved = interpolateTemplate(content, context)
      } catch (error) {
        resolved = content
      }
      return resolved !== content && text.indexOf(resolved) >= 0
    }
    return false
  }

  /** 模板层拼接：原始 text 原样保留（{{变量}} 不插值），空段跳过。 */
  function joinRaw(list) {
    var out = []
    for (var i = 0; i < list.length; i++) {
      var s = list[i]
      if (s && typeof s.text === 'string' && s.text.length > 0) out.push(s.text)
    }
    return out.join('\n\n')
  }

  /** 变量映射（仅有限字符串值），供页面展示占位符→当前值。 */
  function variableList(variables) {
    var out = []
    for (var k in variables) {
      if (!Object.prototype.hasOwnProperty.call(variables, k)) continue
      var v = variables[k]
      if (typeof v === 'string' && v.length > 0) out.push({ name: k, value: v })
    }
    return out
  }

  function capture(assembly, context) {
    var sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
    var variables = assembly && assembly.variables ? assembly.variables : {}
    var capturePreset = 'standard'
    var captureMode = ''
    try {
      // 0.4.90 根因：composedPreset(context.scope) 恒为 undefined。assemble 传入的
      // context.scope 就是 agent 本身（assembleContextFor 里 scope: agent），它是
      // scope key 而不是 context；scopeOf 只认带 kScope 标签的 context，读不到 agent，
      // 于是 composedPreset 永远落空、capturePreset 恒为 'standard'，所有 preset 的
      // 预览都挤进 standard 桶（极简看起来跟其它模式一样）。改从会话 header 的
      // agentPreset（创建时按 preset 选择写入、持久化在 jsonl 里）取当前 preset。
      var agent = context && context.agent
      var sessionHeader = agent && agent.session && agent.session.header
      var headerPreset = sessionHeader && sessionHeader.agentPreset
      if (typeof headerPreset === 'string' && headerPreset) {
        capturePreset = headerPreset
      } else if (context && context.scope && ctx.agentPresets) {
        var scopedPreset = ctx.agentPresets.composedPreset(context.scope)
        if (typeof scopedPreset === 'string' && scopedPreset) capturePreset = scopedPreset
      }
      var captureSpec = currentSpec(capturePreset)
      captureMode = captureSpec ? captureSpec.mode : ''
    } catch (error) {}
    lastPreviewPreset = capturePreset
    // 0.4.91：「整份替换」不再另起一个 complete section，而是**同名顶替**
    // deployment:persona-prefix —— 所以「我的 section」有两种名字，靠文本内容
    // 区分（preset 自己的 persona 与我的文本内容不同）。
    var captureSpec = null
    try {
      captureSpec = currentSpec(capturePreset)
    } catch (error) {}
    var mineName = SECTION_NAME
    if (captureSpec && !isPtcReplace(capturePreset, captureSpec) && (captureSpec.mode === 'replace' || personaIsComplete(capturePreset))) {
      mineName = PERSONA_PREFIX_SECTION
    }
    var ptcRule = ''
    if (isPtcReplace(capturePreset, captureSpec)) {
      for (var pi = 0; pi < sections.length; pi++) {
        if (sections[pi] && sections[pi].name === PTC_ONLY_SECTION && typeof sections[pi].text === 'string') ptcRule = sections[pi].text.trim()
      }
    }
    var withRule = function (text) {
      return ptcRule && String(text).indexOf(ptcRule) < 0 ? String(text) + '\n\n' + ptcRule : String(text)
    }
    var mine = null
    var body = [] // 除本组件外的非工具 section（「默认」来源的两层都取自它）
    var bodyWithMine = [] // 非工具 section 原序（含本组件，「生效」来源的两层）
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i]
      if (!s) continue
      if (s.name === mineName && isMineSection(s, captureSpec, context)) {
        mine = s
        bodyWithMine.push(s)
      } else if (!isToolSection(s.name)) {
        body.push(s)
        bodyWithMine.push(s)
      }
    }
    var defaultText = ''
    var effective = ''
    var defaultTemplate = ''
    var effectiveTemplate = ''
    var vars = []
    try {
      defaultText = renderSections(body, variables)
    } catch (error) {}
    try {
      effective = captureMode === 'replace' && mine ? withRule(mine.text || '') : renderSections(bodyWithMine, variables)
    } catch (error) {
      effective = defaultText
    }
    try {
      defaultTemplate = joinRaw(body)
      effectiveTemplate = captureMode === 'replace' && mine ? withRule(mine.text || '') : joinRaw(bodyWithMine)
    } catch (error) {}
    // 0.4.91：还没发生过任何模型调用（或该模式的装配里没有「别人的」section，
    // 例如 minimal 的 complete persona）时，用 **DSH 自己 preset 定义里的默认
    // 提示词**补上——不需要探测。
    if (!defaultText) {
      var staticText = builtinTextFor(capturePreset)
      if (staticText) defaultText = staticText
    }
    if (!defaultTemplate) {
      var staticTemplate = builtinTemplateFor(capturePreset)
      if (staticTemplate) defaultTemplate = staticTemplate
    }
    try {
      vars = variableList(variables)
    } catch (error) {}
    var pair = effective + '\u001f' + defaultText
    if (effective === lastEffective && defaultText === lastDefault) {
      // 已入库文本被再次观察到 → 打断候选计数（否则 A/B 交替捕获会在中途被
      // 采纳）。
      previewCandidatePair = null
      previewCandidateAt = 0
      return
    }
    if (lastEffective === null) {
      // 首次捕获：立即写入。
      lastEffective = effective
      lastDefault = defaultText
      writePreview(buildPreviewPatch(effective, defaultText, effectiveTemplate, defaultTemplate, vars), capturePreset)
      return
    }
    if (pair === previewCandidatePair) {
      // 候选文本再次被观察到：连续计数从首次观察起算，满 PROMPTS_STABLE_MS
      // 才写回（用当前捕获的最新模板/变量值写入）。
      if (Date.now() - previewCandidateAt >= PROMPTS_STABLE_MS) {
        lastEffective = effective
        lastDefault = defaultText
        writePreview(buildPreviewPatch(effective, defaultText, effectiveTemplate, defaultTemplate, vars), capturePreset)
        previewCandidatePair = null
        previewCandidateAt = 0
      }
      return
    }
    // 新候选（或替换旧候选）：开始新的连续计数。注意此处**不**移动
    // lastEffective/lastDefault——候选尚未入库；shown 文本被再次捕获时由上方
    // 早退分支打断本候选的计数。
    previewCandidatePair = pair
    previewCandidateAt = Date.now()
  }

  function buildPreviewPatch(effective, defaultText, effectiveTemplate, defaultTemplate, vars) {
    return {
      effective: effective,
      defaultText: defaultText,
      effectiveTemplate: effectiveTemplate,
      defaultTemplate: defaultTemplate,
      variables: vars,
      updatedAt: Date.now(),
    }
  }

  /** 0.4.45：按本行设置改写工具描述（fail-soft：任何异常原样放行）。
   *  每次装配实时读设置——客户端保存后下一次模型调用即生效。 */
  function rewriteToolDescriptions(assembly, context) {
    if (!assembly || !Array.isArray(assembly.tools) || assembly.tools.length === 0) return assembly
    var value = findValue()
    if (!value || value.enabled === false) return assembly
    // 1.4.36：应用到模式。没有 agent 的装配（无法判定模式）保持原行为。
    if (context && context.agent) {
      var modes = Array.isArray(value.toolPromptModes) ? value.toolPromptModes : PRESET_IDS
      if (modes.indexOf(presetOfContext(context)) < 0) return assembly
    }
    var overrides = value.toolPrompts && typeof value.toolPrompts === 'object' ? value.toolPrompts : null
    var mode = value.toolPromptMode === 'replace' ? 'replace' : 'append'
    var tools = applyToolPrompt(assembly.tools, overrides, mode)
    if (tools === assembly.tools) return assembly
    return Object.assign({}, assembly, { tools: tools })
  }

  /** 1.4.35：ptc +「整份替换」不用 complete（那会丢掉 SDK 与 ptc 规则），而是在瀑布里
   *  把装配结果收敛成 [我的正文, tools:ptc-only, tools:sdk]。用户文本里已含规则原文
   *  就不再重复追加。任何一步拿不到预期结构 → 原样返回（fail-open）。 */
  function prunePtcReplace(assembly, context) {
    try {
      var sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : null
      if (!sections) return assembly
      var agent = context && context.agent
      if (!agent) return assembly
      var header = agent.session && agent.session.header
      var presetId = header && typeof header.agentPreset === 'string' && header.agentPreset ? header.agentPreset : presetForAgent(agent)
      var spec = currentSpec(presetId)
      if (!isPtcReplace(presetId, spec)) return assembly
      var mine = null
      for (var i = 0; i < sections.length; i++) {
        if (sections[i] && sections[i].name === SECTION_NAME && typeof sections[i].text === 'string' && sections[i].text.trim() !== '') mine = sections[i]
      }
      if (!mine) return assembly
      var kept = []
      for (var k = 0; k < sections.length; k++) {
        var sec = sections[k]
        if (!sec) continue
        if (sec === mine || sec.name === PTC_SDK_SECTION) {
          kept.push(sec)
        } else if (sec.name === PTC_ONLY_SECTION) {
          var rule = typeof sec.text === 'string' ? sec.text.trim() : ''
          if (rule !== '' && mine.text.indexOf(rule) < 0) kept.push(sec)
        }
      }
      return Object.assign({}, assembly, { sections: kept })
    } catch (error) {
      return assembly
    }
  }

  function onAssemble(assembly, context, next) {
    return Promise.resolve(next()).then(
      function (transformed) {
        // 0.4.91：preset scope 的**探测装配**不是某个 agent 的装配——不进预览
        // 捕获（否则会污染「当前生效 / 默认」两层），也不改工具描述。
        var isProbe = isProbeAssembly(context)
        if (!isProbe) {
          try {
            capture(transformed, context)
          } catch (error) {}
        }
        try {
          if (isProbe) return transformed
          return rewriteToolDescriptions(prunePtcReplace(transformed, context), context)
        } catch (error) {
          return transformed
        }
      },
    )
  }

  // ---- section 注册：共享 catalog + 每个 Agent scope 独立选择 preset。 
  var registeredByAgent = new Map()
  var PRESET_IDS = ['standard', 'ptc', 'cordis', 'minimal']

  /** 1.4.36：装配 context 对应的模式（与 capture 同源：优先 session header）。 */
  function presetOfContext(context) {
    var agent = context && context.agent
    var header = agent && agent.session && agent.session.header
    if (header && typeof header.agentPreset === 'string' && header.agentPreset) return header.agentPreset
    return presetForAgent(agent)
  }

  function presetForAgent(agent) {
    try {
      var preset = ctx.agentPresets.composedPreset(agent && agent.ctx)
      return typeof preset === 'string' && preset ? preset : 'standard'
    } catch (error) {
      return 'standard'
    }
  }

  function activeIdForPreset(value, presetId) {
    var map = value && value.activeByPreset && typeof value.activeByPreset === 'object' ? value.activeByPreset : null
    if (map && typeof map[presetId] === 'string' && map[presetId]) return map[presetId]
    // 兼容 0.4.84 以前的单一 active：只迁移到 standard，不把它偷偷套给其他 preset。
    if (presetId === 'standard' && value && typeof value.active === 'string' && value.active) return value.active
    // 0.4.90：每个模式的默认 = 它自己的内置模板（单射：mode -> builtin:mode）。
    return 'builtin:' + presetId
  }

  function currentSpec(presetId) {
    presetId = presetId || 'standard'
    var value = findValue()
    if (!value || value.enabled === false) return null
    var active = activeIdForPreset(value, presetId || 'standard')
    // 0.4.90：内置模板（builtin:<mode>）与旧的 'default' 语义相同——都表示
    // 「用该模式自己的 DSH 默认提示词」，dsh-polish 不额外注册 section。
    if (active === 'default') return null
    if (typeof active === 'string' && active.indexOf('builtin:') === 0) return null
    var list = Array.isArray(value.custom) ? value.custom : []
    for (var i = 0; i < list.length; i++) {
      var entry = list[i]
      if (entry && entry.id === active && typeof entry.content === 'string' && entry.content.trim() !== '') {
        return { id: String(entry.id), mode: entry.mode === 'replace' ? 'replace' : 'append', content: entry.content }
      }
    }
    return null
  }

  function disposeRegistration(reg) {
    if (!reg) return
    try {
      if (typeof reg.disposer === 'function') reg.disposer()
    } catch (error) {}
  }

  // 0.4.91：每个 agent 一份注册；「整份替换」**同名顶替 persona 槽位**。
  //
  // 冲突根因（用户实测报错 multiple complete prompt sections are active:
  // "deployment:persona-prefix", "dsh-polish:custom-prompt"）：DSH 核心在装配
  // 时看到两个 complete section 就抛错（该会话的模型调用直接失败）。minimal
  // preset 自己的 persona 行就是 complete: true（dsh-persona 注册
  // deployment:persona-prefix），我的「整份替换」又注册了第二个 complete
  // section → 冲突。
  //
  // 修法（结构上不可能再冲突）：DSH 的合并规则是「同名 section 由更近的作用域
  // 顶替」（agent scope 比 preset 的 generation scope 近）——所以「整份替换」
  // 不再另起 complete section，而是**顶替 persona 槽位**并标记 complete：
  // 全场只剩一个 complete section。
  //
  // 附带修掉一个更隐蔽的 bug：旧版还有一个**全局**注册（standard 模式的内容），
  // 而每个 agent 的注册只在「该模式选了自定义模板」时存在 → 选了内置模板的
  // agent 会继承那个全局注册 → standard 的自定义文本泄漏进 ptc/cordis 会话。
  // 现在只有 per-agent 注册（选内置时内容为空）。
  function syncAgentSection(agent) {
    if (!agent || !agent.id || !agent.ctx || !agent.ctx.systemPrompt) return
    var presetId = presetForAgent(agent)
    var spec = currentSpec(presetId)
    var personaComplete = personaIsComplete(presetId)
    var plan = null
    if (spec) {
      if (isPtcReplace(presetId, spec)) {
        // 1.4.35：ptc 整份替换 = 普通 section + 瀑布里收敛（见 prunePtcReplace），
        // 以保留 ptc 规则与 SDK。
        plan = { name: SECTION_NAME, complete: false }
      } else if (spec.mode === 'replace' || personaComplete) {
        // 顶替 persona 槽位（complete：整份提示词 = 这一段）
        plan = { name: PERSONA_PREFIX_SECTION, complete: true }
      } else {
        // 附加：落在 persona 之后、工具说明之前
        plan = { name: SECTION_NAME, complete: false }
      }
    }
    var key =
      presetId +
      ':' +
      (spec ? spec.id + ':' + spec.mode : 'builtin') +
      ':' +
      (plan ? plan.name : '-') +
      ':' +
      (personaComplete ? 'p1' : 'p0')
    var old = registeredByAgent.get(agent.id)
    if (old && old.key === key) return
    if (old) {
      disposeRegistration(old)
      registeredByAgent.delete(agent.id)
    }
    if (!spec || !plan) return
    var reg = { key: key, id: spec.id, mode: spec.mode, presetId: presetId, agentId: agent.id, name: plan.name }
    try {
      reg.disposer = agent.ctx.systemPrompt.section({
        name: plan.name,
        order: 0,
        text: function (context) {
          var cur = currentSpec(reg.presetId)
          if (!cur || cur.id !== reg.id || cur.mode !== reg.mode) return ''
          var out
          if (reg.name === PERSONA_PREFIX_SECTION) {
            if (cur.mode === 'replace') {
              out = cur.content
            } else {
              // preset 的 persona 本身就是 complete（minimal）：附加 = persona + 自定义
              var persona = presetPersona(reg.presetId)
              var base = persona && typeof persona.prefix === 'string' ? persona.prefix : ''
              out = base ? base + '\n\n' + cur.content : cur.content
            }
          } else {
            out = cur.content
          }
          // 1.4.1：{{model}}/{{provider}} 在此代入（context.agent 来自
          // assembleContextFor，每次装配实时求值）；任何异常/无值都退回
          // 原文，绝不影响装配。
          try {
            return interpolateTemplate(out, context)
          } catch (error) {
            return out
          }
        },
        interpolate: false,
        complete: plan.complete,
      })
      registeredByAgent.set(agent.id, reg)
    } catch (error) {}
  }

  function syncAgentSections() {
    try {
      var list = ctx.agents.list()
      for (var i = 0; i < list.length; i++) syncAgentSection(list[i])
    } catch (error) {}
  }

  function unregisterAgent(agent) {
    if (!agent || !agent.id) return
    var reg = registeredByAgent.get(agent.id)
    if (reg) disposeRegistration(reg)
    registeredByAgent.delete(agent.id)
  }

  function syncSection() {
    syncAgentSections()
    scheduleBuiltinRefresh()
  }
  // 0.4.93：内置模板内容的**第二条通道**——宿主路由（设置行之外）。
  // 设置行是 volatile 通道（可能被别的写入覆盖/拒绝），路由是纯读通道：
  // 页面打开即取，无需任何模型调用，也不需要「探测」。
  ctx.effect(
    function () {
      if (!ctx.connection || !ctx.connection.fetch || typeof ctx.connection.fetch.register !== 'function') return
      ctx.connection.fetch.register({
        path: '/api/dshp/prompts/builtins',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async function () {
          try {
            return new Response(JSON.stringify({ ok: true, builtins: builtinsSnapshot() }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String((error && error.message) || error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          }
        },
      })
    },
    'dsh-polish: prompts builtins route',
  )

  // 0.4.94：按需刷新「模型实际看到的」——不消耗任何模型调用/token。
  //   优先用**正在运行的**该 preset agent 的 generation scope 真实装配
  //   （与模型调用同一 scope，含本组件注册的自定义 section），拿到的
  //   effective 就是下一次请求里系统提示词的真实形态（工具 JSON 定义
  //   走 assembly.tools 独立通道，与预览口径一致地不展示）；没有 agent
  //   时退回 preset scope 装配 + 本地按模式组合（与页面近似规则一致）。
  //   返回 { ok, preset, source: 'agent-scope'|'preset-scope', effective, defaultText, template, defaultTemplate, variables, updatedAt }。
  //   preset-scope 通过 probeScopes 标记；agent-scope 保留真实 ScopeKey，
  //   另用本次 assemble 的 AbortSignal 标记，避免把探测写成预览。
  var lastProbeAt = 0
  var PROBE_DEBOUNCE_MS = 1000
  async function probeEffective(presetId) {
    var spec = null
    try {
      spec = currentSpec(presetId)
    } catch (error) {}
    var mode = spec ? spec.mode : ''
    var agentScope = null
    var probeAgent = null
    if (presetId) {
      var scopeMod = await loadScopeModule()
      if (scopeMod) {
        var agents = []
        try {
          agents = ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : []
        } catch (error) {}
        for (var i = 0; i < agents.length; i++) {
          var agent = agents[i]
          if (!agent || !agent.ctx) continue
          var composed = null
          try {
            composed = ctx.agentPresets && typeof ctx.agentPresets.composedPreset === 'function' ? ctx.agentPresets.composedPreset(agent.ctx) : null
          } catch (error) {}
          if (composed !== presetId) continue
          var own = null
          try {
            own = scopeMod.scopeOf(agent.ctx)
          } catch (error) {}
          // 实时探测必须用 agent 自身 scope：scopeParentOf(own) 会退回 preset
          // composition scope，漏掉注册在 agent.ctx 上的 dsh-polish 自定义 section。
          var key = own
          if (!key) key = scopeKeyOfCtx(agent.ctx)
          if (key) {
            agentScope = key
            probeAgent = agent
            break
          }
        }
      }
    }
    if (agentScope) {
      // Scope 必须保持为 agentScope，不能改用伪 key；用本次显式装配专属的
      // AbortSignal 做水幕标记，避免和同 agent 的真实请求互相屏蔽。
      // withBuiltinTimeout 只返回 fallback、不取消底层 Promise，因此标记要在
      // 底层装配 settle 时清理，不能在超时返回后提前删除。
      var probeController = new AbortController()
      var probeSignal = probeController.signal
      probeSignals.add(probeSignal)
      var probePromise = (async function () {
        var assembly = await ctx.systemPrompt.assemble({ scope: agentScope, signal: probeSignal })
        var sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
        var body = []
        var bodyWithMine = []
        // 装配 context 故意不带 agent（避免触发 DSH 各 assemble 监听器的
        // agent 侧分支，如 session-reference 路由捕获）；{{model}} 的代入
        // 在下面用 live agent 的 options 事后补做，与真实请求同源。
        var probeCtx = probeAgent ? { agent: probeAgent } : {}
        for (var i2 = 0; i2 < sections.length; i2++) {
          var sec = sections[i2]
          if (!sec) continue
          if (isToolSection(sec.name)) continue
          if (isOwnSection(sec, probeCtx)) bodyWithMine.push(sec)
          else {
            body.push(sec)
            bodyWithMine.push(sec)
          }
        }
        var variables = (assembly && assembly.variables) || {}
        var eff = ''
        var def = ''
        try {
          eff = mode === 'replace' ? (spec ? String(spec.content || '') : '') : renderSections(bodyWithMine, variables)
          if (isPtcReplace(presetId, spec)) {
            // 1.4.35：ptc 整份替换会自动保留 tools:ptc-only（用户文本已含则不重复）。
            for (var pj = 0; pj < sections.length; pj++) {
              var ruleSec = sections[pj]
              var rule = ruleSec && ruleSec.name === PTC_ONLY_SECTION && typeof ruleSec.text === 'string' ? ruleSec.text.trim() : ''
              if (rule && eff.indexOf(rule) < 0) eff = eff + '\n\n' + rule
            }
          }
        } catch (error) {
          eff = ''
        }
        try {
          eff = interpolateTemplate(eff, probeCtx)
        } catch (error) {}
        try {
          def = renderSections(body, variables)
        } catch (error) {
          def = ''
        }
        try {
          def = interpolateTemplate(def, probeCtx)
        } catch (error) {}
        return {
          effective: eff,
          defaultText: def,
          template: joinRaw(bodyWithMine),
          defaultTemplate: joinRaw(body),
          variables: variableList(variables),
        }
      })()
      var trackedProbePromise = Promise.resolve(probePromise).then(
        function (result) {
          probeSignals.delete(probeSignal)
          return result
        },
        function (error) {
          probeSignals.delete(probeSignal)
          throw error
        },
      )
      var rawResult = await withBuiltinTimeout(trackedProbePromise, null)
      if (rawResult && (rawResult.effective || rawResult.defaultText)) {
        return {
          ok: true,
          preset: presetId,
          source: 'agent-scope',
          effective: rawResult.effective || '',
          defaultText: rawResult.defaultText || '',
          template: rawResult.template || '',
          defaultTemplate: rawResult.defaultTemplate || '',
          variables: rawResult.variables || [],
          updatedAt: Date.now(),
        }
      }
    }
    // preset-scope 回退：DSH 默认来自 preset 定义装配（无模型调用）。
    var presetResult = await withBuiltinTimeout(assemblePresetPrompt(presetId), null)
    var dshDefault = presetResult && presetResult.text ? presetResult.text : ''
    var dshTemplate = presetResult && presetResult.template ? presetResult.template : ''
    var content = spec && typeof spec.content === 'string' ? spec.content : ''
    var eff2 = ''
    var tpl2 = ''
    if (spec && mode === 'replace') {
      eff2 = content
      tpl2 = content
    } else if (spec && content) {
      eff2 = content + (dshDefault ? '\n\n' + dshDefault : '')
      tpl2 = content + (dshTemplate ? '\n\n' + dshTemplate : '')
    } else {
      eff2 = dshDefault
      tpl2 = dshTemplate
    }
    return {
      ok: true,
      preset: presetId,
      source: 'preset-scope',
      effective: eff2,
      defaultText: dshDefault,
      template: tpl2,
      defaultTemplate: dshTemplate,
      variables: [],
      updatedAt: Date.now(),
    }
  }
  ctx.effect(
    function () {
      if (!ctx.connection || !ctx.connection.fetch || typeof ctx.connection.fetch.register !== 'function') return
      ctx.connection.fetch.register({
        path: '/api/dshp/prompts/probe',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async function (req) {
          var body = null
          try {
            body = req && typeof req.json === 'function' ? await req.json() : null
          } catch (error) {}
          var preset = body && typeof body.preset === 'string' && body.preset ? body.preset : 'standard'
          if (Date.now() - lastProbeAt < PROBE_DEBOUNCE_MS) {
            return new Response(JSON.stringify({ ok: false, error: 'debounce' }), {
              status: 429,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          }
          lastProbeAt = Date.now()
          try {
            return new Response(JSON.stringify(await probeEffective(preset)), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String((error && error.message) || error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          }
        },
      })
    },
    'dsh-polish: prompts probe route',
  )

  ctx.effect(
    function () {
      if (!ctx.connection || !ctx.connection.fetch || typeof ctx.connection.fetch.register !== 'function') return
      ctx.connection.fetch.register({
        path: '/api/dshp/prompts/tools',
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async function () {
          try {
            return new Response(JSON.stringify({ ok: true, tools: await readToolCatalog(), updatedAt: Date.now() }), {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          } catch (error) {
            return new Response(JSON.stringify({ ok: false, error: String((error && error.message) || error) }), {
              status: 500,
              headers: { 'content-type': 'application/json; charset=utf-8' },
            })
          }
        },
      })
    },
    'dsh-polish: prompts tools route',
  )

  var stopCapture = null
  ctx.effect(
    function () {
      stopCapture = ctx.on('system-prompt/assemble', onAssemble)
              var stopAgentCreated = null
       var stopAgentDisposed = null
       var stopPresetSelected = null
       if (ctx.agents && ctx.agentPresets) {
         stopAgentCreated = ctx.on('agent/created', function (payload) {
           if (payload && payload.agent) syncAgentSection(payload.agent)
         })
         stopAgentDisposed = ctx.on('agent/disposed', function (payload) {
           if (payload && payload.agent) unregisterAgent(payload.agent)
         })
         stopPresetSelected = ctx.on('agent-preset/selected', function (sessionId) {
           try {
             var agent = ctx.agents.get(sessionId)
             if (agent) syncAgentSection(agent)
           } catch (error) {}
         })
       }
       syncSection()
        // 
        
      try {
        var builtinPromise = refreshBuiltins()
        if (builtinPromise && typeof builtinPromise.catch === 'function') builtinPromise.catch(function () {})
      } catch (error) {}
      
      return function () {
        try { if (typeof stopAgentCreated === 'function') stopAgentCreated() } catch (error) {}
        try { if (typeof stopAgentDisposed === 'function') stopAgentDisposed() } catch (error) {}
        try { if (typeof stopPresetSelected === 'function') stopPresetSelected() } catch (error) {}
        registeredByAgent.forEach(function (reg) { disposeRegistration(reg) })
        registeredByAgent.clear()
        if (stopCapture) {
          try {
            stopCapture()
          } catch (error) {}
          stopCapture = null
        }
      }
    },
    'dsh-polish: prompts lifecycle',
  )

  // =====================================================================
  // 1.4.1 上下文嵌入（context-embedding）
  //
  // 接管三类 DSH 框架注入的上下文（全部是 user-role 持久消息，不在系统
  // 提示词里；模型每次请求都看到）：
  //   1) runtime-context 快照：dsh-agent-loop 每步把注册过的动态 context
  //      （working-directory:current / sandbox:policy / approval:policy /
  //      harness:source / app:web-surface）拼成一条「Current runtime
  //      context. This snapshot supersedes ...」消息。正文来源 = registry
  //      里各 context 的 text 函数（assemble 与 step() 提交前的
  //      refreshContext 两条路都读它）→ 本组件用 **agent scope 同名
  //      context 重注册**（scoped 层 shadow global 层）逐 section 改写/置空；
  //      总开关用 suppressRuntimeContext() 压制全部 optional。
  //   2) skill-catalog / 3) time-context：核心包在 agent/pre-step 水幕里
  //      追加的消息（普通提交路径）→ 本组件挂一条 **prepend（最外层）**
  //      监听器，在 next() 之后看到含这两条消息的最终 decision，按配置
  //      整条改写 text（保留 message id 与 source —— catalog 的 digest
  //      闭环读 source.entries，保源才能恒等）或整条删除。
  //
  // 隔离原则（用户铁律）：
  //   · 全部默认 keep/enabled = 与 DSH 原行为完全一致：**零改写**（不注册
  //     shadow、不挂 pre-step 监听器、不 suppress）。
  //   · 本块只新增（独立 state / 独立 effect / 独立水幕监听器），不改动
  //     既有 prompts 代码路径；effect 反注册（关行/卸载）后一切还原。
  //   · 模板变量 fail-open：未知/无值的 {{...}} 保留原文，永不抛错。
  //
  // 生效时机：assemble 水幕（每模型步、在 pre-step 水幕与 step() 的
  // refreshContext 之前）→ 配置热变更在**下一个模型步**即生效，历史消息
  // 不改写（日志 append-only）。
  //
  // 改不了的：快照包装句与 CLEARED 句是 dsh-system-prompt 固定字符串
  // （joinContextSections），提交点在 step() 内部直接 session.append，
  // 中间无钩子 → 总关闭的极限 = 模型收到一次 CLEARED 句后静默。
  // =====================================================================

  var CTX_SECTION_DEFS = [
    { name: 'working-directory:current', orderKey: 'WORKING_DIRECTORY', required: true, customAllowed: true },
    { name: 'sandbox:policy', orderKey: 'SANDBOX_POLICY', required: false, customAllowed: false },
    { name: 'approval:policy', orderKey: 'APPROVAL_POLICY', required: false, customAllowed: false },
    { name: 'harness:source', orderKey: 'HARNESS_SOURCE', required: false, customAllowed: true },
    { name: 'app:web-surface', orderKey: 'WEB_SURFACE', required: false, customAllowed: true },
  ]
  // custom 模式未填模板时的兜底（= DSH 原文案 + 变量）；与客户端预填同文。
  var CTX_DEFAULT_TEMPLATES = {
    'working-directory:current': 'Current working directory: {{cwd}}.',
    'harness:source': 'Current DeepSeek Harness implementation checkout: {{checkout}}.',
    'app:web-surface': 'Current DeepSeek Harness Web GUI URL: {{webUrl}}.',
    'skill-catalog':
      '<system-reminder>\n{{note}}\n\n<available_skills>\n{{entries}}\n</available_skills>\n\n' +
      'If the user names a skill, or the task clearly matches a skill\'s description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\'s instructions until it has been loaded.\n' +
      'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.\n' +
      '</system-reminder>',
    'time-context': 'Time sampled while preparing turn {{turn}}, step {{step}}: {{timestamp}}',
    // 只包裹原文：默认 custom 模板 = 原文逐字节不变（用户可加前缀/后缀）。
    'model-selection': '{{text}}',
    // 指令文件（dsh-agent-instructions 注入的 user 消息）：默认模板同样是
    // 原文逐字节不变，{{files}} 给出本步涉及的文件；整类可以关掉。
    'agent-instructions': '{{text}}',
  }

  var ctxShadowsByAgent = new Map() // agentId -> { key, disposers: [fn] }
  var ctxSuppressDisposer = null
  var ctxPrestepStop = null
  var ctxHostState = null
  var ctxPreviewLastJson = null
  // 加载期捕获的静态值（harness checkout 路径 / Web GUI URL）——
  // app:web-surface 文案由核心在装配时用其自身注入的 webApp 渲染，
  // 本插件 ctx 上不一定有 webApp（headless 没有）→ 捕获一次即可。
  var ctxCaptured = { checkout: '', webUrl: '' }

  /** 读本行设置里的 contextEmbedding（手动校验，fail-open 到 keep）。 */
  function ceRead() {
    var value = findValue()
    var ce = value && value.contextEmbedding && typeof value.contextEmbedding === 'object' ? value.contextEmbedding : {}
    var rc = ce.runtimeContext && typeof ce.runtimeContext === 'object' ? ce.runtimeContext : {}
    var secs = rc.sections && typeof rc.sections === 'object' ? rc.sections : {}
    var out = {
      runtimeEnabled: rc.enabled !== false,
      sections: {},
      catalogMode: 'keep',
      catalogTemplate: '',
      timeMode: 'keep',
      timeTemplate: '',
      modelSelectionMode: 'keep',
      modelSelectionTemplate: '',
      compactionMode: 'keep',
      compactionTemplate: '',
    }
    for (var i = 0; i < CTX_SECTION_DEFS.length; i++) {
      var def = CTX_SECTION_DEFS[i]
      var s = secs[def.name]
      var mode = 'keep'
      var template = ''
      if (s && typeof s === 'object') {
        if (s.mode === 'off') mode = 'off'
        else if (s.mode === 'custom' && def.customAllowed === true) mode = 'custom'
        // sandbox:policy / approval:policy 是会话中可切的动态状态（mode/policy
        // 事件）——静态 custom 文案会陈旧，给模型错误信息比不给更糟 → v1 只
        // 允许 keep/off（UI 不展示 custom 选项；这里双保险）。
        if (typeof s.template === 'string') template = s.template
      }
      out.sections[def.name] = { mode: mode, template: template }
    }
    var sc = ce.skillCatalog && typeof ce.skillCatalog === 'object' ? ce.skillCatalog : {}
    out.catalogMode = sc.mode === 'off' || sc.mode === 'custom' ? sc.mode : 'keep'
    out.catalogTemplate = typeof sc.template === 'string' ? sc.template : ''
    var tc = ce.timeContext && typeof ce.timeContext === 'object' ? ce.timeContext : {}
    out.timeMode = tc.mode === 'off' || tc.mode === 'custom' ? tc.mode : 'keep'
    out.timeTemplate = typeof tc.template === 'string' ? tc.template : ''
    var ms = ce.modelSelection && typeof ce.modelSelection === 'object' ? ce.modelSelection : {}
    out.modelSelectionMode = ms.mode === 'off' || ms.mode === 'custom' ? ms.mode : 'keep'
    out.modelSelectionTemplate = typeof ms.template === 'string' ? ms.template : ''
    // 1.4.22：指令文件（AGENTS.md 一类）也是可以改的上下文——「只要是上下文，
    // 能改的都得能改」。keep = 核心原文；off = 整条不发；custom = 用模板包住
    // 原文（{{text}} / {{files}}）。
    var ai = ce.agentInstructions && typeof ce.agentInstructions === 'object' ? ce.agentInstructions : {}
    out.agentInstructionsMode = ai.mode === 'off' || ai.mode === 'custom' ? ai.mode : 'keep'
    out.agentInstructionsTemplate = typeof ai.template === 'string' ? ai.template : ''
    // 1.4.17：压缩提示词（compaction 的末尾指令）也可改。keep = 核心原文，
    // custom = 本组件在 llm/stream 里替换那条 user 指令（见 ctxApplyCompaction）。
    var cp = ce.compaction && typeof ce.compaction === 'object' ? ce.compaction : {}
    out.compactionMode = cp.mode === 'custom' ? 'custom' : 'keep'
    out.compactionTemplate = typeof cp.template === 'string' ? cp.template : ''
    var ck = ce.checkpoint && typeof ce.checkpoint === 'object' ? ce.checkpoint : {}
    out.checkpointMode = ck.mode === 'custom' ? 'custom' : 'keep'
    out.checkpointTemplate = typeof ck.template === 'string' ? ck.template : ''
    return out
  }

  /** 模板变量（fail-open：解析不到就保留 {{...}} 原文）。 */
  function ctxTemplateVars(context) {
    var vars = {}
    try {
      var agent = context && context.agent
      if (agent && agent.options && typeof agent.options === 'object') {
        if (agent.options.model !== undefined && agent.options.model !== null && String(agent.options.model) !== '') vars.model = String(agent.options.model)
        if (agent.options.provider !== undefined && agent.options.provider !== null && String(agent.options.provider) !== '') vars.provider = String(agent.options.provider)
      }
      if (!vars.model || !vars.provider) {
        var fallbackRoute = ctxDefaultRoute()
        if (fallbackRoute) {
          if (!vars.model && fallbackRoute.model) vars.model = fallbackRoute.model
          if (!vars.provider && fallbackRoute.provider) vars.provider = fallbackRoute.provider
        }
      }
      if (agent && agent.session) {
        var cwd = null
        try {
          if (ctx.sessionProjections && typeof ctx.sessionProjections.stateOf === 'function') {
            cwd = ctx.sessionProjections.stateOf(agent.session, 'workingDirectory')
          }
        } catch (error) {}
        if (!cwd && agent.session.header && typeof agent.session.header.cwd === 'string') cwd = agent.session.header.cwd
        if (cwd) vars.cwd = cwd
      }
    } catch (error) {}
    // 1.4.22：{{webUrl}} 曾经一直是字面量——探针捕获只在加载时跑一次，而
    // webApp 的公开地址要等服务器起来才有值；随后又被缓存成空串，于是
    // shadow 文案里永远留着 {{webUrl}}。现在每次求值都现取一次，成功即缓存，
    // 并补一条 webServer.getOrigin() 的后路（headless/自定义端口都覆盖）。
    var web = ctxWebUrl()
    if (web) vars.webUrl = web
    if (ctxCaptured.checkout) vars.checkout = ctxCaptured.checkout
    return vars
  }

  /** The Web GUI URL, resolved on demand: webApp → webServer → last capture. */
  function ctxWebUrl() {
    if (ctxCaptured.webUrl) return ctxCaptured.webUrl
    try {
      var webApp = ctx.webApp
      if (!webApp && typeof ctx.get === 'function') webApp = ctx.get('webApp')
      if (webApp && typeof webApp.getAdvertisedUrl === 'function') {
        var advertised = String(webApp.getAdvertisedUrl() || '')
        if (advertised) {
          ctxCaptured.webUrl = advertised
          return advertised
        }
      }
    } catch (error) {}
    try {
      var server = ctx.webServer
      if (!server && typeof ctx.get === 'function') server = ctx.get('webServer')
      if (server && typeof server.getOrigin === 'function') {
        var origin = String(server.getOrigin() || '')
        if (origin) {
          ctxCaptured.webUrl = origin
          return origin
        }
      }
    } catch (error) {}
    return ''
  }

  function ctxInterpolate(text, vars) {
    if (typeof text !== 'string' || text.indexOf('{{') < 0) return text
    // 变量名允许大小写字母（webUrl）；未知变量保留原文（fail-open）。
    return text.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, function (whole, name) {
      var value = vars ? vars[name] : undefined
      return value === undefined || value === null ? whole : String(value)
    })
  }

  /** shadow context 的 text 函数：每次装配实时读本行设置（与既有 section
   *  同范式：内容变更零重注册；mode 变更由 maybeSync 重注册兜底）。 */
  function ctxShadowText(sectionName) {
    return function (context) {
      try {
        var c = ceRead()
        if (c.runtimeEnabled === false) return ''
        var s = c.sections[sectionName]
        if (!s || s.mode === 'keep' || s.mode === 'off') return ''
        var tpl = typeof s.template === 'string' && s.template !== '' ? s.template : CTX_DEFAULT_TEMPLATES[sectionName] || ''
        return ctxInterpolate(tpl, ctxTemplateVars(context))
      } catch (error) {
        return ''
      }
    }
  }

  /** 该 agent 的 shadow 注册状态键（内容相同 → 不重注册）。 */
  function ctxAgentShadowState(agentId) {
    var c = ceRead()
    if (c.runtimeEnabled === false) {
      // 总关闭：suppress 处理所有 optional；只有 required 的
      // working-directory:current 需要显式置空（required 不能删，registry
      // 会按名补回——补回取到的是我们的 scoped shadow ''，同样消失）。
      for (var k = 0; k < CTX_SECTION_DEFS.length; k++) {
        if (CTX_SECTION_DEFS[k].required === true) return 'off::' + CTX_SECTION_DEFS[k].name + '=off'
      }
      return 'off::none'
    }
    var parts = []
    for (var i = 0; i < CTX_SECTION_DEFS.length; i++) {
      var def = CTX_SECTION_DEFS[i]
      var s = c.sections[def.name]
      if (s.mode === 'keep') parts.push(def.name + '=-')
      else parts.push(def.name + '=' + s.mode + (s.mode === 'custom' ? '$' + s.template : ''))
    }
    return parts.join(';')
  }

  function ctxDisposeShadows(state) {
    if (!state) return
    for (var i = 0; i < state.disposers.length; i++) {
      try {
        state.disposers[i]()
      } catch (error) {}
    }
  }

  /** 按当前配置对齐一个 agent 的 shadow 注册（幂等、零副作用于 keep）。 */
  function ctxSyncAgentShadows(agent) {
    try {
      if (!agent || !agent.id || !agent.ctx || !agent.ctx.systemPrompt || typeof agent.ctx.systemPrompt.context !== 'function') return
      var state = ctxAgentShadowState(agent.id)
      var old = ctxShadowsByAgent.get(agent.id)
      if (old && old.key === state) return
      if (old) {
        ctxDisposeShadows(old)
        ctxShadowsByAgent.delete(agent.id)
      }
      var c = ceRead()
      var disposers = []
      for (var i = 0; i < CTX_SECTION_DEFS.length; i++) {
        var def = CTX_SECTION_DEFS[i]
        var mode = c.runtimeEnabled === false ? (def.required === true ? 'off' : null) : c.sections[def.name].mode
        if (mode !== 'off' && mode !== 'custom') continue
        var order = 0
        try {
          var got = agent.ctx.systemPrompt.getContextOrder(def.orderKey)
          if (typeof got === 'number' && isFinite(got)) order = got
        } catch (error) {}
        var d = agent.ctx.systemPrompt.context({
          name: def.name,
          order: order,
          required: def.required === true,
          interpolate: false,
          text: ctxShadowText(def.name),
        })
        if (typeof d === 'function') disposers.push(d)
      }
      ctxShadowsByAgent.set(agent.id, { key: state, disposers: disposers })
    } catch (error) {}
  }

  function ctxUnsyncAgent(agent) {
    try {
      if (!agent || !agent.id) return
      var old = ctxShadowsByAgent.get(agent.id)
      if (old) {
        ctxDisposeShadows(old)
        ctxShadowsByAgent.delete(agent.id)
      }
    } catch (error) {}
  }

  /** 宿主层注册状态：suppress 开关 + pre-step 监听器开关（模板内容不参与
   *  —— 监听器/handler 每次事件实时读配置，内容变更零重注册）。 */
  function ctxHostRegistrationState() {
    var c = ceRead()
    var suppress = c.runtimeEnabled === false ? '1' : '0'
    var prestep = c.catalogMode === 'keep' && c.timeMode === 'keep' && c.modelSelectionMode === 'keep' && c.checkpointMode === 'keep' && c.agentInstructionsMode === 'keep' ? 'none' : 'on'
    return suppress + '::' + prestep
  }

  function ctxSyncHost() {
    var want = ctxHostRegistrationState()
    if (want === ctxHostState) return
    ctxHostState = want
    try {
      var wantSuppress = want.charAt(0) === '1'
      if (wantSuppress && !ctxSuppressDisposer) {
        if (ctx.systemPrompt && typeof ctx.systemPrompt.suppressRuntimeContext === 'function') {
          ctxSuppressDisposer = ctx.systemPrompt.suppressRuntimeContext()
        }
      } else if (!wantSuppress && ctxSuppressDisposer) {
        try {
          ctxSuppressDisposer()
        } catch (error) {}
        ctxSuppressDisposer = null
      }
      var wantPrestep = want.slice(-2) === 'on'
      if (wantPrestep && !ctxPrestepStop) {
        // prepend：核心包（dsh-time-context / dsh-tool-skill 等）都在
        // composition 期 prepend 注册，插件加载更晚 → 我们的监听器在
        // 水幕最外层，next() 返回的是含核心追加消息的最终 decision。
        var stop = ctx.on('agent/pre-step', ctxPrestepHandler, { prepend: true })
        ctxPrestepStop = typeof stop === 'function' ? stop : null
      } else if (!wantPrestep && ctxPrestepStop) {
        try {
          ctxPrestepStop()
        } catch (error) {}
        ctxPrestepStop = null
      }
    } catch (error) {}
  }

  /** skill-catalog entries 渲染（口径 = 核心 renderCatalogEntries）。 */
  function ctxRenderCatalogEntries(entries) {
    var lines = []
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]
      if (!e || typeof e !== 'object') continue
      var name = typeof e.name === 'string' ? e.name : ''
      if (!name) continue
      var desc = typeof e.description === 'string' ? e.description : ''
      lines.push('- `' + name + '`: ' + desc)
    }
    return lines.join('\n')
  }

  function ctxCatalogNote(source) {
    return source && source.update === true
      ? 'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:'
      : 'A skill is a reusable set of task-specific instructions. The following skills are available in this session:'
  }

  /** agent/pre-step 最外层监听器：只碰 skill-catalog / time-context 两种
   *  source kind；其余消息（inbox、runtime-context 占位符）原样透传
   * （占位符位置语义决定 step() 的提交位置逻辑，不可破坏）。 */
  function ctxPrestepHandler(payload, next) {
    return Promise.resolve(next()).then(function (decision) {
      try {
        if (!decision || decision.kind === 'reject' || !Array.isArray(decision.messages) || decision.messages.length === 0) return decision
        var c = ceRead()
        if (c.catalogMode === 'keep' && c.timeMode === 'keep' && c.modelSelectionMode === 'keep' && c.checkpointMode === 'keep' && c.agentInstructionsMode === 'keep') return decision
        var changed = false
        var out = decision.messages
        if (c.catalogMode === 'off') {
          var f1 = out.filter(function (m) {
            return !(m && m.source && m.source.kind === 'skill-catalog')
          })
          if (f1.length !== out.length) changed = true
          out = f1
        } else if (c.catalogMode === 'custom') {
          out = out.map(function (m) {
            if (!(m && m.source && m.source.kind === 'skill-catalog')) return m
            var entries = m.source.entries && Array.isArray(m.source.entries) ? m.source.entries : []
            var tpl = typeof c.catalogTemplate === 'string' && c.catalogTemplate.trim() !== '' ? c.catalogTemplate : CTX_DEFAULT_TEMPLATES['skill-catalog']
            var text = ctxInterpolate(tpl, {
              entries: ctxRenderCatalogEntries(entries),
              count: String(entries.length),
              note: ctxCatalogNote(m.source),
            })
            var cur = m.content && m.content[0] && typeof m.content[0].text === 'string' ? m.content[0].text : ''
            if (text === cur) return m
            changed = true
            // 保留 message id 与 source（含 entries）：dsh-tool-skill 下一步
            // 的 digest 比对读日志里 source.entries —— 保源 = digest 恒等 =
            // 不再触发 catalog-changed；保 id = 日志原位替换不累积。
            return Object.assign({}, m, { content: [{ type: 'text', text: text }] })
          })
        }
        if (c.timeMode === 'off') {
          var f2 = out.filter(function (m) {
            return !(m && m.source && m.source.kind === 'time-context')
          })
          if (f2.length !== out.length) changed = true
          out = f2
        } else if (c.timeMode === 'custom') {
          out = out.map(function (m) {
            if (!(m && m.source && m.source.kind === 'time-context')) return m
            var tpl = typeof c.timeTemplate === 'string' && c.timeTemplate.trim() !== '' ? c.timeTemplate : CTX_DEFAULT_TEMPLATES['time-context']
            var text = ctxInterpolate(tpl, {
              turn: String(payload && payload.turn !== undefined ? payload.turn : ''),
              step: String(payload && payload.step !== undefined ? payload.step : ''),
              timestamp: new Date().toISOString(),
            })
            var cur = m.content && m.content[0] && typeof m.content[0].text === 'string' ? m.content[0].text : ''
            if (text === cur) return m
            changed = true
            return Object.assign({}, m, { content: [{ type: 'text', text: text }] })
          })
        }
        if (c.modelSelectionMode === 'off') {
          var f3 = out.filter(function (m) {
            return !(m && m.source && m.source.kind === 'model-selection')
          })
          if (f3.length !== out.length) changed = true
          out = f3
        } else if (c.modelSelectionMode === 'custom') {
          out = out.map(function (m) {
            if (!(m && m.source && m.source.kind === 'model-selection')) return m
            var original = m.content && m.content[0] && typeof m.content[0].text === 'string' ? m.content[0].text : ''
            var tpl = typeof c.modelSelectionTemplate === 'string' && c.modelSelectionTemplate.trim() !== '' ? c.modelSelectionTemplate : CTX_DEFAULT_TEMPLATES['model-selection']
            var text = ctxInterpolate(tpl, {
              text: original,
              kind: 'model-selection',
              model: String((payload && payload.agent && payload.agent.options && payload.agent.options.model) || ''),
              provider: String((payload && payload.agent && payload.agent.options && payload.agent.options.provider) || ''),
            })
            if (text === original) return m
            changed = true
            return Object.assign({}, m, { content: [{ type: 'text', text: text }] })
          })
        }
        // 1.4.18：压缩检查点的前缀句。核心 frameSummary() 的第一条 text 块是
        // `CHECKPOINT_PREAMBLE + "\n\n<compacted-summary>"`；只换标签之前那段，
        // 标签与其后的摘要正文逐字保留。找不到标签就整条不动（未知形态不猜）。
        if (c.checkpointMode === 'custom' && typeof c.checkpointTemplate === 'string' && c.checkpointTemplate.trim() !== '') {
          out = out.map(function (m) {
            if (!(m && m.source && m.source.kind === 'compact-checkpoint')) return m
            var blocks = Array.isArray(m.content) ? m.content : []
            if (blocks.length === 0 || !blocks[0] || blocks[0].type !== 'text') return m
            var head = typeof blocks[0].text === 'string' ? blocks[0].text : ''
            var at = head.lastIndexOf('<compacted-summary>')
            if (at < 0) return m
            var text = ctxInterpolate(c.checkpointTemplate, {}) + '\n\n' + head.slice(at)
            if (text === head) return m
            changed = true
            var nextBlocks = blocks.slice()
            nextBlocks[0] = Object.assign({}, blocks[0], { text: text })
            return Object.assign({}, m, { content: nextBlocks })
          })
        }
        // 1.4.22：指令文件（dsh-agent-instructions 注入的 user 消息）。
        // keep = 原样；off = 整条不发；custom = 模板包住原文，默认模板
        // `{{text}}` 逐字节等于原文，{{files}} 列出本步涉及的文件。
        if (c.agentInstructionsMode === 'off') {
          var f4 = out.filter(function (m) {
            return !(m && m.source && m.source.kind === 'agent-instructions')
          })
          if (f4.length !== out.length) changed = true
          out = f4
        } else if (c.agentInstructionsMode === 'custom') {
          out = out.map(function (m) {
            if (!(m && m.source && m.source.kind === 'agent-instructions')) return m
            var original = m.content && m.content[0] && typeof m.content[0].text === 'string' ? m.content[0].text : ''
            var changes = m.source.changes && Array.isArray(m.source.changes) ? m.source.changes : []
            var files = []
            for (var f5 = 0; f5 < changes.length; f5++) {
              if (changes[f5] && typeof changes[f5].path === 'string') files.push(changes[f5].path)
            }
            var tpl2 = typeof c.agentInstructionsTemplate === 'string' && c.agentInstructionsTemplate.trim() !== '' ? c.agentInstructionsTemplate : CTX_DEFAULT_TEMPLATES['agent-instructions']
            var text2 = ctxInterpolate(tpl2, { text: original, files: files.join(', '), count: String(files.length) })
            if (text2 === original) return m
            changed = true
            return Object.assign({}, m, { content: [{ type: 'text', text: text2 }] })
          })
        }
        if (!changed) return decision
        return Object.assign({}, decision, { messages: out })
      } catch (error) {
        return decision
      }
    })
  }
  // ── 注入消息观察（session/event，零请求影响） ──
  // 这份观察只为一件事：让页面上每一类可调项显示「最近实际注入的正文」。
  // 1.4.17 删掉了按 kind 罗列的「全部注入通道（实况）」表——它有 26 行、
  // 其中 22 行不可操作，用户的原话是「除了让 UI 变丑以外没有一点用」。
  // 观察本身保留（行内的「最近实际注入值」还依赖它），只是不再有那张表。
  // 页面的分类固定为：运行时快照 / 技能提示 / 压缩提示 / 时间提示 /
  // 模型切换提示，每一类都有对应的开关。
  // 1.4.14 按会话分桶。1.4.13 只有一个全局指针：主管会话、子代理会话、
  // session-slim 新建会话的 session/event 交替到达时，每次换会话都先清空
  // 再过滤，而真实用户消息（source.kind='user'）又直接 return ——结果就是
  // 「全部注入通道」几乎永远空表（持久化里 injected: []），页面还显示
  // 0×/未捕获。现在每个会话各记一份，展示「最近有注入的那个会话」；
  // 别的会话的消息不再抹掉已有记录。
  var ctxInjectedBySession = new Map() // sid -> { sid, kinds: { kind -> entry }, count, lastAt }
  var CTX_SESSION_BUCKETS = 8
  var ctxInjectedList = []
  var ctxInjectedJson = ''
  var ctxInjectedTimer = null
  var ctxPreviewContextsCache = []
  var ctxRuntimeSnapshotCache = null
  var ctxCompactionPreview = null
  var ctxPreviewPublishedAt = 0

  /** 一条消息的可读正文（text 块；developer 的 tool-addition/removal 逐条列出；兜底 source.summary）。 */
  function ctxMessageText(data) {
    var blocks = data && Array.isArray(data.content) ? data.content : []
    var parts = []
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i]
      if (!b || typeof b !== 'object') continue
      if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) parts.push(b.text)
      else if (b.type === 'tool-addition') parts.push('+ ' + String(b.toolName || ''))
      else if (b.type === 'tool-removal') parts.push('- ' + String(b.toolName || ''))
    }
    if (parts.length === 0 && data && data.source && typeof data.source.summary === 'string') parts.push(data.source.summary)
    return parts.join('\n')
  }

  function ctxCompactionText(message) {
    var blocks = message && Array.isArray(message.content) ? message.content : []
    var parts = []
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i]
      if (block && block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
    }
    return parts.join('\n')
  }

  // Keep only the final compaction directive, never the replayed conversation.
  // The compaction input may contain private history, so the context UI records
  // only this directive and non-content metadata.
  function ctxCaptureCompaction(options) {
    try {
      var purpose = options && options.purpose
      if (purpose !== 'compaction' && purpose !== 'compaction-chunk') return
      var messages = options && Array.isArray(options.messages) ? options.messages : []
      if (messages.length === 0) return
      var tail = messages[messages.length - 1]
      if (!tail || tail.role !== 'user') return
      var instruction = ctxCompactionText(tail)
      if (!instruction) return
      var normalized = instruction.toLowerCase()
      if (normalized.indexOf('compaction engine') < 0 && normalized.indexOf('fold the following earlier messages') < 0) return
      var clipped = instruction.length > 4000 ? instruction.slice(0, 4000) + '…' : instruction
      ctxCompactionPreview = {
        sessionId: typeof options.sessionId === 'string' ? options.sessionId : '',
        purpose: purpose,
        provider: typeof options.provider === 'string' ? options.provider : '',
        model: typeof options.model === 'string' ? options.model : '',
        inputMessageCount: messages.length,
        instructionChars: instruction.length,
        instruction: clipped,
        truncated: instruction.length > 4000,
        capturedAt: Date.now(),
      }
      ctxPublishPreview()
    } catch (error) {}
  }

  /**
   * 1.4.17：用户可改压缩指令。核心把 COMPACTION_INSTRUCTION 作为压缩请求的
   * 最后一条 user 消息发出去（不是 system prompt），所以这不是 section，
   * 只能在 llm/stream 里换掉那一条。
   *   · 只处理 purpose='compaction'（最终检查点）；'compaction-chunk' 是分片
   *     预处理的局部指令，换掉会让每片按「整段历史」的口径缩写，保持原文。
   *   · 只换文本块，其余块（图片等）原样保留；认不出是压缩指令就完全不动。
   *   · 任何异常都吞掉：压缩本身绝不能因为本组件失败。
   */
  function ctxApplyCompaction(options) {
    try {
      if (!options || options.purpose !== 'compaction') return
      var c = ceRead()
      if (c.compactionMode !== 'custom') return
      var tpl = c.compactionTemplate
      if (typeof tpl !== 'string' || tpl.trim() === '') return
      var messages = Array.isArray(options.messages) ? options.messages : null
      if (!messages || messages.length === 0) return
      var tail = messages[messages.length - 1]
      if (!tail || tail.role !== 'user') return
      var original = ctxCompactionText(tail)
      if (!original) return
      var normalized = original.toLowerCase()
      if (normalized.indexOf('compaction engine') < 0 && normalized.indexOf('fold the following earlier messages') < 0) return
      var nextText = ctxInterpolate(tpl, {
        model: typeof options.model === 'string' ? options.model : '',
        provider: typeof options.provider === 'string' ? options.provider : '',
        turns: String(messages.length - 1),
      })
      if (!nextText || nextText === original) return
      var blocks = Array.isArray(tail.content) ? tail.content : []
      var nextBlocks = []
      var replaced = false
      for (var i = 0; i < blocks.length; i++) {
        var block = blocks[i]
        if (block && block.type === 'text') {
          if (replaced) continue
          var copyBlock = {}
          for (var key in block) if (Object.prototype.hasOwnProperty.call(block, key)) copyBlock[key] = block[key]
          copyBlock.text = nextText
          nextBlocks.push(copyBlock)
          replaced = true
        } else {
          nextBlocks.push(block)
        }
      }
      if (!replaced) return
      if (Object.isFrozen(tail)) {
        var messageCopy = {}
        for (var field in tail) if (Object.prototype.hasOwnProperty.call(tail, field)) messageCopy[field] = tail[field]
        messageCopy.content = nextBlocks
        if (Object.isFrozen(messages)) {
          var list = messages.slice()
          list[list.length - 1] = messageCopy
          options.messages = list
        } else {
          messages[messages.length - 1] = messageCopy
        }
        return
      }
      tail.content = nextBlocks
    } catch (error) {}
  }

  function ctxPublishPreview() {
    var wp = ctx.settings.update(NS, {
      contextPreview: {
        contexts: ctxPreviewContextsCache,
        runtimeSnapshot: ctxRuntimeSnapshotCache || undefined,
        injected: ctxInjectedList,
        compaction: ctxCompactionPreview || undefined,
        updatedAt: Date.now(),
      },
    })
    if (wp && typeof wp.catch === 'function') wp.catch(function () {})
    ctxPreviewPublishedAt = Date.now()
  }

  /** 主会话判定：子代理（delegationDepth > 0）的装配/快照不写「当前值」，
   *  否则页面的 cwd / 模型 / 各 section 预览会被子代理的值替换。 */
  function ctxIsMainSession(session) {
    try {
      var header = session && session.header
      if (header && typeof header.delegationDepth === 'number') return header.delegationDepth <= 0
    } catch (error) {}
    return true
  }

  /** 展示桶：优先主会话（delegationDepth 0），同层取最近一次注入。
   *  子代理会话有注入时不能把主管会话的表顶掉——那正是页面「忽有忽无」
   *  的另一种来源。 */
  function ctxDisplayBucket() {
    var best = null
    ctxInjectedBySession.forEach(function (bucket) {
      if (!bucket || bucket.count === 0) return
      if (!best) {
        best = bucket
        return
      }
      if (bucket.depth < best.depth) best = bucket
      else if (bucket.depth === best.depth && bucket.lastAt > best.lastAt) best = bucket
    })
    return best
  }

  function ctxFlushInjected() {
    ctxInjectedTimer = null
    var bucket = ctxDisplayBucket()
    var list = []
    if (bucket) {
      for (var kind in bucket.kinds) {
        if (!Object.prototype.hasOwnProperty.call(bucket.kinds, kind)) continue
        var v = bucket.kinds[kind]
        var text = typeof v.text === 'string' ? v.text : ''
        if (text.length > 4000) text = text.slice(0, 4000) + '…'
        list.push({ kind: kind, sessionId: bucket.sid, form: v.form || '', count: v.count, lastAt: v.lastAt || 0, text: text })
      }
    }
    list.sort(function (a, b) {
      return b.lastAt - a.lastAt
    })
    var json = JSON.stringify(list)
    if (json === ctxInjectedJson) return
    ctxInjectedJson = json
    ctxInjectedList = list
    try {
      ctxPublishPreview()
    } catch (error) {}
  }

  function ctxScheduleInjectedFlush() {
    if (ctxInjectedTimer) return
    try {
      ctxInjectedTimer = setTimeout(ctxFlushInjected, 300)
    } catch (error) {
      ctxInjectedTimer = null
      ctxFlushInjected()
    }
  }

  // 只读观察：不修改任何事件、不注册任何请求路径。日志 append 消息时入账。
  ctx.effect(
    function () {
      var stop = ctx.on('session/event', function (session, event) {
        try {
          if (!event || (event.type !== 'user/message' && event.type !== 'developer/message')) return
          var data = event.data
          var message = event.type === 'developer/message' ? data && data.message : data
          var sid = session && typeof session.id === 'string' ? session.id : ''
          if (!sid) return
          var source = message && message.source
          var kind = source && source.kind
          // 1.4.3：不再按登记表过滤——登记表只用于「已知通道的说明」，
          // 未登记的 kind 照样入账（页面会以「未收录」标出），否则新通道
          // 会被静默丢弃。真实用户/助手消息不是注入，跳过。
          if (!kind || kind === 'user' || kind === 'assistant') return
          var bucket = ctxInjectedBySession.get(sid)
          if (!bucket) {
            while (ctxInjectedBySession.size >= CTX_SESSION_BUCKETS) {
              var oldestKey = null
              var oldestAt = Infinity
              ctxInjectedBySession.forEach(function (candidate, key) {
                if (candidate && candidate.lastAt < oldestAt) {
                  oldestAt = candidate.lastAt
                  oldestKey = key
                }
              })
              if (oldestKey === null) break
              ctxInjectedBySession.delete(oldestKey)
            }
            var depth = 0
            try {
              var header = session && session.header
              if (header && typeof header.delegationDepth === 'number' && header.delegationDepth > 0) depth = header.delegationDepth
            } catch (error) {}
            bucket = { sid: sid, depth: depth, kinds: {}, count: 0, lastAt: 0 }
            ctxInjectedBySession.set(sid, bucket)
          }
          var entry = bucket.kinds[kind]
          if (!entry) entry = bucket.kinds[kind] = { form: '', count: 0, lastAt: 0, text: '' }
          entry.form = typeof source.form === 'string' ? source.form : ''
          entry.count += 1
          entry.lastAt = typeof event.time === 'number' ? event.time : Date.now()
          entry.text = ctxMessageText(message)
          bucket.count += 1
          bucket.lastAt = entry.lastAt
          if (kind === 'runtime-context' && source.form === 'snapshot' && ctxIsMainSession(session)) {
            var sourceSections = Array.isArray(source.sections) ? source.sections : []
            var sections = []
            for (var si = 0; si < sourceSections.length && si < 16; si++) {
              var section = sourceSections[si]
              if (!section || typeof section.name !== 'string') continue
              var sectionText = typeof section.text === 'string' ? section.text : ''
              if (sectionText.length > 4000) sectionText = sectionText.slice(0, 4000) + '…'
              sections.push({ name: section.name, text: sectionText })
            }
            var snapshotText = entry.text
            if (snapshotText.length > 12000) snapshotText = snapshotText.slice(0, 12000) + '…'
            ctxRuntimeSnapshotCache = {
              sessionId: sid,
              messageId: message && typeof message.id === 'string' ? message.id : '',
              eventSeq: event && typeof event.seq === 'number' ? event.seq : 0,
              form: source.form,
              capturedAt: typeof event.time === 'number' ? event.time : Date.now(),
              text: snapshotText,
              sections: sections,
            }
          }
          ctxScheduleInjectedFlush()
        } catch (error) {}
      })
      return function () {
        try {
          if (typeof stop === 'function') stop()
        } catch (error) {}
      }
    },
    'dsh-polish: prompts injected-context capture',
  )

  /** 加载期一次性装配（无 agent）：从核心自己渲染的 app:web-surface /
   *  harness:source 文案里提取静态值（headless 下该 section 不存在 →
   *  变量 fail-open 保留 {{...}}）。
   *  必须走探测 scope（probeScopes）：assemble 的 context 若无 scope，
   *  既有预览捕获的 isProbe 判定（scope 必须在 probeScopes 里）会落空，
   *  这次「非 agent 装配」会被当成真实模型步捕获 → 污染预览的
   *  lastEffective/previewCandidatePair 状态并写入一个错误预览。
   *  **每次探测用独立 key**：isProbe 检查发生在水幕 .then 里（晚于装配
   *  入口），若两次探测重叠且共用一个 key，先者的 unprobe 会让后者的
   *  检查落空（effect 重放/并发装配都能制造重叠）。 */
  var ctxStaticsProbeSeq = 0
  function ctxCaptureStatics() {
    try {
      if (!ctx.systemPrompt || typeof ctx.systemPrompt.assemble !== 'function') return
      ctxStaticsProbeSeq += 1
      var PROBE_KEY = 'dsh-polish:ctx-statics-' + ctxStaticsProbeSeq
      try {
        probeScopes.add(PROBE_KEY)
      } catch (error) {}
      var p
      try {
        p = ctx.systemPrompt.assemble({ scope: PROBE_KEY })
      } catch (error) {
        try {
          probeScopes.delete(PROBE_KEY)
        } catch (error2) {}
        return
      }
      if (!p || typeof p.then !== 'function') {
        try {
          probeScopes.delete(PROBE_KEY)
        } catch (error3) {}
        return
      }
      var unprobe = function () {
        try {
          probeScopes.delete(PROBE_KEY)
        } catch (error) {}
      }
      p.then(
        function (assembly) {
          var contexts = assembly && Array.isArray(assembly.contexts) ? assembly.contexts : []
          for (var i = 0; i < contexts.length; i++) {
            var item = contexts[i]
            if (!item || typeof item.text !== 'string' || item.text.length === 0) continue
            // DSH 直接内插原始路径（不 JSON.stringify）→ 引号前可以是单个
            // 反斜杠（Windows 目录路径以 \ 结尾）→ 用 [^"]* 取「首个引号到
            // 结尾引号」之间原文；JSON.parse 成功则反转义，失败则取原文。
            var m = /"([^"]*)"\s*\.\s*$/.exec(item.text)
            if (!m) continue
            var decoded = ''
            try {
              decoded = JSON.parse('"' + m[1] + '"')
            } catch (error) {
              decoded = m[1]
            }
            if (item.name === 'harness:source' && !ctxCaptured.checkout) ctxCaptured.checkout = decoded
            if (item.name === 'app:web-surface' && !ctxCaptured.webUrl) ctxCaptured.webUrl = decoded
          }
          unprobe()
        },
        function () {
          unprobe()
        },
      )
    } catch (error) {}
  }

  // ---- 临时压缩请求快照：只保存末尾指令，不留存压缩输入历史正文 ----
  // llm/stream 是同步 waterfall；该观察器必须同步返回 next() 的流对象。
  ctx.effect(
    function () {
      var stop = ctx.on('llm/stream', function (options, next) {
        // 改写必须在 next() 之前：下游拿到 options 就直接发请求了。
        try { ctxApplyCompaction(options) } catch (error) {}
        var stream = next()
        try { ctxCaptureCompaction(options) } catch (error) {}
        return stream
      })
      return function () {
        try { if (typeof stop === 'function') stop() } catch (error) {}
      }
    },
    'dsh-polish: prompts compaction prompt capture',
  )

  // ---- 水幕监听器：配置热同步（shadow/pre-step/suppress）+ context 值捕获
  // （页面「当前值」展示 / custom 模板预填）。
  // 1.4.14：注册必须在 next() **之前**。1.4.13 在 next() 之后才
  // ctxSyncAgentShadows()，而 base 处理器就是在 next() 里渲染 runtime-context
  // 快照——于是恢复会话/新 agent 的第一步永远取到核心原文（English 默认、
  // 生效的不是用户模板），第二步起才生效；用户看到的就是「设置根本没生效」。
  // 先同步、再 next()；捕获仍然在 next() 之后（要用最终 assembly），
  // 本监听器对 assembly 零改写。
  ctx.effect(
    function () {
      var stop = ctx.on(
        'system-prompt/assemble',
        function (assembly, context, next) {
          var isProbe = false
          try {
            isProbe = isProbeAssembly(context)
            if (!isProbe) {
              var agentBefore = context && context.agent
              if (agentBefore) ctxSyncAgentShadows(agentBefore)
              ctxSyncHost()
            }
          } catch (error) {}
          return Promise.resolve(next()).then(function (transformed) {
            try {
              if (!isProbe) {
                var agent = context && context.agent
                // 捕获只在「真实模型步装配」（context 带 agent）时做：
                // 探测装配（preset scope / agent scope probe）不写，避免污染。
                // 子代理的装配不写：页面显示的是主会话的当前值。
                if (agent && ctxIsMainSession(agent.session) && transformed && Array.isArray(transformed.contexts)) {
                  var list = []
                  for (var i = 0; i < transformed.contexts.length; i++) {
                    var item = transformed.contexts[i]
                    if (item && typeof item.name === 'string') {
                      list.push({ name: item.name, text: typeof item.text === 'string' ? item.text : '' })
                    }
                  }
                  var json = JSON.stringify(list)
                  if (json !== ctxPreviewLastJson) {
                    ctxPreviewLastJson = json
                    ctxPreviewContextsCache = list
                    ctxPublishPreview()
                  }
                }
              }
            } catch (error) {}
            return transformed
          })
        },
      )
      ctxCaptureStatics()
      return function () {
        try {
          if (typeof stop === 'function') stop()
        } catch (error) {}
      }
    },
    'dsh-polish: prompts context-embedding capture+sync',
  )

  // ---- agent 生命周期 + 宿主层（suppress / pre-step 监听器）
  ctx.effect(
    function () {
      var stopCreated = null
      var stopDisposed = null
      var stopSelected = null
      try {
        if (ctx.agents && typeof ctx.agents.list === 'function') {
          var list = ctx.agents.list()
          for (var i = 0; i < list.length; i++) {
            ctxSyncAgentShadows(list[i])
          }
        }
      } catch (error) {}
      try {
        if (ctx.agents) {
          stopCreated = ctx.on('agent/created', function (payload) {
            if (payload && payload.agent) ctxSyncAgentShadows(payload.agent)
          })
          stopDisposed = ctx.on('agent/disposed', function (payload) {
            if (payload && payload.agent) ctxUnsyncAgent(payload.agent)
          })
          stopSelected = ctx.on('agent-preset/selected', function (sessionId) {
            try {
              var agent = ctx.agents && typeof ctx.agents.get === 'function' ? ctx.agents.get(sessionId) : null
              if (agent) ctxSyncAgentShadows(agent)
            } catch (error) {}
          })
        }
      } catch (error) {}
      ctxSyncHost()
      return function () {
        try {
          if (typeof stopCreated === 'function') stopCreated()
        } catch (error) {}
        try {
          if (typeof stopDisposed === 'function') stopDisposed()
        } catch (error) {}
        try {
          if (typeof stopSelected === 'function') stopSelected()
        } catch (error) {}
        ctxShadowsByAgent.forEach(function (state) {
          ctxDisposeShadows(state)
        })
        ctxShadowsByAgent.clear()
        if (ctxSuppressDisposer) {
          try {
            ctxSuppressDisposer()
          } catch (error) {}
          ctxSuppressDisposer = null
        }
        if (ctxPrestepStop) {
          try {
            ctxPrestepStop()
          } catch (error) {}
          ctxPrestepStop = null
        }
        ctxHostState = null
        ctxPreviewLastJson = null
      }
    },
    'dsh-polish: prompts context-embedding agents+host',
  )
}
