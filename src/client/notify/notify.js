    // ------------------------------------------------- notify (component E)
    //
    // Alerts the user when the *viewed* session needs their attention or a turn
    // finishes. Detection reads the session's durable log (the same page/projections
    // path the thinking-time engine uses, via the always-on session-capture
    // registry), so it needs no fragile remote-event waterfall tap and no UI-internal
    // store. The two triggers:
    //   * completion — a `turn/end` whose reason.kind is `completed`;
    //   * attention  — `approval/asked`, or a `tool/call` for `ask_user_question`
    //                  (question) / `exit_plan_mode` (plan-review): the model is
    //                  waiting on the user.
    // Each of the two triggers independently drives a synthesized Web-Audio chime
    // and a Web-Notification system toast (four independent toggles, all off by
    // default). No in-UI overlay is injected; the toast is an OS-level notification.

    var NOTIFY_POLL_MS = 1000
    var NOTIFY_PAGE_MAX = 400

    var notifyStatsStore = createStore({
      sessions: 0,
      lastComplete: '',
      lastAttention: '',
      lastAttentionKind: '',
      permission: 'unknown',
      lastTest: '',
      error: '',
    })

    function setNotifyStats(patch) {
      try {
        notifyStatsStore.set(Object.assign({}, notifyStatsStore.get(), patch))
      } catch (error) {
        /* the store may be torn down mid-shutdown; stats are cosmetic */
      }
    }

    // ---- synthesized chime (Web Audio) -------------------------------------
    //
    // No bundled asset: a short sine is generated on demand. The AudioContext is
    // created lazily on the first play (which happens only after the user has
    // enabled a toggle, i.e. after an interaction), satisfying the autoplay
    // policy. In a test/Node context neither `window` nor `AudioContext` exists,
    // so every step is guarded and the no-op path is the expected one there.

    var notifyAudioCtx = null
    function notifyAudio() {
      if (notifyAudioCtx) return notifyAudioCtx
      var AC = null
      try {
        if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
          AC = window.AudioContext || window.webkitAudioContext
        } else if (typeof AudioContext !== 'undefined') {
          AC = AudioContext
        }
      } catch (error) {
        AC = null
      }
      if (!AC) return null
      try {
        notifyAudioCtx = new AC()
      } catch (error) {
        notifyAudioCtx = null
      }
      return notifyAudioCtx
    }

    function notifyTone(freqStart, freqEnd, durationSec, gain, delayMs) {
      var ctx = notifyAudio()
      if (!ctx) return
      try {
        if (ctx.state === 'suspended') {
          try {
            ctx.resume()
          } catch (error) {
            /* best-effort; the tone is scheduled regardless */
          }
        }
        var start = ctx.currentTime + (delayMs ? delayMs / 1000 : 0)
        var osc = ctx.createOscillator()
        var g = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(freqStart, start)
        if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(freqEnd, start + durationSec)
        g.gain.setValueAtTime(0.0001, start)
        g.gain.exponentialRampToValueAtTime(gain, start + 0.02)
        g.gain.exponentialRampToValueAtTime(0.0001, start + durationSec)
        osc.connect(g)
        g.connect(ctx.destination)
        osc.start(start)
        osc.stop(start + durationSec + 0.05)
      } catch (error) {
        /* a missing/blocked audio device must never break the plugin */
      }
    }

    /** A rising single "ding" — a turn finished. */
    function playCompletionSound() {
      notifyTone(880, 1318, 0.34, 0.25, 0)
    }

    /** Two short ascending beeps — the model is waiting on you. */
    function playAttentionSound() {
      notifyTone(587, 587, 0.13, 0.25, 0)
      notifyTone(784, 784, 0.2, 0.25, 190)
    }

    // ---- system notification (Web Notification) ---------------------------
    //
    // An OS-level toast, deliberately NOT an in-UI overlay. `silent: true` because
    // the audible part is the separate Web-Audio chime (independently toggleable).
    // Requires the OS notification permission, requested on a user gesture (the
    // "test" button); when it is unavailable or denied the call is a no-op and the
    // sound still works on its own.

    function notificationSupported() {
      try {
        return typeof Notification !== 'undefined' && Notification !== null
      } catch (error) {
        return false
      }
    }

    function notificationPermission() {
      if (!notificationSupported()) return 'unsupported'
      try {
        return Notification.permission || 'unknown'
      } catch (error) {
        return 'unknown'
      }
    }

    function requestNotificationPermission() {
      if (!notificationSupported()) return Promise.resolve('unsupported')
      try {
        if (Notification.permission === 'granted') return Promise.resolve('granted')
        if (Notification.permission === 'denied') return Promise.resolve('denied')
        var p = Notification.requestPermission()
        if (p && typeof p.then === 'function') {
          return p.then(
            function (perm) {
              setNotifyStats({ permission: perm })
              return perm
            },
            function () {
              return notificationPermission()
            },
          )
        }
        return Promise.resolve(notificationPermission())
      } catch (error) {
        return Promise.resolve('unsupported')
      }
    }

    function showSystemNotification(title, body, tag) {
      if (!notificationSupported() || Notification.permission !== 'granted') return false
      try {
        var n = new Notification(title, { body: body, tag: tag, silent: true, requireInteraction: true })
        try {
          n.onclick = function () {
            try {
              if (typeof window !== 'undefined' && typeof window.focus === 'function') window.focus()
              n.close()
            } catch (error) {
              /* ignore */
            }
          }
        } catch (error) {
          /* some platforms disallow setting onclick; the toast still shows */
        }
        return true
      } catch (error) {
        return false
      }
    }

    /**
     * Pure classification of one durable session event into a notify action.
     * Self-contained (no outer scope) so the harness can extract + eval it.
     * Returns 'complete', 'attention:<kind>', or null (not a notify event).
     */
    function classifyNotifyEvent(ev) {
      if (!ev || typeof ev.type !== 'string') return null
      if (ev.type === 'turn/end') {
        var reason = ev.data && ev.data.reason
        return reason && reason.kind === 'completed' ? 'complete' : null
      }
      if (ev.type === 'approval/asked') return 'attention:approval'
      if (ev.type === 'tool/call') {
        var name = ev.data && ev.data.name
        if (name === 'ask_user_question') return 'attention:question'
        if (name === 'exit_plan_mode') return 'attention:plan-review'
      }
      return null
    }

    function attentionLabel(kind) {
      if (kind === 'approval') return '需要你的审批'
      if (kind === 'plan-review') return '计划待确认'
      return '模型在提问'
    }

    function attentionBody(kind) {
      if (kind === 'approval') return '有一个操作在等你批准。'
      if (kind === 'plan-review') return '模型提交了计划，等你确认。'
      return '模型有一个问题等你回答。'
    }

    function createNotify() {
      var config = Object.assign({}, NOTIFY_DEFAULTS)
      var active = false
      var started = false
      var timer = null
      var inFlight = false
      var lastSeq = null
      var currentSession = null

      function fireCompletion() {
        var now = new Date().toLocaleTimeString()
        if (config.completeSound) playCompletionSound()
        if (config.completeNotify) showSystemNotification('任务完成', '当前会话的一轮处理完成了，可以查看结果。', 'dshpolish-complete')
        setNotifyStats({ lastComplete: now, error: '' })
      }

      function fireAttention(kind) {
        var now = new Date().toLocaleTimeString()
        if (config.attentionSound) playAttentionSound()
        if (config.attentionNotify) showSystemNotification(attentionLabel(kind), attentionBody(kind), 'dshpolish-attention')
        setNotifyStats({ lastAttention: now, lastAttentionKind: kind, error: '' })
      }

      function handleEvent(ev) {
        var action = classifyNotifyEvent(ev)
        if (action === 'complete') {
          fireCompletion()
          return
        }
        if (action && action.indexOf('attention:') === 0) fireAttention(action.slice(10))
      }

      function poll() {
        if (!active || inFlight) return
        var reg = sessionRegistryGet()
        var session = reg && reg.session
        var sessionId = reg && reg.sessionId
        if (!session || !sessionId) {
          setNotifyStats({ sessions: 0 })
          return
        }
        if (typeof session.projections !== 'function' || typeof session.page !== 'function') return
        // A different viewed session: re-baseline so historical events don't fire.
        if (currentSession !== sessionId) {
          currentSession = sessionId
          lastSeq = null
        }
        inFlight = true
        var address = { kind: 'session', sessionId: sessionId }
        Promise.resolve(session.projections({ sessionId: sessionId }))
          .then(function (projection) {
            var asOf =
              projection &&
              projection.ok === true &&
              projection.value &&
              typeof projection.value.asOfSeq === 'number'
                ? projection.value.asOfSeq
                : 0
            setNotifyStats({ sessions: 1 })
            if (lastSeq === null) {
              lastSeq = asOf
              return null
            }
            if (asOf <= lastSeq) return null
            var prevSeq = lastSeq
            return Promise.resolve(session.page({ address: address, throughSeq: asOf, maxMessages: NOTIFY_PAGE_MAX })).then(
              function (response) {
                lastSeq = asOf
                if (!response || response.ok !== true || !response.value || !response.value.records) return
                var records = response.value.records
                for (var i = 0; i < records.length; i++) {
                  var ev = records[i] && records[i].event
                  if (!ev) continue
                  var seq = typeof ev.seq === 'number' ? ev.seq : 0
                  if (seq > 0 && seq <= prevSeq) continue
                  handleEvent(ev)
                }
              },
            )
          })
          .then(
            function () {
              inFlight = false
            },
            function (error) {
              inFlight = false
              setNotifyStats({ error: String((error && error.message) || error) })
            },
          )
      }

      function start() {
        if (started) return
        if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return
        started = true
        timer = window.setInterval(poll, NOTIFY_POLL_MS)
        poll()
      }

      function stop() {
        if (started && timer !== null) {
          try {
            window.clearInterval(timer)
          } catch (error) {
            /* ignore */
          }
        }
        started = false
        timer = null
        active = false
        inFlight = false
        lastSeq = null
        currentSession = null
      }

      function setConfig(next) {
        config = Object.assign({}, config, next)
        active = !!(config.completeSound || config.completeNotify || config.attentionSound || config.attentionNotify)
      }

      return { start: start, stop: stop, setConfig: setConfig }
    }

    // ---- the "test" action (user gesture): request permission + demo both ----
    function testNotify() {
      requestNotificationPermission()
      playCompletionSound()
      try {
        if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') window.setTimeout(playAttentionSound, 420)
        else setTimeout(playAttentionSound, 420)
      } catch (error) {
        /* ignore */
      }
      var shown = showSystemNotification('dsh-polish 测试', '这是一条测试系统通知；提示音应已先后播放。', 'dshpolish-test')
      setNotifyStats({ lastTest: new Date().toLocaleTimeString() })
      return shown
    }
