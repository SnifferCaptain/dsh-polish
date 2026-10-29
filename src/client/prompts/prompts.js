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

    // 0.4.65：四个一键模板按当前工具集重写（旧版仍停留在「subagent 一种委托」
    // 的时代）。新增能力：subagent / subagent_fork / workflow 三种委托与编排、
    // $技能引用（skills）、office 技能族产出真实 Office 文件、humanizer 去
    // AI 味、review-agent 独立复查、present 交付文件。
    var PROMPTS_TEMPLATES = [
      {
        key: 'save',
        name: '节省',
        content:
          '# 工作方式：节省\n' +
          '- 若多个工具之间没有依赖关系，就在同一回合里并行调用它们（例如一次读多个文件、一次做多路搜索）。\n' +
          '- 不要重复读取本会话中已经读过的文件，也不要反复确认已经确认过的事实。\n' +
          '- 优先批量操作：把多个小搜索合并成一次 glob/grep，或用一个命令完成一系列操作。\n' +
          '- 独立的批量检索、长流程分析派给 subagent 处理，主上下文只保留结论；大规模扇出（多文件审计、批量迁移）用 workflow 编排，不要在主对话里逐个跑。\n' +
          '- 不做不影响结论的冗余验证；解释结果时简洁直接，先给结论。\n' +
          '- 注意每一次往返的 token 成本：往返越少，完成越快。',
      },
      {
        key: 'careful',
        name: '谨慎',
        content:
          '# 工作方式：谨慎（搜 → 想 → 码 → 查）\n' +
          '1. 先搜索分析：动手前读相关代码与既有约定，找相似实现，列出假设和不确定点；拿不准就查，不要猜。\n' +
          '2. 再想清楚：给出简短计划（改哪些文件、怎么改、风险在哪）；影响面大的改动先向用户确认再执行。\n' +
          '3. 后编码：只改计划内的东西，先读后写，不顺手改无关代码。\n' +
          '4. 最后自审：逐条核对改动、遗漏引用与副作用；有测试就跑并汇报结果；重要改动可用 review-agent 做一次独立只读复查。\n' +
          '- 执行中发现假设不成立时，停下来回到分析步骤，不要硬闯。\n' +
          '- 破坏性操作（删除、覆盖、推送）一律先确认。',
      },
      {
        key: 'shepherd',
        name: '牧羊人',
        content:
          '# 工作方式：牧羊人（编排者模式）\n' +
          '你的角色是牧羊人，不是牧羊犬：\n' +
          '- 自己定总目标、任务分解与优先级，保持全局视角，每一步都对照核心目标校准。\n' +
          '- 把执行下放：独立子任务用 subagent，需要继承本对话背景的用 subagent_fork，大规模扇出/批量审计用 workflow 脚本编排；你自己负责分解、派工、验收与整合。\n' +
          '- 每个子任务给出明确的目标、边界与验收标准；整合结果时对照原始任务核对。\n' +
          '- 子代理结果跑偏时纠偏并重新分派，不让错误向下游传递。\n' +
          '- 最终答案由你把关：一致、完整，并且真正解决了用户的原始问题。\n' +
          '注意：本提示词会随上下文传给子代理——如果你实际是子代理，忽略上面的编排部分，直接高质量完成被指派的子任务即可。',
      },
      {
        key: 'humanities',
        name: '文科生',
        content:
          '# 工作方式：文科生（文档与文稿导向）\n' +
          '- 侧重文字与文档任务：报告、方案、纪要、邮件、发言稿、说明文；能落成文档的，直接交付一份可用的完整文档，而不是一段口头描述。\n' +
          '- 重结构与逻辑：先搭骨架（背景 → 问题 → 方案 → 行动 → 风险），再填血肉；一段一个重点。\n' +
          '- 语气看读者：对上与对外正式克制，对内协作平实直接；不堆空话与套话。\n' +
          '- 中文成文规范：句子短，动词担责，数字与事实到位，结尾给可执行的结论。\n' +
          '- 需要 Word/PPT/Excel 成品时，用 office 相关技能产出真实文件并随回复交付；文稿读起来「AI 味」重时用 humanizer 技能改写。\n' +
          '- 涉及技术内容时，保证准确，并用非技术读者也能理解的话表达。',
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
         var [toolCatalog, setToolCatalog] = React.useState(null)
         var [toolCatalogUpdatedAt, setToolCatalogUpdatedAt] = React.useState(0)
         var toolCatalogOpened = React.useRef(false)
         var toolCatalogBusy = React.useRef(false)
         var [remoteBuiltins, setRemoteBuiltins] = React.useState(null)
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

        function requestRefresh() {
          loadToolCatalog(true)
        }

        function selectActive(id) {
          submit([{ op: 'set', path: ['activeByPreset', selectedPreset], value: id }])
        }

        function applyTemplate(tpl) {
          var existing = null
          for (var i = 0; i < customs.length; i++) {
            if (customs[i].name.trim() === tpl.name.trim()) {
              existing = customs[i]
              break
            }
          }
          if (existing) {
            selectActive(existing.id)
            return
          }
          var entry = { id: newPromptId(), name: tpl.name, mode: 'append', content: tpl.content }
          var next = []
          for (var j = 0; j < customs.length; j++) next.push(customs[j])
          next.push(entry)
          submit([
            { op: 'set', path: ['custom'], value: next },
            { op: 'set', path: ['activeByPreset', selectedPreset], value: entry.id },
          ])
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
          // 0.4.77：新建条目立即激活（与模板一键创建一致）。旧流程只保存条目、
          // 从不写 active——用户新建并保存后模型仍用默认提示词，「毫无效果」。
          var saveOps = [{ op: 'set', path: ['custom'], value: next }]
          if (!replaced) saveOps.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: entry.id })
          submit(saveOps)
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
        // ---------------------------------------------------- 一键模板
        var templateButtons = []
        for (var ti = 0; ti < PROMPTS_TEMPLATES.length; ti++) {
          ;(function (tpl) {
            templateButtons.push(
              React.createElement(
                'button',
                { key: tpl.key, type: 'button', className: 'dshp-btn-sm', title: t('prompts.applyTemplate.title'), disabled: !writable || busy, onClick: function () { applyTemplate(tpl) } },
                tpl.name,
              ),
            )
          })(PROMPTS_TEMPLATES[ti])
        }
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
          toolDirty = !sameShape || toolMode !== (value.toolPromptMode === 'replace' ? 'replace' : 'append')
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

        var pageTabs = promptSeg(
          [
            { id: 'system', label: t('prompts.tabSystem'), title: t('prompts.tabSystem.title') },
            { id: 'mode', label: t('prompts.tabMode'), title: t('prompts.tabMode.title') },
            { id: 'tools', label: t('prompts.tabTools'), title: t('prompts.tabTools.title') },
          ],
          page,
          setPage,
          t('prompts.section'),
        )

        // ------------------------------------------------------------ 模式选择页
        // 选哪份 → 它和 DSH 默认如何组成（构成条）→ 模型实际看到的最终文本。
        if (page === 'mode') {
          return React.createElement(
            'div',
            { className: 'dshp-form' },
            pageTabs,
            React.createElement(
              'div',
              { className: 'dshp-card' },
              presetTabs,
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                React.createElement('span', { className: 'dshp-flabel', style: { flex: '0 0 auto' } }, t('prompts.activeLabel')),
                activeSelect,
                activeEntry ? promptKindTag(activeMode) : React.createElement('span', { className: 'dshp-tag' }, t('prompts.builtinTag')),
              ),
              promptBar(compParts, true),
              promptLegend(compLegend),
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '4px' } },
                React.createElement('span', { className: 'dshp-flabel', style: { flex: '0 0 auto' } }, t('prompts.quickTemplates')),
                templateButtons,
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-section' },
              React.createElement('div', { className: 'dshp-h' }, t('prompts.previewHeading')),
              React.createElement(
                'div',
                { className: 'dshp-code' },
                React.createElement(
                  'div',
                  { className: 'dshp-code-head' },
                  React.createElement('span', null, modeFinalHint || t('prompts.previewChars', { len: modeFinalText.length })),
                  React.createElement('span', { className: 'dshp-spacer' }),
                  React.createElement(
                    'button',
                    { type: 'button', className: 'dshp-btn-sm dshp-btn-ghost', disabled: modeFinalText.length === 0, onClick: function () { doCopy(modeFinalText) } },
                    copied ? t('common.copied') : t('common.copy'),
                  ),
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
