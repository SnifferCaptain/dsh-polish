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
