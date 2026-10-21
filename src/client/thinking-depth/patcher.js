    /**
     * Lays a slider into the shipped panel's effort row.
     *
     * The shipped `ModelSelect` renders its open panel through
     * `react-dom.createPortal` as an element with `id={`${id}-menu`}` and
     * `role="menu"`. Its root pane holds one direct `button[role="menuitem"]`
     * per row. The effort row is the unique direct row labelled 推理等级/Effort;
     * the Codex subscription picker may put speed and output-verbosity rows after
     * it. That row is rewritten here: the drill is swallowed, its chevron dropped,
     * and a slider added inside the same row element, so the panel's own styling
     * still applies and nothing else on screen changes.
     *
     * The link back to the session runs through the shipped ARIA wiring: the
     * menu carries `id`, the trigger carries `aria-controls={id}-menu`, and the
     * trigger sits in the composer next to the headless occupant's tag.
     */
    function createDepthPatcher() {
      var observer = null
      var unsubscribe = null
      var scheduled = false
      var running = false

      function schedule() {
        if (scheduled) return
        scheduled = true
        Promise.resolve().then(function () {
          scheduled = false
          scan()
        })
      }

      function menuList() {
        if (typeof document === 'undefined' || document === null || typeof document.querySelectorAll !== 'function') return []
        return Array.prototype.slice.call(document.querySelectorAll('[role="menu"][id$="-menu"]'))
      }

      function childButtons(element) {
        var rows = []
        var children = element.children === undefined ? [] : element.children
        for (var i = 0; i < children.length; i++) {
          if (children[i].tagName === 'BUTTON' && children[i].getAttribute('role') === 'menuitem') rows.push(children[i])
        }
        return rows
      }

      function spanChildren(element) {
        var spans = []
        var children = element.children === undefined ? [] : element.children
        for (var i = 0; i < children.length; i++) {
          if (children[i].tagName === 'SPAN') spans.push(children[i])
        }
        return spans
      }

      function rowLabel(row) {
        var spans = spanChildren(row)
        if (spans.length === 0) return ''
        var text = spans[0].textContent
        return String(text === undefined || text === null ? '' : text).trim()
      }

      /**
       * The nearest session tag inside `element`. The tag is written by the
       * session occupant into the composer, so it sits *beside* the trigger
       * rather than above it: the walk has to search each ancestor's subtree,
       * nearest ancestor first, to stay correct when several sessions are open.
       */
      function tagInside(element, depth) {
        if (element === null || element === undefined || depth > 8) return null
        var attribute = typeof element.getAttribute === 'function' ? element.getAttribute('data-dshp-session') : null
        if (attribute !== null && attribute !== undefined) return attribute
        var children = element.children === undefined ? [] : element.children
        for (var i = 0; i < children.length; i++) {
          var hit = tagInside(children[i], depth + 1)
          if (hit !== null) return hit
        }
        return null
      }

      /** Which session owns this panel: trigger (aria-controls) -> composer tag. */
      function sessionOf(menu) {
        if (typeof document !== 'undefined' && document !== null && typeof document.querySelectorAll === 'function') {
          var triggers = document.querySelectorAll('[aria-controls]')
          for (var i = 0; i < triggers.length; i++) {
            if (triggers[i].getAttribute('aria-controls') !== menu.id) continue
            var node = triggers[i]
            while (node !== null && node !== undefined) {
              var tag = tagInside(node, 0)
              if (tag !== null) return tag
              node = node.parentElement === undefined ? null : node.parentElement
            }
          }
        }
        // Nothing tagged (an unexpected DOM): one mounted session is still
        // unambiguous, more than one is not — and then the row is left alone.
        if (sessionRegistry.map.size === 1) {
          var only = null
          sessionRegistry.map.forEach(function (value, key) {
            only = key
          })
          return only
        }
        return null
      }

      function entryOf(menu) {
        var sessionId = menu.getAttribute('data-dshp-session')
        return sessionId === null ? undefined : sessionRegistry.get(sessionId)
      }

      /**
       * A programmatic nudge towards `at`: the knob eases there on a spring and
       * the fill/value travel with it frame by frame, sampling the lane
       * colour continuously — the eye sees one motion, never a colour jump.
       * `row` is passed in because the slider only knows its menu.
       */
      function glideTo(slider, row, entry, at) {
        var count = entry.efforts.length
        var target = count <= 1 ? 1 : at / (count - 1)
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
          slider.__glideT = target
          paint(slider, entry, at)
          showValue(row, entry, at)
          return
        }
        if (slider.__glideT === undefined) {
          slider.__glideT = target
          paint(slider, entry, at)
          showValue(row, entry, at)
          return
        }
        var from = slider.__glideT
        if (Math.abs(from - target) < 0.000001) {
          paint(slider, entry, at)
          showValue(row, entry, at)
          return
        }
        var start = 0
        try {
          start = window.performance && typeof window.performance.now === 'function' ? window.performance.now() : 0
        } catch (error) {
          start = 0
        }
        var duration = 340
        function frame(now) {
          if (slider.__glideToken !== token) return
          var elapsed = (now === undefined ? start + duration : now) - start
          var k = elapsed >= duration ? 1 : elapsed / duration
          // easeOutBack: overshoot, then settle — the non-linear motion.
          var eased = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2)
          var t = from + (target - from) * (k >= 1 ? 1 : eased)
          slider.__glideT = t
          paintAt(slider, entry, t, at)
          showValueAt(row, entry, t)
          if (k < 1) window.requestAnimationFrame(frame)
          else {
            slider.__glideT = target
            paint(slider, entry, at)
            showValue(row, entry, at)
          }
        }
        var token = (slider.__glideToken === undefined ? 0 : slider.__glideToken) + 1
        slider.__glideToken = token
        window.requestAnimationFrame(frame)
      }

      /**
       * The pointer lane is the knob-centre travel: from the first stop's
       * centre to the last, i.e. the width minus one end inset (r + s) each
       * side. It is the same lane the stops and the knob sit on, so a click on
       * a stop maps back to that stop.
       */
      function laneOf(slider) {
        var rect = typeof slider.getBoundingClientRect === 'function' ? slider.getBoundingClientRect() : null
        if (rect === null || rect === undefined || rect.width <= 0) return null
        return { left: rect.left + INSET, width: rect.width - INSET * 2 }
      }

      /** The pointer position as a continuous 0..1 along the lane, or null. */
      function laneRatioAt(slider, clientX) {
        var lane = laneOf(slider)
        if (lane === null || lane.width <= 0) return null
        var ratio = (clientX - lane.left) / lane.width
        return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio
      }

      /** Where the pointer was when the gesture ended, for the glide start. */
      function draggingGoneT(slider, entry, clientX) {
        if (entry.efforts.length <= 1) return 1
        var ratio = laneRatioAt(slider, clientX)
        return ratio === null ? entry.index / (entry.efforts.length - 1) : ratio
      }

      function levelIndexAt(slider, clientX, entry) {
        var count = entry.efforts.length
        if (count <= 1) return 0
        var ratio = laneRatioAt(slider, clientX)
        if (ratio === null) return entry.index
        return Math.round(ratio * (count - 1))
      }

      /**
       * Writes that stay silent unless something actually changed. Everything
       * the patcher mutates lives inside the shipped panel, which this patcher
       * itself watches with a `childList` MutationObserver — so an
       * unconditional `textContent = ...` reschedules another scan even when
       * the string is identical, and the page burns its main thread redrawing
       * nothing. Compare first, write only on change.
       */
      function setText(node, text) {
        if (node !== null && node !== undefined && node.textContent !== text) node.textContent = text
      }

      function setStyle(node, name, value) {
        if (node !== null && node !== undefined && node.style[name] !== value) node.style[name] = value
      }

      function setAttr(node, name, value) {
        if (node !== null && node !== undefined && node.getAttribute(name) !== value) node.setAttribute(name, value)
      }

      function delAttr(node, name) {
        if (node !== null && node !== undefined && node.getAttribute(name) !== null) node.removeAttribute(name)
      }

      /**
       * Paint the continuous position `t` (0..1 along the lane). The knob sits
       * exactly there; the fill covers the used share in the colour sampled at
       * `t`, so the colour travels with the pointer and through the easing
       * instead of jumping when a stop is crossed. `at` only names the stop
       * for the label and the ARIA value.
       */
      function paintAt(slider, entry, t, at) {
        var parts = slider.__parts
        if (parts === undefined) return
        var count = entry.efforts.length
        var clamped = t < 0 ? 0 : t > 1 ? 1 : t
        var gradient = trackGradient(entry.colors)
        setStyle(parts.ghost, 'backgroundImage', gradient)
        // The knob centre is `INSET + l * t` from the left wall (l = width - 2
        // * INSET is the slidable length); the fill grows from the left wall to
        // that same centre, so fill width and knob `left` are one formula.
        var knobPosition = count <= 1 ? '50%' : 'calc(' + INSET + 'px + (100% - ' + INSET * 2 + 'px) * ' + clamped + ')'
        setStyle(parts.fill, 'width', knobPosition)
        var color = sampleLane(entry.triples === undefined ? [] : entry.triples, clamped)
        setStyle(parts.fill, 'backgroundColor', color)
        setStyle(parts.knob, 'left', knobPosition)
        setStyle(parts.knob, 'boxShadow', '0 0 0 3px ' + color + '33, 0 1px 4px rgba(0,0,0,.35)')
        while (slider.__stops.length < count) {
          var dot = document.createElement('span')
          dot.className = 'dshp-eff-stop'
          if (typeof slider.insertBefore === 'function' && parts.knob.parentElement === slider) slider.insertBefore(dot, parts.knob)
          else slider.appendChild(dot)
          slider.__stops.push(dot)
        }
        for (var i = 0; i < slider.__stops.length; i++) {
          setStyle(slider.__stops[i], 'display', i < count ? '' : 'none')
          // Stops share the knob's lane, evenly spaced l / (count - 1): stop i
          // is INSET + l * i/(count-1) from the left wall, so an end stop keeps
          // s of wall between its rim and the track's end.
          setStyle(slider.__stops[i], 'left', count <= 1 ? '50%' : 'calc(' + INSET + 'px + (100% - ' + INSET * 2 + 'px) * ' + i / (count - 1) + ')')
        }
        setAttr(slider, 'aria-valuemin', '0')
        setAttr(slider, 'aria-valuemax', String(Math.max(0, count - 1)))
        setAttr(slider, 'aria-valuenow', String(at))
        setAttr(slider, 'aria-valuetext', entry.efforts[at] === undefined ? '' : String(entry.efforts[at].name))
        setAttr(slider, 'aria-disabled', entry.submitting ? 'true' : 'false')
        // A write this component made has no other place to report itself: the
        // shipped panel only knows about its own calls. The ring is that place.
        var failed = entry.error !== null && entry.error !== undefined
        setAttr(slider, 'aria-invalid', failed ? 'true' : 'false')
        setAttr(slider, 'data-dshp-state', failed ? 'error' : '')
        // The ring says *that* it failed; the tooltip says why.
        var title = failed ? String(entry.error) : ''
        if (slider.title !== title) slider.title = title
      }

      function paint(slider, entry, at) {
        paintAt(slider, entry, at <= 0 ? 0 : at / Math.max(1, entry.efforts.length - 1), at)
      }

      function attach(slider, menu, row) {
        var dragging = null

        function preview(at) {
          var entry = entryOf(menu)
          if (entry === undefined) return
          paint(slider, entry, at)
          showValue(row, entry, at)
        }

        /**
         * Follow the pointer continuously: the knob, the fill and the level
         * name all track `t`, while only the *stop* snaps — the label names
         * the nearest stop, the commit fires on release. Nothing is written
         * before `pointerup`.
         */
        function follow(clientX) {
          var entry = entryOf(menu)
          if (entry === undefined || entry.efforts.length <= 1) return
          var ratio = laneRatioAt(slider, clientX)
          if (ratio === null) return
          var next = Math.round(ratio * (entry.efforts.length - 1))
          dragging.t = ratio
          if (next !== dragging.index) dragging.index = next
          paintAt(slider, entry, ratio, dragging.index)
          showValueAt(row, entry, ratio)
        }

        function release() {
          dragging = null
          slider.__dragging = false
          delAttr(slider, 'data-dshp-dragging')
        }

        // The shipped root cancels mousedown inside any button, which would keep
        // the slider from taking focus on click. Keep the default here.
        //
        // Only one pointer gesture at a time. A press that arrives while a drag
        // is in flight is ignored outright; matching by pointerId is not
        // enough because synthetic replays reuse the ids real presses carry.
        // Otherwise the second gesture orphans the first — the drag sticks,
        // the error ring never clears, and the panel looks dead.
        slider.addEventListener(
          'mousedown',
          function (event) {
            event.stopPropagation()
          },
          true,
        )

        slider.addEventListener('pointerdown', function (event) {
          var entry = entryOf(menu)
          if (entry === undefined || entry.efforts.length <= 1 || entry.submitting) return
          // A drag is already in flight: ignore any new press outright, or the
          // second gesture would orphan the first and the row would stick.
          if (dragging !== null) return
          var id = event === null || event === undefined ? undefined : event.pointerId
          if (typeof slider.setPointerCapture === 'function') {
            try {
              slider.setPointerCapture(id)
            } catch (error) {
              /* capture is only an optimisation */
            }
          }
          // Follow the pointer without the spring, so a drag tracks the finger.
          setAttr(slider, 'data-dshp-dragging', '1')
          slider.__dragging = true
          slider.__glideToken = (slider.__glideToken === undefined ? 0 : slider.__glideToken) + 1
          dragging = { id: id, index: levelIndexAt(slider, event.clientX, entry), t: 0 }
          var start = laneRatioAt(slider, event.clientX)
          dragging.t = start === null ? dragging.index / Math.max(1, entry.efforts.length - 1) : start
          paintAt(slider, entry, dragging.t, dragging.index)
          showValueAt(row, entry, dragging.t)
        })
        slider.addEventListener('pointermove', function (event) {
          if (dragging === null) return
          var id = event === null || event === undefined ? undefined : event.pointerId
          if (dragging.id !== id) return
          follow(event.clientX)
        })
        // Some shells only fire `pointermove` on the element under the press,
        // so a fast drag can leave the slider mid-gesture. Track the window too
        // while dragging; the slider handler above answers first, this one is
        // the backstop, and both are retired on release.
        function onWindowMove(event) {
          if (dragging === null) return
          if (event === null || event === undefined || event.pointerId !== dragging.id) return
          // The slider's own move listener already ran for events over it.
          if (event.target === slider) return
          follow(event.clientX)
        }
        if (typeof window !== 'undefined' && window !== null && typeof window.addEventListener === 'function') {
          window.addEventListener('pointermove', onWindowMove, true)
        }
        slider.addEventListener('pointerup', function (event) {
          if (dragging === null) return
          var id = event === null || event === undefined ? undefined : event.pointerId
          if (dragging.id !== id) return
          var entry = entryOf(menu)
          var next = entry === undefined ? dragging.index : levelIndexAt(slider, event.clientX, entry)
          release()
          if (entry === undefined) return
          // The knob is already where the pointer left it; glide it onto the
          // snapped stop with the colour travelling along, then commit.
          slider.__glideT = draggingGoneT(slider, entry, event.clientX)
          glideTo(slider, row, entry, next)
          if (next === entry.index) return
          entry.commit(next)
        })
        slider.addEventListener('pointercancel', function (event) {
          if (dragging === null) return
          var id = event === null || event === undefined ? undefined : event.pointerId
          if (dragging.id !== id) return
          var entry = entryOf(menu)
          release()
          if (entry === undefined) return
          glideTo(slider, row, entry, entry.index)
        })
        slider.addEventListener('keydown', function (event) {
          var entry = entryOf(menu)
          if (entry === undefined) return
          var count = entry.efforts.length
          var next = null
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = entry.index - 1
          else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = entry.index + 1
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = count - 1
          if (next === null) return
          // Keep the arrows for the slider instead of the panel's row focus.
          event.preventDefault()
          event.stopPropagation()
          next = Math.min(count - 1, Math.max(0, next))
          if (next !== entry.index) entry.commit(next)
        })
      }

      /** The injected level name: the one a drag has to move. */
      function showValue(row, entry, at) {
        if (row === null || row === undefined) return
        showValueAt(row, entry, at <= 0 ? 0 : at / Math.max(1, entry.efforts.length - 1))
      }

      /** Paint the level name for the continuous position `t`, like the fill. */
      function showValueAt(row, entry, t) {
        var el = row === null || row === undefined ? null : row.__dshpValue
        if (el === null || el === undefined) return
        var count = entry.efforts.length
        var stop = count <= 1 ? 0 : Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * (count - 1))
        var level = entry.efforts[stop]
        var named = entry.labels && level !== undefined && level.name !== undefined
        setText(el, named ? String(level.name) : '')
        setStyle(el, 'color', entry.labels ? sampleLane(entry.triples === undefined ? [] : entry.triples, t) : '')
      }

      function adopt(menu, row, sessionId) {
        setAttr(menu, 'data-dshp-effort', '1')
        setAttr(menu, 'data-dshp-session', sessionId)
        setAttr(row, 'data-dshp-row', '1')
        // That row was the door to the level list; keep it shut. A capture
        // listener runs before React's own bubble-phase handler at the root, so
        // stopping propagation here cancels the drill for mouse and keyboard.
        row.addEventListener(
          'click',
          function (event) {
            event.preventDefault()
            event.stopPropagation()
          },
          true,
        )
        // The shipped row is a 34px-tall flex line: label, value, chevron. It
        // becomes two explicit grid rows — label and level name, then the slider
        // across both columns. Every other child is *hidden* rather than removed
        // (React still owns those nodes and keeps updating them), and a hidden
        // grid item takes no cell, so no leftover line can appear under the row.
        setStyle(row, 'display', 'grid')
        setStyle(row, 'gridTemplateColumns', '1fr auto')
        setStyle(row, 'height', 'auto')
        setStyle(row, 'padding', '8px')
        setStyle(row, 'alignItems', 'center')
        setStyle(row, 'rowGap', '8px')
        setStyle(row, 'cursor', 'default')
        var spans = spanChildren(row)
        var label = spans.length > 0 ? spans[0] : null
        var children = row.children === undefined ? [] : row.children
        for (var i = 0; i < children.length; i++) {
          if (children[i] !== label) setStyle(children[i], 'display', 'none')
        }
        if (label !== null) setStyle(label, 'gridArea', '1 / 1')
        // The level name is re-rendered by us so that a drag can move it; the
        // shipped one is hidden above and keeps its own bookkeeping.
        var value = document.createElement('span')
        value.className = 'dshp-eff-value'
        setStyle(value, 'gridArea', '1 / 2')
        var slider = document.createElement('div')
        slider.className = 'dshp-eff-slider'
        setStyle(slider, 'gridArea', '2 / 1 / 3 / 3')
        setAttr(slider, 'role', 'slider')
        setAttr(slider, 'tabindex', '0')
        setAttr(slider, 'aria-label', label === null ? '推理等级' : rowLabel(row))
        var ghost = document.createElement('span')
        ghost.className = 'dshp-eff-ghost'
        var fill = document.createElement('span')
        fill.className = 'dshp-eff-fill'
        var knob = document.createElement('span')
        knob.className = 'dshp-eff-knob'
        slider.appendChild(ghost)
        slider.appendChild(fill)
        slider.appendChild(knob)
        row.appendChild(value)
        row.appendChild(slider)
        slider.__parts = { ghost: ghost, fill: fill, knob: knob }
        slider.__stops = []
        row.__dshpSlider = slider
        row.__dshpValue = value
        attach(slider, menu, row)
      }

      function rowOf(menu) {
        var children = menu.children === undefined ? [] : menu.children
        for (var i = 0; i < children.length; i++) {
          if (children[i].tagName === 'BUTTON' && children[i].getAttribute('data-dshp-row') === '1') return children[i]
        }
        return null
      }

      function refresh(menu) {
        var entry = entryOf(menu)
        var row = rowOf(menu)
        if (row === null || row.__dshpSlider === undefined) {
          // React rebuilt the row (the model changed its reasoning shape):
          // release the claim with the same conditional writes — setting an
          // attribute React never set still replaces the Attr node in the DOM.
          delAttr(menu, 'data-dshp-effort')
          delAttr(menu, 'data-dshp-session')
          return
        }
        if (entry === undefined) return
        var slider = row.__dshpSlider
        // A drag owns the knob; an outside change while dragging would fight
        // the pointer, so it waits for release (the release glides there).
        if (slider.__dragging === true) return
        showValue(row, entry, entry.index)
        glideTo(slider, row, entry, entry.index)
      }

      function scan() {
        var list = menuList()
        var panels = list.length
        var claimed = 0
        var skip = ''
        for (var i = 0; i < list.length; i++) {
          var menu = list[i]
          if (menu.getAttribute('data-dshp-effort') === '1') {
            claimed += 1
            refresh(menu)
            continue
          }
          var outcome = assess(menu)
          if (outcome.row !== null) {
            claimed += 1
            adopt(menu, outcome.row, outcome.sessionId)
            refresh(menu)
          } else if (skip === '') {
            skip = outcome.reason
          }
        }
        setPatcherStats({ panels: panels, claimed: claimed, skip: skip })
      }

      /**
       * Why a panel was left alone, in the same order the scan applies its
       * rules: role first, then the row census, then the label, then the
       * session link. The summary line shows the first skip so a missing
       * slider points at its own cause instead of going silent.
       */
      function assess(menu) {
        if (menu.getAttribute('role') !== 'menu') return { row: null, reason: 'not-menu' }
        var rows = childButtons(menu)
        if (rows.length < 2) return { row: null, reason: 'single-row' }
        var row = null
         for (var i = 0; i < rows.length; i++) {
           if (/^(推理等级|Effort)$/i.test(rowLabel(rows[i]))) {
             row = rows[i]
             break
           }
         }
         if (row === null) return { row: null, reason: 'not-effort' }
        /* effort row already located by its label */
        var sessionId = sessionOf(menu)
        if (sessionId === null) return { row: null, reason: 'no-session' }
        var entry = sessionRegistry.get(sessionId)
        if (entry === undefined) return { row: null, reason: 'no-entry' }
        if (entry.enabled === false) return { row: null, reason: 'disabled' }
        return { row: row, sessionId: sessionId, reason: '' }
      }

      function start() {
        if (running) return
        running = true
        scan()
        unsubscribe = sessionRegistry.subscribe(schedule)
        if (typeof MutationObserver === 'function') {
          var root = typeof document === 'undefined' || document === null ? null : document.body
          if (root !== null && root !== undefined) {
            observer = new MutationObserver(schedule)
            observer.observe(root, { childList: true, subtree: true })
          }
        }
      }

      function stop() {
        if (!running) return
        running = false
        setPatcherStats({ panels: 0, claimed: 0, skip: '' })
        if (observer !== null) {
          observer.disconnect()
          observer = null
        }
        if (unsubscribe !== null) {
          unsubscribe()
          unsubscribe = null
        }
      }

      return { start: start, stop: stop, scan: scan }
    }

