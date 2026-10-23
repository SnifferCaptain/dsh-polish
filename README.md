# dsh-polish

A collection of independently switchable enhancements for DeepSeek Harness (DSH). The project ships as a Cordis bundle and does not modify DSH core code. Each feature can be enabled or disabled independently through the plugin manager.

[中文说明](README_zh.md)

## Components

> `✔` available; `❌` known unavailable; `⚠` conditional, risky, or pending verification; `—` stopped or disabled by default.

| Component | Status | Purpose | Known boundary | Maintenance policy |
| --- | :---: | --- | --- | --- |
| `thinking-renderer` | ✔ | Shows thinking-stream state, elapsed time, and follow-latest behavior | Depends on DSH thinking-row DOM/data attributes | Track DSH DOM contract changes |
| `thinking-depth` | ✔ | Replaces the built-in reasoning-level list with a slider | Only appears for models that declare `reasoning`; depends on the built-in menu structure | Keep the patch low-intrusion |
| `composer-history` | ✔ | Recalls the previous user messages from the composer | Depends on the composer slot | Fix compatibility issues only |
| `workspace-lru` | ✔ | Reorders workspaces by recent use | Requires the workspace service and local state | Reduce page-structure dependencies |
| `timer` | — | Timer-related capabilities | DSH's official automation tasks cover this use case; this component is disabled by default | Stopped; no new compatibility work |
| `notify` | ✔ | Plays a sound or sends a notification when work needs attention | Desktop notifications depend on browser/OS permission; sound does not | Best-effort behavior |
| `mode-switch` | ✔ | Switches a session between `standard`, `ptc`, `cordis`, and `minimal` | Switching a cold session requires resuming its Agent first | Maintain preset-switch compatibility |
| `skill-loader` | ✔ | Loads `SKILL.md` files from the personal skills directory | May overlap with the official skill filesystem | Deduplicate at the root |
| `prompts` | ✔ | Manages system and tool prompts per mode | `minimal` has a complete persona; custom `replace` intentionally takes it over | Track DSH preset compatibility |
| `shell-local` | ✔ | Provides local shell capabilities | Availability depends on deployment permissions and sandbox policy | Fix explicit safety boundaries only |
| `visualize` | ✔ | Renders Mermaid and SVG diagrams | SVG is sanitized; Mermaid is vendored in the package | Upgrade the vendored Mermaid version with regression tests |
| `keep-effort` | ✔ | Remembers model reasoning effort per session and model | Depends on model-selection projections; persistence failures must not affect the main session | Maintain model-selection compatibility and fail-open behavior |
| `session-slim` | ✔ | Summarizes an old session and creates a visible replacement | Archives the old session only after replacement visibility, model, workspace, and tool checks pass | Maintain session lifecycle and persistence compatibility |

## Features

### Prompt management

`prompts` provides two kinds of prompt configuration:

- **System prompts:** every Agent preset has its own read-only built-in template for `standard`, `ptc`, `cordis`, and `minimal`; user-created templates are listed separately.
- **Tool prompts:** only tool description text is changed. Tool parameters, names, and execution behavior are left untouched.

Built-in templates come directly from DSH preset definitions and do not require model probing. System prompts support append and full replacement. Because `minimal` has a complete default persona, full replacement intentionally takes over that persona.

The Tool Prompts page reads the global `ctx.tools.schemas()` registry and keeps a stable snapshot. It never discovers tools from session model assembly, and background sessions cannot change the list while you edit. The snapshot is refreshed at plugin startup and only after an explicit refresh; a refresh is refused while unsaved tool-prompt edits exist.

### Session slimming

`session-slim` compresses a long session into a checkpoint and creates a new visible session:

1. Read the sidebar-visible session corpus and complete lineage;
2. Generate a summary with the configured compact model;
3. Create a replacement session and write the summary;
4. Inherit the original workspace, model, effort, and Agent preset;
5. Create the checkpoint with a protected `system/message` surface head so v4 log validation survives a restart;
6. Confirm that the replacement appears in the normal session list and has the original mode's tools;
7. If the old session is the current main session, let the replacement take over the main view before archiving;
8. Archive the old session and related child sessions only after every check succeeds.

If the compact provider reports a balance, credential, or rate-limit failure, the component retries with the session's last-used model route. Creation, attachment, and visibility failures keep the old session; the component never silently deletes the original data. Since 0.4.98, the replacement seed starts with a protected empty `system/message` head. Since 0.4.99, the replacement takes over the main view before the old session is archived. Since 0.4.100, ArrowUp recall remains index-driven while the editor applies an asynchronous draft update. Since 1.0.0, the Client performs one delayed, read-only session-catalog refresh after startup to cover Host persistence restoring after the initial Client list request.

### Visualization

`visualize` recognizes Mermaid and SVG fenced code in chat messages and renders it in place:

