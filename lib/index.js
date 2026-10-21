export const name = 'dsh-polish'

// The bundle's OWN (top-level) host half is intentionally empty — it only
// exists because DSH bundle rows are loaded through the normal Cordis
// composition path. Most components (thinking-renderer, thinking-depth,
// composer-history, workspace-lru) are browser-only. Two carry their own
// NON-empty host halves: the timer component (`dsh-polish/timer`,
// timer/index.js) registers the timer tools per-agent; the mode-switch
// component (`dsh-polish:mode-switch`, mode-switch/index.js) switches a live
// session's agent preset (agentPresets.recompose) on a "..." menu request.
export function apply() {}
