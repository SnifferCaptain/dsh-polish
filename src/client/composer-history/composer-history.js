    // ------------------------------------------------------------- composer-history
    //
    // 上箭头召回（组件 C）：输入框为空时按 ↑ 把本会话最近一条「用户」消息
    // 填进输入框；召回（未改动）态里 ↑ 继续往更早翻、↓ 往回翻；一旦对文本做
    // 了任意改动就退出召回（此时文本等同把历史直接复制进框的普通草稿）；输入框
    // 重新清空后再次 ↑ 可重新进入。Esc 取消本次召回并清空，Enter 照常发送——
    // 本组件只做预填，不碰发送逻辑。
    //
    // 数据来自 `remote.session`（会话远端）：
    //   projections({sessionId}) -> { asOfSeq }
    //   page({address:{kind:'session',sessionId}, throughSeq, beforeSeq?, maxMessages})
    //     -> { records: [{ event: { seq, data } }], hasMore }
    // page 返回 from cut to throughSeq 的连续事件段（seq 升序），maxMessages 只
    // 数 user/assistant 消息；hasMore 表示 cut 之前还有更早事件。
    // 全史翻查（深页）：翻到最旧一条且 hasMore 时，用 throughSeq=原始 asOf
    // （稳定锚点）+ beforeSeq=已取到的最小 seq 按需拉下一页，抽出的用户消息
    // 追加到列表尾部（list 恒 newest-first）；缓存上限 HISTORY_RECALL_MAX 条
    // 用户消息，不做批量预取。用户消息 = event.data.source === 'user' 且
    // content 有文本。
    //
    // 输入框是自带的 Lexical contenteditable：写值走 select-all +
    // execCommand('insertText')（触发真实 input 事件，让 Lexical 更新草稿）。

    var historyStatsStore = createStore({ sessions: 0, lastCount: 0, lastError: '' })

    function setHistoryStats(patch) {
      historyStatsStore.set(Object.assign({}, historyStatsStore.get(), patch))
    }

    /** A user message's `data.content` may be a string, a parts array, or `{text}`. */
    function contentTextOf(content) {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) {
        var s = ''
        for (var i = 0; i < content.length; i++) {
          var p = content[i]
          if (typeof p === 'string') s += p
          else if (p && typeof p === 'object' && typeof p.text === 'string') s += p.text
        }
        return s
      }
      if (content && typeof content === 'object' && typeof content.text === 'string') return content.text
      return null
    }

    /**
     * Pull the user-typed messages out of a paged event log, newest first
     * (list[0] = the most recent user message).
     */
    function extractUserMessages(records) {
      var out = []
      if (!records || !Array.isArray(records)) return out
      for (var i = 0; i < records.length; i++) {
        var ev = records[i] && records[i].event
        // DSH's own user-message signature (types/index.js, types/list.js): the
        // durable type is 'user/message' and data.source.kind === 'user' (a real
        // user prompt, not agent-instructions / system-injected).
        if (!ev || ev.type !== 'user/message') continue
        var data = ev.data
        if (!data || typeof data !== 'object') continue
        if (!data.source || data.source.kind !== 'user') continue
        var text = contentTextOf(data.content)
        if (text === null) continue
        if (text.replace(/\s+/g, '') === '') continue
        out.push({ seq: typeof ev.seq === 'number' ? ev.seq : 0, text: text })
      }
      out.sort(function (a, b) { return a.seq - b.seq })
      var newestFirst = []
      for (var j = out.length - 1; j >= 0; j--) newestFirst.push(out[j].text)
      return newestFirst
    }

    /** Smallest event seq in a paged record set (null when the page is empty). */
    function minSeqOf(records) {
      if (!records || !Array.isArray(records)) return null
      var min = null
      for (var i = 0; i < records.length; i++) {
        var ev = records[i] && records[i].event
        if (ev && typeof ev.seq === 'number' && (min === null || ev.seq < min)) min = ev.seq
      }
      return min
    }

    function createComposerHistory() {
      var registry = {} // sessionId -> remote.session proxy
      var recall = null // { sessionId, list: [texts, newest-first], index, input }
      var fetching = {} // sessionId -> Promise (the shared in-flight fetch, if any)
      var cache = {} // sessionId -> { list: [texts, newest-first], cursor, hasMore, asOf, deep }
      //   list: the cached user messages, capped at HISTORY_RECALL_MAX
      //   cursor: smallest event seq fetched so far (0-based, dense log) — the
      //           beforeSeq for the next older page
      //   hasMore: older events exist (and the recall cap has not been hit)
      //   asOf: the throughSeq anchor for every page read (a stable valid cut)
      //   deep: the in-flight older-page promise, or null when idle
      var enabled = true
      var started = false
      // The last programmatic fill: (input, text, deadline). Our own setText
      // writes also surface as `input` events (the DOM fallback dispatches one
      // synchronously; the setDraft path can deliver one a beat later). The
      // onInput handler below must swallow ONLY those — a fill is recognised
      // by the exact (input, text) pair while the text in the field is still
      // exactly what we wrote. Any other input while a recall is active is a
      // genuine user edit and ends the recall (see the component contract).
      var lastWrite = null
      function guardWrite(input, text) {
        lastWrite = { input: input, text: text, until: Date.now() + 800 }
      }
      // sessionId -> the composer's inputActions (the public `setDraft` face).
      // When present, drafts are written through it — DSH's own editor.update
      // path — which reliably fills AND clears (the DOM execCommand path no-ops
      // on an empty insertText, which is why "down at the newest -> blank" used
      // to leave the previous message in the box).
      var actionsBySession = {}

      function focusInput() {
        if (typeof document === 'undefined') return null
        var el = document.activeElement
        if (!el) return null
        if (el.isContentEditable) return el
        var tag = el.tagName
        if (tag === 'TEXTAREA') return el
        if (tag === 'INPUT' && (el.type === 'text' || el.type === '' || el.type === 'search')) return el
        return null
      }

      /** Walk up from the focused input to the nearest composer tag. */
      function sessionIdOf(input) {
        var node = input
        var hops = 0
        while (node && node.nodeType === 1 && node !== document.body && hops < 30) {
          var own = node.getAttribute ? node.getAttribute(HISTORY_TAG) : null
          if (own) return own
          var found = node.querySelector ? node.querySelector('[' + HISTORY_TAG + ']') : null
          if (found && found.getAttribute) return found.getAttribute(HISTORY_TAG)
          node = node.parentNode
          hops += 1
        }
        // Fallback: only one session's composer is mounted at a time, so the
        // single anchor tag in the document is the focused session's.
        try {
          var single = document.querySelector('[' + HISTORY_TAG + ']')
          if (single && single.getAttribute) {
            var v = single.getAttribute(HISTORY_TAG)
            if (v) return v
          }
        } catch (e) {}
        return null
      }

      function currentText(input) {
        if (!input) return ''
        if (typeof input.value === 'string') return input.value
        var t = typeof input.innerText === 'string' ? input.innerText : input.textContent
        return t || ''
      }

      function selectAll(input) {
        var sel = window.getSelection && window.getSelection()
        if (!sel || !document.createRange) return
        var range = document.createRange()
        range.selectNodeContents(input)
        sel.removeAllRanges()
        sel.addRange(range)
      }

      function caretEnd(input) {
        var sel = window.getSelection && window.getSelection()
        if (!sel || !document.createRange) return
        var range = document.createRange()
        range.selectNodeContents(input)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }

      function setText(input, text) {
        // Preferred: the composer's own inputActions.setDraft(text). It is DSH's
        // editor.update path — it sets the FULL draft for any text (including
        // multi-line, which the DOM path mangles) and, crucially, clears it for
        // '' . The DOM fallback below CANNOT clear: execCommand('insertText','',)
        // is a no-op and execCommand('delete') is intercepted-but-not-applied by
        // this editor, which is exactly why "down at the newest -> blank" used to
        // leave the previous message behind.
        var draftSessionId = sessionIdOf(input)
        var actions = draftSessionId && actionsBySession[draftSessionId]
        if (actions && typeof actions.setDraft === 'function') {
          try {
            actions.setDraft(text)
            return
          } catch (error) {}
        }
        // Fallback (no inputActions wired for this session): the DOM path.
        try {
          input.focus()
        } catch (error) {}
        var tag = input && input.tagName
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
          // A plain <textarea>/<input>: set the value and fire input/change so
          // the framework re-reads the draft (execCommand is for contenteditable).
          try {
            input.value = text
            input.dispatchEvent(new Event('input', { bubbles: true }))
            input.dispatchEvent(new Event('change', { bubbles: true }))
          } catch (error) {}
          return
        }
        try {
          selectAll(input)
        } catch (error) {}
        var done = false
        try {
          // Always replace the selected contents with `text` via insertText — the
          // command the editor honours (that's why filling works). For a blank
          // text we additionally run delete: execCommand('delete') ALONE is
          // intercepted by the editor without being applied, which is exactly why
          // "down at the newest -> blank" used to leave the previous text behind.
          if (text === '') {
            done = document.execCommand('insertText', false, '')
            try {
              document.execCommand('delete')
            } catch (error2) {}
          } else {
            done = document.execCommand('insertText', false, text)
          }
        } catch (error) {
          done = false
        }
        if (!done) {
          // Lexical may swallow execCommand; fall back to a synthetic beforeinput.
          try {
            var event = new InputEvent('beforeinput', {
              bubbles: true,
              cancelable: true,
              inputType: 'insertText',
              data: text,
            })
            input.dispatchEvent(event)
          } catch (error) {}
        }
        try {
          caretEnd(input)
        } catch (error) {}
      }

      function fetchHistory(sessionId, remoteSession) {
        var address = { kind: 'session', sessionId: sessionId }
        function pageWith(throughSeq) {
          var request = { address: address, throughSeq: throughSeq, maxMessages: HISTORY_PAGE_MAX }
          return Promise.resolve(remoteSession.page(request)).then(function (response) {
            if (!response || response.ok !== true || !response.value || !response.value.records) return null
            var value = response.value
            return {
              list: extractUserMessages(value.records),
              cursor: minSeqOf(value.records),
              hasMore: value.hasMore === true,
            }
          })
        }
        function settle(page, asOf) {
          return {
            list: page ? page.list : [],
            cursor: page && page.cursor !== null ? page.cursor : asOf,
            hasMore: page ? page.hasMore : false,
            asOf: asOf,
          }
        }
        return Promise.resolve(remoteSession.projections({ sessionId: sessionId }))
          .then(function (projection) {
            var asOf =
              projection && projection.ok === true && projection.value && typeof projection.value.asOfSeq === 'number'
                ? projection.value.asOfSeq
                : 0
            return pageWith(asOf).then(function (page) {
              return settle(page, asOf)
            })
          })
          .catch(function () {
            return pageWith(0).then(function (page) {
              return settle(page, 0)
            })
          })
      }

      // Pre-fetch this session's history when its composer gains focus, so the
      // first ↑ is instant instead of waiting on a network round-trip.
      function onFocus(event) {
        var input = event.target
        if (!input) return
        var tag = input.tagName
        if (!(input.isContentEditable || tag === 'TEXTAREA' || tag === 'INPUT')) return
        var sessionId = sessionIdOf(input)
        if (!sessionId) return
        var remoteSession = registry[sessionId]
        if (remoteSession) loadHistory(sessionId, remoteSession)
      }

      // Fetch (and cache) this session's user messages, newest first. Repeated
      // calls are served from the cache so the arrows never wait on the network.
      // Resolves to the cached list itself (the object `cache[sid].list`), so a
      // later deep page can prepend to it in place and every live reference —
      // including an active recall — sees the older entries.
      function loadHistory(sessionId, remoteSession) {
        var h = cache[sessionId]
        if (h) return Promise.resolve(h.list)
        // One in-flight fetch per session, shared by every caller (the focus
        // pre-fetch and a concurrent ↑) so no caller is dropped mid-flight.
        if (!fetching[sessionId]) {
          fetching[sessionId] = fetchHistory(sessionId, remoteSession).then(
            function (page) {
              delete fetching[sessionId]
              cache[sessionId] = page
              setHistoryStats({ lastCount: page.list.length, lastError: page.list.length > 0 ? '' : '未找到用户消息' })
              return page.list
            },
            function () {
              delete fetching[sessionId]
              setHistoryStats({ lastError: '读取会话历史失败' })
              return []
            },
          )
        }
        return fetching[sessionId]
      }

      // Pull the NEXT OLDER page, on demand (only when ↑ reaches the oldest
      // cached entry and hasMore). The page is anchored at the original asOf
      // and cut at `cursor` via beforeSeq — a contiguous log range that can
      // never overlap what is already cached. Resolves with how many user
      // messages were prepended (0 when there is nothing older, the recall
      // cap is hit, the page failed, or a page is already in flight).
      function fetchOlder(sessionId, remoteSession) {
        var h = cache[sessionId]
        if (!h || h.deep) return Promise.resolve(0)
        if (!h.hasMore) return Promise.resolve(0)
        if (h.list.length >= HISTORY_RECALL_MAX) {
          h.hasMore = false // capped: stop paging, keep the newest entries
          return Promise.resolve(0)
        }
        var request = {
          address: { kind: 'session', sessionId: sessionId },
          throughSeq: h.asOf,
          beforeSeq: h.cursor,
          maxMessages: HISTORY_PAGE_MAX,
        }
        h.deep = Promise.resolve(remoteSession.page(request)).then(
          function (response) {
            h.deep = null
            if (!response || response.ok !== true || !response.value || !response.value.records) return 0
            var value = response.value
            var added = extractUserMessages(value.records)
            // Advance the cursor over the WHOLE fetched range (every event,
            // not just user messages) so a page full of tool traffic still
            // makes progress and no range is ever read twice.
            var minSeq = minSeqOf(value.records)
            if (minSeq !== null) h.cursor = minSeq
            h.hasMore = value.hasMore === true
            if (added.length > 0) {
              // `added` is newest-first WITHIN the older page; the cache list
              // is newest-first overall, so the page's entries go to the TAIL
              // (the older end). An active recall's index then points at the
              // same entry as before — no shift needed.
              for (var i = 0; i < added.length; i++) h.list.push(added[i])
              if (h.list.length > HISTORY_RECALL_MAX) {
                h.list.length = HISTORY_RECALL_MAX // drop the oldest past the cap
                h.hasMore = false
              }
              setHistoryStats({ lastCount: h.list.length, lastError: '' })
            }
            return added.length
          },
          function () {
            h.deep = null
            setHistoryStats({ lastError: '读取更早的历史失败' })
            return 0
          },
        )
        return h.deep
      }

      function onKey(event) {
        var key = event.key
        if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'Escape') return
        if (enabled !== true) return
        var input = focusInput()
        if (!input) return
        var sessionId = sessionIdOf(input)
        if (!sessionId) return
        var remoteSession = registry[sessionId]
        if (!remoteSession) return

        var inRecall = recall !== null && recall.sessionId === sessionId

        if (key === 'Escape') {
          if (inRecall) {
            event.preventDefault()
            guardWrite(input, '')
            setText(input, '')
            recall = null
          }
          return
        }

        var text = currentText(input)
        // "In recall" is decided by which session is recalling, at which index
        // — the navigation itself never re-reads the field text (the editor
        // normalises whitespace and multi-line writes fire stray input events,
        // so any naive text-compare "did the user edit this?" test
        // false-positives; index-driven navigation cannot fall back to the
        // caret). EXITING the recall on a user edit is separate and deliberate
        // (0.4.43, the documented contract): an `input` event that is NOT one
        // of our own programmatic fills (see lastWrite/guardWrite) commits the
        // recalled draft to an independent new input — onInput() then drops the
        // recall, and from that point ↑/↓ are plain caret moves again.
        if (key === 'ArrowUp') {
          if (text.replace(/\s+/g, '') === '') {
            // Empty field: begin recall — instantly from the cache, else via the
            // (shared) fetch, which also covers a pre-fetch that is mid-flight.
            event.preventDefault()
            var entry = cache[sessionId]
            var list = entry ? entry.list : null
            if (list && list.length > 0) {
              recall = { sessionId: sessionId, list: list, index: 0 }
              guardWrite(input, list[0])
              setText(input, list[0])
            } else {
              loadHistory(sessionId, remoteSession).then(function (l) {
                if (l && l.length > 0 && focusInput() === input) {
                  recall = { sessionId: sessionId, list: l, index: 0 }
                  guardWrite(input, l[0])
                  setText(input, l[0])
                }
              })
            }
            return
          }
          if (inRecall && recall.index < recall.list.length - 1) {
            event.preventDefault()
            recall.index += 1
            guardWrite(input, recall.list[recall.index])
            setText(input, recall.list[recall.index])
            return
          }
          if (inRecall) {
            // At the OLDEST cached entry: pull the next older page on demand
            // (one page per press; no bulk reads, no unbounded memory).
            var older = cache[sessionId]
            if (older && older.hasMore && !older.deep) {
              event.preventDefault()
              fetchOlder(sessionId, remoteSession).then(function (added) {
                if (added === 0 || recall === null || recall.sessionId !== sessionId || focusInput() !== input) return
                // fetchOlder already shifted recall.index by `added`, so the
                // entry under the caret is unchanged; step one more so each
                // boundary ↑ lands on a new, older message.
                if (recall.index < recall.list.length - 1) {
                  recall.index += 1
                  guardWrite(input, recall.list[recall.index])
                  setText(input, recall.list[recall.index])
                }
              })
            }
            // Else: log start / capped / page already in flight -> no step.
            return
          }
          // Else: a plain (non-recall) draft -> leave the caret up to the browser.
          return
        }

        // key === 'ArrowDown'
        if (inRecall) {
          event.preventDefault()
          if (recall.index > 0) {
            recall.index -= 1
            guardWrite(input, recall.list[recall.index])
            setText(input, recall.list[recall.index])
          } else {
            guardWrite(input, '')
            setText(input, '')
            recall = null
          }
        }
        // Else: normal caret down (do not intercept).
      }

      // User-edit exit (0.4.43): any content change in the focused composer
      // while its recall is active — typing, IME commit, paste, cut, delete —
      // means the user has taken the recalled text as their own draft; the
      // arrows must stop navigating. The guard swallows only our own fills.
      function onInput(event) {
        if (enabled !== true) return
        if (recall === null) return
        var input = event && event.target
        if (!input) return
        var tag = input.tagName
        if (
          !input.isContentEditable &&
          tag !== 'TEXTAREA' &&
          !(tag === 'INPUT' && (input.type === 'text' || input.type === '' || input.type === 'search'))
        ) {
          return
        }
        var sessionId = sessionIdOf(input)
        if (!sessionId || recall.sessionId !== sessionId) return
        var w = lastWrite
        if (w && w.input === input && Date.now() < w.until && currentText(input) === w.text) return
        recall = null
      }

      function start() {
        if (started) return
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        started = true
        document.addEventListener('keydown', onKey, true)
        document.addEventListener('focusin', onFocus, true)
        document.addEventListener('input', onInput, true)
      }

      function stop() {
        if (!started) return
        if (typeof document === 'undefined' || typeof document.removeEventListener !== 'function') return
        started = false
        document.removeEventListener('keydown', onKey, true)
        document.removeEventListener('focusin', onFocus, true)
        document.removeEventListener('input', onInput, true)
        recall = null
      }

      function publish(sessionId, remoteSession) {
        if (!sessionId || !remoteSession) return
        registry[sessionId] = remoteSession
        setHistoryStats({ sessions: Object.keys(registry).length })
      }

      function forget(sessionId) {
        if (!sessionId) return
        if (registry[sessionId] !== undefined) {
          delete registry[sessionId]
          setHistoryStats({ sessions: Object.keys(registry).length })
        }
        if (fetching[sessionId]) delete fetching[sessionId]
        if (cache[sessionId]) delete cache[sessionId]
        if (recall !== null && recall.sessionId === sessionId) recall = null
      }

      function setConfig(next) {
        enabled = next && next.enabled !== false
        if (enabled !== true) recall = null
      }

      /** Wire the composer's public `setDraft` action face for a session. */
      function setActions(sessionId, inputActions) {
        if (!sessionId) return
        if (inputActions && typeof inputActions.setDraft === 'function') actionsBySession[sessionId] = inputActions
      }

      function clearActions(sessionId) {
        if (sessionId) delete actionsBySession[sessionId]
      }

      return {
        start: start,
        stop: stop,
        publish: publish,
        forget: forget,
        setConfig: setConfig,
        setActions: setActions,
        clearActions: clearActions,
      }
    }

    /**
     * Session occupant: renders a hidden span carrying the session id (so the
     * focused input can find its session by walking up), and hands that session's
     * `remote.session` to the engine. Mirrors the thinking-depth anchor.
     */
    function makeHistorySession(childCtx, engine) {
      return function HistorySessionContext(props) {
        var sessionId = props.sessionId
        var inputActions = props.inputActions
        var remoteSession = childCtx && childCtx.remote && childCtx.remote.session
        React.useLayoutEffect(
          function () {
            if (sessionId !== undefined && sessionId !== null) {
              engine.publish(String(sessionId), remoteSession)
              // The composer's public action face (setDraft). Writing drafts
              // through it uses DSH's own editor.update — the only path that
              // reliably clears the field (the DOM insertText('') is a no-op).
              engine.setActions(String(sessionId), inputActions)
            }
          },
          [sessionId, remoteSession, inputActions],
        )
        React.useEffect(
          function () {
            return function () {
              if (sessionId !== undefined && sessionId !== null) {
                engine.forget(String(sessionId))
                engine.clearActions(String(sessionId))
              }
            }
          },
          [sessionId],
        )
        return React.createElement('span', {
          'data-dshp-history': String(sessionId),
          hidden: true,
          style: { display: 'none' },
        })
      }
    }
