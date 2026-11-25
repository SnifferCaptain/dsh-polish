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

    /**
     * The live snapshot of a row's config form.
     *
     * `form.state` is the shape the Plugins page passes in; `form.getSnapshot()`
     * is the same information on the service side. A page that only read
     * `form.state` rendered its "no settings" note forever whenever that field
     * had not been published yet — the empty plugin page the user reported
     * (1.4.22) — so both are accepted, and the form is subscribed to so a late
     * snapshot repaints the page.
     */
    function useFormSnapshot(form) {
      var tick = React.useState(0)
      var bump = tick[1]
      var snapshot = formSnapshotOf(form)
      React.useEffect(
        function () {
          if (!form || typeof form.subscribe !== 'function') return undefined
          var off = form.subscribe(function () {
            bump(function (n) {
              return n + 1
            })
          })
          return typeof off === 'function' ? off : undefined
        },
        [form],
      )
      return snapshot
    }

    function useDraft(form, coerce) {
      var snapshot = useFormSnapshot(form)
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
        return React.createElement('p', { className: 'dshp-note' }, t('form.noSettings'))
      }
      if (model.snapshot.status === 'unavailable') {
        return React.createElement('p', { className: 'dshp-note' }, t('form.unavailable'))
      }
      if (model.snapshot.status !== 'ready') {
        return React.createElement('p', { className: 'dshp-note' }, t('form.loading'))
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
        if (field.kind === 'list') {
          var items = Array.isArray(draft[field.key]) ? draft[field.key] : []
          var listRows = items.map(function (item, idx) {
            return React.createElement(
              'div',
              { className: 'dshp-listrow', key: 'r' + idx },
              React.createElement('input', {
                type: 'text',
                className: 'dshp-text-input',
                value: item,
                placeholder: field.placeholder || '',
                'aria-label': field.label,
                disabled: !writable,
                onChange: function (event) {
                  var next = items.slice()
                  next[idx] = event.target.value
                  setValue(field.key, next)
                },
              }),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshp-btn dshp-btn-ghost',
                  disabled: !writable,
                  onClick: function () {
                    var next = items.slice()
                    next.splice(idx, 1)
                    setValue(field.key, next)
                  },
                },
                t('skills.list.remove'),
              ),
            )
          })
          listRows.push(
            React.createElement(
              'button',
              {
                key: 'add',
                type: 'button',
                className: 'dshp-btn',
                disabled: !writable,
                onClick: function () {
                  setValue(field.key, items.concat(['']))
                },
              },
              t('skills.list.add'),
            ),
          )
          return React.createElement('div', { className: 'dshp-list' }, listRows)
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
                isOverridden ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'accent', title: t('form.overrideHint') }, t('form.overridden')) : null,
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
      if (!writable) message = t('form.readonly')
      else if (dirty.length > 0) {
        message = t('form.dirty')
        tone = 'warn'
      } else if (model.status === 'saved') {
        message = t('form.savedLive')
        tone = 'ok'
      } else if (model.status === 'failed') {
        message = t('form.saveRejected')
        tone = 'err'
      } else if (overridden.length > 0) message = t('form.customizedCount', { n: overridden.length })
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
                t('form.resetToDefault'),
              )
            : null,
          dirty.length > 0
            ? React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy, onClick: save },
                busy ? t('common.saving') : t('common.save'),
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
        group: t('renderer.group.preview'),
        label: t('renderer.lines.label'),
        hint: t('renderer.lines.hint'),
        min: 1,
        max: 20,
        fallback: RENDERER_DEFAULTS.lines,
      },
      {
        key: 'autoOpen',
        kind: 'boolean',
        group: t('renderer.group.preview'),
        label: t('renderer.autoOpen.label'),
        hint: t('renderer.autoOpen.hint'),
        fallback: RENDERER_DEFAULTS.autoOpen,
      },
      {
        key: 'showTime',
        kind: 'boolean',
        group: t('renderer.group.preview'),
        label: t('renderer.showTime.label'),
        hint: t('renderer.showTime.hint'),
        fallback: RENDERER_DEFAULTS.showTime,
      },
      {
        key: 'followMs',
        kind: 'number',
        group: t('renderer.group.animation'),
        label: t('renderer.followMs.label'),
        hint: t('renderer.followMs.hint'),
        min: 0,
        max: 2000,
        step: 50,
        fallback: RENDERER_DEFAULTS.followMs,
      },
      {
        key: 'collapseMs',
        kind: 'number',
        group: t('renderer.group.animation'),
        label: t('renderer.collapseMs.label'),
        hint: t('renderer.collapseMs.hint'),
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
        label: t('depth.showInComposer.label'),
        hint: t('depth.showInComposer.hint'),
        fallback: DEPTH_DEFAULTS.showInComposer,
      },
      {
        key: 'labels',
        kind: 'boolean',
        label: t('depth.labels.label'),
        hint: t('depth.labels.hint'),
        fallback: DEPTH_DEFAULTS.labels,
      },
      {
        key: 'palette',
        kind: 'swatch',
        label: t('depth.palette.label'),
        hint: t('depth.palette.hint'),
        options: [
          { value: 'blue-purple', label: t('depth.palette.blue-purple'), short: t('depth.palette.blue-purple.short') },
          { value: 'brand', label: t('depth.palette.brand'), short: t('depth.palette.brand.short') },
          { value: 'mono', label: t('depth.palette.mono'), short: t('depth.palette.mono.short') },
        ],
        fallback: DEPTH_DEFAULTS.palette,
      },
    ]

    var HISTORY_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: t('history.enabled.label'),
        hint: t('history.enabled.hint'),
        fallback: HISTORY_DEFAULTS.enabled,
      },
    ]

    /**
     * 行摘要的唯一语法：**状态在前、数字在后，只用「 · 」分隔**。
     * 行标题已经写了功能名，摘要不再重复它；关闭态不描述行为。
     */
    function summaryLine(parts) {
      var out = []
      for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i])
      return out.join(' · ')
    }

    function onOff(flag) {
      return flag ? t('common.on') : t('common.off')
    }

    function summaryFrom(form, read) {
      var snapshot = formSnapshotOf(form)
      if (snapshot === null || snapshot.status !== 'ready') return t('form.loading')
      return read(snapshot.value || {})
    }

    /** `form.state` when published, else the service snapshot, else null. */
    function formSnapshotOf(form) {
      if (form === undefined || form === null) return null
      if (form.state) return form.state
      if (typeof form.getSnapshot === 'function') {
        try {
          return form.getSnapshot()
        } catch (error) {
          return null
        }
      }
      return null
    }

    function RendererPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement(
          'span',
          null,
          summaryFrom(form, function (value) {
            var follow = num(value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000)
            return summaryLine([
              t('renderer.summary.lines', num(value.lines, RENDERER_DEFAULTS.lines, 1, 20)),
              t('renderer.summary.collapseAfter'),
              value.showTime === false ? '' : t('renderer.summary.showTime'),
              follow === 0 ? t('renderer.summary.followInstant') : t('renderer.summary.followMs', { n: follow }),
            ])
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
            var palettes = { 'blue-purple': t('depth.palette.blue-purple.short'), brand: t('depth.palette.brand.short'), mono: t('depth.palette.mono.short') }
            var palette = palettes[value.palette] === undefined ? palettes[DEPTH_DEFAULTS.palette] : palettes[value.palette]
            var off = value.showInComposer === false
            return summaryLine([
              off ? t('depth.summary.original') : t('depth.summary.slider'),
              off ? '' : palette,
              off || value.labels === false ? '' : t('depth.summary.showLevelName'),
              describePatcher(value),
            ])
          }),
        )
      }
      var depthStats = patcherStatsStore.get()
      var depthItems
      if (depthStats.panels > 0) {
        depthItems = [
          { label: t('depth.strip.panels'), value: depthStats.panels, tone: 'ok' },
          { label: t('depth.strip.sliders'), value: depthStats.claimed, tone: depthStats.claimed > 0 ? 'ok' : 'warn' },
        ]
        if (depthStats.skip !== '' && SKIP_TEXT[depthStats.skip] !== undefined) depthItems.push({ label: t('depth.strip.skip'), value: SKIP_TEXT[depthStats.skip], tone: 'warn' })
      } else {
        depthItems = [{ label: describePatcher((formSnapshotOf(form) || {}).value || {}), tone: 'idle' }]
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
        var skip = stats.skip === '' || SKIP_TEXT[stats.skip] === undefined ? '' : t('depth.patcher.skipSuffix', { reason: SKIP_TEXT[stats.skip] })
        return t('depth.patcher.panels', { panels: stats.panels, sliders: stats.claimed }) + skip
      }
      if (value.showInComposer === false) return t('depth.patcher.off')
      if (sessionRegistry.map.size === 0) return t('depth.patcher.waitingSession')
      return t('depth.patcher.waitingPanel')
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
      if (hs.sessions <= 0) items = [{ label: t('depth.patcher.waitingSession'), tone: 'idle' }]
      else {
        items = [{ label: t('history.strip.sessions'), value: hs.sessions, tone: 'ok' }]
        if (hs.lastError) items.push({ label: t('common.error'), value: hs.lastError, tone: 'err' })
        else items.push(hs.lastCount > 0 ? { label: t('history.strip.read'), value: t('history.strip.userMessages', { n: hs.lastCount }), tone: 'ok' } : { label: t('history.strip.waitingUp'), tone: 'idle' })
      }
      return React.createElement(SettingsForm, { form: form, fields: HISTORY_FIELDS, coerce: coerceHistory, after: statusStrip(items) })
    }

    /** The summary's health line: what the recall engine currently sees. */
    function describeHistory(value) {
      var stats = historyStatsStore.get()
      var on = value.enabled !== false ? t('common.on') : t('common.off')
      var probe
      if (stats.sessions > 0) {
        if (stats.lastError) probe = t('history.strip.sessionsCount', { n: stats.sessions }) + ' · ' + stats.lastError
        else probe = stats.lastCount > 0 ? t('history.strip.sessionsCount', { n: stats.sessions }) + ' · ' + t('history.strip.read') + ' ' + t('history.strip.userMessages', { n: stats.lastCount }) : t('history.strip.sessionsCount', { n: stats.sessions }) + ' · ' + t('history.strip.waitingUp')
      } else {
        probe = t('depth.patcher.waitingSession')
      }
      return summaryLine([on, probe])
    }

    // ---- 技能目录（skill-loader）：自定义 skill 文件夹列表。
    var SKILL_FIELDS = [
      { key: 'customRoots', kind: 'list', label: t('skills.roots.label'), hint: t('skills.roots.hint'), placeholder: t('skills.roots.placeholder'), fallback: [] },
    ]

    /** 列表去掉首尾空白、空项与重复项；其他字段原样返回。 */
    function coerceSkill(field, value) {
      if (field.kind !== 'list') return value
      var list = Array.isArray(value) ? value : []
      var seen = {}
      var out = []
      for (var i = 0; i < list.length; i++) {
        var item = typeof list[i] === 'string' ? list[i].trim() : ''
        if (item === '' || seen[item]) continue
        seen[item] = true
        out.push(item)
      }
      return out
    }

    function SkillPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          var n = Array.isArray(value.customRoots) ? value.customRoots.length : 0
          return summaryLine([t('skills.summary', { n: n })])
        }))
      }
      return React.createElement(SettingsForm, { form: form, fields: SKILL_FIELDS, coerce: coerceSkill })
    }

    var COMPACT_MODEL_FIELDS = [
      {
        key: 'followSelection',
        kind: 'boolean',
        group: t('compactModel.group.main'),
        label: t('compactModel.follow.label'),
        hint: t('compactModel.follow.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.followSelection,
      },
      {
        key: 'chunkedCompaction',
        kind: 'boolean',
        label: t('compactModel.chunked.label'),
        hint: t('compactModel.chunked.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.chunkedCompaction,
      },
      {
        key: 'pressureGuardEnabled',
        kind: 'boolean',
        label: t('compactModel.pressureGuard.label'),
        hint: t('compactModel.pressureGuard.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.pressureGuardEnabled,
      },
      {
        key: 'autoRetry',
        kind: 'boolean',
        group: t('compactModel.group.retry'),
        label: t('compactModel.autoRetry.label'),
        hint: t('compactModel.autoRetry.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.autoRetry,
      },
      {
        key: 'autoRetryAttempts',
        kind: 'number',
        label: t('compactModel.autoRetryAttempts.label'),
        hint: t('compactModel.autoRetryAttempts.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.autoRetryAttempts,
        min: 0,
        max: 4,
        step: 1,
      },
      {
        key: 'autoRetryDelayMs',
        kind: 'number',
        label: t('compactModel.autoRetryDelayMs.label'),
        hint: t('compactModel.autoRetryDelayMs.hint'),
        fallback: COMPACT_MODEL_DEFAULTS.autoRetryDelayMs,
        min: 0,
        max: 20000,
        step: 100,
      },
    ]

    // 布尔缺值按各自默认收拢：跟随默认开；分片、重试、压力保护（1.4.26 起、1.4.36 起分片与重试）默认关
    // （它压不动时会拒绝回合，必须显式打开）。
    function coerceCompactModel(field, value) {
      // 缺省（undefined / null）取字段自己的默认值；有值则严格按 true 判断，不把 null 当成开。
      if (field.kind === 'boolean') return value === undefined || value === null ? field.fallback === true : value === true
      if (field.kind === 'number') {
        var n = Number(value)
        if (!isFinite(n)) return field.fallback
        if (field.min !== undefined && n < field.min) return field.min
        if (field.max !== undefined && n > field.max) return field.max
        return Math.round(n)
      }
      return value
    }

    function describeCompactModel(value) {
      return summaryLine([
        t('compactModel.summary.follow', { on: value.followSelection !== false ? t('common.on') : t('common.off') }),
        t('compactModel.summary.chunked', { on: value.chunkedCompaction === true ? t('common.on') : t('common.off') }),
        value.pressureGuardEnabled === true ? t('compactModel.summary.guardOn') : t('compactModel.summary.guardOff'),
        t('compactModel.summary.retry', { n: value.autoRetry !== true ? 0 : value.autoRetryAttempts === undefined ? 2 : value.autoRetryAttempts }),
      ])
    }

    /**
     * The compact-model row page.
     *
     * `props.form` is the page's live form when the shell hands one over; when
     * it does not (the row page rendered empty with no fields at all), the
     * namespace is read from the same `configForms` service the rest of this
     * bundle uses. A missing form now names itself instead of rendering blank.
     */
    function makeCompactModelPage(ctx) {
      return function CompactModelPage(props) {
        var form = props.form
        if ((form === undefined || form === null) && ctx && ctx.configForms) {
          try {
            form = ctx.configForms.get(NS_COMPACT_MODEL)
          } catch (error) {
            form = null
          }
        }
        if (props.view === 'summary') {
          return React.createElement('span', null, summaryFrom(form, describeCompactModel))
        }
        if (!form) {
          // 1.4.26：连表单都没拿到时也要看得见两个功能各自的开关状态，
          // 而不是一句「未提供设置」的空白页（用户报过「看不到这两个开关」）。
          var live = ctx ? readNamespace(ctx, NS_COMPACT_MODEL, COMPACT_MODEL_DEFAULTS) : { value: COMPACT_MODEL_DEFAULTS }
          var value = live.value
          var onOff = function (v, onWhenUndefined) {
            return (onWhenUndefined ? v !== false : v === true) ? t('common.on') : t('common.off')
          }
          return React.createElement(
            'div',
            null,
            React.createElement('p', { className: 'dshp-note' }, t('form.noSettings')),
            statusStrip([
              { label: t('compactModel.follow.label'), value: onOff(value.followSelection, true) },
              { label: t('compactModel.chunked.label'), value: onOff(value.chunkedCompaction, false) },
              { label: t('compactModel.pressureGuard.label'), value: onOff(value.pressureGuardEnabled, false) },
              { label: t('compactModel.autoRetry.label'), value: onOff(value.autoRetry, false) },
            ]),
          )
        }
        return React.createElement(SettingsForm, { form: form, fields: COMPACT_MODEL_FIELDS, coerce: coerceCompactModel })
      }
    }

    var LRU_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: t('lru.enabled.label'),
        hint: t('lru.enabled.hint'),
        fallback: LRU_DEFAULTS.enabled,
      },
      {
        key: 'subagent',
        kind: 'boolean',
        label: t('lru.subagent.label'),
        hint: t('lru.subagent.hint'),
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
      var on = value.enabled !== false ? t('common.on') : t('common.off')
      var subOn = value.subagent !== false ? t('common.on') : t('common.off')
      var probe
      if (stats.error) {
        probe = stats.error
      } else if (stats.workspaces > 0) {
        probe = t('lru.strip.workspaces') + ' ' + stats.workspaces + (stats.lastMove ? t('lru.summary.recentMove', { time: stats.lastMove }) : t('lru.summary.idle'))
      } else {
        probe = t('lru.summary.waiting')
      }
      return summaryLine([
        t('lru.summary.workspaces', { on: on }),
        probe,
        t('lru.summary.subagents', { on: subOn, detail: stats.subagents > 0 ? t('lru.summary.subagentsDetail', { n: stats.subagents }) : '' }),
      ])
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
      if (ls.error) items = [{ label: t('common.error'), value: ls.error, tone: 'err' }]
      else if (ls.workspaces > 0) {
        items = [
          { label: t('lru.strip.workspaces'), value: ls.workspaces, tone: 'ok' },
          { label: t('lru.strip.lastMove'), value: ls.lastMove || t('lru.strip.idle'), tone: ls.lastMove ? 'ok' : 'idle' },
        ]
        if (ls.subagents > 0) items.push({ label: t('lru.strip.subagents'), value: t('lru.strip.reordered', { n: ls.subagents }), tone: 'ok' })
      } else items = [{ label: t('lru.summary.waiting'), tone: 'idle' }]
      return React.createElement(SettingsForm, { form: form, fields: LRU_FIELDS, coerce: coerceLru, after: statusStrip(items) })
    }

    var SHELL_LOCAL_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: t('shell.enabled.label'),
        hint: t('shell.enabled.hint'),
        fallback: SHELL_LOCAL_DEFAULTS.enabled,
      },
    ]

    function coerceShellLocal(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    /** The shell-local status line: whether the unconfined shell is in effect. */
    function describeShellLocal(value) {
      var on = value.enabled !== false ? t('common.on') : t('common.off')
      return summaryLine([on, value.enabled !== false ? t('shell.summary.bypass') : t('shell.summary.sandbox')])
    }

    function ShellLocalPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement('span', null, summaryFrom(form, function (value) {
          return describeShellLocal(value)
        }))
      }
      var shellSnap = formSnapshotOf(form)
      var shellOn = !(shellSnap && shellSnap.value) || shellSnap.value.enabled !== false
      return React.createElement(SettingsForm, {
        form: form,
        fields: SHELL_LOCAL_FIELDS,
        coerce: coerceShellLocal,
        after: statusStrip([
          shellOn
            ? { label: 'shell', value: t('shell.strip.bypass'), tone: 'warn' }
            : { label: 'shell', value: t('shell.strip.sandbox'), tone: 'ok' },
          { label: t('shell.strip.fileFence'), value: t('shell.strip.unchanged'), tone: 'ok' },
        ]),
      })
    }

    var VISUALIZE_FIELDS = [
      {
        key: 'svg',
        kind: 'boolean',
        label: t('visualize.svg.label'),
        hint: t('visualize.svg.hint'),
        fallback: VISUALIZE_DEFAULTS.svg,
      },
      {
        key: 'mermaid',
        kind: 'boolean',
        label: t('visualize.mermaid.label'),
        hint: t('visualize.mermaid.hint'),
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
      var svgOn = value.svg !== false ? t('common.on') : t('common.off')
      var mmdOn = value.mermaid !== false ? t('common.on') : t('common.off')
      var runtime =
        stats.mermaidState === 'ready' ? t('visualize.runtime.ready')
        : stats.mermaidState === 'loading' ? t('visualize.runtime.loading')
        : stats.mermaidState === 'failed' ? t('visualize.runtime.failed')
        : t('visualize.runtime.missing')
      return summaryLine([
        'svg ' + svgOn,
        'mermaid ' + mmdOn,
        runtime,
        t('visualize.count.rendered', { n: stats.svg + stats.mermaid }),
        stats.errors > 0 ? t('visualize.count.errors', { n: stats.errors }) : '',
      ])
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
      var runtimeText = { ready: t('visualize.runtime.shortReady'), loading: t('visualize.runtime.shortLoading'), failed: t('visualize.runtime.shortFailed') }[vs.mermaidState] || t('visualize.runtime.shortMissing')
      var runtimeTone = { ready: 'ok', loading: 'warn', failed: 'err' }[vs.mermaidState] || 'idle'
      var visItems = [
        { label: t('visualize.strip.runtime'), value: runtimeText, tone: runtimeTone, pulse: vs.mermaidState === 'loading' },
        { label: t('visualize.rendered'), value: t('visualize.count.svgMermaid', { svg: vs.svg, mermaid: vs.mermaid }), tone: vs.svg + vs.mermaid > 0 ? 'ok' : 'idle' },
      ]
      if (vs.errors > 0) visItems.push({ label: t('visualize.errors'), value: vs.errors, tone: 'err' })
      return React.createElement(SettingsForm, { form: form, fields: VISUALIZE_FIELDS, coerce: coerceVisualize, after: statusStrip(visItems) })
    }

    /**
     * 0.4.49：官方替代说明（DSH 已内建「自动化任务」dsh-schedule，完整覆盖
     * 本组件功能且更强），在 timer 设置页顶部展示；本行默认 disabled: true。
     */
    var TIMER_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: t('timer.enabled.label'),
        hint: t('timer.enabled.hint'),
        fallback: TIMER_DEFAULTS.enabled,
      },
    ]

    function coerceTimer(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    function describeTimer(value) {
      var on = value.enabled !== false ? t('common.on') : t('common.off')
      return summaryLine([on, value.enabled !== false ? t('timer.summary.timerSet') : ''])
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
        before: callout('accent', t('timer.officialTitle'), t('timer.officialNote')),
      })
    }

    var NOTIFY_FIELDS = [
      {
        key: 'completeSound',
        kind: 'boolean',
        group: t('notify.group.complete'),
        groupHint: t('notify.group.completeHint'),
        label: t('notify.sound.label'),
        hint: t('notify.sound.hintComplete'),
        fallback: NOTIFY_DEFAULTS.completeSound,
      },
      {
        key: 'completeNotify',
        kind: 'boolean',
        group: t('notify.group.complete'),
        label: t('notify.systemNotify.label'),
        hint: t('notify.systemNotify.hintComplete'),
        fallback: NOTIFY_DEFAULTS.completeNotify,
      },
      {
        key: 'attentionSound',
        kind: 'boolean',
        group: t('notify.group.attention'),
        groupHint: t('notify.group.attentionHint'),
        label: t('notify.sound.label'),
        hint: t('notify.sound.hintAttention'),
        fallback: NOTIFY_DEFAULTS.attentionSound,
      },
      {
        key: 'attentionNotify',
        kind: 'boolean',
        group: t('notify.group.attention'),
        label: t('notify.systemNotify.label'),
        hint: t('notify.systemNotify.hintAttention'),
        fallback: NOTIFY_DEFAULTS.attentionNotify,
      },
    ]

    function coerceNotify(field, value) {
      if (field.kind === 'boolean') return value !== false
      return value
    }

    function describeNotify(value) {
      var stats = notifyStatsStore.get()
      // 一组的两个开关合成一个词：声+通知 / 仅声 / 仅通知 / 关。
      // 旧的「声:声/通知:—」把开关名和开关值挤在一起，读一遍要拆两遍。
      function channel(sound, notify) {
        if (sound && notify) return t('notify.channel.both')
        if (sound) return t('notify.channel.soundOnly')
        if (notify) return t('notify.channel.notifyOnly')
        return t('notify.channel.off')
      }
      var complete = channel(value.completeSound === true, value.completeNotify === true)
      var attention = channel(value.attentionSound === true, value.attentionNotify === true)
      var permText =
        stats.permission === 'granted'
          ? t('notify.perm.granted')
          : stats.permission === 'denied'
            ? t('notify.perm.denied')
            : stats.permission === 'unsupported'
              ? t('notify.perm.unsupported')
              : t('notify.perm.unprompted')
      return summaryLine([
        t('notify.strip.complete', { channel: complete }),
        t('notify.strip.attention', { channel: attention }),
        t('notify.strip.perm', { perm: permText }),
        stats.lastAttention ? t('notify.strip.last', { kind: attentionLabel(stats.lastAttentionKind) }) : '',
        stats.error,
      ])
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
      var permLabel = t('notify.strip.permLabel')
      var permItem =
        perm === 'granted'
          ? { label: permLabel, value: t('notify.perm.granted'), tone: 'ok' }
          : perm === 'denied'
            ? { label: permLabel, value: t('notify.perm.denied'), tone: 'err' }
            : perm === 'unsupported'
              ? { label: permLabel, value: t('notify.perm.unsupported'), tone: 'idle' }
              : { label: permLabel, value: t('notify.perm.unprompted'), tone: 'idle' }
      var items = [permItem]
      if (stats.lastComplete) items.push({ label: t('notify.strip.lastComplete'), value: stats.lastComplete, tone: 'ok' })
      if (stats.lastAttention) items.push({ label: t('notify.strip.lastAttention'), value: stats.lastAttention + '（' + attentionLabel(stats.lastAttentionKind) + '）', tone: 'warn' })
      if (stats.lastTest) items.push({ label: t('notify.strip.lastTest'), value: stats.lastTest, tone: 'idle' })
      if (stats.error) items.push({ label: t('common.error'), value: stats.error, tone: 'err' })
      var permHint =
        perm === 'denied'
          ? t('notify.permHint.denied')
          : perm === 'granted'
            ? t('notify.permHint.granted')
            : t('notify.permHint.default')
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
            React.createElement('button', { type: 'button', className: 'dshp-btn', onClick: testNotify }, t('notify.test')),
            React.createElement('span', { className: 'dshp-note' }, permHint),
          ),
          statusStrip(items),
        ),
      })
    }
