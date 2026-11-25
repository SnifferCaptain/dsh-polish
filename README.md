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
| `keep-effort` | ✔ | Remembers reasoning effort per session and model | Depends on model-selection projections; persistence failures must not affect the main session | Maintain model-selection compatibility and fail-open behavior |
| `session-slim` | ✔ | Summarizes an old session and creates a visible replacement | Archives the old session only after replacement visibility, model, workspace, and tool checks pass | Maintain session lifecycle and persistence compatibility |
| `compact-model` | ✔ | Compaction follows the selected model, slices and folds past the window, threshold guard, automatic-failure retry — four independent switches | The guard is off by default. When on, it compacts first, prunes as a fallback, and if the context is still over the limit, logs an error and lets the step through; it never rejects a step | Maintain compaction and model-selection compatibility |
| `ptc-log-repair` | — | Self-heals the "PTC dispatch repeats subCallId" corruption when opening a stored session | Repairs data only (renames the reused id of the later execution, atomic write with a timestamped backup); every other corruption is rethrown untouched | Track reader-side validation changes in DSH session format |
| `better-model-config` | ✔ | In-row extension of the official Models page: per-model protocol (moves the model to a sibling route), fill-empty-field defaults, a reversible thinking switch, bidirectional /v1 auto-fix | One entry point (the official editor); writes the official `llm-pi-ai` config; queues while the editor is open, applies on close; prices display-only | Follow the official Models page DOM anchors (hashed class substrings) and the pi-ai config schema |
| `workspace-guard` | ✔ | Watches the authoritative session list and re-attaches a persisted session that dropped out of its workspace's membership table, using its canonical cwd | Attach only: it never edits session logs and never detaches a session. It is **compensation, not interception** — the write that overwrites the table lives in core, so a plugin cannot veto it and can only reconcile afterwards | Track changes to the DSH workspace registry and session-persistence interfaces |

## Features

### Prompt management

`prompts` provides two kinds of prompt configuration:

