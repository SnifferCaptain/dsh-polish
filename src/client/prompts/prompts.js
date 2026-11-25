    // ------------------------------------------------- prompts (system prompt)
    //
    // 组件 J：自定义系统提示词。两个界面：
    //   1) 行详情页（plugins.row.config）：总开关（实时关断，无需重启）。
    //   2) 设置 → 提示词设置（settings.section）：主界面，三个顶层 tab（1.1.1，
    //      系统提示词编写与模式选择分开，不再共享一个面板）：
    //      · 系统提示词：模板库（4 个内置只读默认 + 自定义 CRUD，编辑器为
    //        独立虚线卡片、纵向字段）+ 内置模板查看（模板原文，{{变量}} 原样保留）；
    //      · 模式选择：每个模式（standard/ptc/cordis/minimal）用哪份提示词
    //        （下拉 + 四个一键模板）+「模型实际看到的」最终形态预览
    //        （内置 = DSH 默认；替换 = 你的文本；附加 = 你的文本 + DSH 默认）；
    //      · 工具提示：只改描述文本，不改参数与行为——工具 JSON 定义
    //        走 API 参数独立下发。
    //
    // 数据：host 半每 1s 对齐「激活条目 + 模式」并注册 systemPrompt section；
    // 水幕捕获的 preview 文本（volatile）由本页读 form 快照展示。本页用
    // configForms.describe() 共享镜像的 subscribe 驱动重渲染（与插件页的
    // useConfigurations 同一条真源），写走 form.mutate(ops, revision)。

    var PROMPTS_MAX_NAME = 24
    var PROMPTS_MAX_CONTENT = 20000
    var TOOL_PROMPT_MAX = 2000
     var PROMPTS_PRESETS = [
       { id: 'standard', label: t('prompts.preset.standard'), note: t('prompts.preset.standard.note') },
       { id: 'ptc', label: 'ptc', note: t('prompts.preset.ptc.note') },
       { id: 'cordis', label: t('prompts.preset.cordis'), note: t('prompts.preset.cordis.note') },
       { id: 'minimal', label: t('prompts.preset.minimal'), note: t('prompts.preset.minimal.note') },
     ]
    // 0.4.90：每个模式各自一个**内置只读**的默认提示词模板（单射：
    // mode -> builtin:<mode>）。它们是「该模式自己的 DSH 默认提示词」，
    // 不是可编辑的自定义条目，也不是笼统的一个「默认提示词模板」。
    // 每个模式的下拉默认选中它自己这一项；用户可另选自定义模板。
    var PROMPTS_BUILTINS = [
      { id: 'builtin:standard', mode: 'standard', label: t('prompts.builtin.standard') },
      { id: 'builtin:ptc', mode: 'ptc', label: t('prompts.builtin.ptc') },
      { id: 'builtin:cordis', mode: 'cordis', label: t('prompts.builtin.cordis') },
      { id: 'builtin:minimal', mode: 'minimal', label: t('prompts.builtin.minimal') },
    ]
    function builtinLabelOf(id) {
      for (var bi = 0; bi < PROMPTS_BUILTINS.length; bi++) {
        if (PROMPTS_BUILTINS[bi].id === id) return PROMPTS_BUILTINS[bi].label
      }
      return ''
    }

    // 1.4.35：不再内置「节省 / 谨慎 / 牧羊人 / 文科生」四个一键模板。保留一份由用户
    // 自己的 better-standard/cordis/ptc（三份逐字相同）收敛成的预设：在模板库里「添加」
    // 才会复制进自定义库，不会自动套用到任何模式。
    var PROMPTS_PRESET_TEMPLATES = [
      {
        key: 'better',
        name: 'better',
        mode: 'replace',
        content:
          '你是SnifferCaptain，地球上最棒的智能体，由 {{model}} 模型提供支持。你的核心目标就是帮助用户完成任务。\n' +
          '\n' +
          '## 工作区维护\n' +
          '你可能处于有未提交改动的git工作区或者未被git保护的工作区，你需要意识到你与用户之间是协作关系，因此绝对不要做出破坏用户工作的行为。只有在用户要求的情况下，你才允许进行git写入操作，例如commit、push、reset、checkout等写入命令。\n' +
          '\n' +
          '你所创建的临时文件要自己清理，或者自己或者由用户规定一个固定的位置存放这些临时文件。\n' +
          '\n' +
          '目录树维护与代码风格规范应当尽可能贴合已有状态。\n' +
          '\n' +
          '## 工作\n' +
          '- 无论用户要求你做什么工作，都必须立即回应用户后，再使用工具开始工作，以让用户确认你理解了指令\n' +
          '- 对于复杂的需求，可以参考`规划-->实现<->验证`的流程。不要在流程之间停下。\n' +
          '- 用户对你的期待是，在你最终回复之前，完成所有用户要求。因此，在最终回复之前检查用户的要求是否全部满足是必要的。绝不要以“接下来打算做什么”的思考结束回复，却不在同一回合内发起对应的工具调用\n' +
          '- 当你在工作的过程中，涉及到进度的推进时，应当在思考结束后、调用工具前对你推进的进度简要的说明\n' +
          '- 不要滥用子代理；不要滥用goal替代任务列表；不要自我怀疑或过度谨慎；不要做用户要求以外的事，除非用户明确允许你自由探索；能批量使用工具时，绝对不一个个使用\n' +
          '\n' +
          '## 呈现要求\n' +
          '优先在最终回复中展示主要结果，并附上详细说明。最终呈现时需按照用户的喜好与要求构思好呈现效果，使用如图片、文件链接、代码块等方式辅助用户理解。\n' +
          '- 当图片有助于解释或比较时，使用 `![描述](<path/to/image.png>)`\n' +
          '- 当提及文件时，使用 `[描述](<path/to/file.xxx>)`\n' +
          '- 当存在特殊文件，呈现单独的文件卡片有助于用户打开完整交付物时，使用 present\n' +
          '- 在命令、配置表达式和代码块之外，凡是提及现有文件（包括重复提及和表格中的提及），都要将其链接到相对于工作目录的完整路径或绝对路径\n' +
          '- 除非用户要求或者仅使用文件名不够清晰，文件描述中不要出现完整路径。\n' +
          '- 对于需要呈现已知行或者精确位置时，使用`[文件名:123–456](<path/to/file.xxx#L123-L456>)`\n' +
          '\n' +
          '## 路径管理\n' +
          '运行时上下文会指定DeepSeek Harness 实现所在的 checkout。checkout 位置和当前工作目录是两个不同的值，可能不同；绝不要根据 checkout 路径推断工作目录。使用 `pwd` 确定当前工作目录。仅将此 checkout 用于检查或扩展 DSH 本身。\n' +
          '\n' +
          '## 运行\n' +
          '如果需要，请优先使用受管后台作业，并验证其确切URL，避免不必要的弹窗打扰。',
      },
    ]

    function newPromptId() {
      return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    function promptTextValue(text) {
      return typeof text === 'string' ? text : ''
    }

    function listCustoms(value) {
      if (!value || !Array.isArray(value.custom)) return []
      return value.custom.filter(function (entry) {
        return entry && typeof entry.id === 'string' && typeof entry.name === 'string'
      })
    }

    function customMode(entry) {
      return entry && entry.mode === 'replace' ? 'replace' : 'append'
    }

    function copyPromptText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text)
      }
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.left = '-10000px'
          document.body.appendChild(ta)
          ta.select()
          var ok = document.execCommand('copy')
          document.body.removeChild(ta)
          if (ok) resolve()
          else reject(new Error('copy failed'))
        } catch (error) {
          reject(error)
        }
      })
    }

    // ----- 1.2.0 视觉语法：分段控件 = 导航/范围切换（从不触发动作）；
    // 构成条 = 提示词由哪几层组成（强调色 = 你的文本，灰 = DSH 默认，斜纹 = 被丢弃）。
    function promptSeg(items, value, onChange, label) {
      return React.createElement(
        'div',
        { className: 'dshp-seg', role: 'tablist', 'aria-label': label },
        items.map(function (item) {
          return React.createElement(
            'button',
            {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': value === item.id ? 'true' : 'false',
              className: 'dshp-seg-item',
              title: item.title,
              onClick: function () {
                onChange(item.id)
              },
            },
            item.label,
          )
        }),
      )
    }

    function promptBar(parts, big) {
      return React.createElement(
        'div',
        { className: 'dshp-comp', 'data-big': big ? '1' : undefined },
        parts.map(function (part, i) {
          return React.createElement('i', { key: i, 'data-k': part.k, style: { flex: Math.max(part.w, 0.0001) + ' 1 0' } })
        }),
      )
    }

    function promptLegend(items) {
      return React.createElement(
        'div',
        { className: 'dshp-legend' },
        items.map(function (item, i) {
          return React.createElement('span', { key: i }, React.createElement('i', { 'data-k': item.k }), item.text)
        }),
      )
    }

    function promptChoices(label, value, options, onChange, disabled) {
      return React.createElement(
        'div',
        { className: 'dshp-choices', role: 'radiogroup', 'aria-label': label },
        options.map(function (option) {
          return React.createElement(
            'button',
            {
              key: option.value,
              type: 'button',
              role: 'radio',
              'aria-checked': value === option.value ? 'true' : 'false',
              className: 'dshp-choice',
              disabled: !!disabled,
              onClick: function () {
                onChange(option.value)
              },
            },
            React.createElement('span', { className: 'dshp-choice-t' }, option.title),
            promptBar(option.bar, false),
            React.createElement('span', { className: 'dshp-choice-d' }, option.desc),
          )
        }),
      )
    }

    function promptKindTag(mode) {
      return React.createElement('span', { className: 'dshp-tag', 'data-tone': mode === 'replace' ? 'warn' : 'accent' }, mode === 'replace' ? t('prompts.tag.replace') : t('prompts.tag.append'))
    }

    var PROMPT_MODE_CHOICES = [
      { value: 'append', title: t('prompts.modeAppend.title'), desc: t('prompts.modeAppend.desc'), bar: [{ k: 'mine', w: 4 }, { k: 'base', w: 6 }] },
      { value: 'replace', title: t('prompts.modeReplace.title'), desc: t('prompts.modeReplace.desc'), bar: [{ k: 'mine', w: 6 }, { k: 'drop', w: 4 }] },
    ]
    var TOOL_MODE_CHOICES = [
      { value: 'append', title: t('prompts.toolAppend.title'), desc: t('prompts.toolAppend.desc'), bar: [{ k: 'base', w: 7 }, { k: 'mine', w: 3 }] },
      { value: 'replace', title: t('prompts.toolReplace.title'), desc: t('prompts.toolReplace.desc'), bar: [{ k: 'drop', w: 5 }, { k: 'mine', w: 5 }] },
    ]

    function makePromptsRowPage(ctx) {
      var fields = [
        {
          key: 'enabled',
          kind: 'boolean',
          label: t('prompts.enabled.label'),
          hint: t('prompts.enabled.hint'),
        },
      ]
      return function PromptsRowPage(props) {
        var form = props.form
        if (props.view === 'summary') {
          return React.createElement(
            'span',
            null,
            summaryFrom(form, function (value) {
              // 与设置页其余行同一语法：状态在前，只用一个「 · 」分隔
            var customCount = Array.isArray(value.custom) ? value.custom.length : 0
            var parts = [value.enabled === false ? t('prompts.summary.disabled') : t('prompts.summary.enabled')]
            if (value.enabled !== false) {
              parts.push(customCount > 0 ? t('prompts.summary.customCount', { n: customCount }) : t('prompts.summary.builtinOnly'))
            }
            return parts.join(' · ')
            }),
          )
        }
        return React.createElement(SettingsForm, { form: form, fields: fields, coerce: function (field, value) { return value !== false } })
      }
    }

    function makePromptsSettingsPage(ctx) {
      return function PromptsSettingsPage(props) {
        var mirror = null
        try {
          mirror = ctx.configForms.describe()
        } catch (error) {}

        var tickState = React.useState(0)
        var setTick = tickState[1]
        // 0.4.65：按本行 revision 门控重渲染（防止 mirror 全量通知时整页
        // 反复刷新）。0.4.78：门控从「revision 变化」升级为「本行值签名
        // 变化」——revision 由宿主的静态 entry options 驱动，volatile 写入
        // （宿主水幕重写 preview）可能只更新值而不推进 revision，
        // 纯 revision 门控会把这类更新永久吞掉（症状：工具列表一直为空、
        // 刷新无效）。签名覆盖本页渲染依赖的全部字段。0.4.9x：去掉 5s 主动
        // mirror.load() 轮询——mirror 订阅本身就是唯一更新路径，轮询只会
        // 放大无谓的全量 describe。
        React.useEffect(
          function () {
            if (!mirror || typeof mirror.subscribe !== 'function') return undefined
            // 1.4.14：「上下文」tab 的数据全部来自 volatile 的 contextPreview。
            // 1.4.13 的签名里没有它 → 宿主每次装配/捕获后 mirror 通知了，
            // 签名却不变，页面永不重渲染：通道表、最新注入正文、快照 meta
            // 一直停在打开页面那一刻（未捕获 / 0×）。这里只把会改变渲染
            // 结果的字段计入签名，避免每次通知都 JSON 整个 preview。
            function contextSig(v) {
              var cp = v.contextPreview && typeof v.contextPreview === 'object' ? v.contextPreview : null
              if (!cp) return 'none'
              var parts = [typeof cp.updatedAt === 'number' ? cp.updatedAt : 0, Array.isArray(cp.contexts) ? cp.contexts.length : -1]
              var snap = cp.runtimeSnapshot
              parts.push(
                snap && typeof snap === 'object'
                  ? [snap.eventSeq || 0, snap.capturedAt || 0, Array.isArray(snap.sections) ? snap.sections.length : 0].join(':')
                  : '-',
              )
              var comp = cp.compaction
              parts.push(comp && typeof comp === 'object' ? [comp.capturedAt || 0, comp.instructionChars || 0].join(':') : '-')
              var injected = Array.isArray(cp.injected) ? cp.injected : []
              for (var i = 0; i < injected.length; i++) {
                var item = injected[i] || {}
                parts.push([item.kind || '', item.count || 0, item.lastAt || 0].join(':'))
              }
              return parts.join('|')
            }
            function rowSig() {
              try {
                var snap = mirror.getSnapshot ? mirror.getSnapshot() : null
                var ns = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
                for (var i = 0; i < ns.length; i++) {
                  if (ns[i] && ns[i].ns === NS_PROMPTS) {
                    var r = ns[i]
                    var v = r.value || {}
                    var pv = v.preview || {}
                    var tl = {}
                    if (v.toolPrompts && typeof v.toolPrompts === 'object') {
                      for (var tk in v.toolPrompts) tl[tk] = 1
                    }
                    return [
                      r.revision,
                      
                      
                      typeof pv.effective === 'string' ? pv.effective.length : 0,
                      pv.updatedAt || 0,
                       JSON.stringify(v.previewByPreset || {}),
                      Array.isArray(v.custom) ? v.custom.length : -1,
                       JSON.stringify(v.custom || []),
                       JSON.stringify(v.activeByPreset || {}),
                       JSON.stringify(v.builtins || []),
                       v.active || '',
                      JSON.stringify(tl),
                      contextSig(v),
                      
                      v.enabled === false ? 0 : 1,
                      
                    ].join('|')
                  }
                }
              } catch (error) {}
              return 'none'
            }
            var lastSig = rowSig()
            function bump() {
              setTick(function (t) {
                return t + 1
              })
            }
            var off = mirror.subscribe(function () {
              var sig = rowSig()
              if (sig === lastSig) return
              lastSig = sig
              bump()
            })
             // No interval polling: the settings mirror subscription is the only update path.
             return function () {
               off()
             }
          },
          [],
        )
        var [saveStatus, setSaveStatus] = React.useState('')
        var [copied, setCopied] = React.useState(false)
          var [editor, setEditor] = React.useState(null)
          var [builtinView, setBuiltinView] = React.useState(null)
        // 1.1.1 顶层标签：system（系统提示词：模板库 + 编辑器 + 内置查看）/
        // mode（模式选择：每模式生效提示词 + 最终形态预览）/ tools（工具提示）。
        // drafts/mode 懒填充：初值取自行设置，用户编辑后本地优先（保存前不回读）。
        var [page, setPage] = React.useState('system')
         var [selectedPreset, setSelectedPreset] = React.useState('standard')
        var [toolDrafts, setToolDrafts] = React.useState(null)
        var [toolMode, setToolMode] = React.useState(null)
  var [toolModes, setToolModes] = React.useState(null)
         var [toolCatalog, setToolCatalog] = React.useState(null)
         var [toolCatalogUpdatedAt, setToolCatalogUpdatedAt] = React.useState(0)
         var toolCatalogOpened = React.useRef(false)
         var toolCatalogBusy = React.useRef(false)
         var [remoteBuiltins, setRemoteBuiltins] = React.useState(null)
           // 1.4.1 上下文嵌入 tab：编辑草稿（首次进入时从当前设置初始化；
           // 之后的 volatile 捕获写入不回写草稿，避免覆盖正在编辑的内容）。
           var [ctxDraft, setCtxDraft] = React.useState(null)
         React.useEffect(
           function () {
             var stopped = false
             fetch('/api/dshp/prompts/builtins')
               .then(function (res) { return res && res.ok ? res.json() : null })
               .then(function (data) {
                 if (!stopped && data && Array.isArray(data.builtins) && data.builtins.length > 0) setRemoteBuiltins(data.builtins)
               })
               .catch(function () {})
             return function () { stopped = true }
           },
           [],
         )
        // 工具目录不依赖 session，也不会自动刷新；
        
        // 页面打开时读取一次，之后只允许用户手动刷新
        
        var [refreshNote, setRefreshNote] = React.useState('')
        var [refreshing, setRefreshing] = React.useState(false)

        var form = null
        var value = {}
        try {
          var snap = mirror && mirror.getSnapshot ? mirror.getSnapshot() : null
          var namespaces = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
          var served = namespaces.some(function (view) {
            return view && view.ns === NS_PROMPTS
          })
          if (served) {
            var ctrl = ctx.configForms.get(NS_PROMPTS)
            form = { state: ctrl.getSnapshot(), mutate: function (ops, revision) { return ctrl.mutate(ops, revision) } }
          }
        } catch (error) {}

        if (form && form.state && form.state.status === 'ready' && form.state.value) value = form.state.value
        var customs = listCustoms(value)
        var activeByPreset = value.activeByPreset && typeof value.activeByPreset === 'object' ? value.activeByPreset : {}
         // 0.4.90：默认选中「该模式自己的内置模板」（单射）。兼容旧数据：
         // activeByPreset/value.active === 'default' 只代表该模式的 DSH 默认，
         // 在 UI 中归一化成对应的 builtin:<mode> 项。
         var activeRaw = typeof activeByPreset[selectedPreset] === 'string' && activeByPreset[selectedPreset]
           ? activeByPreset[selectedPreset]
           : selectedPreset === 'standard' && typeof value.active === 'string' && value.active
             ? value.active
             : ''
         var active = activeRaw && activeRaw !== 'default' ? activeRaw : 'builtin:' + selectedPreset
        var previewByPreset = value.previewByPreset && typeof value.previewByPreset === 'object' ? value.previewByPreset : {}
         var preview = previewByPreset[selectedPreset] && typeof previewByPreset[selectedPreset] === 'object' ? previewByPreset[selectedPreset] : selectedPreset === 'standard' && value.preview && typeof value.preview === 'object' ? value.preview : {}
        var activeEntry = null
        for (var ai = 0; ai < customs.length; ai++) {
          if (customs[ai].id === active) {
            activeEntry = customs[ai]
            break
          }
        }
        var activeMode = activeEntry ? customMode(activeEntry) : ''

        var writable = !form || form.state.writable !== false
        var busy = saveStatus === 'saving'

        function submit(ops) {
          if (!form || busy) return
          setSaveStatus('saving')
          // 0.4.77：不再传渲染期的 revision。configForms 的 mutate 契约是
          // expectedRevision ?? pendingRevision ?? 写入时快照——传陈旧 revision
          // 会在行间被宿主重写（volatile 捕获）时直接被拒（「保存被拒绝」，
          // patch 中 toolPrompts 从未落盘，与此类拒绝一致）；不传 = 写入时读最新快照。
          Promise.resolve(form.mutate(ops)).then(
            function (ok) {
              setSaveStatus(ok ? 'saved' : 'failed')
            },
            function () {
              setSaveStatus('failed')
            },
          )
        }

        function loadToolCatalog(manual) {
          if (toolCatalogBusy.current) return
          if (manual && toolDirty) {
            setRefreshNote(t('prompts.note.unsavedGuard'))
            return
          }
          toolCatalogBusy.current = true
          setRefreshing(true)
          setRefreshNote(manual ? t('prompts.note.reading') : '')
          fetch('/api/dshp/prompts/tools')
            .then(function (res) {
              return res && res.ok ? res.json() : null
            })
            .then(function (data) {
              if (!data || data.ok !== true || !Array.isArray(data.tools)) throw new Error('tool catalog unavailable')
              setToolCatalog(data.tools)
              setToolCatalogUpdatedAt(typeof data.updatedAt === 'number' ? data.updatedAt : Date.now())
              setRefreshNote(manual ? t('prompts.note.updated') : '')
            })
            .catch(function () {
              setRefreshNote(t('prompts.note.readFailed'))
            })
            .then(function () {
              toolCatalogBusy.current = false
              setRefreshing(false)
            })
        }

        React.useEffect(
          function () {
            if (page !== 'tools' || toolCatalogOpened.current) return
            toolCatalogOpened.current = true
            loadToolCatalog(false)
          },
          [page],
        )

        // 1.4.1 上下文嵌入：首次进入 tab 时从当前行设置初始化草稿
        // （只初始化一次；保存后的 volatile 回写不覆盖用户正在编辑的草稿）。
        React.useEffect(
          function () {
            if (page !== 'contexts' || ctxDraft) return
            setCtxDraft(ceDraftFromValue(value))
          },
          [page, value, ctxDraft],
        )

        function requestRefresh() {
          loadToolCatalog(true)
        }

        function selectActive(id) {
          submit([{ op: 'set', path: ['activeByPreset', selectedPreset], value: id }])
        }

        // 预设只复制进自定义库，不自动套用到任何模式；同名已存在则不重复添加。
        function presetAdded(tpl) {
          for (var i = 0; i < customs.length; i++) {
            if (customs[i].name.trim().toLowerCase() === tpl.name.trim().toLowerCase()) return true
          }
          return false
        }
        function addPreset(tpl) {
          if (presetAdded(tpl)) return
          var entry = { id: newPromptId(), name: tpl.name, mode: tpl.mode === 'replace' ? 'replace' : 'append', content: tpl.content }
          var next = []
          for (var j = 0; j < customs.length; j++) next.push(customs[j])
          next.push(entry)
          submit([{ op: 'set', path: ['custom'], value: next }])
        }

        function openNewEditor() {
          setSaveStatus('')
          setEditor({ id: '', name: '', mode: 'append', content: '' })
        }

        function openEditEditor(entry) {
          setSaveStatus('')
          setEditor({ id: entry.id, name: entry.name, mode: customMode(entry), content: promptTextValue(entry.content) })
        }

        function saveEditor() {
          if (!editor) return
          var name = String(editor.name || '').trim()
          var content = String(editor.content || '')
          if (name.length === 0 || name.length > PROMPTS_MAX_NAME) {
            setSaveStatus('failed')
            return
          }
          if (content.trim().length === 0 || content.length > PROMPTS_MAX_CONTENT) {
            setSaveStatus('failed')
            return
          }
          var entry = { id: editor.id || newPromptId(), name: name, mode: editor.mode, content: content }
          var next = []
          var replaced = false
          for (var i = 0; i < customs.length; i++) {
            var c = customs[i]
            if (entry.id && c.id === entry.id) {
              next.push(entry)
              replaced = true
            } else {
              next.push(c)
              if (c.name.trim().toLowerCase() === name.toLowerCase()) {
                setSaveStatus('failed')
                return
              }
            }
          }
          if (!replaced) next.push(entry)
          // 新建条目**不再**自动激活。0.4.77 曾为了「保存后毫无效果」而在这里
          // 无条件写 activeByPreset，结果新建提示词 B 会把当前模式（如 standard）
          // 从原来的 A 悄悄改成 B——用户只想要一条新条目，不该顺带换掉正在用的
          // 提示词。激活只由「当前提示词」下拉显式选择。
          submit([{ op: 'set', path: ['custom'], value: next }])
          setEditor(null)
        }

        function removeEntry(entry) {
          var next = []
          for (var i = 0; i < customs.length; i++) {
            if (customs[i].id !== entry.id) next.push(customs[i])
          }
          var ops = [{ op: 'set', path: ['custom'], value: next }]
          if (active === entry.id) ops.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: 'default' })
          if (editor && editor.id === entry.id) setEditor(null)
          submit(ops)
        }

        // 0.4.91：宿主从 DSH 自己的 preset 定义里解析出的内置模板内容
        // （readDocument + preset scope 装配）——不需要「探测」。
        var builtinMap = {}
        var builtinList = Array.isArray(value.builtins) ? value.builtins : []
        for (var bi0 = 0; bi0 < builtinList.length; bi0++) {
          var bEntry = builtinList[bi0]
          if (bEntry && typeof bEntry.id === 'string') builtinMap[bEntry.id] = bEntry
        }
        // 0.4.93：路由通道的内容覆盖设置行通道（更新鲜）。
        var remoteList = Array.isArray(remoteBuiltins) ? remoteBuiltins : []
        for (var bi1 = 0; bi1 < remoteList.length; bi1++) {
          var rEntry = remoteList[bi1]
          if (rEntry && typeof rEntry.id === 'string' && typeof rEntry.text === 'string' && rEntry.text.length > 0) {
            builtinMap[rEntry.id] = rEntry
          }
        }
        var builtinViewEntry = builtinView ? builtinMap[builtinView] || null : null
        // 系统提示词页：内置模板查看（模板原文，{{变量}} 原样保留）。
        var viewText = builtinViewEntry
          ? promptTextValue(builtinViewEntry.template) || promptTextValue(builtinViewEntry.text)
          : ''
        // 模式选择页：模型实际看到的——优先用宿主装配的 effective（preview.effective，
        // 当前装配的地面真相，变量已代入）；尚未生成时按模式本地近似：
        // 内置 = DSH 默认；整份替换 = 只有你的文本；附加 = 你的文本 + DSH 默认。
        var modeDefaultText = promptTextValue(preview.defaultText)
        var modeFinalText = promptTextValue(preview.effective)
        if (modeFinalText.length === 0) {
          if (activeEntry) {
            var modeUserContent = promptTextValue(activeEntry.content)
            modeFinalText = activeMode === 'replace' ? modeUserContent : modeUserContent + (modeDefaultText ? '\n\n' + modeDefaultText : '')
          } else {
            modeFinalText = modeDefaultText
          }
        }
        var modeFinalHint = modeFinalText.length === 0 ? t('prompts.note.nextCall') : ''
        // 0.4.94：按需刷新「模型实际看到的」——不消耗任何模型调用/token，
        // 走宿主装配路由（/api/dshp/prompts/probe）：优先用正在运行的该
        // preset agent 的 generation scope 真实装配（含本组件已注册的
        // 自定义 section），拿不到时退回 preset scope 装配 + 本地组合。
        var [probeRefreshing, setProbeRefreshing] = React.useState(false)
        var [probeNote, setProbeNote] = React.useState('')
        function requestProbe() {
          if (probeRefreshing) return
          setProbeRefreshing(true)
          setProbeNote('')
          fetch('/api/dshp/prompts/probe', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ preset: selectedPreset }),
          })
            .then(function (res) {
              return res && res.ok ? res.json() : null
            })
            .then(function (data) {
              if (!data || data.ok !== true) {
                setProbeNote(t('prompts.note.probeFailed'))
                return
              }
              var patch = {
                effective: data.effective || '',
                defaultText: data.defaultText || '',
                effectiveTemplate: data.template || '',
                defaultTemplate: data.defaultTemplate || '',
                variables: Array.isArray(data.variables) ? data.variables : [],
                updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now(),
              }
              submit([{ op: 'set', path: ['previewByPreset', selectedPreset], value: patch }])
              setProbeNote(
                data.source === 'agent-scope'
                  ? t('prompts.note.probeLive')
                  : t('prompts.note.probeApprox', { time: new Date(patch.updatedAt).toLocaleTimeString() }),
              )
            })
            .catch(function () {
              setProbeNote(t('prompts.note.probeFailed'))
            })
            .then(function () {
              setProbeRefreshing(false)
            })
        }

        function doCopy(text) {
          if (!text || text.length === 0) return
          copyPromptText(text).then(
            function () {
              setCopied(true)
              setTimeout(function () {
                setCopied(false)
              }, 1600)
            },
            function () {},
          )
        }

        // ---------------------------------------------------- 1.2.0 重排版
        // 层次：分段控件（系统提示词 / 模式选择 / 工具提示）→ 各页内容。
        // 逻辑层不动：selectedPreset / active / selectActive / customs / activeMode
        // 等状态与 handler 全部沿用；只重排呈现。
        var presetTabLabel = { standard: t('prompts.tab.standard'), ptc: 'ptc', cordis: t('prompts.tab.cordis'), minimal: t('prompts.tab.minimal') }
        var presetTabs = promptSeg(
          PROMPTS_PRESETS.map(function (preset) {
            return { id: preset.id, label: presetTabLabel[preset.id] || preset.id, title: preset.label + ' — ' + preset.note }
          }),
          selectedPreset,
          setSelectedPreset,
          t('prompts.tabLabel'),
        )
        // 每个模式当前用哪份提示词：模板库的行据此标出「被谁使用」。
        var usedBy = {}
        for (var up = 0; up < PROMPTS_PRESETS.length; up++) {
          var upId = PROMPTS_PRESETS[up].id
          var upRaw = typeof activeByPreset[upId] === 'string' && activeByPreset[upId]
            ? activeByPreset[upId]
            : upId === 'standard' && typeof value.active === 'string' && value.active
              ? value.active
              : ''
          var upKey = upRaw && upRaw !== 'default' ? upRaw : 'builtin:' + upId
          if (!usedBy[upKey]) usedBy[upKey] = []
          usedBy[upKey].push(presetTabLabel[upId] || upId)
        }
        function usedByTags(id) {
          var names = usedBy[id] || []
          return names.map(function (name) {
            return React.createElement(
              'span',
              { key: 'u:' + name, className: 'dshp-tag', title: name + ' 模式正在使用' },
              React.createElement('i', { className: 'dshp-dot', 'data-tone': 'ok' }),
              name,
            )
          })
        }
        var activeSelect = React.createElement(
          'select',
          {
            className: 'dshp-select',
            style: { flex: '1 1 auto', minWidth: 0 },
            'aria-label': t('prompts.activeLabel'),
            value: active,
            disabled: !writable || busy,
            onChange: function (event) { selectActive(event.target.value) },
          },
          React.createElement(
            'optgroup',
            { label: t('prompts.builtinGroup') },
            PROMPTS_BUILTINS.map(function (b) {
              return React.createElement('option', { key: b.id, value: b.id }, b.label)
            }),
          ),
          customs.length > 0
            ? React.createElement(
                'optgroup',
                { label: t('prompts.myGroup') },
                customs.map(function (entry) {
                  return React.createElement('option', { key: entry.id, value: entry.id }, entry.name + '（' + (customMode(entry) === 'replace' ? t('prompts.customOption.replace') : t('prompts.customOption.append')) + '）')
                }),
              )
            : null,
        )
        // ---------------------------------------------------- 构成条（模式页）
        var userLen = activeEntry ? promptTextValue(activeEntry.content).length : 0
        var baseLen = modeDefaultText.length
        var baseW = baseLen > 0 ? baseLen : Math.max(userLen, 1)
        var compParts
        var compLegend
        if (!activeEntry) {
          compParts = [{ k: 'base', w: baseW }]
          compLegend = [{ k: 'base', text: t('prompts.legend.dshDefault') + (baseLen > 0 ? ' ' + baseLen + t('prompts.legend.chars') : '') }]
        } else if (activeMode === 'replace') {
          compParts = [{ k: 'mine', w: Math.max(userLen, 1) }, { k: 'drop', w: baseW }]
          compLegend = [{ k: 'mine', text: t('prompts.legend.yourText') + ' ' + userLen + t('prompts.legend.chars') }, { k: 'drop', text: t('prompts.legend.dropped') }]
        } else {
          compParts = [{ k: 'mine', w: Math.max(userLen, 1) }, { k: 'base', w: baseW }]
          compLegend = [{ k: 'mine', text: t('prompts.legend.yourText') + ' ' + userLen + t('prompts.legend.chars') }, { k: 'base', text: t('prompts.legend.dshDefault') + (baseLen > 0 ? ' ' + baseLen + t('prompts.legend.chars') : '') }]
        }

        // ---------------------------------------------------- 模板库
        // 内置默认只读（单射 mode -> builtin:mode）；自定义可编辑/删除。
        // 行尾只放操作；「被哪个模式使用」用绿点标签直接标在名称后。
        var builtinRows = PROMPTS_BUILTINS.map(function (b) {
          return React.createElement(
            'div',
            { key: b.id, className: 'dshp-trow' },
            React.createElement('div', { className: 'dshp-trow-name' }, React.createElement('b', null, b.label), usedByTags(b.id)),
            React.createElement('span', { className: 'dshp-tag' }, t('prompts.builtinTag')),
            React.createElement('span', { className: 'dshp-trow-n' }, builtinMap[b.id] ? t('prompts.chars', { len: builtinMap[b.id].text.length }) : t('common.unparsed')),
            React.createElement(
              'div',
              { className: 'dshp-trow-act' },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', onClick: function () { setBuiltinView(b.id) } }, t('common.view')),
            ),
          )
        })
        var customRows = customs.map(function (entry) {
          return React.createElement(
            'div',
            { key: entry.id, className: 'dshp-trow' },
            React.createElement('div', { className: 'dshp-trow-name' }, React.createElement('b', null, entry.name), usedByTags(entry.id)),
            promptKindTag(customMode(entry)),
            React.createElement('span', { className: 'dshp-trow-n' }, t('prompts.chars', { len: promptTextValue(entry.content).length })),
            React.createElement(
              'div',
              { className: 'dshp-trow-act' },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: !writable || busy, onClick: function () { openEditEditor(entry) } }, t('common.edit')),
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost dshp-btn-danger', disabled: !writable || busy, onClick: function () { removeEntry(entry) } }, t('common.delete')),
            ),
          )
        })

        var presetRows = PROMPTS_PRESET_TEMPLATES.map(function (tpl) {
          var added = presetAdded(tpl)
          return React.createElement(
            'div',
            { key: tpl.key, className: 'dshp-trow' },
            React.createElement('div', { className: 'dshp-trow-name' }, React.createElement('b', null, tpl.name)),
            promptKindTag(tpl.mode === 'replace' ? 'replace' : 'append'),
            React.createElement('span', { className: 'dshp-trow-n' }, t('prompts.chars', { len: tpl.content.length })),
            React.createElement(
              'div',
              { className: 'dshp-trow-act' },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm', disabled: !writable || busy || added, onClick: function () { addPreset(tpl) } }, added ? t('prompts.presetAdded') : t('prompts.presetAdd')),
            ),
          )
        })

        // ---------------------------------------------------- 编辑器
        var editorBlock = null
        if (editor) {
          var nameInvalid = editor.name.trim().length === 0 || editor.name.trim().length > PROMPTS_MAX_NAME
          var contentInvalid = editor.content.trim().length === 0 || editor.content.length > PROMPTS_MAX_CONTENT
          var nameTaken = false
          for (var ni = 0; ni < customs.length; ni++) {
            if (customs[ni].id !== editor.id && customs[ni].name.trim().toLowerCase() === editor.name.trim().toLowerCase()) {
              nameTaken = true
              break
            }
          }
          function patchEditor(patch) {
            setEditor(function (prev) {
              var next = {}
              for (var k in prev) next[k] = prev[k]
              for (var p in patch) next[p] = patch[p]
              return next
            })
          }
          // 0.4.65 教训：计数必须读 editor.content（裸变量曾使「新建」整页渲染崩溃）。
          editorBlock = React.createElement(
            'div',
            { className: 'dshp-card', 'data-edit': '1' },
            React.createElement('div', { className: 'dshp-h' }, editor.id ? t('prompts.editor.editTitle') + (editor.name || t('common.unnamed')) : t('prompts.editor.newTitle')),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement(
                'div',
                { className: 'dshp-section-head' },
                React.createElement('div', { className: 'dshp-flabel' }, t('prompts.name')),
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement('span', { className: 'dshp-note', style: nameTaken ? { color: 'var(--dshp-err)' } : null }, nameTaken ? t('prompts.nameTaken') : editor.name.trim().length + ' / ' + PROMPTS_MAX_NAME),
              ),
              React.createElement('input', {
                type: 'text',
                className: 'dshp-text-input',
                style: { maxWidth: '320px' },
                value: editor.name,
                maxLength: PROMPTS_MAX_NAME,
                placeholder: t('prompts.namePlaceholder'),
                disabled: !writable || busy,
                onChange: function (event) { patchEditor({ name: event.target.value }) },
              }),
            ),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement('div', { className: 'dshp-flabel' }, t('prompts.relation')),
              promptChoices(t('prompts.mode'), editor.mode === 'replace' ? 'replace' : 'append', PROMPT_MODE_CHOICES, function (v) { patchEditor({ mode: v }) }, !writable || busy),
            ),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement(
                'div',
                { className: 'dshp-section-head' },
                React.createElement('div', { className: 'dshp-flabel' }, t('prompts.content')),
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement('span', { className: 'dshp-note' }, editor.content.length + ' / ' + PROMPTS_MAX_CONTENT),
              ),
              React.createElement('textarea', {
                className: 'dshp-textarea',
                style: { minHeight: '180px' },
                value: editor.content,
                maxLength: PROMPTS_MAX_CONTENT,
                placeholder: t('prompts.contentPlaceholder'),
                disabled: !writable || busy,
                onChange: function (event) { patchEditor({ content: event.target.value }) },
              }),
              // 1.4.1：模板变量说明（{{model}}/{{provider}} 每次请求实时代入，其余原样保留）。
              React.createElement('div', { className: 'dshp-note', style: { marginTop: '6px' } }, t('prompts.editor.varsHint')),
            ),
            React.createElement(
              'div',
              { className: 'dshp-footer' },
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy || nameInvalid || nameTaken || contentInvalid, onClick: saveEditor },
                busy ? t('common.saving') : t('common.save'),
              ),
              React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: busy, onClick: function () { setEditor(null); setSaveStatus('') } }, t('common.cancel')),
              saveStatus === 'failed' ? React.createElement('span', { className: 'dshp-note', style: { color: 'var(--dshp-err)' } }, t('prompts.saveFailed')) : null,
            ),
          )
        }

        var statusNote = saveStatus === 'saved' ? t('prompts.savedLive') : saveStatus === 'failed' ? t('prompts.saveRejected') : null
        var statusLine = statusNote
          ? React.createElement(
              'div',
              { className: 'dshp-footer' },
              React.createElement('i', { className: 'dshp-dot', 'data-tone': saveStatus === 'saved' ? 'ok' : 'err' }),
              React.createElement('span', { className: 'dshp-note' }, statusNote),
            )
          : null

        // ---------------------------------------------------- 0.4.45 工具提示页
        // 数据通道：工具目录通过 Host fetch 路由从 ctx.tools.schemas() 读取快照，不写入
        // settings；用户文本存 toolPrompts（toolName -> 文本，持久），
        // 模式存 toolPromptMode。只有用户明确点击刷新时才重新读取目录，
        // 编辑过程中列表不会因 session 探测或后台模型调用而变化。
        var savedToolPrompts = value.toolPrompts && typeof value.toolPrompts === 'object' ? value.toolPrompts : {}
        if (toolDrafts === null) {
          var d0 = {}
          for (var d0k in savedToolPrompts) {
            if (Object.prototype.hasOwnProperty.call(savedToolPrompts, d0k)) d0[d0k] = savedToolPrompts[d0k]
          }
          toolDrafts = d0
        }
        if (toolMode === null) toolMode = value.toolPromptMode === 'replace' ? 'replace' : 'append'
        // 1.4.36：应用到模式（勾选的模式才会被改写；未勾选 = 保持 DSH 原描述）。
        var savedToolModes = Array.isArray(value.toolPromptModes) ? value.toolPromptModes : PROMPTS_PRESETS.map(function (p) { return p.id })
        if (toolModes === null) toolModes = savedToolModes
        function toggleToolMode(id) {
          setToolModes(function (prev) {
            var base = prev === null ? savedToolModes : prev
            var has = base.indexOf(id) >= 0
            return PROMPTS_PRESETS.map(function (p) { return p.id }).filter(function (x) { return x === id ? !has : base.indexOf(x) >= 0 })
          })
        }
        var toolList = Array.isArray(toolCatalog) ? toolCatalog : []
        function setToolDraft(name, text) {
          setToolDrafts(function (prev) {
            var next = {}
            for (var k in prev) next[k] = prev[k]
            if (text) next[name] = text
            else delete next[name]
            return next
          })
        }

        function saveToolPrompts() {
          var out = {}
          for (var k in toolDrafts) {
            if (typeof toolDrafts[k] === 'string' && toolDrafts[k].trim() !== '') out[k] = toolDrafts[k]
          }
          submit([
            { op: 'set', path: ['toolPromptMode'], value: toolMode },
            { op: 'set', path: ['toolPromptModes'], value: toolModes },
            { op: 'set', path: ['toolPrompts'], value: out },
          ])
        }

        var customizedCount = 0
        // 0.4.77：未保存标记——drafts 与已存值比较，「保存」按钮旁可见。
        // 此前没有任何「尚未保存」的视觉提示，保存失败后用户无从知道输入已丢。
        var toolDirty = false
        ;(function () {
          var uns1 = {}
          var uns2 = {}
          for (var uns3 in toolDrafts) {
            if (typeof toolDrafts[uns3] === 'string' && toolDrafts[uns3].trim() !== '') uns1[uns3] = toolDrafts[uns3].trim()
          }
          for (var uns4 in savedToolPrompts) {
            if (typeof savedToolPrompts[uns4] === 'string' && savedToolPrompts[uns4].trim() !== '') uns2[uns4] = savedToolPrompts[uns4].trim()
          }
          // 0.4.78：按排序后的键值对比较——JSON.stringify 依赖对象键序，
          // 保存/读取路径若换序会产生假「未保存」标记。
          var key1 = Object.keys(uns1).sort()
          var key2 = Object.keys(uns2).sort()
          var sameShape = key1.length === key2.length
          for (var sk = 0; sameShape && sk < key1.length; sk++) {
            if (key1[sk] !== key2[sk] || uns1[key1[sk]] !== uns2[key2[sk]]) sameShape = false
          }
          var modesNow = (toolModes || []).slice().sort().join(',')
          var modesSaved = savedToolModes.slice().sort().join(',')
          toolDirty = !sameShape || toolMode !== (value.toolPromptMode === 'replace' ? 'replace' : 'append') || modesNow !== modesSaved
        })()
        var toolRows = []
        for (var tli = 0; tli < toolList.length; tli++) {
          ;(function (tool) {
            var text = typeof toolDrafts[tool.name] === 'string' ? toolDrafts[tool.name] : ''
            var custom = text.trim() !== ''
            if (custom) customizedCount++
            var firstLine = tool.description ? String(tool.description).split('\n')[0] : ''
            toolRows.push(
              React.createElement(
                'div',
                { key: tool.name, className: 'dshp-tool', 'data-on': custom ? '1' : undefined },
                React.createElement(
                  'div',
                  { className: 'dshp-tool-h' },
                  React.createElement('code', null, tool.name),
                  custom ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'accent' }, t('prompts.customized')) : null,
                ),
                tool.description
                  ? React.createElement(
                      'details',
                      null,
                      React.createElement('summary', { title: t('prompts.originalDesc') }, firstLine),
                      React.createElement('pre', null, tool.description),
                    )
                  : null,
                React.createElement('textarea', {
                  className: 'dshp-textarea',
                  style: { minHeight: '56px' },
                  'aria-label': t('prompts.customDescAria', { tool: tool.name }),
                  value: text,
                  maxLength: TOOL_PROMPT_MAX,
                  placeholder: t('prompts.keepDescPlaceholder'),
                  disabled: !writable || busy,
                  onChange: function (event) {
                    setToolDraft(tool.name, event.target.value)
                  },
                }),
              ),
            )
          })(toolList[tli])
        }

        // ------------------------------------------------ 1.4.1 上下文嵌入 tab
        // 三类框架注入的上下文（runtime-context 快照 / skill-catalog /
        // time-context）是 user-role 持久消息，模型每次请求都看到。宿主侧
        // （prompts/index.js 1.4.1 块）按本 tab 的配置做改写/关闭（默认
        // keep = 零注册 = 请求与原来逐字节一致）；客户端只负责编辑与
        // 「当前值」展示（contextPreview volatile 通道，随模型调用刷新）。
        var CTX_SECTION_ROWS = [
          { name: 'working-directory:current', labelKey: 'prompts.ctx.section.cwd', customAllowed: true, vars: '{{cwd}} {{model}} {{provider}}' },
          { name: 'sandbox:policy', labelKey: 'prompts.ctx.section.sandbox', customAllowed: false, vars: '' },
          { name: 'approval:policy', labelKey: 'prompts.ctx.section.approval', customAllowed: false, vars: '' },
          { name: 'harness:source', labelKey: 'prompts.ctx.section.harness', customAllowed: true, vars: '{{checkout}}' },
          { name: 'app:web-surface', labelKey: 'prompts.ctx.section.web', customAllowed: true, vars: '{{webUrl}}' },
        ]
        // custom 未填模板时宿主用同文兜底；「默认模板」按钮预填同文。
        var CTX_DEFAULT_SECTIONS_TPL = {
          'working-directory:current': 'Current working directory: {{cwd}}.',
          'harness:source': 'Current DeepSeek Harness implementation checkout: {{checkout}}.',
          'app:web-surface': 'Current DeepSeek Harness Web GUI URL: {{webUrl}}.',
        }
        // 1.4.17：删掉「全部注入通道（实况）」表。它对用户唯一的效果是把
        // 26 行只读 kind 堆在页面上（用户：「除了让 UI 变丑以外没有一点用」）。
        // 注入消息现在按类别直接给出可调项：技能提示 / 压缩提示 / 时间提示 /
        // 模型切换提示，每类一行，没有可操作内容的不再罗列。
        var CTX_DEFAULT_MODEL_SELECTION_TPL = '{{text}}'
        var CTX_DEFAULT_CATALOG_TPL =
          '<system-reminder>\n{{note}}\n\n<available_skills>\n{{entries}}\n</available_skills>\n\n' +
          "If the user names a skill, or the task clearly matches a skill's description, call the `skill` tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill's instructions until it has been loaded.\n" +
          'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the `skill` tool again for that skill.\n' +
          '</system-reminder>'
        var CTX_DEFAULT_TIME_TPL = 'Time sampled while preparing turn {{turn}}, step {{step}}: {{timestamp}}'
        // 指令文件（AGENTS.md 一类）的默认模板 = 原文逐字节不变；{{files}} 是
        // 本步涉及的文件列表。用户可以加前缀/后缀，也可以整类关掉。
        var CTX_DEFAULT_AGENT_INSTRUCTIONS_TPL = '{{text}}'

        function ceDraftFromValue(value) {
          var ce = value && value.contextEmbedding && typeof value.contextEmbedding === 'object' ? value.contextEmbedding : {}
          var rc = ce.runtimeContext && typeof ce.runtimeContext === 'object' ? ce.runtimeContext : {}
          var secs = rc.sections && typeof rc.sections === 'object' ? rc.sections : {}
          var sections = {}
          for (var i = 0; i < CTX_SECTION_ROWS.length; i++) {
            var name = CTX_SECTION_ROWS[i].name
            var s = secs[name]
            var mode = 'keep'
            if (s && typeof s === 'object') {
              if (s.mode === 'off') mode = 'off'
              else if (s.mode === 'custom' && CTX_SECTION_ROWS[i].customAllowed) mode = 'custom'
            }
            sections[name] = { mode: mode, template: s && typeof s.template === 'string' ? s.template : '' }
          }
          var sc = ce.skillCatalog && typeof ce.skillCatalog === 'object' ? ce.skillCatalog : {}
          var tc = ce.timeContext && typeof ce.timeContext === 'object' ? ce.timeContext : {}
          var ms = ce.modelSelection && typeof ce.modelSelection === 'object' ? ce.modelSelection : {}
          var cp = ce.compaction && typeof ce.compaction === 'object' ? ce.compaction : {}
          var ck = ce.checkpoint && typeof ce.checkpoint === 'object' ? ce.checkpoint : {}
          var ai = ce.agentInstructions && typeof ce.agentInstructions === 'object' ? ce.agentInstructions : {}
          return {
            runtimeEnabled: !(rc && rc.enabled === false),
            sections: sections,
            catalogMode: sc.mode === 'off' || sc.mode === 'custom' ? sc.mode : 'keep',
            catalogTemplate: typeof sc.template === 'string' ? sc.template : '',
            timeMode: tc.mode === 'off' || tc.mode === 'custom' ? tc.mode : 'keep',
            timeTemplate: typeof tc.template === 'string' ? tc.template : '',
            modelSelectionMode: ms.mode === 'off' || ms.mode === 'custom' ? ms.mode : 'keep',
            modelSelectionTemplate: typeof ms.template === 'string' ? ms.template : '',
            compactionMode: cp.mode === 'custom' ? 'custom' : 'keep',
            compactionTemplate: typeof cp.template === 'string' ? cp.template : '',
            checkpointMode: ck.mode === 'custom' ? 'custom' : 'keep',
            checkpointTemplate: typeof ck.template === 'string' ? ck.template : '',
            agentInstructionsMode: ai.mode === 'off' || ai.mode === 'custom' ? ai.mode : 'keep',
            agentInstructionsTemplate: typeof ai.template === 'string' ? ai.template : '',
          }
        }

        function cePatch(patch) {
          setCtxDraft(function (prev) {
            var base = prev || ceDraftFromValue(value)
            var next = {}
            for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) next[k] = base[k]
            for (var k2 in patch) if (Object.prototype.hasOwnProperty.call(patch, k2)) next[k2] = patch[k2]
            if (patch.sections) {
              next.sections = {}
              for (var k3 in base.sections) next.sections[k3] = base.sections[k3]
              for (var k4 in patch.sections) next.sections[k4] = patch.sections[k4]
            }
            return next
          })
        }

        function ceSave() {
          if (!ctxDraft) return
          submit([
            {
              op: 'set',
              path: ['contextEmbedding'],
              value: {
                runtimeContext: { enabled: ctxDraft.runtimeEnabled, sections: ctxDraft.sections },
                skillCatalog: { mode: ctxDraft.catalogMode, template: ctxDraft.catalogTemplate },
                timeContext: { mode: ctxDraft.timeMode, template: ctxDraft.timeTemplate },
                modelSelection: { mode: ctxDraft.modelSelectionMode, template: ctxDraft.modelSelectionTemplate },
                compaction: { mode: ctxDraft.compactionMode, template: ctxDraft.compactionTemplate },
                checkpoint: { mode: ctxDraft.checkpointMode, template: ctxDraft.checkpointTemplate },
                agentInstructions: { mode: ctxDraft.agentInstructionsMode, template: ctxDraft.agentInstructionsTemplate },
              },
            },
          ])
        }

        function ceModeSelect(label, value, withCustom, onChange, disabled) {
          return React.createElement(
            'select',
            {
              className: 'dshp-select dshp-ctx-mode',
              value: value,
              disabled: !!disabled,
              'aria-label': label,
              onChange: function (event) { onChange(event.target.value) },
            },
            React.createElement('option', { value: 'keep' }, t('prompts.ctx.mode.keep')),
            React.createElement('option', { value: 'off' }, t('prompts.ctx.mode.off')),
            withCustom ? React.createElement('option', { value: 'custom' }, t('prompts.ctx.mode.custom')) : null,
          )
        }

        function ceAssembledText(name) {
          var cp = value.contextPreview && Array.isArray(value.contextPreview.contexts) ? value.contextPreview.contexts : []
          for (var i = 0; i < cp.length; i++) {
            if (cp[i] && cp[i].name === name && typeof cp[i].text === 'string') return cp[i].text
          }
          return null
        }

        function ceRuntimeSnapshot() {
          var cp = value.contextPreview
          return cp && cp.runtimeSnapshot && typeof cp.runtimeSnapshot === 'object' ? cp.runtimeSnapshot : null
        }

        function ceCurrentText(name) {
          var snapshot = ceRuntimeSnapshot()
          if (snapshot && Array.isArray(snapshot.sections)) {
            for (var i = 0; i < snapshot.sections.length; i++) {
              if (snapshot.sections[i] && snapshot.sections[i].name === name && typeof snapshot.sections[i].text === 'string') return snapshot.sections[i].text
            }
            // A durable snapshot is authoritative; a missing section was not in the
            // latest persisted runtime-context message, even if assemble had a value.
            return null
          }
          return ceAssembledText(name)
        }

        // The runtime snapshot uses system-prompt assembly contexts; other context
        // classes (skill reminder, time notice, compact checkpoints, etc.) are
        // persisted user/developer messages captured by the session/event observer.
        function ceCurrentInjected(kind) {
          var list = value.contextPreview && Array.isArray(value.contextPreview.injected) ? value.contextPreview.injected : []
          for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].kind === kind) return list[i]
          }
          return null
        }

        var pageTabs = promptSeg(
          [
            { id: 'system', label: t('prompts.tabSystem'), title: t('prompts.tabSystem.title') },
            { id: 'mode', label: t('prompts.tabMode'), title: t('prompts.tabMode.title') },
            { id: 'tools', label: t('prompts.tabTools'), title: t('prompts.tabTools.title') },
            { id: 'contexts', label: t('prompts.tabContexts'), title: t('prompts.tabContexts.title') },
          ],
          page,
          setPage,
          t('prompts.section'),
        )

        // ------------------------------------------------------------ 模式选择页
        // 选哪份 → 它和 DSH 默认如何组成（构成条）→ 模型实际看到的最终文本。
        // 0.4.94：当前模板（快速实时查看）——目的不是展示真实请求，
        // 是让用户确认没选错提示词：内置 = 显示该模式的 DSH 默认；
        // 自定义 = 显示模板名 + 模式标签 + 模板原文（变量原样保留）。
        var currentTemplateBlock = null
        if (activeEntry) {
          var ctContent = promptTextValue(activeEntry.content)
          currentTemplateBlock = React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-gh', style: { margin: 0 } }, t('prompts.currentTemplate')),
              promptKindTag(activeMode),
              React.createElement('span', { className: 'dshp-note' }, t('prompts.chars', { len: ctContent.length })),
            ),
            React.createElement(
              'div',
              { className: 'dshp-code' },
              React.createElement(
                'div',
                { className: 'dshp-code-head' },
                React.createElement('code', null, activeEntry.name),
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: ctContent.length === 0, onClick: function () { doCopy(ctContent) } },
                  copied ? t('common.copied') : t('common.copy'),
                ),
              ),
              React.createElement('pre', { className: 'dshp-preview' }, ctContent.length > 0 ? ctContent : t('common.unparsed')),
            ),
          )
        } else {
          var builtinView2 = builtinMap['builtin:' + selectedPreset] || null
          var ctBuiltinText = builtinView2
            ? promptTextValue(builtinView2.template) || promptTextValue(builtinView2.text)
            : ''
          currentTemplateBlock = React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-gh', style: { margin: 0 } }, t('prompts.currentTemplate')),
              React.createElement('span', { className: 'dshp-tag' }, t('prompts.builtinTag')),
              ctBuiltinText.length > 0 ? React.createElement('span', { className: 'dshp-note' }, t('prompts.chars', { len: ctBuiltinText.length })) : null,
            ),
            React.createElement(
              'div',
              { className: 'dshp-code' },
              React.createElement(
                'div',
                { className: 'dshp-code-head' },
                React.createElement('code', null, builtinLabelOf('builtin:' + selectedPreset) || 'builtin:' + selectedPreset),
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: ctBuiltinText.length === 0, onClick: function () { doCopy(ctBuiltinText) } },
                  copied ? t('common.copied') : t('common.copy'),
                ),
              ),
              React.createElement(
                'pre',
                { className: 'dshp-preview' },
                ctBuiltinText.length > 0 ? ctBuiltinText : React.createElement('span', { style: { color: 'var(--dshp-faint)' } }, t('prompts.note.nextCall')),
              ),
            ),
          )
        }

        if (page === 'mode') {
          return React.createElement(
            'div',
            { className: 'dshp-form' },
            pageTabs,
            // 1.4.36：模式选择不再嵌在卡片里（之前是 分段 套 卡片 套 分段，层级太乱）。
            React.createElement('div', { className: 'dshp-section-head' }, presetTabs),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                React.createElement('span', { className: 'dshp-flabel', style: { flex: '0 0 auto' } }, t('prompts.activeLabel')),
                activeSelect,
                activeEntry ? promptKindTag(activeMode) : React.createElement('span', { className: 'dshp-tag' }, t('prompts.builtinTag')),
              ),
              activeEntry ? promptBar(compParts, true) : null,
              activeEntry ? promptLegend(compLegend) : null,
            ),
            // 0.4.94：当前模板（快速实时查看）——目的不是展示真实请求，
            // 是让用户确认没选错提示词：内置 = 显示该模式的 DSH 默认；
            // 自定义 = 显示模板名 + 模式标签 + 模板原文（变量原样保留）。
            currentTemplateBlock,
            React.createElement(
              'div',
              { className: 'dshp-section' },
              React.createElement(
                'div',
                { className: 'dshp-section-head' },
                React.createElement('div', { className: 'dshp-gh', style: { margin: 0 } }, t('prompts.previewHeading')),
                probeNote
                  ? React.createElement('span', { className: 'dshp-note', style: { flex: '0 1 auto' } }, probeNote)
                  : null,
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshp-btn-sm dshp-btn-ghost',
                    title: t('prompts.note.probe.title'),
                    disabled: probeRefreshing,
                    onClick: requestProbe,
                  },
                  probeRefreshing ? t('common.refreshing') : t('prompts.refreshPreview'),
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: modeFinalText.length === 0, onClick: function () { doCopy(modeFinalText) } },
                  copied ? t('common.copied') : t('common.copy'),
                ),
              ),
              React.createElement(
                'div',
                { className: 'dshp-code' },
                React.createElement(
                  'div',
                  { className: 'dshp-code-head' },
                  React.createElement('span', null, modeFinalHint || t('prompts.previewChars', { len: modeFinalText.length })),
                  React.createElement('span', { className: 'dshp-spacer' }),
                ),
                React.createElement(
                  'pre',
                  { className: 'dshp-preview' },
                  modeFinalText.length > 0 ? modeFinalText : React.createElement('span', { style: { color: 'var(--dshp-faint)' } }, modeFinalHint),
                ),
              ),
            ),
            statusLine,
          )
        }

        if (page === 'tools') {
          return React.createElement(
            'div',
            { className: 'dshp-form' },
            pageTabs,
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-h' }, t('prompts.tools.heading')),
              React.createElement('div', { className: 'dshp-hint' }, t('prompts.tools.hint')),
              refreshNote || toolCatalogUpdatedAt
                ? React.createElement(
                    'span',
                    { className: 'dshp-note', style: { flex: '0 0 auto' } },
                    refreshNote ? refreshNote : t('prompts.snapshot', { time: new Date(toolCatalogUpdatedAt).toLocaleTimeString() }),
                  )
                : null,
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn-sm', disabled: refreshing, title: t('prompts.refresh.title'), onClick: requestRefresh },
                refreshing ? t('common.refreshing') : t('prompts.refreshToolList'),
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              promptChoices(t('prompts.toolMode'), toolMode === 'replace' ? 'replace' : 'append', TOOL_MODE_CHOICES, setToolMode, !writable || busy),
              React.createElement(
                'div',
                { className: 'dshp-checks' },
                React.createElement('span', { className: 'dshp-note' }, t('prompts.toolModes')),
                React.createElement('span', { className: 'dshp-hint' }, t('prompts.toolModesHint')),
                PROMPTS_PRESETS.map(function (preset) {
                  return React.createElement(
                    'label',
                    { key: preset.id, className: 'dshp-check' },
                    React.createElement('input', {
                      type: 'checkbox',
                      checked: (toolModes || []).indexOf(preset.id) >= 0,
                      disabled: !writable || busy,
                      onChange: function () { toggleToolMode(preset.id) },
                    }),
                    preset.id === 'cordis' ? t('prompts.tab.cordis') : preset.id === 'standard' ? t('prompts.tab.standard') : preset.id === 'minimal' ? t('prompts.tab.minimal') : 'ptc',
                  )
                }),
              ),
              toolList.length === 0
                ? React.createElement('div', { className: 'dshp-hint' }, t('prompts.emptyCatalog'))
                : React.createElement('div', { className: 'dshp-list' }, toolRows),
            ),
            React.createElement(
              'div',
              { className: 'dshp-savebar' },
              React.createElement('i', { className: 'dshp-dot', 'data-tone': toolDirty ? 'warn' : 'idle' }),
              toolDirty
                ? React.createElement('span', { className: 'dshp-note' }, t('common.unsaved'))
                : customizedCount > 0
                  ? React.createElement('span', { className: 'dshp-note' }, t('prompts.customizedCount', { n: customizedCount, total: toolList.length }))
                  : React.createElement('span', { className: 'dshp-note' }, t('prompts.noCustomized')),
              React.createElement('span', { className: 'dshp-spacer' }),
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy, onClick: saveToolPrompts },
                t('prompts.saveTools'),
              ),
            ),
            statusLine,
          )
        }

        // ------------------------------------------------------------ 上下文嵌入页（1.4.1）
        if (page === 'contexts') {
          var ceLive = ctxDraft || ceDraftFromValue(value)
          var ceDirty = !!ctxDraft && JSON.stringify(ctxDraft) !== JSON.stringify(ceDraftFromValue(value))
          var cePreviewAt = value.contextPreview && typeof value.contextPreview.updatedAt === 'number' ? value.contextPreview.updatedAt : 0
          var ceCompaction = value.contextPreview && value.contextPreview.compaction && typeof value.contextPreview.compaction === 'object' ? value.contextPreview.compaction : null

          function ceSetSection(name, patch) {
            var one = {}
            one[name] = Object.assign({}, ceLive.sections[name], patch)
            cePatch({ sections: one })
          }

          var ceSectionRows = CTX_SECTION_ROWS.map(function (row) {
            var st = ceLive.sections[row.name]
            var current = ceCurrentText(row.name)
            var assembled = ceAssembledText(row.name)
            var runtimeSnapshot = ceRuntimeSnapshot()
            var snapshotAt = runtimeSnapshot && typeof runtimeSnapshot.capturedAt === 'number' && runtimeSnapshot.capturedAt > 0 ? new Date(runtimeSnapshot.capturedAt).toLocaleString() : ''
            var snapshotSession = runtimeSnapshot && typeof runtimeSnapshot.sessionId === 'string' ? runtimeSnapshot.sessionId : ''
            var label = t(row.labelKey)
            return React.createElement(
              'div',
              { key: row.name, className: 'dshp-ctx-row' },
              React.createElement(
                'div',
                { className: 'dshp-ctx-row-head' },
                React.createElement(
                  'div',
                  { className: 'dshp-text' },
                  React.createElement('div', { className: 'dshp-label', title: row.customAllowed === false ? t('prompts.ctx.dynamicOnly') : undefined }, label),
                ),
                ceModeSelect(t('prompts.ctx.modeFor', { name: label }), st.mode, row.customAllowed, function (v) { ceSetSection(row.name, { mode: v }) }, !writable || busy),
              ),
              st.mode === 'custom'
                ? React.createElement(
                    'div',
                    { className: 'dshp-ctx-editor' },
                    React.createElement(
                      'div',
                      { className: 'dshp-ctx-template-head' },
                      t('prompts.ctx.template'),
                      React.createElement('span', { className: 'dshp-spacer' }),
                      current
                        ? React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dshp-btn-sm dshp-btn-ghost',
                              disabled: !writable || busy,
                              title: t('prompts.ctx.useCurrent.title'),
                              onClick: function () { ceSetSection(row.name, { template: current }) },
                            },
                            t('prompts.ctx.useCurrent'),
                          )
                        : null,
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.defaultTpl.title'),
                          onClick: function () { ceSetSection(row.name, { template: CTX_DEFAULT_SECTIONS_TPL[row.name] || '' }) },
                        },
                        t('prompts.ctx.defaultTpl'),
                      ),
                    ),
                    React.createElement('textarea', {
                      className: 'dshp-textarea',
                      style: { minHeight: '76px' },
                      value: st.template,
                      placeholder: t('prompts.ctx.templatePlaceholder'),
                      disabled: !writable || busy,
                      onChange: function (event) { ceSetSection(row.name, { template: event.target.value }) },
                    }),
                    row.vars ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.vars', { vars: row.vars })) : null,
                  )
                : null,
              React.createElement(
                'details',
                { className: 'dshp-ctx-current' },
                React.createElement('summary', null, t('prompts.ctx.current')),
                runtimeSnapshot
                  ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.snapshot.meta', { session: snapshotSession || '-', time: snapshotAt || '-' }))
                  : React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.assemblyOnly')),
                React.createElement('pre', { className: 'dshp-preview dshp-ctx-preview' }, current || (runtimeSnapshot ? t('prompts.ctx.notInSnapshot') : t('prompts.ctx.notCaptured'))),
                assembled !== null && assembled !== current
                  ? React.createElement(
                      'details',
                      { className: 'dshp-details', style: { marginTop: '6px' } },
                      React.createElement('summary', null, t('prompts.ctx.assemblyValue')),
                      React.createElement('pre', { className: 'dshp-preview dshp-ctx-preview' }, assembled),
                    )
                  : null,
              ),
            )
          })

          function ceMessageRow(key, labelKey, hintKey, mode, template, setMode, setTemplate, defaultTpl, varsText, injectedKind) {
            var label = t(labelKey)
            var latest = ceCurrentInjected(injectedKind)
            var latestText = latest && typeof latest.text === 'string' ? latest.text : ''
            var latestCount = latest && typeof latest.count === 'number' ? latest.count : 0
            var latestForm = latest && typeof latest.form === 'string' && latest.form ? latest.form : '-'
            var latestSession = latest && typeof latest.sessionId === 'string' && latest.sessionId ? latest.sessionId : '-'
            var latestAt = latest && typeof latest.lastAt === 'number' && latest.lastAt > 0 ? new Date(latest.lastAt).toLocaleString() : '-'
            return React.createElement(
              'div',
              { key: key, className: 'dshp-ctx-row' },
              React.createElement(
                'div',
                { className: 'dshp-ctx-row-head' },
                // 1.4.21：每个列表项都有 key。单行类别也不能省——用户明确要求
                // 「虽然只有一个列表项，但不代表你能省略 key」。
                React.createElement(
                  'div',
                  { className: 'dshp-text' },
                  React.createElement('div', { className: 'dshp-label', title: t(hintKey) }, label),
                ),
                ceModeSelect(t('prompts.ctx.modeFor', { name: label }), mode, true, setMode, !writable || busy),
              ),
              mode === 'custom'
                ? React.createElement(
                    'div',
                    { className: 'dshp-ctx-editor' },
                    React.createElement(
                      'div',
                      { className: 'dshp-ctx-template-head' },
                      t('prompts.ctx.template'),
                      React.createElement('span', { className: 'dshp-spacer' }),
                      latestText
                        ? React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dshp-btn-sm dshp-btn-ghost',
                              disabled: !writable || busy,
                              title: t('prompts.ctx.useCurrent.title'),
                              onClick: function () { setTemplate(latestText) },
                            },
                            t('prompts.ctx.useCurrent'),
                          )
                        : null,
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.defaultTpl.title'),
                          onClick: function () { setTemplate(defaultTpl) },
                        },
                        t('prompts.ctx.defaultTpl'),
                      ),
                      // 1.4.21：与运行时快照行一致的复位入口：模式回「保持」。
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.reset.title'),
                          onClick: function () { setMode('keep') },
                        },
                        t('prompts.ctx.reset'),
                      ),
                    ),
                    React.createElement('textarea', {
                      className: 'dshp-textarea',
                      style: { minHeight: '88px' },
                      value: template,
                      placeholder: t('prompts.ctx.templatePlaceholder'),
                      disabled: !writable || busy,
                      onChange: function (event) { setTemplate(event.target.value) },
                    }),
                    varsText ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.vars', { vars: varsText })) : null,
                    latestText ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.useCurrent.hint')) : null,
                  )
                : null,
              React.createElement(
                'details',
                { className: 'dshp-ctx-current' },
                // 1.4.21：「最近实际注入值」是一个静态的展开按钮，标题后面不再
                // 粘一段「持久注入 · 会话 …」的解释（用户：「你难道没有审美的吗」）。
                // 说明文字放到展开后的第一行。
                React.createElement('summary', null, t('prompts.ctx.current')),
                latest ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.channel.meta', { count: latestCount, session: latestSession, form: latestForm, time: latestAt })) : null,
                React.createElement('pre', { className: 'dshp-preview dshp-ctx-preview' }, latestText || t('prompts.ctx.notCaptured')),
              ),
            )
          }

          // 1.4.17：压缩提示词（compaction 的末尾指令）行。核心把它作为最后
          // 一条 user 消息发出，本组件在 llm/stream 里替换；因此这里只有
          // keep / custom 两态，没有「关闭」。
          function ceCompactionRow() {
            var label = t('prompts.ctx.section.compaction')
            var latestText = ceCompaction && typeof ceCompaction.instruction === 'string' ? ceCompaction.instruction : ''
            var latestMeta = ceCompaction
              ? t('prompts.ctx.compaction.meta', {
                  purpose: ceCompaction.purpose || '-',
                  session: ceCompaction.sessionId || '-',
                  provider: ceCompaction.provider || '-',
                  model: ceCompaction.model || '-',
                  count: ceCompaction.inputMessageCount || 0,
                  time: ceCompaction.capturedAt ? new Date(ceCompaction.capturedAt).toLocaleString() : '-',
                  chars: ceCompaction.instructionChars || 0,
                  truncated: ceCompaction.truncated ? t('prompts.ctx.compaction.truncated') : '',
                })
              : ''
            return React.createElement(
              'div',
              { key: 'compaction', className: 'dshp-ctx-row' },
              React.createElement(
                'div',
                { className: 'dshp-ctx-row-head' },
                React.createElement(
                  'div',
                  { className: 'dshp-text' },
                  React.createElement('div', { className: 'dshp-label', title: t('prompts.ctx.compactionHint') }, label),
                ),
                React.createElement(
                  'select',
                  {
                    className: 'dshp-select dshp-ctx-mode',
                    value: ceLive.compactionMode,
                    disabled: !writable || busy,
                    'aria-label': t('prompts.ctx.modeFor', { name: label }),
                    onChange: function (event) { cePatch({ compactionMode: event.target.value }) },
                  },
                  React.createElement('option', { value: 'keep' }, t('prompts.ctx.mode.keep')),
                  React.createElement('option', { value: 'custom' }, t('prompts.ctx.mode.custom')),
                ),
              ),
              ceLive.compactionMode === 'custom'
                ? React.createElement(
                    'div',
                    { className: 'dshp-ctx-editor' },
                    React.createElement(
                      'div',
                      { className: 'dshp-ctx-template-head' },
                      t('prompts.ctx.template'),
                      React.createElement('span', { className: 'dshp-spacer' }),
                      latestText
                        ? React.createElement(
                            'button',
                            {
                              type: 'button',
                              className: 'dshp-btn-sm dshp-btn-ghost',
                              disabled: !writable || busy,
                              title: t('prompts.ctx.useCurrent.title'),
                              onClick: function () { cePatch({ compactionTemplate: latestText }) },
                            },
                            t('prompts.ctx.useCurrent'),
                          )
                        : null,
                      // 1.4.21：与其它编辑器同一套按钮——「恢复默认模板」只清模板
                      // （空模板 = 核心原文），「恢复默认」连模式一起复位。
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.defaultTpl.title'),
                          onClick: function () { cePatch({ compactionTemplate: '' }) },
                        },
                        t('prompts.ctx.defaultTpl'),
                      ),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.compaction.clear.title'),
                          onClick: function () { cePatch({ compactionMode: 'keep', compactionTemplate: '' }) },
                        },
                        t('prompts.ctx.compaction.clear'),
                      ),
                    ),
                    React.createElement('textarea', {
                      className: 'dshp-textarea',
                      style: { minHeight: '120px' },
                      value: ceLive.compactionTemplate,
                      placeholder: t('prompts.ctx.compaction.placeholder'),
                      disabled: !writable || busy,
                      onChange: function (event) { cePatch({ compactionTemplate: event.target.value }) },
                    }),
                    React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.vars', { vars: '{{model}} {{provider}} {{turns}}' })),
                    !ceLive.compactionTemplate.trim()
                      ? React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.compaction.empty'))
                      : null,
                  )
                : null,
              React.createElement(
                'details',
                { className: 'dshp-ctx-current' },
                React.createElement('summary', null, t('prompts.ctx.current'), latestMeta ? ' · ' + latestMeta : ''),
                React.createElement('pre', { className: 'dshp-preview dshp-ctx-preview' }, latestText || t('prompts.ctx.compaction.notCaptured')),
              ),
            )
          }
          var ceCompactionBlock = ceCompactionRow()

          // 1.4.18：压缩检查点的前缀句。核心 frameSummary() 写的是
          // `前缀句 + "\n\n<compacted-summary>"`；这里只改前缀句。
          function ceCheckpointRow() {
            var label = t('prompts.ctx.section.checkpoint')
            return React.createElement(
              'div',
              { key: 'checkpoint', className: 'dshp-ctx-row' },
              React.createElement(
                'div',
                { className: 'dshp-ctx-row-head' },
                React.createElement(
                  'div',
                  { className: 'dshp-text' },
                  React.createElement('div', { className: 'dshp-label', title: t('prompts.ctx.checkpointHint') }, label),
                ),
                React.createElement(
                  'select',
                  {
                    className: 'dshp-select dshp-ctx-mode',
                    value: ceLive.checkpointMode,
                    disabled: !writable || busy,
                    'aria-label': t('prompts.ctx.modeFor', { name: label }),
                    onChange: function (event) { cePatch({ checkpointMode: event.target.value }) },
                  },
                  React.createElement('option', { value: 'keep' }, t('prompts.ctx.mode.keep')),
                  React.createElement('option', { value: 'custom' }, t('prompts.ctx.mode.custom')),
                ),
              ),
              ceLive.checkpointMode === 'custom'
                ? React.createElement(
                    'div',
                    { className: 'dshp-ctx-editor' },
                    // 1.4.21：本行以前没有工具条，与其它编辑器不一致。
                    React.createElement(
                      'div',
                      { className: 'dshp-ctx-template-head' },
                      t('prompts.ctx.template'),
                      React.createElement('span', { className: 'dshp-spacer' }),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.defaultTpl.title'),
                          onClick: function () { cePatch({ checkpointTemplate: '' }) },
                        },
                        t('prompts.ctx.defaultTpl'),
                      ),
                      React.createElement(
                        'button',
                        {
                          type: 'button',
                          className: 'dshp-btn-sm dshp-btn-ghost',
                          disabled: !writable || busy,
                          title: t('prompts.ctx.reset.title'),
                          onClick: function () { cePatch({ checkpointMode: 'keep', checkpointTemplate: '' }) },
                        },
                        t('prompts.ctx.reset'),
                      ),
                    ),
                    React.createElement('textarea', {
                      className: 'dshp-textarea',
                      style: { minHeight: '72px' },
                      value: ceLive.checkpointTemplate,
                      placeholder: t('prompts.ctx.checkpoint.placeholder'),
                      disabled: !writable || busy,
                      onChange: function (event) { cePatch({ checkpointTemplate: event.target.value }) },
                    }),
                    React.createElement('div', { className: 'dshp-note' }, t('prompts.ctx.checkpoint.note')),
                  )
                : null,
            )
          }
          var ceCheckpointBlock = ceCheckpointRow()

          function ceRuntimeSwitch() {
            var enabled = ceLive.runtimeEnabled
            return React.createElement(
              'button',
              {
                type: 'button',
                role: 'switch',
                'aria-checked': enabled ? 'true' : 'false',
                'aria-label': t('prompts.ctx.runtime.master'),
                className: 'dshp-switch',
                disabled: !writable || busy,
                onClick: function () { cePatch({ runtimeEnabled: !enabled }) },
              },
              React.createElement('span', { className: 'dshp-knob' }),
            )
          }

          /**
           * 一类一卡：标题就是类别名（说明只进 tooltip），右侧可挂一个开关，
           * 下面放该类别的一行或多行。用户要的是「分好类」，不是一个大桶。
           */
          function ceCategoryCard(key, titleKey, hintKey, rows, action) {
            var list = Array.isArray(rows) ? rows : [rows]
            return React.createElement(
              'div',
              { key: key, className: 'dshp-card' },
              React.createElement(
                'div',
                { className: 'dshp-ctx-master' },
                React.createElement(
                  'div',
                  { className: 'dshp-text' },
                  React.createElement('div', { className: 'dshp-h', title: t(hintKey) }, t(titleKey)),
                ),
                action || null,
              ),
              React.createElement('div', { className: 'dshp-ctx-list' }, list),
            )
          }

          return React.createElement(
            'div',
            { className: 'dshp-form' },
            pageTabs,
            React.createElement(
              'div',
              { className: 'dshp-section-head', style: { alignItems: 'flex-start' } },
              React.createElement(
                'div',
                { className: 'dshp-text' },
                React.createElement('div', { className: 'dshp-h', title: t('prompts.ctx.hint') }, t('prompts.ctx.heading')),
              ),
              cePreviewAt ? React.createElement('span', { className: 'dshp-tag', title: t('prompts.ctx.snapshot.title') }, t('prompts.ctx.snapshot', { time: new Date(cePreviewAt).toLocaleTimeString() })) : null,
            ),
            // 1.4.20：一类一卡。用户在「上下文」页看到的必须是明确的分类
            // （运行时快照 / 技能提示 / 压缩提示 / 时间提示 / 模型切换提示），
            // 不是一个叫「注入消息」的大桶。类别名 = 卡片标题，说明进 tooltip。
            ceCategoryCard('runtime', 'prompts.ctx.runtime.heading', 'prompts.ctx.runtime.masterHint', ceSectionRows, ceRuntimeSwitch()),
            ceCategoryCard(
              'catalog',
              'prompts.ctx.section.catalog',
              'prompts.ctx.catalogHint',
              ceMessageRow('catalog', 'prompts.ctx.section.catalog', 'prompts.ctx.catalogHint', ceLive.catalogMode, ceLive.catalogTemplate, function (v) { cePatch({ catalogMode: v }) }, function (tpl) { cePatch({ catalogTemplate: tpl }) }, CTX_DEFAULT_CATALOG_TPL, '{{entries}} {{count}} {{note}}', 'skill-catalog'),
            ),
            ceCategoryCard(
              'compaction',
              'prompts.ctx.section.compaction',
              'prompts.ctx.compactionHint',
              [ceCompactionBlock, ceCheckpointBlock],
            ),
            ceCategoryCard(
              'time',
              'prompts.ctx.section.time',
              'prompts.ctx.timeHint',
              ceMessageRow('time', 'prompts.ctx.section.time', 'prompts.ctx.timeHint', ceLive.timeMode, ceLive.timeTemplate, function (v) { cePatch({ timeMode: v }) }, function (tpl) { cePatch({ timeTemplate: tpl }) }, CTX_DEFAULT_TIME_TPL, '{{timestamp}} {{turn}} {{step}}', 'time-context'),
            ),
            ceCategoryCard(
              'modelSelection',
              'prompts.ctx.section.modelSelection',
              'prompts.ctx.modelSelectionHint',
              ceMessageRow('modelSelection', 'prompts.ctx.section.modelSelection', 'prompts.ctx.modelSelectionHint', ceLive.modelSelectionMode, ceLive.modelSelectionTemplate, function (v) { cePatch({ modelSelectionMode: v }) }, function (tpl) { cePatch({ modelSelectionTemplate: tpl }) }, CTX_DEFAULT_MODEL_SELECTION_TPL, '{{text}} {{kind}} {{model}} {{provider}}', 'model-selection'),
            ),
            ceCategoryCard(
              'agentInstructions',
              'prompts.ctx.section.agentInstructions',
              'prompts.ctx.agentInstructionsHint',
              ceMessageRow('agentInstructions', 'prompts.ctx.section.agentInstructions', 'prompts.ctx.agentInstructionsHint', ceLive.agentInstructionsMode, ceLive.agentInstructionsTemplate, function (v) { cePatch({ agentInstructionsMode: v }) }, function (tpl) { cePatch({ agentInstructionsTemplate: tpl }) }, CTX_DEFAULT_AGENT_INSTRUCTIONS_TPL, '{{text}} {{files}}', 'agent-instructions'),
            ),
            React.createElement(
              'details',
              { className: 'dshp-ctx-notes' },
              React.createElement('summary', null, t('prompts.ctx.notes')),
              React.createElement(
                'div',
                { className: 'dshp-ctx-note-body' },
                React.createElement('div', { className: 'dshp-hint' }, t('prompts.ctx.wrapperFixed')),
                React.createElement('div', { className: 'dshp-hint' }, t('prompts.ctx.stabilityWarn')),
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-savebar' },
              React.createElement('i', { className: 'dshp-dot', 'data-tone': ceDirty ? 'warn' : 'idle' }),
              ceDirty ? React.createElement('span', { className: 'dshp-note' }, t('common.unsaved')) : React.createElement('span', { className: 'dshp-note' }, t('prompts.ctx.allKeep')),
              React.createElement('span', { className: 'dshp-spacer' }),
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy || !ceDirty, onClick: ceSave },
                t('prompts.ctx.save'),
              ),
            ),
            statusLine,
          )
        }

        // ------------------------------------------------------------ 系统提示词页
        // 模板库（内置默认 + 我的模板，行内标出被哪个模式使用）+ 内置模板查看 + 编辑器。
        return React.createElement(
          'div',
          { className: 'dshp-form' },
          pageTabs,
          React.createElement(
            'div',
            { className: 'dshp-card' },
            React.createElement(
              'div',
              { className: 'dshp-lib' },
              React.createElement('div', { className: 'dshp-lib-h' }, t('prompts.builtinDefault'), React.createElement('span', null, String(PROMPTS_BUILTINS.length))),
              builtinRows,
              React.createElement(
                'div',
                { className: 'dshp-lib-h' },
                t('prompts.myTemplates'),
                React.createElement('span', null, String(customs.length)),
                React.createElement('span', { className: 'dshp-spacer' }),
                React.createElement('button', { type: 'button', className: 'dshp-btn-sm', disabled: !writable || busy, onClick: openNewEditor }, t('prompts.new')),
              ),
              customRows.length > 0
                ? customRows
                : React.createElement('div', { className: 'dshp-hint', style: { padding: '8px 0' } }, t('prompts.noTemplates')),
              React.createElement('div', { className: 'dshp-lib-h' }, t('prompts.presetsHeading'), React.createElement('span', null, String(PROMPTS_PRESET_TEMPLATES.length))),
              presetRows,
            ),
          ),
          editorBlock,
          builtinViewEntry
            ? React.createElement(
                'div',
                { className: 'dshp-code' },
                React.createElement(
                  'div',
                  { className: 'dshp-code-head' },
                  React.createElement('b', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, builtinViewEntry.label || builtinLabelOf(builtinView)),
                  React.createElement('span', { className: 'dshp-tag' }, t('prompts.templateSource')),
                  viewText.length > 0 ? React.createElement('span', null, t('prompts.viewChars', { len: viewText.length })) : null,
                  React.createElement('span', { className: 'dshp-spacer' }),
                  React.createElement(
                    'button',
                    { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: viewText.length === 0, onClick: function () { doCopy(viewText) } },
                    copied ? t('common.copied') : t('common.copy'),
                  ),
                  React.createElement('button', { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', onClick: function () { setBuiltinView(null) } }, t('common.back')),
                ),
                React.createElement('pre', { className: 'dshp-preview' }, viewText.length > 0 ? viewText : t('common.unparsed')),
              )
            : null,
          statusLine,
        )
      }
    }
