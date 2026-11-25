    // ------------------------------------------------- component K (client half)
    // keep-effort sync: per (session, model) memory of the last switched effort.
    //
    // The shipped model selector (dsh-client-ui-model-selection) bakes the new
    // model's own defaultEffort into every model choice and commits it through
    // `remote.session.selectModel` — that is the "jumps to default" the user
    // sees. The durable per-session `modelSelection` projection
    // ({lastUsed, next}, next = pending ?? lastUsed) is the single source of
    // truth both the selector and this component read (the same hook the
    // shipped panel renders from), so no DOM is involved:
    //
    //   * effort switched (same route, effort changed) → persist
    //     effortRecords[session][provider/model] = effort immediately
    //     (configForms.mutate); effort absent — the "provider default" stop —
    //     drops that model's record so a later switch back uses the default.
    //   * model switched (route changed) → if a record exists for the new
    //     route and differs from what the selector just committed, re-select
    //     with it through the same `selectModel` the selector uses. That is a
    //     SURFACE write (the pending selection the next user input assembles),
    //     so it is parked while the agent is running and applied once the turn
    //     ends — see the layering rule below.
    //
    // Storage is the keep-effort row's config (`effortRecords`, volatile),
    // shared with the host-side listener in keep-effort/index.js — a backstop
    // that records the effective effort from requests (agent-preset and other
    // non-UI switches included) at the first request of a turn. Both write the
    // same values, revision-guarded. The row switch is the component switch
    // (whileServed gate below).

    var KEEP_EFFORT_MAX_SESSIONS = 100

    /** `useSession` selector: the exact busy flag the shipped composer reads. */
    function selectRunning(snapshot) {
      return !!(snapshot && snapshot.running)
    }

    /** Session slots always inject `useSession`; stay safe if one does not. */
    function useNoSessionSnapshot() {
      return false
    }

    function makeEffortKeeper(childCtx) {
      return function EffortKeeper(props) {
        var sessionId = props.sessionId
        var useProjection = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
        var useSessionSnapshot = typeof props.useSession === 'function' ? props.useSession : useNoSessionSnapshot
        // Layering rule (1.4.39): keep-effort only adjusts the SURFACE — the
        // effort the next user input will assemble. The shipped model seat is
        // not disabled while the agent loops, but a selection committed then is
        // consumed by the very next `systemPrompt.assemble` (agent-loop
        // preStep(), one assemble per step), so writing it mid-turn retargets
        // the running loop from the inside. The shipped flow never does that to
        // a loop it did not start; neither do we: while `running` the restore is
        // parked and applied once the turn is over.
        var running = useSessionSnapshot(selectRunning) === true
        // The same durable projection the shipped model selector renders —
        // any model/effort change made here or in DSH's own selector lands here.
        var projected = useProjection('modelSelection', selectProjection, sameSelection)

        var formRef = React.useRef(null)
        var recordsRef = React.useRef({})
        var prevRef = React.useRef(null)
        var parkedRef = React.useRef(null)

        // The restore itself: the selector's own call, so the pending selection,
        // the selector UI and the next assembly all converge on the remembered
        // effort. Fail-open: any error leaves the selector's default in place.
        function applyCarry(carry) {
          try {
            childCtx.remote.session.selectModel({
              sessionId: sessionId,
              provider: carry.provider,
              model: carry.model,
              reasoningEffort: carry.effort,
            })
          } catch (error) {
            /* fail-open */
          }
        }

        // Live mirror of effortRecords (host-side writes included): the row's
        // config store is the channel both halves of this component share.
        React.useEffect(
          function () {
            var form = null
            try {
              form = childCtx.configForms.get(NS_KEEP_EFFORT)
            } catch (error) {
              form = null
            }
            formRef.current = form
            if (form === null || form === undefined) return function () {}
            function refresh() {
              try {
                var snap = form.getSnapshot()
                var value = snap && snap.status === 'ready' && snap.value && typeof snap.value === 'object' ? snap.value : {}
                var records = value.effortRecords && typeof value.effortRecords === 'object' ? value.effortRecords : {}
                recordsRef.current = records
              } catch (error) {
                /* keep the last mirror */
              }
            }
            refresh()
            var off = null
            try {
              off = form.subscribe(refresh)
            } catch (error) {
              off = null
            }
            return function () {
              if (typeof off === 'function') off()
            }
          },
          [sessionId],
        )

        // The two spec moments, straight off the projection:
        //   save — the user switched effort (or picked the provider default);
        //   apply — the user switched model and the remembered effort says the
        //           auto-filled default is wrong.
        React.useEffect(
          function () {
            var prev = prevRef.current
            var cur = projected
            if (cur === null || cur === undefined) {
              prevRef.current = null
              return
            }
            // First sight of this session's selection: baseline, no action.
            if (prev === null || prev === undefined) {
              prevRef.current = cur
              return
            }
            var route = cur.provider + '/' + cur.model
            var session = String(sessionId)
            var records = recordsRef.current
            var byModel = records[session]
            var remembered = byModel && typeof byModel === 'object' ? byModel[route] : undefined

            if (prev.provider !== cur.provider || prev.model !== cur.model) {
              // Model switched: the selector just committed the new model with
              // its own defaultEffort. Restore the remembered (session, model)
              // effort — through the same selectModel the selector uses, so the
              // projection, the selector UI and the next assembly agree.
              if (remembered !== undefined && remembered !== cur.reasoningEffort) {
                var carry = { provider: cur.provider, model: cur.model, effort: remembered }
                if (running) {
                  // Surface-only rule: park it until the running turn ends; an
                  // immediate commit would be eaten by the next step's assembly.
                  parkedRef.current = carry
                } else {
                  parkedRef.current = null
                  applyCarry(carry)
                }
              } else {
                parkedRef.current = null
              }
            } else if (cur.reasoningEffort !== prev.reasoningEffort) {
              // Same model, effort changed: the user switched effort (or our
              // own restore landed a moment ago — which is a no-op write,
              // skipped below). Persist immediately.
              //
              // An explicit choice for this route outranks a parked restore:
              // without this, "switch model mid-turn, then pick an effort in
              // the same turn" would be silently overwritten when the turn
              // ends — the exact class of failure this component must not have.
              var parked = parkedRef.current
              if (parked !== null && parked !== undefined && parked.provider === cur.provider && parked.model === cur.model) {
                parkedRef.current = null
              }
              var next = {}
              for (var k in records) next[k] = records[k]
              var model = next[session] === undefined || next[session] === null ? {} : Object.assign({}, next[session])
              if (cur.reasoningEffort === undefined) delete model[route]
              else model[route] = String(cur.reasoningEffort)
              if (Object.keys(model).length > 0) next[session] = model
              else delete next[session]
              // Session recency: re-insert the touched session last.
              var rebuilt = {}
              for (var s2 in next) {
                if (s2 === session) continue
                rebuilt[s2] = next[s2]
              }
              rebuilt[session] = model
              while (Object.keys(rebuilt).length > KEEP_EFFORT_MAX_SESSIONS) {
                for (var oldest in rebuilt) {
                  delete rebuilt[oldest]
                  break
                }
              }
              if (JSON.stringify(rebuilt) === JSON.stringify(records)) {
                prevRef.current = cur
                return
              }
              var attempt = 0
              function write() {
                var form = formRef.current
                if (form === null || form === undefined) return
                try {
                  var snap = form.getSnapshot()
                  if (snap && snap.status === 'unavailable') return
                  var revision = snap && snap.revision !== undefined ? snap.revision : 0
                  Promise.resolve(form.mutate([{ op: 'set', path: ['effortRecords'], value: rebuilt }], revision)).then(
                    function (ok) {
                      if (!ok && attempt === 0) {
                        attempt = 1
                        write()
                      }
                    },
                    function () {
                      if (attempt === 0) {
                        attempt = 1
                        write()
                      }
                    },
                  )
                } catch (error) {
                  if (attempt === 0) {
                    attempt = 1
                    write()
                  }
                }
              }
              write()
            }
            prevRef.current = cur
          },
          [projected, sessionId],
        )

        // Parked restore: the running turn just ended. Apply it now, while the
        // session is idle, so it is part of the pending selection the NEXT user
        // input assembles — the same moment the shipped flow would have applied
        // a user-made switch. Dropped if the route moved on in the meantime.
        React.useEffect(
          function () {
            if (running) return
            var carry = parkedRef.current
            if (carry === null || carry === undefined) return
            parkedRef.current = null
            var cur = prevRef.current
            if (cur === null || cur === undefined) return
            if (cur.provider !== carry.provider || cur.model !== carry.model) return
            if (cur.reasoningEffort === carry.effort) return
            applyCarry(carry)
          },
          [running],
        )

        return null
      }
    }
