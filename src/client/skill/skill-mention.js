// Literal Codex-style skill mentions. Typing `$` or `￥` only opens a picker;
// it does not mutate the draft. Selecting a listed skill (Tab from the
// composer, Enter/Tab with the menu focused, or clicking an item) expands
// the typed token *immediately* into the literal markdown reference
//
//     [skill name](absolute SKILL.md path)
//
// plain visible text the user can keep editing — no hidden marker, no DOM
// decoration, no send-time rewriting (the draft is exactly what gets sent).
//
// Empty-composer special case: the token may sit at offset 0 — no leading
// space is needed when the box is empty. When the composer already has text,
// the space the user typed before the token is preserved; only the token
// itself is replaced.
//
// (0.4.35 shipped a private zero-width separator marker + blue-span
// decoration + a Host pre-step rewrite. That machinery detached from
// Lexical's live DOM and dropped characters while typing; 0.4.42 removes it
// in favour of the immediate literal expansion above.)
//
// 0.4.62 (Tab-select forensics): the rc.1 "empty composer + $ lists but
// Tab selects nothing" regression cannot be reproduced from the bundles
// alone, so every picker decision now records its branch — plus a snapshot
// of the live composer DOM/selection on open — into the keep-effort row's
// config `diagnostics.skillDiag` (z.dict(z.any()), volatile). The row
// config is readable from the host-side patch file, so one failed Tab in
// the GUI shows exactly which guard swallowed the key. Writes are
// debounced and fail-soft; the Tab path also falls back to the menu's own
// root when event.target no longer resolves to the composer.
//
// 0.4.66 (root cause found, forensics switched off): the user's overlay
// read (open → select → close, nothing filled, list re-appears = a SECOND
// open) plus the 0.4.12 composer-history finding identify the failure:
// `document.execCommand('insertText')` is a NO-OP in this Lexical
// composer — the browser reports success (so the old code closed the menu
// as "ok"), but Lexical's beforeinput handler declines the raw-DOM edit,
// so nothing is inserted; the keyup afterwards re-parses `$` and re-opens
// the menu (the "second list"). The fix writes through the composer's
// own `inputActions.setDraft` — DSH's editor.update channel, the same
// public face voice input uses and composer-history proved in 0.4.12.
// The on-screen diag overlay is disabled (SKILL_DIAG_OFF): the user found
// it unhelpful and the root cause no longer needs it.

var SKILL_MENTION_NS = 'dsh-polish:skill-loader'
var skillMentionStore = createStore({ catalog: [] })

function readSkillCatalog(response) {
  if (!response) return []
  var view = response && typeof response.ok === 'boolean'
    ? response.ok === true ? response.value : null
    : response.value || response
  var namespaces = view && Array.isArray(view.namespaces) ? view.namespaces : []
  var row = null
  for (var i = 0; i < namespaces.length; i++) {
    if (namespaces[i] && namespaces[i].ns === SKILL_MENTION_NS) {
      row = namespaces[i]
      break
    }
  }
  var catalog = row && row.value && Array.isArray(row.value.catalog) ? row.value.catalog : []
  return catalog.filter(function (skill) {
    return skill && typeof skill.name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)
  })
}

function startSkillCatalogPoll(remoteSettings) {
  var stopped = false
  var busy = false
  function refresh() {
    if (stopped || busy || !remoteSettings || typeof remoteSettings.describe !== 'function') return
    busy = true
    try {
      var pending = remoteSettings.describe()
      if (!pending || typeof pending.then !== 'function') {
        busy = false
        return
      }
      pending.then(function (response) {
        var catalog = readSkillCatalog(response)
        var previous = skillMentionStore.get().catalog || []
        if (JSON.stringify(previous) !== JSON.stringify(catalog)) skillMentionStore.set({ catalog: catalog })
      }).catch(function () {}).then(function () { busy = false })
    } catch (error) {
      busy = false
    }
  }
  refresh()
  var interval = setInterval(refresh, 2500)
  return function () {
    stopped = true
    clearInterval(interval)
  }
}

