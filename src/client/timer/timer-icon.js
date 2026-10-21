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
