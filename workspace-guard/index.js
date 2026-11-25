import z from '@deepseek-ai/schemastery'

/**
 * Workspace membership guard (P0-2).
 *
 * The workspace registry is the durable owner of membership. This component
 * never edits session logs and never detaches a session. It only observes the
 * authoritative Session persistence list and re-attaches a persisted session
 * to the workspace owning its canonical cwd when the membership account is
 * missing. A shrink is logged as a diagnostic and followed by reconciliation.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  intervalMs: z.number().default(5000).volatile(),
})

export const inject = ['workspaceRegistry', 'sessionPersistence', 'timer']

export function apply(ctx, config) {
  if (config && config.enabled === false) return

  const intervalMs = Math.max(1000, Math.min(60000, Number(config && config.intervalMs) || 5000))
  let running = false
  let pending = false
  let lastMembership = new Map()
  let lastArchived = []

  function snapshotMembership() {
    const current = new Map()
    let archived = []
    try {
      const workspaces = ctx.workspaceRegistry.list()
      for (const workspace of workspaces) {
        current.set(String(workspace.id), new Set((workspace.sessionIds || []).map(String)))
      }
      archived = Array.from(ctx.workspaceRegistry.archivedSessionIds || [], String)
    } catch (error) {
      ctx.logger.warn(`[dsh-polish:workspace-guard] snapshot failed: ${String(error)}`)
    }
    return { current, archived }
  }

  function reportShrink(next) {
    for (const [workspaceId, previous] of lastMembership) {
      const current = next.current.get(workspaceId)
      if (!current) continue
      const missing = Array.from(previous).filter((id) => !current.has(id))
      if (missing.length > 0) {
        ctx.logger.error(
          `[dsh-polish:workspace-guard] membership shrank for workspace ${workspaceId}; `
            + `missing ${missing.join(', ')}`,
        )
      }
    }
    if (lastArchived.length > 0 && next.archived.length < lastArchived.length) {
      ctx.logger.warn(
        `[dsh-polish:workspace-guard] archivedSessionIds shrank from ${lastArchived.length} to ${next.archived.length}; `
          + 'the registry API has no safe bulk-restore operation',
      )
    }
    lastMembership = next.current
    lastArchived = next.archived
  }

  async function reconcile(reason) {
    if (running) {
      pending = true
      return
    }
    running = true
    try {
      const baseline = snapshotMembership()
      reportShrink(baseline)
      const snapshots = await ctx.sessionPersistence.list()
      const attached = new Set()
      for (const workspace of ctx.workspaceRegistry.list()) {
        for (const id of workspace.sessionIds || []) attached.add(String(id))
      }
      for (const snapshot of snapshots || []) {
        const header = snapshot && snapshot.header
        const id = header && String(header.id || '')
        const cwd = header && typeof header.cwd === 'string' ? header.cwd : ''
        if (!id || !cwd) continue
        let workspace
        try {
          workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
        } catch (error) {
          // Missing/deleted directories remain valid registry candidates; the
          // official registry will account for them when the path returns.
          continue
        }
        if (!workspace) continue
        const members = new Set((workspace.sessionIds || []).map(String))
        if (members.has(id) || attached.has(id)) continue
        await workspace.attachSession(id)
        attached.add(id)
        ctx.logger.warn(
          `[dsh-polish:workspace-guard] re-attached session ${id} to workspace ${workspace.id} (${reason})`,
        )
      }
      const after = snapshotMembership()
      reportShrink(after)
    } catch (error) {
      ctx.logger.warn(`[dsh-polish:workspace-guard] reconciliation failed: ${String(error)}`)
    } finally {
      running = false
      if (pending) {
        pending = false
        void reconcile('coalesced')
      }
    }
  }

  const stopCreated = ctx.on('session/created', (session) => {
    const id = session && session.id ? String(session.id) : ''
    if (id) void reconcile(`session-created:${id}`)
  })
  const stopDomain = ctx.on('domain/changed', (change) => {
    if (change && change.domain === 'workspace') void reconcile('domain-changed')
  })
  const stopInterval = ctx.timer.interval(() => void reconcile('periodic'), intervalMs)
  const stopStartup = ctx.timer.timeout(() => void reconcile('startup'), 250)

  ctx.effect(() => () => {
    stopCreated()
    stopDomain()
    stopInterval()
    stopStartup()
  }, 'dsh-polish:workspace-guard:dispose')
}
