    // ------------------------------------------------------ settings surfaces

    function readNamespace(ctx, ns, fallback) {
      var snapshot
      try {
        snapshot = ctx.configForms.get(ns).getSnapshot()
      } catch (error) {
        return { served: false, value: fallback, snapshot: null }
      }
      var value = fallback
      if (snapshot && snapshot.status === 'ready' && snapshot.value && typeof snapshot.value === 'object') {
        value = Object.assign({}, fallback, snapshot.value)
      }
      return { served: !!(snapshot && snapshot.status !== 'unavailable'), value: value, snapshot: snapshot }
    }

    function useDraft(form, coerce) {
      var snapshot = form && form.state ? form.state : null
      var revision = snapshot ? snapshot.revision : 0
      var remote = snapshot && snapshot.status === 'ready' && snapshot.value ? snapshot.value : {}
      var draftState = React.useState(remote)
      var draft = draftState[0]
      var setDraft = draftState[1]
      var statusState = React.useState('idle')
      var status = statusState[0]
      var setStatus = statusState[1]
      React.useEffect(
        function () {
          setDraft(remote)
          setStatus('idle')
        },
        [revision],
      )
      return {
        snapshot: snapshot,
        revision: revision,
        remote: remote,
        draft: draft,
        setDraft: setDraft,
        status: status,
        setStatus: setStatus,
        coerce: coerce,
      }
    }

    /**
     * Live-status strip: a row of "dot + label + value" items. The dot colour
     * carries the verdict (ok / warn / err / idle), so the strip reads at a
     * glance instead of as a sentence.
     */
    function statusStrip(items) {
      if (!items || items.length === 0) return null
      return React.createElement(
        'div',
        { className: 'dshp-status' },
        items.map(function (item, i) {
          return React.createElement(
            'span',
            { className: 'dshp-stat', key: i },
            React.createElement('i', { className: 'dshp-dot', 'data-tone': item.tone || 'idle', 'data-pulse': item.pulse ? '1' : undefined }),
            item.label,
            item.value === undefined || item.value === '' ? null : React.createElement('b', null, String(item.value)),
          )
        }),
      )
    }

    /** A tinted block with a coloured left rail: one title line, one sentence. */
    function callout(tone, title, text) {
      return React.createElement(
        'div',
        { className: 'dshp-callout', 'data-tone': tone },
        React.createElement('b', null, title),
        text ? React.createElement('span', null, text) : null,
      )
    }

    /** CSS gradient of a depth palette, for the colour-scale swatches. */
    function paletteGradient(paletteId) {
      var ramp = DEPTH_PALETTES[paletteId] === undefined ? DEPTH_PALETTES['blue-purple'] : DEPTH_PALETTES[paletteId]
      var stops = []
      for (var i = 0; i < ramp.length; i++) stops.push(hexOf(ramp[i]))
      return 'linear-gradient(90deg, ' + stops.join(', ') + ')'
    }

    function SettingsForm(props) {
      var form = props.form
      var fields = props.fields
      var coerce = props.coerce
      var model = useDraft(form, coerce)

      React.useEffect(function () {
        upsertStyle(FORM_STYLE_ID, FORM_CSS)
      }, [])

      if (form === undefined || form === null || model.snapshot === null) {
        return React.createElement('p', { className: 'dshp-note' }, '该组件当前没有可编辑的设置项。')
      }
      if (model.snapshot.status === 'unavailable') {
        return React.createElement('p', { className: 'dshp-note' }, '该组件当前未加载，暂时无法配置。')
      }
      if (model.snapshot.status !== 'ready') {
        return React.createElement('p', { className: 'dshp-note' }, '正在读取设置…')
      }

      var remote = model.remote
      var draft = model.draft
      function setValue(key, value) {
        model.setDraft(function (prev) {
          var next = {}
          for (var k in prev) next[k] = prev[k]
          next[key] = value
          return next
        })
      }

      var dirty = []
      var overridden = []
      for (var i = 0; i < fields.length; i++) {
        var field = fields[i]
        if (model.snapshot.user && model.snapshot.user[field.key] !== undefined) overridden.push(field)
        if (draft[field.key] !== remote[field.key]) dirty.push(field)
      }
      var writable = model.snapshot.writable !== false
      var busy = model.status === 'saving'

      function save() {
        if (!writable || busy || dirty.length === 0) return
        var ops = []
        for (var j = 0; j < dirty.length; j++) {
          var f = dirty[j]
          ops.push({ op: 'set', path: [f.key], value: coerce(f, draft[f.key]) })
        }
        model.setStatus('saving')
        Promise.resolve(form.mutate(ops, model.revision)).then(
          function (ok) {
            model.setStatus(ok ? 'saved' : 'failed')
          },
          function () {
            model.setStatus('failed')
          },
        )
      }

      function resetAll() {
        if (!writable || busy || overridden.length === 0) return
        var ops = []
        for (var j = 0; j < overridden.length; j++) ops.push({ op: 'unset', path: [overridden[j].key] })
        model.setStatus('saving')
        Promise.resolve(form.mutate(ops, model.revision)).then(
          function (ok) {
            model.setStatus(ok ? 'saved' : 'failed')
          },
          function () {
            model.setStatus('failed')
          },
        )
      }

      function renderControl(field) {
        if (field.kind === 'boolean') {
          var checked = draft[field.key] !== false
          return React.createElement(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': checked ? 'true' : 'false',
              'aria-label': field.label,
              className: 'dshp-switch',
              disabled: !writable,
              onClick: function () {
                setValue(field.key, !checked)
              },
            },
            React.createElement('span', { className: 'dshp-knob' }),
          )
        }
        if (field.kind === 'swatch') {
          var current = String(draft[field.key] === undefined ? field.fallback : draft[field.key])
          return React.createElement(
            'div',
            { className: 'dshp-swatches', role: 'radiogroup', 'aria-label': field.label },
            field.options.map(function (option) {
              var on = option.value === current
              return React.createElement(
                'button',
                {
                  key: option.value,
                  type: 'button',
                  role: 'radio',
                  'aria-checked': on ? 'true' : 'false',
                  className: 'dshp-swatch',
                  title: option.label,
                  disabled: !writable,
                  onClick: function () {
                    setValue(field.key, option.value)
                  },
                },
                React.createElement('i', { style: { background: paletteGradient(option.value) } }),
                option.short || option.label,
              )
            }),
          )
        }
        if (field.kind === 'select') {
          return React.createElement(
            'select',
            {
              className: 'dshp-select',
              value: String(draft[field.key] === undefined ? field.fallback : draft[field.key]),
              disabled: !writable,
              onChange: function (event) {
                setValue(field.key, event.target.value)
              },
            },
            field.options.map(function (option) {
              return React.createElement('option', { key: option.value, value: option.value }, option.label)
            }),
          )
        }
        return React.createElement('input', {
          type: 'number',
          className: 'dshp-number',
          min: field.min,
          max: field.max,
          step: field.step === undefined ? 1 : field.step,
          'aria-label': field.label,
          value: draft[field.key] === undefined || draft[field.key] === '' ? '' : String(draft[field.key]),
          disabled: !writable,
          onChange: function (event) {
            setValue(field.key, event.target.value === '' ? '' : Number(event.target.value))
          },
        })
      }

      // Rows sit in one list with hairline dividers; a field's optional
      // `group` opens a small heading so related switches read as a block.
      var rows = []
      var lastGroup = null
      for (var m = 0; m < fields.length; m++) {
        var f = fields[m]
        if (f.group && f.group !== lastGroup) {
          lastGroup = f.group
          rows.push(
            React.createElement(
              'div',
              { className: 'dshp-gh', key: 'g:' + f.group },
              f.group,
              f.groupHint ? React.createElement('span', null, f.groupHint) : null,
            ),
          )
        }
        var isOverridden = model.snapshot.user && model.snapshot.user[f.key] !== undefined
        rows.push(
          React.createElement(
            'div',
            { className: 'dshp-field', key: f.key },
            React.createElement(
              'div',
              { className: 'dshp-text' },
              React.createElement(
                'div',
                { className: 'dshp-label' },
                f.label,
                isOverridden ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'accent', title: '已偏离默认值' }, '已覆盖') : null,
              ),
              f.hint ? React.createElement('div', { className: 'dshp-hint' }, f.hint) : null,
            ),
            React.createElement('div', { className: 'dshp-control' }, renderControl(f)),
          ),
        )
      }

      // The save bar exists only when there is something to say or do: unsaved
      // edits, saved/failed feedback, or overridden values that can be reset.
      var message = null
      var tone = 'idle'
      if (!writable) message = '此部署的设置为只读。'
      else if (dirty.length > 0) {
        message = '有未保存的更改'
        tone = 'warn'
      } else if (model.status === 'saved') {
        message = '已保存，立即生效'
        tone = 'ok'
      } else if (model.status === 'failed') {
        message = '保存被拒绝，请重试'
        tone = 'err'
      } else if (overridden.length > 0) message = '已自定义 ' + overridden.length + ' 项'
      var bar = null
      if (message !== null || overridden.length > 0) {
        bar = React.createElement(
          'div',
          { className: 'dshp-savebar', key: '__footer' },
          React.createElement('i', { className: 'dshp-dot', 'data-tone': tone }),
          React.createElement('span', null, message),
          React.createElement('span', { className: 'dshp-spacer' }),
          overridden.length > 0
            ? React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-ghost', disabled: !writable || busy, onClick: resetAll },
                '恢复默认',
              )
            : null,
          dirty.length > 0
            ? React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy, onClick: save },
                busy ? '保存中…' : '保存',
              )
            : null,
        )
      }

      return React.createElement(
        'div',
        { className: 'dshp-form' },
        props.before || null,
        React.createElement('div', { className: 'dshp-list' }, rows),
        props.after || null,
        bar,
      )
    }

    function coerceRenderer(field, value) {
      if (field.kind === 'boolean') return value !== false
      return num(value, field.fallback, field.min, field.max)
    }

    function coerceDepth(field, value) {
      if (field.kind === 'select') return String(value)
      if (field.kind === 'boolean') return value !== false
      return num(value, field.fallback, field.min, field.max)
    }

    function coerceHistory(field, value) {
      if (field.kind === 'boolean') return value !== false
      if (field.kind === 'number') return num(value, field.fallback, field.min, field.max)
      return value
    }

    var RENDERER_FIELDS = [
      {
        key: 'lines',
        kind: 'number',
        group: '预览窗口',
        label: '预览行数',
        hint: '思考进行中最多显示几行，可上下滚动。',
        min: 1,
        max: 20,
        fallback: RENDERER_DEFAULTS.lines,
      },
      {
        key: 'autoOpen',
        kind: 'boolean',
        group: '预览窗口',
        label: '自动展开思考过程',
        hint: '思考时自动展开；你手动点过之后不再干预。',
        fallback: RENDERER_DEFAULTS.autoOpen,
      },
      {
        key: 'showTime',
        kind: 'boolean',
        group: '预览窗口',
        label: '显示思考时间',
        hint: '展开时在标题行右侧显示已用秒数。',
        fallback: RENDERER_DEFAULTS.showTime,
      },
      {
        key: 'followMs',
        kind: 'number',
        group: '动画',
        label: '跟随时长（毫秒）',
        hint: '预览滑到最新行所花的时间，0 = 即时。',
        min: 0,
        max: 2000,
        step: 50,
        fallback: RENDERER_DEFAULTS.followMs,
      },
      {
        key: 'collapseMs',
        kind: 'number',
        group: '动画',
        label: '收起动画（毫秒）',
        hint: '思考结束后折叠的过渡时长，0 = 立即。',
        min: 0,
        max: 2000,
        step: 10,
        fallback: RENDERER_DEFAULTS.collapseMs,
      },
    ]

    var DEPTH_FIELDS = [
      {
        key: 'showInComposer',
        kind: 'boolean',
        label: '把「推理等级」改成滑动条',
        hint: '模型面板里的档位列表换成滑条；关闭后恢复原样。',
        fallback: DEPTH_DEFAULTS.showInComposer,
      },
      {
        key: 'labels',
        kind: 'boolean',
        label: '显示档位名称',
        hint: '在滑条右侧保留当前档位名（如 High）。',
        fallback: DEPTH_DEFAULTS.labels,
      },
      {
        key: 'palette',
        kind: 'swatch',
        label: '色阶',
        hint: '按模型声明的档位数插值。',
        options: [
          { value: 'blue-purple', label: '浅蓝 → 深蓝 → 紫', short: '蓝紫' },
          { value: 'brand', label: '品牌蓝（浅 → 深）', short: '品牌蓝' },
          { value: 'mono', label: '单色灰阶', short: '灰阶' },
        ],
        fallback: DEPTH_DEFAULTS.palette,
      },
    ]

    var HISTORY_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用上箭头召回历史',
        hint: '输入框为空时按 ↑ 召回最近的用户消息；↑/↓ 翻历史，Esc 清空。',
        fallback: HISTORY_DEFAULTS.enabled,
      },
    ]

    function summaryFrom(form, read) {
      if (form === undefined || form === null || form.state === undefined) return '设置加载中…'
      if (form.state.status !== 'ready') return '设置加载中…'
      return read(form.state.value || {})
    }

    function RendererPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement(
          'span',
          null,
          summaryFrom(form, function (value) {
            return (
              '思考过程滚动预览：' +
              num(value.lines, RENDERER_DEFAULTS.lines, 1, 20) +
              ' 行，结束后自动收起' +
              (value.showTime === false ? ' · 不显示时间' : ' · 显示时间') +
              (num(value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000) === 0
                ? ' · 即时跟随'
                : ' · 跟随 ' + num(value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000) + 'ms')
            )
          }),
        )
      }
      return React.createElement(SettingsForm, { form: form, fields: RENDERER_FIELDS, coerce: coerceRenderer })
    }

    function DepthPage(props) {
      var form = props.form
      useStore(patcherStatsStore)
      if (props.view === 'summary') {
        return React.createElement(
          'span',
          null,
          summaryFrom(form, function (value) {
            var palettes = { 'blue-purple': '浅蓝 → 深蓝 → 紫', brand: '品牌蓝', mono: '灰阶' }
            var palette = palettes[value.palette] === undefined ? palettes[DEPTH_DEFAULTS.palette] : palettes[value.palette]
            var where = value.showInComposer === false ? '模型面板保持原样' : '推理等级 = 滑动条'
            var probe = describePatcher(value)
            return where + ' · ' + palette + (probe === '' ? '' : ' · ' + probe)
          }),
        )
      }
      var depthStats = patcherStatsStore.get()
      var depthItems
      if (depthStats.panels > 0) {
        depthItems = [
          { label: '面板', value: depthStats.panels, tone: 'ok' },
          { label: '滑条', value: depthStats.claimed, tone: depthStats.claimed > 0 ? 'ok' : 'warn' },
        ]
        if (depthStats.skip !== '' && SKIP_TEXT[depthStats.skip] !== undefined) depthItems.push({ label: '跳过', value: SKIP_TEXT[depthStats.skip], tone: 'warn' })
      } else {
        depthItems = [{ label: describePatcher(form && form.state ? form.state.value || {} : {}), tone: 'idle' }]
      }
      return React.createElement(SettingsForm, { form: form, fields: DEPTH_FIELDS, coerce: coerceDepth, after: statusStrip(depthItems) })
    }

    /**
     * The summary's health line: what the patcher currently sees. With no
     * panel open it reports the readiness of the chain instead, so "no
     * slider" points at its own cause the next time the row is opened.
     */
    function describePatcher(value) {
      var stats = patcherStatsStore.get()
      if (stats.panels > 0) {
        var skip = stats.skip === '' || SKIP_TEXT[stats.skip] === undefined ? '' : '（跳过：' + SKIP_TEXT[stats.skip] + '）'
        return '面板 ' + stats.panels + ' · 滑条 ' + stats.claimed + skip
      }
      if (value.showInComposer === false) return '未扫描：已关闭'
      if (sessionRegistry.map.size === 0) return '等待会话占位'
      return '等待面板打开'
    }

    function HistoryPage(props) {
      var form = props.form
      useStore(historyStatsStore)
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeHistory(value)
        }))
      }
      var hs = historyStatsStore.get()
      var items
      if (hs.sessions <= 0) items = [{ label: '等待会话占位', tone: 'idle' }]
      else {
        items = [{ label: '会话', value: hs.sessions, tone: 'ok' }]
        if (hs.lastError) items.push({ label: '错误', value: hs.lastError, tone: 'err' })
        else items.push(hs.lastCount > 0 ? { label: '已读', value: hs.lastCount + ' 条用户消息', tone: 'ok' } : { label: '等待 ↑', tone: 'idle' })
      }
      return React.createElement(SettingsForm, { form: form, fields: HISTORY_FIELDS, coerce: coerceHistory, after: statusStrip(items) })
    }

    /** The summary's health line: what the recall engine currently sees. */
    function describeHistory(value) {
      var stats = historyStatsStore.get()
      var on = value.enabled !== false ? '开启' : '关闭'
      var probe
      if (stats.sessions > 0) {
        if (stats.lastError) probe = '会话 ' + stats.sessions + ' · ' + stats.lastError
        else probe = stats.lastCount > 0 ? '会话 ' + stats.sessions + ' · 已读 ' + stats.lastCount + ' 条用户消息' : '会话 ' + stats.sessions + ' · 等待 ↑'
      } else {
        probe = '等待会话占位'
      }
      return '上箭头召回历史：' + on + ' · ' + probe
    }

    var LRU_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '按最近使用排序工作区',
        hint: '最近用过的分组置顶，分组本身保留。',
        fallback: LRU_DEFAULTS.enabled,
      },
      {
        key: 'subagent',
        kind: 'boolean',
        label: '按最近使用排序子智能体',
        hint: '打开列表时按最近活动重排；与上一项互相独立。',
        fallback: LRU_DEFAULTS.subagent,
      },
    ]

    // 两个布尔开关默认均为 true，缺失值一律向 true 收拢。
    function coerceLru(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    /** The LRU status line: how many groups it sees and the last reorder. */
    function describeLru(value) {
      var stats = lruStatsStore.get()
      var on = value.enabled !== false ? '开启' : '关闭'
      var subOn = value.subagent === true ? '开启' : '关闭'
      var probe
      if (stats.error) {
        probe = stats.error
      } else if (stats.workspaces > 0) {
        probe = '工作区 ' + stats.workspaces + (stats.lastMove ? ' · 最近重排 ' + stats.lastMove : ' · 待命')
      } else {
        probe = '等待工作区列表'
      }
      return '工作区 LRU 排序：' + on + ' · ' + probe + ' ｜ 子智能体 LRU：' + subOn + (stats.subagents > 0 ? '（最近一次打开时重排 ' + stats.subagents + ' 个目录）' : '')
    }

    function LruPage(props) {
      var form = props.form
      useStore(lruStatsStore)
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeLru(value)
        }))
      }
      var ls = lruStatsStore.get()
      var items
      if (ls.error) items = [{ label: '错误', value: ls.error, tone: 'err' }]
      else if (ls.workspaces > 0) {
        items = [
          { label: '工作区', value: ls.workspaces, tone: 'ok' },
          { label: '最近重排', value: ls.lastMove || '待命', tone: ls.lastMove ? 'ok' : 'idle' },
        ]
        if (ls.subagents > 0) items.push({ label: '子智能体', value: '重排 ' + ls.subagents + ' 个目录', tone: 'ok' })
      } else items = [{ label: '等待工作区列表', tone: 'idle' }]
      return React.createElement(SettingsForm, { form: form, fields: LRU_FIELDS, coerce: coerceLru, after: statusStrip(items) })
    }

    var SHELL_LOCAL_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用 opencode 模式（shell 绕过 OS 沙箱）',
        hint: 'pwsh 命令（含 python / node / git）不再经 OS 沙箱，以 harness 进程权限直接运行；write / edit 的围界不变。关闭即时恢复，无需重启。',
        fallback: SHELL_LOCAL_DEFAULTS.enabled,
      },
    ]

    function coerceShellLocal(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    /** The shell-local status line: whether the unconfined shell is in effect. */
    function describeShellLocal(value) {
      var on = value.enabled !== false ? '开启' : '关闭'
      return 'opencode 模式（非约束 shell）：' + on + (value.enabled !== false ? ' · shell 命令绕过 OS 沙箱，文件工具围界不变' : ' · 系统沙箱照常')
    }

    function ShellLocalPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeShellLocal(value)
        }))
      }
      var shellOn = !(form && form.state && form.state.value) || form.state.value.enabled !== false
      return React.createElement(SettingsForm, {
        form: form,
        fields: SHELL_LOCAL_FIELDS,
        coerce: coerceShellLocal,
        after: statusStrip([
          shellOn
            ? { label: 'shell', value: '绕过 OS 沙箱', tone: 'warn' }
            : { label: 'shell', value: '系统沙箱', tone: 'ok' },
          { label: '文件工具围界', value: '不变', tone: 'ok' },
        ]),
      })
    }

    var VISUALIZE_FIELDS = [
      {
        key: 'svg',
        kind: 'boolean',
        label: '渲染 SVG 代码块',
        hint: '严格消毒后以静态图片展示，不执行脚本；块头可在 代码 / 图示 间切换。',
        fallback: VISUALIZE_DEFAULTS.svg,
      },
      {
        key: 'mermaid',
        kind: 'boolean',
        label: '渲染 Mermaid 代码块',
        hint: '首次出现时才懒加载内置 mermaid 11.17.0（无 CDN），strict 安全模式。',
        fallback: VISUALIZE_DEFAULTS.mermaid,
      },
    ]

    // 两个布尔开关默认均为 true，缺失值一律向 true 收拢。
    function coerceVisualize(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    /** The visualize status line: both switches + render counters + mermaid runtime state. */
    function describeVisualize(value) {
      var stats = visualizeStatsStore.get()
      var svgOn = value.svg !== false ? '开启' : '关闭'
      var mmdOn = value.mermaid !== false ? '开启' : '关闭'
      var runtime =
        stats.mermaidState === 'ready' ? '运行时就绪'
        : stats.mermaidState === 'loading' ? '运行时加载中'
        : stats.mermaidState === 'failed' ? '运行时加载失败'
        : '运行时未加载'
      var rendered = stats.svg + stats.mermaid
      var probe = '已渲染 ' + rendered + ' 张（svg ' + stats.svg + ' / mermaid ' + stats.mermaid
      if (stats.errors > 0) probe += '，失败 ' + stats.errors
      probe += '）'
      return 'SVG 围栏：' + svgOn + ' ｜ Mermaid 围栏：' + mmdOn + ' · ' + runtime + ' · ' + probe
    }

    function VisualizePage(props) {
      var form = props.form
      useStore(visualizeStatsStore)
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeVisualize(value)
        }))
      }
      var vs = visualizeStatsStore.get()
      var runtimeText = { ready: '就绪', loading: '加载中', failed: '加载失败' }[vs.mermaidState] || '未加载'
      var runtimeTone = { ready: 'ok', loading: 'warn', failed: 'err' }[vs.mermaidState] || 'idle'
      var visItems = [
        { label: 'Mermaid 运行时', value: runtimeText, tone: runtimeTone, pulse: vs.mermaidState === 'loading' },
        { label: '已渲染', value: 'svg ' + vs.svg + ' · mermaid ' + vs.mermaid, tone: vs.svg + vs.mermaid > 0 ? 'ok' : 'idle' },
      ]
      if (vs.errors > 0) visItems.push({ label: '失败', value: vs.errors, tone: 'err' })
      return React.createElement(SettingsForm, { form: form, fields: VISUALIZE_FIELDS, coerce: coerceVisualize, after: statusStrip(visItems) })
    }

    /**
     * 0.4.49：官方替代说明（DSH 已内建「自动化任务」dsh-schedule，完整覆盖
     * 本组件功能且更强），在 timer 设置页顶部展示；本行默认 disabled: true。
     */
    var TIMER_OFFICIAL_NOTE =
      'dsh-schedule 支持一次性 / 每 N 秒 / 每天 / 每周 / cron，跨重启持久，并能投递回原会话。' +
      '本计时器组件（内存倒计时，重启即清）已被它完整覆盖，故默认停用；需要旧行为时，同时打开行开关与下方开关。'

    var TIMER_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用计时器（模型工具）',
        hint: '开启后模型可用 timer_set / timer_cancel 定时提醒；总开关以本行的行开关为准。',
        fallback: TIMER_DEFAULTS.enabled,
      },
    ]

    function coerceTimer(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    function describeTimer(value) {
      var on = value.enabled !== false ? '开启' : '关闭'
      return '计时器（模型工具）：' + on + ' · 模型可 timer_set/timer_cancel 定时提醒'
    }

    function TimerPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeTimer(value)
        }))
      }
      return React.createElement(SettingsForm, {
        form: form,
        fields: TIMER_FIELDS,
        coerce: coerceTimer,
        before: callout('accent', '官方已内建「自动化任务」', TIMER_OFFICIAL_NOTE),
      })
    }

    var NOTIFY_FIELDS = [
      {
        key: 'completeSound',
        kind: 'boolean',
        group: '任务完成',
        groupHint: '一轮处理结束时',
        label: '提示音',
        hint: '播放一段提示音。',
        fallback: NOTIFY_DEFAULTS.completeSound,
      },
      {
        key: 'completeNotify',
        kind: 'boolean',
        group: '任务完成',
        label: '系统通知',
        hint: '弹出 OS 级通知，需先授权（见下方测试）。',
        fallback: NOTIFY_DEFAULTS.completeNotify,
      },
      {
        key: 'attentionSound',
        kind: 'boolean',
        group: '需要处理',
        groupHint: '审批、计划确认、提问时',
        label: '提示音',
        hint: '模型在等你时播放提示音。',
        fallback: NOTIFY_DEFAULTS.attentionSound,
      },
      {
        key: 'attentionNotify',
        kind: 'boolean',
        group: '需要处理',
        label: '系统通知',
        hint: '模型在等你时弹出 OS 级通知。',
        fallback: NOTIFY_DEFAULTS.attentionNotify,
      },
    ]

    function coerceNotify(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    function describeNotify(value) {
      var stats = notifyStatsStore.get()
      var cs = value.completeSound === true ? '声' : '—'
      var cn = value.completeNotify === true ? '通知' : '—'
      var as = value.attentionSound === true ? '声' : '—'
      var an = value.attentionNotify === true ? '通知' : '—'
      var permText =
        stats.permission === 'granted'
          ? '已授权'
          : stats.permission === 'denied'
            ? '被拒绝'
            : stats.permission === 'unsupported'
              ? '不支持'
              : '未询问'
      var probe = '会话 ' + (stats.sessions || 0)
      if (stats.lastComplete) probe += ' · 最近完成 ' + stats.lastComplete
      if (stats.lastAttention) probe += ' · 最近待处理 ' + stats.lastAttention + '（' + attentionLabel(stats.lastAttentionKind) + '）'
      if (stats.lastTest) probe += ' · 最近测试 ' + stats.lastTest
      if (stats.error) probe += ' · ' + stats.error
      return '完成[声:' + cs + '/通知:' + cn + '] 待处理[声:' + as + '/通知:' + an + '] · 通知权限 ' + permText + ' · ' + probe
    }

    function NotifyPage(props) {
      var form = props.form
      useStore(notifyStatsStore)
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeNotify(value)
        }))
      }
      var stats = notifyStatsStore.get()
      var perm = stats.permission
      var permItem =
        perm === 'granted'
          ? { label: '系统通知权限', value: '已授权', tone: 'ok' }
          : perm === 'denied'
            ? { label: '系统通知权限', value: '被拒绝', tone: 'err' }
            : perm === 'unsupported'
              ? { label: '系统通知权限', value: '不支持', tone: 'idle' }
              : { label: '系统通知权限', value: '未询问', tone: 'idle' }
      var items = [permItem]
      if (stats.lastComplete) items.push({ label: '最近完成', value: stats.lastComplete, tone: 'ok' })
      if (stats.lastAttention) items.push({ label: '最近待处理', value: stats.lastAttention + '（' + attentionLabel(stats.lastAttentionKind) + '）', tone: 'warn' })
      if (stats.lastTest) items.push({ label: '最近测试', value: stats.lastTest, tone: 'idle' })
      if (stats.error) items.push({ label: '错误', value: stats.error, tone: 'err' })
      var permHint =
        perm === 'denied'
          ? '权限被拒绝：请到浏览器 / 系统设置里允许本站通知。'
          : perm === 'granted'
            ? '已授权，开启「系统通知」开关即可弹出。'
            : '提示音无需权限；系统通知需先点「测试」授权一次。'
      return React.createElement(SettingsForm, {
        form: form,
        fields: NOTIFY_FIELDS,
        coerce: coerceNotify,
        after: React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'div',
            { className: 'dshp-footer' },
            React.createElement('button', { type: 'button', className: 'dshp-btn', onClick: testNotify }, '测试提示音 + 通知'),
            React.createElement('span', { className: 'dshp-note' }, permHint),
          ),
          statusStrip(items),
        ),
      })
    }