function skillComposerRoot(node) {
  if (!node) return null
  var current = node.nodeType === 1 ? node : node.parentElement
  while (current) {
    if (typeof current.getAttribute === 'function' && current.getAttribute('data-composer-input') !== null) return current
    current = current.parentElement || null
  }
  return null
}

function skillTextBeforeCaret(root) {
  try {
    var selection = window.getSelection && window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
    var node = selection.anchorNode
    if (!node || (node !== root && !root.contains(node))) return null
    var range = document.createRange()
    range.selectNodeContents(root)
    range.setEnd(node, selection.anchorOffset)
    return { text: range.toString(), node: node, offset: selection.anchorOffset }
  } catch (error) {
    return null
  }
}

function parseSkillQueryText(text) {
  if (typeof text !== 'string') return null
  var match = /(^|\s)([$￥])([a-zA-Z0-9_-]*)$/u.exec(text)
  if (!match) return null
  return {
    query: match[3].toLowerCase(),
    trigger: match[2],
    start: text.length - match[2].length - match[3].length,
    length: match[2].length + match[3].length,
  }
}

function parseSkillQuery(root) {
  var caret = skillTextBeforeCaret(root)
  if (!caret) return null
  var query = parseSkillQueryText(caret.text)
  if (!query) return null
  query.root = root
  return query
}

function findTextOffset(root, offset) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  var node
  var remaining = offset
  while ((node = walker.nextNode())) {
    var length = node.nodeValue ? node.nodeValue.length : 0
    if (remaining <= length) return { node: node, offset: remaining }
    remaining -= length
  }
  return null
}

function skillWholeText(root) {
  try {
    var range = document.createRange()
    range.selectNodeContents(root)
    return range.toString()
  } catch (error) {
    return String(root.textContent || '')
  }
}

// The selection is the whole component: replace exactly the typed token
// (trigger + query, which always ends at the caret) with the literal
// markdown reference. Both range endpoints come from a live TreeWalker over
// the composer's text nodes — no cached DOM reference that a Lexical
// re-render could detach (that stale anchor is what made the empty-composer
// token unselectable). When the saved position no longer matches the draft
// the live caret re-resolves the token; a failed lookup aborts — the draft
// is never rewritten on a guess.
// 0.4.62: returns '' on success, otherwise the name of the exact guard
// that aborted — the caller records it so a failed Tab is explainable
// instead of a silent no-op.
// 0.4.66: `inputActions` is the composer's public action face
// (props.inputActions on the session-scoped input slots — the object whose
// setDraft DSH's voice input uses). When present the write goes through
// setDraft, because the raw-DOM execCommand('insertText') NO-OPS in this
// Lexical editor (the 0.4.12 composer-history finding): the browser reports
// success while Lexical's beforeinput handler declines the edit, so the old
// path closed the menu as "ok" with nothing inserted. setDraft replaces the
// FULL draft, so the new draft is reconstructed as text-before + literal
// reference + text-after (the token always ends at the caret). A setDraft
// write resolves asynchronously ("one beat later"), so the success value is
// 'setDraft:<newText>' — insertAndClose verifies the composer text before
// closing the menu.
function insertSkillMention(view, skill, inputActions) {
  if (!view || !view.root || !skill || !skill.name) return 'no-view-skill'
  var token = view.trigger + (view.query || '')
  if (token.length === 0) return 'no-token'
  var path = typeof skill.path === 'string' ? skill.path : ''
  var replacement = '[' + skill.name + ']' + (path ? '(' + path + ')' : '') + ' '
  var root = view.root
  try {
    if (!root.isConnected) return 'root-disconnected'
    var text = skillWholeText(root)
    var start = view.start
    if (text.slice(start, start + token.length) !== token) {
      // The draft moved since the menu opened — re-resolve from the live
      // caret (the Tab path keeps the selection inside the composer).
      var live = parseSkillQuery(root)
      if (!live || (live.trigger + (live.query || '')) !== token) return 'token-mismatch'
      start = live.start
      text = skillWholeText(root)
      if (text.slice(start, start + token.length) !== token) return 'token-mismatch-live'
    }
    var newText = text.slice(0, start) + replacement + text.slice(start + token.length)
    if (inputActions && typeof inputActions.setDraft === 'function') {
      try {
        inputActions.setDraft(newText)
      } catch (error) {
        return 'setDraft-threw:' + String((error && error.message) || error)
      }
      return 'setDraft:' + newText
    }
    // Fallback (this slot got no inputActions): the legacy DOM path. It is
    // known to no-op in the Lexical composer, but it is the only channel
    // left there — the reason string keeps a failure explainable.
    var startPt = findTextOffset(root, start)
    var endPt = findTextOffset(root, start + token.length)
    if (!startPt || !endPt) return 'no-text-point'
    // Re-focus in case the click path blurred the composer before the
    // replace; the explicit range below then overrides the caret.
    if (typeof root.focus === 'function') root.focus()
    var selection = window.getSelection()
    if (!selection) return 'no-selection'
    var range = document.createRange()
    range.setStart(startPt.node, startPt.offset)
    range.setEnd(endPt.node, endPt.offset)
    selection.removeAllRanges()
    selection.addRange(range)
    var exec = null
    try {
      exec = typeof document.execCommand === 'function' && document.execCommand('insertText', false, replacement)
    } catch (error) {
      exec = 'threw:' + String((error && error.message) || error)
    }
    // Lexical may apply the edit through its own update loop, so the DOM
    // can lag one frame — capture the post-text for the record, but the
    // decision follows execCommand's own result.
    var after = skillWholeText(root)
    if (exec === true) return ''
    return 'exec-failed:' + String(exec) + '|after:' + after.slice(-80)
  } catch (error) {
    return 'threw:' + String((error && error.message) || error)
  }
}

