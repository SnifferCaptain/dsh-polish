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

