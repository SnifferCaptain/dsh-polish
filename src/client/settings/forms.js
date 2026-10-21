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
              className: 'dshp-switch',
              disabled: !writable,
              onClick: function () {
                setValue(field.key, !checked)
              },
            },
            React.createElement('span', { className: 'dshp-knob' }),
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
          value: draft[field.key] === undefined || draft[field.key] === '' ? '' : String(draft[field.key]),
          disabled: !writable,
          onChange: function (event) {
            setValue(field.key, event.target.value === '' ? '' : Number(event.target.value))
          },
        })
      }

      var rows = []
      for (var m = 0; m < fields.length; m++) {
        var f = fields[m]
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
                isOverridden ? React.createElement('span', { className: 'dshp-tag' }, '已覆盖') : null,
              ),
              f.hint ? React.createElement('div', { className: 'dshp-hint' }, f.hint) : null,
            ),
            React.createElement('div', { className: 'dshp-control' }, renderControl(f)),
          ),
        )
      }

      var note = null
      if (!writable) note = '此部署的设置为只读。'
      else if (model.status === 'saved') note = '已保存，立即生效。'
      else if (model.status === 'failed') note = '保存被拒绝，请重试。'

      rows.push(
        React.createElement(
          'div',
          { className: 'dshp-footer', key: '__footer' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dshp-btn dshp-btn-primary',
              disabled: !writable || busy || dirty.length === 0,
              onClick: save,
            },
            busy ? '保存中…' : '保存',
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'dshp-btn', disabled: !writable || busy || overridden.length === 0, onClick: resetAll },
            '恢复默认',
          ),
          note === null ? null : React.createElement('span', { className: 'dshp-note' }, note),
        ),
      )

      return React.createElement('div', { className: 'dshp-form' }, rows)
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
        label: '预览行数',
        hint: '思考进行中时正文最多显示几行，可上下滚动查看更早的内容。',
        min: 1,
        max: 20,
        fallback: RENDERER_DEFAULTS.lines,
      },
      {
        key: 'followMs',
        kind: 'number',
        label: '跟随时长（毫秒）',
        hint: '换行/新增内容时，预览窗口滑到最新行所花的时间：0 = 即时跳底（旧行为），数值越大越柔（拖尾越长）。动画由实时时钟驱动，与流式帧率无关。',
        min: 0,
        max: 2000,
        step: 50,
        fallback: RENDERER_DEFAULTS.followMs,
      },
      {
        key: 'collapseMs',
        kind: 'number',
        label: '收起动画（毫秒）',
        hint: '思考结束后自动折叠的过渡时长，0 表示立即收起。',
        min: 0,
        max: 2000,
        step: 10,
        fallback: RENDERER_DEFAULTS.collapseMs,
      },
      {
        key: 'autoOpen',
        kind: 'boolean',
        label: '自动展开思考过程',
        hint: '思考进行中自动展开该行；你手动点过之后，本组件不再干预这一行。',
        fallback: RENDERER_DEFAULTS.autoOpen,
      },
      {
        key: 'showTime',
        kind: 'boolean',
        label: '显示思考时间',
        hint: '思考进行中、预览展开时在「思考过程」标题行右侧显示已用秒数（等宽数字，增长不跳动）；折叠后不显示。',
        fallback: RENDERER_DEFAULTS.showTime,
      },
    ]

    var DEPTH_FIELDS = [
      {
        key: 'showInComposer',
        kind: 'boolean',
        label: '把「推理等级」改成滑动条',
        hint: '打开模型面板时，把面板里那一行「推理等级」从档位列表改成滑条。关掉后该行恢复原样。',
        fallback: DEPTH_DEFAULTS.showInComposer,
      },
      {
        key: 'palette',
        kind: 'select',
        label: '色阶',
        hint: '滑条配色，按模型声明的档位数插值。',
        options: [
          { value: 'blue-purple', label: '浅蓝 → 深蓝 → 紫' },
          { value: 'brand', label: '品牌蓝（浅 → 深）' },
          { value: 'mono', label: '单色灰阶' },
        ],
        fallback: DEPTH_DEFAULTS.palette,
      },
      {
        key: 'labels',
        kind: 'boolean',
        label: '显示档位名称',
        hint: '在该行右侧保留当前档位名（如“High”）。',
        fallback: DEPTH_DEFAULTS.labels,
      },
    ]

    var HISTORY_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用上箭头召回历史',
        hint: '输入框为空时按 ↑ 把本会话最近一条用户消息填进来；召回态里 ↑/↓ 翻历史，一旦改动即退出（变普通草稿），Esc 清空，Enter 照旧发送。',
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
      return React.createElement(SettingsForm, { form: form, fields: DEPTH_FIELDS, coerce: coerceDepth })
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
      // The full settings page also shows the live status line (the recall
      // engine's health), so the user can see at a glance whether the anchor
      // mounted and whether the last ↑ found history.
      return React.createElement(
        'div',
        null,
        React.createElement(SettingsForm, { form: form, fields: HISTORY_FIELDS, coerce: coerceHistory }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeHistory(form.state.value || {}) : '状态加载中…',
        ),
      )
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
        hint: '把「按项目分组」列表按每个工作区所含会话的最近更新时间重排——最近用的分组置顶，同时保留分组。关闭后不再自动重排（保持当前顺序）。',
        fallback: LRU_DEFAULTS.enabled,
      },
      {
        key: 'subagent',
        kind: 'boolean',
        label: '按最近使用排序子智能体列表',
        hint: '把会话头部的子智能体目录按各子会话最近活动时间重排——最近用的子智能体置顶。只在打开列表的那一刻排序，关闭期间不做任何后台处理。独立开关：上面的工作区重排关闭时它仍可单独开启；关闭后保持 DSH 默认的创建时间顺序。',
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
      return React.createElement(
        'div',
        null,
        React.createElement(SettingsForm, { form: form, fields: LRU_FIELDS, coerce: coerceLru }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeLru(form.state.value || {}) : '状态加载中…',
        ),
      )
    }

    var SHELL_LOCAL_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用 opencode 模式（shell 绕过 OS 沙箱）',
        hint: '开启后 pwsh 命令（含其派生的 python/node/git）不再经 OS 级沙箱包装，以 harness 进程的文件权限直接运行；文件工具层（write/edit）的 workspace 围界不受影响。关闭后即时恢复系统沙箱，无需重启。总开关是本行的行开关（默认关）。',
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
      return React.createElement(
        'div',
        null,
        React.createElement(SettingsForm, { form: form, fields: SHELL_LOCAL_FIELDS, coerce: coerceShellLocal }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeShellLocal(form.state.value || {}) : '状态加载中…',
        ),
      )
    }

    var VISUALIZE_FIELDS = [
      {
        key: 'svg',
        kind: 'boolean',
        label: '渲染 SVG 代码块',
        hint: '聊天里以 <svg 开头的 ```svg 围栏：严格消毒后以 <img> 静态光栅化展示（不执行任何脚本），块头有 代码/图示 切换。关闭后这些块保持普通代码块。',
        fallback: VISUALIZE_DEFAULTS.svg,
      },
      {
        key: 'mermaid',
        kind: 'boolean',
        label: '渲染 Mermaid 代码块',
        hint: '聊天里的 ```mermaid 围栏（flowchart/sequenceDiagram/…）：首次见到才懒加载内置 mermaid 11.17.0（无 CDN），串行队列空闲期渲染，strict 安全模式。关闭后这些块保持普通代码块。',
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
      return React.createElement(
        'div',
        null,
        React.createElement(SettingsForm, { form: form, fields: VISUALIZE_FIELDS, coerce: coerceVisualize }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeVisualize(form.state.value || {}) : '状态加载中…',
        ),
      )
    }

    /**
     * 0.4.49：官方替代说明（DSH 已内建「自动化任务」dsh-schedule，完整覆盖
     * 本组件功能且更强），在 timer 设置页顶部展示；本行默认 disabled: true。
     */
    var TIMER_OFFICIAL_NOTE =
      'DSH 现已内建官方「自动化任务」（dsh-schedule）：schedule_create / schedule_list / ' +
      'schedule_update / schedule_delete 工具 + 侧栏「自动化任务」页面（搜索 / 筛选 / 编辑 / ' +
      '任务运行记录 / 删除 / 打开原会话），支持一次性 / 每 N 秒 / 每天 / 每周 / cron，跨重启持久、' +
      '补发最近一次错过，投递回原会话，任务所在会话行首也有时钟标记。' +
      '本计时器组件（内存倒计时、重启即清）的功能已被其完整覆盖，故默认停用。' +
      '如需恢复旧行为：打开「dsh-polish:timer」行开关，并启用下方「启用计时器」。'

    var TIMER_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: '启用计时器（模型工具）',
        hint: '本组件默认停用（官方「自动化任务」已覆盖，见上方说明）。开启后模型可用 timer_set / timer_cancel 定时提醒：N 分钟后把消息注入本会话、触发一轮处理。总开关以本行行开关为准。',
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
      return React.createElement(
        'div',
        null,
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginBottom: '10px' } },
          TIMER_OFFICIAL_NOTE,
        ),
        React.createElement(SettingsForm, { form: form, fields: TIMER_FIELDS, coerce: coerceTimer }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeTimer(form.state.value || {}) : '状态加载中…',
        ),
      )
    }

    var NOTIFY_FIELDS = [
      {
        key: 'completeSound',
        kind: 'boolean',
        label: '任务完成 · 提示音',
        hint: '当前会话一轮处理完成（turn 以 completed 结束）时播放一段提示音。',
        fallback: NOTIFY_DEFAULTS.completeSound,
      },
      {
        key: 'completeNotify',
        kind: 'boolean',
        label: '任务完成 · 系统通知',
        hint: '任务完成时弹一条系统通知（OS 级，非界面浮层）。需先在下方点『测试』授权系统通知权限。',
        fallback: NOTIFY_DEFAULTS.completeNotify,
      },
      {
        key: 'attentionSound',
        kind: 'boolean',
        label: '需要处理 · 提示音',
        hint: '模型在等你时（审批 / 计划确认 / 提问）播放提示音。',
        fallback: NOTIFY_DEFAULTS.attentionSound,
      },
      {
        key: 'attentionNotify',
        kind: 'boolean',
        label: '需要处理 · 系统通知',
        hint: '模型在等你时（审批 / 计划确认 / 提问）弹一条系统通知。',
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
      var permHint =
        stats.permission === 'denied'
          ? '系统通知权限被拒绝：请到浏览器/系统设置里允许本站通知，『通知』类开关才会真正弹出。'
          : stats.permission === 'granted'
            ? '系统通知已授权，开启『通知』类开关后即可弹出。'
            : '提示音无需权限；系统通知需先点下方『测试』授权一次。'
      return React.createElement(
        'div',
        null,
        React.createElement(SettingsForm, { form: form, fields: NOTIFY_FIELDS, coerce: coerceNotify }),
        React.createElement(
          'div',
          { className: 'dshp-note', style: { marginTop: '10px' } },
          form && form.state ? describeNotify(form.state.value || {}) : '状态加载中…',
        ),
        React.createElement(
          'div',
          { className: 'dshp-footer', style: { marginTop: '8px' } },
          React.createElement('button', { type: 'button', className: 'dshp-btn', onClick: testNotify }, '测试提示音 + 通知'),
          React.createElement('span', { className: 'dshp-note' }, permHint),
        ),
      )
    }

