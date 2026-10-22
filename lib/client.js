// dsh-polish — client (browser) half.
//
// Written in the shipped-bundle form: `window.__ModuleLoader__.load({id, factory})`
// so the factory receives the module system's `require` and can pull React out of
// the shell's seed table. The row id ("dsh-polish") is the package name, which is
// what makes dsh-client-modules mount this half on the `dsh-polish` Loader row.
//
// Responsibilities:
//   1. the thinking-renderer DOM engine (component A), configured live from the
//      `dsh-polish:thinking-renderer` settings namespace;
//   2. the per-row configuration pages of every component, registered into the
//      Plugins page's keyed `plugins.row.config` slot as
//      `<bundle package>#<row id>`.
//
// All user-facing copy is Simplified Chinese and hard-coded on purpose: a bundle
// outside the app tree has no locale dictionary seat of its own, and the host
// falls back to raw keys when a dictionary is missing.
window.__ModuleLoader__.load({
  id: 'dsh-polish',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    // ------------------------------------------------------------------ names

    /** Settings namespace (== Loader entry id) of each component row. */
    var NS_RENDERER = 'dsh-polish:thinking-renderer'
    var NS_DEPTH = 'dsh-polish:thinking-depth'
    var NS_HISTORY = 'dsh-polish:composer-history'
    var NS_LRU = 'dsh-polish:workspace-lru'
    var NS_TIMER = 'dsh-polish:timer'
    var NS_NOTIFY = 'dsh-polish:notify'
    var NS_MODE_SWITCH = 'dsh-polish:mode-switch'
    var NS_SHELL_LOCAL = 'dsh-polish:shell-local'
    var NS_VISUALIZE = 'dsh-polish:visualize'
    var NS_PROMPTS = 'dsh-polish:prompts'
    var NS_KEEP_EFFORT = 'dsh-polish:keep-effort'
    var NS_SESSION_SLIM = 'dsh-polish:session-slim'
    /** Keyed `plugins.row.config` slot keys: `<bundle package>#<row id>`. */
    var ROW_KEY_RENDERER = 'dsh-polish#dsh-polish:thinking-renderer'
    var ROW_KEY_DEPTH = 'dsh-polish#dsh-polish:thinking-depth'
    var ROW_KEY_HISTORY = 'dsh-polish#dsh-polish:composer-history'
    var ROW_KEY_LRU = 'dsh-polish#dsh-polish:workspace-lru'
    var ROW_KEY_TIMER = 'dsh-polish#dsh-polish:timer'
    var ROW_KEY_NOTIFY = 'dsh-polish#dsh-polish:notify'
    var ROW_KEY_MODE_SWITCH = 'dsh-polish#dsh-polish:mode-switch'
    var ROW_KEY_SHELL_LOCAL = 'dsh-polish#dsh-polish:shell-local'
    var ROW_KEY_VISUALIZE = 'dsh-polish#dsh-polish:visualize'
    var ROW_KEY_PROMPTS = 'dsh-polish#dsh-polish:prompts'

    var RENDERER_DEFAULTS = { lines: 4, collapseMs: 140, autoOpen: true, showTime: true, followMs: 300 }
    var DEPTH_DEFAULTS = { showInComposer: true, palette: 'blue-purple', labels: true }
    var HISTORY_DEFAULTS = { enabled: true }
    var LRU_DEFAULTS = { enabled: true, subagent: true }
    var SHELL_LOCAL_DEFAULTS = { enabled: true }
    var VISUALIZE_DEFAULTS = { svg: true, mermaid: true }
    var TIMER_DEFAULTS = { enabled: true }
    var NOTIFY_DEFAULTS = { completeSound: false, completeNotify: false, attentionSound: false, attentionNotify: false }
    var MODE_SWITCH_DEFAULTS = { enabled: true }
    var PROMPTS_DEFAULTS = { enabled: true, active: 'default', custom: [] }
    /** Hidden session-occupant tag, written into the composer tool row. */
    var HISTORY_TAG = 'data-dshp-history'
    /**
     * How many user+assistant messages one `remote.session.page` request may
     * cover. Non-message events (tool calls, turn markers) ride along inside
     * the page but do not count against this.
     */
    var HISTORY_PAGE_MAX = 200
    /**
     * Recall cache cap per session: at most this many user messages are kept
     * in memory. Deeper pages are pulled on demand (one per ↑ at the oldest
     * entry) and oldest entries are dropped past this cap — no bulk reads,
     * no unbounded growth.
     */
    var HISTORY_RECALL_MAX = 200

    /**
     * 档位色阶。滑条按模型**声明的**档位数量在这些控制点之间插值，
     * 所以 3 档和 6 档都是同一条"浅蓝 → 深蓝 → 紫"的走法。
     */
    var DEPTH_PALETTES = {
      'blue-purple': [
        [0x9c, 0xc8, 0xff],
        [0x2f, 0x5b, 0xff],
        [0x6c, 0x4b, 0xf5],
        [0xa8, 0x55, 0xf7],
      ],
      brand: [
        [0x8f, 0xc2, 0xff],
        [0x2a, 0x6b, 0xff],
        [0x1b, 0x45, 0xcc],
        [0x11, 0x2a, 0x86],
      ],
      mono: [
        [0xc3, 0xc8, 0xd0],
        [0x8a, 0x8f, 0x98],
        [0x5c, 0x62, 0x6b],
        [0x33, 0x37, 0x3d],
      ],
    }
    /** 表示"不思考"的档位 id：中性灰，不参与色阶插值。 */
    var NEUTRAL_EFFORTS = ['off', 'none', 'disabled', 'false', '0']
    var NEUTRAL_COLOR = '#8a8f98'
    var NEUTRAL_RGB = [0x8a, 0x8f, 0x98]
    var DEPTH_STYLE_ID = 'dsh-polish-depth-style'
    var VIS_STYLE_ID = 'dsh-polish-visualize-style'
    /**
     * Slider geometry, in px, from the user's spec: r = the knob radius,
     * s = one uniform gap, l = the knob-centre travel (the render width minus
     * both end insets). Every value the CSS and the pointer math use is
     * derived from r and s below, so they cannot drift apart.
     */
    /** Knob radius r. */
    var KNOB_R = 10
    /** The uniform gap s: knob-to-wall top and bottom, and end-rim-to-wall. */
    var GAP = 4
    /** End inset = r + s: an end stop's centre from a track edge, = pill radius. */
    var INSET = KNOB_R + GAP
    /** Track height = 2r + 2s: the knob's diameter plus the gap on each side. */
    var TRACK_H = KNOB_R * 2 + GAP * 2

    /** Pinned to the DSH 0.2.0-rc.2 reasoning DOM contract. */
    var THINK_ROOT = '[data-variant="think"]'
    var PREVIEW_ATTR = 'data-dsh-polish-preview'
    var COLLAPSING_ATTR = 'data-dsh-polish-collapsing'
    var ENGINE_STYLE_ID = 'dsh-polish-engine-style'
    var FORM_STYLE_ID = 'dsh-polish-form-style'
    /** One line of the reasoning body; 4 lines == the reference 88px cap. */
    var LINE_PX = 22
    /** Distance from the bottom (px) that resumes live-follow. */
    var RESUME_FOLLOW_PX = 12

    function num(value, fallback, min, max) {
      var n = typeof value === 'number' ? value : Number(value)
      if (!isFinite(n)) return fallback
      if (n < min) return min
      if (n > max) return max
      return n
    }

    // ----------------------------------------------------------------- styles

    function upsertStyle(id, css) {
      if (typeof document === 'undefined') return null
      var el = document.getElementById(id)
      if (el === null) {
        el = document.createElement('style')
        el.id = id
        el.setAttribute('data-plugin', 'dsh-polish')
        document.head.appendChild(el)
      }
      if (el.textContent !== css) el.textContent = css
      return el
    }

    function engineCss(lines, collapseMs) {
      var maxPx = Math.round(lines * LINE_PX)
      // 0.4.56: rc.1 的 DisclosureRow 在 [data-open] 下多了一层
      // div[data-disclosure-header] 头包装（data-disclosure-row 内移）——
      // 选择器必须把它排除，否则裁剪/折叠动画会落到头包装上、落不到正文。
      var body = '[' + PREVIEW_ATTR + '="1"][data-variant="think"][data-state="running"] > [data-open] > :not([data-disclosure-row]):not([data-disclosure-header])'
      var folding = '[' + COLLAPSING_ATTR + '="1"][data-variant="think"] > [data-open] > :not([data-disclosure-row]):not([data-disclosure-header])'
      return [
        '/* dsh-polish: rolling ' + lines + '-line reasoning preview */',
        '/* 0.4.53: 预览窗口（未展开）锁定底部、禁止自由滚动——overflow hidden',
        '   后用户无法滚动该窗口（滚轮被 overscroll-behavior 挡住不冒泡到页面），',
        '   要看内容请展开。0.4.55: 去掉 CSS 平滑滚动（smooth）——Chromium 实测该属性下',
        '   下 plain scrollTop 赋值不生效（平滑动画被流式更新打断、窗口钉死顶端），',
        '   程序化钉底改走 behavior:instant 跳转。 */',
        body + ' {',
        '  max-height: ' + maxPx + 'px;',
        '  overflow-y: hidden;',
        '  overflow-x: hidden;',
        '  overscroll-behavior: contain;',
        '  scrollbar-width: none;',
        '}',
        body + '::-webkit-scrollbar { width: 0; height: 0; }',
        /* Elapsed-time chip on the reasoning header. Tabular numerals keep the
           digits a constant width so the seconds do not wiggle as they tick;
           it is the header's last child, so growing width pushes nothing. */
        '.dshp-think-time { pointer-events: none; font-variant-numeric: tabular-nums; font-size: 12px; line-height: 1; opacity: .7; color: var(--dsw-alias-label-secondary); margin-left: 8px; white-space: nowrap; }',
        folding + ' {',
        '  max-height: 0 !important;',
        '  opacity: 0;',
        '  overflow: hidden !important;',
        '  padding-top: 0 !important;',
        '  padding-bottom: 0 !important;',
        '  transition: max-height ' + collapseMs + 'ms ease, opacity ' + Math.max(20, collapseMs - 20) + 'ms ease, padding ' + collapseMs + 'ms ease;',
        '}',
        '@media (prefers-reduced-motion: reduce) {',
        '  ' + folding + ' { transition: none; }',
        '}',
      ].join('\n')
    }

    var FORM_CSS = [
      '.dshp-form { display: flex; flex-direction: column; gap: 16px; padding: 2px 0; min-width: 0; max-width: 100%; }',
      '.dshp-field { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }',
      /* 0.4.37：内容重的设置页（prompts）用单列纵向版式。
         旧 .dshp-field 的横向「标签|控件」在控件很宽时会把 min-width:0 的
         标签列压成单字宽（用户截图里的「提示词预览」竖排 bug）。 */
      '.dshp-section { display: flex; flex-direction: column; gap: 10px; }',
      '.dshp-section-head { display: flex; flex-direction: column; gap: 2px; }',
      '.dshp-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; min-width: 0; border: .5px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }',
      '.dshp-vfield { display: flex; flex-direction: column; gap: 6px; }',
      '.dshp-preview { margin: 0; padding: 10px 12px; min-height: 96px; max-height: 360px; overflow: auto; border: .5px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      /* 0.4.94：预览下方的说明行（标题 + 计数）——不再是 <pre> 的子节点。 */
      '.dshp-preview-meta { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; min-width: 0; }',
      '.dshp-radio-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; cursor: pointer; color: var(--dsw-alias-label-primary); }',
      '.dshp-radio-row:hover { background: var(--dsw-alias-interactive-bg-hover); }',
      '.dshp-radio-row[aria-current="true"] { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }',
      '.dshp-label { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }',
      '.dshp-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; min-width: 0; overflow-wrap: anywhere; }',
      '.dshp-tag { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }',
      /* 0.4.77：模式 radio 标签（此前用了未定义的 .dshp-radio 类，渲染成裸行内）。 */
      '.dshp-radio { display: flex; align-items: center; gap: 6px; cursor: pointer; }',
      '.dshp-control { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }',
      '.dshp-number { box-sizing: border-box; width: 92px; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; text-align: right; }',
      '.dshp-number:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      /* 0.4.72：session-slim 设置卡的分栏字段（小号标签 + 全宽文本框）。 */
      '.dshp-flabel { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }',
      '.dshp-text-input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }',
      '.dshp-text-input::placeholder { color: var(--dsw-alias-label-tertiary); }',
      '.dshp-text-input:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      '.dshp-btn-sm { height: 26px; padding: 0 10px; border-radius: 13px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 20px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }',
      '.dshp-btn-sm:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-btn-sm:disabled { opacity: .45; cursor: default; }',
      '.dshp-select { box-sizing: border-box; height: 32px; padding: 0 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }',
      '.dshp-select:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      /* 0.4.77：多行输入专用（此前 textarea 误用 32px 高的 .dshp-select 类）。 */
      '.dshp-textarea { box-sizing: border-box; width: 100%; min-height: 56px; padding: 8px 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.5; resize: vertical; }',
      '.dshp-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }',
      '.dshp-textarea:focus { outline: none; border-color: var(--dsw-alias-border-l2); }',
      '.dshp-switch { position: relative; flex: 0 0 auto; width: 40px; height: 22px; padding: 0; border: none; border-radius: 11px; background: var(--dsw-alias-border-l2); cursor: pointer; transition: background .15s ease; }',
      '.dshp-switch[aria-checked="true"] { background: var(--dsw-alias-button-primary-fill); }',
      '.dshp-knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-switch-thumb); transition: transform .15s ease; }',
      '.dshp-switch[aria-checked="true"] .dshp-knob { transform: translateX(18px); }',
      '.dshp-footer { display: flex; align-items: center; gap: 12px; }',
      /* 0.4.94：按钮不许被挤换行——nowrap + flex 不收缩 + 溢出省略。
         此前 .dshp-btn 只有固定高度，行内 flex 收缩时按钮里的文字会换行，
         固定高度装不下就溢出到按钮外面（用户截图：刷新按钮文字溢出组件）。 */
      '.dshp-btn { height: 32px; padding: 0 14px; border-radius: 16px; border: .5px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; white-space: nowrap; flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }',
      '.dshp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }',
      '.dshp-btn:disabled { opacity: .45; cursor: default; }',
      '.dshp-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }',
      '.dshp-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }',
      '.dshp-number:focus-visible, .dshp-select:focus-visible, .dshp-textarea:focus-visible, .dshp-btn:focus-visible, .dshp-switch:focus-visible, .dshp-text-input:focus-visible, .dshp-btn-sm:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }',
      '.dshp-note { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; min-width: 0; overflow-wrap: anywhere; }',
    ].join('\n')

    // ------------------------------------------------------- shared session registry
    //
    // The browser half is one module: every section below is concatenated into a
    // single factory scope, so a module-level object is shared across components.
    // This records the ONE session currently in view (a single-session view is the
    // normal case) so session-aware features can reach its Remote proxy without a
    // DOM walk. The thinking-time engine reads it to pull the current step's
    // reasoning-event timestamps; the always-on occupant below writes it.
    //
    // Unlike composer-history's per-feature registry, this one is not gated by any
    // component row: it is registered whenever the parent dsh-polish row is live,
    // so the time engine has a session even when composer-history is off.

    var sessionRegistry = { sessionId: null, session: null }

    function sessionRegistryPublish(sessionId, session) {
      sessionRegistry.sessionId = String(sessionId)
      sessionRegistry.session = session
    }

    function sessionRegistryForget(sessionId) {
      if (String(sessionRegistry.sessionId) === String(sessionId)) {
        sessionRegistry.sessionId = null
        sessionRegistry.session = null
      }
    }

    function sessionRegistryGet() {
      return sessionRegistry
    }

    /**
     * Session occupant: the session-scoped `conversation.input.right` seat hands
     * each occupant its `sessionId`; this captures that session's Remote proxy
     * into the registry and clears it on unmount. It renders nothing (returns
     * null) — it exists only to hold the session context.
     */
    function makeSessionCapture(childCtx) {
      return function SessionCapture(props) {
        var sessionId = props && props.sessionId
        var remoteSession = childCtx && childCtx.remote && childCtx.remote.session
        React.useLayoutEffect(
          function () {
            if (sessionId !== undefined && sessionId !== null) sessionRegistryPublish(String(sessionId), remoteSession)
          },
          [sessionId, remoteSession],
        )
        React.useEffect(
          function () {
            return function () {
              if (sessionId !== undefined && sessionId !== null) sessionRegistryForget(String(sessionId))
            }
          },
          [sessionId],
        )
        return null
      }
    }
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
    //     with it through the same `selectModel` the selector uses. The
    //     projection, the selector UI and the next request all converge on
    //     the remembered value.
    //
    // Storage is the keep-effort row's config (`effortRecords`, volatile),
    // shared with the host-side listener in keep-effort/index.js — a backstop
    // that records the effective effort from requests (agent-preset and other
    // non-UI switches included). Both write the same values, revision-guarded.
    // The row switch is the component switch (whileServed gate below).

    var KEEP_EFFORT_MAX_SESSIONS = 100

    function makeEffortKeeper(childCtx) {
      return function EffortKeeper(props) {
        var sessionId = props.sessionId
        var useProjection = typeof props.useProjection === 'function' ? props.useProjection : useNoProjection
        // The same durable projection the shipped model selector renders —
        // any model/effort change made here or in DSH's own selector lands here.
        var projected = useProjection('modelSelection', selectProjection, sameSelection)

        var formRef = React.useRef(null)
        var recordsRef = React.useRef({})
        var prevRef = React.useRef(null)

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
              // effort immediately — the same selectModel the selector uses, so
              // projection, UI and the next request all agree. Fail-open: any
              // error leaves the default in place.
              if (remembered !== undefined && remembered !== cur.reasoningEffort) {
                try {
                  childCtx.remote.session.selectModel({
                    sessionId: sessionId,
                    provider: cur.provider,
                    model: cur.model,
                    reasoningEffort: remembered,
                  })
                } catch (error) {
                  /* fail-open */
                }
              }
            } else if (cur.reasoningEffort !== prev.reasoningEffort) {
              // Same model, effort changed: the user switched effort (or our
              // own restore landed a moment ago — which is a no-op write,
              // skipped below). Persist immediately.
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

        return null
      }
    }
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
          // 0.4.100：Once recall has started, navigation is index-driven. Do this branch
          // before the empty-field check: the editor can briefly report '' while
          // an asynchronous setDraft/React update is still landing. Treating
          // that transient blank as a fresh recall used to reset to list[0], so
          // a fast second ↑ could appear to skip or repeat recent user messages.
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
                // The cache appends the older page at its tail. The active index
                // still names the previous oldest entry, so one increment lands
                // on exactly the first newly fetched user message.
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
    // ------------------------------------------------- workspace LRU (component D)
    //
    // DSH's sidebar groups sessions by workspace ("按项目分组"), but the GROUPS
    // themselves are always in the persisted workspace order (creation order) —
    // the store's `orderBy: "updated"` only orders the sessions *within* a group.
    // This component closes that gap: it ranks each group by the newest
    // `updatedAt` of the sessions it contains (LRU) and re-orders the workspace
    // list through the workspace service's persisted reorder
    // (`ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)`),
    // so React / AnimatedRows render the new order natively and the grouping is
    // untouched. The common case (you just used a workspace) is one call — move
    // it to the front; a full re-sort only happens on first enable, a membership
    // change, or after a manual drag desyncs the list.

    var LRU_POLL_MS = 1200 // cadence for the store poll
    var LRU_MAX_FULL_SORT = 200 // safety bound on a full re-sort's reorder calls

    var lruStatsStore = createStore({ workspaces: 0, lastMove: '', error: '', subagents: 0 })

    function setLruStats(patch) {
      lruStatsStore.set(Object.assign({}, lruStatsStore.get(), patch))
    }

    // Normalise a path so a workspace's `path` and a session's `cwd` compare
    // equal across separator style, trailing slash, and drive-letter case
    // (Windows `C:\` vs `c:\`). Without this, a case/slash mismatch makes every
    // lookup miss and the LRU silently degrades to creation order (no reorder).
    function normPath(p) {
      if (typeof p !== 'string' || !p) return ''
      return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    }

    function lruByPath(byId) {
      // normalised cwd -> newest updatedAt among that directory's sessions.
      var map = {}
      for (var id in byId) {
        var s = byId[id]
        if (s && typeof s.updatedAt === 'number') {
          var key = normPath(s.cwd)
          if (key && (map[key] === undefined || s.updatedAt > map[key])) map[key] = s.updatedAt
        }
      }
      return map
    }

    function lruOf(item, byPath) {
      var key = normPath(item.path)
      if (key && byPath[key] !== undefined) return byPath[key]
      var created = Date.parse(item.createdAt)
      return isNaN(created) ? 0 : created
    }

    function sameOrder(a, b) {
      if (a.length !== b.length) return false
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
      return true
    }

    function sameSet(a, b) {
      if (a.length !== b.length) return false
      var seen = {}
      var i
      for (i = 0; i < a.length; i++) seen[a[i]] = true
      for (i = 0; i < b.length; i++) if (!seen[b[i]]) return false
      return true
    }

    /**
     * The desired LRU order (workspaceIds, most-recent first). Ties keep the
     * current relative position, so the sort is stable and never thrashes.
     */
    function desiredOrder(items, byPath) {
      return items
        .map(function (item, index) {
          return { id: item.workspaceId, lru: lruOf(item, byPath), index: index }
        })
        .sort(function (a, b) {
          return b.lru - a.lru || a.index - b.index
        })
        .map(function (entry) {
          return entry.id
        })
    }

    // ------------------------------------------------- subagent catalog LRU
    //
    // DSH's subagent catalog (the tree under the conversation header's
    // 子智能体 action) lists each parent's direct children in CREATION order:
    // the projection (`subagentCatalog`) is an append-only event fold, and no
    // reorder API exists. Each entry only carries `{ id, createdAt, mode,
    // label }` — the "last used" signal lives in the sessions list store
    // (`byId[childId].updatedAt`, max of the child's session activity and
    // lastPromptAt; 0 while the child has no activity yet, then the entry's
    // `createdAt` decides).
    //
    // The LRU lands as an IN-PLACE re-sort of the catalog array the
    // projection store caches (`projectionsBySession[parentId].values.
    // subagentCatalog`). The store's `values()` map is shallow-frozen; the
    // inner array is the plain wire array and stays mutable — no DOM
    // patching, no React interference.
    //
    // SORT TIMING has two legs. (1) On OPEN: the trigger button — the one
    // and only `button[aria-haspopup="tree"]` in the DSH client (both the
    // root-session count action and the child-session switcher) — opens
    // three ways: click, hover-enter (delayed), and ArrowDown on the
    // trigger. A document-level CAPTURE listener for click/mouseenter/
    // keydown fires before React's delegated handlers, so the in-place
    // re-sort completes before the portal renders its rows: the list is
    // always displayed already in LRU order. (mouseenter does not bubble,
    // but capture-phase delivery reaches it on every target.)
    // (2) While OPEN (0.4.43): any subagent event re-folds that parent's
    // projection — including dispatches from NON-FOREGROUND sessions, since
    // every parent's catalog is re-sorted from the same global store — which
    // hands the dropdown a fresh, unsorted wire array; React then re-renders
    // the OPEN list in creation order. To keep the open list stable we
    // subscribe to the sessions snapshot store and re-sort SYNCHRONOUSLY
    // inside the store notification: snapshot stores notify all listeners in
    // the same setState pass, and React's useSyncExternalStore render only
    // reads the snapshot afterwards, so the re-sorted array is what the rows
    // render. The store watch is armed permanently once started but does a
    // single cheap `aria-expanded` query per notification and no work while
    // no dropdown is open.

    function subagentLruTimestamp(entry, byId) {
      var s = byId ? byId[entry.id] : null
      if (s && typeof s.updatedAt === 'number' && s.updatedAt > 0) return s.updatedAt
      return typeof entry.createdAt === 'number' ? entry.createdAt : 0
    }

    /**
     * Re-sort every served subagent catalog in place, most-recent first.
     * Ties keep their current position (stable, no thrash). Returns the
     * number of catalogs actually re-ordered this pass.
     */
    function sortSubagentCatalogs(sessions) {
      var snap
      try {
        snap = sessions.list.getSnapshot()
      } catch (error) {
        return 0 // the store is not ready yet
      }
      var byId = snap && snap.byId
      var projections = snap && snap.projectionsBySession
      if (!projections) return 0
      var sorted = 0
      for (var parentId in projections) {
        var catalogSnap = projections[parentId]
        var catalog = catalogSnap && catalogSnap.values ? catalogSnap.values.subagentCatalog : null
        if (!catalog || typeof catalog.length !== 'number' || catalog.length < 2) continue
        if (typeof Object.isFrozen === 'function' && Object.isFrozen(catalog)) continue
        var keys = []
        for (var i = 0; i < catalog.length; i++) {
          var entry = catalog[i]
          if (!entry || typeof entry.id !== 'string') continue
          keys.push({ id: entry.id, ts: subagentLruTimestamp(entry, byId), index: i })
        }
        if (keys.length !== catalog.length) continue
        keys.sort(function (a, b) {
          return b.ts - a.ts || a.index - b.index
        })
        var inOrder = true
        for (var j = 0; j < catalog.length; j++) {
          if (catalog[j].id !== keys[j].id) {
            inOrder = false
            break
          }
        }
        if (inOrder) continue
        // Apply the new order IN PLACE: same array identity, contents swapped.
        var entriesById = {}
        for (var k = 0; k < catalog.length; k++) entriesById[catalog[k].id] = catalog[k]
        var next = null
        try {
          next = keys.map(function (key) {
            return entriesById[key.id]
          })
          for (var m = 0; m < catalog.length; m++) catalog[m] = next[m]
        } catch (error) {
          continue // frozen in a newer runtime: leave creation order alone
        }
        sorted += 1
      }
      return sorted
    }

    /**
     * Is any subagent dropdown open right now? The trigger carries
     * `aria-expanded` bound to its open state, so one attribute query is a
     * reliable open probe (both trigger variants share the attribute).
     */
    function anyCatalogOpen() {
      if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return false
      try {
        return document.querySelector('button[aria-haspopup="tree"][aria-expanded="true"]') !== null
      } catch (error) {
        return false
      }
    }

    function createWorkspaceLru(workspaces, sessions) {
      var enabled = true
      var subagent = false
      var started = false
      var timer = null
      var inFlight = false
      var diagnosed = false
      var storeUnsubscribe = null

      // Use the workspace SERVICE face `ctx.workspaces.insertBefore(workspaceId,
      // beforeWorkspaceId)`: two positional args, applies an optimistic local
      // reorder, and reconciles the host echo. (Do NOT call the raw
      // `remote.workspace.insertBefore` with two positional strings — the raw
      // remote takes ONE object `{ workspaceId, beforeWorkspaceId }`, so the old
      // call silently failed on every reorder and nothing ever moved.)
      function callInsertBefore(id, beforeId) {
        if (!workspaces || typeof workspaces.insertBefore !== 'function') {
          return Promise.reject(new Error('workspaces.insertBefore 不可用'))
        }
        return beforeId === undefined
          ? workspaces.insertBefore(id)
          : workspaces.insertBefore(id, beforeId)
      }

      // Move one workspace to the very front (before the current first item).
      function moveToFront(topId, frontId) {
        return callInsertBefore(topId, frontId)
      }

      // Establish the whole `order` via insertBefore, placing back-to-front so
      // every anchor is already in place when its predecessor moves. The last
      // element is appended (omitting the anchor), the rest go before the
      // element that follows them.
      function fullResort(order) {
        var chain = Promise.resolve()
        for (var i = order.length - 1; i >= 0; i--) {
          ;(function (id, beforeId) {
            chain = chain.then(function () {
              return callInsertBefore(id, beforeId)
            })
          })(order[i], i === order.length - 1 ? undefined : order[i + 1])
        }
        return chain
      }

      function reOrder(current, desired) {
        if (sameOrder(current, desired)) return Promise.resolve()
        var limited = desired.length > LRU_MAX_FULL_SORT
        var target = limited ? desired.slice(0, LRU_MAX_FULL_SORT) : desired
        if (!sameSet(current, desired)) {
          // A workspace was added/removed: establish the LRU order.
          return limited ? moveToFront(desired[0], current[0]) : fullResort(target)
        }
        // Same set. If merely the most-recent workspace needs the front slot,
        // one call suffices; otherwise the tail is desynced (first enable or a
        // manual drag) and we establish the full order.
        var moved = [desired[0]].concat(current.filter(function (id) {
          return id !== desired[0]
        }))
        if (sameOrder(moved, desired)) {
          return desired[0] !== current[0] ? moveToFront(desired[0], current[0]) : Promise.resolve()
        }
        return limited ? moveToFront(desired[0], current[0]) : fullResort(target)
      }

      // The subagent catalog is sorted on OPEN (see installCatalogInteractions),
      // not here: no timer touches it while the list is closed.
      function poll() {
        if (!enabled || inFlight) return
        var wsSnap
        var seSnap
        try {
          wsSnap = workspaces.list.getSnapshot()
          seSnap = sessions.list.getSnapshot()
        } catch (error) {
          return // the stores are not ready yet
        }
        var items = wsSnap && wsSnap.items
        var byId = seSnap && seSnap.byId
        if (!items || !byId || items.length < 2) return
        var byPath = lruByPath(byId)
        var current = items.map(function (item) {
          return item.workspaceId
        })
        var desired = desiredOrder(items, byPath)
        setLruStats({ workspaces: items.length })
        // One-time diagnostic (console only): shows whether the workspaces'
        // `path` actually match the sessions' `cwd` (matched>0) and what order
        // we think we want. If matched=0 the paths never line up (lookup miss);
        // if matched>0 but current==desired the list is already in LRU order.
        if (!diagnosed && items.length >= 2) {
          diagnosed = true
          var matched = items.filter(function (item) {
            return byPath[normPath(item.path)] !== undefined
          }).length
          console.log(
            '[dshp lru] workspaces=' + items.length +
              ' sessions=' + Object.keys(byId).length +
              ' matched=' + matched +
              ' current=[' + current.join(',') + ']' +
              ' desired=[' + desired.join(',') + ']',
          )
        }
        if (sameOrder(current, desired)) return
        inFlight = true
        reOrder(current, desired).then(
          function () {
            inFlight = false
            setLruStats({ lastMove: new Date().toLocaleTimeString(), error: '' })
          },
          function (error) {
            inFlight = false
            setLruStats({ error: String((error && error.message) || error) })
          },
        )
      }

      // While a dropdown is open, every sessions-store notification (any
      // session's subagent activity, foreground or background) may have just
      // re-folded a catalog into a fresh unsorted array — re-sort it here,
      // synchronously inside the notification, so the imminent React render
      // reads LRU-ordered rows. Closed: one attribute query, nothing else.
      function onSessionsStoreUpdate() {
        if (!subagent) return
        // 0.4.90（修「有时排序、有时一点开不排序」）：不再用 anyCatalogOpen()
        // 门控。catalog 在 store 里随时可能被重新折叠成「创建序」的新数组；只要
        // 那次折叠伴随一次 store 通知，就在通知里同步重排——这样下拉无论在
        // 打开前、还是打开瞬间才加载/重折 catalog，读到的都是 LRU 序。原来的
        // 门控会跳过「打开瞬间 aria-expanded 还没翻成 true」的那次通知，于是
        // 间歇性渲染创建序。关闭状态下排序用户不可见，开销只是一次小数组排序。
        var sorted = sortSubagentCatalogs(sessions)
        if (sorted > 0) setLruStats({ subagents: sorted })
      }

      function startStoreWatch() {
        if (storeUnsubscribe !== null) return
        var list = sessions && sessions.list
        if (!list || typeof list.subscribe !== 'function') return
        try {
          storeUnsubscribe = list.subscribe(onSessionsStoreUpdate)
        } catch (error) {
          storeUnsubscribe = null // older runtimes without subscribe: open-time sort only
        }
      }

      function stopStoreWatch() {
        if (storeUnsubscribe !== null) {
          try {
            storeUnsubscribe()
          } catch (error) {}
          storeUnsubscribe = null
        }
      }

      var catalogListener = null
      var catalogListenerInstalled = false

      function subagentTriggerFrom(target) {
        if (!target || typeof target.closest !== 'function') return null
        try {
          return target.closest('button[aria-haspopup="tree"]')
        } catch (error) {
          return null
        }
      }

      function installCatalogInteractions() {
        if (catalogListenerInstalled) return
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return
        catalogListener = function (event) {
          if (!subagent) return // its own switch is off: zero work
          if (!subagentTriggerFrom(event && event.target)) return
          var sorted = sortSubagentCatalogs(sessions)
          if (sorted > 0) setLruStats({ subagents: sorted })
        }
        // Tag used by the regression harness to find this exact listener.
        catalogListener.__dshpCatalogLru = true
        // Capture phase: document sees every target's event before the bubble
        // phase reaches React's delegated root, i.e. before the open handler.
        var capture = { capture: true }
        document.addEventListener('click', catalogListener, capture)
        document.addEventListener('mouseenter', catalogListener, capture)
        document.addEventListener('keydown', catalogListener, capture)
        catalogListenerInstalled = true
      }

      function removeCatalogInteractions() {
        if (!catalogListenerInstalled) return
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('click', catalogListener)
          document.removeEventListener('mouseenter', catalogListener)
          document.removeEventListener('keydown', catalogListener)
        }
        catalogListenerInstalled = false
        catalogListener = null
      }

      function start() {
        if (started) return
        if (typeof setInterval !== 'function') return
        started = true
        timer = setInterval(poll, LRU_POLL_MS)
        poll()
        installCatalogInteractions()
        startStoreWatch()
      }

      function stop() {
        if (!started) return
        started = false
        if (timer !== null) {
          clearInterval(timer)
          timer = null
        }
        removeCatalogInteractions()
        stopStoreWatch()
      }

      function setConfig(patch) {
        if (patch && typeof patch.enabled === 'boolean') enabled = patch.enabled
        if (patch && typeof patch.subagent === 'boolean') subagent = patch.subagent
      }

      return { setConfig: setConfig, start: start, stop: stop }
    }
    // ================================================================== visualize
    //
    // 聊天可视化（组件 I）：把聊天消息里的 ```svg / ```mermaid 代码围栏渲染成图。
    //
    // —— 为什么是 DOM 级增强，怎么识别 ——
    //   DSH 的聊天 markdown 渲染器对 svg/mermaid 没有任何特判（特判的先例只有
    //   math → 公式），且这两个语言不在 shiki 语言表里 → 一律走 plain fallback：
    //   `div.md-code-block > [banner] + pre > code`，code 上没有 language class；
    //   banner 的语言标签对无语法语言显示的是通用「代码」标签而非语言名。
    //   所以识别只能靠：language-X class（为将来 DSH 原生支持兜底）+ 内容启发式：
    //     * svg:     正文以 <svg / <?xml（且含 <svg）开头；
    //     * mermaid: 首行是已知图类型关键字，且正文含 mermaid 结构记号
    //                （箭头 / participant / ::: / 节点形状等）——单独一个
    //                "graph" 变量名不会命中。
    //   流式块的内容是分批到达的，首块可能还判不出类型：所以卡片内的每个
    //   code 元素都先登记为「候选」（kind = null），内容一变就重判，判中即
    //   「晋升」并进入 settle 渲染流程；判不出的候选只挂一个内容 observer，
    //   静默后零开销。只处理挂在 `.md-code-block` 卡片下的 pre（聊天正文
    //   markdown）；工具卡等其它 pre 不碰。卡片结构若被 DSH 改版，识别落空
    //   → 围栏保持普通代码块（优雅降级，绝不破坏原 UI）。
    //
    // —— 性能边界（用户红线：开了可视化不许掉 fps）——
    //   * 零轮询：一个挂在 document.body 的 MutationObserver（childList+subtree）。
    //     流式分词产生的 addedNodes 是块内 span，过不了"含有 pre"过滤，O(added)
    //     廉价；自身插入的容器不含 pre，天然无反馈回路；
    //   * 每块只处理一次：fingerprint（长度 + 首尾 djb2）+ 全局 renderCache——
    //     虚拟化重挂载同内容时直接注入缓存产物，零解析；
    //   * 流式门控：每个候选 code 元素挂一个内容 observer，任何变化都重新
    //     settle（svg 250ms / mermaid 800ms 静默窗）；已渲染的块再变化有重
    //     渲染预算（默认 3 次），超预算放弃、等节点重挂载——长流式不会变成
    //     连续解析风暴；
    //   * 重活离关键路径：mermaid 渲染走串行队列 + requestIdleCallback；运行时
    //     首见才加载（require.async('./client.mermaid.js') —— DSH client-modules
    //     包内 chunk 协议，同源、HMR 感知、无 CDN）；
    //   * 静态展示：统一走 <img src="data:image/svg+xml">——浏览器光栅化，页面
    //     零 JS 参与；SMIL 动画在 img 内跑不占主线程；img 的 data-url 上下文
    //     天然不执行脚本、不发外网请求（消毒是第二层防线，为将来内联复用留的）；
    //   * 不抖：容器 max-height + overflow，img 高度 auto，插入一次成形。
    //   * 主题：暗色判定以 body[data-ds-dark-theme] 属性为权威（DSW 的暗色
    //     主题就是它），mermaid 按当前主题选 dark/default 渲染；主题翻转时
    //     已渲染的 mermaid 重画（svg 是用户内容原样展示，与主题无关不动），
    //     帧背景走 --dsw-alias-markdown-code-block 随主题自适应。
    //
    // —— 安全 ——
    //   行开关 = 总开关（bundle patch 里默认 disabled）；svg/mermaid 两个子开关
    //   是 volatile 实时开关（设置详情页改完立即生效，无需重启）。SVG 过严格
    //   消毒（script/foreignObject/事件属性/外部引用/危险 style）才成 data-url，
    //   且 100000 字符硬上限。Mermaid 走 securityLevel: strict。交互式 HTML
    //   （v3，Codex 式 ::codex-inline-vis）本版不做。
    //
    // —— DOM 契约（两种实测形状，按 pre 的实际父层插入，两者皆兼容）——
    //   rc.1（0.2.1-rc.1，dsh-web-frontend 实测）:
    //     div.md-code-block
    //       ├─ div.banner[data-code-block-banner]   （banner，语言标签）
    //       └─ div[data-code-block-content]
    //            └─ pre.plain > code               ← plain fallback（无语法）
    //   rc.2 契约（pre 是卡片直接子，无 content 层）:
    //     div.md-code-block
    //       ├─ div[data-code-block-banner]
    //       └─ pre > code
    //   本组件在 pre 的实际父层、pre 之前插入:
    //         div.dshp-vis[data-dshp-vis-card]
    //           ├─ div.dshp-vis-bar   > button.dshp-vis-toggle + span.dshp-vis-status
    //           └─ div.dshp-vis-frame > img
    //   图/码切换只改 display；原 pre 永远保留在 DOM（源码可复制、可回看）。

    var VIS_MAX_CHARS = 100000
    var VIS_SETTLE_SVG_MS = 250
    var VIS_SETTLE_MERMAID_MS = 800
    var VIS_RERENDER_BUDGET = 3
    var VIS_CACHE_LIMIT = 64
    var VIS_CARD_CLASS = 'md-code-block'
    var VIS_VIEW_STORAGE_KEY = 'dshp-visualize-view'

    /** mermaid 图类型关键字（首行第一个词必须命中）。 */
    var VIS_MERMAID_TYPES = [
      'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
      'stateDiagram-v2', 'erDiagram', 'journey', 'gantt', 'pie', 'mindmap',
      'timeline', 'quadrantChart', 'sankey', 'sankey-beta', 'xychart',
      'xychart-beta', 'requirementDiagram', 'packetDiagram', 'kanban',
      'gitGraph', 'C4Context', 'C4Container', 'C4Component', 'block',
      'architecture', 'zenuml',
    ]
    var VIS_MERMAID_TYPE_SET = {}
    for (var visTypeIdx = 0; visTypeIdx < VIS_MERMAID_TYPES.length; visTypeIdx++) {
      VIS_MERMAID_TYPE_SET[VIS_MERMAID_TYPES[visTypeIdx]] = true
    }
    /** 默认结构确认：箭头 / 参与者 / 样式引用 / 节点形状之一。 */
    var VIS_MERMAID_EDGE_RE = /-->|<-->|\.->|- ->|===|~~~|\bparticipant\b|\bactor\b|:::|\[\(|\[\[|--\[/
    /** 首行关键字后不带箭头的图类型，用各自的行内特征确认。 */
    var VIS_MERMAID_TYPE_CONFIRM = {
      gantt: /(^|\n)\s*(title|section|axisFormat|tickInterval|todayMarker)\s/,
      pie: /(^|\n)\s*:\s*[\w\u4e00-\u9fa5 .-]{1,40},\s*\d+/,
      journey: /(^|\n)\s*(title|section)\s/,
      timeline: /(^|\n)\s*(title|section)\s/,
      requirementDiagram: /(^|\n)\s*(title|req\b)/,
    }

    var VIS_CSS = [
      '.dshp-vis{margin:0 0 2px 0}',
      '.dshp-vis-bar{display:flex;align-items:center;gap:8px;margin:0 0 4px 0;min-height:18px}',
      '.dshp-vis-toggle{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:16px;padding:1px 8px;cursor:pointer}',
      '.dshp-vis-toggle:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dshp-vis-status{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-tertiary));font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:72%}',
      '.dshp-vis-frame{max-height:600px;overflow:auto;border-radius:var(--dsw-radius-md);padding:8px;background:var(--dsw-alias-markdown-code-block);text-align:center}',
      '.dshp-vis-frame img{max-width:100%;height:auto;display:inline-block}',
    ].join('')

    var visualizeStatsStore = createStore({ svg: 0, mermaid: 0, errors: 0, mermaidState: 'idle' })

    // ---- test seams（harness 通过 window.__DSH_POLISH_VISUALIZE_TEST__ 换掉）----
    var visSettleMs = { svg: VIS_SETTLE_SVG_MS, mermaid: VIS_SETTLE_MERMAID_MS }
    var parseSvgImpl = function (text) {
      var doc = new DOMParser().parseFromString(String(text), 'image/svg+xml')
      if (doc && doc.querySelector && doc.querySelector('parsererror')) return null
      var root = doc && doc.documentElement
      return root && root.tagName && String(root.tagName).toLowerCase() === 'svg' ? root : null
    }
    var serializeSvgImpl = function (root) {
      return new XMLSerializer().serializeToString(root)
    }
    var loadMermaidImpl = function () {
      return Promise.reject(new Error('dsh-polish: 动态 chunk 加载不可用（require.async 缺失）'))
    }

    /** 颜色亮度（0..1）；解析 #hex / rgb()，解析不出返回 null。 */
    function visColorLuminance(value) {
      var s = String(value == null ? '' : value).trim().toLowerCase()
      var m = /^#([0-9a-f]{3,8})$/.exec(s)
      if (m) {
        var h = m[1]
        if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
        var r = parseInt(h.slice(0, 2), 16)
        var g = parseInt(h.slice(2, 4), 16)
        var b = parseInt(h.slice(4, 6), 16)
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      }
      m = /^rgba?\(([^)]+)\)$/.exec(s)
      if (m) {
        var parts = m[1].split(/[\s,]+/)
        var pr = parseFloat(parts[0])
        var pg = parseFloat(parts[1])
        var pb = parseFloat(parts[2])
        if (isFinite(pr) && isFinite(pg) && isFinite(pb)) {
          return (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255
        }
      }
      return null
    }

    /** 当前是否暗色主题。
     * 判定顺序（DSW 0.2.0-rc.2 实测机制，token 定义在 welcome.css）：
     *   1) body 的 data-ds-dark-theme 属性 —— DSW 的暗色主题就是给 <body>
     *      挂这个属性（light 默认不挂，dark 挂上），是权威信号；
     *   2) 属性缺失时（例如未来 DSW 换机制）退回 token 亮度：
     *      --dsw-specific-bubble / --dsw-alias-bg-base 在双主题下都有定义；
     *   3) 都读不到退回系统偏好。
     */
    function isDarkTheme() {
      try {
        var body = document && document.body
        if (body && typeof body.hasAttribute === 'function' && body.hasAttribute('data-ds-dark-theme')) {
          return true
        }
        var cs = getComputedStyle(document.documentElement)
        var names = ['--dsw-specific-bubble', '--dsw-alias-bg-base']
        for (var i = 0; i < names.length; i++) {
          var lum = visColorLuminance(cs.getPropertyValue(names[i]))
          if (lum !== null) return lum < 0.45
        }
        return matchMedia('(prefers-color-scheme: dark)').matches
      } catch (error) {
        return false
      }
    }

    /** 内容指纹：长度 + 首尾 djb2——区分流式增量足够，且比全量 hash 便宜。 */
    function visFingerprint(text) {
      var t = String(text == null ? '' : text)
      var n = t.length
      var head = n > 256 ? t.slice(0, 256) : t
      var tailStart = n > 512 ? n - 256 : 0
      var tail = t.slice(tailStart)
      var s = n + ':' + head.length + ':' + tail.length + head + tail
      var h = 5381
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
      return h + ':' + n
    }

    /** 围栏语言识别。返回 'svg' | 'mermaid' | null（不是可视化块）。 */
    function visDetectKind(text, codeClass) {
      if (codeClass) {
        if (/\blanguage-mermaid(?:js)?\b|\blanguage-mmd\b/.test(codeClass)) return 'mermaid'
        if (/\blanguage-svg\b/.test(codeClass)) return 'svg'
      }
      var t = String(text == null ? '' : text)
      var n = t.length
      if (n === 0) return null
      var i = 0
      while (i < n) {
        var c = t.charCodeAt(i)
        if (c > 32 && c !== 0xfeff) break
        i += 1
      }
      if (i >= n) return null
      var rest = t.slice(i)
      if (rest.charAt(0) === '<') {
        if (/^<svg[\s>]/i.test(rest)) return 'svg'
        if (rest.indexOf('<?xml') === 0 && rest.indexOf('<svg') !== -1) return 'svg'
        return null
      }
      var lineEnd = rest.indexOf('\n')
      var firstLine = lineEnd === -1 ? rest : rest.slice(0, lineEnd)
      var m = /^([A-Za-z][A-Za-z0-9-]*)/.exec(firstLine)
      if (!m) return null
      var type = m[1]
      if (!VIS_MERMAID_TYPE_SET[type]) return null
      var confirm = VIS_MERMAID_TYPE_CONFIRM[type]
      if (confirm) return confirm.test(t) ? 'mermaid' : null
      return VIS_MERMAID_EDGE_RE.test(t) ? 'mermaid' : null
    }

    /** 该 kind 当前是否被配置允许渲染。 */
    function visKindEnabled(kind, cfg) {
      if (!kind) return false
      if (kind === 'svg') return !!cfg.svg
      if (kind === 'mermaid') return !!cfg.mermaid
      return false
    }

    /**
     * SVG 消毒：就地删除危险节点/属性，返回删除的节点数。
     * 只依赖最小 DOM 树 API（nodeType/tagName/childNodes/attributes/
     * getAttribute/removeAttribute/parentNode/removeChild），真实 SVG DOM 与
     * harness 假树都满足。
     */
    function visSanitizeSvgNode(root) {
      var dropped = 0
      function walk(node) {
        if (!node || node.nodeType !== 1) return
        var tag = String(node.tagName || '').toLowerCase()
        if (
          tag === 'script' || tag === 'foreignobject' || tag === 'iframe' ||
          tag === 'object' || tag === 'embed' || tag === 'image'
        ) {
          if (node.parentNode) node.parentNode.removeChild(node)
          dropped += 1
          return
        }
        if (node.getAttribute) {
          var href = node.getAttribute('href')
          if (href === null) href = node.getAttribute('xlink:href')
          if ((tag === 'use' || tag === 'a') && href !== null && href !== '' && href.charAt(0) !== '#') {
            if (node.parentNode) node.parentNode.removeChild(node)
            dropped += 1
            return
          }
        }
        var names = []
        if (node.attributes && node.attributes.length) {
          for (var a = 0; a < node.attributes.length; a++) names.push(node.attributes[a].name)
        }
        for (var j = 0; j < names.length; j++) {
          var name = names[j]
          var low = String(name).toLowerCase()
          var val = node.getAttribute ? node.getAttribute(name) || '' : ''
          if (/^on/i.test(low)) {
            node.removeAttribute(name)
          } else if ((low === 'href' || low === 'xlink:href') && val !== '' && val.charAt(0) !== '#') {
            node.removeAttribute(name)
          } else if (low === 'style' && /url\s*\(|javascript:|expression\s*\(/i.test(val)) {
            node.removeAttribute(name)
          }
        }
        var kids = []
        if (node.childNodes) {
          for (var k = 0; k < node.childNodes.length; k++) kids.push(node.childNodes[k])
        }
        for (var c2 = 0; c2 < kids.length; c2++) walk(kids[c2])
      }
      walk(root)
      return dropped
    }

    /** 从 SVG 文本里读 viewBox 宽高比（插入前定好 img 的 aspect-ratio，防抖）。 */
    function visSvgAspect(text) {
      var m = /<svg[^>]*\bviewBox\s*=\s*["']([^"']+)["']/i.exec(String(text == null ? '' : text))
      if (!m) return null
      var parts = m[1].split(/[\s,]+/)
      if (parts.length !== 4) return null
      var w = parseFloat(parts[2])
      var h = parseFloat(parts[3])
      if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null
      return w / h
    }

    function visSvgToDataUrl(serialized) {
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(String(serialized))
    }

    function visViewMode() {
      try {
        var v = localStorage.getItem(VIS_VIEW_STORAGE_KEY)
        return v === 'code' ? 'code' : 'diagram'
      } catch (error) {
        return 'diagram'
      }
    }
    function visSetViewMode(mode) {
      try {
        localStorage.setItem(VIS_VIEW_STORAGE_KEY, mode === 'code' ? 'code' : 'diagram')
      } catch (error) {}
    }

    function createVisualize() {
      var cfg = { svg: false, mermaid: false }
      var observer = null
      var styleInjected = false
      /** code element -> track entry（Map；unmount 时显式清理，不靠 GC）。 */
      var tracked = new Map()
      /** fingerprint -> 渲染产物（src/dataUrl），虚拟化重挂载零解析。 */
      var renderCache = new Map()
      var renderQueue = []
      var renderBusy = false
      var mermaidApi = null
      var mermaidLoading = null
      var mermaidTheme = null
      var renderSeq = 0
      /** body 的 data-ds-dark-theme 属性观察者（DSW 的主题就是它）。 */
      var themeObs = null

      function statsPatch(patch) {
        visualizeStatsStore.set(Object.assign({}, visualizeStatsStore.get(), patch))
      }
      function cacheSet(fp, payload) {
        renderCache.set(fp, payload)
        if (renderCache.size > VIS_CACHE_LIMIT) {
          var first = renderCache.keys().next().value
          renderCache.delete(first)
        }
      }
      function readCodeText(entry) {
        var el = entry.code
        // rc.1 渲染器把每行放在 <span class="line"> 里（plain fallback 与
        // shiki 高亮同构），行与行之间只有一个空格文本节点——直接读
        // textContent 会把多行代码压成一行，mermaid 解析直接挂
        // （"flowchart LR A[...]" Expecting NEWLINE）。所以：code 的直接子
        // 是 line span 时按行重建（丢行间的分隔空格，补回真实换行）；
        // 没有 line span（整段纯文本，自带换行）就原样读 textContent。
        var kids = el && el.childNodes
        if (kids && kids.length > 0) {
          var lines = null
          for (var i = 0; i < kids.length; i++) {
            var k = kids[i]
            if (k.nodeType !== 1 || !hasLineClass(k)) continue
            if (lines === null) lines = []
            lines.push(k.textContent == null ? '' : k.textContent)
          }
          if (lines && lines.length > 0) return lines.join('\n')
        }
        return String(el.textContent == null ? '' : el.textContent)
      }
      /** 元素是否带 `line` class（rc.1 plain fallback 与 shiki 的行都是它）。 */
      function hasLineClass(el) {
        var c = el.className
        if (typeof c !== 'string' || c === '') return false
        var parts = c.split(/\s+/)
        for (var i = 0; i < parts.length; i++) if (parts[i] === 'line') return true
        return false
      }
      function isConnected(entry) {
        try {
          return !!entry.code.isConnected && !!entry.card.isConnected
        } catch (error) {
          return false
        }
      }

      // ---------------------------------------------------------------- card DOM
      function cardOf(pre) {
        var node = pre
        for (var depth = 0; node && depth < 8; depth++) {
          var cls = node.className
          if (typeof cls === 'string' && cls.indexOf(VIS_CARD_CLASS) !== -1) return node
          node = node.parentNode
        }
        return null
      }
      function findPre(node) {
        try {
          if (node.matches && node.matches('pre')) return node
          if (node.querySelector) return node.querySelector('pre')
        } catch (error) {}
        return null
      }

      // ---------------------------------------------------------------- container
      function ensureContainer(entry) {
        if (entry.container) return entry.container
        if (!styleInjected) {
          try {
            upsertStyle(VIS_STYLE_ID, VIS_CSS)
            styleInjected = true
          } catch (error) {}
        }
        var container = document.createElement('div')
        container.setAttribute('class', 'dshp-vis')
        container.setAttribute('data-dshp-vis-card', 'true')
        var bar = document.createElement('div')
        bar.setAttribute('class', 'dshp-vis-bar')
        var toggle = document.createElement('button')
        toggle.setAttribute('type', 'button')
        toggle.setAttribute('class', 'dshp-vis-toggle')
        var status = document.createElement('span')
        status.setAttribute('class', 'dshp-vis-status')
        status.setAttribute('aria-live', 'polite')
        bar.appendChild(toggle)
        bar.appendChild(status)
        var frame = document.createElement('div')
        frame.setAttribute('class', 'dshp-vis-frame')
        container.appendChild(bar)
        container.appendChild(frame)
        toggle.addEventListener('click', function () {
          var next = visViewMode() === 'code' ? 'diagram' : 'code'
          visSetViewMode(next)
          refreshAllViews()
        })
        try {
          // pre 未必是卡片的直接子节点：0.2.1-rc.1 的卡片在卡片与 pre 之间多一层
          // div[data-code-block-content]（rc.2 契约里 pre 是卡片直接子）。真浏览器
          // 的 insertBefore(newNode, ref) 要求 ref 是直接子，否则抛
          // HierarchyRequestError——静默吞掉会让 svg/mermaid 全部不出图（0.4.50
          // 实测故障）。所以永远在 pre 实际所在的那一层、pre 之前插入：两种
          // DOM 形状下都是「卡片内、pre 上方」。
          var host = entry.pre.parentNode || entry.card
          host.insertBefore(container, entry.pre)
        } catch (error) {
          return null
        }
        entry.container = container
        entry.toggle = toggle
        entry.statusEl = status
        entry.frame = frame
        return container
      }
      function refreshViewsFor(entry) {
        if (!entry.container) return
        // 没有图（未渲染 / 渲染失败）时源码必须可见，切换钮收起。
        var hasImage = !!entry.img && entry.error === null
        var diagram = hasImage && visViewMode() === 'diagram'
        if (entry.img) entry.img.style.display = diagram ? 'inline-block' : 'none'
        entry.pre.style.display = diagram ? 'none' : ''
        if (entry.toggle) {
          entry.toggle.textContent = hasImage ? (diagram ? '代码' : '图示') : ''
          entry.toggle.style.display = hasImage ? '' : 'none'
        }
      }
      function refreshAllViews() {
        tracked.forEach(function (entry) {
          refreshViewsFor(entry)
        })
      }

      // ---------------------------------------------------------------- payloads
      function buildSvgPayload(text) {
        var root = parseSvgImpl(text)
        if (!root) return Promise.reject(new Error('不是合法的 SVG 文档'))
        visSanitizeSvgNode(root)
        var serialized = serializeSvgImpl(root)
        if (!serialized || String(serialized).indexOf('<svg') < 0) {
          return Promise.reject(new Error('SVG 序列化失败'))
        }
        return Promise.resolve({
          src: visSvgToDataUrl(serialized),
          aspect: visSvgAspect(text),
        })
      }

      function ensureMermaid() {
        if (mermaidApi) return Promise.resolve(mermaidApi)
        if (mermaidLoading) return mermaidLoading
        statsPatch({ mermaidState: 'loading' })
        mermaidLoading = loadMermaidImpl()
          .then(function (mod) {
            var api = mod && (mod.default || mod.mermaid) || mod
            if (!api || typeof api.render !== 'function') {
              throw new Error('Mermaid 运行时缺少 render')
            }
            mermaidApi = api
            statsPatch({ mermaidState: 'ready' })
            return api
          })
          .catch(function (error) {
            mermaidLoading = null
            statsPatch({ mermaidState: 'failed' })
            throw error
          })
        return mermaidLoading
      }

      function buildMermaidPayload(text) {
        return ensureMermaid().then(function (api) {
          var dark = isDarkTheme()
          if (mermaidTheme !== dark) {
            try {
              api.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' })
            } catch (error) {}
            mermaidTheme = dark
          }
          renderSeq += 1
          var id = 'dshp-mmd-' + renderSeq
          var out
          try {
            out = api.render(id, text)
          } catch (error) {
            return Promise.reject(error)
          }
          var p = out && typeof out.then === 'function' ? out : Promise.resolve(out)
          return p.then(function (res) {
            var svg = res && typeof res === 'object' ? res.svg : res
            if (typeof svg !== 'string' || svg.indexOf('<svg') < 0) {
              throw new Error('Mermaid 没有产出 SVG')
            }
            return { src: visSvgToDataUrl(svg), aspect: null }
          })
        })
      }

      // ---------------------------------------------------------------- theme
      /** 主题翻转后：已渲染的 mermaid 图要按新主题重画。
       *  mermaid 的 dark/default 是渲染时烤进 SVG 的固定色（产物走 <img>，
       *  无法靠页面 CSS 变量变色），所以必须重渲；svg 围栏是用户内容
       *  原样展示，与主题无关，不动。
       *  重渲不走 settle 预算（用户主动切主题，一次性事件）。 */
      function rethemeMermaid() {
        mermaidTheme = null // 强制 buildMermaidPayload 重新 initialize
        tracked.forEach(function (entry) {
          if (entry.kind !== 'mermaid' || !entry.renderedFp) return
          if (!isConnected(entry)) return
          var text = readCodeText(entry)
          var fp = visFingerprint(text)
          if (fp !== entry.fingerprint) return // 内容在变，settle 流程会处理
          renderBlock(entry, text, fp)
        })
      }
      function startThemeObserver() {
        if (themeObs) return
        if (typeof MutationObserver === 'undefined' || !document || !document.body) return
        themeObs = new MutationObserver(function (records) {
          for (var i = 0; i < records.length; i++) {
            if (records[i] && records[i].attributeName === 'data-ds-dark-theme') {
              rethemeMermaid()
              break
            }
          }
        })
        themeObs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      }
      function stopThemeObserver() {
        if (themeObs) {
          try {
            themeObs.disconnect()
          } catch (error) {}
          themeObs = null
        }
      }

      // ---------------------------------------------------------------- rendering
      function commitRender(entry, fp, payload) {
        ensureContainer(entry)
        if (!entry.container) return
        var img = entry.img
        if (!img) {
          img = document.createElement('img')
          img.setAttribute('alt', '可视化图')
          entry.frame.appendChild(img)
          entry.img = img
        }
        img.setAttribute('src', payload.src)
        if (payload.aspect) img.style.aspectRatio = String(payload.aspect)
        img.style.display = ''
        entry.statusEl.textContent = ''
        entry.error = null
        entry.renderedFp = fp
        entry.rerenders = (entry.rerenders || 0) + 1
        refreshViewsFor(entry)
        var s = visualizeStatsStore.get()
        statsPatch(entry.kind === 'svg' ? { svg: s.svg + 1 } : { mermaid: s.mermaid + 1 })
      }

      function markError(entry, message) {
        ensureContainer(entry)
        if (!entry.container) return
        if (entry.img) entry.img.style.display = 'none'
        entry.statusEl.textContent = String(message || '渲染失败').slice(0, 160)
        entry.error = String(message || '渲染失败')
        entry.pre.style.display = ''
        refreshViewsFor(entry)
        statsPatch({ errors: visualizeStatsStore.get().errors + 1 })
      }

      /** 缓存键：mermaid 的产物依赖当前主题（dark/default），必须进键；
       *  svg 是用户内容原样展示，与主题无关。 */
      function cacheKeyFor(entry, fp) {
        return entry.kind === 'mermaid' ? fp + (isDarkTheme() ? '#d' : '#l') : fp
      }

      function doRender(entry, text, fp) {
        var cacheKey = cacheKeyFor(entry, fp)
        var cached = renderCache.get(cacheKey)
        var p
        if (cached) {
          p = Promise.resolve(cached)
        } else if (entry.kind === 'svg') {
          p = buildSvgPayload(text)
        } else {
          p = buildMermaidPayload(text)
        }
        return p.then(
          function (payload) {
            // 异步间隙里内容又变了 / 节点已卸载 → 丢弃本次结果。
            if (fingerprintStale(entry, fp) || !isConnected(entry)) return
            cacheSet(cacheKey, payload)
            commitRender(entry, fp, payload)
          },
          function (error) {
            if (!isConnected(entry)) return
            markError(entry, error && error.message ? String(error.message) : '渲染失败')
          },
        )
      }

      function fingerprintStale(entry, fp) {
        if (entry.fingerprint !== fp) return true
        return visFingerprint(readCodeText(entry)) !== fp
      }

      function pumpQueue() {
        if (renderBusy) return
        if (renderQueue.length === 0) return
        renderBusy = true
        var step = function () {
          var job = renderQueue.shift()
          if (!job) {
            renderBusy = false
            return
          }
          doRender(job.entry, job.text, job.fp).then(step, step)
        }
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(step, { timeout: 500 })
        } else {
          setTimeout(step, 0)
        }
      }

      function renderBlock(entry, text, fp) {
        if (entry.kind === 'mermaid') {
          renderQueue.push({ entry: entry, text: text, fp: fp })
          pumpQueue()
        } else {
          doRender(entry, text, fp)
        }
      }

      // ---------------------------------------------------------------- settling
      function onSettle(entry) {
        var text = readCodeText(entry)
        var fp = visFingerprint(text)
        if (fp !== entry.fingerprint) {
          onTrackedTextChange(entry)
          return
        }
        if (!isConnected(entry)) {
          forgetEntry(entry)
          return
        }
        if (!visKindEnabled(entry.kind, cfg)) return
        if (text.length > VIS_MAX_CHARS) {
          markError(entry, '内容过大（超过 ' + VIS_MAX_CHARS + ' 字符），保留代码视图')
          return
        }
        // 已渲染过的块再变化：消耗重渲染预算，防长流式解析风暴。
        if (entry.renderedFp) {
          var extraRerenders = (entry.rerenders || 0) - 1
          if (extraRerenders >= VIS_RERENDER_BUDGET) return
        }
        renderBlock(entry, text, fp)
      }

      function scheduleSettle(entry) {
        if (entry.timer) clearTimeout(entry.timer)
        var delay = entry.kind === 'mermaid' ? visSettleMs.mermaid : visSettleMs.svg
        entry.timer = setTimeout(function () {
          entry.timer = null
          onSettle(entry)
        }, delay)
      }

      function onTrackedTextChange(entry) {
        var text = readCodeText(entry)
        var fp = visFingerprint(text)
        if (fp === entry.fingerprint) return
        entry.fingerprint = fp
        var kind = visDetectKind(text, entry.code.className || '')
        entry.kind = kind
        if (visKindEnabled(kind, cfg)) scheduleSettle(entry)
      }

      // ---------------------------------------------------------------- tracking
      function trackCard(pre) {
        var card = cardOf(pre)
        if (!card) return
        var code = pre.querySelector ? pre.querySelector('code') || pre : pre
        // 初值指纹必须与 settle/变化路径用同一口径（readCodeText：line span
        // 重建换行）——rc.1 里裸 textContent 是压平的单行文本，两种口径的
        // 指纹不同会让 onSettle 误判 stale，白白多等一个 settle 周期。
        var entry = tracked.get(code)
        var text = entry ? readCodeText(entry) : readCodeText({ code: code })
        var fp = visFingerprint(text)
        if (entry) {
          if (entry.fingerprint === fp && entry.pre === pre) return
          entry.card = card
          entry.pre = pre
          entry.fingerprint = fp
          maybePromote(entry)
          return
        }
        entry = {
          card: card,
          pre: pre,
          code: code,
          kind: null,
          fingerprint: fp,
          timer: null,
          textObs: null,
          rerenders: 0,
          renderedFp: null,
          container: null,
          toggle: null,
          statusEl: null,
          frame: null,
          img: null,
          error: null,
        }
        tracked.set(code, entry)
        if (typeof MutationObserver !== 'undefined') {
          entry.textObs = new MutationObserver(function () {
            onTrackedTextChange(entry)
          })
          entry.textObs.observe(code, { childList: true, subtree: true, characterData: true })
        }
        maybePromote(entry)
      }

      /** 候选 → 正式跟踪：判出类型且配置允许才排 settle，否则只保持监听。 */
      function maybePromote(entry) {
        var text = readCodeText(entry)
        var kind = visDetectKind(text, entry.code.className || '')
        entry.kind = kind
        if (visKindEnabled(kind, cfg)) scheduleSettle(entry)
      }

      function forgetEntry(entry) {
        if (entry.timer) {
          clearTimeout(entry.timer)
          entry.timer = null
        }
        if (entry.textObs) {
          try {
            entry.textObs.disconnect()
          } catch (error) {}
          entry.textObs = null
        }
        if (entry.code) tracked.delete(entry.code)
      }

      function forgetContaining(node) {
        var dead = []
        tracked.forEach(function (entry) {
          try {
            if (node === entry.card || node === entry.pre || node === entry.code) dead.push(entry)
            else if (node.contains && (node.contains(entry.code) || node.contains(entry.card))) dead.push(entry)
          } catch (error) {}
        })
        for (var i = 0; i < dead.length; i++) forgetEntry(dead[i])
      }

      // ---------------------------------------------------------------- observer
      function onMutations(records) {
        if (!(cfg.svg || cfg.mermaid)) return
        for (var i = 0; i < records.length; i++) {
          var rec = records[i]
          // 属性/字符记录没有 addedNodes（主题属性观察者共用 body 的
          // MutationObserver 广播时会出现），空数组兜底。
          var added = rec.addedNodes || []
          for (var a = 0; a < added.length; a++) {
            var node = added[a]
            if (!node || node.nodeType !== 1) continue
            var pre = findPre(node)
            if (pre) trackCard(pre)
          }
          var removed = rec.removedNodes || []
          for (var r = 0; r < removed.length; r++) {
            var gone = removed[r]
            if (gone && gone.nodeType === 1) forgetContaining(gone)
          }
        }
      }

      function startObserver() {
        if (observer) return
        if (typeof MutationObserver === 'undefined' || !document || !document.body) return
        observer = new MutationObserver(onMutations)
        observer.observe(document.body, { childList: true, subtree: true })
        startThemeObserver()
      }
      function stopObserver() {
        if (observer) {
          try {
            observer.disconnect()
          } catch (error) {}
          observer = null
        }
        stopThemeObserver()
        tracked.forEach(function (entry) {
          if (entry.timer) {
            clearTimeout(entry.timer)
            entry.timer = null
          }
        })
      }

      // ---------------------------------------------------------------- lifecycle
      return {
        setConfig(next) {
          var wasActive = cfg.svg || cfg.mermaid
          cfg.svg = !!next.svg
          cfg.mermaid = !!next.mermaid
          var nowActive = cfg.svg || cfg.mermaid
          if (nowActive && !wasActive) startObserver()
          else if (!nowActive && wasActive) stopObserver()
          // 开关变化后给已有候选一次晋升机会（静默的 svg/mermaid 块立即出图）。
          if (nowActive) {
            tracked.forEach(function (entry) {
              if (!entry.renderedFp && !entry.timer) maybePromote(entry)
            })
          }
        },
        start() {
          // 配置由 syncVisualize 推；这里保持幂等。
          if (cfg.svg || cfg.mermaid) startObserver()
        },
        stop() {
          stopObserver()
          tracked.forEach(function (entry) {
            forgetEntry(entry)
          })
          tracked.clear()
          renderQueue.length = 0
          renderBusy = false
        },
      }
    }

    // 生产接线：DSH client-modules 的 `require.async("./client.<x>.js")` 是包内
    // 动态 chunk 的官方通道（同源、带 rev、HMR 感知）。harness 的 require stub
    // 没有 async —— 保持默认拒绝实现，正好走"chunk 加载失败"的错误路径测试。
    if (typeof require === 'function' && typeof require.async === 'function') {
      loadMermaidImpl = function () {
        return require.async('./client.mermaid.js')
      }
    }

    // ---- harness 测试缝：浏览器环境导出内部纯函数与可替换实现。----
    if (typeof window !== 'undefined') {
      window.__DSH_POLISH_VISUALIZE_TEST__ = {
        detectKind: visDetectKind,
        sanitizeSvgNode: visSanitizeSvgNode,
        fingerprint: visFingerprint,
        svgAspect: visSvgAspect,
        statsStore: visualizeStatsStore,
        setSettleMs: function (svg, mermaid) {
          if (svg !== undefined) visSettleMs.svg = svg
          if (mermaid !== undefined) visSettleMs.mermaid = mermaid
        },
        setParseSvg: function (fn) {
          parseSvgImpl = fn
        },
        setSerializeSvg: function (fn) {
          serializeSvgImpl = fn
        },
        setLoadMermaid: function (fn) {
          loadMermaidImpl = fn
        },
        resetLoadMermaid: function () {
          loadMermaidImpl = function () {
            return Promise.reject(new Error('dsh-polish: 动态 chunk 加载不可用（require.async 缺失）'))
          }
        },
      }
    }
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

    // ------------------------------------------------- timer row clock icon
    //
    // host 半（timer/index.js）把「当前有活动倒计时的会话 id」写进本行的
    // volatile（非持久）设置字段 activeTimerSessionIds。设置文档是
    // host<->client 共享且变更自动同步的，所以这里读它，在会话行最左边的
    // LEADING 单元格里画一个小时钟。
    //
    // 关键点：DSH 的行首单元格逻辑是
    //   showStatus ? <SessionStatusDots/> : renderSlot("sidebar.session.row.leading")
    // 即会话「进行中 / 待审批 / 有完成未读」时显示它自己的状态点，
    // 只有「空闲/已完成」时才渲染 sidebar.session.row.leading 这个插槽
    // （默认空）。所以往这个插槽注册组件，就恰好只在空闲态出现、
    // 且不会碰到进行中等其它状态的图标 —— 与需求完全对齐。

    // 活动计时器的会话 id 列表 + 每个会话「下一次触发」的时间戳（来自 host 的
    // volatile 设置）。fireAt: sessionId -> 毫秒时间戳（一个会话多计时器取最早）。
    var timerActiveStore = createStore({ sessionIds: [], fireAt: {} })

    // 由 apply.js 的 syncAll（设置镜像订阅）调用：读 volatile 字段、更新 store。
    // 只在「活动会话集合真的变了」时更新 + 打一条 console（便于确认 host→client
    // 通道是否真的通：set/cancel/最后到点时各看到一行）。
    function applyTimerActive(ctx) {
      var read = readNamespace(ctx, NS_TIMER, TIMER_DEFAULTS)
      var ids = read.value && Array.isArray(read.value.activeTimerSessionIds) ? read.value.activeTimerSessionIds : []
      var fireAt =
        read.value && read.value.activeTimerFireAt && typeof read.value.activeTimerFireAt === 'object'
          ? read.value.activeTimerFireAt
          : {}
      pushActive(ids, fireAt, 'mirror')
    }

    // 统一的「活动会话集合变化」落点：仅在集合真的变了时更新 store + 打一条
    // warn 级日志（便于在 DevTools 里确认通道 + 是哪个触发源）。
    function fireMapEqual(a, b) {
      var ka = Object.keys(a)
      var kb = Object.keys(b)
      if (ka.length !== kb.length) return false
      for (var i = 0; i < ka.length; i++) if (a[ka[i]] !== b[ka[i]]) return false
      return true
    }

    function pushActive(ids, fireAt, source) {
      var list = Array.isArray(ids) ? ids : []
      var fires = fireAt && typeof fireAt === 'object' ? fireAt : {}
      var prev = timerActiveStore.get()
      if (list.join(',') === (prev.sessionIds || []).join(',') && fireMapEqual(fires, prev.fireAt || {})) return
      timerActiveStore.set({ sessionIds: list, fireAt: fires })
      console.warn('[dshp timer-icon](' + source + ') 活动会话 = [' + list.join(', ') + ']')
    }

    // 最稳的数据通道：定时做一次 fresh 远端读（remote.settings.describe()，
    // DSH 的设置镜像也是这么从 host 取的），绕过「事件是否转发 / 镜像是否
    // 触发本地订阅」的不确定性。每 1.5s 读一次，读到 activeTimerSessionIds
    // 变了就更新 store。计时器行关着 / 没有计时器时读到空数组，图标自然消失。
    function startTimerPoll(remoteSettings) {
      var interval = null
      function readActive() {
        try {
          var p = remoteSettings && remoteSettings.describe ? remoteSettings.describe() : null
          if (!p || typeof p.then !== 'function') return
          p.then(function (response) {
            var view = response && response.value ? response.value : null
            var namespaces = view && Array.isArray(view.namespaces) ? view.namespaces : []
            var row = null
            for (var i = 0; i < namespaces.length; i++) {
              if (namespaces[i] && namespaces[i].ns === NS_TIMER) { row = namespaces[i]; break }
            }
            var ids =
              row && row.value && Array.isArray(row.value.activeTimerSessionIds)
                ? row.value.activeTimerSessionIds
                : []
            var fireAt =
              row && row.value && row.value.activeTimerFireAt && typeof row.value.activeTimerFireAt === 'object'
                ? row.value.activeTimerFireAt
                : {}
            pushActive(ids, fireAt, 'poll' + (row ? '' : ':ns-absent'))
          }).catch(function () {})
        } catch (error) {}
      }
      readActive()
      interval = setInterval(readActive, 1500)
      return function () {
        if (interval) clearInterval(interval)
      }
    }

    // 一个 13px 时钟字形，用内联 SVG（继承颜色、无需图片资源）。
    function ClockGlyph() {
      return React.createElement(
        'svg',
        {
          className: 'dshp-timer-clock',
          width: 13,
          height: 13,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
        React.createElement('path', { d: 'M12 7v5l3 2' }),
      )
    }

    // 每秒刷新一次的本地时间戳，让悬停提示里的「还剩多久」跟着秒走。
    // active 为 false 时不起定时器（不活跃的行零开销）。
    function useNow(active, intervalMs) {
      var pair = React.useState(Date.now())
      React.useEffect(
        function () {
          if (!active) return
          var t = setInterval(function () {
            pair[1](Date.now())
          }, intervalMs)
          return function () {
            clearInterval(t)
          }
        },
        [active, intervalMs],
      )
      return pair[0]
    }

    // 「还剩多久」：毫秒差 -> 「X 小时 Y 分 / X 分 Y 秒 / X 秒」。
    function formatRemaining(ms) {
      var totalSec = Math.max(0, Math.round(ms / 1000))
      var h = Math.floor(totalSec / 3600)
      var m = Math.floor((totalSec % 3600) / 60)
      var s = totalSec % 60
      if (h > 0) return h + ' 小时 ' + m + ' 分'
      if (m > 0) return m + ' 分' + (s > 0 ? ' ' + s + ' 秒' : '')
      return s + ' 秒'
    }

    // 「几点钟触发」：触发时间戳 -> 本地时钟（24h）；跨天加 明天 / 具体日期。
    function fireClockLabel(fireAt, now) {
      var d = new Date(fireAt)
      var n = new Date(now)
      function sod(x) {
        return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      }
      var diff = Math.round((sod(d) - sod(n)) / 86400000)
      function pad(x) {
        return (x < 10 ? '0' : '') + x
      }
      var hhmm = pad(d.getHours()) + ':' + pad(d.getMinutes())
      if (diff === 0) return hhmm
      if (diff === 1) return '明天 ' + hhmm
      if (diff === -1) return '昨天 ' + hhmm
      return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + hhmm
    }

    // 悬停提示：有触发时间 -> 「剩 X · HH:MM 触发」；没有（旧 host/未同步）-> 兜底。
    function timerTooltip(fireAt, now) {
      if (typeof fireAt !== 'number' || !isFinite(fireAt) || fireAt <= now) return '有计时器在跑'
      return '剩 ' + formatRemaining(fireAt - now) + ' · ' + fireClockLabel(fireAt, now) + ' 触发'
    }

    // 行首时钟组件工厂：闭包捕获 timerActiveStore，插槽渲染时给它 { sessionId }。
    function makeTimerLeadingIcon(store) {
      return function TimerLeadingIcon(props) {
        var sessionId = props.sessionId
        var state = useStore(store)
        var key = String(sessionId)
        var active = state && Array.isArray(state.sessionIds) && state.sessionIds.indexOf(key) >= 0
        var fireAt = state && state.fireAt && typeof state.fireAt[key] === 'number' ? state.fireAt[key] : undefined
        var now = useNow(active, 1000)
        if (!active) return null
        return React.createElement(
          'span',
          {
            className: 'dshp-timer-icon',
            title: timerTooltip(fireAt, now),
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              flex: '0 0 auto',
              color: '#e8a33d',
            },
          },
          ClockGlyph(),
        )
      }
    }
    // ------------------------------------------------- mode switch ("..." 菜单)
    //
    // 在会话「...」菜单里加一组「切换模式」项（一个标签 + 每个 agent 预设一个
    // menuitem），把一个会话切到任意预设（内建 + 自定义）。
    //
    // host 半（mode-switch/index.js）轮询本行 volatile 设置里的 request，用
    // agentPresets.recompose 切换（干净替换成那组工具），写回 result。这里：
    //   - 挂载时拉一次预设列表（remote.agentPresets.list()）缓存到 store；
    //   - 点某个预设 → 写 `dsh-polish:mode-switch: { request: {sessionId, preset, nonce} }`；
    //   - 轮询读 result（打日志）；用户从会话顶部状态栏看新模式。
    //
    // 说明：这里渲染的是自绘的 `<button role="menuitem">`（不走 primitives 的
    // MenuItemButton——bundle 在 app 树外、require 不到 primitives）。Menu 的键盘
    // 导航按 `button:not(:disabled)` 收集，所以自绘按钮也参与上下键；菜单的收起
    // 交给 Menu 自身（外部点击 / Esc / closeOnPointerLeave）。二级预设列表是
    // createPortal 到 body 的独立卡片（见 makeModeSwitchMenu 的设计注释）。

    // 预设列表缓存：挂载（=菜单打开）时拉一次，后续打开立即显示 + 可后台刷新。
    var modeSwitchStore = createStore({ presets: [], currentBySession: {} })

    // 解析 remote.agentPresets.list() 的返回（AgentPresetRoster = { presets: [...] }）。
    function extractModePresets(response) {
      var roster = response && typeof response.ok === 'boolean' ? (response.ok === true ? response.value : null) : response
      var list = roster && Array.isArray(roster.presets) ? roster.presets : Array.isArray(roster) ? roster : []
      var out = []
      for (var i = 0; i < list.length; i++) {
        var row = list[i]
        if (!row || !row.id) continue
        out.push({
          id: String(row.id),
          label: typeof row.name === 'string' && row.name.trim() !== '' ? row.name : String(row.id),
          isDefault: row.isDefault === true,
        })
      }
      return out
    }

    // 拉一次预设列表落到 store（store 已有就不覆盖，保留缓存）。
    function fetchModePresets(child) {
      var agentPresets = child && child.remote && child.remote.agentPresets
      if (!agentPresets || typeof agentPresets.list !== 'function') return
      try {
        agentPresets
          .list()
          .then(function (response) {
            // Remote methods return RemoteResult<{...}>. Keep a bare-roster
            // fallback for older hosts, but never treat { ok:false } as an
            // empty successful catalog (that made the menu silently vanish).
            if (response && response.ok === false) {
              var error = response.error && response.error.message ? response.error.message : String(response.error || '预设列表读取失败')
              console.warn('[dshp mode-switch] 预设列表读取失败：' + error)
              return
            }
            var list = extractModePresets(response)
            if (list.length > 0 && modeSwitchStore.get().presets.length === 0) {
              modeSwitchStore.set({ presets: list, currentBySession: modeSwitchStore.get().currentBySession || {} })
            }
          })
          .catch(function () {})
      } catch (error) {}
    }

    // Ask the Host for the live session's currently composed preset so the
    // nested menu can mark it. Cold sessions are not resumed just to draw a check.
    function requestCurrentMode(child, sessionId) {
      var nonce = Date.now()
      var settings = child && child.remote && child.remote.settings
      if (!sessionId || !settings || typeof settings.update !== 'function') return
      try {
        var pending = settings.update(NS_MODE_SWITCH, { request: { sessionId: String(sessionId), preset: '', nonce: nonce, action: 'current' } }, void 0)
        if (pending && typeof pending.catch === 'function') pending.catch(function () {})
      } catch (error) {}
    }

    // 发起切换：写 volatile 设置 request；host 轮询到后 recompose + 写回 result。
    function requestModeSwitch(child, sessionId, presetId) {
      var nonce = Date.now()
      try {
        var settings = child && child.remote && child.remote.settings
        if (settings && typeof settings.update === 'function') {
          var result = settings.update(
            NS_MODE_SWITCH,
            { request: { sessionId: String(sessionId), preset: presetId, nonce: nonce, action: 'switch' } },
            void 0,
          )
          if (result && typeof result.then === 'function') {
            result
              .then(function (response) {
                if (response && response.ok === false) {
                  var error = response.error && response.error.message ? response.error.message : String(response.error || '写入请求失败')
                  console.warn('[dshp mode-switch] 请求未写入：' + error)
                }
              })
              .catch(function (error) {
                console.warn('[dshp mode-switch] 请求写入失败：' + (error && error.message ? error.message : String(error)))
              })
          }
        }
        console.warn('[dshp mode-switch] 请求把会话 ' + sessionId + ' 切到预设 ' + presetId)
      } catch (error) {}
    }

    // 轮询读 result（volatile 设置），仅用于打日志（用户从会话顶部状态栏看新模式）。
    // result 一经写入就留在行配置里（host 不清理），所以必须按 nonce 去重——
    // 否则同一结果每 1.5s 重打一条（曾刷屏 90+ 次）。
    function startModeSwitchResultPoll(remoteSettings) {
      var interval = null
      var lastLoggedNonce = 0
      function readResult() {
        try {
          var p = remoteSettings && remoteSettings.describe ? remoteSettings.describe() : null
          if (!p || typeof p.then !== 'function') return
          p
            .then(function (response) {
              var view = response && response.value ? response.value : null
              var namespaces = view && Array.isArray(view.namespaces) ? view.namespaces : []
              var row = null
              for (var i = 0; i < namespaces.length; i++) {
                if (namespaces[i] && namespaces[i].ns === NS_MODE_SWITCH) {
                  row = namespaces[i]
                  break
                }
              }
              var result = row && row.value && row.value.result ? row.value.result : null
              if (result && typeof result.nonce === 'number' && result.nonce !== lastLoggedNonce) {
                lastLoggedNonce = result.nonce
                if (result.ok === true && result.sessionId && typeof result.currentPreset === 'string') {
                  var current = modeSwitchStore.get().currentBySession || {}
                  if (current[result.sessionId] !== result.currentPreset) {
                    var next = Object.assign({}, current)
                    next[result.sessionId] = result.currentPreset
                    modeSwitchStore.set({ presets: modeSwitchStore.get().presets, currentBySession: next })
                  }
                }
                console.warn(
                  '[dshp mode-switch] 切换结果 nonce=' + result.nonce + ' ok=' + result.ok +
                    (result.error ? '（' + result.error + '）' : ''),
                )
              }
            })
            .catch(function () {})
        } catch (error) {}
      }
      readResult()
      interval = setInterval(readResult, 1500)
      return function () {
        if (interval) clearInterval(interval)
      }
    }

    // 两级模式列表（0.4.32：真·双列表）。
    //
    // 一级 = 「...」菜单里的「切换模式」行；二级 = 一张独立的卡片，打开时
    // 出现在菜单卡片旁边（右侧优先，视口放不下翻到左侧），样式与一级菜单
    // 同源（浮层底 + 阴影 + 圆角），视觉上就是两张并排的列表。
    //
    // 技术要点（为什么是 createPortal 到 body）：
    //  1) 「...」菜单的列表 portal:true + scrollable（viewport 带
    //     overflow-y:auto），挂在行内的 absolute 浮层会被裁成横条——
    //     0.4.29 的 bug。portaled 卡片在 body 下，物理上不受裁剪。
    //  2) 菜单开着的时候卡片必须活着。React 的 pointerenter/leave 按
    //     fiber 树（而非 DOM 树）计算：卡片是本组件经 createPortal 渲染
    //     的，fiber 上是「...」Menu 根 span 的后代，所以指针停在卡片上
    //     不会触发菜单的 closeOnPointerLeave——菜单自然保持打开。
    //  3) 卡片上 pointerdown 必须 stopPropagation：Menu 的"外部点击关闭"
    //     监听在 document 上、按 DOM 包含判断，portaled 卡片不在其 DOM
    //     里，不拦会被当成外部点击把菜单关掉。
    //  4) 菜单以任何方式关闭（外部点击 / Esc / 选了别的项）时，本组件
    //     随之卸载，portal 由 React 自动拆除——卡片不需要手动清理。
    //
    // 交互：单击「切换模式」开/关（纯点击，无 hover 开合）；点预设 =
    // 发起切换 + 关卡片 + 关「...」菜单；卡片外点击 / Esc 由菜单自身
    // 逻辑关闭（卡片随之消失）；打开期间跟随锚点（滚动/缩放重算）。
    var modeSwitchReactDOM = null
    try {
      var modeSwitchReactDom = require('react-dom')
      if (modeSwitchReactDom && typeof modeSwitchReactDom.createPortal === 'function') modeSwitchReactDOM = modeSwitchReactDom.createPortal
    } catch (error) {}

    // 定位估算宽：卡片本体按内容自适应（width: max-content，上限即此值），
    // 翻转决策用上限值，保证任何实际宽度都不溢出视口。
    var MODE_SWITCH_CARD_WIDTH = 240
    var MODE_SWITCH_CARD_GAP = 10

    function computeModeSwitchCardPosition(rowRect, listEl, presetCount) {
      var vw = window.innerWidth || 1280
      var vh = window.innerHeight || 800
      var estH = Math.min(26 + presetCount * 34, 340)
      var listRect = listEl && listEl.isConnected ? listEl.getBoundingClientRect() : null
      var x = listRect ? listRect.right + MODE_SWITCH_CARD_GAP : rowRect.right + MODE_SWITCH_CARD_GAP
      if (x + MODE_SWITCH_CARD_WIDTH > vw - 8) {
        x = (listRect ? listRect.left : rowRect.left) - MODE_SWITCH_CARD_WIDTH - MODE_SWITCH_CARD_GAP
      }
      x = Math.max(8, x)
      var y = rowRect.top - 6
      y = Math.max(8, Math.min(y, vh - estH - 8))
      return { x: x, y: y }
    }

    function makeModeSwitchMenu(child) {
      return function ModeSwitchMenu(props) {
        var sessionId = props && props.sessionId
        var state = useStore(modeSwitchStore)
        var presets = state && Array.isArray(state.presets) ? state.presets : []
        var currentPreset = state && state.currentBySession ? state.currentBySession[String(sessionId)] : ''
        var [cardOpen, setCardOpen] = React.useState(false)
        var [cardPos, setCardPos] = React.useState(null)
        var rowElRef = React.useRef(null)
        var listElRef = React.useRef(null)

        // The slot type binds the row's menu open state to every entry via
        // `useMenuOpenState` (see dsh-client-ui-workspace's slot declaration):
        // the hook returns [open, setOpen] for this row's "..." menu.
        var openState = props && typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : null
        var closeMenu = openState && typeof openState[1] === 'function' ? function () { openState[1](false) } : null

        React.useEffect(
          function () {
            if (modeSwitchStore.get().presets.length === 0) fetchModePresets(child)
            if (sessionId) requestCurrentMode(child, sessionId)
          },
          [sessionId],
        )

        // While the card is open, follow the anchor (the portaled menu card
        // tracks scroll/resize itself; re-measure the same way).
        React.useEffect(
          function () {
            if (!cardOpen) return
            function reposition() {
              var rowEl = rowElRef.current
              if (!rowEl || !rowEl.isConnected) return
              var pos = computeModeSwitchCardPosition(rowEl.getBoundingClientRect(), listElRef.current, modeSwitchStore.get().presets.length)
              setCardPos(function (prev) {
                return prev && prev.x === pos.x && prev.y === pos.y ? prev : pos
              })
            }
            window.addEventListener('scroll', reposition, true)
            window.addEventListener('resize', reposition)
            return function () {
              window.removeEventListener('scroll', reposition, true)
              window.removeEventListener('resize', reposition)
            }
          },
          [cardOpen],
        )

        if (!sessionId || presets.length === 0) return null

        function closeCard() {
          setCardOpen(false)
        }

        function openCard(event) {
          var rowEl = event.currentTarget
          rowElRef.current = rowEl
          listElRef.current = null
          try {
            listElRef.current = rowEl.closest ? rowEl.closest('[role="menu"]') : null
          } catch (error) {
            listElRef.current = null
          }
          setCardPos(computeModeSwitchCardPosition(rowEl.getBoundingClientRect(), listElRef.current, presets.length))
          setCardOpen(true)
        }

        var presetRows = []
        for (var i = 0; i < presets.length; i++) {
          ;(function (preset) {
            presetRows.push(
              React.createElement(
                'button',
                {
                  key: 'preset-' + preset.id,
                  type: 'button',
                  role: 'menuitem',
                  className: 'dshp-mode-switch-item',
                  // 条目指标与 Menu 的 .item 完全一致（34px 高 / 6px 8px /
                  // 13px 20px / hover 用 interactive-bg-hover 同一 token）。
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    width: '100%',
                    minHeight: '34px',
                    padding: '6px 8px',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--dsw-alias-label-primary, #1a1a1a)',
                    fontSize: '13px',
                    lineHeight: '20px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 'var(--dsw-radius-md, 8px)',
                  },
                  onMouseEnter: function (event) { event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' },
                  onMouseLeave: function (event) { event.currentTarget.style.background = 'transparent' },
                  onClick: function () {
                    setCardOpen(false)
                    requestModeSwitch(child, sessionId, preset.id)
                    if (closeMenu) closeMenu()
                  },
                },
                React.createElement('span', { style: { width: '14px', flex: '0 0 14px' } }, preset.id === currentPreset ? '✓' : ''),
                React.createElement('span', { style: { flex: '1 1 auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, preset.label),
                preset.isDefault
                  ? React.createElement('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary, #8a8f98)' } }, '默认')
                  : null,
              ),
            )
          })(presets[i])
        }

        var card = null
        if (cardOpen && cardPos && modeSwitchReactDOM) {
          card = modeSwitchReactDOM(
            React.createElement(
              'div',
              {
                role: 'menu',
                'aria-label': '选择模式',
                className: 'dshp-mode-switch-card',
                onPointerDown: function (event) { event.stopPropagation() },
                style: {
                  position: 'fixed',
                  left: cardPos.x + 'px',
                  top: cardPos.y + 'px',
                  zIndex: 1101,
                  // 与菜单卡片一致的内容自适应宽度（短预设名不再被 220px
                  // 撑宽）：min-width 保证可读，上限喂给翻转决策。
                  width: 'max-content',
                  minWidth: '150px',
                  maxWidth: MODE_SWITCH_CARD_WIDTH + 'px',
                  maxHeight: '340px',
                  overflowY: 'auto',
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '4px',
                  border: '0',
                  borderRadius: 'var(--dsw-radius-lg, 12px)',
                  // 与 Menu 卡面同一套表面 token：半透明填充 + 背景模糊 +
                  // 同一阴影（MenuSurface .material / Menu .list），深色
                  // 主题下不再比菜单亮一个色阶。
                  background: 'var(--dsw-menu-surface-fill, var(--dsw-alias-bg-overlay, #fff))',
                  backdropFilter: 'var(--dsw-menu-backdrop-filter)',
                  boxShadow: 'var(--dsw-elevation-prominent, 0 12px 36px rgba(0,0,0,.22))',
                },
              },
              // 去掉标题栏与关闭按钮：关闭路径已有四条（选预设 / 卡片外
              // 点击 / Esc / 再点「切换模式」行），留一行小字 caption 即可，
              // 视觉上与菜单卡片一样干净。
              React.createElement(
                'div',
                {
                  style: {
                    padding: '6px 8px 4px 8px',
                    fontSize: '11px',
                    lineHeight: '14px',
                    color: 'var(--dsw-alias-label-secondary, #8a8f98)',
                  },
                },
                '选择模式',
              ),
              presetRows,
            ),
            document.body,
          )
        }

        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              'aria-haspopup': 'menu',
              'aria-expanded': cardOpen,
              className: 'dshp-mode-switch-trigger',
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '18px',
                width: '100%',
                padding: '7px 12px',
                border: 'none',
                background: cardOpen ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.06))' : 'transparent',
                color: 'var(--dsw-alias-label-primary, #1a1a1a)',
                fontSize: '13px',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: '6px',
                whiteSpace: 'nowrap',
              },
              onClick: function (event) {
                if (cardOpen) closeCard()
                else openCard(event)
              },
            },
            React.createElement('span', null, '切换模式'),
            React.createElement('span', { 'aria-hidden': true, style: { color: 'var(--dsw-alias-label-secondary, #8a8f98)' } }, cardOpen ? '×' : '›'),
          ),
          card,
        )
      }
    }
    // ------------------------------------------------- prompts (system prompt)
    //
    // 组件 J：自定义系统提示词。两个界面：
    //   1) 行详情页（plugins.row.config）：总开关（实时关断，无需重启）。
    //   2) 设置 → 提示词设置（settings.section）：主界面——
    //      0.4.37 单列纵向版式（修掉横排「标签|控件」在宽控件下把
    //      标签列压成单字宽的排版事故），四段自上而下：
    //      ① 提示词预览（0.4.40 两层：来源 [当前生效|默认提示词] ×
    //         视图 [模板|最终形态] + 复制当前提示词，卡片内展示；
    //         模板视图 {{变量}} 原样保留并附图例，最终形态是同一批
    //         section 代入运行时值后的正文；工具相关内容不展示——
    //         这是提示词组件，工具 JSON 定义本就走 API 参数独立下发）；
    //      ② 当前模式单选（默认 / 各自定义条目，整行可点的 radio 行，
    //         选中态有底，行尾带模式标签 + 字符数）；
    //      ③ 四个一键模板（节省 / 谨慎 / 牧羊人 / 文科生，附加模式）；
    //      ④ 我的提示词库 CRUD（整体数组原子写入，规避多操作冲突；
    //         编辑器为独立虚线卡片、纵向字段）。
    //
    // 数据：host 半每 1s 对齐「激活条目 + 模式」并注册 systemPrompt section；
    // 水幕捕获的 preview 文本（volatile）由本页读 form 快照展示。本页用
    // configForms.describe() 共享镜像的 subscribe 驱动重渲染（与插件页的
    // useConfigurations 同一条真源），写走 form.mutate(ops, revision)。

    var PROMPTS_MAX_NAME = 24
    var PROMPTS_MAX_CONTENT = 20000
    var TOOL_PROMPT_MAX = 2000
     var PROMPTS_PRESETS = [
       { id: 'standard', label: 'standard（标准）', note: '普通 coding-agent persona' },
       { id: 'ptc', label: 'ptc', note: 'PTC 工具呈现；persona 与 standard 相同' },
       { id: 'cordis', label: 'cordis（创造）', note: 'Cordis / 技能 / 插件相关提示' },
       { id: 'minimal', label: 'minimal（极简）', note: 'persona complete：自定义模板会顶替它' },
     ]
    // 0.4.90：每个模式各自一个**内置只读**的默认提示词模板（单射：
    // mode -> builtin:<mode>）。它们是「该模式自己的 DSH 默认提示词」，
    // 不是可编辑的自定义条目，也不是笼统的一个「默认提示词模板」。
    // 每个模式的下拉默认选中它自己这一项；用户可另选自定义模板。
    var PROMPTS_BUILTINS = [
      { id: 'builtin:standard', mode: 'standard', label: 'standard 默认模板' },
      { id: 'builtin:ptc', mode: 'ptc', label: 'ptc 默认模板' },
      { id: 'builtin:cordis', mode: 'cordis', label: 'cordis 默认模板' },
      { id: 'builtin:minimal', mode: 'minimal', label: 'minimal 默认模板' },
    ]
    function builtinLabelOf(id) {
      for (var bi = 0; bi < PROMPTS_BUILTINS.length; bi++) {
        if (PROMPTS_BUILTINS[bi].id === id) return PROMPTS_BUILTINS[bi].label
      }
      return ''
    }

    // 0.4.65：四个一键模板按当前工具集重写（旧版仍停留在「subagent 一种委托」
    // 的时代）。新增能力：subagent / subagent_fork / workflow 三种委托与编排、
    // $技能引用（skills）、office 技能族产出真实 Office 文件、humanizer 去
    // AI 味、review-agent 独立复查、present 交付文件。
    var PROMPTS_TEMPLATES = [
      {
        key: 'save',
        name: '节省',
        content:
          '# 工作方式：节省\n' +
          '- 若多个工具之间没有依赖关系，就在同一回合里并行调用它们（例如一次读多个文件、一次做多路搜索）。\n' +
          '- 不要重复读取本会话中已经读过的文件，也不要反复确认已经确认过的事实。\n' +
          '- 优先批量操作：把多个小搜索合并成一次 glob/grep，或用一个命令完成一系列操作。\n' +
          '- 独立的批量检索、长流程分析派给 subagent 处理，主上下文只保留结论；大规模扇出（多文件审计、批量迁移）用 workflow 编排，不要在主对话里逐个跑。\n' +
          '- 不做不影响结论的冗余验证；解释结果时简洁直接，先给结论。\n' +
          '- 注意每一次往返的 token 成本：往返越少，完成越快。',
      },
      {
        key: 'careful',
        name: '谨慎',
        content:
          '# 工作方式：谨慎（搜 → 想 → 码 → 查）\n' +
          '1. 先搜索分析：动手前读相关代码与既有约定，找相似实现，列出假设和不确定点；拿不准就查，不要猜。\n' +
          '2. 再想清楚：给出简短计划（改哪些文件、怎么改、风险在哪）；影响面大的改动先向用户确认再执行。\n' +
          '3. 后编码：只改计划内的东西，先读后写，不顺手改无关代码。\n' +
          '4. 最后自审：逐条核对改动、遗漏引用与副作用；有测试就跑并汇报结果；重要改动可用 review-agent 做一次独立只读复查。\n' +
          '- 执行中发现假设不成立时，停下来回到分析步骤，不要硬闯。\n' +
          '- 破坏性操作（删除、覆盖、推送）一律先确认。',
      },
      {
        key: 'shepherd',
        name: '牧羊人',
        content:
          '# 工作方式：牧羊人（编排者模式）\n' +
          '你的角色是牧羊人，不是牧羊犬：\n' +
          '- 自己定总目标、任务分解与优先级，保持全局视角，每一步都对照核心目标校准。\n' +
          '- 把执行下放：独立子任务用 subagent，需要继承本对话背景的用 subagent_fork，大规模扇出/批量审计用 workflow 脚本编排；你自己负责分解、派工、验收与整合。\n' +
          '- 每个子任务给出明确的目标、边界与验收标准；整合结果时对照原始任务核对。\n' +
          '- 子代理结果跑偏时纠偏并重新分派，不让错误向下游传递。\n' +
          '- 最终答案由你把关：一致、完整，并且真正解决了用户的原始问题。\n' +
          '注意：本提示词会随上下文传给子代理——如果你实际是子代理，忽略上面的编排部分，直接高质量完成被指派的子任务即可。',
      },
      {
        key: 'humanities',
        name: '文科生',
        content:
          '# 工作方式：文科生（文档与文稿导向）\n' +
          '- 侧重文字与文档任务：报告、方案、纪要、邮件、发言稿、说明文；能落成文档的，直接交付一份可用的完整文档，而不是一段口头描述。\n' +
          '- 重结构与逻辑：先搭骨架（背景 → 问题 → 方案 → 行动 → 风险），再填血肉；一段一个重点。\n' +
          '- 语气看读者：对上与对外正式克制，对内协作平实直接；不堆空话与套话。\n' +
          '- 中文成文规范：句子短，动词担责，数字与事实到位，结尾给可执行的结论。\n' +
          '- 需要 Word/PPT/Excel 成品时，用 office 相关技能产出真实文件并随回复交付；文稿读起来「AI 味」重时用 humanizer 技能改写。\n' +
          '- 涉及技术内容时，保证准确，并用非技术读者也能理解的话表达。',
      },
    ]

    function newPromptId() {
      return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    function promptTextValue(text) {
      return typeof text === 'string' ? text : ''
    }

    function listCustoms(value) {
      if (!value || !Array.isArray(value.custom)) return []
      return value.custom.filter(function (entry) {
        return entry && typeof entry.id === 'string' && typeof entry.name === 'string'
      })
    }

    function customMode(entry) {
      return entry && entry.mode === 'replace' ? 'replace' : 'append'
    }

    function copyPromptText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text)
      }
      return new Promise(function (resolve, reject) {
        try {
          var ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.left = '-10000px'
          document.body.appendChild(ta)
          ta.select()
          var ok = document.execCommand('copy')
          document.body.removeChild(ta)
          if (ok) resolve()
          else reject(new Error('copy failed'))
        } catch (error) {
          reject(error)
        }
      })
    }

    function makePromptsRowPage(ctx) {
      var fields = [
        {
          key: 'enabled',
          kind: 'boolean',
          label: '启用自定义系统提示词',
          hint: '关闭后所有会话立即恢复 DSH 默认系统提示词，无需重启；再打开时自动恢复上次的选择。',
        },
      ]
      return function PromptsRowPage(props) {
        var form = props.form
        if (props.view === 'summary') {
          return React.createElement(
            'span',
            null,
            summaryFrom(form, function (value) {
              return value.enabled === false ? '提示词设置：已停用' : '提示词设置：已启用'
            }),
          )
        }
        return React.createElement(SettingsForm, { form: form, fields: fields, coerce: function (field, value) { return value !== false } })
      }
    }

    function makePromptsSettingsPage(ctx) {
      return function PromptsSettingsPage(props) {
        var mirror = null
        try {
          mirror = ctx.configForms.describe()
        } catch (error) {}

        var tickState = React.useState(0)
        var setTick = tickState[1]
        // 0.4.65：按本行 revision 门控重渲染（防止 mirror 全量通知时整页
        // 反复刷新）。0.4.78：门控从「revision 变化」升级为「本行值签名
        // 变化」——revision 由宿主的静态 entry options 驱动，volatile 写入
        // （宿主水幕重写 preview/toolPreview）可能只更新值而不推进 revision，
        // 纯 revision 门控会把这类更新永久吞掉（症状：工具列表一直为空、
        // 刷新无效）。签名覆盖本页渲染依赖的全部字段；同时每 5s 主动
        // mirror.load() 一次全量 describe——即使宿主→客户端的失效事件没到，
        // 页面也在 5 秒内拿到最新文档。
        React.useEffect(
          function () {
            if (!mirror || typeof mirror.subscribe !== 'function') return undefined
            function rowSig() {
              try {
                var snap = mirror.getSnapshot ? mirror.getSnapshot() : null
                var ns = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
                for (var i = 0; i < ns.length; i++) {
                  if (ns[i] && ns[i].ns === NS_PROMPTS) {
                    var r = ns[i]
                    var v = r.value || {}
                    var tp = v.toolPreview || {}
                    var pv = v.preview || {}
                    var tl = {}
                    if (v.toolPrompts && typeof v.toolPrompts === 'object') {
                      for (var tk in v.toolPrompts) tl[tk] = 1
                    }
                    return [
                      r.revision,
                      Array.isArray(tp.tools) ? tp.tools.length : 0,
                      tp.updatedAt || 0,
                      typeof pv.effective === 'string' ? pv.effective.length : 0,
                      pv.updatedAt || 0,
                       JSON.stringify(v.previewByPreset || {}),
                      Array.isArray(v.custom) ? v.custom.length : -1,
                       JSON.stringify(v.custom || []),
                       JSON.stringify(v.activeByPreset || {}),
                       JSON.stringify(v.builtins || []),
                       v.active || '',
                      JSON.stringify(tl),
                      v.refreshNonce || 0,
                      v.enabled === false ? 0 : 1,
                      
                    ].join('|')
                  }
                }
              } catch (error) {}
              return 'none'
            }
            var lastSig = rowSig()
            function bump() {
              setTick(function (t) {
                return t + 1
              })
            }
            var off = mirror.subscribe(function () {
              var sig = rowSig()
              if (sig === lastSig) return
              lastSig = sig
              bump()
            })
            var timer = setInterval(function () {
              try {
                if (mirror.load) {
                  var p = mirror.load()
                  if (p && typeof p.catch === 'function') p.catch(function () {})
                }
              } catch (error) {}
              var sig = rowSig()
              if (sig !== lastSig) {
                lastSig = sig
                bump()
              }
            }, 5000)
            return function () {
              off()
              clearInterval(timer)
            }
          },
          [],
        )

        var [tab, setTab] = React.useState('effective')
        // 0.4.40 视图层：template（模板，{{变量}} 原样保留）/ final（最终形态，
        // 变量已代入）。这是提示词组件——工具相关内容（tool:*/tools:*/mcp-*
        // section 与工具 JSON 定义）不展示在任何视图里。
        var [view, setView] = React.useState('template')
        var [editor, setEditor] = React.useState(null)
        // 0.4.91：查看某个内置模板的真实内容（内容来自 DSH 的 preset 定义，
        // 不需要任何一次模型调用）。
        var [builtinView, setBuiltinView] = React.useState(null)
        // 0.4.93：内置模板内容的第二条通道——宿主路由 /api/dshp/prompts/builtins
        // （设置行之外的纯读通道；两条通道都拿不到时才显示「未解析」）。
        var [remoteBuiltins, setRemoteBuiltins] = React.useState(null)
        React.useEffect(
          function () {
            var stopped = false
            function pull() {
              try {
                fetch('/api/dshp/prompts/builtins')
                  .then(function (res) {
                    return res && res.ok ? res.json() : null
                  })
                  .then(function (data) {
                    if (stopped) return
                    if (data && Array.isArray(data.builtins) && data.builtins.length > 0) setRemoteBuiltins(data.builtins)
                  })
                  .catch(function () {})
              } catch (error) {}
            }
            pull()
            var timer = setInterval(pull, 30000)
            return function () {
              stopped = true
              clearInterval(timer)
            }
          },
          [],
        )
        var [saveStatus, setSaveStatus] = React.useState('')
        var [copied, setCopied] = React.useState(false)
        // 0.4.45 顶层标签：system（系统提示词，原有四段）/ tools（工具提示，
        // 改工具描述文本控制模型调用意愿）。drafts/mode 懒填充：初值取自
        // 行设置，用户编辑后本地优先（保存前不回读）。
        var [page, setPage] = React.useState('system')
         var [selectedPreset, setSelectedPreset] = React.useState('standard')
        var [toolDrafts, setToolDrafts] = React.useState(null)
        var [toolMode, setToolMode] = React.useState(null)
        // 0.4.67：手动刷新提示。0.4.65 的稳定性门控让工具列表/预览不再自动
        // 乱刷，代价是「最近一次捕获」要连续稳定 5 秒才自动采纳——页面加
        // 「刷新」按钮：写一个 refreshNonce，宿主 1s 轮询发现变化后**立即**
        // 采纳最近一次捕获（见 host prompts/index.js promoteLatest）。
        var [refreshNote, setRefreshNote] = React.useState('')
        var [refreshing, setRefreshing] = React.useState(false)

        var form = null
        var value = {}
        try {
          var snap = mirror && mirror.getSnapshot ? mirror.getSnapshot() : null
          var namespaces = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
          var served = namespaces.some(function (view) {
            return view && view.ns === NS_PROMPTS
          })
          if (served) {
            var ctrl = ctx.configForms.get(NS_PROMPTS)
            form = { state: ctrl.getSnapshot(), mutate: function (ops, revision) { return ctrl.mutate(ops, revision) } }
          }
        } catch (error) {}

        if (form && form.state && form.state.status === 'ready' && form.state.value) value = form.state.value
        var customs = listCustoms(value)
        var activeByPreset = value.activeByPreset && typeof value.activeByPreset === 'object' ? value.activeByPreset : {}
         // 0.4.90：默认选中「该模式自己的内置模板」（单射）。兼容旧数据：
         // activeByPreset/value.active === 'default' 只代表该模式的 DSH 默认，
         // 在 UI 中归一化成对应的 builtin:<mode> 项。
         var activeRaw = typeof activeByPreset[selectedPreset] === 'string' && activeByPreset[selectedPreset]
           ? activeByPreset[selectedPreset]
           : selectedPreset === 'standard' && typeof value.active === 'string' && value.active
             ? value.active
             : ''
         var active = activeRaw && activeRaw !== 'default' ? activeRaw : 'builtin:' + selectedPreset
        var previewByPreset = value.previewByPreset && typeof value.previewByPreset === 'object' ? value.previewByPreset : {}
         var preview = previewByPreset[selectedPreset] && typeof previewByPreset[selectedPreset] === 'object' ? previewByPreset[selectedPreset] : selectedPreset === 'standard' && value.preview && typeof value.preview === 'object' ? value.preview : {}
        var activeEntry = null
        for (var ai = 0; ai < customs.length; ai++) {
          if (customs[ai].id === active) {
            activeEntry = customs[ai]
            break
          }
        }
        var activeMode = activeEntry ? customMode(activeEntry) : ''

        var writable = !form || form.state.writable !== false
        var busy = saveStatus === 'saving'

        function submit(ops) {
          if (!form || busy) return
          setSaveStatus('saving')
          // 0.4.77：不再传渲染期的 revision。configForms 的 mutate 契约是
          // expectedRevision ?? pendingRevision ?? 写入时快照——传陈旧 revision
          // 会在行间被宿主重写（volatile 捕获）时直接被拒（「保存被拒绝」，
          // patch 中 toolPrompts 从未落盘，与此类拒绝一致）；不传 = 写入时读最新快照。
          Promise.resolve(form.mutate(ops)).then(
            function (ok) {
              setSaveStatus(ok ? 'saved' : 'failed')
            },
            function () {
              setSaveStatus('failed')
            },
          )
        }

        function requestRefresh() {
          if (!form || refreshing) return
          setRefreshing(true)
          setRefreshNote('已请求，1 秒内生效。')
          var cleared = false
          var clearTimer = setTimeout(function () {
            cleared = true
            setRefreshNote('')
            setRefreshing(false)
          }, 6000)
          Promise.resolve(form.mutate([{ op: 'set', path: ['refreshNonce'], value: Date.now() }])).then(
            function (ok) {
              if (!ok && !cleared) {
                setRefreshNote('刷新请求被拒绝，请重试。')
              }
            },
            function () {
              if (!cleared) setRefreshNote('刷新请求被拒绝，请重试。')
            },
          )
        }

        function selectActive(id) {
          submit([{ op: 'set', path: ['activeByPreset', selectedPreset], value: id }])
        }

        function applyTemplate(tpl) {
          var existing = null
          for (var i = 0; i < customs.length; i++) {
            if (customs[i].name.trim() === tpl.name.trim()) {
              existing = customs[i]
              break
            }
          }
          if (existing) {
            selectActive(existing.id)
            return
          }
          var entry = { id: newPromptId(), name: tpl.name, mode: 'append', content: tpl.content }
          var next = []
          for (var j = 0; j < customs.length; j++) next.push(customs[j])
          next.push(entry)
          submit([
            { op: 'set', path: ['custom'], value: next },
            { op: 'set', path: ['activeByPreset', selectedPreset], value: entry.id },
          ])
        }

        function openNewEditor() {
          setSaveStatus('')
          setEditor({ id: '', name: '', mode: 'append', content: '' })
        }

        function openEditEditor(entry) {
          setSaveStatus('')
          setEditor({ id: entry.id, name: entry.name, mode: customMode(entry), content: promptTextValue(entry.content) })
        }

        function saveEditor() {
          if (!editor) return
          var name = String(editor.name || '').trim()
          var content = String(editor.content || '')
          if (name.length === 0 || name.length > PROMPTS_MAX_NAME) {
            setSaveStatus('failed')
            return
          }
          if (content.trim().length === 0 || content.length > PROMPTS_MAX_CONTENT) {
            setSaveStatus('failed')
            return
          }
          var entry = { id: editor.id || newPromptId(), name: name, mode: editor.mode, content: content }
          var next = []
          var replaced = false
          for (var i = 0; i < customs.length; i++) {
            var c = customs[i]
            if (entry.id && c.id === entry.id) {
              next.push(entry)
              replaced = true
            } else {
              next.push(c)
              if (c.name.trim().toLowerCase() === name.toLowerCase()) {
                setSaveStatus('failed')
                return
              }
            }
          }
          if (!replaced) next.push(entry)
          // 0.4.77：新建条目立即激活（与模板一键创建一致）。旧流程只保存条目、
          // 从不写 active——用户新建并保存后模型仍用默认提示词，「毫无效果」。
          var saveOps = [{ op: 'set', path: ['custom'], value: next }]
          if (!replaced) saveOps.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: entry.id })
          submit(saveOps)
          setEditor(null)
        }

        function removeEntry(entry) {
          var next = []
          for (var i = 0; i < customs.length; i++) {
            if (customs[i].id !== entry.id) next.push(customs[i])
          }
          var ops = [{ op: 'set', path: ['custom'], value: next }]
          if (active === entry.id) ops.push({ op: 'set', path: ['activeByPreset', selectedPreset], value: 'default' })
          if (editor && editor.id === entry.id) setEditor(null)
          submit(ops)
        }

        // 0.4.91：宿主从 DSH 自己的 preset 定义里解析出的内置模板内容
        // （readDocument + preset scope 装配）——不需要「探测」。
        var builtinMap = {}
        var builtinList = Array.isArray(value.builtins) ? value.builtins : []
        for (var bi0 = 0; bi0 < builtinList.length; bi0++) {
          var bEntry = builtinList[bi0]
          if (bEntry && typeof bEntry.id === 'string') builtinMap[bEntry.id] = bEntry
        }
        // 0.4.93：路由通道的内容覆盖设置行通道（更新鲜）。
        var remoteList = Array.isArray(remoteBuiltins) ? remoteBuiltins : []
        for (var bi1 = 0; bi1 < remoteList.length; bi1++) {
          var rEntry = remoteList[bi1]
          if (rEntry && typeof rEntry.id === 'string' && typeof rEntry.text === 'string' && rEntry.text.length > 0) {
            builtinMap[rEntry.id] = rEntry
          }
        }
        var builtinForMode = builtinMap['builtin:' + selectedPreset] || null
        var builtinViewEntry = builtinView ? builtinMap[builtinView] || null : null
        var shownText = ''
        var shownFromBuiltin = false
        if (builtinViewEntry) {
          shownText = view === 'template' ? promptTextValue(builtinViewEntry.template) : promptTextValue(builtinViewEntry.text)
          shownFromBuiltin = shownText.length > 0
        } else {
          if (view === 'template') {
            shownText = tab === 'default' ? promptTextValue(preview.defaultTemplate) : promptTextValue(preview.effectiveTemplate)
          } else {
            shownText = tab === 'default' ? promptTextValue(preview.defaultText) : promptTextValue(preview.effective)
          }
          if (!shownText && builtinForMode && (tab === 'default' || active.indexOf('builtin:') === 0)) {
            shownText = view === 'template' ? promptTextValue(builtinForMode.template) : promptTextValue(builtinForMode.text)
            shownFromBuiltin = shownText.length > 0
          }
        }
        var showCopy = shownText.length > 0
        function doCopy() {
          if (!showCopy) return
          copyPromptText(shownText).then(
            function () {
              setCopied(true)
              setTimeout(function () {
                setCopied(false)
              }, 1600)
            },
            function () {},
          )
        }

        // 模板视图的变量图例：{{model}} = 当前模型名 …（让用户看清哪些是运行时填的）。
        var varLegend = []
        if (view === 'template' && Array.isArray(preview.variables)) {
          for (var vi = 0; vi < preview.variables.length; vi++) {
            var vv = preview.variables[vi]
            if (vv && typeof vv.name === 'string' && vv.name) varLegend.push('{{' + vv.name + '}} = ' + vv.value)
          }
        }
        var viewNote =
          view === 'template'
            ? '模板视图：{{变量}} 未代入' + (varLegend.length > 0 ? ' · ' + varLegend.join(' · ') : '')
            : '最终形态：变量已代入'

        var previewEmptyHint =
          view === 'template'
            ? tab === 'default'
              ? '下一次模型调用后生成'
              : '下一次模型调用后生成'
            : tab === 'default'
              ? '下一次模型调用后生成'
              : activeMode === 'replace'
                ? '整份替换：模型只看你的文本'
                : '下一次模型调用后生成'

        // ---------------------------------------------------- 0.4.90 重排版
        // 层次：① 当前配置（preset 分段选择 + 生效提示词下拉）→ ② 预览 → ③ 我的库。
        // 逻辑层不动：selectedPreset / active / selectActive / customs / activeMode
        // 等状态与 handler 全部沿用；只重排呈现、删冗余说明、消灭换行
        // （preset 分段 nowrap，note 收进 title 悬停提示）。
        var presetTabLabel = { standard: '标准', ptc: 'ptc', cordis: '创造', minimal: '极简' }
        var presetTabs = React.createElement(
          'div',
          { style: { display: 'flex', gap: '6px', flexWrap: 'nowrap' } },
          PROMPTS_PRESETS.map(function (preset) {
            return React.createElement(
              'button',
              {
                type: 'button',
                className: selectedPreset === preset.id ? 'dshp-btn dshp-btn-primary' : 'dshp-btn',
                title: preset.label + ' — ' + preset.note,
                onClick: function () { setSelectedPreset(preset.id) },
              },
              presetTabLabel[preset.id] || preset.id,
            )
          }),
        )
        var activeSelect = React.createElement(
          'select',
          {
            className: 'dshp-select',
            style: { width: '100%', maxWidth: '420px' },
            value: active,
            disabled: !writable || busy,
            onChange: function (event) { selectActive(event.target.value) },
          },
          PROMPTS_BUILTINS.map(function (b) {
            return React.createElement('option', { key: b.id, value: b.id }, b.label)
          }),
          customs.map(function (entry) {
            return React.createElement('option', { key: entry.id, value: entry.id }, entry.name + '（' + (customMode(entry) === 'replace' ? '替换' : '附加') + '）')
          }),
        )
        var activeModeTag = activeMode === 'replace' ? '整份替换' : activeMode === 'append' ? '附加' : builtinLabelOf(active) || '默认'
        // ---------------------------------------------------- 模板按钮
        var templateButtons = []
        for (var ti = 0; ti < PROMPTS_TEMPLATES.length; ti++) {
          ;(function (tpl) {
            templateButtons.push(
              React.createElement(
                'button',
                { key: tpl.key, type: 'button', className: 'dshp-btn', disabled: !writable || busy, onClick: function () { applyTemplate(tpl) } },
                tpl.name,
              ),
            )
          })(PROMPTS_TEMPLATES[ti])
        }

        // ---------------------------------------------------- 模板库列表
        // 0.4.90：先列 4 个内置只读的「按模式默认模板」（单射 mode->builtin:mode），
        // 再列自定义模板。内置项不可编辑/删除，只能被下拉选中。
        var libraryRows = []
        for (var bri = 0; bri < PROMPTS_BUILTINS.length; bri++) {
          ;(function (b) {
            libraryRows.push(
              React.createElement(
                'div',
                {
                  key: b.id,
                  className: 'dshp-field',
                  style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', flexWrap: 'nowrap' },
                },
                React.createElement(
                  'span',
                  { style: { flex: '0 1 260px', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  active === b.id ? '● ' : '',
                  b.label,
                ),
                React.createElement('span', { className: 'dshp-tag' }, '内置'),
                React.createElement(
                  'span',
                  { className: 'dshp-note', style: { flex: '0 0 auto' } },
                  builtinMap[b.id] ? builtinMap[b.id].text.length + ' 字符' : '未解析',
                ),
                React.createElement('span', { className: 'dshp-note', style: { flex: '0 0 auto' } }, '不可编辑'),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn', style: { flex: '0 0 auto', whiteSpace: 'nowrap' }, onClick: function () { setBuiltinView(b.id) } },
                  '查看',
                ),
              ),
            )
          })(PROMPTS_BUILTINS[bri])
        }
        for (var li = 0; li < customs.length; li++) {
          ;(function (entry) {
            libraryRows.push(
              React.createElement(
                'div',
                {
                  key: entry.id,
                  className: 'dshp-field',
                  style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', flexWrap: 'nowrap' },
                },
                React.createElement(
                  'span',
                  { style: { flex: '1 1 auto', minWidth: 0, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  active === entry.id ? '● ' : '',
                  entry.name,
                ),
                React.createElement('span', { className: 'dshp-tag', style: { flex: '0 0 auto' } }, customMode(entry) === 'replace' ? '整份替换' : '附加'),
                React.createElement(
                  'span',
                  { className: 'dshp-note', style: { flex: '0 0 auto' } },
                  promptTextValue(entry.content).length + ' 字符',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dshp-btn',
                    style: { flex: '0 0 auto', whiteSpace: 'nowrap' },
                    disabled: !writable || busy || active === entry.id,
                    onClick: function () {
                      selectActive(entry.id)
                    },
                  },
                  '设为当前',
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn', style: { flex: '0 0 auto', whiteSpace: 'nowrap' }, disabled: !writable || busy, onClick: function () { openEditEditor(entry) } },
                  '编辑',
                ),
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn', style: { flex: '0 0 auto', whiteSpace: 'nowrap' }, disabled: !writable || busy, onClick: function () { removeEntry(entry) } },
                  '删除',
                ),
              ),
            )
          })(customs[li])
        }

        // ---------------------------------------------------- 编辑器
        var editorBlock = null
        if (editor) {
          var nameInvalid = editor.name.trim().length === 0 || editor.name.trim().length > PROMPTS_MAX_NAME
          var contentInvalid = editor.content.trim().length === 0 || editor.content.length > PROMPTS_MAX_CONTENT
          var nameTaken = false
          for (var ni = 0; ni < customs.length; ni++) {
            if (customs[ni].id !== editor.id && customs[ni].name.trim().toLowerCase() === editor.name.trim().toLowerCase()) {
              nameTaken = true
              break
            }
          }
          // 0.4.37：独立卡片 + 纵向字段（标签在控件上方），不再用会塌缩的横排。
          editorBlock = React.createElement(
            'div',
            { className: 'dshp-card', style: { borderStyle: 'dashed' } },
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement('div', { className: 'dshp-label' }, editor.id ? '编辑：' + (editor.name || '未命名') : '新建自定义提示词'),
            ),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement('div', { className: 'dshp-label' }, '名称'),
              React.createElement('input', {
                type: 'text',
                className: 'dshp-select',
                style: { width: '240px' },
                value: editor.name,
                maxLength: PROMPTS_MAX_NAME,
                placeholder: '例如：谨慎',
                disabled: !writable || busy,
                onChange: function (event) {
                  setEditor(function (prev) {
                    var next = {}
                    for (var k in prev) next[k] = prev[k]
                    next.name = event.target.value
                    return next
                  })
                },
              }),
              React.createElement(
                'div',
                { className: 'dshp-hint' },
                nameInvalid
                  ? '必填，最多 ' + PROMPTS_MAX_NAME + ' 字'
                  : nameTaken
                    ? '名称已存在'
                    : '最多 ' + PROMPTS_MAX_NAME + ' 字',
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement('div', { className: 'dshp-label' }, '模式'),
              React.createElement('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
                React.createElement(
                  'label',
                  { className: 'dshp-radio' },
                  React.createElement('input', {
                    type: 'radio',
                    name: 'dshp-prompts-mode',
                    checked: editor.mode !== 'replace',
                    disabled: !writable || busy,
                    onChange: function () {
                      setEditor(function (prev) {
                        var next = {}
                        for (var k in prev) next[k] = prev[k]
                        next.mode = 'append'
                        return next
                      })
                    },
                  }),
                  React.createElement('span', null, '附加'),
                ),
                React.createElement(
                  'label',
                  { className: 'dshp-radio' },
                  React.createElement('input', {
                    type: 'radio',
                    name: 'dshp-prompts-mode',
                    checked: editor.mode === 'replace',
                    disabled: !writable || busy,
                    onChange: function () {
                      setEditor(function (prev) {
                        var next = {}
                        for (var k in prev) next[k] = prev[k]
                        next.mode = 'replace'
                        return next
                      })
                    },
                  }),
                  React.createElement('span', null, '整份替换'),
                ),
              ),
              React.createElement(
                'div',
                { className: 'dshp-hint' },
                editor.mode === 'replace'
                  ? '整份替换：丢掉 DSH 默认提示词'
                  : '附加：文本加在默认提示词前',
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-vfield' },
              React.createElement('div', { className: 'dshp-label' }, '内容'),
              React.createElement('textarea', {
                className: 'dshp-textarea',
                style: { minHeight: '180px' },
                value: editor.content,
                maxLength: PROMPTS_MAX_CONTENT,
                placeholder: '例如：# 工作方式\n- 先给结论，再给依据……',
                disabled: !writable || busy,
                onChange: function (event) {
                  setEditor(function (prev) {
                    var next = {}
                    for (var k in prev) next[k] = prev[k]
                    next.content = event.target.value
                    return next
                  })
                },
              }),
              React.createElement(
                'div',
                { className: 'dshp-hint' },
                // 0.4.65：这里必须是 editor.content。旧代码写成裸 `content`（作用域内
                // 没有该变量）——「新建」时编辑器内容为空 → contentInvalid=true →
                // `content.trim()` 抛 ReferenceError → 整个页面渲染崩溃（用户看到的
                // 「点击新建提示词以后，页面直接卡死了」）。编辑路径因内容非空走
                // contentInvalid=false 分支，三元式短路，从不触碰该变量，所以只有
                // 新建路径会炸。
                contentInvalid
                  ? editor.content.trim().length === 0
                    ? '内容不能为空'
                    : '超出 ' + PROMPTS_MAX_CONTENT + ' 字'
                  : editor.content.length + ' / ' + PROMPTS_MAX_CONTENT + ' 字',
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-footer' },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshp-btn dshp-btn-primary',
                  disabled: !writable || busy || nameInvalid || nameTaken || contentInvalid,
                  onClick: saveEditor,
                },
                busy ? '保存中…' : '保存',
              ),
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn', disabled: busy, onClick: function () { setEditor(null); setSaveStatus('') } },
                '取消',
              ),
              saveStatus === 'failed' ? React.createElement('span', { className: 'dshp-note' }, '保存失败：重名或超限') : null,
            ),
          )
        }

        var statusNote = saveStatus === 'saved' ? '已保存，立即生效。' : saveStatus === 'failed' ? '保存被拒绝，请重试。' : null

        // ---------------------------------------------------- 0.4.45 工具提示页
        // 数据通道：host 半在水幕捕获工具列表（name + **原始**描述，volatile
        // toolPreview）；用户文本存 toolPrompts（toolName -> 文本，持久），
        // 模式存 toolPromptMode。host 水幕监听器每次装配实时改写描述——
        // 保存后下一次模型调用生效，无需重启。
        var savedToolPrompts = value.toolPrompts && typeof value.toolPrompts === 'object' ? value.toolPrompts : {}
        if (toolDrafts === null) {
          var d0 = {}
          for (var d0k in savedToolPrompts) {
            if (Object.prototype.hasOwnProperty.call(savedToolPrompts, d0k)) d0[d0k] = savedToolPrompts[d0k]
          }
          toolDrafts = d0
        }
        if (toolMode === null) toolMode = value.toolPromptMode === 'replace' ? 'replace' : 'append'
        var toolList = value.toolPreview && Array.isArray(value.toolPreview.tools) ? value.toolPreview.tools : []
        function setToolDraft(name, text) {
          setToolDrafts(function (prev) {
            var next = {}
            for (var k in prev) next[k] = prev[k]
            if (text) next[name] = text
            else delete next[name]
            return next
          })
        }

        function saveToolPrompts() {
          var out = {}
          for (var k in toolDrafts) {
            if (typeof toolDrafts[k] === 'string' && toolDrafts[k].trim() !== '') out[k] = toolDrafts[k]
          }
          submit([
            { op: 'set', path: ['toolPromptMode'], value: toolMode },
            { op: 'set', path: ['toolPrompts'], value: out },
          ])
        }

        var customizedCount = 0
        // 0.4.77：未保存标记——drafts 与已存值比较，「保存」按钮旁可见。
        // 此前没有任何「尚未保存」的视觉提示，保存失败后用户无从知道输入已丢。
        var toolDirty = false
        ;(function () {
          var uns1 = {}
          var uns2 = {}
          for (var uns3 in toolDrafts) {
            if (typeof toolDrafts[uns3] === 'string' && toolDrafts[uns3].trim() !== '') uns1[uns3] = toolDrafts[uns3].trim()
          }
          for (var uns4 in savedToolPrompts) {
            if (typeof savedToolPrompts[uns4] === 'string' && savedToolPrompts[uns4].trim() !== '') uns2[uns4] = savedToolPrompts[uns4].trim()
          }
          // 0.4.78：按排序后的键值对比较——JSON.stringify 依赖对象键序，
          // 保存/读取路径若换序会产生假「未保存」标记。
          var key1 = Object.keys(uns1).sort()
          var key2 = Object.keys(uns2).sort()
          var sameShape = key1.length === key2.length
          for (var sk = 0; sameShape && sk < key1.length; sk++) {
            if (key1[sk] !== key2[sk] || uns1[key1[sk]] !== uns2[key2[sk]]) sameShape = false
          }
          toolDirty = !sameShape || toolMode !== (value.toolPromptMode === 'replace' ? 'replace' : 'append')
        })()
        var toolRows = []
        for (var tli = 0; tli < toolList.length; tli++) {
          ;(function (tool) {
            var text = typeof toolDrafts[tool.name] === 'string' ? toolDrafts[tool.name] : ''
            if (text.trim() !== '') customizedCount++
            toolRows.push(
              React.createElement(
                'div',
                { key: tool.name, className: 'dshp-vfield', style: { padding: '10px 0' } },
                React.createElement(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  React.createElement('code', { style: { fontWeight: 600, fontSize: '13px' } }, tool.name),
                  text.trim() !== '' ? React.createElement('span', { className: 'dshp-tag' }, '已定制') : null,
                  // 0.4.82：捕获时间 + 来源会话（并集列表可能含其他会话的
                  // 工具——这行让来源一眼可辨）。
                  tool.lastSeen
                    ? React.createElement(
                        'span',
                        { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary, #6b7280)' } },
                        '捕获于 ' + new Date(tool.lastSeen).toLocaleTimeString() +
                          (tool.sessionTitle ? ' · ' + tool.sessionTitle : tool.sessionId ? ' · ' + String(tool.sessionId).slice(0, 8) + '…' : ''),
                      )
                    : null,
                  React.createElement('span', { style: { flex: '1 1 auto' } }),
                  tool.description
                    ? React.createElement(
                        'details',
                        { style: { fontSize: '12px' } },
                        React.createElement('summary', { style: { cursor: 'pointer' } }, '原始描述'),
                        React.createElement(
                          'pre',
                          {
                            style: {
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontFamily: 'inherit',
                              fontSize: '12px',
                              lineHeight: 1.5,
                              margin: '6px 0 0',
                              maxHeight: '200px',
                              overflow: 'auto',
                            },
                          },
                          tool.description,
                        ),
                      )
                    : null,
                ),
                // 0.4.81：原描述默认显示（前 3 行，多行截断）+ 输入框显式标签。
                // 原描述直接显示前三行，避免用户误以为工具提示列表为空；
                // 输入框明确说明「留空 = 保持原描述」。
                // 输入框必须说明「留空 = 保持原描述」，消除歧义。
                tool.description
                  ? React.createElement(
                      'div',
                      {
                        style: {
                          fontSize: '12px',
                          color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
                          marginTop: '4px',
                          lineHeight: 1.5,
                          overflow: 'hidden',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          wordBreak: 'break-word',
                        },
                        title: '原始描述',
                      },
                      tool.description,
                    )
                  : null,
                React.createElement(
                  'div',
                  { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9aa0a6)', marginTop: '6px' } },
                  '自定义提示词 · 留空保持原描述',
                ),
                React.createElement('textarea', {
                  className: 'dshp-textarea',
                  style: { minHeight: '56px', marginTop: '8px' },
                  value: text,
                  maxLength: TOOL_PROMPT_MAX,
                  placeholder: '留空 = 保持原描述。例如：仅当用户在当前消息中明确要求时才允许使用；不要自行判断后主动调用。',
                  disabled: !writable || busy,
                  onChange: function (event) {
                    setToolDraft(tool.name, event.target.value)
                  },
                }),
              ),
            )
          })(toolList[tli])
        }

        var pageTabs = React.createElement(
          'div',
          { style: { display: 'flex', gap: '8px', marginBottom: '14px' } },
          React.createElement(
            'button',
            { type: 'button', className: page === 'system' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setPage('system') } },
            '系统提示词',
          ),
          React.createElement(
            'button',
            { type: 'button', className: page === 'tools' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setPage('tools') } },
            '工具提示',
          ),
        )

        if (page === 'tools') {
          var toolsSection = React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-label' }, '工具提示'),
              React.createElement(
                'div',
                { className: 'dshp-hint' },
                '只改描述文本，不改参数与行为',
              ),
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn', disabled: !writable || refreshing, onClick: requestRefresh },
                  refreshing ? '刷新中…' : '刷新工具列表',
                ),
                React.createElement(
                  'span',
                  { className: 'dshp-hint' },
                  '各会话工具集并集，保留 15 分钟',
                ),
                refreshNote ? React.createElement('span', { className: 'dshp-note' }, refreshNote) : null,
                value.toolPreview && value.toolPreview.updatedAt
                  ? React.createElement(
                      'span',
                      { className: 'dshp-note' },
                      '（当前列表捕获于 ' + new Date(value.toolPreview.updatedAt).toLocaleTimeString() + '）',
                    )
                  : null,
                                ),
              ),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              React.createElement(
                'div',
                { className: 'dshp-vfield' },
                React.createElement('div', { className: 'dshp-label' }, '模式'),
                React.createElement(
                  'div',
                  { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
                  React.createElement(
                    'label',
                    { className: 'dshp-radio' },
                    React.createElement('input', {
                      type: 'radio',
                      name: 'dshp-tool-prompts-mode',
                      checked: toolMode !== 'replace',
                      disabled: !writable || busy,
                      onChange: function () {
                        setToolMode('append')
                      },
                    }),
                    React.createElement('span', null, '追加到原描述末尾'),
                  ),
                  React.createElement(
                    'label',
                    { className: 'dshp-radio' },
                    React.createElement('input', {
                      type: 'radio',
                      name: 'dshp-tool-prompts-mode',
                      checked: toolMode === 'replace',
                      disabled: !writable || busy,
                      onChange: function () {
                        setToolMode('replace')
                      },
                    }),
                    React.createElement('span', null, '整份替换原描述'),
                  ),
                ),
                React.createElement(
                  'div',
                  { className: 'dshp-hint' },
                  toolMode === 'replace'
                    ? '整份替换：原说明丢失，建议追加'
                    : '追加：原描述完整保留',
                ),
              ),
              toolList.length === 0
                ? React.createElement(
                    'div',
                    null,
                    React.createElement(
                      'div',
                      { className: 'dshp-hint' },
                      '工具列表为空：让任一会话完成一次模型调用即自动出现。',
                    ),
                  )
                : toolRows,
              React.createElement(
                'div',
                { className: 'dshp-footer' },
                toolDirty
                  ? React.createElement('span', { className: 'dshp-note' }, '未保存')
                  : null,
                React.createElement(
                  'button',
                  { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: !writable || busy, onClick: saveToolPrompts },
                  '保存工具提示',
                ),
                customizedCount > 0
                  ? React.createElement('span', { className: 'dshp-note' }, '已定制 ' + customizedCount + ' / ' + toolList.length + ' 个工具')
                  : null,
              ),
            ),
          )
          return React.createElement(
            'div',
            { className: 'dshp-form' },
            pageTabs,
            toolsSection,
            statusNote ? React.createElement('div', { className: 'dshp-footer' }, React.createElement('span', { className: 'dshp-note' }, statusNote)) : null,
          )
        }

        // 0.4.90 版式（单列纵向，三段，层次自上而下）：
        //   ① 当前配置——选 preset（分段）+ 选生效提示词（下拉），主操作；
        //   ② 提示词预览——只读，看模型实际看到什么（来源 × 视图）；
        //   ③ 我的提示词——库管理（列表 + 新建 + 模板一键）。
        // 删掉大段说明文字、消灭换行；逻辑层（状态/handler/数据派生）完全不动。
        return React.createElement(
          'div',
          { className: 'dshp-form' },
          pageTabs,
          // ------------------------------------------------------------ ① 当前配置
          React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-label' }, '当前配置'),
            ),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              presetTabs,
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', flexWrap: 'nowrap' } },
                React.createElement('span', { className: 'dshp-label', style: { flex: '0 0 auto' } }, '生效提示词'),
                React.createElement('div', { style: { flex: '1 1 auto', minWidth: 0 } }, activeSelect),
                React.createElement('span', { className: 'dshp-tag' }, activeModeTag),
              ),
            ),
          ),
          // ------------------------------------------------------------ ② 提示词预览
          React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-label' }, '提示词预览'),
            ),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              React.createElement(
                'div',
                // 0.4.94：按钮整体换行（不换行的是**文字**——按钮本体 nowrap，
                // 见 styles.js）。此前整行 nowrap + 按钮可收缩 → 点一下「刷新」
                // 状态文案一变就把按钮挤扁、文字溢出按钮外。
                { style: { display: 'flex', alignItems: 'center', gap: '8px', rowGap: '6px', flexWrap: 'wrap' } },
                React.createElement('button', { type: 'button', className: tab === 'effective' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setTab('effective') } }, '当前生效'),
                React.createElement('button', { type: 'button', className: tab === 'default' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setTab('default') } }, '默认'),
                React.createElement('button', { type: 'button', className: view === 'template' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setView('template') } }, '模板'),
                React.createElement('button', { type: 'button', className: view === 'final' ? 'dshp-btn dshp-btn-primary' : 'dshp-btn', onClick: function () { setView('final') } }, '最终形态'),
                React.createElement('span', { style: { flex: '1 1 auto' } }),
                React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: !writable || refreshing, onClick: requestRefresh }, refreshing ? '刷新中…' : '刷新'),
                React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: !showCopy, onClick: doCopy }, copied ? '已复制' : '复制'),
              ),
              // 0.4.94：提示文字另起一行（此前挤在按钮行里，把按钮压到换行）。
              refreshNote ? React.createElement('div', { className: 'dshp-note', style: { marginTop: '4px' } }, refreshNote) : null,
              React.createElement(
                'pre',
                { className: 'dshp-preview', style: { marginTop: '10px' } },
                showCopy ? shownText : React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #9aa0a6)' } }, previewEmptyHint),
              ),
              // 0.4.94：说明行在 <pre> **外面**（此前它是 <pre> 的子节点，极简
              // 模板的预览因此多出第二行）。文字也砍到最短。
              React.createElement(
                'div',
                { className: 'dshp-preview-meta', style: { marginTop: '6px' } },
                shownFromBuiltin
                  ? React.createElement('span', { className: 'dshp-tag' }, builtinViewEntry ? builtinViewEntry.label : '内置模板')
                  : null,
                builtinViewEntry
                  ? React.createElement('button', { type: 'button', className: 'dshp-btn-sm', onClick: function () { setBuiltinView(null) } }, '返回')
                  : null,
                showCopy
                  ? React.createElement(
                      'span',
                      { className: 'dshp-note' },
                      (view === 'template' && varLegend.length > 0 ? varLegend.join(' · ') + ' · ' : '') + shownText.length + ' 字符',
                    )
                  : null,
              ),
              showCopy
                ? React.createElement(
                    'span',
                    { className: 'dshp-note' },
                    (view === 'template' && varLegend.length > 0 ? varLegend.join(' · ') + ' · ' : '') + shownText.length + ' 字符',
                  )
                : null,
            ),
          ),
          // ------------------------------------------------------------ ③ 我的提示词
          React.createElement(
            'div',
            { className: 'dshp-section' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-label' }, '提示词模板'),
              React.createElement('div', { className: 'dshp-hint' }, '4 个内置模板 + 自定义模板'),
            ),
            React.createElement(
              'div',
              { className: 'dshp-card' },
              libraryRows,
              React.createElement(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'nowrap' } },
                React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: !writable || busy, onClick: openNewEditor }, '＋ 新建'),
                React.createElement('span', { className: 'dshp-note', style: { flex: '0 0 auto' } }, '模板'),
                templateButtons,
              ),
            ),
            editorBlock,
          ),
          statusNote ? React.createElement('div', { className: 'dshp-footer' }, React.createElement('span', { className: 'dshp-note' }, statusNote)) : null,
        )
      }
    }
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
    // ------------------------------------------------------- session slim
    //
    // 组件 M：会话瘦身。设置 → 会话瘦身（settings.section，行开关 served 时
    // 才挂载）。把冗长会话「压缩续命」：
    //   对当前上下文窗口跑一次 /compact 同形压缩 → 创建并验证新 session
    //   （seed/checkpoint、workspace、模型/effort）→ 新 session 改回原名 →
    //   旧会话改名 原名@K（K = 同项目最大 @N + 1）→ 归档（不删除；
    //   0.4.74 连带其全部子代理逐个归档，archiveSession 不级联）。    //
    // 数据面：宿主 fetch 路由（/api/dshp/session-slim/*），本页 2.5s 轮询；另有一个独立的 250ms handoff watcher
    // /state 拿 { rows, memory, queue, done }（与核心 /api/file 同一连接服
    // 务、同一 origin，浏览器直连）。筛选/批量/单行瘦身全部 POST /slim 的
    // ids 列表——筛选逻辑在客户端（用户可见），宿主只认 ids。
    //
    // 版式（用户规格，自上而下）：
    //   ① 设置卡：事件数筛选（唯一筛选条件，默认 5000，0.4.73 用户拍板
     //      「以事件数为准」）/ compact 模型（provider、model、
    //      effort，留空 = 继承会话自身）/ 批量大小 + 保存；
    //   ② 刷新按钮（重新统计，含冷会话与归档会话）+ 上次统计时间；
    //   ③ 会话表：项目 | 会话名称 | 事件数 | zstd 原始大小 | 上下文 | 状态 |
    //      进行中 | 瘦身（单行）。0.4.74 起每行 = 一个主会话，子代理折叠
    //      进父行（事件数/大小 = 整树合计，行上标「含 N 子代理」）；事件数
    //      倒序（宿主已排）；符合筛选条件的行高亮；归档行默认隐藏（可勾选
    //      显示）；
    //   ④ 批量按钮：批量瘦身 · 筛选 / 批量瘦身 · 全部 / 停止；
    //   ⑤ 内存三色条：系统总内存 = DSH 进程(rss) + 其余已用 + 空闲；
    //   ⑥ 处理队列：进行中（阶段 + 耗时）+ 已完成（结果或错误，最多 20 条）。

    var SLIM_POLL_MS = 2500
    var SLIM_HANDOFF_POLL_MS = 500
    var SLIM_STATE_PATH = '/api/dshp/session-slim/state'
    var SLIM_SLIM_PATH = '/api/dshp/session-slim/slim'
    var SLIM_REFRESH_PATH = '/api/dshp/session-slim/refresh'
    var SLIM_STOP_PATH = '/api/dshp/session-slim/stop'
    var SLIM_HANDOFF_STATE_PATH = '/api/dshp/session-slim/handoff-state' // 0.4.99：轻量后台轮询
    var SLIM_HANDOFF_PATH = '/api/dshp/session-slim/handoff' // 0.4.99：归档前把 replacement 接管为 mainView
    var SLIM_VALIDATE_PATH = '/api/dshp/session-slim/validate-model' // 0.4.79：compact 模型可用性校验
    var SLIM_TESTCALL_PATH = '/api/dshp/session-slim/test-call' // 0.4.81：compact 模型真实最小调用

    var SLIM_PHASE_LABELS = {
      queued: '排队中',
      running: '处理中',
      reading: '读取转录',
      summarizing: '模型总结中',
      renaming: '改名中',
      archiving: '归档中',
      creating: '创建新会话中',
      'resolving-workspace': '确认工作区中',
      seeding: '注入摘要中',
      attaching: '挂回工作区中',
      'renaming-new': '新会话改名中',
      'selecting-model': '继承模型中',
      'stopping-new-agent': '停止新 agent 中',
      'verifying-new': '确认新会话可见中',
      handoff: '切换后台会话中',
      done: '完成',
      failed: '失败',
      cancelled: '已取消',
    }

    function slimPhaseLabel(phase) {
      return SLIM_PHASE_LABELS[phase] || phase || '未知'
    }

    function slimFmtBytes(value) {
      if (typeof value !== 'number' || !isFinite(value)) return '—'
      if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB'
      if (value >= 1048576) return (value / 1048576).toFixed(2) + ' MB'
      if (value >= 1024) return (value / 1024).toFixed(1) + ' KB'
      return value + ' B'
    }

    function slimFmtInt(value) {
      if (typeof value !== 'number' || !isFinite(value)) return '—'
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function slimCtxLabel(row) {
      var tokens = row && row.ctxTokens
      var windowSize = row && row.ctxWindow
      if (typeof tokens !== 'number') return '—'
      if (typeof windowSize === 'number' && windowSize > 0) {
        var pct = Math.min(999, Math.round((tokens / windowSize) * 1000) / 10)
        return slimFmtShortNum(tokens) + '/' + slimFmtShortNum(windowSize) + ' · ' + pct + '%'
      }
      return slimFmtShortNum(tokens)
    }

    // 0.4.83：短数字（十进制 1.8M / 262.1k）——0.4.81 的上下文列是带逗号全数字
    // （"1,820,000 / 1,048,576 (173%)"），在 12% 列宽里必然截断/溢出
    // （用户报告「大量文本交叠、大量显示不全」）。全精度在单元格 tooltip。
    function slimFmtShortNum(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '—'
      if (n >= 1000000) return Math.round((n / 1000000) * 10) / 10 + 'M'
      if (n >= 1000) return Math.round((n / 1000) * 10) / 10 + 'k'
      return String(n)
    }

    // 0.4.82：项目列显示文件夹名（全路径在行 tooltip）——全路径在 14%
    // 列宽里只剩半个目录名。
    function slimProjectName(row) {
      var p = row && row.project
      if (!p) return '—'
      var parts = String(p).split(/[\\/]+/)
      for (var i = parts.length - 1; i >= 0; i--) {
        if (parts[i]) return parts[i]
      }
      return String(p)
    }

    function slimElapsed(ms) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return ''
      var sec = Math.floor(ms / 1000)
      if (sec < 60) return sec + ' 秒'
      var min = Math.floor(sec / 60)
      return min + ' 分 ' + (sec % 60) + ' 秒'
    }

    function slimPost(path, body) {
      return fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      }).then(
        function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        },
        function (error) {
          throw error
        },
      )
    }

    function slimGetState() {
      return fetch(SLIM_STATE_PATH).then(
        function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        },
        function (error) {
          throw error
        },
      )
    }

    function slimGetHandoffState() {
      return fetch(SLIM_HANDOFF_STATE_PATH).then(
        function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status)
          return res.json()
        },
        function (error) {
          throw error
        },
      )
    }

    // 0.4.99：session-slim 是后台任务，不应因为归档当前主会话而把设置面板
    // 带走。Host 在真正 archive 前停在 phase=handoff；这里在页面是否打开都
    // 先把 replacement retain 成 mainView，再回执 Host。没有当前会话/没有可用
    // uiWorkspace 时回执 skipped，Host 仍会在短超时后继续，不阻塞无浏览器调用。
    function startSessionSlimBackground(child) {
      var stopped = false
      var claimedKey = ''
      var timer = null

      function currentMainSessionId() {
        try {
          var snapshot = child.sessions && child.sessions.list && child.sessions.list.getSnapshot ? child.sessions.list.getSnapshot() : null
          var byId = snapshot && snapshot.byId ? snapshot.byId : {}
          for (var id in byId) {
            var row = byId[id]
            if (row && row.retainedBy && row.retainedBy.mainView > 0) return id
          }
        } catch (error) {}
        return ''
      }

      function poll() {
        slimGetHandoffState().then(function (data) {
          if (stopped) return
          var job = data && data.current
          if (!job || job.phase !== 'handoff' || !job.key || !job.newSessionId || claimedKey === job.key) return
          claimedKey = job.key
          var switched = false
          if (currentMainSessionId() === job.sessionId && child.uiWorkspace && typeof child.uiWorkspace.openSession === 'function') {
            try {
              child.uiWorkspace.openSession(job.newSessionId)
              switched = true
            } catch (error) {}
          }
          slimPost(SLIM_HANDOFF_PATH, {
            key: job.key,
            sourceSessionId: job.sessionId,
            newSessionId: job.newSessionId,
            switched: switched,
          }).then(function (response) {
            if (!response || response.ok !== true) claimedKey = ''
          }).catch(function () {
            claimedKey = ''
          })
        }).catch(function () {})
      }

      poll()
      timer = setInterval(poll, SLIM_HANDOFF_POLL_MS)
      return function () {
        stopped = true
        if (timer) clearInterval(timer)
      }
    }

    function slimRowStateLabel(row) {
      if (row.running) return '进行中'
      if (row.archived) return '已归档'
      return row.live ? '在内存' : '冷'
    }

    function makeSessionSlimSettingsPage(ctx) {
      return function SessionSlimSettingsPage() {
        var [state, setState] = React.useState(null)
        var [error, setError] = React.useState('')
        var [showArchived, setShowArchived] = React.useState(false)
        var [actionNote, setActionNote] = React.useState('')
        var [slimPendingIds, setSlimPendingIds] = React.useState({})
         var slimPendingRef = React.useRef({})
          var lastFailureKeyRef = React.useRef('')
         var [refreshing, setRefreshing] = React.useState(false)

        // ---- 设置草稿（本地编辑，点「保存」一次性写入行配置）----
        var [draft, setDraft] = React.useState(null) // null = 尚未从行值初始化
        var [saving, setSaving] = React.useState(false)
        var [saveNote, setSaveNote] = React.useState('')

        // ---- 0.4.79：模型目录（下拉数据源）——与输入框的模型选择器同一远程契约
        // （remote.session.modelCatalog()）：groups[].id = provider，
        // groups[].models[].id = model，models[].reasoning = { defaultEffort,
        // efforts: [{id, name}] }。只列出本部署真实注册/可路由的模型，
        // 从根上杜绝手输不存在 provider（「no adapter registered」）。
        var [catalog, setCatalog] = React.useState(null)
        var [catalogError, setCatalogError] = React.useState('')
        var [catalogLoading, setCatalogLoading] = React.useState(true)
        React.useEffect(
          function () {
            if (!ctx || !ctx.remote || !ctx.remote.session || typeof ctx.remote.session.modelCatalog !== 'function') {
              setCatalogLoading(false)
              setCatalogError('模型目录不可用，已回退为手填' )
              return undefined
            }
            var stopped = false
            ctx.remote.session.modelCatalog().then(
              function (response) {
                if (stopped) return
                var value = response && response.value ? response.value : response
                if (value && Array.isArray(value.groups)) {
                  setCatalog(value)
                  setCatalogError('')
                } else {
                  setCatalogError('模型目录响应结构异常，已回退为手填。' )
                }
                setCatalogLoading(false)
              },
              function (err) {
                if (!stopped) {
                  setCatalogLoading(false)
                  setCatalogError('模型列表读取失败：' + ((err && err.message) || err) + '（已回退为手填）。' )
                }
              },
            )
            return function () {
              stopped = true
            }
          },
          [],
        )

        // ---- 0.4.79：compact 模型实时校验（草稿改动 600ms 防抖后问宿主
        // resolveCallConfig——与 slimOne 里真正的裁决同一函数）。
        var [modelCheck, setModelCheck] = React.useState(null)
        React.useEffect(
          function () {
            if (!draft) return undefined
            var timer = setTimeout(function () {
              var provider = String(draft.compactProvider || '').trim()
              var model = String(draft.compactModel || '').trim()
              var effort = String(draft.compactEffort || '').trim()
              if (!provider || !model) {
                setModelCheck({ ok: true, skipped: true })
                return
              }
              slimPost(SLIM_VALIDATE_PATH, { provider: provider, model: model, effort: effort }).then(
                function (res) {
                  setModelCheck(res || { ok: true })
                },
                function (err) {
                  setModelCheck({ ok: false, error: '校验请求失败：' + ((err && err.message) || err) })
                },
              )
            }, 600)
            return function () {
              clearTimeout(timer)
            }
          },
          [draft],
        )

        // ---- 0.4.81：compact 模型「测试调用」。✓ 校验行只证明路由已注册；
        // 真实最小调用才能暴露 provider 侧故障（未知模型/鉴权/限流）。
        var [modelTest, setModelTest] = React.useState(null)
        function runModelTest() {
          var provider = String(draft.compactProvider || '').trim()
          var model = String(draft.compactModel || '').trim()
          var effort = String(draft.compactEffort || '').trim()
          if (!provider || !model) {
            setModelTest({ ok: false, error: '请先选择/填写 provider 和模型' })
            return
          }
          setModelTest({ ok: null, busy: true })
          slimPost(SLIM_TESTCALL_PATH, { provider: provider, model: model, effort: effort }).then(
            function (res) {
              setModelTest(res || { ok: false, error: '宿主无响应' })
            },
            function (err) {
              setModelTest({ ok: false, error: '测试调用请求失败：' + ((err && err.message) || err) })
            },
          )
        }

        var mirror = null
        try {
          mirror = ctx.configForms.describe()
        } catch (err) {}
        var [, setTick] = React.useState(0)

        // 行 revision 门控（0.4.65 范式）：只有本行 revision 变化才重渲染。
        React.useEffect(
          function () {
            if (!mirror || typeof mirror.subscribe !== 'function') return undefined
            function readRowRevision() {
              var rev
              try {
                var snap = mirror.getSnapshot ? mirror.getSnapshot() : null
                var ns = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
                for (var i = 0; i < ns.length; i++) {
                  if (ns[i] && ns[i].ns === NS_SESSION_SLIM) {
                    rev = ns[i].revision
                    break
                  }
                }
              } catch (err) {}
              return rev
            }
            var lastRev = readRowRevision()
            var off = mirror.subscribe(function () {
              var rev = readRowRevision()
              if (rev === lastRev) return
              lastRev = rev
              setTick(function (t) {
                return t + 1
              })
            })
            return function () {
              off()
            }
          },
          [],
        )

        var form = null
        var value = {}
        try {
          var snap = mirror && mirror.getSnapshot ? mirror.getSnapshot() : null
          var namespaces = snap && snap.view && Array.isArray(snap.view.namespaces) ? snap.view.namespaces : []
          var served = namespaces.some(function (view) {
            return view && view.ns === NS_SESSION_SLIM
          })
          if (served) {
            var ctrl = ctx.configForms.get(NS_SESSION_SLIM)
            form = { state: ctrl.getSnapshot(), mutate: function (ops, revision) { return ctrl.mutate(ops, revision) } }
          }
        } catch (err) {}
        var servedNow = !!(form && form.state && form.state.status === 'ready')

        if (servedNow && form.state.value && draft === null) {
          var v = form.state.value
          setDraft({
            minEvents: typeof v.minEvents === 'number' ? v.minEvents : 5000,
            compactProvider: typeof v.compactProvider === 'string' ? v.compactProvider : '',
            compactModel: typeof v.compactModel === 'string' ? v.compactModel : '',
            compactEffort: typeof v.compactEffort === 'string' ? v.compactEffort : '',
            batchSize: typeof v.batchSize === 'number' ? v.batchSize : 3,
          })
        }

        // ---- 2.5s 轮询 /state（页面卸载时清定时器）----
        React.useEffect(
          function () {
            var stopped = false
            var timer = null
            function poll() {
              slimGetState()
                .then(function (data) {
                  if (stopped) return
                  var latestDone = data && Array.isArray(data.done) && data.done.length > 0 ? data.done[0] : null
                  if (latestDone && latestDone.key && latestDone.key !== lastFailureKeyRef.current) {
                    lastFailureKeyRef.current = latestDone.key
                    if (latestDone.phase === 'failed') setActionNote('瘦身失败：' + (latestDone.error || '未知原因'))
                  }
                  setState(data)
                  setError('')
                })
                .catch(function (err) {
                  if (!stopped) setError('状态读取失败：' + ((err && err.message) || err))
                })
            }
            poll()
            timer = setInterval(poll, SLIM_POLL_MS)
            return function () {
              stopped = true
              if (timer) clearInterval(timer)
            }
          },
          [],
        )

        // 0.4.83：state 一旦确认任务已进入 queue/current/done，就释放本地提交锁；
         // queue/current 仍由行按钮自己的状态继续负责禁用。
         React.useEffect(
           function () {
             if (!state) return
             var active = {}
             var stateQueue = Array.isArray(state.queue) ? state.queue : []
             for (var qi = 0; qi < stateQueue.length; qi++) {
               if (stateQueue[qi] && stateQueue[qi].sessionId) active[stateQueue[qi].sessionId] = true
             }
             if (state.current && state.current.sessionId) active[state.current.sessionId] = true
             var finished = {}
             var stateDone = Array.isArray(state.done) ? state.done : []
             for (var di = 0; di < stateDone.length; di++) {
               if (stateDone[di] && stateDone[di].sessionId) finished[stateDone[di].sessionId] = true
             }
             setSlimPendingIds(function (prev) {
               var next = Object.assign({}, prev)
               var changed = false
               for (var id in next) {
                 if (active[id] || finished[id]) {
                   delete next[id]
                   delete slimPendingRef.current[id]
                   changed = true
                 }
               }
               return changed ? next : prev
             })
           },
           [state],
         )

         function clearNoteAfter(note, ms) {
          setActionNote(note)
          setTimeout(function () {
            setActionNote(function (cur) {
              return cur === note ? '' : cur
            })
          }, ms || 8000)
        }

        function requestSlim(ids, label) {
          if (!ids || ids.length === 0) {
            clearNoteAfter(label + '：没有符合条件的会话。')
            return
          }
          // 客户端过滤第二道防线：批量按钮可能在轮询前再次触发，不能把
           // 已提交、已入队或 current 中的同一会话再次 POST 给宿主。
           var acceptedIds = ids.filter(function (id) {
             if (!id || slimPendingRef.current[id] || slimPendingIds[id]) return false
             if (queue.some(function (q) { return q && q.sessionId === id })) return false
             if (currentJob && currentJob.sessionId === id) return false
             return true
           })
           if (acceptedIds.length === 0) {
             clearNoteAfter(label + '：这些会话已经提交、排队或正在处理，没有新增任务。', 8000)
             return
           }
           setSlimPendingIds(function (prev) {
             var next = Object.assign({}, prev)
             for (var i = 0; i < acceptedIds.length; i++) {
               slimPendingRef.current[acceptedIds[i]] = true
               next[acceptedIds[i]] = true
             }
             return next
           })
           setActionNote('正在提交 ' + acceptedIds.length + ' 个会话（' + label + '）…按钮已锁定。')
          slimPost(SLIM_SLIM_PATH, { ids: acceptedIds })
             .then(function (result) {
               var queued = result && typeof result.queued === 'number' ? result.queued : acceptedIds.length
               if (queued > 0) {
                 clearNoteAfter('已提交 ' + queued + ' 个会话（' + label + '），已进入处理队列。', 6000)
               } else {
                 clearNoteAfter('这些会话已在队列中或正在处理，没有新增任务。', 8000)
               }
               return slimGetState().then(function (data) {
                 setState(data)
                 setError('')
               })
             })
             .catch(function (err) {
               setSlimPendingIds(function (prev) {
                 var next = Object.assign({}, prev)
                 for (var i = 0; i < acceptedIds.length; i++) {
                   delete slimPendingRef.current[acceptedIds[i]]
                   delete next[acceptedIds[i]]
                 }
                 return next
               })
               clearNoteAfter('入队失败：' + ((err && err.message) || err) + '；按钮已恢复，可重试。', 10000)
             })
        }

        function requestRefresh() {
          if (refreshing) return
          setRefreshing(true)
          slimPost(SLIM_REFRESH_PATH, {})
            .then(function () {
              return slimGetState()
            })
            .then(function (data) {
              setState(data)
              setError('')
              clearNoteAfter('已重新统计。', 4000)
            })
            .catch(function (err) {
              clearNoteAfter('刷新失败：' + ((err && err.message) || err), 10000)
            })
            .then(function () {
              setRefreshing(false)
            })
        }

        function requestStop() {
          clearNoteAfter('已请求停止：排队的任务不再执行。', 5000)
          slimPost(SLIM_STOP_PATH, {}).catch(function (err) {
            clearNoteAfter('停止失败：' + ((err && err.message) || err), 8000)
          })
        }

        function saveSettings() {
          if (!form || !draft || saving) return
          setSaving(true)
          setSaveNote('')
          var ops = [
            { op: 'set', path: ['minEvents'], value: Math.max(1, Math.floor(Number(draft.minEvents) || 5000)) },
            { op: 'set', path: ['compactProvider'], value: String(draft.compactProvider || '').trim() },
            { op: 'set', path: ['compactModel'], value: String(draft.compactModel || '').trim() },
            { op: 'set', path: ['compactEffort'], value: String(draft.compactEffort || '').trim() },
            { op: 'set', path: ['batchSize'], value: Math.max(1, Math.min(10, Math.floor(Number(draft.batchSize) || 3))) },
          ]
          // 0.4.77：与 prompts 页同一契约——不传渲染期 revision，写入时读最新快照。
          Promise.resolve(form.mutate(ops)).then(
            function (ok) {
              setSaving(false)
              setSaveNote(ok ? '已保存。' : '保存被拒绝，请重试。')
            },
            function () {
              setSaving(false)
              setSaveNote('保存被拒绝，请重试。')
            },
          )
        }

        // 0.4.91：compact 路线**改完即生效**（立即写入设置）。
        // 此前只有点「保存设置」才写入，而「测试调用」用的是页面草稿、瘦身用的是
        // 已保存值——于是出现「测试调用成功、瘦身却 402 Insufficient Balance」的
        // 错位（本机实测：已保存值是余额为 0 的 deepseek-official，草稿是另一条
        // 能跑通的路线；两者从来不是同一条）。现在两者永远是同一条路线。
        function persistCompact(provider, model, effort) {
          if (!form) return
          try {
            Promise.resolve(
              form.mutate([
                { op: 'set', path: ['compactProvider'], value: String(provider || '').trim() },
                { op: 'set', path: ['compactModel'], value: String(model || '').trim() },
                { op: 'set', path: ['compactEffort'], value: String(effort || '').trim() },
              ]),
            ).catch(function () {})
          } catch (err) {}
        }

        function setCompact(provider, model, effort) {
          setDraft(function (d) {
            return Object.assign({}, d, {
              compactProvider: provider,
              compactModel: model,
              compactEffort: effort,
            })
          })
          persistCompact(provider, model, effort)
        }

        // ---- 派生：可见行 / 筛选命中 / 批量 ids ----
        var rows = state && Array.isArray(state.rows) ? state.rows : []
        // 0.4.73：筛选以事件数为唯一条件（用户拍板「以事件数为准」），默认 5000。
        var minEvents = draft ? Math.max(1, Math.floor(Number(draft.minEvents) || 5000)) : 5000
        function qualifies(row) {
          if (!row) return false
          return row.events >= minEvents
        }
        var visible = []
        for (var vi = 0; vi < rows.length; vi++) {
          if (!showArchived && rows[vi].archived) continue
          visible.push(rows[vi])
        }
         var queue = state && Array.isArray(state.queue) ? state.queue : []
         var done = state && Array.isArray(state.done) ? state.done : []
         // 0.4.78：在途任务（此前 shift 离开 queue 后到完成前对用户不可见）
         var currentJob = state && state.current ? state.current : null
         var mem = state && state.memory ? state.memory : null
         var eligibleIds = []
         var idleIds = []
         for (var ei = 0; ei < visible.length; ei++) {
           var r = visible[ei]
           var rowInQueue = queue.some(function (q) { return q && q.sessionId === r.id })
           var rowCurrent = !!(currentJob && currentJob.sessionId === r.id)
           var rowPending = !!slimPendingIds[r.id]
           // 0.4.83：筛选批量 ids 也排除 queue/current/本地提交中，
           // 不让批量按钮把已在生命周期中的会话再次提交。
           if (r.running || rowInQueue || rowCurrent || rowPending) continue
           idleIds.push(r.id)
           if (qualifies(r)) eligibleIds.push(r.id)
         }

        // ---- 行渲染 ----
        var headerCells = ['项目', '会话名称', '事件数', '大小', '子代理', '上下文', '默认模型', '状态', '进行中', '瘦身']
        var tableHead = React.createElement(
          'tr',
          null,
          headerCells.map(function (label, i) {
            return React.createElement(
              'th',
              {
                key: i,
                style: {
                  textAlign: i >= 2 && i <= 5 ? 'right' : 'left',
                  padding: '6px 10px',
                  borderBottom: '1px solid var(--dsw-alias-border-secondary, #2a2f3a)',
                  color: 'var(--dsw-alias-label-secondary, #9aa0a6)',
                  fontSize: '12px',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                },
                title: label === '事件数'
                  ? '主会话 + 子代理合计'
                  : label === '大小'
                    ? 'zstd 原始文件大小'
                    : label === '子代理'
                       ? '折叠进当前主会话的子代理数量；事件数和大小已包含整棵会话树'
                       : label === '默认模型'
                      ? '未指定 compact 模型时用这个'
                      : undefined,
              },
              label,
            )
          }),
        )
        var bodyRows = visible.map(function (row, i) {
          var hot = qualifies(row)
          var inQueue = queue.some(function (q) {
            return q && q.sessionId === row.id
          })
          var isCurrent = !!(currentJob && currentJob.sessionId === row.id)
           var isPending = !!slimPendingIds[row.id]
           var cellStyle = {
            padding: '6px 10px',
            borderBottom: '1px solid var(--dsw-alias-border-tertiary, #1f242e)',
            fontSize: '13px',
          }
          var nameTitle = (row.cwd ? row.cwd + ' — ' : '') + (row.title || row.id)
          var buttonLabel = isPending ? '提交中…' : inQueue ? '已入队' : isCurrent || row.running ? '处理中…' : '瘦身'
          var buttonDisabled = row.running || inQueue || isCurrent || isPending
          return React.createElement(
            'tr',
            {
              key: row.id,
              style: {
                background: hot ? 'rgba(64, 145, 255, 0.07)' : i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                opacity: row.archived ? 0.55 : 1,
              },
            },
            React.createElement('td', { style: Object.assign({}, cellStyle, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }), title: row.cwd || '' }, slimProjectName(row)),
            React.createElement('td', { style: Object.assign({}, cellStyle, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }), title: nameTitle },
              row.title || '(无标题)',
                            hot ? React.createElement('span', { className: 'dshp-tag', style: { marginLeft: '6px' } }, '命中') : null,
            ),
            React.createElement('td', { style: Object.assign({}, cellStyle, { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }) }, slimFmtInt(row.events)),
            React.createElement('td', { style: Object.assign({}, cellStyle, { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }) }, slimFmtBytes(row.fileBytes)),
             React.createElement('td', { style: Object.assign({}, cellStyle, { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }), title: typeof row.subCount === 'number' && row.subCount > 0 ? row.subCount + ' 个子代理' : '没有子代理' }, typeof row.subCount === 'number' ? slimFmtInt(row.subCount) : '0'),
            React.createElement('td', { style: Object.assign({}, cellStyle, { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }), title: typeof row.ctxTokens === 'number' ? '上下文 ' + row.ctxTokens + ' tokens' + (typeof row.ctxWindow === 'number' ? ' / 窗口 ' + row.ctxWindow : '') : '上下文' }, slimCtxLabel(row)),
            // 0.4.79：默认模型列——直接 compact 时继承的模型（与宿主 slimOne 的
            // lastUsed 回退同源：modelSelection.lastUsed）。
            // 0.4.83：只显示模型名（完整 provider/model/effort 进 tooltip）
            // ——"provider/model · effort" 在 16% 列宽里永远截半。
            React.createElement('td', { style: Object.assign({}, cellStyle, { fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }) },
              row.provider
                ? React.createElement('span', { title: row.provider + '/' + (row.model || '?') + (row.effort ? '（effort: ' + row.effort + '）' : '') + ' — 设置里未指定 compact 模型时瘦身用它' },
                    row.model || '?')
                : '—',
            ),
            React.createElement('td', { style: Object.assign({}, cellStyle, { overflow: 'hidden' }) },
              React.createElement(
                'span',
                {
                  className: 'dshp-tag',
                  style: {
                    color: row.running ? '#ff9f43' : row.archived ? '#8a8f98' : 'var(--dsw-alias-label-primary, #e8eaed)',
                  },
                },
                slimRowStateLabel(row),
              ),
            ),
            React.createElement('td', { style: Object.assign({}, cellStyle, { overflow: 'hidden' }) }, row.running ? React.createElement('span', { style: { color: '#ff9f43' } }, '是') : '否'),
            React.createElement(
              'td',
              { style: Object.assign({}, cellStyle, { whiteSpace: 'nowrap', overflow: 'hidden' }) },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dshp-btn-sm',
                  disabled: buttonDisabled,
                  onClick: function () {
                    if (!buttonDisabled) requestSlim([row.id], '单个会话')
                  },
                },
                buttonLabel,
              ),
            ),
          )
        })

        // ---- 内存三色条：DSH(rss) + 其余已用 + 空闲 = 总内存 ----
        var memoryBar = null
        if (mem && typeof mem.total === 'number' && mem.total > 0) {
          var rssPct = Math.min(100, (mem.rss / mem.total) * 100)
          var otherPct = Math.max(0, Math.min(100 - rssPct, (Math.max(0, mem.used - mem.rss) / mem.total) * 100))
          var freePct = Math.max(0, 100 - rssPct - otherPct)
          memoryBar = React.createElement(
            'div',
            { style: { marginTop: '14px' } },
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  height: '18px',
                  borderRadius: '5px',
                  overflow: 'hidden',
                  border: '1px solid var(--dsw-alias-border-secondary, #2a2f3a)',
                  background: 'rgba(255,255,255,0.04)',
                },
              },
              React.createElement('div', { style: { width: rssPct + '%', background: '#e5534b', transition: 'width 0.6s' } }),
              React.createElement('div', { style: { width: otherPct + '%', background: '#e0a63f', transition: 'width 0.6s' } }),
              React.createElement('div', { style: { width: freePct + '%', background: 'rgba(120,140,170,0.25)' } }),
            ),
            React.createElement(
              'div',
              { style: { display: 'flex', flexWrap: 'wrap', gap: '14px', marginTop: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #9aa0a6)' } },
              React.createElement('span', null,
                React.createElement('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: '#e5534b', borderRadius: '2px', marginRight: '4px' } }),
                'DSH 进程 ' + slimFmtBytes(mem.rss) + '（pid ' + mem.pid + '）',
              ),
              React.createElement('span', null,
                React.createElement('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: '#e0a63f', borderRadius: '2px', marginRight: '4px' } }),
                '其余已用 ' + slimFmtBytes(Math.max(0, mem.used - mem.rss)),
              ),
              React.createElement('span', null,
                React.createElement('span', { style: { display: 'inline-block', width: '10px', height: '10px', background: 'rgba(120,140,170,0.25)', borderRadius: '2px', marginRight: '4px' } }),
                '空闲 ' + slimFmtBytes(mem.free),
              ),
              React.createElement('span', { style: { marginLeft: 'auto' } }, '系统总内存 ' + slimFmtBytes(mem.total) + '，已用 ' + slimFmtBytes(mem.used)),
            ),
          )
        }

        // ---- 队列渲染 ----
        var queueRows = queue.map(function (job, i) {
          var elapsed = job.startedAt ? Date.now() - job.startedAt : Date.now() - (job.at || Date.now())
          return React.createElement(
            'div',
            { key: job.key, style: { display: 'flex', gap: '10px', alignItems: 'center', padding: '4px 0', fontSize: '13px' } },
            React.createElement('span', { style: { color: '#4c9aff', flex: '0 0 auto' } }, '●'),
            React.createElement('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, job.title),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-secondary, #9aa0a6)', flex: '0 0 auto' } }, slimPhaseLabel(job.phase)),
            React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #6b7280)', flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } }, slimElapsed(elapsed)),
          )
        })
        var doneRows = done.slice(0, 20).map(function (job, i) {
          var okJob = job.phase === 'done'
          var fullDetail = ''
          if (okJob && job.detail) {
            fullDetail = '新会话 ' + (job.detail.newSessionId ? String(job.detail.newSessionId) : '?') + '，旧会话归档为 ' + (job.detail.archiveTitle || '?')
            if (typeof job.detail.summaryChars === 'number') fullDetail += '，摘要 ' + job.detail.summaryChars + ' 字符'
            if (typeof job.detail.archivedSubagents === 'number' && job.detail.archivedSubagents > 0) fullDetail += '，连带归档子代理 ' + job.detail.archivedSubagents
            if (job.detail.modelInherited) fullDetail += '，已继承模型'
            if (typeof job.detail.toolCountAfter === 'number' && job.detail.toolCountAfter >= 0) {
              fullDetail +=
                '，模式 ' + (job.detail.presetMounted || '未指定') + ' 工具 ' + job.detail.toolCountBefore + ' → ' + job.detail.toolCountAfter
            }
          } else {
            fullDetail = job.error || '未知原因'
          }
          if (Array.isArray(job.warnings) && job.warnings.length > 0) fullDetail += '；警告：' + job.warnings.join('；')
          if (job.errorCode) fullDetail += '（' + job.errorCode + '）'
          // 0.4.84：完成项一行结果（全文进 tooltip）；失败项原因完整换行
          // 显示（用户点名「失败原因可以详细一点」）。
          var shortDetail =
            okJob && job.detail
              ? '归档为 ' + (job.detail.archiveTitle || '?') + ' · 新会话 ' + (job.detail.newSessionId ? String(job.detail.newSessionId).slice(0, 8) : '?')
              : fullDetail
          var detailStyle = okJob
            ? { flex: '1 1 auto', color: 'var(--dsw-alias-label-tertiary, #6b7280)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            : { flex: '1 1 auto', color: '#e5534b', whiteSpace: 'normal', wordBreak: 'break-word', overflowWrap: 'anywhere', lineHeight: 1.5 }
          return React.createElement(
            'div',
            { key: job.key, style: { display: 'flex', gap: '10px', alignItems: okJob ? 'center' : 'flex-start', padding: '3px 0', fontSize: '12px' } },
            React.createElement('span', { style: { color: okJob ? '#3fb950' : '#e5534b', flex: '0 0 auto' } }, okJob ? '✓' : '✗'),
            React.createElement('span', { style: { flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, job.title),
            React.createElement('span', { style: detailStyle, title: okJob ? fullDetail : undefined }, shortDetail),
          )
        })

        var lastAt = state && state.now ? new Date(state.now).toLocaleTimeString() : '—'

        // ---- 设置卡（draft 输入，0.4.72 版式）----
        // 头行：标题 + 保存按钮（右对齐）；正文两个分组网格：
        // 「筛选与节奏」（事件数/批量大小）与「compact 模型」
        // （provider/模型名/effort）。控件统一走 dshp-number /
        // dshp-text-input / dshp-btn（与 prompts 页同一套基元）。
        var settingsCard = null
        if (draft) {
          var field = function (label, control) {
            return React.createElement(
              'div',
              { className: 'dshp-vfield', style: { gap: '5px' } },
              React.createElement('div', { className: 'dshp-flabel' }, label),
              control,
            )
          }
          var gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 16px' }
          settingsCard = React.createElement(
            'div',
            { className: 'dshp-card' },
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, '瘦身设置'),
              saveNote ? React.createElement('span', { className: 'dshp-note' }, saveNote) : null,
              React.createElement(
                'button',
                { type: 'button', className: 'dshp-btn', onClick: saveSettings, disabled: saving, style: { marginLeft: 'auto' } },
                saving ? '保存中…' : '保存设置',
              ),
            ),
            React.createElement('div', { className: 'dshp-hint' }, '按事件数筛选；子代理折叠进父会话'),
            React.createElement('div', { style: gridStyle },
              field('事件数 ≥',
                React.createElement('input', { type: 'number', min: '1', className: 'dshp-number', style: { width: '100%' }, value: draft.minEvents, onChange: function (e) { setDraft(function (d) { return Object.assign({}, d, { minEvents: e.target.value }) }) } })),
              field('批量大小',
                React.createElement('input', { type: 'number', min: '1', max: '10', className: 'dshp-number', style: { width: '100%' }, value: draft.batchSize, onChange: function (e) { setDraft(function (d) { return Object.assign({}, d, { batchSize: e.target.value }) }) } })),
            ),
            React.createElement('div', { className: 'dshp-hint', style: { marginTop: '6px' } },
              '留空 = 用各会话自己的模型'),
            React.createElement(
              'div',
              { className: 'dshp-note', style: { marginTop: '2px', fontSize: '12px' }, title: '改完即生效，与「测试调用」同一条路线' },
              '瘦身使用：' +
                (String(draft.compactProvider || '').trim() && String(draft.compactModel || '').trim()
                  ? String(draft.compactProvider).trim() + '/' + String(draft.compactModel).trim() +
                    (String(draft.compactEffort || '').trim() ? '（effort ' + String(draft.compactEffort).trim() + '）' : '')
                  : '各会话自己的模型') +
                '',
            ),
            catalog
              ? (function () {
                var groups = Array.isArray(catalog.groups) ? catalog.groups : []
                var providers = [] // [{id, name}]（name = 目录里的显示名）
                var seenP = {}
                for (var pg = 0; pg < groups.length; pg++) {
                  var gid = groups[pg] && groups[pg].id
                  if (gid && !seenP[gid]) { seenP[gid] = true; providers.push({ id: gid, name: typeof groups[pg].name === 'string' && groups[pg].name ? groups[pg].name : gid }) }
                }
                var selP = String(draft.compactProvider || '')
                var selM = String(draft.compactModel || '')
                var selE = String(draft.compactEffort || '')
                var curGroup = null
                for (var gg = 0; gg < groups.length; gg++) if (groups[gg] && groups[gg].id === selP) curGroup = groups[gg]
                var modelOpts = []
                var curModel = null
                if (curGroup && Array.isArray(curGroup.models)) {
                  for (var mm = 0; mm < curGroup.models.length; mm++) {
                    var mo = curGroup.models[mm]
                    if (mo && mo.id) { modelOpts.push(mo); if (mo.id === selM) curModel = mo }
                  }
                }
                // 保存值不在目录里（目录刷新间隙 / 模型下线）：仍保留为可选项，不丢用户已填的值
                if (!curModel && selM) curModel = { id: selM, reasoning: null }
                var effortOpts = []
                if (curModel && curModel.reasoning && Array.isArray(curModel.reasoning.efforts)) effortOpts = curModel.reasoning.efforts.slice()
                // 同模型：保存的 effort 不在目录里时保留为可选项（不丢已填值）
                if (selE && effortOpts.every(function (eo) { return !eo || eo.id !== selE })) effortOpts = effortOpts.concat([{ id: selE, name: null }])
                var selectStyle = { width: '100%' }
                return React.createElement('div', { style: gridStyle },
                  field('provider',
                    React.createElement('select', { style: selectStyle, value: selP, onChange: function (e) { setCompact(e.target.value, '', '') } },
                      React.createElement('option', { value: '' }, '留空 = 继承各会话自身'),
                      providers.map(function (pv) {
                        return React.createElement('option', { key: pv.id, value: pv.id }, pv.name !== pv.id ? pv.name + '（' + pv.id + '）' : pv.id)
                      }),
                    ),
                  ),
                  field('模型名',
                    React.createElement('select', { style: selectStyle, value: selM, onChange: function (e) { setCompact(selP, e.target.value, '') } },
                      React.createElement('option', { value: '' }, '留空 = 继承'),
                      (curGroup || selM ? modelOpts : []).map(function (mo) {
                        return React.createElement('option', { key: mo.id, value: mo.id }, mo.id)
                      }),
                    ),
                  ),
                  field('effort',
                    React.createElement('select', { style: selectStyle, value: selE, onChange: function (e) { setCompact(selP, selM, e.target.value) } },
                      React.createElement('option', { value: '' }, '留空 = 继承 / 提供方默认'),
                      effortOpts.map(function (eo) {
                        if (!eo || !eo.id) return null
                        var name = eo.name ? eo.name + '（' : ''
                        return React.createElement('option', { key: eo.id, value: eo.id }, name + eo.id + (eo.name ? '）' : ''))
                      }),
                    ),
                  ),
                )
              })()
              : React.createElement('div', null,
                catalogLoading
                  ? React.createElement('div', { className: 'dshp-hint' }, '模型列表加载中…' )
                  : catalogError
                    ? React.createElement('div', { className: 'dshp-note', style: { fontSize: '12px', color: '#e0a63f', marginBottom: '6px' } }, catalogError)
                    : null,
                React.createElement('div', { style: gridStyle },
                  field('provider',
                    React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '留空 = 继承', value: draft.compactProvider, onChange: function (e) { setCompact(e.target.value, draft.compactModel, draft.compactEffort) } })),
                  field('模型名',
                    React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '留空 = 继承', value: draft.compactModel, onChange: function (e) { setCompact(draft.compactProvider, e.target.value, draft.compactEffort) } })),
                  field('effort',
                    React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '如 high / max，留空 = 继承', value: draft.compactEffort, onChange: function (e) { setCompact(draft.compactProvider, draft.compactModel, e.target.value) } })),
                ),
              ),
            // 0.4.79：compact 模型可用性实时校验（宿主 resolveCallConfig 同一裁决）
            modelCheck && modelCheck.skipped
              ? React.createElement('div', { className: 'dshp-hint', style: { marginTop: '6px' } }, 'compact 模型未设置：瘦身时各会话用各自的模型。')
              : modelCheck && modelCheck.ok !== false
                ? React.createElement('div', { className: 'dshp-note', style: { marginTop: '6px', color: '#3fb950', fontSize: '12px' } }, '✓ 模型可用')
                : modelCheck
                  ? React.createElement('div', { className: 'dshp-note', style: { marginTop: '6px', color: '#e5534b', fontSize: '12px', overflowWrap: 'anywhere' } }, '✗ ' + (modelCheck.error || '模型不可用'))
                  : null,
            // 0.4.81：测试调用（真实最小请求；空文本/失败时给出 provider 真实原因）
            React.createElement(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm', disabled: !!(modelTest && modelTest.busy), onClick: runModelTest }, (modelTest && modelTest.busy) ? '测试中…' : '测试调用'),
              modelTest && !modelTest.busy
                ? modelTest.ok
                  ? React.createElement('div', { className: 'dshp-note', style: { color: '#3fb950', fontSize: '12px', overflowWrap: 'anywhere' } }, '✓ 测试调用成功：' + (modelTest.text || '（空）') + '（usage: ' + (modelTest.usage || '无') + '）')
                  : React.createElement('div', { className: 'dshp-note', style: { color: '#e5534b', fontSize: '12px', overflowWrap: 'anywhere' } }, '✗ 测试调用失败：' + (modelTest.error || '未知'))
                : null,
            ),
          )
        }

        return React.createElement(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1080px' } },
          React.createElement('div', null,
            React.createElement('h3', { style: { margin: '0 0 4px' } }, '会话瘦身'),
            React.createElement('div', { className: 'dshp-hint' },
              '把长会话压成 checkpoint 建新会话，旧会话改名归档。',
            ),
          ),
          settingsCard,
          React.createElement(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
            React.createElement('button', { type: 'button', className: 'dshp-btn', onClick: requestRefresh, disabled: refreshing }, refreshing ? '统计中…' : '刷新统计'),
            React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #9aa0a6)', cursor: 'pointer' } },
              React.createElement('input', { type: 'checkbox', checked: showArchived, onChange: function (e) { setShowArchived(e.target.checked) } }),
              '显示已归档',
            ),
            React.createElement('span', { className: 'dshp-note' }, '上次统计 ' + lastAt),
          ),
          error ? React.createElement(
            'div',
            {
              style: {
                padding: '8px 12px',
                borderRadius: '8px',
                border: '.5px solid rgba(229, 83, 75, 0.4)',
                background: 'rgba(229, 83, 75, 0.08)',
                color: '#e5534b',
                fontSize: '12px',
                lineHeight: '18px',
              },
            },
            error,
          ) : null,
          React.createElement(
            'div',
            { style: { overflowX: 'auto', border: '1px solid var(--dsw-alias-border-tertiary, #1f242e)', borderRadius: '8px' } },
            React.createElement(
              'table',
              // 0.4.81：固定布局 + 百分比列宽（自适应面板宽度）——0.4.78 的
              // 定宽列（总 762px + minWidth 1010px）在窄面板里溢出/交叠
              // （用户报告「几个项目的文本交叠在一起」）。百分比下任何宽度
              // 都 100% 排满、文本列省略号截断，不再交叠；固定布局保留，
              // 2.5s 轮询不再引起列宽抖动。
              { style: { width: '100%', minWidth: '640px', borderCollapse: 'collapse', tableLayout: 'fixed' } },
              React.createElement('colgroup', null,
                React.createElement('col', { style: { width: '14%' } }),
                React.createElement('col', null),
                React.createElement('col', { style: { width: '7%' } }),
                React.createElement('col', { style: { width: '10%' } }), // 大小
                 React.createElement('col', { style: { width: '7%' } }), // 子代理
                React.createElement('col', { style: { width: '12%' } }),
                React.createElement('col', { style: { width: '16%' } }), // 0.4.79：默认模型
                React.createElement('col', { style: { width: '8%' } }),
                React.createElement('col', { style: { width: '6%' } }),
                React.createElement('col', { style: { width: '9%' } }),
              ),
              React.createElement('thead', null, tableHead),
              React.createElement('tbody', null, bodyRows.length > 0 ? bodyRows : React.createElement('tr', null, React.createElement('td', { colSpan: 10, style: { padding: '18px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary, #6b7280)' } }, '暂无会话数据'))),
            ),
          ),
          React.createElement(
            'div',
            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' } },
            React.createElement('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: eligibleIds.length === 0, onClick: function () { requestSlim(eligibleIds, '筛选命中') } },
              '批量瘦身 · 筛选 ' + eligibleIds.length + ' 个',
            ),
            React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: idleIds.length === 0, onClick: function () { requestSlim(idleIds, '全部非进行中') } },
              '批量瘦身 · 全部 ' + idleIds.length + ' 个',
            ),
            React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: queue.length === 0 && !(state && state.busy), onClick: requestStop, style: { color: '#e5534b', borderColor: 'rgba(229,83,75,0.4)' } }, '停止队列'),
            actionNote ? React.createElement('span', { className: 'dshp-note' }, actionNote) : null,
          ),
          memoryBar,
          React.createElement(
            'div',
            { className: 'dshp-card' },
            React.createElement('div', { className: 'dshp-label', style: { marginBottom: '6px' } }, '处理队列'),
            currentJob
              ? React.createElement(
                  'div',
                  {
                    key: currentJob.key + ':current',
                    style: {
                      display: 'flex',
                      gap: '10px',
                      alignItems: 'center',
                      padding: '6px 8px',
                      marginBottom: '4px',
                      fontSize: '13px',
                      borderRadius: '6px',
                      background: 'rgba(255,159,67,0.08)',
                      border: '1px solid rgba(255,159,67,0.25)',
                    },
                  },
                  React.createElement('span', { style: { color: '#ff9f43', flex: '0 0 auto' } }, '▶'),
                  React.createElement('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, currentJob.title),
                  React.createElement('span', { style: { color: '#ff9f43', flex: '0 0 auto' } }, slimPhaseLabel(currentJob.phase)),
                  // 0.4.79：分片/合并进度（宿主 job.detail → /state current.detail）
                  currentJob.detail
                    ? React.createElement('span', { style: { color: 'var(--dsw-alias-label-tertiary, #6b7280)', flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } }, currentJob.detail)
                    : null,
                  React.createElement(
                    'span',
                    { style: { color: 'var(--dsw-alias-label-tertiary, #6b7280)', flex: '0 0 auto', fontVariantNumeric: 'tabular-nums' } },
                    slimElapsed(Date.now() - (currentJob.startedAt || currentJob.at || Date.now())),
                  ),
                )
              : null,
            !currentJob && queue.length === 0
              ? React.createElement('div', { className: 'dshp-hint' }, state && state.busy ? 'worker 唤醒中…' : '队列空闲。')
              : null,
            queueRows,
            done.length > 0 ? React.createElement('div', { className: 'dshp-label', style: { margin: '10px 0 4px' } }, '已完成') : null,
            doneRows,
          ),
        )
      }
    }
    // ------------------------------------------------------------------ apply

    var inject = ['slots', 'configForms']

    function apply(ctx) {
      upsertStyle(FORM_STYLE_ID, FORM_CSS)
      upsertStyle(DEPTH_STYLE_ID, DEPTH_CSS)

      // ---- component A: DOM engine, driven by its settings namespace.
      var engine = createEngine()
      var mirror = null
      try {
        mirror = ctx.configForms.describe()
      } catch (error) {
        mirror = null
      }

      function syncRenderer() {
        var read = readNamespace(ctx, NS_RENDERER, RENDERER_DEFAULTS)
        engine.setConfig({
          lines: num(read.value.lines, RENDERER_DEFAULTS.lines, 1, 20),
          collapseMs: num(read.value.collapseMs, RENDERER_DEFAULTS.collapseMs, 0, 2000),
          autoOpen: read.value.autoOpen !== false,
          showTime: read.value.showTime !== false,
          followMs: num(read.value.followMs, RENDERER_DEFAULTS.followMs, 0, 2000),
        })
        // The row switch is the component switch: when the Host stops serving
        // the namespace, its Loader entry is off, and so is the behaviour.
        if (read.served) engine.start()
        else engine.stop()
      }

      // ---- component B: the shipped 推理等级 row, rewritten as a slider.
      var patcher = createDepthPatcher()

      // ---- component C: up-arrow recall of this session's user messages.
      var history = createComposerHistory()

      // ---- component D: LRU ordering of the workspace groups. The engine is
      // created behind its own injection (it needs the workspaces/sessions
      // stores + remote.workspace) and stored here so syncLru can gate it.
      var lruEngine = null

      // ---- component E: completion / needs-attention alerts. Pure client — it
      // reads the viewed session's durable log through the always-on session
      // registry, so it needs no extra injection; the four toggles gate the
      // synthesized chime + system toast.
      var notifyEngine = createNotify()

      // ---- component I: chat visualization (```svg / ```mermaid fences →
      // diagrams). Pure client DOM enhancement — no extra ctx services — the
      // mermaid runtime arrives lazily through the client-modules chunk
      // protocol, so nothing heavy loads until a mermaid block actually shows.
      var visualizeEngine = createVisualize()

      function syncDepth() {
        var read = readNamespace(ctx, NS_DEPTH, DEPTH_DEFAULTS)
        depthConfigStore.set({
          showInComposer: read.value.showInComposer !== false,
          palette: DEPTH_PALETTES[read.value.palette] === undefined ? DEPTH_DEFAULTS.palette : read.value.palette,
          labels: read.value.labels !== false,
        })
        // Same rule as component A: no served namespace, no behaviour.
        if (read.served && read.value.showInComposer !== false) patcher.start()
        else patcher.stop()
      }

      function syncHistory() {
        var read = readNamespace(ctx, NS_HISTORY, HISTORY_DEFAULTS)
        history.setConfig({ enabled: read.served && read.value.enabled !== false })
      }

      function syncLru() {
        if (!lruEngine) return
        var read = readNamespace(ctx, NS_LRU, LRU_DEFAULTS)
        lruEngine.setConfig({
          enabled: read.served && read.value.enabled !== false,
          // 子智能体目录 LRU 是独立子开关（默认关），但同受行开关总闸约束。
          subagent: read.served && read.value.subagent === true,
        })
      }

      function syncNotify() {
        var read = readNamespace(ctx, NS_NOTIFY, NOTIFY_DEFAULTS)
        notifyEngine.setConfig({
          completeSound: read.served && read.value.completeSound === true,
          completeNotify: read.served && read.value.completeNotify === true,
          attentionSound: read.served && read.value.attentionSound === true,
          attentionNotify: read.served && read.value.attentionNotify === true,
        })
      }

      function syncVisualize() {
        var read = readNamespace(ctx, NS_VISUALIZE, VISUALIZE_DEFAULTS)
        visualizeEngine.setConfig({
          svg: read.served && read.value.svg !== false,
          mermaid: read.served && read.value.mermaid !== false,
        })
      }

      function syncAll() {
        syncRenderer()
        syncDepth()
        syncHistory()
        syncLru()
        syncNotify()
        syncVisualize()
        applyTimerActive(ctx)
      }

      ctx.effect(
        function () {
          if (mirror !== null && typeof mirror.subscribe === 'function') {
            var off = mirror.subscribe(syncAll)
            return function () {
              off()
            }
          }
          return function () {}
        },
        'dsh-polish: settings watch',
      )
      ctx.effect(
        function () {
          syncAll()
          history.start()
          notifyEngine.start()
          return function () {
            engine.stop()
            patcher.stop()
            history.stop()
            notifyEngine.stop()
            visualizeEngine.stop()
          }
        },
        'dsh-polish: thinking renderer',
      )

      // ---- component B needs the session Remote namespace for its writes, so
      // it lives behind its own injection: a deployment without `remote.session`
      // loses the slider only, never component A.
      ctx.inject(['remote', 'remote.session'], function (child) {
        // Always-on session capture: records the viewed session's Remote for
        // session-aware features (the thinking-time engine). Not gated by any
        // component row, so it is present whenever the parent dsh-polish row is
        // live — the time engine works even when composer-history is off.
        child.effect(
          function () {
            return child.slots.inject('conversation.input.right', function () {
              return child.slots.register(
                { name: 'conversation.input.right', id: 'dsh-polish:session-capture', order: 10 },
                makeSessionCapture(child),
              )
            })
          },
          'dsh-polish: session capture',
        )

        child.effect(
          function () {
            return child.configForms.whileServed([NS_DEPTH], function () {
              return child.slots.inject('conversation.input.right', function () {
                return child.slots.register(
                  { name: 'conversation.input.right', id: 'dsh-polish:thinking-depth', order: 40 },
                  makeSessionContext(child),
                )
              })
            })
          },
          'dsh-polish: thinking depth control',
        )

        // Component C: a hidden anchor per session, so the focused input can
        // find its session and the engine can reach `remote.session.page`.
        // Mounted unconditionally (exactly like the always-on session-capture
        // above) so the anchor + registry always exist. The anchor itself is inert
        // — the actual recall behaviour is still gated by the row's served state
        // via history.setConfig({ enabled }), so the component stays toggleable.
        child.effect(
          function () {
            return child.slots.inject('conversation.input.right', function () {
              return child.slots.register(
                { name: 'conversation.input.right', id: 'dsh-polish:composer-history', order: 50 },
                makeHistorySession(child, history),
              )
            })
          },
          'dsh-polish: composer history control',
        )

        // Component K (client half): per-(session, model) effort memory. It
        // watches the durable modelSelection projection of the mounted session
        // and answers the two spec moments with the selector's own calls —
        // save on effort change (immediate config write), restore on model
        // change (immediate selectModel with the remembered effort). Gated by
        // the keep-effort row switch (whileServed).
        child.effect(
          function () {
            return child.configForms.whileServed([NS_KEEP_EFFORT], function () {
              return child.slots.inject('conversation.input.right', function () {
                return child.slots.register(
                  { name: 'conversation.input.right', id: 'dsh-polish:keep-effort', order: 60 },
                  makeEffortKeeper(child),
                )
              })
            })
          },
          'dsh-polish: keep effort sync',
        )

        // 0.4.79: component M（会话瘦身）移入本注入块——页面新增
        // remote.session.modelCatalog() 读取（compact 模型下拉的数据源，
        // 与输入框模型选择器同一远程契约）。部署没有 remote.session 时
        // 整个瘦身页缺席（此前页面仍渲染但模型只能手填；此部署有该服务）。
        child.effect(
          function () {
            return child.configForms.whileServed([NS_SESSION_SLIM], function () {
              return child.slots.inject('settings.section', function () {
                return child.slots.register(
                  { name: 'settings.section', id: 'session-slim', order: 30, label: function () { return '会话瘦身' } },
                  makeSessionSlimSettingsPage(child),
                )
              })
            })
          },
          'dsh-polish: session slim settings section',
        )
      })

      // 0.4.99：session-slim 的 mainView handoff 必须独立于设置页挂载。设置页
      // 可能正是在旧主会话归档时被 shell 卸载；后台 watcher 仍要把 replacement
      // 接管为 main，才能让 settings shell 不把这次短暂切换当成 onboarding。
      ctx.inject(['sessions', 'uiWorkspace', 'configForms'], function (child) {
        child.effect(
          function () {
            return child.configForms.whileServed([NS_SESSION_SLIM], function () {
              return startSessionSlimBackground(child)
            })
          },
          'dsh-polish: session slim main handoff',
        )
      })

      // 0.4.101：重装/HMR 后主动重新拉取一次权威 session catalog。
      // DSH Client 的初次 catalog 拉取可能早于 Host 的 persistence/workspace
      // 恢复完成；如果第一次 list 在这个窗口失败，workspace 仍有 sessionIds，
      // 但 sessions.list.byId 没有对应 summary，sidebar 会把这些成员全部省略。
      // 这是只读刷新，不恢复 Agent、不改 session 日志，也不改变 workspace 归属。
      ctx.inject(['sessions', 'timer'], function (child) {
        child.effect(
          function () {
            if (!child.timer || typeof child.timer.timeout !== 'function') return
            var stopped = false
            function refreshCatalog() {
              if (stopped || !child.sessions || typeof child.sessions.refresh !== 'function') return
              try {
                var result = child.sessions.refresh()
                if (result && typeof result.catch === 'function') result.catch(function () {})
              } catch (error) {}
            }
            var dispose = child.timer.timeout(refreshCatalog, 1500)
            return function () {
              stopped = true
              try {
                if (typeof dispose === 'function') dispose()
              } catch (error) {}
            }
          },
          'dsh-polish: refresh session catalog after startup',
        )
      })

      // ---- timer clock: the most robust data channel. A fresh remote read of
      // the whole settings document every 1.5s (remote.settings.describe() —
      // the same call DSH's own settings mirror makes to reach the Host), which
      // bypasses the "did the event get forwarded / did the local mirror
      // subscription fire" uncertainty that left the icon blank. Gated behind its
      // own injection: a deployment without remote.settings simply has no clock.
      ctx.inject(['remote', 'remote.settings'], function (child) {
        child.effect(
          function () {
            return startTimerPoll(child.remote.settings)
          },
          'dsh-polish: timer settings poll',
        )
      })

      // ---- component F: 切换会话模式（「...」菜单）。需要 remote.agentPresets
      // （列预设）+ remote.settings（写 request / 读 result），所以放在自己的
      // 注入后面；部署没有这些 remote 命名空间就只是没有这个菜单。菜单项只在
      // 本行 served（行开关开）时出现（whileServed），行关则消失。
      ctx.inject(['remote', 'remote.agentPresets', 'remote.settings'], function (child) {
        child.effect(
          function () {
            return child.configForms.whileServed([NS_MODE_SWITCH], function () {
              return child.slots.inject('sidebar.workspaces.session.menu.item', function () {
                return child.slots.register(
                  {
                    name: 'sidebar.workspaces.session.menu.item',
                    id: 'dsh-polish:mode-switch',
                    order: 500,
                  },
                  makeModeSwitchMenu(child),
                )
              })
            })
          },
          'dsh-polish: mode switch menu',
        )
        child.effect(
          function () {
            return startModeSwitchResultPoll(child.remote.settings)
          },
          'dsh-polish: mode switch result poll',
        )
      })

      // ---- literal `$skill` picker. Typing either currency glyph never mutates
      // the draft; choosing a listed item (Tab / Enter / click) immediately
      // expands the token into the literal markdown reference [name](path).
      // configForms joins the child for the 0.4.62 diag sink (the Tab-select
      // forensics record into the keep-effort row's diagnostics).
      ctx.inject(['remote', 'remote.settings', 'configForms'], function (child) {
        child.effect(
          function () {
            return startSkillCatalogPoll(child.remote.settings)
          },
          'dsh-polish: skill catalog poll',
        )
        child.effect(
          function () {
            return child.slots.inject('conversation.input.overlay', function () {
              return child.slots.register(
                { name: 'conversation.input.overlay', id: 'dsh-polish:skill-mention-picker', order: 10 },
                makeSkillMentionPicker(child),
              )
            })
          },
          'dsh-polish: skill mention picker',
        )
      })

      // ---- component D: LRU ordering of the workspace groups. It needs the
      // workspaces/sessions stores and remote.workspace, so it sits behind its
      // own injection; a deployment without them simply leaves the list in
      // DSH's default order.
      ctx.inject(
        ['workspaces', 'sessions'],
        function (child) {
          child.effect(
            function () {
              lruEngine = createWorkspaceLru(child.workspaces, child.sessions)
              syncLru()
              lruEngine.start()
              return function () {
                lruEngine.stop()
                lruEngine = null
              }
            },
            'dsh-polish: workspace LRU order',
          )
        },
      )

      // ---- per-row configuration pages on the Plugins page.
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_RENDERER }, RendererPage)
          })
        },
        'dsh-polish: thinking renderer config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_DEPTH }, DepthPage)
          })
        },
        'dsh-polish: thinking depth config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_HISTORY }, HistoryPage)
          })
        },
        'dsh-polish: composer history config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_LRU }, LruPage)
          })
        },
        'dsh-polish: workspace LRU config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_SHELL_LOCAL }, ShellLocalPage)
          })
        },
        'dsh-polish: shell local config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_TIMER }, TimerPage)
          })
        },
        'dsh-polish: timer config page',
      )
      // 计时行首时钟：往会话行的 LEADING 插槽注册时钟。该插槽只在会话空闲
      // （非进行中/待审批/有完成未读）时由 DSH 渲染，所以这里出现的时钟
      // 恰好只覆盖「空闲且有活动计时器」的情形，进行中等状态不受影响。
      // 活动会话集合来自 host 的 volatile 设置 activeTimerSessionIds。
      ctx.effect(
        function () {
          return ctx.slots.inject('sidebar.session.row.leading', function () {
            return ctx.slots.register(
              { name: 'sidebar.session.row.leading', id: 'dsh-polish:timer-icon', order: 100 },
              makeTimerLeadingIcon(timerActiveStore),
            )
          })
        },
        'dsh-polish: timer row clock',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_NOTIFY }, NotifyPage)
          })
        },
        'dsh-polish: notify config page',
      )
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_VISUALIZE }, VisualizePage)
          })
        },
        'dsh-polish: visualize config page',
      )


      // ---- component J: custom system prompts. The row page is the live
      // kill switch (enabled); the real editor lives under Settings →
      // 提示词设置, registered only while the Host serves the namespace.
      ctx.effect(
        function () {
          return ctx.slots.inject('plugins.row.config', function () {
            return ctx.slots.register({ name: 'plugins.row.config', key: ROW_KEY_PROMPTS }, makePromptsRowPage(ctx))
          })
        },
        'dsh-polish: prompts config page',
      )
      ctx.effect(
        function () {
          return ctx.configForms.whileServed([NS_PROMPTS], function () {
            return ctx.slots.inject('settings.section', function () {
              return ctx.slots.register(
                { name: 'settings.section', id: 'prompts', order: 25, label: function () { return '提示词设置' } },
                makePromptsSettingsPage(ctx),
              )
            })
          })
        },
        'dsh-polish: prompts settings section',
      )
    }

    exports.name = 'dsh-polish'
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
