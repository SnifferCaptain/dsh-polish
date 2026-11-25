    // ------------------------------------------------- Better Model Config (v4.22)
    //
    // An in-place extension of the OFFICIAL Models settings page — ONE entry
    // point, the official editor. No parallel model list, no second save
    // button. Everything this module writes goes through the same
    // `llm-pi-ai` Config the official editor writes (path ops + revision
    // check via configForms.mutate).
    //
    // WHAT IT ADDS (and what it deliberately does not):
    //   1. 本模型协议 — pi-ai's `api` is a ROUTE-level field, so "this model
    //      speaks anthropic-messages" can only be expressed by moving the
    //      model onto a sibling route (`<base>-<suffix>`) of the same gateway
    //      with the same credential. The official provider editor owns the
    //      route-level 协议; this control is per model, carries no "same
    //      value twice" duplicate, and is the only way to mix protocols under
    //      one credential.
    //   2. 按默认填充 — model-defaults.jsonc (capabilities + prices, ~1 MB)
    //      exists to INITIALIZE empty fields, never to decorate the page.
    //      It fills contextWindow / maxTokens / input / reasoningEfforts /
    //      name only where the stored row is empty, and never overwrites.
    //   3. /v1 guard — a one-click fix shown inside the panel only when the
    //      route address actually contradicts its protocol.
    //   4. 价格 — the one fact of the table that cannot be stored (the
    //      official model schema has no price field), shown as a single
    //      muted chip. Nothing else from the table is rendered.
    //
    // THINKING IS NOT HERE. The official model panel already carries
    // 「推理等级」 (switch + level rows writing `reasoningEfforts`); a second
    // control for the same field meant two writers and two answers for one
    // decision. 1.4.22 deleted it.
    //
    // WHERE the UI lives (this is the part 1.4.12 got wrong): the official
    // page renders each model as an expandable row; its chevron opens the
    // "模型选项" panel (class `*_modelAdvanced`, the grid that already holds
    // 上下文窗口 / 最大输出 / 输入类型 / 推理等级). That panel is where the
    // extra fields belong.
    //
    // Attaching to a React-owned node is safe ONLY if the attachment is
    // idempotent: each panel gets ONE strip, created on first sight, and
    // every later pass only writes a property whose value actually changed.
    //
    // Visual contract (1.4.15): until a model row is expanded, the page must
    // look EXACTLY like the official page. The provider-card slot therefore
    // renders nothing but a `display:none` route anchor.

    var BMC_STYLE_ID = 'dsh-polish-bmc-css'
    // pi-ai 支持的协议（`api`）。顺序 = 官方 schema 的顺序，第一个是默认。
    var BMC_APIS = ['openai-completions', 'openai-responses', 'anthropic-messages']
    // 兄弟路线的后缀。换协议 = 把模型搬到同网关的兄弟路线，沿用同一份凭据。
    var BMC_ROUTE_SUFFIX = {
      'openai-completions': 'openai-chat-api',
      'openai-responses': 'openai-responses-api',
      'anthropic-messages': 'anthropic-api',
    }
    var BMC_REFERENCE_PATH = '/api/dshp/better-model-config/reference'
    var BMC_CARD_SEL = 'li[class*="_rowCard"]'
    var BMC_ROW_SEL = '[class*="_modelEntry"]'
    var BMC_ADVANCED_SEL = '[class*="_modelAdvanced"]'
    var BMC_STAMP_ATTR = 'data-dshp-bmc-route'
    var BMC_STRIP_ATTR = 'data-dshp-bmc-strip'

    // 逐条照抄官方 models 页的 CSS module（jrmgQW_*）：2 列网格、8px 间距、
    // 12px 三级标签 + 32px 输入框；整行元素 grid-column:1/-1；推理等级组是
    // 整行 flex 列 + 两端对齐的 head。这里不发明任何尺寸。
    var BMC_CSS = [
      '.dshp-bmc-stamp { display: none !important; }',
      '.dshp-bmc-strip { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 2px; min-width: 0; }',
      '.dshp-bmc-strip > [hidden] { display: none !important; }',
      '.dshp-bmc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }',
      '.dshp-bmc-lab { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }',
      '.dshp-bmc-think { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-top: 2px; }',
      '.dshp-bmc-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }',
      // 开关不自己定尺寸：官方的 Switch 是 36×20 / 圆角 999px / 内边距 2px /
      // 圆钮 16px（border-radius:50%），开=brand-primary 轨道 + 前景色圆钮。
      // 共享的 .dshp-switch 就是这套数值，这里只保证它在整行 head 里右对齐。
      '.dshp-bmc-select { box-sizing: border-box; width: 100%; height: 32px; border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; padding: 0 10px; cursor: pointer; }',
      // 按钮照官方的「添加档位 / 添加模型」：描边小胶囊，自适应宽度，不是整行输入框。
      '.dshp-bmc-fill { box-sizing: border-box; align-self: flex-start; height: 28px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
      '.dshp-bmc-fill:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshp-bmc-fill:disabled { opacity: .4; cursor: default; }',
      '.dshp-bmc-v1btn { box-sizing: border-box; grid-column: 1 / -1; align-self: flex-start; height: 28px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-state-warn-label); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
      // 官方按钮焦点环：2px box-shadow，颜色 --dsw-focus-ring-color（同 .jrmgQW_addModelButton:focus-visible）。
      '.dshp-bmc-fill:focus-visible, .dshp-bmc-v1btn:focus-visible, .dshp-bmc-select:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline: none; }',
      // 价格当「默认值」这一格的标签用，不再单独占一行。
      '.dshp-bmc-price { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }',
      '.dshp-bmc-state { grid-column: 1 / -1; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }',
      // 1.4.35：状态条挂在官方面板里，不在 .dshp-form 内，--dshp-* 变量不存在 → 之前
      // 成功/失败没有语义色。这里直接用官方 state 令牌。
      '.dshp-bmc-state[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); }',
      '.dshp-bmc-state[data-tone="err"] { color: var(--dsw-alias-state-error-primary); }',
      '.dshp-bmc-state[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); }',
      '.dshp-bmc-state[data-tone="info"] { color: var(--dsw-alias-label-tertiary); }',
    ].join('\n')

    var BMC_DEFAULTS = { enabled: true }
    /** Build marker in the plugin row summary — a glance tells which bundle the
     *  page actually runs (a stale bundle looks like a bug). */
    var BMC_BUILD = '1.5.0'

    // ---------------------------------------------------- pure helpers

    function bmcKey(id) {
      return String(id === undefined || id === null ? '' : id).normalize('NFKC').toLowerCase().replace(/[.\-\s]/g, '')
    }

    function bmcTokens(n) {
      if (typeof n !== 'number' || !isFinite(n)) return ''
      if (n >= 1048576 && n % 1048576 === 0) return n / 1048576 + 'M'
      if (n >= 1024 && n % 1024 === 0) return n / 1024 + 'K'
      return String(n)
    }

    function bmcPrice(value) {
      if (typeof value !== 'number' || !isFinite(value)) return '-'
      return String(Math.round(value * 1000) / 1000)
    }

    function bmcPriceSymbol(currency) {
      return currency === 'USD' ? '$' : '\u00a5'
    }

    /** The one-line price chip: `¥0.7 / ¥3.5`, or '' when the table has none. */
    function bmcPriceText(ref) {
      var price = ref && ref.price
      if (!price || typeof price !== 'object') return ''
      var input = typeof price.input === 'number' ? price.input : null
      var output = typeof price.output === 'number' ? price.output : null
      if (input === null && output === null) return ''
      var symbol = bmcPriceSymbol(price.currency)
      return symbol + bmcPrice(input) + ' / ' + symbol + bmcPrice(output)
    }

    /** The user-layer profile of a route (what the official editor edits), or null. */
    function bmcUserProfile(snapshot, route) {
      var layer = snapshot && snapshot.user && snapshot.user.providers
      var profile = layer && layer[route]
      return profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : null
    }

    function bmcApiLabel(api) {
      return BMC_APIS.indexOf(api) >= 0 ? t('bmc.api.' + api) : String(api || '')
    }

    /** The gateway route a sibling route was derived from, or null. */
    function bmcSiblingBase(route) {
      for (var i = 0; i < BMC_APIS.length; i++) {
        var suffix = '-' + BMC_ROUTE_SUFFIX[BMC_APIS[i]]
        if (route.length > suffix.length && route.slice(-suffix.length) === suffix) return route.slice(0, route.length - suffix.length)
      }
      return null
    }

    function bmcSiblingRoute(route, api) {
      return (bmcSiblingBase(route) || route) + '-' + BMC_ROUTE_SUFFIX[api]
    }

    /**
     * The address a moved model's route gets: adjusted only when the move
     * crosses the anthropic/openai boundary, mirroring `bmcV1Fix` — to
     * anthropic the trailing `/v1` is stripped, from anthropic a `/v1`
     * suffix is added when none is present, openai-to-openai stays as is.
     */
    function bmcMoveBaseURL(url, fromApi, toApi) {
      var base = String(url || '').trim().replace(/\/+$/, '')
      if (base === '') return base
      var fromAnthropic = fromApi === 'anthropic-messages'
      var toAnthropic = toApi === 'anthropic-messages'
      if (toAnthropic && !fromAnthropic) return base.replace(/\/v1$/, '')
      if (fromAnthropic && !toAnthropic) return /\/v[0-9]+$/.test(base) ? base : base + '/v1'
      return base
    }

    /**
     * Bidirectional /v1 guard. The Anthropic SDK appends `/v1/messages`
     * itself, so an anthropic route must NOT carry a trailing `/v1`; the
     * OpenAI SDKs take the root as given, so an openai route needs `/v1`
     * (or another /vN suffix). Returns the fix, or null when nothing is
     * wrong.
     */
    function bmcV1Fix(api, baseURL) {
      var base = String(baseURL || '').trim().replace(/\/+$/, '')
      if (base === '') return null
      if (api === 'anthropic-messages') {
        if (/\/v1$/i.test(base)) return { kind: 'strip', url: base.replace(/\/v1$/i, '') }
        return null
      }
      if (api === 'openai-completions' || api === 'openai-responses') {
        if (!/\/v[0-9]+$/i.test(base)) return { kind: 'add', url: base + '/v1' }
        return null
      }
      return null
    }

    /**
     * What the reference table contributes to one model: the fields that are
     * still EMPTY and that the entry can fill. The reference NEVER overrides a
     * stored value — a model row the user has already described is left alone.
     * Returns `{ fields, notes }` or null when there is no reference entry.
     */
    function bmcFillPlan(model, ref) {
      if (!ref) return null
      var fields = {}
      var notes = []
      var m = model || {}
      if (typeof m.name !== 'string' || m.name.trim() === '') {
        if (typeof ref.name === 'string' && ref.name.trim() !== '') fields.name = ref.name
      }
      if (typeof m.contextWindow !== 'number' && Number.isFinite(ref.contextWindow)) fields.contextWindow = ref.contextWindow
      if (typeof m.maxTokens !== 'number' && Number.isFinite(ref.maxTokens)) fields.maxTokens = ref.maxTokens
      var hasInput = Array.isArray(m.input) && m.input.length > 0
      // MODALITIES in pi-ai is exactly {text, image}; there is no audio field.
      if (!hasInput && ref.image === true) fields.input = ['text', 'image']
      var thinking = ref.thinking
      if (m.reasoningEfforts === undefined && thinking && typeof thinking === 'object') {
        if (thinking.scheme === 'levels' && Array.isArray(thinking.levels) && thinking.levels.length > 0) {
          var map = {}
          for (var i = 0; i < thinking.levels.length; i++) {
            var level = thinking.levels[i]
            if (!level || typeof level.level !== 'string') continue
            var wire = level.wire
            if (wire === undefined) wire = level.level === 'off' ? null : level.level
            if (wire === null && level.level !== 'off') wire = level.level // the official validator needs a value for non-off levels
            map[level.level] = wire
          }
          var hasReal = false
          Object.keys(map).forEach(function (key) {
            if (key !== 'off') hasReal = true
          })
          if (hasReal) fields.reasoningEfforts = map
          else notes.push('bmc.fill.thinkingOffOnly')
        } else if (thinking.scheme === 'budget') {
          // A numeric budget cannot be expressed in the official per-model
          // fields (route-level budgets only) — surface it, don't write it.
          notes.push('bmc.fill.budget')
        }
        // scheme 'none' → leave the field unset (absence = inherit)
      }
      return { fields: fields, notes: notes }
    }

    /**
     * The view model of one model row's extra fields. Pure: the DOM writer
     * only reads this, and the tests assert it without a browser.
     */
    function bmcStripModel(snapshot, route, modelId, ref) {
      var profile = bmcUserProfile(snapshot, route)
      var savedModel = null
      if (profile && Array.isArray(profile.models)) {
        for (var i = 0; i < profile.models.length; i++) if (profile.models[i] && profile.models[i].id === modelId) savedModel = profile.models[i]
      }
      var writable = !!snapshot && snapshot.status === 'ready' && snapshot.writable !== false
      var plan = ref ? bmcFillPlan(savedModel || { id: modelId }, ref) : null
      // The route-level /v1 guard rides inside the model panel: nothing may be
      // visible before the row is expanded.
      var v1 = profile ? bmcV1Fix(profile.api, profile.baseURL) : null
      var routeApi = profile && BMC_APIS.indexOf(profile.api) >= 0 ? profile.api : ''
      var canFill = writable && plan !== null && Object.keys(plan.fields).length > 0
      return {
        // The protocol the model actually runs under is the route's, so that
        // is what the select shows until the user moves it.
        api: routeApi,
        apiChoices: BMC_APIS.slice(),
        saved: savedModel !== null,
        fillAvailable: writable,
        canFill: canFill,
        fillTitle: ref === null ? t('bmc.ref.none') : plan && plan.notes.length > 0 ? plan.notes.map(function (key) { return t(key) }).join(' ') : '',
        price: bmcPriceText(ref),
        // 思考开关（用户定义）：它**不是**"给模型开关思考"，而是"这个模型允不允许
        // 被开关思考"——即模型是否声明思考能力（pi-ai: reasoningEfforts 为对象 =
        // reasoning:true 并带 off 档，会话里才出现思考 on/off；显式 false = 不能开关）。
        // 已经配了 ≥2 个非 off 档（思考等级预设）时，细粒度的等级控制接管，本开关
        // 只显示状态、不再操作。
        think: bmcThinkState(savedModel),
        thinkTitle: bmcThinkTitle(bmcThinkState(savedModel)),
        v1: v1 ? { url: v1.url } : null,
        v1Title: v1 ? t(v1.kind === 'strip' ? 'bmc.v1.strip' : 'bmc.v1.add', { url: v1.url }) : '',
        writable: writable,
      }
    }

    /** 思考开关的三态：'off' = 模型不能开关思考；'preset' = 等级预设接管；'on' = 可开关。 */
    function bmcThinkState(model) {
      var efforts = model ? model.reasoningEfforts : undefined
      if (efforts === false) return 'off'
      if (!efforts || typeof efforts !== 'object' || Array.isArray(efforts)) return 'on'
      var levels = 0
      Object.keys(efforts).forEach(function (key) {
        if (key !== 'off') levels += 1
      })
      return levels >= 2 ? 'preset' : 'on'
    }

    function bmcThinkTitle(state) {
      return t(state === 'preset' ? 'bmc.think.preset' : state === 'off' ? 'bmc.think.offHint' : 'bmc.think.onHint')
    }

    /**
     * Where a model goes when it is told to speak another protocol: onto the
     * sibling route of the same gateway (`<base>-<suffix>`), carrying the same
     * credential, with the address adjusted for the target SDK. Moving back to
     * the base route is the same operation with the base route's own api.
     * Returns `{ ops, target, created }` or `{ error, params }`.
     */
    function bmcPlanMove(snapshot, route, modelId, api) {
      var providers = (snapshot && snapshot.user && snapshot.user.providers) || {}
      var source = providers[route]
      if (!source || !Array.isArray(source.models)) return { error: 'bmc.error.noSource' }
      var model = null
      for (var i = 0; i < source.models.length; i++) if (source.models[i] && source.models[i].id === modelId) model = source.models[i]
      if (model === null) return { error: 'bmc.error.noModel', params: { model: modelId } }
      if (BMC_APIS.indexOf(api) < 0) return { error: 'bmc.error.sameApi' }
      if (api === source.api) return { error: 'bmc.error.sameApi' }
      // A route with a single model IS that model's protocol, so switching the
      // route's own `api` changes the model in place. Refusing here made the
      // control a dead end on the most common shape (one model per gateway),
      // which is exactly the shape this extension exists for.
      if (source.models.length < 2) {
        var singleUrl = String(source.baseURL || '').trim()
        if (!/^https?:\/\/[^\s]+$/i.test(singleUrl)) return { error: 'bmc.error.url' }
        var switched = Object.assign({}, model)
        delete switched.compat
        var nextUrl = bmcMoveBaseURL(singleUrl, source.api, api)
        var routeOps = [{ op: 'set', path: ['providers', route, 'api'], value: api }]
        if (nextUrl !== singleUrl) routeOps.push({ op: 'set', path: ['providers', route, 'baseURL'], value: nextUrl })
        routeOps.push({ op: 'set', path: ['providers', route, 'models'], value: [switched] })
        return { ops: routeOps, target: route, created: false, mode: 'route' }
      }
      var base = bmcSiblingBase(route) || route
      var baseProfile = providers[base] || null
      var target = api === (baseProfile && baseProfile.api) ? base : bmcSiblingRoute(route, api)
      if (target === route) return { error: 'bmc.error.sameApi' }
      if (!/^[a-z][a-z0-9-]*$/.test(target)) return { error: 'bmc.error.routeName', params: { route: target } }
      var fromApi = source.api
      var url = String((baseProfile && baseProfile.baseURL) || source.baseURL || '').trim()
      if (!/^https?:\/\/[^\s]+$/i.test(url)) return { error: 'bmc.error.url' }
      var moved = Object.assign({}, model)
      // Protocol-specific switches do not survive a protocol change.
      delete moved.compat
      var remaining = source.models.filter(function (item) { return item !== model })
      var ops = []
      var existing = providers[target]
      if (existing !== undefined && target !== base) {
        if (!existing || existing.api !== api || !Array.isArray(existing.models)) return { error: 'bmc.error.conflict', params: { route: target } }
        for (var j = 0; j < existing.models.length; j++) {
          if (existing.models[j] && existing.models[j].id === modelId) return { error: 'bmc.error.exists', params: { route: target } }
        }
        ops.push({ op: 'set', path: ['providers', target, 'models'], value: existing.models.concat([moved]) })
      } else if (existing !== undefined) {
        // Moving back onto the base route: its own protocol is the target's.
        ops.push({ op: 'set', path: ['providers', target, 'models'], value: existing.models.concat([moved]) })
      } else {
        var profile = {
          displayName: (typeof source.displayName === 'string' && source.displayName ? source.displayName : base) + ' \u00b7 ' + bmcApiLabel(api),
          api: api,
          baseURL: bmcMoveBaseURL(url, fromApi, api),
          models: [moved],
        }
        if (source.apiKeyEnv !== undefined) profile.apiKeyEnv = source.apiKeyEnv
        ;['headers', 'retryPolicy', 'timeoutMs'].forEach(function (key) {
          if (source[key] !== undefined) profile[key] = source[key]
        })
        ops.push({ op: 'set', path: ['providers', target], value: profile })
      }
      ops.push({ op: 'set', path: ['providers', route, 'models'], value: remaining })
      return { ops: ops, target: target, created: existing === undefined }
    }

    // --------------------------------------------------------- patcher

    var bmcPatcherInstance = null

    function makeBmcPatcher(ctx) {
      var refState = { status: 'idle', lookup: null, version: null, error: null }
      var listeners = []
      var routeStatus = Object.create(null)
      var modelStatus = Object.create(null)
      var queue = Object.create(null)
      var strips = [] // live records; each owns exactly one strip element
      var poll = null // slow interval; no document-wide MutationObserver
      var timer = null
      var syncing = false
      var disposed = false

      function emit() {
        for (var i = 0; i < listeners.length; i++) {
          try {
            listeners[i]()
          } catch (error) {}
        }
      }

      function status(route) {
        return routeStatus[route] || null
      }

      function setRouteStatus(route, tone, message) {
        routeStatus[route] = { tone: tone, message: message, ts: Date.now() }
        emit()
      }

      function modelKey(route, modelId) {
        return route + '\u0000' + modelId
      }

      function modelStatusOf(route, modelId) {
        return modelStatus[modelKey(route, modelId)] || null
      }

      function setModelStatus(route, modelId, tone, message) {
        modelStatus[modelKey(route, modelId)] = { tone: tone, message: message, ts: Date.now() }
      }

      function onStatus(fn) {
        listeners.push(fn)
        return function () {
          listeners = listeners.filter(function (item) {
            return item !== fn
          })
        }
      }

      function loadReference() {
        if (refState.status === 'loading' || refState.status === 'done') return Promise.resolve(refState)
        if (typeof fetch !== 'function') {
          refState = { status: 'done', lookup: null, version: null, error: 'fetch unavailable' }
          return Promise.resolve(refState)
        }
        refState = { status: 'loading', lookup: null, version: null, error: null }
        return fetch(BMC_REFERENCE_PATH, { headers: { accept: 'application/json' } })
          .then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + String(response.status))
            return response.json()
          })
          .then(function (data) {
            refState = {
              status: 'done',
              lookup: data && data.lookup ? data.lookup : null,
              version: data && data.version,
              error: data && data.error ? String(data.error) : null,
            }
            scheduleSync()
            return refState
          })
          .catch(function (error) {
            refState = { status: 'done', lookup: null, version: null, error: error && error.message ? error.message : String(error) }
            scheduleSync()
            return refState
          })
      }

      function bmcForm() {
        try {
          return ctx.configForms.get(NS_PI_AI)
        } catch (error) {
          return null
        }
      }

      function freshSnapshot() {
        var form = bmcForm()
        if (!form) return null
        try {
          return form.getSnapshot()
        } catch (error) {
          return null
        }
      }

      function commit(ops) {
        var form = bmcForm()
        if (!form) return Promise.resolve({ ok: false, message: t('bmc.state.unavailable') })
        var fresh = null
        try {
          fresh = form.getSnapshot()
        } catch (error) {}
        if (!fresh || fresh.status !== 'ready' || fresh.writable === false) return Promise.resolve({ ok: false, message: t('bmc.state.readonly') })
        // mutate 同步抛错时也要转成失败结果，不能冒泡到点击处理器。
        var pending
        try {
          pending = Promise.resolve(form.mutate(ops, fresh.revision))
        } catch (error) {
          return Promise.resolve({ ok: false, message: error && error.message ? error.message : t('bmc.state.rejected') })
        }
        return pending.then(
          function (result) {
            if (result === false || (result && result.ok === false)) {
              var message = result && result.error && result.error.message ? result.error.message : t('bmc.state.rejected')
              return { ok: false, message: message }
            }
            return { ok: true }
          },
          function (error) {
            return { ok: false, message: error && error.message ? error.message : t('bmc.state.rejected') }
          },
        )
      }

      // ------------------------------------------------ effort backup
      // 「思考」开关必须**可逆**：关 = 这个模型不再声明 reasoningEfforts（请求里
      // 不带该字段），但档位表要先存起来，开回来时原样放回。没有这份备份，
      // 关一次就把用户的 low/medium/xhigh 一次性抹掉——1.4.26 正是这么把官方
      // 「思考深度」的行清空的。备份放浏览器本地，键按 route/model 分开。
      function effortKey(route, modelId) {
        return 'dsh-polish:bmc:efforts:' + route + '/' + modelId
      }

      function readEffortBackup(key) {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return null
          var raw = window.localStorage.getItem(key)
          if (!raw) return null
          var value = JSON.parse(raw)
          return value && typeof value === 'object' && !Array.isArray(value) ? value : null
        } catch (error) {
          return null
        }
      }

      function writeEffortBackup(key, value) {
        try {
          if (typeof window === 'undefined' || !window.localStorage) return
          window.localStorage.setItem(key, JSON.stringify(value))
        } catch (error) {}
      }

      // ------------------------------------------------ queue actions

      function queueFill(route, modelId, ref) {
        queue[route] = (queue[route] || []).concat([{ kind: 'fill', modelId: modelId, ref: ref }])
        flush(route)
      }

      function queueUrl(route, url, modelId) {
        queue[route] = (queue[route] || []).concat([{ kind: 'url', url: url, modelId: modelId || null }])
        flush(route)
      }

      function queueMove(route, modelId, api) {
        queue[route] = (queue[route] || []).concat([{ kind: 'move', modelId: modelId, api: api }])
        flush(route)
      }

      function queueThink(route, modelId, on) {
        queue[route] = (queue[route] || []).concat([{ kind: 'think', modelId: modelId, on: on }])
        flush(route)
      }

      // ------------------------------------------------------ flushing

      function applyOpToWorking(root, op) {
        var seg = op.path
        var target = root
        for (var s = 0; s < seg.length - 1; s++) target = target[seg[s]]
        target[seg[seg.length - 1]] = op.value
      }

      /**
       * Apply everything queued for `route` against a FRESH snapshot: a deep
       * working copy is mutated op by op (so a fill queued behind a move sees
       * the move's result), and one final models-array op carries the merged
       * state.
       */
      function flush(route) {
        var pending = queue[route]
        if (!pending || pending.length === 0) {
          queue[route] = null
          return
        }
        queue[route] = null
        var snapshot = freshSnapshot()
        if (!snapshot || snapshot.status !== 'ready' || snapshot.writable === false) {
          var down = t(snapshot && snapshot.status === 'ready' ? 'bmc.state.readonly' : 'bmc.state.unavailable')
          pending.forEach(function (item) {
            if (item.modelId) setModelStatus(route, item.modelId, 'err', down)
            else setRouteStatus(route, 'err', down)
          })
          scheduleSync()
          return
        }
        var original = (snapshot.user && snapshot.user.providers) || {}
        var workingRoot = JSON.parse(JSON.stringify({ providers: original }))
        var working = workingRoot.providers
        var originalModels = original[route] && Array.isArray(original[route].models) ? original[route].models : null
        var ops = []
        var results = []
        pending.forEach(function (item) {
          var profile = working[route]
          if (item.kind === 'url') {
            // The /v1 guard is rendered inside a model panel, so its outcome
            // is reported on that model's strip (a route-level status line
            // would have nowhere visible to live).
            var urlOwner = item.modelId || null
            if (!profile || typeof profile !== 'object') {
              results.push({ modelId: urlOwner, tone: 'err', text: t('bmc.state.noProfile') })
              return
            }
            if (String(profile.baseURL || '') === item.url) {
              results.push({ modelId: urlOwner, tone: 'ok', text: t('bmc.v1.noop') })
              return
            }
            profile.baseURL = item.url
            ops.push({ op: 'set', path: ['providers', route, 'baseURL'], value: item.url })
            results.push({ modelId: urlOwner, tone: 'ok', text: t('bmc.v1.fixed') })
            return
          }
          var idx = -1
          if (profile && Array.isArray(profile.models)) {
            for (var i = 0; i < profile.models.length; i++) {
              if (profile.models[i] && profile.models[i].id === item.modelId) {
                idx = i
                break
              }
            }
          }
          if (item.kind === 'move') {
            var plan = bmcPlanMove({ user: { providers: working } }, route, item.modelId, item.api)
            if (plan.error) {
              results.push({ modelId: item.modelId, tone: 'err', text: t(plan.error, plan.params || {}) })
              return
            }
            for (var p = 0; p < plan.ops.length; p++) {
              applyOpToWorking(workingRoot, plan.ops[p])
              ops.push(plan.ops[p])
            }
            // The row will render under its new route, so the outcome is stored
            // there — a message left on the old route would never be seen.
            results.push({
              modelId: item.modelId,
              route: plan.target,
              tone: 'ok',
              text: t(plan.mode === 'route' ? 'bmc.move.route' : plan.created ? 'bmc.move.created' : 'bmc.move.done', { route: plan.target, api: bmcApiLabel(item.api) }),
            })
            return
          }
          if (!profile || !Array.isArray(profile.models)) {
            results.push({ modelId: item.modelId, tone: 'err', text: t('bmc.error.noSource') })
            return
          }
          if (idx < 0) {
            // The official editor keeps an unsaved model row in its own draft;
            // writing it would mean guessing at React state. Say what to do.
            results.push({ modelId: item.modelId, tone: 'warn', text: t('bmc.fill.saveFirst') })
            return
          }
          if (item.kind === 'think') {
            var thinking = Object.assign({}, profile.models[idx])
            var key = effortKey(route, item.modelId)
            if (item.on) {
              // 开：允许被开关思考 = 声明思考能力（对象 + off 档）。优先还原之前的
              // 档位表；没有备份才写一组最小 on/off（off + 一档）。
              var backup = readEffortBackup(key)
              if (backup && backup.__inherit === true) {
                // 关之前这个模型没写过 reasoningEfforts（继承目录能力）：开回来就是
                // 删掉该字段还原继承，而不是写一张只有一档的表把目录里的档位压扁。
                delete thinking.reasoningEfforts
              } else {
                thinking.reasoningEfforts = backup || { off: null, high: 'high' }
              }
              // 只有「能开关、没有思考深度」的模型才补 enable_thinking 通道：
              // pi-ai 的 enable_thinking 由是否选了档位驱动，reasoning_effort 只在
              // supportsReasoningEffort 为真时才发。只在 completions 协议、且模型自己
              // 没声明过兼容字段时补，绝不覆盖已有声明。
              var declared = thinking.reasoningEfforts && typeof thinking.reasoningEfforts === 'object'
                ? Object.keys(thinking.reasoningEfforts).filter(function (level) { return level !== 'off' }).length
                : 0
              if (declared === 1 && profile && profile.api === 'openai-completions') {
                var compat = Object.assign({}, thinking.compat || {})
                if (compat.thinkingFormat === undefined) compat.thinkingFormat = 'qwen'
                if (compat.supportsReasoningEffort === undefined) compat.supportsReasoningEffort = false
                thinking.compat = compat
              }
            } else {
              // 关：这个模型不能开关思考 = 显式 false（pi-ai: reasoning:false）。
              // 之前的档位表先存起来，开回来时原样放回。
              if (thinking.reasoningEfforts && typeof thinking.reasoningEfforts === 'object') {
                writeEffortBackup(key, thinking.reasoningEfforts)
              } else if (thinking.reasoningEfforts === undefined) {
                writeEffortBackup(key, { __inherit: true })
              }
              thinking.reasoningEfforts = false
            }
            profile.models[idx] = thinking
            results.push({ modelId: item.modelId, tone: 'ok', text: t(item.on ? 'bmc.think.on' : 'bmc.think.off') })
            return
          }
          if (item.kind === 'fill') {
            var plan2 = bmcFillPlan(profile.models[idx], item.ref)
            var fields = plan2 ? plan2.fields : {}
            if (Object.keys(fields).length === 0) {
              results.push({ modelId: item.modelId, tone: 'info', text: t('bmc.fill.none') })
              return
            }
            profile.models[idx] = Object.assign({}, profile.models[idx], fields)
            results.push({ modelId: item.modelId, tone: 'ok', text: t('bmc.fill.done', { fields: Object.keys(fields).join(' / ') }) })
          }
        })
        var finalModels = working[route] && Array.isArray(working[route].models) ? working[route].models : null
        var modelsTouched = false
        for (var t2 = 0; t2 < ops.length; t2++) {
          if (ops[t2].path.join('\u0001') === ['providers', route, 'models'].join('\u0001')) modelsTouched = true
        }
        if (!modelsTouched && finalModels && JSON.stringify(finalModels) !== JSON.stringify(originalModels)) {
          ops.push({ op: 'set', path: ['providers', route, 'models'], value: finalModels })
        }
        function report(tone, suffix) {
          results.forEach(function (item) {
            var text = suffix === undefined ? item.text : item.text + ' \u00b7 ' + suffix
            var where = item.route || route
            if (item.modelId) setModelStatus(where, item.modelId, item.tone === 'ok' ? tone : item.tone, text)
            else setRouteStatus(where, item.tone === 'ok' ? tone : item.tone, text)
          })
          scheduleSync()
        }
        if (ops.length === 0) {
          var anyError = results.some(function (item) {
            return item.tone === 'err'
          })
          report(anyError ? 'err' : 'ok')
          return
        }
        commit(ops).then(function (result) {
          // 1.4.36：每次写入都会推进官方 revision；官方卡片保存时拿的是打开时的旧 revision，
          // 会冲突（conflict 文案：关闭后重开）。这里提示用户重开，避免保存失败时不知所措。
          if (result.ok) report('ok', t('bmc.reopen'))
          else report('err', result.message)
        })
      }

      // ------------------------------------------------ per-model strip

      function stripRecord() {
        var root = document.createElement('div')
        root.className = 'dshp-bmc-strip'
        root.setAttribute(BMC_STRIP_ATTR, '')

        // 本模型协议: the official field anatomy (12px label above a 32px
        // control, left aligned). The route-level 协议 belongs to the official
        // provider editor; this one is scoped to the model and is the only
        // control that can put two protocols under one credential.
        var field = document.createElement('div')
        field.className = 'dshp-bmc-field'
        var label = document.createElement('span')
        label.className = 'dshp-bmc-lab'
        label.textContent = t('bmc.api.label')
        var select = document.createElement('select')
        select.className = 'dshp-bmc-select'
        select.setAttribute('aria-label', t('bmc.api.label'))
        for (var a = 0; a < BMC_APIS.length; a++) {
          var option = document.createElement('option')
          option.value = BMC_APIS[a]
          option.textContent = bmcApiLabel(BMC_APIS[a])
          select.appendChild(option)
        }
        field.appendChild(label)
        field.appendChild(select)

        var button = document.createElement('button')
        button.type = 'button'
        button.className = 'dshp-bmc-fill'
        button.textContent = t('bmc.fill')

        // 「按默认填充」占第二列：价格当它的标签，按钮在下面，和左边那列同一基线。
        var fillField = document.createElement('div')
        fillField.className = 'dshp-bmc-field'

        // Route-level /v1 guard: hidden unless the address is actually wrong.
        var v1 = document.createElement('button')
        v1.type = 'button'
        v1.className = 'dshp-bmc-v1btn'
        v1.hidden = true
        v1.textContent = t('bmc.v1.fix')

        var price = document.createElement('span')
        price.className = 'dshp-bmc-price'
        price.hidden = true

        // 思考开关：照抄官方「推理等级」组的版式——整行、head 内 label 与
        // Switch 两端对齐，而不是挤在一个 220px 的盒子里。
        var thinkField = document.createElement('div')
        thinkField.className = 'dshp-bmc-think'
        var thinkLabel = document.createElement('span')
        thinkLabel.className = 'dshp-bmc-lab'
        thinkLabel.textContent = t('bmc.think.label')
        var thinkRow = document.createElement('div')
        thinkRow.className = 'dshp-bmc-head'
        var thinkSwitch = document.createElement('button')
        thinkSwitch.type = 'button'
        thinkSwitch.className = 'dshp-switch'
        thinkSwitch.setAttribute('role', 'switch')
        thinkSwitch.setAttribute('aria-checked', 'false')
        thinkSwitch.setAttribute('aria-label', t('bmc.think.label'))
        thinkSwitch.title = t('bmc.think.onHint')
        var thinkKnob = document.createElement('span')
        thinkKnob.className = 'dshp-knob'
        thinkSwitch.appendChild(thinkKnob)
        thinkRow.appendChild(thinkLabel)
        thinkRow.appendChild(thinkSwitch)
        thinkField.appendChild(thinkRow)

        var state = document.createElement('span')
        state.className = 'dshp-bmc-state'
        state.hidden = true

        fillField.appendChild(price)
        fillField.appendChild(button)
        root.appendChild(field)
        root.appendChild(fillField)
        root.appendChild(thinkField)
        root.appendChild(v1)
        root.appendChild(state)

        var record = {
          el: root,
          select: select,
          fieldWrap: field,
          thinkField: thinkField,
          fieldLabel: label,
          thinkLabel: thinkLabel,
          think: thinkSwitch,
          button: button,
          v1: v1,
          price: price,
          state: state,
          route: '',
          modelId: '',
          last: {},
        }

        v1.addEventListener('click', function () {
          var fix = record.last.v1
          if (!fix || !record.route || !record.modelId) return
          queueUrl(record.route, fix.url, record.modelId)
        })

        thinkSwitch.addEventListener('click', function () {
          if (!record.modelId || !record.last.writable || record.last.thinkDisabled) return
          // last.think 是 'off' | 'on' | 'preset' 三态字符串：只有当前为 off 时点击才是「打开」。
          // （曾写成 !record.last.think：任何非空字符串取反恒为 false，开关永远只能关。）
          queueThink(record.route, record.modelId, record.last.think === 'off')
        })

        button.addEventListener('click', function () {
          if (!record.modelId || !record.last.writable) return
          var ref = lookupRef(record.modelId, record.modelName)
          if (!ref) {
            setModelStatus(record.route, record.modelId, 'warn', t('bmc.ref.none'))
            scheduleSync()
            return
          }
          queueFill(record.route, record.modelId, ref)
        })

        select.addEventListener('change', function () {
          if (!record.modelId || !record.last.writable) return
          if (select.value === record.last.api) return
          queueMove(record.route, record.modelId, select.value)
        })

        return record
      }

      /** Write only what differs — a no-op pass makes no mutation. */
      function paint(record, view, status) {
        var last = record.last
        var disabled = !view.writable
        if (last.disabled !== disabled) {
          record.select.disabled = disabled
          record.v1.disabled = disabled
          last.disabled = disabled
        }
        // 等级预设接管时，粗开关只显示状态、不可操作（用户定义：细粒度控制替代它）。
        var thinkDisabled = disabled || view.think === 'preset'
        if (last.thinkDisabled !== thinkDisabled) {
          record.think.disabled = thinkDisabled
          last.thinkDisabled = thinkDisabled
        }
        last.writable = view.writable
        if (last.think !== view.think) {
          record.think.setAttribute('aria-checked', view.think === 'off' ? 'false' : 'true')
          last.think = view.think
        }
        if (last.thinkTitle !== view.thinkTitle) {
          record.think.title = view.thinkTitle
          last.thinkTitle = view.thinkTitle
        }
        if (last.api !== view.api) {
          if (view.api !== '') record.select.value = view.api
          last.api = view.api
        }
        if (last.fillDisabled !== !view.fillAvailable) {
          record.button.disabled = !view.fillAvailable
          last.fillDisabled = !view.fillAvailable
        }
        if (last.fillTitle !== view.fillTitle) {
          record.button.title = view.fillTitle === '' ? t('bmc.fill.hint') : t('bmc.fill.hint') + ' ' + view.fillTitle
          last.fillTitle = view.fillTitle
        }
        var v1Fix = view.v1
        var v1Hidden = !v1Fix
        if (last.v1Hidden !== v1Hidden) {
          record.v1.hidden = v1Hidden
          last.v1Hidden = v1Hidden
        }
        var v1Title = v1Fix ? view.v1Title : ''
        if (last.v1Title !== v1Title) {
          record.v1.title = v1Title
          record.v1.setAttribute('aria-label', v1Title)
          last.v1Title = v1Title
        }
        last.v1 = v1Fix
        if (last.price !== view.price) {
          record.price.textContent = view.price
          record.price.hidden = view.price === ''
          last.price = view.price
        }
        var stateText = status ? status.message : ''
        var stateTone = status ? status.tone : ''
        if (last.stateText !== stateText) {
          record.state.textContent = stateText
          record.state.hidden = stateText === ''
          last.stateText = stateText
        }
        if (last.stateTone !== stateTone) {
          record.state.setAttribute('data-tone', stateTone)
          last.stateTone = stateTone
        }
      }

      function lookupRef(modelId, modelName) {
        if (!refState.lookup) return null
        return refState.lookup[bmcKey(modelId)] || (modelName ? refState.lookup[bmcKey(modelName)] : null) || null
      }

      function enabled() {
        try {
          var own = ctx.configForms.get(NS_BMC).getSnapshot()
          return !own || own.status !== 'ready' || !own.value || own.value.enabled !== false
        } catch (error) {
          return true
        }
      }

      function dropStrips() {
        for (var i = 0; i < strips.length; i++) {
          var el = strips[i].el
          if (el.parentNode) el.parentNode.removeChild(el)
        }
        strips = []
      }

      /**
       * Bring every expanded model row in the official editor up to date.
       * Idempotent: it creates one strip per panel, reuses it afterwards, and
       * writes a field only when the value changed.
       */
      function sync() {
        if (disposed) return
        if (typeof document === 'undefined' || !document.body) return
        if (!enabled()) {
          dropStrips()
          return
        }
        var snapshot = freshSnapshot()
        // A settings reload (which every write triggers) briefly reports a
        // non-ready snapshot. Painting that would blank and re-enable the strip
        // — visible strobing. Leave the last good state until the form is back.
        if (!snapshot || snapshot.status !== 'ready') return
        var cards = document.querySelectorAll(BMC_CARD_SEL)
        var seen = []
        for (var c = 0; c < cards.length; c++) {
          var stamp = cards[c].querySelector('[' + BMC_STAMP_ATTR + ']')
          if (!stamp) continue
          var route = stamp.getAttribute(BMC_STAMP_ATTR)
          if (!route) continue
          var rows = cards[c].querySelectorAll(BMC_ROW_SEL)
          for (var r = 0; r < rows.length; r++) {
            var panel = rows[r].querySelector(BMC_ADVANCED_SEL)
            if (!panel) continue
            var inputs = rows[r].querySelectorAll('input')
            var modelId = inputs.length > 0 && inputs[0].value ? String(inputs[0].value).trim() : ''
            var modelName = inputs.length > 1 && inputs[1].value ? String(inputs[1].value).trim() : ''
            if (modelId === '') continue
            var record = null
            for (var s = 0; s < strips.length; s++) if (strips[s].panel === panel) record = strips[s]
            if (record === null) {
              record = stripRecord()
              record.panel = panel
              strips.push(record)
            }
            // Re-assert the SAME element. React may drop it while re-rendering
            // the panel; re-appending the existing node keeps the select, the
            // button and their listeners (no destroy/recreate churn), and keeps
            // it after the official fields React just inserted.
            if (record.el.parentNode !== panel || panel.lastElementChild !== record.el) {
              panel.appendChild(record.el)
            }
            record.route = route
            record.modelId = modelId
            record.modelName = modelName
            var ref = lookupRef(modelId, modelName)
            paint(record, bmcStripModel(snapshot, route, modelId, ref), modelStatusOf(route, modelId))
            seen.push(record)
          }
        }
        // Drop a strip only when its panel really left the document (the model
        // row was collapsed or the editor closed). A single scan that misses a
        // still-connected panel must NOT destroy and rebuild the strip: that
        // destroy/recreate churn is what makes the list jump and strobe.
        var gone = strips.filter(function (item) {
          return seen.indexOf(item) < 0 && (!item.panel || !item.panel.isConnected)
        })
        for (var g = 0; g < gone.length; g++) {
          if (gone[g].el.parentNode) gone[g].el.parentNode.removeChild(gone[g].el)
        }
        if (gone.length > 0) {
          strips = strips.filter(function (item) {
            return gone.indexOf(item) < 0
          })
        }
      }

      /** One guarded pass; the only entry point that touches the DOM. */
      function tick() {
        if (disposed || syncing) return
        syncing = true
        try {
          sync()
        } catch (error) {
        } finally {
          syncing = false
        }
      }

      /** Immediate pass after an action (the poll catches everything else). */
      function scheduleSync() {
        if (disposed || typeof window === 'undefined') return
        if (timer !== null) return
        timer = window.setTimeout(function () {
          timer = null
          tick()
        }, 60)
      }

      // ------------------------------------------------------- lifecycle

      function setStatus(route, tone, message) {
        setRouteStatus(route, tone, message)
      }

      function start() {
        if (typeof document === 'undefined' || !document.body) return
        upsertStyle(BMC_STYLE_ID, BMC_CSS)
        // The reference table feeds the per-model strip, so it loads with the
        // patcher, not with the (invisible) route card.
        loadReference()
        // 1.4.16: a slow poll instead of a document-wide MutationObserver.
        // The observer fired on every chat token, every keystroke and every
        // React commit; each firing queued a full scan, and the scan's own
        // writes queued the next one. That is the jitter/频闪 the user saw.
        if (poll === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
          poll = window.setInterval(function () {
            tick()
          }, 200)
        }
        scheduleSync()
      }

      function stopPoll() {
        if (poll !== null && typeof window !== 'undefined') {
          window.clearInterval(poll)
          poll = null
        }
        if (timer !== null && typeof window !== 'undefined') {
          window.clearTimeout(timer)
          timer = null
        }
      }

      /**
       * Undo start() without retiring the singleton: stop the poll, remove every
       * strip and the stylesheet. Called when the Host stops serving the row, so
       * a disabled component leaves nothing behind (and start() can run again).
       */
      function stop() {
        stopPoll()
        dropStrips()
        queue = Object.create(null)
        try {
          var styleEl = typeof document !== 'undefined' && document.getElementById ? document.getElementById(BMC_STYLE_ID) : null
          if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
        } catch (error) {}
      }

      function dispose() {
        disposed = true
        stopPoll()
        dropStrips()
        queue = Object.create(null)
      }

      return {
        loadReference: loadReference,
        onStatus: onStatus,
        status: status,
        setStatus: setStatus,
        modelStatus: modelStatusOf,
        reference: function () {
          return refState
        },
        lookupRef: lookupRef,
        queueFill: queueFill,
        queueUrl: queueUrl,
        queueMove: queueMove,
        start: start,
        stop: stop,
        sync: sync,
        flush: flush,
        dispose: dispose,
      }
    }

    function getBmcPatcher(ctx) {
      if (!bmcPatcherInstance) bmcPatcherInstance = makeBmcPatcher(ctx)
      return bmcPatcherInstance
    }

    // ---------------------------------------------- route-level slot card
    //
    // React, official provider-card slot (`settings.models.provider-card`).
    // The seat renders ABOVE the official editor, so anything visible here
    // would show up before the user expands a model. The slot therefore
    // carries a single `display:none` route anchor for the row patcher and
    // nothing else (1.4.15). No banner, no status line, no spacing.

    function makeBmcRouteCard(ctx, patcher) {
      return function BmcRouteCard(props) {
        var route = props.provider && props.provider.provider
        if (typeof route !== 'string' || route === '') return null
        // Inline `display:none` as well as the class rule: the card is a flex
        // column with a 12px gap, so even one empty block child would push the
        // provider head away from the editor until the stylesheet lands.
        return React.createElement('div', { className: 'dshp-bmc-stamp', style: { display: 'none' }, 'data-dshp-bmc-route': route })
      }
    }

    // ---------------------------------------------------------- row page

    var BMC_FIELDS = [
      {
        key: 'enabled',
        kind: 'boolean',
        label: t('bmc.enabled.label'),
        hint: t('bmc.enabled.hint'),
        fallback: BMC_DEFAULTS.enabled,
      },
    ]

    function BetterModelConfigPage(props) {
      var form = props.form
      if (props.view === 'summary') {
        return React.createElement(
          'span',
          null,
          summaryFrom(form, function (value) {
            return summaryLine([onOff(value.enabled !== false), t('bmc.summary.where') + ' \u00b7 v' + BMC_BUILD])
          }),
        )
      }
      return React.createElement(SettingsForm, { form: form, fields: BMC_FIELDS, coerce: coerceHistory })
    }