// 0.4.66: run the insert, then — for the asynchronous setDraft write — poll
// the live composer text until it actually holds the literal reference (or
// the deadline passes) before telling the caller the menu may close. The
// old code closed on execCommand's return value, which lies here; that was
// the whole bug (menu closed "ok", nothing inserted, keyup re-opens the
// list). A failed verification leaves the menu open for a retry/click.
function insertAndClose(view, skill, inputActions, onDone) {
  var reason = insertSkillMention(view, skill, inputActions)
  if (typeof reason !== 'string' || reason.indexOf('setDraft:') !== 0) {
    onDone(reason)
    return
  }
  var newText = reason.slice('setDraft:'.length)
  var root = view.root
  var marker = '[' + skill.name + ']'
  var path = typeof skill.path === 'string' ? skill.path : ''
  var replacement = marker + (path ? '(' + path + ')' : '') + ' '
  var caretOffset = newText.indexOf(marker)
  if (caretOffset >= 0) caretOffset += replacement.length
  var deadline = Date.now() + 800
  function placeCaret() {
    // Best effort: put the caret right after the inserted reference so the
    // user can keep typing (setDraft does not promise a caret position).
    if (caretOffset < 0) return
    try {
      var point = findTextOffset(root, caretOffset)
      if (!point) return
      var selection = window.getSelection && window.getSelection()
      if (!selection || !document.createRange) return
      var range = document.createRange()
      range.setStart(point.node, point.offset)
      range.collapse(true)
      selection.removeAllRanges()
      selection.addRange(range)
    } catch (error) { /* cosmetic only */ }
  }
  function tick() {
    var applied = false
    try {
      var after = skillWholeText(root)
      applied = after === newText || (after.indexOf(marker) >= 0 && after.length >= newText.length - 1)
    } catch (error) { applied = false }
    if (applied) {
      placeCaret()
      onDone('')
      return
    }
    if (Date.now() < deadline) {
      setTimeout(tick, 50)
      return
    }
    onDone('setDraft-unverified')
  }
  setTimeout(tick, 30)
}