- **System prompts:** every Agent preset has its own read-only built-in template for `standard`, `ptc`, `cordis`, and `minimal`; user-created templates are listed separately. Template bodies support the variables `{{model}}` (current model name) and `{{provider}}`, substituted live at each model-call assembly (same source as DSH's built-in variables of the same name); any other `{{...}}` is kept as-is and never resolved. The component does the substitution itself and keeps its section non-interpolating, so a typo'd variable name can never make the assembly throw or break API availability.
- **Tool prompts:** only tool description text is changed. Tool parameters, names, and execution behavior are left untouched.

Built-in templates come directly from DSH preset definitions and do not require model probing. System prompts support append and full replacement. Because `minimal` has a complete default persona, full replacement intentionally takes over that persona.

The Tool Prompts page reads the global registry and each declared Agent preset scope through a read-only Host route. Opening the Tool Prompts tab performs one read; afterward the catalog changes only when you explicitly refresh it. It never discovers tools from live session model assembly, and background sessions cannot change the list while you edit. Refresh is refused while unsaved tool-prompt edits exist. The catalog is a stable union of declared global/preset tools; live session-only restrictions are intentionally not part of this editable catalog.

#### Context embedding (1.4.17)

Besides system/tool prompts, DSH injects several kinds of context the model sees on every request: the `Current runtime context.` snapshot (working directory, sandbox policy, approval policy, harness checkout, Web GUI URL), the skill catalog message, the time-context message, the model-switch notice, and the trailing compaction directive. The Contexts tab gives each kind its own row, and every row is adjustable:

- **Runtime snapshot sections** — `working-directory:current`, `sandbox:policy`, `approval:policy`, `harness:source`, `app:web-surface` each support `keep` (unchanged), `off` (section removed from the snapshot), and, for the static ones, `custom` (your own text). Custom templates support the variables `{{cwd}}` (live working-directory projection), `{{checkout}}` and `{{webUrl}}` (captured once at plugin load from DSH's own rendered text), plus `{{model}}`/`{{provider}}`; any other `{{...}}` is kept as-is (fail-open). `sandbox:policy`/`approval:policy` are live session state, so v1 offers only keep/off — a static custom text would go stale.
- **Skill prompt / time prompt / model-switch notice** — each supports `keep`, `off` (the message is dropped before commit), or `custom` (the message text is rewritten in place; the message id and the catalog source are preserved, so DSH's own digest logic still sees a stable catalog and the log does not accumulate copies). Catalog templates get `{{entries}}`, `{{count}}`, `{{note}}`; time templates get `{{turn}}`, `{{step}}`, `{{timestamp}}`.
- **Compaction prompt (new in 1.4.17)** — the directive is not a system-prompt section but the final user message of a transient compaction request, so the component rewrites it in `llm/stream` (`purpose='compaction'`; the chunked preprocessing pass `compaction-chunk` keeps the core wording, because each slice must be summarized against its own slice). `keep` = the core text; `custom` = your template replaces it, with `{{model}}`, `{{provider}}`, `{{turns}}` (replayed message count). The replayed history is untouched; “use latest” copies the last real directive into the editor.
- **Master switch** — turning the runtime snapshot off suppresses all optional contexts through DSH's official `suppressRuntimeContext()` extension point; only the required working-directory section is emptied explicitly.
- **Isolation** — every default is keep/on, which means **zero rewriting**: no shadow context, no pre-step listener that rewrites a request, no suppression. The only always-on listener is the read-only `session/event` observer that feeds each row's "latest injected value" (it does not change request bytes). Turning the row off (or disabling the plugin) restores the exact original behavior. Config changes take effect at the next model step; already-committed messages are never rewritten (logs are append-only).
- **Fixed strings** — the snapshot wrapper sentence and the "no longer apply" cleared sentence are hardcoded in DSH core with no hook between them and the commit, so the limit of a full-off configuration is one cleared sentence followed by silence.

#### Recent injected values (1.4.7)

Each row shows the latest text that was actually injected for its kind (count / form / last time / latest text), so a custom template can be prefilled from reality. Runtime section rows distinguish the latest persisted snapshot (including its `source.sections`) from the pre-commit assembly result; the persisted message is authoritative when available.

- **Capture limits** — session/event messages are not replayed from old logs; counts begin when the observer starts. Zero means “not observed in this volatile snapshot,” not proof that DSH never injected the category.
- The observers do not rewrite their observed messages or change the stream/request bytes.

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

### Compaction

`compact-model` exposes four **independent** switches on the row's configuration page, plus two numeric retry fields.

- **Compact with the selected model** (`followSelection`, on by default) reroutes compaction calls only; normal replies are untouched.
- **Slice and fold when the summary would overflow** (`chunkedCompaction`, off by default): the official summarizer replays the whole compacted region in one call, so a context already past the target model's declared window can never be compacted (the summary request itself overflows). When on, the hook slices that replay at tool-pair-safe boundaries and folds each partial checkpoint into the next; a call the provider answered with `stop` + full text but pi-ai classified as silent overflow (reported usage above the declared window) is accepted instead of discarded, while a text-less overflow still fails.
- The two do not depend on each other: turning slicing off restores the official single replay while rerouting keeps working; both off is a pure pass-through (identical to not installing the component). 1.0.16 fixes the synthetic assistant message that folded a checkpoint forward: it had no `source`, which crashed the second slice with `Cannot read properties of undefined (reading 'replayState')`.
- The **threshold guard** (`pressureGuardEnabled`, off by default) uses the official compaction default threshold (0.8), compacts first, prunes as a fallback, and permits two forced attempts per turn. If pressure is still high it only logs an error and lets the step through. Since 1.4.35 there is no reject path at all: a reject swallows the already-claimed user message and raises no error, so the session just looks dead. Turn it on in the compaction row when you want it.
- The compact-model row switch is the master switch for the whole component.

### Better Model Config

`better-model-config` (1.4.22) **extends the official Models page in place, with no second entry point**: until a model row's "模型选项" (Model options) panel is expanded, the page is **pixel-identical to stock** — the provider card holds only a `display:none` route anchor (no space, invisible, not interactive). Expanding a model row adds one line inside that official panel (per-model protocol, fill defaults, a /v1 fix that appears only when the address is actually wrong, and one price chip), laid out with the official 12px label + 32px control. It still writes the official `llm-pi-ai` config (`providers.<route>.*`) with the same path-ops + revision check the official editor uses, and registers no route, adapter, or settings page.

- **Per-model protocol (1.4.22)**: pi-ai's `api` is a **route-level** field, so "this model speaks anthropic-messages" can only be expressed by moving the model onto a sibling route of the same gateway (`<route>-<suffix>`, same `apiKeyEnv`/`headers`), with the address gaining or losing `/v1` at the protocol boundary; picking the base route's protocol moves it back. The official provider editor keeps the route-level 协议; this is the per-model one.
- **Thinking switch (since 1.4.29)**: the switch in the expanded model panel decides whether the model can be toggled between thinking on and off. It does not turn thinking on or off by itself. Off writes `reasoningEfforts: false` (the previous level table is backed up and restored when switched on again; a model that never declared one goes back to inheriting the catalog). On declares an off level plus one level. With two or more non-off levels the table is the finer switch and the coarse one only shows state. Thinking depth stays with the official 推理等级 rows.
- **Reference table fills, it does not decorate**: `better-model-config/model-defaults.jsonc` records capabilities and prices for common models. The key is the model id or name; lookups ignore case and `-`/`.`/spaces (`qwen-3.8-27b` ≡ `Qwen3-8-27B`). "Fill defaults" initializes only the fields the model still has EMPTY (name / context / max output / input types / thinking levels; stored values are never overridden) and says which fields it filled — or that nothing was left to fill. Price is the one fact with no field to write to, so it is the only table value on screen, as one `¥x / ¥y` chip.
- **/v1 auto-fix (bidirectional)**: an Anthropic route must not end in `/v1` (the SDK appends it itself); an OpenAI route must end in `/v1` (or another `/vN`). Both the hint and its one-click fix live inside the expanded model panel, and the button is hidden while the address is correct — so nothing appears until you expand a model.
- **When writes happen (clobber-proof)**: while the official editor is open it holds a draft of the route and commits only on Save, so a direct write now would be clobbered by the next official save. Every action is therefore **queued** while the editor is open (the strip shows "queued") and applied atomically against the freshest snapshot the moment the editor closes; actions taken while it is closed apply immediately.
- **Reference table maintenance**: `model-defaults.jsonc` is JSONC (comments allowed). Its capability data comes from the pi-ai built-in catalog and its prices from the token-usage price table. Parsing is forward-compatible: unknown columns are ignored, new rows work without code changes, and a key claimed by two different entries is dropped as ambiguous. The table can be maintained in this repository.
- **DOM contract (fragile point)**: the extension strip is injected into the official model rows, anchored on the official hashed CSS-class substrings (`li[class*="_rowCard"]`, `div[class*="_modelEntry"]`), the row's first `<input>` (the model id), and this component's own `data-dshp-bmc-route` stamp. These anchors are pinned to the DSH 0.2.1-rc.5 build; **after a DSH upgrade, if the official Models page structure changes, the strip simply disappears (no error, no wrong write)** — re-check the anchors above.
- The row switch hides every extension live; when off, the page is byte-for-byte stock.

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
dsh plugin --profile web add https://github.com/SnifferCaptain/dsh-polish/releases/download/v1.5.0/dsh-polish-1.5.0.tgz
```

After installation:

- an update can be installed over the existing bundle;
- `application: applied` is the successful Host installation result;
- Host changes normally require a DSH restart;
- pure Client changes take effect after a page refresh; HMR should only be expected when the web watcher is confirmed to be running.

### npm

For npm installations, this command selects the latest version published there. It may lag behind the GitHub Release:

```powershell
dsh plugin --profile web add dsh-polish@latest
```

### Build and pack locally

From a source checkout:

```powershell
npm run build:client
npm run check:client
npm run pack:release
```

`build:client` regenerates the UI string dictionary (`src/client/shared/i18n.js`) from `locale/*.jsonc` first, then the Host/Client entries. Do not edit the generated dictionary by hand.

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
locale/                UI string dictionaries (zh/en, JSONC source + generated JS)
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

Do not edit generated `lib/client.js`, `lib/client.mermaid.js`, or `src/client/shared/i18n.js` by hand.

### UI localization

User-visible Client copy lives in `locale/zh.jsonc` and `locale/en.jsonc` (language = file name, JSONC allows comments). The build turns them into `src/client/shared/i18n.js`, a plain JS dictionary with a `t(key, {…})` helper; the Client falls back to the key's zh value, then to the key itself. Strings are translated at render time, so switching the DSH UI language updates open settings pages without a remount. Prompt template names and bodies are data, not UI copy, and stay in their original language.

### Tests

Tests live in the maintainer's local `test/` directory and are not committed to this public repository or included in the package. Run the full local suite from a maintainer checkout with:

```powershell
npm test
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

Current package version: **v1.5.0**. Release history is recorded by Git tags.

## Known boundaries

- `timer` is stopped and disabled by default; use DSH's official automation tasks for scheduled work.
- `shell-local` depends on deployment permissions and sandbox policy; its historical compatibility patch is not entirely owned by this component.
- Whether `notify` reaches the desktop depends on browser/OS notification permission; sound notifications do not require that permission.
- `visualize` depends on the vendored Mermaid version; run the full build and regression checks after upgrading it.
- Host plugin upgrades are affected by Node.js ESM caching; a full DSH restart may be required instead of only refreshing the page.

## License

MIT License. See the `license` field in [package.json](package.json).
