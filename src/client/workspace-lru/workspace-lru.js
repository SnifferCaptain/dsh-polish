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
