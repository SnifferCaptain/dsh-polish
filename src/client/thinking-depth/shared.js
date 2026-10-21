    // ------------------ component B: the shipped effort row, as a slider

    /**
     * The shipped model seat owns `conversation.input.model` (a `single` slot
     * where the first registrant wins), so its panel cannot be replaced from the
     * outside — and it should not be: the panel is already there. What this
     * component does instead is lay a slider into the shipped panel's own
     * 推理等级 row, in place of its drill-in list. Only that row is touched.
     */
    // Track = a pill that wraps the knob: height 2r + 2s, ends are semicircles
    // of radius r + s. It spans the full width, so an end stop's centre sits
    // r + s from a wall and its rim leaves exactly s of wall. The fill grows
    // from the left wall to the knob. All px below come from constants.js.
    //
    // The shape declarations carry `!important` on purpose: this slider is
    // injected into the shipped model panel, whose theme sets border-radius on
    // menu-item spans (a higher-specificity rule than one bare class). Without
    // `!important` the host flattens the pill/circle to a square. Only the
    // JS-driven properties (fill width/colour, knob left/shadow, stop left) are
    // left for inline styles to own.
    var DEPTH_CSS = [
      '.dshp-eff-slider { position: relative; box-sizing: border-box; width: 100%; height: ' + TRACK_H + 'px; cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }',
      '.dshp-eff-slider:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 3px; }',
      '.dshp-eff-slider[aria-disabled="true"] { cursor: default; opacity: .5; }',
      '.dshp-eff-slider[data-dshp-state="error"] .dshp-eff-ghost { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-state-error-primary); }',
      '.dshp-eff-ghost { position: absolute; left: 0 !important; right: 0 !important; top: 50% !important; height: ' + TRACK_H + 'px !important; margin-top: -' + TRACK_H / 2 + 'px !important; border-radius: ' + INSET + 'px !important; background-color: var(--dsw-alias-bg-layer-2) !important; background-repeat: no-repeat; background-size: 100% 100%; }',
      '.dshp-eff-fill { position: absolute; left: 0 !important; top: 50% !important; height: ' + TRACK_H + 'px !important; margin-top: -' + TRACK_H / 2 + 'px !important; border-radius: ' + INSET + 'px !important; }',
      '.dshp-eff-stop { position: absolute; top: 50% !important; width: 5px !important; height: 5px !important; margin: -2.5px 0 0 -2.5px !important; border-radius: 50% !important; background: rgba(255,255,255,.72) !important; pointer-events: none; }',
      '.dshp-eff-knob { position: absolute; top: 50% !important; width: ' + KNOB_R * 2 + 'px !important; height: ' + KNOB_R * 2 + 'px !important; margin-top: -' + KNOB_R + 'px !important; transform: translateX(-50%) !important; border-radius: 50% !important; background: #fff !important; pointer-events: none; box-shadow: 0 1px 4px rgba(0,0,0,.35); }',
      '.dshp-eff-value { min-width: 0; overflow: hidden; white-space: nowrap; text-align: right; text-overflow: ellipsis; line-height: ' + KNOB_R * 2 + 'px; }',
      // A drag must track the pointer exactly and paints every move itself, so
      // no CSS transition may fight it. Programmatic moves run through
      // `glideTo`, which paints every animation frame itself for the same
      // reason: the colour travels with the knob instead of jumping stops.
    ].join('\n')

    /** Presentation options of the injected slider, shared across sessions. */
    var depthConfigStore = createStore(DEPTH_DEFAULTS)
    /**
     * What the patcher last saw, for the row's summary line: how many panels
     * are open, how many carry the slider, and why the last one was left
     * alone. Updated only on change, so the summary's own re-render cannot
     * reschedule the scan that feeds it.
     */
    var patcherStatsStore = createStore({ panels: 0, claimed: 0, skip: '' })
    var SKIP_TEXT = {
      'no-session': '会话对不上',
      'no-entry': '占位未挂载',
      disabled: '行开关已关',
      'single-row': '只有模型行',
      'not-effort': '不是推理等级行',
    }
    function setPatcherStats(next) {
      var prev = patcherStatsStore.get()
      if (prev.panels === next.panels && prev.claimed === next.claimed && prev.skip === next.skip) return
      patcherStatsStore.set(next)
    }

    function hexOf(rgb) {
      var parts = []
      for (var i = 0; i < rgb.length; i++) {
        var value = Math.round(rgb[i])
        if (value < 0) value = 0
        if (value > 255) value = 255
        var text = value.toString(16)
        parts.push(text.length === 1 ? '0' + text : text)
      }
      return '#' + parts.join('')
    }

    function mixRgb(from, to, t) {
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
    }

    function rampAt(ramp, t) {
      var clamped = t < 0 ? 0 : t > 1 ? 1 : t
      var span = 1 / (ramp.length - 1)
      var index = Math.min(ramp.length - 2, Math.floor(clamped / span))
      var local = (clamped - index * span) / span
      return hexOf(mixRgb(ramp[index], ramp[index + 1], local))
    }

    function isNeutralEffort(id) {
      return NEUTRAL_EFFORTS.indexOf(String(id === undefined || id === null ? '' : id).toLowerCase()) >= 0
    }

    /** One colour per declared effort: neutral grey for "off", else the ramp. */
    function effortColors(efforts, paletteId) {
      var ramp = DEPTH_PALETTES[paletteId] === undefined ? DEPTH_PALETTES['blue-purple'] : DEPTH_PALETTES[paletteId]
      var colors = []
      var live = []
      for (var i = 0; i < efforts.length; i++) {
        if (efforts[i].providerDefault === true || isNeutralEffort(efforts[i].id)) colors.push(NEUTRAL_COLOR)
        else {
          colors.push(NEUTRAL_COLOR)
          live.push(i)
        }
      }
      for (var j = 0; j < live.length; j++) {
        colors[live[j]] = rampAt(ramp, live.length === 1 ? 1 : j / (live.length - 1))
      }
      return colors
    }

    /**
     * The ramp as resolved RGB triples, parallel to `colors`: the fill and the
     * value name sample it continuously (per pointer, per animation frame), so
     * the colour travels with the knob instead of jumping between stops.
     */
    function effortTriples(efforts, paletteId) {
      var ramp = DEPTH_PALETTES[paletteId] === undefined ? DEPTH_PALETTES['blue-purple'] : DEPTH_PALETTES[paletteId]
      var triples = []
      var live = []
      for (var i = 0; i < efforts.length; i++) {
        if (efforts[i].providerDefault === true || isNeutralEffort(efforts[i].id)) triples.push(NEUTRAL_RGB)
        else {
          triples.push(NEUTRAL_RGB)
          live.push(i)
        }
      }
      for (var j = 0; j < live.length; j++) {
        var t = live.length === 1 ? 1 : j / (live.length - 1)
        var span = 1 / (ramp.length - 1)
        var index = Math.min(ramp.length - 2, Math.floor(t / span))
        var local = (t - index * span) / span
        triples[live[j]] = mixRgb(ramp[index], ramp[index + 1], local)
      }
      return triples
    }

    /** Sample the lane position `t` (0..1) as a hex colour, continuously. */
    function sampleLane(triples, t) {
      if (triples.length === 0) return '#ffffff'
      if (triples.length === 1) return hexOf(triples[0])
      var clamped = t < 0 ? 0 : t > 1 ? 1 : t
      var scaled = clamped * (triples.length - 1)
      var index = Math.min(triples.length - 2, Math.floor(scaled))
      return hexOf(mixRgb(triples[index], triples[index + 1], scaled - index))
    }

    function trackGradient(colors) {
      if (colors.length === 0) return 'transparent'
      if (colors.length === 1) return colors[0]
      var stops = []
      for (var i = 0; i < colors.length; i++) {
        stops.push(colors[i] + ' ' + Math.round((i / (colors.length - 1)) * 100) + '%')
      }
      return 'linear-gradient(90deg, ' + stops.join(', ') + ')'
    }

    function colorOf(entry, at) {
      return entry.colors[at] === undefined ? '#ffffff' : entry.colors[at]
    }

    /** A minimal observable store; the React side reads it through `useStore`. */
    function createStore(initial) {
      var value = initial
      var listeners = new Set()
      return {
        get: function () {
          return value
        },
        set: function (next) {
          value = next
          listeners.forEach(function (listener) {
            listener(next)
          })
        },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        },
      }
    }

    function useStore(store) {
      var pair = React.useState(store.get())
      React.useEffect(
        function () {
          return store.subscribe(function (next) {
            pair[1](next)
          })
        },
        [store],
      )
      return pair[0]
    }

    /**
     * The durable per-session model selection, as the shipped model selector
     * itself reads it: the `modelSelection` session projection holds
     * `{ lastUsed, next }` where `next = pending ?? lastUsed`, so this is the
     * selection that will be used by the next prompt — whether it was made here
     * or in DSH's own selector.
     */
    function selectProjection(value) {
      if (value === undefined || value === null) return null
      var chosen = value.next === undefined || value.next === null ? value.lastUsed : value.next
      return chosen === undefined || chosen === null ? null : chosen
    }

    function sameSelection(left, right) {
      if (left === right) return true
      if (left === null || left === undefined || right === null || right === undefined) return false
      return left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
    }

    /** A session-scoped slot always passes `useProjection`; stay safe if not. */
    function useNoProjection() {
      return undefined
    }

    function findRoute(routes, provider, model) {
      for (var i = 0; i < routes.length; i++) {
        if (routes[i].provider === provider && routes[i].model === model) return routes[i]
      }
      return null
    }

    /**
     * Session model/effort bridge over the two documented session remotes:
     *
     *   ctx.remote.session.modelCatalog()
     *     -> { default: {provider, model, reasoningEffort?},
     *          routableProviders, groups: [{id, name, models: [{id, name,
     *          reasoning?: {efforts: [{id, name}], defaultEffort?}}]}], failures }
     *   ctx.remote.session.selectModel({sessionId, provider, model, reasoningEffort?})
     *     -> { selected: {provider, model, reasoningEffort?} }
     *
     * Reading the *current* selection does not go through this catalog at all:
     * the durable per-session `modelSelection` projection (read with
     * `useProjection`, exactly like the shipped model selector) is the source of
     * truth, so a model or effort changed anywhere — here or in DSH's own
     * selector — shows up here. The catalog only supplies the routes and the
     * per-model effort levels.
     *
     * `select` never throws on business failure: it resolves to a
     * `RemoteResult`. `session/writer-held` means another DSH instance owns the
     * session, which is worth saying out loud rather than showing as a mystery
     * error.
     */
    function createModelBridge(childCtx, sessionId) {
      var store = createStore({
        status: 'loading',
        error: null,
        submitting: false,
        routes: [],
        defaultSelection: null,
        pending: null,
      })
      var disposers = []
      var generation = 0

      function sync(patch) {
        store.set(Object.assign({}, store.get(), patch))
      }

      function routesOf(catalog) {
        var routes = []
        var groups = catalog.groups === undefined || catalog.groups === null ? [] : catalog.groups
        for (var i = 0; i < groups.length; i++) {
          var group = groups[i]
          var models = group.models === undefined ? [] : group.models
          for (var j = 0; j < models.length; j++) {
            routes.push({
              provider: group.id,
              groupName: group.name,
              model: models[j].id,
              name: models[j].name,
              description: models[j].description,
              reasoning: models[j].reasoning,
            })
          }
        }
        return routes
      }

      function fail(message) {
        sync({ status: store.get().status === 'ready' ? 'ready' : 'error', error: message, submitting: false })
      }

      /** Turn a `RemoteResult` failure into something worth reading. */
      function failureText(response) {
        var error = response === null || response === undefined ? null : response.error
        if (error === null || error === undefined) return '切换失败'
        if (error.code === 'session/writer-held') return error.message + '（该会话被另一个 DSH 实例占用，请先退出其它实例）'
        return error.message
      }

      function load() {
        var at = ++generation
        var previous = store.get()
        sync({ status: previous.status === 'ready' ? 'ready' : 'loading', error: null })
        var call
        try {
          call = childCtx.remote.session.modelCatalog()
        } catch (error) {
          fail(String(error))
          return Promise.resolve(false)
        }
        return Promise.resolve(call).then(
          function (response) {
            if (at !== generation) return false
            if (!response || response.ok !== true) {
              fail(failureText(response))
              return false
            }
            var catalog = response.value
            var fallback = catalog.default
            sync({
              status: 'ready',
              error: null,
              submitting: false,
              routes: routesOf(catalog),
              defaultSelection:
                fallback === undefined || fallback === null
                  ? null
                  : {
                      provider: fallback.provider,
                      model: fallback.model,
                      reasoningEffort: fallback.reasoningEffort,
                    },
            })
            return true
          },
          function (error) {
            if (at === generation) fail(String(error))
            return false
          },
        )
      }

      /**
       * Submit a selection. It is kept as `pending` until the durable
       * projection reports it back, so the control feels immediate without ever
       * inventing a state the Host did not accept.
       */
      function select(provider, model, effort) {
        var at = ++generation
        var selection = { provider: provider, model: model }
        if (effort !== undefined) selection.reasoningEffort = effort
        sync({ submitting: true, error: null, pending: selection })
        var payload = { sessionId: sessionId, provider: provider, model: model }
        if (effort !== undefined) payload.reasoningEffort = effort
        var call
        try {
          call = childCtx.remote.session.selectModel(payload)
        } catch (error) {
          sync({ submitting: false, error: String(error), pending: null })
          return Promise.resolve(false)
        }
        return Promise.resolve(call).then(
          function (response) {
            if (at !== generation) return false
            if (!response || response.ok !== true) {
              sync({ submitting: false, pending: null, error: failureText(response) })
              return false
            }
            sync({ status: 'ready', submitting: false, error: null })
            return true
          },
          function (error) {
            if (at === generation) sync({ submitting: false, pending: null, error: String(error) })
            return false
          },
        )
      }

      /** Drop the optimistic overlay once the projection agrees with it. */
      function confirm(projected) {
        var pending = store.get().pending
        if (pending === null || projected === null || projected === undefined) return
        if (projected.provider !== pending.provider || projected.model !== pending.model) return
        if (pending.reasoningEffort !== undefined && projected.reasoningEffort !== pending.reasoningEffort) return
        sync({ pending: null, submitting: false })
      }

      function start() {
        load()
        var remote = childCtx.remote
        if (remote && typeof remote.$on === 'function') {
          disposers.push(remote.$on('llm/adapters-updated', load))
          disposers.push(remote.$on('settings/document-updated', load))
        }
        if (typeof childCtx.on === 'function') {
          disposers.push(
            childCtx.on('connection/reset', function () {
              generation += 1
              load()
            }),
          )
        }
      }

      function stop() {
        while (disposers.length > 0) {
          var dispose = disposers.pop()
          try {
            dispose()
          } catch (error) {
            /* the owning fiber is going away anyway */
          }
        }
      }

      return { store: store, start: start, stop: stop, load: load, select: select, confirm: confirm }
    }

    /**
     * Session-scoped state behind the injected slider.
     *
     * A session-scoped slot (`conversation.input.right`, a `list` seat with no
     * replace risk) hands an occupant its `sessionId`, the durable
     * `modelSelection` projection and the standard session hooks, so a headless
     * occupant that renders nothing is enough to know the live model and effort
     * — and to publish that for the DOM patch below. It is also how the slider
     * learns which session an open panel belongs to.
     */
    var sessionRegistry = {
      map: new Map(),
      listeners: new Set(),
      get: function (sessionId) {
        return sessionRegistry.map.get(sessionId)
      },
      publish: function (sessionId, api) {
        sessionRegistry.map.set(sessionId, api)
        sessionRegistry.notify()
      },
      forget: function (sessionId) {
        // Unconditional: the entry belongs to whatever render published last,
        // and an unmounted session must not keep a stale one alive.
        sessionRegistry.map.delete(sessionId)
        sessionRegistry.notify()
      },
      notify: function () {
        sessionRegistry.listeners.forEach(function (listener) {
          listener()
        })
      },
      subscribe: function (listener) {
        sessionRegistry.listeners.add(listener)
        return function () {
          sessionRegistry.listeners.delete(listener)
        }
      },
    }

    /** Renders nothing visible; it exists to hold session hooks. */
    function makeSessionContext(childCtx) {
      return function SessionContext(props) {
        var sessionId = props.sessionId
        var config = useStore(depthConfigStore)
        var bridge = React.useMemo(
          function () {
            return createModelBridge(childCtx, sessionId)
          },
          [sessionId],
        )
        var snapshot = useStore(bridge.store)
        var useProjection = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
        var projected = useProjection('modelSelection', selectProjection, sameSelection)

        React.useEffect(
          function () {
            bridge.start()
            return function () {
              bridge.stop()
            }
          },
          [bridge],
        )
        // Retire the optimistic overlay as soon as the Host's own state agrees.
        React.useEffect(
          function () {
            if (snapshot.pending !== null) bridge.confirm(projected)
          },
          [bridge, projected, snapshot.pending],
        )

        var selection =
          snapshot.pending !== null
            ? snapshot.pending
            : projected !== null && projected !== undefined
              ? projected
              : snapshot.defaultSelection
        var provider = selection === null || selection === undefined ? null : selection.provider
        var model = selection === null || selection === undefined ? null : selection.model
        var route = findRoute(snapshot.routes, provider, model)
        var reasoning = route !== null && route.reasoning !== undefined && route.reasoning !== null ? route.reasoning : null
        var declaredEfforts = reasoning !== null && Array.isArray(reasoning.efforts) ? reasoning.efforts : []
        // Codex can expose named levels without a declared default. Preserve
        // its native Provider default as an explicit first stop; selecting it
        // clears reasoningEffort instead of guessing medium/high.
        var hasProviderDefault = reasoning !== null && reasoning.defaultEffort === undefined && declaredEfforts.length > 0
        var efforts = hasProviderDefault ? [{ id: undefined, name: '默认', providerDefault: true }].concat(declaredEfforts) : declaredEfforts
        var colors = effortColors(efforts, config.palette)
        var triples = effortTriples(efforts, config.palette)
        var wanted = selection === null || selection === undefined ? undefined : selection.reasoningEffort

        var index = -1
        for (var i = 0; i < efforts.length; i++) {
          if (wanted !== undefined && efforts[i].id === wanted) index = i
        }
        if (index < 0 && route !== null && route.reasoning !== undefined && route.reasoning !== null) {
          for (var j = 0; j < efforts.length; j++) {
            if (efforts[j].id === route.reasoning.defaultEffort) index = j
          }
        }
        if (index < 0) index = 0

        var api = {
          sessionId: sessionId,
          // The row switch is the component switch; hooks cannot be skipped, so
          // a disabled occupant still publishes — and is ignored as disabled.
          enabled: config.showInComposer !== false,
          labels: config.labels !== false,
          status: snapshot.status,
          error: snapshot.error,
          submitting: snapshot.submitting,
          efforts: efforts,
          colors: colors,
          triples: triples,
          index: index,
          commit: function (nextIndex) {
            var picked = efforts[nextIndex]
            if (picked === undefined) return
            // Same call the shipped panel makes for this row.
            bridge.select(provider, model, picked.providerDefault === true ? undefined : picked.id)
          },
        }

        React.useLayoutEffect(function () {
          sessionRegistry.publish(sessionId, api)
        })
        React.useEffect(
          function () {
            return function () {
              sessionRegistry.forget(sessionId)
            }
          },
          [sessionId],
        )

        if (config.showInComposer === false) return null
        // The anchor is found by attribute, so it must never take part in the
        // composer's flex layout: `display: none` inline, because `[hidden]`
        // alone loses to any author rule that targets the composer's spans.
        return React.createElement('span', { 'data-dshp-session': sessionId, hidden: true, style: { display: 'none' } })
      }
    }

