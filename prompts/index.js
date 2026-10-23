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
 *   · 工具列表经 volatile 设置字段 toolPreview 传给客户端页面展示
 *     （name + 原始描述，单条截断 6000 字符）；volatile 不占表单。
 *
 * —— renderPrompt 的取用 ——
 *   预览用 dsh-system-prompt 导出的模块级函数 `renderPrompt` 渲染（与
 *   模型所见逐字一致）。它不是服务方法、ctx 上拿不到，而 dsh-system-prompt
 *   又不在本包的声明依赖里（pnpm 严格模式），所以这里动态 import：
 *   运行时 DSH 组合里永远有它，import 成功就用原版；失败则退回一个宽松
 *   的内置渲染器（未知变量保留字面量），预览不中断。
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
  /** 0.4.67 手动刷新（客户端写入的运行期 nonce）：页面「刷新」按钮写一个
   *  新的时间戳；宿主 1s 轮询发现变化后重新读取全局工具注册表。
   *  这是唯一的工具目录刷新入口；提示词文本仍绕过 5 秒稳定性等待。默认 0。 */
  refreshNonce: z.number().default(0).volatile(),
  /** 运行时通道（volatile）：用户手动刷新得到的全局注册表快照（name +
   *  **原始**描述，单条截断 6000 字符），供「工具提示」页展示。 */
  toolPreview: z
    .object({
      tools: z
        .array(
          z.object({
            name: z.string(),
            description: z.string(),
            lastSeen: z.number().default(0),
            sessionId: z.string().default(''),
            sessionTitle: z.string().default(''),
          }),
        )
        .default([]),
      updatedAt: z.number().default(0),
    })
    .default({})
    .volatile(),
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
})

