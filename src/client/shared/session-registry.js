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
