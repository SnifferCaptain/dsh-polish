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
