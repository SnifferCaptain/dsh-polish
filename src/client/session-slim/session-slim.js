    // ------------------------------------------------------- session slim
    //
    // 组件 M：会话瘦身。设置 → 会话瘦身（settings.section，行开关 served 时
    // 才挂载）。把冗长会话「压缩续命」：
    //   对当前上下文窗口跑一次 /compact 同形压缩 → 创建并验证新 session
    //   （seed/checkpoint、workspace、模型/effort）→ 新 session 改回原名 →
    //   旧会话改名 原名@K（K = 同项目最大 @N + 1）→ 归档（不删除；
    //   0.4.74 连带其全部子代理逐个归档，archiveSession 不级联）。    //
    // 数据面：宿主 4 条 fetch 路由（/api/dshp/session-slim/*），本页 2.5s 轮询
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
    var SLIM_STATE_PATH = '/api/dshp/session-slim/state'
    var SLIM_SLIM_PATH = '/api/dshp/session-slim/slim'
    var SLIM_REFRESH_PATH = '/api/dshp/session-slim/refresh'
    var SLIM_STOP_PATH = '/api/dshp/session-slim/stop'
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