- Mermaid uses the vendored **11.17.0** runtime and does not depend on a CDN;
- upstream project: [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid);
- vendored source: [vendor/mermaid-11.17.0.min.js](vendor/mermaid-11.17.0.min.js);
- SVG is sanitized before display;
- if rendering fails, the original code block remains visible and the message UI is preserved.

### Other components

The current state of thinking display, reasoning level, message recall, workspace LRU, preset switching, skill loading, notifications, local shell, and effort persistence is summarized in the table above. Every component follows the same rule: it can be disabled independently and should restore DSH's native behavior as far as possible when disabled.

## Installation

### GitHub Release tarball

The Git repository intentionally does not track `lib/`, `test/`, or other generated/development files. The GitHub Release tarball is therefore the recommended GitHub installation source:

```powershell
dsh plugin --profile web add https://github.com/SnifferCaptain/dsh-polish/releases/download/v1.0.2/dsh-polish-1.0.2.tgz
```

After installation:

- an update can be installed over the existing bundle;
- `application: applied` is the successful Host installation result;
- Host changes normally require a DSH restart;
- pure Client changes take effect after a page refresh; HMR should only be expected when the web watcher is confirmed to be running.

### npm

The package is also designed for npm publication:

```powershell
dsh plugin --profile web add dsh-polish@1.0.2
```

### Build and pack locally

From a source checkout:

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

The command generates `release/dsh-polish-<version>.tgz`.

### Package boundary

The npm package uses the `files` allowlist in `package.json`; it does not publish the whole source repository. The package keeps only runtime material: Host/Client build output, Host component entry points, `cordis.patch.yml`, published skills, and the two README files.

The following remain outside the npm tarball and/or Git repository:

- `test/`: local regression tests; not committed to this public repository;
- `src/`: Client source, maintained in the source checkout;
- `scripts/`: build scripts, maintained in the source checkout;
- `lib/`: generated before packing and included in the npm/Release tarball, but not committed to Git;
- `build/`, `dist/`, `coverage/`, `tools/`, and `release/`: build, test, or local release output;
- `vendor/`: source-time Mermaid input; the runtime uses the generated `lib/client.mermaid.js`;
- `.agents/`, caches, temporary files, logs, and `todo.md`.

## Compatibility

The package declares:

- DSH: `>=0.2.0-rc.1 <0.3.0`;
- Node.js: use the Node.js/pnpm environment supplied by DSH for local builds;
- `@deepseek-ai/dsh-client-ui-chat`, `@deepseek-ai/dsh-home-paths`, `@deepseek-ai/dsh-llm`, and `@deepseek-ai/dsh-tools` as optional peer dependencies supplied by the DSH runtime.

## Development

### Repository layout

```text
cordis.patch.yml       Cordis bundle entry and component registrations
src/client/            Client source
<component>/           Host entry point and package.json for each component
scripts/               Client build scripts
vendor/                Vendored third-party runtime input
skills/                Model skills shipped with the bundle
README.md              English project documentation
README_zh.md           Chinese project documentation
```

Generated `lib/` output is intentionally ignored by Git. It must exist locally before packing.

### Change Client code

Client source lives under `src/client/`. After changing it, regenerate the build output because the regression checks and release package consume the generated bundle:

```powershell
npm run build:client
npm run check:client
```

Do not edit generated `lib/client.js` or `lib/client.mermaid.js` by hand.

### Tests

Tests are kept in the private/local development checkout rather than this public Git repository. The local test baseline is:

```text
720 checks
```

When the local `test/` directory is available, run:

```powershell
node test/harness.cjs
```

The tests cover entry points, configuration contracts, generated Client output, core behavior, and selected Client DOM behavior. Real model calls, browser permissions, and desktop notifications still require verification in a target DSH environment.

## Release checklist

Before publishing a Release tarball or npm version:

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

The maintainer should also:

- verify that `lib/client.js` matches the Client source build;
- verify that Host and Client entry points load;
- verify that session-slim does not archive the old session before the replacement is ready;
- verify that prompt presets do not leak into each other;
- verify that the Mermaid chunk and main Client bundle are both in the tarball;
- scan the final package for personal paths, credentials, and development-only files;
- install the tarball in a clean DSH profile and verify `application: applied` plus actual page behavior.

Current functional baseline: **v1.0.2**. Release history is recorded by Git tags.

## Known boundaries

- `timer` is stopped and disabled by default; use DSH's official automation tasks for scheduled work.
- `shell-local` depends on deployment permissions and sandbox policy; its historical compatibility patch is not entirely owned by this component.
- Whether `notify` reaches the desktop depends on browser/OS notification permission; sound notifications do not require that permission.
- `visualize` depends on the vendored Mermaid version; run the full build and regression checks after upgrading it.
- Host plugin upgrades are affected by Node.js ESM caching; a full DSH restart may be required instead of only refreshing the page.

## License

MIT License. See the `license` field in [package.json](package.json).