// 0.4.64: on-screen forensics. The row-config channel proved racy — the
// host-side keep-effort backstop snapshots config.diagnostics at apply time
// and its next flush rewrites the whole field with its stale (empty) copy,
// clobbering the client's record. The overlay has no such race: it renders
// the record at the moment the picker decision happens, bottom-left of the
// page, and fades after 12s. The user reads it directly; no file, no
// devtools, no cross-process writer.
function skillDiagOverlay(record) {
  try {
    var host = document.getElementById('dshp-skill-diag')
    if (host === null) {
      host = document.createElement('div')
      host.id = 'dshp-skill-diag'
      host.setAttribute('data-plugin', 'dsh-polish')
      host.style.cssText =
        'position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:640px;' +
        'max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;' +
        'font:11px ui-monospace,Consolas,monospace;line-height:1.5;color:#e8e8e8;' +
        'background:rgba(20,20,24,.92);border:1px solid rgba(255,255,255,.25);' +
        'border-radius:8px;padding:8px 10px;pointer-events:none;'
      document.body.appendChild(host)
    }
    var text = record.event
      + (record.how ? ' ' + record.how : '')
      + ' [' + (record.branch || (record.event === 'open' ? 'opened' : 'closed')) + ']'
      + (record.query !== undefined ? ' q="' + record.query + '"' : '')
      + (record.caretText !== undefined && record.caretText !== null ? ' caret="' + record.caretText + '"' : '')
      + (record.targetTag ? ' target=' + record.targetTag : '')
      if (record.html) text += '\n' + record.html
    host.textContent = 'skill-mention ' + text
    host.title = JSON.stringify(record)
    if (host.__diagTimer) window.clearTimeout(host.__diagTimer)
    host.__diagTimer = window.setTimeout(function () {
      host.__diagTimer = 0
      if (host.isConnected) host.remove()
    }, 12000)
  } catch (error) { /* fail-soft */ }
}

// 0.4.66: the on-screen forensics are OFF — the user found the overlay not
// useful, and the root cause (execCommand no-op, see header) is identified.
// The sink stays a no-op so every call site is untouched; flip this back to
// false to restore the 0.4.64 overlay for future forensics.
var SKILL_DIAG_OFF = true

// 0.4.62: debounced, fail-soft sink that records picker forensics into the
// keep-effort row's config (the same revision-guarded channel the effort
// records use); readable from the patch file without devtools.
// 0.4.64: the config write stays (harmless), but the authoritative evidence
// is the on-screen overlay — the host's flush can clobber the field.
function makeSkillDiagSink(child) {
  if (SKILL_DIAG_OFF) return function () {}
  var form = null
  try {
    form = child && child.configForms && typeof child.configForms.get === 'function'
      ? child.configForms.get(NS_KEEP_EFFORT)
      : null
  } catch (error) {
    form = null
  }
  var formOk = !!(form && typeof form.getSnapshot === 'function' && typeof form.mutate === 'function')
  if (!formOk) form = null
  var timer = 0
  var pending = null
  function flush() {
    timer = 0
    var rec = pending
    pending = null
    if (!rec) return
    var attempt = 0
    function write() {
      try {
        var snap = form.getSnapshot()
        if (!snap || snap.status !== 'ready' || snap.revision === undefined) return
        var value = snap.value && typeof snap.value === 'object' ? snap.value : {}
        var diag = value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics : {}
        diag.skillDiag = rec
        form.mutate([{ op: 'set', path: ['diagnostics'], value: diag }], snap.revision).then(
          function (ok) { if (!ok && attempt === 0) { attempt = 1; write() } },
          function () { if (attempt === 0) { attempt = 1; write() } },
        )
      } catch (error) { /* fail-soft */ }
    }
    write()
  }
  return function note(record) {
    // 0.4.64: the overlay is the primary evidence (no cross-process race);
    // the row-config write is best-effort on top.
    skillDiagOverlay(record)
    try {
      if (!formOk) return
      pending = record
      if (!timer) timer = setTimeout(flush, 600)
    } catch (error) { /* fail-soft */ }
  }
}