// settings（轮询读 describe + 写回 update）、systemPrompt（section 注册 +
// assemble 水幕）、timer（ctx.interval 轮询）、tools（稳定的全局工具目录）。
export const inject = ['settings', 'systemPrompt', 'timer', 'agents', 'agentPresets', 'connection', 'tools']

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

  /** 这个 section 是不是本组件自己的（内置模板文本里不能含它）。 */
  function isOwnSection(section) {
    if (!section) return false
    if (section.name === SECTION_NAME) return true
    if (section.name === PERSONA_PREFIX_SECTION) {
      var value = findValue()
      var spec = null
      try {
        spec = currentSpec('standard')
      } catch (error) {}
      var content = spec && typeof spec.content === 'string' ? spec.content : ''
      if (content && String(section.text || '').indexOf(content) >= 0) return true
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
      var assembly = await ctx.systemPrompt.assemble({ scope: key })
      var sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
      var body = []
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i]
        if (!sec || isToolSection(sec.name)) continue
        if (isOwnSection(sec)) continue
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

  // 工具提示页使用全局注册表的显式快照；不会随模型装配或后台会话自动变动。
  // 提示词文本仍使用 5s 稳定门控：首次捕获立即显示，候选内容需连续
  // 观察满 5s 才替换预览，避免装配过程中的短暂中间态污染页面。
  var PROMPTS_STABLE_MS = 5000
  var previewCandidatePair = null // 候选文本对（effective + defaultText）
  var previewCandidateAt = 0
  // 页面「刷新」通过 refreshNonce 通知宿主；宿主重新读取工具注册表。
  var latestPreviewPatch = null
  var lastSeenNonce = 0

  /** 将全局 ToolSchema 转成一个稳定的手动快照并写入 volatile 通道。 */
  function publishToolCatalog(rawTools) {
    try {
      if (!Array.isArray(rawTools)) return
      var now = Date.now()
      var seen = {}
      var list = []
      for (var t = 0; t < rawTools.length; t++) {
        var tool = rawTools[t]
        if (!tool || typeof tool.name !== 'string' || !tool.name || seen[tool.name]) continue
        seen[tool.name] = true
        list.push({
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description.slice(0, 6000) : '',
          lastSeen: now,
          sessionId: '',
          sessionTitle: '',
        })
      }
      list.sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
      })
      stampWrite(ctx.settings.update(NS, { toolPreview: { tools: list, updatedAt: now } }), 'toolPreview(manual-catalog)')
    } catch (error) {}
  }

  /**
   * 工具提示页只展示全局注册表的手动快照，不依赖任何 session 或模型装配。
   * 动态/受限工具仍由真正的 assembly 送给模型，但不会在用户编辑时改动此页。
   */
  function refreshToolCatalog() {
    try {
      if (!ctx.tools || typeof ctx.tools.schemas !== 'function') return
      var schemas = ctx.tools.schemas()
      if (!Array.isArray(schemas)) return
      publishToolCatalog(schemas)
    } catch (error) {}
  }

  /** 工具相关 section 的判定：tool:*（每工具一段使用须知）、tools:*
   *  （sdk 总说明）、mcp-*（MCP 服务器）。这是提示词组件——工具相关内容
   *  不展示在任何预览视图里；它们的 JSON 定义走 assembly.tools 独立通道
   *  传给 API，本组件不碰。 */
  function isToolSection(name) {
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
  function isMineSection(section, spec) {
    if (!section || !spec) return false
    if (section.name === SECTION_NAME) return true
    if (section.name === PERSONA_PREFIX_SECTION) {
      var text = String(section.text || '')
      var content = String(spec.content || '')
      if (!content) return false
      return text.indexOf(content) >= 0
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
    if (captureSpec && (captureSpec.mode === 'replace' || personaIsComplete(capturePreset))) {
      mineName = PERSONA_PREFIX_SECTION
    }
    var mine = null
    var body = [] // 除本组件外的非工具 section（「默认」来源的两层都取自它）
    var bodyWithMine = [] // 非工具 section 原序（含本组件，「生效」来源的两层）
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i]
      if (!s) continue
      if (s.name === mineName && isMineSection(s, captureSpec)) {
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
      effective = captureMode === 'replace' && mine ? String(mine.text || '') : renderSections(bodyWithMine, variables)
    } catch (error) {
      effective = defaultText
    }
    try {
      defaultTemplate = joinRaw(body)
      effectiveTemplate = captureMode === 'replace' && mine ? String(mine.text || '') : joinRaw(bodyWithMine)
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
    // 0.4.67：无条件记住最近一次捕获的提示词（供「刷新」立即采纳）。
    latestPreviewPatch = buildPreviewPatch(effective, defaultText, effectiveTemplate, defaultTemplate, vars)
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

  /** 手动刷新在下一个 macrotask 发布，避免 settings.update 的 HMR 事务嵌套。 */
  var promoteTimer = 0
  function promoteLatest() {
    if (promoteTimer) return
    promoteTimer = setTimeout(function () {
      promoteTimer = 0
      try {
        // 刷新只重新读取稳定的全局工具注册表，不触碰正在编辑的文本。
        refreshToolCatalog()
        if (
          latestPreviewPatch &&
          (lastEffective === null ||
            latestPreviewPatch.effective !== lastEffective ||
            latestPreviewPatch.defaultText !== lastDefault)
        ) {
          lastEffective = latestPreviewPatch.effective
          lastDefault = latestPreviewPatch.defaultText
          previewCandidatePair = null
          previewCandidateAt = 0
          writePreview(latestPreviewPatch, lastPreviewPreset)
        }
      } catch (error) {}
    }, 0)
  }
  /** 0.4.45：按本行设置改写工具描述（fail-soft：任何异常原样放行）。
   *  每次装配实时读设置——客户端保存后下一次模型调用即生效。 */
  function rewriteToolDescriptions(assembly) {
    if (!assembly || !Array.isArray(assembly.tools) || assembly.tools.length === 0) return assembly
    var value = findValue()
    if (!value || value.enabled === false) return assembly
    var overrides = value.toolPrompts && typeof value.toolPrompts === 'object' ? value.toolPrompts : null
    var mode = value.toolPromptMode === 'replace' ? 'replace' : 'append'
    var tools = applyToolPrompt(assembly.tools, overrides, mode)
    if (tools === assembly.tools) return assembly
    return Object.assign({}, assembly, { tools: tools })
  }

  function onAssemble(assembly, context, next) {
    return Promise.resolve(next()).then(
      function (transformed) {
        // 0.4.91：preset scope 的**探测装配**不是某个 agent 的装配——不进预览
        // 捕获（否则会污染「当前生效 / 默认」两层），也不改工具描述。
        var scope = context && context.scope
        var isProbe = !!(scope && probeScopes.has(scope))
        if (!isProbe) {
          try {
            capture(transformed, context)
          } catch (error) {}
        }
        try {
          if (isProbe) return transformed
          return rewriteToolDescriptions(transformed)
        } catch (error) {
          return transformed
        }
      },
    )
  }

  // ---- section 注册：共享 catalog + 每个 Agent scope 独立选择 preset。 
  var registeredByAgent = new Map()
  var PRESET_IDS = ['standard', 'ptc', 'cordis', 'minimal']

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
      if (spec.mode === 'replace' || personaComplete) {
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
        text: function () {
          var cur = currentSpec(reg.presetId)
          if (!cur || cur.id !== reg.id || cur.mode !== reg.mode) return ''
          if (reg.name === PERSONA_PREFIX_SECTION) {
            if (cur.mode === 'replace') return cur.content
            // preset 的 persona 本身就是 complete（minimal）：附加 = persona + 自定义
            var persona = presetPersona(reg.presetId)
            var base = persona && typeof persona.prefix === 'string' ? persona.prefix : ''
            return base ? base + '\n\n' + cur.content : cur.content
          }
          return cur.content
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
    var rowValue = findValue()
    var nonce = rowValue && typeof rowValue.refreshNonce === 'number' ? rowValue.refreshNonce : 0
    if (nonce !== lastSeenNonce) {
      lastSeenNonce = nonce
      if (nonce !== 0) promoteLatest()
    }
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
        // 只在插件启动时建立一次目录快照；之后只响应用户的明确刷新。
        refreshToolCatalog()
      try {
        var builtinPromise = refreshBuiltins()
        if (builtinPromise && typeof builtinPromise.catch === 'function') builtinPromise.catch(function () {})
      } catch (error) {}
      var interval = ctx.interval(syncSection, 1000)
      return function () {
        try {
          interval.dispose()
        } catch (error) {}
        try { if (typeof stopAgentCreated === 'function') stopAgentCreated() } catch (error) {}
        try { if (typeof stopAgentDisposed === 'function') stopAgentDisposed() } catch (error) {}
        try { if (typeof stopPresetSelected === 'function') stopPresetSelected() } catch (error) {}
        registeredByAgent.forEach(function (reg) { disposeRegistration(reg) })
        registeredByAgent.clear()
        if (promoteTimer) {
          try { clearTimeout(promoteTimer) } catch (error) {}
          promoteTimer = 0
        }
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
}
