    // ------------------------------------------- component A: DOM behaviour

    function createEngine() {
      var config = {
        lines: RENDERER_DEFAULTS.lines,
        collapseMs: RENDERER_DEFAULTS.collapseMs,
        autoOpen: RENDERER_DEFAULTS.autoOpen,
        showTime: RENDERER_DEFAULTS.showTime,
        followMs: RENDERER_DEFAULTS.followMs,
      }
      var active = false
      var styleEl = null
      var states = new WeakMap()
      var trackedBodies = new WeakSet()
      var pending = new Set()
      var raf = 0
      var chases = new Set()
      var observer = null
      var tickTimer = 0

      function stateFor(root) {
        var state = states.get(root)
        if (state === undefined) {
          state = {
            wasRunning: false,
            autoOpened: false,
            manual: false,
            programmatic: false,
            follow: true,
            collapseTimer: 0,
            startedAt: undefined,
            elapsedSec: 0,
            timeEl: null,
            eventStart: 0,
            eventLatest: 0,
            refreshing: false,
            refreshSeq: 0,
            pinnedEls: new WeakSet(),
          }
          states.set(root, state)
        }
        return state
      }

      function disclosureHeader(root) {
        return root.querySelector('[data-disclosure-row]')
      }

      function reasoningBody(root) {
        // The reasoning text is the non-header direct child of DisclosureRow's
        // [data-open] container; class names are hashed, so do not use them.
        // 0.2.1-rc.1 DOM（从运行中 shell 实测）：[data-open] 下第一个直接子元素
        // 是 div[data-disclosure-header] 头包装（data-disclosure-row 在它里面的
        // br.row 上）；0.2.0-rc.2 契约里 data-disclosure-row 直接挂在直接子元素上。
        // 两个属性都跳过，取到的才是正文（thinkBody）。0.4.56 修复：rc.1 下旧逻辑
        // 把头包装当成正文——钉底/滚动监听全打在了 33px 的头包装上（不是滚动
        // 容器，guard 拒绝），而 CSS 裁剪命中的是正文，于是窗口永远钉在顶端。
        var disclosure = root.querySelector(':scope > [data-open]')
        if (disclosure === null) return null
        for (var i = 0; i < disclosure.children.length; i++) {
          var child = disclosure.children[i]
          if (child.hasAttribute('data-disclosure-row')) continue
          if (child.hasAttribute('data-disclosure-header')) continue
          return child
        }
        return null
      }

      function isExpanded(root) {
        if (root.hasAttribute('data-expanded')) return true
        var header = disclosureHeader(root)
        return header !== null && header.getAttribute('aria-expanded') === 'true'
      }

      function clickDisclosure(root, state) {
        var header = disclosureHeader(root)
        if (header === null) return false
        state.programmatic = true
        try {
          header.click()
        } finally {
          queueMicrotask(function () {
            state.programmatic = false
          })
        }
        return true
      }

      // ---- elapsed-time chip (opt-in) -------------------------------------
      //
      // The chip is the model's REAL thinking time. Its START is the current
      // step's begin timestamp, recovered from the session's durable `step/start`
      // event (via the always-on session-capture occupant); its END is the wall
      // clock, so elapsed = now - stepStart. The live reasoning chunks are
      // *transient* (never written to the durable log the page reads), so a pure
      // event-based "latest" is not reachable — but while the model streams, the
      // wall clock is a faithful "latest API activity," and the log-sourced START
      // is what makes the count survive a window/tab switch and a preview opened
      // mid-thought (recovers the real start instead of counting from 0). A
      // wall-clock anchor is kept only as a fallback until the first step/start is
      // read, or when no session is reachable.

      // From a page of session events, the time (ms) of the most recent
      // `step/start` — the current step's start — or null if none present.
      function currentStepStart(events) {
        if (!events || !events.length) return null
        var bestSeq = -1
        var bestTime = null
        for (var i = 0; i < events.length; i++) {
          var ev = events[i]
          if (!ev || ev.type !== 'step/start') continue
          var time = typeof ev.time === 'number' ? ev.time : 0
          if (!time || time <= 0) continue
          var seq = typeof ev.seq === 'number' ? ev.seq : 0
          if (seq > bestSeq) {
            bestSeq = seq
            bestTime = time
          }
        }
        return bestTime
      }

      // Async: read the active session's recent events and store this step's
      // [start, latest] on the state. Guarded so at most one refresh is in flight
      // per row, and a superseded result never overwrites a newer one.
      function refreshTimes(state) {
        var reg = sessionRegistryGet()
        var session = reg && reg.session
        var sessionId = reg && reg.sessionId
        if (!session || !sessionId) return
        if (typeof session.projections !== 'function' || typeof session.page !== 'function') return
        if (state.refreshing) return
        state.refreshing = true
        var seq = (state.refreshSeq = (state.refreshSeq || 0) + 1)
        var address = { kind: 'session', sessionId: sessionId }
        function settle() {
          state.refreshing = false
        }
        function pageWith(throughSeq) {
          return Promise.resolve(
            session.page({ address: address, throughSeq: throughSeq, maxMessages: 500 }),
          ).then(function (response) {
            settle()
            if (state.refreshSeq !== seq) return
            if (!response || response.ok !== true || !response.value || !response.value.records) return
            var events = []
            var records = response.value.records
            for (var i = 0; i < records.length; i++) {
              var ev = records[i] && records[i].event
              if (ev) events.push(ev)
            }
            var start = currentStepStart(events)
            if (start !== null) state.eventStart = start
          })
        }
        Promise.resolve(session.projections({ sessionId: sessionId }))
          .then(function (projection) {
            var asOf =
              projection &&
              projection.ok === true &&
              projection.value &&
              typeof projection.value.asOfSeq === 'number'
                ? projection.value.asOfSeq
                : 0
            return pageWith(asOf)
          })
          .catch(settle)
      }

      function formatSec(s) {
        if (s < 60) return s + 's'
        var m = Math.floor(s / 60)
        var r = s % 60
        return m + ':' + (r < 10 ? '0' + r : String(r))
      }

      // Mount (or re-mount) the chip on the reasoning header. The header is a
      // stable shipped node, unlike the streaming body, so it survives token
      // updates; we re-attach if a re-render dropped it.
      function ensureTimeChip(root, state) {
        if (state.timeEl !== null && state.timeEl.isConnected) return state.timeEl
        var header = disclosureHeader(root)
        if (header === null) {
          state.timeEl = null
          return null
        }
        if (state.timeEl === null) {
          var chip = document.createElement('span')
          chip.className = 'dshp-think-time'
          chip.setAttribute('data-dsh-polish-time', '1')
          state.timeEl = chip
        }
        header.appendChild(state.timeEl)
        return state.timeEl
      }

      // Show the chip only while the preview is open; hidden after collapse.
      function syncTime(root, state, now) {
        if (state.timeEl !== null && state.timeEl.isConnected && !config.showTime) {
          if (state.timeEl.style.display !== 'none') state.timeEl.style.display = 'none'
          return
        }
        if (!config.showTime || state.startedAt === undefined) return
        if (root.getAttribute('data-state') === 'running') {
          if (state.eventStart > 0) {
            // Real thinking time: now minus the current step's durable start
            // (recovered from the log), so it tracks the true elapsed and
            // survives a window/tab switch and a preview opened mid-thought.
            state.elapsedSec = Math.max(0, Math.floor((now - state.eventStart) / 1000))
          } else {
            // No step/start reached yet: wall-clock since we first saw it running.
            state.elapsedSec = Math.max(0, Math.floor((now - state.startedAt) / 1000))
          }
        }
        var chip = ensureTimeChip(root, state)
        if (chip === null) return
        var visible = root.getAttribute(PREVIEW_ATTR) === '1'
        if (chip.style.display !== (visible ? '' : 'none')) chip.style.display = visible ? '' : 'none'
        var text = formatSec(state.elapsedSec)
        if (chip.textContent !== text) chip.textContent = text
      }

      function tick() {
        if (!active) return
        var now = Date.now()
        var roots = document.querySelectorAll('[' + PREVIEW_ATTR + '="1"]')
        for (var i = 0; i < roots.length; i++) {
          var state = stateFor(roots[i])
          // Pull the freshest reasoning-event times for a running row (async),
          // then paint from the last known values in the same pass.
          if (roots[i].getAttribute('data-state') === 'running') refreshTimes(state)
          syncTime(roots[i], state, now)
        }
      }

      // Re-sync the instant the tab is visible again: while backgrounded the
      // interval is throttled, so the chip would otherwise sit at a stale value
      // until the next tick. Catching up on visibility makes the elapsed time
      // track the true turn duration even after a window switch.
      function onVisibility() {
        if (!active) return
        if (typeof document.visibilityState === 'string' && document.visibilityState === 'hidden') return
        tick()
      }

      function removeTimeChips() {
        var chips = document.querySelectorAll('.dshp-think-time')
        for (var i = 0; i < chips.length; i++) chips[i].remove()
      }

      function attachBodyTracking(root, state) {
        var body = reasoningBody(root)
        if (body === null || trackedBodies.has(body)) return body
        trackedBodies.add(body)
        var suspendFollow = function () {
          state.follow = false
        }
        body.addEventListener('wheel', suspendFollow, { passive: true })
        body.addEventListener('touchstart', suspendFollow, { passive: true })
        body.addEventListener('pointerdown', suspendFollow, { passive: true })
        body.addEventListener(
          'scroll',
          function () {
            var distance = body.scrollHeight - body.scrollTop - body.clientHeight
            if (distance <= RESUME_FOLLOW_PX) state.follow = true
          },
          { passive: true },
        )
        return body
      }

      // 0.4.55：程序化钉底必须用 behavior:'instant' 做单帧赋值。Chromium
      // 实测：元素带 CSS 平滑滚动（smooth）时，plain `scrollTop = …` 赋值
      // 不生效（平滑动画被流式更新反复打断，窗口钉死在顶端——用户 0.4.54
      // 反馈的「固定到了顶端」根因）；instant 跳转每帧都生效。缓动完全由
      // 引擎逐帧计算，不借浏览器滚动动画。
      // 0.4.59：钉底改由「跟随时长 t 毫秒」（设置项 followMs，0-2000，默认
      // 300）+ 实时 rAF 追逐环驱动。0.4.57 的「流畅度」是事件驱动——只在
      // 流式内容突变的那一帧推一步，动画节奏被 API 帧率绑架，所以怎么调
      // 都「卡」。0.4.60：移除 prefers-reduced-motion 静默兜底（Windows 11
      // 关闭「动画效果」时 Chromium 报 reduce，会被静默改写成每 chunk 跳一下）。
      // 0.4.61：追逐环语义定型（EMA/pure-pursuit，用户规格：「换行后花 t
      // 时间非线性滚到最下方」）：
      //   next = top + (target - top)·(1 - e^(-dt/τ)),  τ = t/3
      // τ = t/3 ⇒ 落差在约 t 毫秒内收敛到 5%（「花费 t 时间滑到位」）；
      // 目标每帧重测（纯 pursuit，天然追踪移动底部）。两个防抖关键：
      //   a) 收敛后**不停环**，驻留 tail = max(t, 500)ms 内容安静期才停——
      //      突发流（chunk 间隔几百 ms）里环常开，换行的滑移首尾相接，
      //      动画节奏彻底与流式帧率解耦（0.4.59/0.4.60 收敛即停，每行都
      //      是独立小动画 + 重启间隙，用户看到的仍是「一个 chunk 跳一下」）。
      //   b) 元素首次纳入追逐时瞬时钉底（pinnedEls WeakSet 记住）：恢复
      //      0.4.56「打开即钉底」基线，也消除宿主重挂 body 节点时「先露
      //      顶部再滑下去」的闪烁。
      // t=0 → 即时跳底（0.4.55/0.4.56 行为）。
      // 0.4.63：追逐目标 = 「最后一段真实文本的底边」，不是滚动容器的
      //   几何底部（scrollHeight - clientHeight）。用户反馈（0.4.61 装后）：
      //   窗口最终停在「接近倒数第二行的位置」——静态追踪证实环每次都精确
      //   到达几何底部（running 期间每帧都重启追逐，无时序洞），差的那一行
      //   是几何性的：正文末尾的空白结构（空终止段/<br>/margin/padding）
      //   让「几何底」落在最后一行文本下方约一行。文本底边才是用户规格
      //   「滚到最下方那一行」的语义；顺带修掉任何底部 padding/margin 间隙。
      function lastTextNode(el) {
        var last = null
        try {
          var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
          var node
          while ((node = walker.nextNode())) {
            if (node.nodeValue && node.nodeValue.trim() !== '') last = node
          }
        } catch (error) {
          return null
        }
        return last
      }

      // scrollTop that puts the last real text line's bottom edge at the
      // window's bottom edge; null when there is no usable text (caller
      // falls back to the geometric floor). Recomputed only when the
      // container geometry changes (see the chase frame).
      function textFloorTarget(el) {
        var text = lastTextNode(el)
        if (text === null) return null
        try {
          var range = document.createRange()
          range.selectNodeContents(text)
          var rect = range.getBoundingClientRect()
          if (!rect || rect.bottom <= 0) return null
          var elRect = el.getBoundingClientRect()
          var floor = rect.bottom - elRect.top + el.scrollTop
          return Math.max(0, floor - el.clientHeight)
        } catch (error) {
          return null
        }
      }

      function stopChase(entry) {
        if (entry === null || entry === undefined) return
        if (entry.raf) cancelAnimationFrame(entry.raf)
        entry.raf = 0
        chases.delete(entry)
        if (entry.state && entry.state.chase === entry) entry.state.chase = null
      }

      function chaseBottom(root, el, state) {
        if (el === null || !(el instanceof HTMLElement)) return
        // 该元素已有追逐环在跑 —— 直接让它继续（目标每帧重测）
        if (state.chase && state.chase.el === el && state.chase.raf) return
        if (state.chase && state.chase.raf) stopChase(state.chase)
        // 0.4.61：元素首次被追逐 → 瞬时钉底（新挂节点/中途打开 = 恢复
        // 0.4.56「打开即钉底」基线；已钉过的元素继续滑移，不受影响）。
        // 0.4.63：钉底 = 文本底边（无文本才退回几何底）。
        if (!state.pinnedEls.has(el)) {
          state.pinnedEls.add(el)
          if (el.scrollHeight > el.clientHeight) {
            var floor0 = textFloorTarget(el)
            if (floor0 === null) floor0 = el.scrollHeight - el.clientHeight
            try {
              el.scrollTo({ top: floor0, behavior: 'instant' })
            } catch (error) {
              el.scrollTop = floor0
            }
          }
        }
        var entry = { el: el, state: state, raf: 0, lastAt: 0, lastTarget: -1, lastGrowthAt: 0, textFloor: null }
        state.chase = entry
        chases.add(entry)
        entry.raf = requestAnimationFrame(function frame(now) {
          entry.raf = 0
          // 预览已撤（手动展开/收起）或元素卸载 → 停环
          if (!root.isConnected || root.getAttribute(PREVIEW_ATTR) !== '1' || !entry.el.isConnected) {
            stopChase(entry)
            return
          }
          var geoTarget = entry.el.scrollHeight - entry.el.clientHeight
          if (geoTarget <= 0) {
            // 不再是滚动容器（内容缩回去了）→ 停环，等下次突变
            entry.lastTarget = geoTarget
            stopChase(entry)
            return
          }
          if (geoTarget !== entry.lastTarget) {
            // 几何变了（长行/收缩/重挂）→ 重测文本底边并刷新生长时刻
            if (geoTarget > entry.lastTarget) entry.lastGrowthAt = now
            entry.lastTarget = geoTarget
            entry.textFloor = textFloorTarget(entry.el)
          }
          // 0.4.63：追「文本底边」而非几何底——正文末尾的空白结构不再算
          // 「底」（用户规格：滚到最下方那一行）；无文本时退回几何底。
          // target <= 0（全部文本已落进窗口）不特判：收敛分支的
          // top >= target - 1 恒真 → 精确归零 + 安静期后停环。
          var target = entry.textFloor !== null ? Math.min(geoTarget, entry.textFloor) : geoTarget
          var top = entry.el.scrollTop
          var ms = config.followMs
          if (ms <= 0) {
            // t=0：即时跳底（0.4.55/0.4.56 行为）
            if (top < target - 1) {
              try {
                entry.el.scrollTo({ top: target, behavior: 'instant' })
              } catch (error) {
                entry.el.scrollTop = target
              }
            }
            stopChase(entry)
            return
          }
          if (top >= target - 1) {
            // 已到底：精确到位消亚像素残差。0.4.61：不立即停环——驻留
            // tail 毫秒内容安静期，突发流的每行滑移首尾相接
            try {
              entry.el.scrollTo({ top: target, behavior: 'instant' })
            } catch (error) {
              entry.el.scrollTop = target
            }
            if (now - entry.lastGrowthAt > Math.max(ms, 500)) {
              stopChase(entry)
              return
            }
            entry.raf = requestAnimationFrame(frame)
            return
          }
          var dt = entry.lastAt ? now - entry.lastAt : 16.7
          if (dt <= 0 || dt > 250) dt = 16.7
          entry.lastAt = now
          var tau = ms / 3
          var next = top + (target - top) * (1 - Math.exp(-dt / tau))
          if (target - next < 1) next = target
          try {
            entry.el.scrollTo({ top: next, behavior: 'instant' })
          } catch (error) {
            entry.el.scrollTop = next
          }
          entry.raf = requestAnimationFrame(frame)
        })
      }

      function followLatest(root, state) {
        // 0.4.53：预览窗口（未展开）无条件钉底。CSS 已把该窗口设为
        // overflow hidden（用户滚不动），若再保留旧逻辑「用户碰过 body
        // （pointerdown/touch/wheel）就暂停跟随」，窗口会在中途冻结且用户
        // 没有任何补救手段（不能滚动）——所以跟随不再看 state.follow，
        // 预览期间每帧都钉到最下方；要读历史内容请展开（展开后本预览
        // 属性被移除，页面正常滚动不受影响）。
        if (root.getAttribute(PREVIEW_ATTR) !== '1') return
        var body = attachBodyTracking(root, state)
        if (body === null) return
        // 0.4.55：body 若不是真正的滚动容器（宿主 CSS 把 max-height/
        // overflow 放在外层的可能），只向上找一级 [data-open] 容器，
        // 绝不碰页面大滚动条。
        // 0.4.59：钉底 = 实时 rAF 追逐环（chaseBottom），与流式帧率无关。
        if (body.scrollHeight > body.clientHeight) {
          chaseBottom(root, body, state)
          return
        }
        var host = body.parentElement
        if (host && typeof host.hasAttribute === 'function' && host.hasAttribute('data-open')) chaseBottom(root, host, state)
      }

      function beginAutoCollapse(root, state) {
        if (state.collapseTimer) window.clearTimeout(state.collapseTimer)
        root.removeAttribute(PREVIEW_ATTR)
        root.setAttribute(COLLAPSING_ATTR, '1')
        state.collapseTimer = window.setTimeout(function () {
          state.collapseTimer = 0
          root.removeAttribute(COLLAPSING_ATTR)
          if (!root.isConnected || state.manual) return
          if (root.getAttribute('data-state') === 'running') return
          if (state.autoOpened && isExpanded(root)) clickDisclosure(root, state)
          state.autoOpened = false
        }, config.collapseMs)
      }

      function syncRoot(root) {
        if (!(root instanceof HTMLElement)) return
        var state = stateFor(root)
        var running = root.getAttribute('data-state') === 'running'
        var expanded = isExpanded(root)

        if (running && !state.wasRunning) {
          if (state.collapseTimer) {
            window.clearTimeout(state.collapseTimer)
            state.collapseTimer = 0
          }
          root.removeAttribute(COLLAPSING_ATTR)
          state.manual = false
          state.autoOpened = false
          state.follow = true
          // Wall-clock anchor, used only until the first event refresh lands:
          // the real start/latest come from the session's reasoning events
          // (refreshTimes), which is what recovers the elapsed time when the
          // preview is opened mid-thought or the window is switched back.
          state.startedAt = Date.now()
          state.eventStart = 0
          state.eventLatest = 0
          state.elapsedSec = 0
          refreshTimes(state)
        }

        if (running) {
          if (!expanded && !state.manual && config.autoOpen) {
            if (clickDisclosure(root, state)) state.autoOpened = true
          }
          if (!state.manual && (state.autoOpened || isExpanded(root))) {
            root.setAttribute(PREVIEW_ATTR, '1')
            requestAnimationFrame(function () {
              followLatest(root, state)
            })
          } else {
            root.removeAttribute(PREVIEW_ATTR)
          }
        } else if (state.wasRunning && state.autoOpened && !state.manual && isExpanded(root)) {
          beginAutoCollapse(root, state)
        } else {
          root.removeAttribute(PREVIEW_ATTR)
          root.removeAttribute(COLLAPSING_ATTR)
        }

        syncTime(root, state, Date.now())
        state.wasRunning = running
      }

      function schedule(root) {
        if (!root || typeof root.matches !== 'function' || !root.matches(THINK_ROOT)) return
        pending.add(root)
        if (raf) return
        raf = requestAnimationFrame(function () {
          raf = 0
          var roots = Array.from(pending)
          pending.clear()
          for (var i = 0; i < roots.length; i++) syncRoot(roots[i])
        })
      }

      function scheduleAll() {
        var roots = document.querySelectorAll(THINK_ROOT)
        for (var i = 0; i < roots.length; i++) schedule(roots[i])
      }

      function rootFromNode(node) {
        var element = node instanceof Element ? node : node.parentElement
        return element && typeof element.closest === 'function' ? element.closest(THINK_ROOT) : null
      }

      function markManual(event) {
        var target = event.target instanceof Element ? event.target : null
        var header = target && typeof target.closest === 'function' ? target.closest('[data-disclosure-row]') : null
        if (header === null) return
        var root = header.closest(THINK_ROOT)
        if (root === null || root.getAttribute('data-state') !== 'running') return
        var state = stateFor(root)
        if (state.programmatic) return
        state.manual = true
        state.autoOpened = false
        state.follow = false
        root.removeAttribute(PREVIEW_ATTR)
        root.removeAttribute(COLLAPSING_ATTR)
        if (state.collapseTimer) {
          window.clearTimeout(state.collapseTimer)
          state.collapseTimer = 0
        }
      }

      function markManualFromKey(event) {
        if (event.key === 'Enter' || event.key === ' ') markManual(event)
      }

      function start() {
        if (active) return
        if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
        active = true
        styleEl = upsertStyle(ENGINE_STYLE_ID, engineCss(config.lines, config.collapseMs))
        document.addEventListener('click', markManual, true)
        document.addEventListener('keydown', markManualFromKey, true)
        document.addEventListener('visibilitychange', onVisibility)
        tickTimer = window.setInterval(tick, 1000)
        observer = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            var record = records[i]
            var directRoot = rootFromNode(record.target)
            if (directRoot !== null) schedule(directRoot)
            if (record.type !== 'childList') continue
            for (var j = 0; j < record.addedNodes.length; j++) {
              var node = record.addedNodes[j]
              if (!(node instanceof Element)) continue
              if (typeof node.matches === 'function' && node.matches(THINK_ROOT)) schedule(node)
              if (typeof node.querySelectorAll === 'function') {
                var nested = node.querySelectorAll(THINK_ROOT)
                for (var k = 0; k < nested.length; k++) schedule(nested[k])
              }
            }
          }
        })
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['data-state', 'data-expanded', 'data-open', 'aria-expanded'],
        })
        scheduleAll()
      }

      function stop() {
        if (!active) return
        active = false
        if (observer !== null) {
          observer.disconnect()
          observer = null
        }
        if (raf) {
          cancelAnimationFrame(raf)
          raf = 0
        }
        if (chases.size) {
          var running = Array.from(chases)
          for (var c = 0; c < running.length; c++) stopChase(running[c])
        }
        document.removeEventListener('click', markManual, true)
        document.removeEventListener('keydown', markManualFromKey, true)
        document.removeEventListener('visibilitychange', onVisibility)
        if (tickTimer) {
          window.clearInterval(tickTimer)
          tickTimer = 0
        }
        removeTimeChips()
        if (styleEl !== null) {
          styleEl.remove()
          styleEl = null
        }
        pending.clear()
        var marked = document.querySelectorAll('[' + PREVIEW_ATTR + '], [' + COLLAPSING_ATTR + ']')
        for (var i = 0; i < marked.length; i++) {
          marked[i].removeAttribute(PREVIEW_ATTR)
          marked[i].removeAttribute(COLLAPSING_ATTR)
        }
      }

      function setConfig(next) {
        var changed =
          config.lines !== next.lines ||
          config.collapseMs !== next.collapseMs ||
          config.autoOpen !== next.autoOpen ||
          config.showTime !== next.showTime ||
          config.followMs !== next.followMs
        config = next
        if (!active || !changed) return
        styleEl = upsertStyle(ENGINE_STYLE_ID, engineCss(config.lines, config.collapseMs))
        scheduleAll()
      }

      return { start: start, stop: stop, setConfig: setConfig }
    }