// Composer evidence for the diag record: what the editor actually holds and
// where the caret sits at the moment of interest.
function skillDiagSnapshot(root) {
  try {
    var before = skillTextBeforeCaret(root)
    var whole = skillWholeText(root)
    return {
      wholeLen: whole.length,
      wholeHead: whole.slice(0, 80),
      wholeTail: whole.slice(-80),
      caretText: before ? before.text.slice(-60) : null,
      caretNode: before ? before.node.nodeName : null,
      caretOffset: before ? before.offset : null,
      html: root.outerHTML.slice(0, 1500),
    }
  } catch (error) {
    return { diagError: String((error && error.message) || error) }
  }
}

function makeSkillMentionPicker(child) {
  var noteDiag = makeSkillDiagSink(child)
  return function SkillMentionPicker(props) {
    var state = useStore(skillMentionStore)
    var catalog = state && Array.isArray(state.catalog) ? state.catalog : []
    var [view, setView] = React.useState(null)
    var [selectedIndex, setSelectedIndex] = React.useState(0)
    var prevViewRef = React.useRef(null)
    // 0.4.66: the session-scoped input slots receive the composer's public
    // action face as a prop (the same uiSession.provide injection that hands
    // inputActions to the conversation.input.right slot — see composer-
    // history). setDraft through it is the write channel that actually lands
    // in the Lexical draft.
    var inputActions = props && props.inputActions

    // 0.4.62: record menu open/close with a composer DOM snapshot — the
    // open record is the evidence for the empty-composer case.
    React.useEffect(function () {
      if (!noteDiag) return
      var opened = !prevViewRef.current && !!view
      var closed = !!prevViewRef.current && !view
      if (!opened && !closed) return
      var rec = { at: Date.now(), event: opened ? 'open' : 'close' }
      if (view && view.root && view.root.isConnected) {
        rec.trigger = view.trigger
        rec.query = view.query
        rec.start = view.start
        rec = Object.assign(rec, skillDiagSnapshot(view.root))
      }
      noteDiag(rec)
      prevViewRef.current = view
    }, [view])

    React.useEffect(function () {
      function updateFromEvent(event) {
        var root = skillComposerRoot(event && event.target)
        if (!root) return
        var next = parseSkillQuery(root)
        setView(next)
        setSelectedIndex(0)
      }
      function onKeyDown(event) {
        if (!event) return
        var targetIsComposer = !!(event.target && event.target.isContentEditable === true)
        var isSelectKey = event.key === 'Tab' || (event.key === 'Enter' && !targetIsComposer)
        if (event.isComposing === true) {
          // Record it when a select key dies here — an IME-active Tab is
          // invisible otherwise (the menu stays open, nothing happens).
          if (noteDiag && view && isSelectKey) {
            noteDiag({ at: Date.now(), event: 'select-swallowed', how: event.key, keyCode: event.keyCode, branch: 'composing' })
          }
          return
        }
        if (!view) return
        if (event.key === 'Escape') {
          event.preventDefault()
          setView(null)
          return
        }
        var options = catalog.filter(function (skill) {
          return skill.name.toLowerCase().indexOf(view.query) === 0
        }).slice(0, 12)
        if (!options.length) {
          if (noteDiag && isSelectKey) {
            noteDiag({ at: Date.now(), event: 'select', how: event.key, branch: 'no-options', query: view.query, catalogLen: catalog.length })
          }
          return
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          setSelectedIndex(function (index) {
            var delta = event.key === 'ArrowDown' ? 1 : -1
            return (index + delta + options.length) % options.length
          })
          return
        }
        // Tab confirms from anywhere (composer or menu). Enter confirms only
        // while the menu itself holds focus — with the composer focused,
        // Enter sends the message and stays DSH's.
        if (isSelectKey) {
          var how = event.key === 'Tab' ? 'tab' : 'enter'
          var root = skillComposerRoot(event.target)
          var usedFallback = false
          if (!root && view.root && view.root.isConnected) {
            // 0.4.62: event.target can miss the composer (odd focus
            // target); the menu's own root is the composer it parsed from.
            root = view.root
            usedFallback = true
          }
          if (root !== view.root) {
            if (noteDiag) noteDiag({
              at: Date.now(), event: 'select', how: how, branch: 'root-mismatch',
              targetTag: event.target && event.target.tagName,
              targetEditable: !!(event.target && event.target.isContentEditable),
              fallback: usedFallback,
              viewConnected: !!(view.root && view.root.isConnected),
            })
            return
          }
          event.preventDefault()
          event.stopPropagation()
          var index = Math.min(selectedIndex, options.length - 1)
          // 0.4.66: the write is verified against the live composer text
          // before the menu closes (the setDraft channel lands a beat
          // later; the old execCommand return value was a lie).
          insertAndClose(view, options[index], inputActions, function (reason) {
            if (noteDiag) noteDiag({
              at: Date.now(), event: 'select', how: how, index: index, count: options.length,
              branch: reason === '' ? 'ok' : reason,
              fallback: usedFallback, keyCode: event.keyCode,
            })
            if (reason === '') setView(null)
          })
        }
      }
      function onFocusIn(event) {
        var root = skillComposerRoot(event && event.target)
        if (!root && view) setView(null)
      }
      document.addEventListener('input', updateFromEvent, true)
      document.addEventListener('keyup', updateFromEvent, true)
      document.addEventListener('click', updateFromEvent, true)
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('focusin', onFocusIn, true)
      return function () {
        document.removeEventListener('input', updateFromEvent, true)
        document.removeEventListener('keyup', updateFromEvent, true)
        document.removeEventListener('click', updateFromEvent, true)
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('focusin', onFocusIn, true)
      }
    }, [view, catalog, selectedIndex, inputActions])

    if (!view) return null
    var options = catalog.filter(function (skill) {
      return skill.name.toLowerCase().indexOf(view.query) === 0
    }).slice(0, 12)
    if (!options.length) return null
    return React.createElement(
      'div',
      {
        className: 'dshp-skill-mention-menu',
        role: 'listbox',
        'aria-label': 'Skills',
        style: {
          position: 'absolute',
          left: '8px',
          bottom: 'calc(100% + 8px)',
          zIndex: 1000,
          width: 'min(360px, calc(100vw - 32px))',
          maxHeight: '280px',
          overflowY: 'auto',
          padding: '5px',
          borderRadius: '10px',
          border: '1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.25))',
          background: 'var(--dsw-alias-bg-overlay, #fff)',
          color: 'var(--dsw-alias-label-primary, #1a1a1a)',
          boxShadow: '0 8px 28px rgba(0,0,0,.18)',
        },
      },
      options.map(function (skill, index) {
        var active = index === selectedIndex
        return React.createElement(
          'button',
          {
            key: skill.name,
            type: 'button',
            role: 'option',
            'aria-selected': active,
            onMouseDown: function (event) { event.preventDefault() },
            onMouseEnter: function () { setSelectedIndex(index) },
            onClick: function () {
              insertAndClose(view, skill, inputActions, function (reason) {
                if (noteDiag) noteDiag({ at: Date.now(), event: 'select', how: 'click', index: index, branch: reason === '' ? 'ok' : reason })
                if (reason === '') setView(null)
              })
            },
            style: {
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              borderRadius: '7px',
              padding: '8px 10px',
              cursor: 'pointer',
              color: 'inherit',
              background: active ? 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12))' : 'transparent',
            },
          },
          React.createElement('div', { style: { fontSize: '13px', fontWeight: 600 } }, '$' + skill.name),
          skill.description
            ? React.createElement('div', {
                style: {
                  marginTop: '2px',
                  fontSize: '11px',
                  lineHeight: 1.35,
                  color: 'var(--dsw-alias-label-secondary, #8a8f98)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }, skill.description)
            : null,
        )
      }),
    )
  }
}
