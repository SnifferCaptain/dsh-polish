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

        // ---- 行渲染（1.2.0）：7 列；事件数/上下文用细条量化，状态用圆点 ----
        // 事件数细条 = 相对筛选阈值（满条 + 强调色 = 命中）；上下文细条 = 占窗口比例
        // （>=70% 黄、>=100% 红）。状态列取代原「状态 + 进行中」两列。
        function slimMeter(tone, pct) {
          return React.createElement('div', { className: 'dshp-meter', 'data-tone': tone }, React.createElement('i', { style: { width: Math.max(0, Math.min(100, pct)) + '%' } }))
        }
        var tableHead = React.createElement(
          'tr',
          null,
          [
            ['会话', false, undefined],
            ['事件', true, '主会话 + 子代理合计；细条 = 相对筛选阈值，满条 = 命中'],
            ['上下文', true, '当前上下文 / 模型窗口；细条 = 占用比例'],
            ['默认模型', false, '未指定 compact 模型时用这个'],
            ['状态', false, undefined],
            ['', true, undefined],
          ].map(function (col, i) {
            return React.createElement('th', { key: i, 'data-r': col[1] ? '1' : undefined, title: col[2] }, col[0])
          }),
        )
        var bodyRows = visible.map(function (row) {
          var hot = qualifies(row)
          var inQueue = queue.some(function (q) {
            return q && q.sessionId === row.id
          })
          var isCurrent = !!(currentJob && currentJob.sessionId === row.id)
          var isPending = !!slimPendingIds[row.id]
          var nameTitle = (row.cwd ? row.cwd + ' — ' : '') + (row.title || row.id)
          var buttonLabel = isPending ? '提交中…' : inQueue ? '已入队' : isCurrent || row.running ? '处理中…' : '瘦身'
          var buttonDisabled = row.running || inQueue || isCurrent || isPending
          var ctxPct = typeof row.ctxTokens === 'number' && typeof row.ctxWindow === 'number' && row.ctxWindow > 0 ? (row.ctxTokens / row.ctxWindow) * 100 : null
          var ctxTone = ctxPct === null ? 'idle' : ctxPct >= 100 ? 'err' : ctxPct >= 70 ? 'warn' : 'ok'
          var st = isCurrent
            ? { tone: 'warn', text: '处理中', pulse: true }
            : row.running
              ? { tone: 'warn', text: slimRowStateLabel(row), pulse: true }
              : inQueue
                ? { tone: 'accent', text: '已入队' }
                : isPending
                  ? { tone: 'accent', text: '提交中' }
                  : row.archived
                    ? { tone: 'idle', text: slimRowStateLabel(row) }
                    : row.live
                      ? { tone: 'ok', text: slimRowStateLabel(row) }
                      : { tone: 'idle', text: slimRowStateLabel(row) }
          var sub =
            slimProjectName(row) +
            ' · ' + slimFmtBytes(row.fileBytes) +
            (typeof row.subCount === 'number' && row.subCount > 0 ? ' · 含 ' + row.subCount + ' 个子代理' : '')
          return React.createElement(
            'tr',
            { key: row.id, 'data-hot': hot ? '1' : undefined, 'data-dim': row.archived ? '1' : undefined },
            React.createElement(
              'td',
              { title: nameTitle },
              React.createElement('div', { className: 'dshp-cell-t' }, row.title || '(无标题)'),
              React.createElement('div', { className: 'dshp-cell-sub dshp-cell-t', title: row.cwd || '' }, sub),
            ),
            React.createElement(
              'td',
              { 'data-r': '1', title: '事件数 ' + slimFmtInt(row.events) + (hot ? ' ≥ 阈值 ' + slimFmtInt(minEvents) : ' < 阈值 ' + slimFmtInt(minEvents)) },
              React.createElement('div', { className: 'dshp-num' }, slimFmtInt(row.events)),
              slimMeter(hot ? 'accent' : 'idle', (row.events / minEvents) * 100),
            ),
            React.createElement(
              'td',
              { 'data-r': '1', title: typeof row.ctxTokens === 'number' ? '上下文 ' + row.ctxTokens + ' tokens' + (typeof row.ctxWindow === 'number' ? ' / 窗口 ' + row.ctxWindow : '') : '上下文' },
              ctxPct === null
                ? React.createElement('div', { className: 'dshp-num' }, slimCtxLabel(row))
                : React.createElement(
                    React.Fragment,
                    null,
                    React.createElement(
                      'div',
                      { className: 'dshp-num' },
                      slimFmtShortNum(row.ctxTokens),
                      React.createElement('span', { className: 'dshp-faint' }, ' / ' + slimFmtShortNum(row.ctxWindow)),
                    ),
                    slimMeter(ctxTone, ctxPct),
                  ),
            ),
            // 0.4.79：默认模型列——直接 compact 时继承的模型（与宿主 slimOne 的
            // lastUsed 回退同源：modelSelection.lastUsed）。完整 provider/model/effort 进 tooltip。
            React.createElement(
              'td',
              null,
              row.provider
                ? React.createElement(
                    'div',
                    { className: 'dshp-cell-t', title: row.provider + '/' + (row.model || '?') + (row.effort ? '（effort: ' + row.effort + '）' : '') + ' — 设置里未指定 compact 模型时瘦身用它' },
                    row.model || '?',
                  )
                : '—',
            ),
            React.createElement(
              'td',
              null,
              React.createElement('span', { className: 'dshp-state' }, React.createElement('i', { className: 'dshp-dot', 'data-tone': st.tone, 'data-pulse': st.pulse ? '1' : undefined }), st.text),
            ),
            React.createElement(
              'td',
              { 'data-r': '1' },
              isPending
                ? React.createElement('button', { type: 'button', className: 'dshp-btn-sm', disabled: true }, buttonLabel)
                : buttonDisabled
                ? React.createElement('span', { className: 'dshp-faint', title: buttonLabel }, '—')
                : React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dshp-btn-sm',
                      onClick: function () {
                        requestSlim([row.id], '单个会话')
                      },
                    },
                    '瘦身',
                  ),
            ),
          )
        })

        // ---- 内存条：DSH(rss) + 其余已用 + 空闲 = 总内存（强调色 = DSH）----
        var memoryBar = null
        if (mem && typeof mem.total === 'number' && mem.total > 0) {
          var rssPct = Math.min(100, (mem.rss / mem.total) * 100)
          var otherPct = Math.max(0, Math.min(100 - rssPct, (Math.max(0, mem.used - mem.rss) / mem.total) * 100))
          var freePct = Math.max(0, 100 - rssPct - otherPct)
          memoryBar = React.createElement(
            'div',
            { className: 'dshp-vfield' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-flabel' }, '系统内存'),
              React.createElement('span', { className: 'dshp-spacer' }),
              React.createElement('span', { className: 'dshp-note' }, '总 ' + slimFmtBytes(mem.total) + ' · 已用 ' + slimFmtBytes(mem.used)),
            ),
            React.createElement(
              'div',
              { className: 'dshp-comp', 'data-big': '1' },
              React.createElement('i', { 'data-k': 'mine', style: { flex: rssPct + ' 1 0' } }),
              React.createElement('i', { 'data-k': 'used', style: { flex: otherPct + ' 1 0' } }),
              React.createElement('i', { 'data-k': 'base', style: { flex: freePct + ' 1 0' } }),
            ),
            promptLegend([
              { k: 'mine', text: 'DSH 进程 ' + slimFmtBytes(mem.rss) + '（pid ' + mem.pid + '）' },
              { k: 'used', text: '其余已用 ' + slimFmtBytes(Math.max(0, mem.used - mem.rss)) },
              { k: 'base', text: '空闲 ' + slimFmtBytes(mem.free) },
            ]),
          )
        }

        // ---- 队列渲染 ----
        var queueRows = queue.map(function (job) {
          var elapsed = job.startedAt ? Date.now() - job.startedAt : Date.now() - (job.at || Date.now())
          return React.createElement(
            'div',
            { key: job.key, className: 'dshp-jobrow' },
            React.createElement('i', { className: 'dshp-dot', 'data-tone': 'accent' }),
            React.createElement('span', { className: 'dshp-cell-t' }, job.title),
            React.createElement('span', { className: 'dshp-hint' }, slimPhaseLabel(job.phase)),
            React.createElement('span', { className: 'dshp-num' }, slimElapsed(elapsed)),
          )
        })
        var doneRows = done.slice(0, 20).map(function (job) {
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
          // 0.4.84：完成项一行结果（全文进 tooltip）；失败项原因完整换行显示。
          var shortDetail =
            okJob && job.detail
              ? '归档为 ' + (job.detail.archiveTitle || '?') + ' · 新会话 ' + (job.detail.newSessionId ? String(job.detail.newSessionId).slice(0, 8) : '?')
              : fullDetail
          return React.createElement(
            'div',
            { key: job.key },
            React.createElement(
              'div',
              { className: 'dshp-jobrow' },
              React.createElement('i', { className: 'dshp-dot', 'data-tone': okJob ? 'ok' : 'err' }),
              React.createElement('span', { className: 'dshp-cell-t' }, job.title),
              okJob ? React.createElement('span', { className: 'dshp-hint dshp-cell-t', title: fullDetail }, shortDetail) : null,
            ),
            okJob ? null : React.createElement('div', { className: 'dshp-callout', 'data-tone': 'err', style: { marginBottom: '4px' } }, React.createElement('span', null, shortDetail)),
          )
        })

        var lastAt = state && state.now ? new Date(state.now).toLocaleTimeString() : '—'

        // ---- 设置卡（draft 输入）----
        // 头行：标题 + 保存；两个分组：「筛选」（事件数 / 批量大小）与「压缩模型」
        // （provider / 模型名 / effort，改完即生效，旁边实时显示校验结论）。
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
          var checkTag =
            modelCheck && modelCheck.skipped
              ? React.createElement('span', null, '未设置：各会话用各自的模型')
              : modelCheck && modelCheck.ok !== false
                ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'ok' }, '✓ 模型可用')
                : modelCheck
                  ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'err' }, '✗ 模型不可用')
                  : null
          settingsCard = React.createElement(
            'div',
            { className: 'dshp-card' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-h' }, '瘦身设置'),
              saveNote ? React.createElement('span', { className: 'dshp-note' }, saveNote) : null,
              React.createElement('span', { className: 'dshp-spacer' }),
              React.createElement('button', { type: 'button', className: 'dshp-btn', onClick: saveSettings, disabled: saving }, saving ? '保存中…' : '保存设置'),
            ),
            React.createElement('div', { className: 'dshp-gh', style: { margin: '2px 0 0' } }, '筛选', React.createElement('span', null, '按事件数；子代理折叠进父会话')),
            React.createElement(
              'div',
              { className: 'dshp-grid' },
              field(
                '事件数 ≥',
                React.createElement('input', { type: 'number', min: '1', className: 'dshp-number', style: { width: '100%' }, value: draft.minEvents, onChange: function (e) { setDraft(function (d) { return Object.assign({}, d, { minEvents: e.target.value }) }) } }),
              ),
              field(
                '批量大小',
                React.createElement('input', { type: 'number', min: '1', max: '10', className: 'dshp-number', style: { width: '100%' }, value: draft.batchSize, onChange: function (e) { setDraft(function (d) { return Object.assign({}, d, { batchSize: e.target.value }) }) } }),
              ),
            ),
            React.createElement('div', { className: 'dshp-gh', style: { margin: '8px 0 0' }, title: '改完即生效，与「测试调用」同一条路线' }, '压缩模型', checkTag),
            catalog
              ? (function () {
                  var groups = Array.isArray(catalog.groups) ? catalog.groups : []
                  var providers = [] // [{id, name}]（name = 目录里的显示名）
                  var seenP = {}
                  for (var pg = 0; pg < groups.length; pg++) {
                    var gid = groups[pg] && groups[pg].id
                    if (gid && !seenP[gid]) {
                      seenP[gid] = true
                      providers.push({ id: gid, name: typeof groups[pg].name === 'string' && groups[pg].name ? groups[pg].name : gid })
                    }
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
                      if (mo && mo.id) {
                        modelOpts.push(mo)
                        if (mo.id === selM) curModel = mo
                      }
                    }
                  }
                  // 保存值不在目录里（目录刷新间隙 / 模型下线）：仍保留为可选项，不丢用户已填的值
                  if (!curModel && selM) curModel = { id: selM, reasoning: null }
                  var effortOpts = []
                  if (curModel && curModel.reasoning && Array.isArray(curModel.reasoning.efforts)) effortOpts = curModel.reasoning.efforts.slice()
                  // 同模型：保存的 effort 不在目录里时保留为可选项（不丢已填值）
                  if (selE && effortOpts.every(function (eo) { return !eo || eo.id !== selE })) effortOpts = effortOpts.concat([{ id: selE, name: null }])
                  var selectStyle = { width: '100%' }
                  return React.createElement(
                    'div',
                    { className: 'dshp-grid' },
                    field(
                      'provider',
                      React.createElement(
                        'select',
                        { className: 'dshp-select', style: selectStyle, value: selP, onChange: function (e) { setCompact(e.target.value, '', '') } },
                        React.createElement('option', { value: '' }, '留空 = 继承各会话自身'),
                        providers.map(function (pv) {
                          return React.createElement('option', { key: pv.id, value: pv.id }, pv.name !== pv.id ? pv.name + '（' + pv.id + '）' : pv.id)
                        }),
                      ),
                    ),
                    field(
                      '模型名',
                      React.createElement(
                        'select',
                        { className: 'dshp-select', style: selectStyle, value: selM, onChange: function (e) { setCompact(selP, e.target.value, '') } },
                        React.createElement('option', { value: '' }, '留空 = 继承'),
                        (curGroup || selM ? modelOpts : []).map(function (mo) {
                          return React.createElement('option', { key: mo.id, value: mo.id }, mo.id)
                        }),
                      ),
                    ),
                    field(
                      'effort',
                      React.createElement(
                        'select',
                        { className: 'dshp-select', style: selectStyle, value: selE, onChange: function (e) { setCompact(selP, selM, e.target.value) } },
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
              : React.createElement(
                  'div',
                  { className: 'dshp-vfield' },
                  catalogLoading
                    ? React.createElement('div', { className: 'dshp-hint' }, '模型列表加载中…')
                    : catalogError
                      ? callout('warn', catalogError)
                      : null,
                  React.createElement(
                    'div',
                    { className: 'dshp-grid' },
                    field('provider', React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '留空 = 继承', value: draft.compactProvider, onChange: function (e) { setCompact(e.target.value, draft.compactModel, draft.compactEffort) } })),
                    field('模型名', React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '留空 = 继承', value: draft.compactModel, onChange: function (e) { setCompact(draft.compactProvider, e.target.value, draft.compactEffort) } })),
                    field('effort', React.createElement('input', { type: 'text', className: 'dshp-text-input', placeholder: '如 high / max，留空 = 继承', value: draft.compactEffort, onChange: function (e) { setCompact(draft.compactProvider, draft.compactModel, e.target.value) } })),
                  ),
                ),
            modelCheck && modelCheck.ok === false ? callout('err', '✗ ' + (modelCheck.error || '模型不可用')) : null,
            // 0.4.81：测试调用（真实最小请求；空文本/失败时给出 provider 真实原因）
            React.createElement(
              'div',
              { className: 'dshp-footer' },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm', disabled: !!(modelTest && modelTest.busy), onClick: runModelTest }, modelTest && modelTest.busy ? '测试中…' : '测试调用'),
              modelTest && !modelTest.busy && modelTest.ok
                ? React.createElement('span', { className: 'dshp-note' }, '✓ 测试调用成功：' + (modelTest.text || '（空）') + '（usage: ' + (modelTest.usage || '无') + '）')
                : null,
            ),
            modelTest && !modelTest.busy && !modelTest.ok ? callout('err', '✗ 测试调用失败：' + (modelTest.error || '未知')) : null,
          )
        }

        var queueCount = queue.length + (currentJob ? 1 : 0)
        return React.createElement(
          'div',
          { className: 'dshp-form dshp-wide' },
          React.createElement(
            'div',
            { className: 'dshp-vfield', style: { gap: '2px' } },
            React.createElement('h3', { className: 'dshp-title' }, '会话瘦身'),
            React.createElement('div', { className: 'dshp-hint' }, '把长会话压成 checkpoint 建新会话，旧会话改名归档。'),
          ),
          settingsCard,
          error ? callout('err', error) : null,
          React.createElement(
            'div',
            { className: 'dshp-vfield', style: { gap: '10px' } },
            React.createElement(
              'div',
              { className: 'dshp-toolbar' },
              React.createElement('button', { type: 'button', className: 'dshp-btn-sm', onClick: requestRefresh, disabled: refreshing }, refreshing ? '统计中…' : '刷新统计'),
              React.createElement(
                'label',
                { className: 'dshp-check' },
                React.createElement('input', { type: 'checkbox', checked: showArchived, onChange: function (e) { setShowArchived(e.target.checked) } }),
                '显示已归档',
              ),
              React.createElement('span', { className: 'dshp-spacer' }),
              React.createElement('span', { className: 'dshp-note' }, '上次统计 ' + lastAt),
            ),
            React.createElement(
              'div',
              { className: 'dshp-tblwrap' },
              React.createElement(
                'table',
                // 固定布局：2.5s 轮询不再引起列宽抖动；文本列省略号截断，不再交叠。
                { className: 'dshp-tbl' },
                React.createElement(
                  'colgroup',
                  null,
                  React.createElement('col', null),
                  React.createElement('col', { style: { width: '84px' } }),
                  React.createElement('col', { style: { width: '112px' } }),
                  React.createElement('col', { style: { width: '104px' } }),
                  React.createElement('col', { style: { width: '80px' } }),
                  React.createElement('col', { style: { width: '84px' } }),
                ),
                React.createElement('thead', null, tableHead),
                React.createElement(
                  'tbody',
                  null,
                  bodyRows.length > 0
                    ? bodyRows
                    : React.createElement('tr', null, React.createElement('td', { colSpan: 6, style: { padding: '18px', textAlign: 'center', color: 'var(--dsw-alias-label-tertiary)' } }, '暂无会话数据')),
                ),
              ),
            ),
            React.createElement(
              'div',
              { className: 'dshp-footer' },
              React.createElement('button', { type: 'button', className: 'dshp-btn dshp-btn-primary', disabled: eligibleIds.length === 0, onClick: function () { requestSlim(eligibleIds, '筛选命中') } }, '批量瘦身 · 筛选 ' + eligibleIds.length + ' 个'),
              React.createElement('button', { type: 'button', className: 'dshp-btn', disabled: idleIds.length === 0, onClick: function () { requestSlim(idleIds, '全部非进行中') } }, '批量瘦身 · 全部 ' + idleIds.length + ' 个'),
              React.createElement('button', { type: 'button', className: 'dshp-btn dshp-btn-ghost dshp-btn-danger', disabled: queue.length === 0 && !(state && state.busy), onClick: requestStop }, '停止队列'),
              actionNote ? React.createElement('span', { className: 'dshp-note' }, actionNote) : null,
            ),
          ),
          React.createElement(
            'div',
            { className: 'dshp-card' },
            React.createElement(
              'div',
              { className: 'dshp-section-head' },
              React.createElement('div', { className: 'dshp-h' }, '处理队列'),
              queueCount > 0 ? React.createElement('span', { className: 'dshp-tag', 'data-tone': 'warn' }, queueCount + ' 个任务') : null,
            ),
            currentJob
              ? React.createElement(
                  'div',
                  { key: currentJob.key + ':current', className: 'dshp-job' },
                  React.createElement(
                    'div',
                    { className: 'dshp-jobrow', style: { padding: 0 } },
                    React.createElement('i', { className: 'dshp-dot', 'data-tone': 'warn', 'data-pulse': '1' }),
                    React.createElement('span', { className: 'dshp-cell-t' }, currentJob.title),
                    React.createElement('span', { className: 'dshp-tag', 'data-tone': 'warn' }, slimPhaseLabel(currentJob.phase)),
                    // 0.4.79：分片/合并进度（宿主 job.detail → /state current.detail）
                    currentJob.detail ? React.createElement('span', { className: 'dshp-hint dshp-num' }, currentJob.detail) : null,
                    React.createElement('span', { className: 'dshp-num' }, slimElapsed(Date.now() - (currentJob.startedAt || currentJob.at || Date.now()))),
                  ),
                  React.createElement('div', { className: 'dshp-meter', 'data-tone': 'warn', 'data-busy': '1', style: { marginTop: 0 } }, React.createElement('i', null)),
                )
              : null,
            !currentJob && queue.length === 0
              ? React.createElement('div', { className: 'dshp-hint' }, state && state.busy ? 'worker 唤醒中…' : '队列空闲')
              : null,
            queueRows,
            done.length > 0 ? React.createElement('div', { className: 'dshp-lib-h', style: { margin: '6px 0 0' } }, '已完成', React.createElement('span', null, String(Math.min(done.length, 20)))) : null,
            doneRows,
          ),
          memoryBar,
        )
      }
    }
