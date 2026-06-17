# Decision Log

Non-obvious architectural and implementation decisions, newest-relevant grouped by
area. Each entry: **Context → Decision → Rationale → Consequences.** Point-in-time
design specs live in [`superpowers/specs/`](superpowers/); this log captures the
*why* that outlives any single spec.

---

### [2026-06-13] Electron + TypeScript, three sandboxed layers

**Context:** A desktop app needing real OS shells, native file access, and a rich
editor, on Windows.
**Decision:** Electron with a strict three-layer split (main / preload / renderer),
`contextIsolation: true`, `nodeIntegration: false`, and a single typed IPC contract
in `src/shared/`.
**Rationale:** Electron gives ConPTY + Node + Chromium in one runtime. Isolating
all privilege in main and exposing only a typed `window.api` keeps the renderer
unprivileged and the surface auditable.
**Consequences:** Every capability is three coordinated edits (contract → main →
renderer). The discipline pays off in compile-time safety and a small, reviewable
trust boundary.

### [2026-06-13] Discriminated-union pane configs

**Context:** Workspaces mix terminals, editors, and explorers in one mosaic layout.
**Decision:** `PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig`, keyed
by a `kind` discriminant; the layout tree references panes by id.
**Rationale:** One serialization format for heterogeneous panes; exhaustive
switches in the renderer; trivial to add a pane kind.
**Consequences:** Schema is versioned (`SCHEMA_VERSION`); pane-kind additions are
a migration concern.

### [2026-06-13] Pure core + thin impure shell; vitest vs Playwright split

**Context:** Most logic (parsing, classification, layout math) is testable without
Electron; some is irreducibly I/O.
**Decision:** Keep pure logic in `src/shared/` and in small pure modules beside each
service (`proc-tree.ts`, `parse-usage.ts`, `classify-ai.ts`, …); unit-test those
with vitest. Verify everything Electron-shaped by launching the real app under
Playwright for Electron.
**Rationale:** Fast deterministic unit tests where possible; real-window confidence
where it counts. Playwright doubles as a per-build self-feedback loop.
**Consequences:** e2e is pinned to `workers: 1` — concurrent Electron windows each
running busy-gated process polls starve each other into flakiness. Serial models
the single-instance product.

### [2026-06-14] OSC 133 shell integration for status, not output heuristics

**Context:** Knowing busy/idle/needs-input reliably across PowerShell, cmd, and bash.
**Decision:** Inject per-shell init scripts (written to `userData/shell-integration/`)
that emit **OSC 133** markers (A/C/D) and cwd sequences (OSC 9;9 / OSC 7); parse them
out of the PTY stream. cmd falls back to heuristics where it can't be instrumented.
**Rationale:** Markers are precise; scraping prompts is not. The same injected stream
also carries cwd, so one mechanism powers multiple features.
**Consequences:** A heuristic idle fallback covers no-integration / nested shells.
The shared stream created cross-cutting hazards (below).

### [2026-06-14] One shared awareness pipeline, busy-gated

**Context:** Status, child-process, AI-session, and cwd features could each poll.
**Decision:** Drive them all from the single `node-pty` onData stream and the
StatusEngine's busy/idle signal. `ProcessTracker` polls `Get-CimInstance` only while
a terminal is busy; `AiSessionTracker` consumes that process info.
**Rationale:** Idle terminals cost nothing; no redundant pollers; features compose.
**Consequences:** Layout changes that repaint the terminal can corrupt shared state —
hence the two hazards below.

### [2026-06-14] ANSI-strip the status tail; skip trailing blank lines

**Context:** Adding the cloud status bar wedged terminals in "busy" (needs-input
broke). Root-caused via bisect + instrumentation.
**Decision:** Store the needs-input detection tail as `stripAnsi(text)` (last ~400
chars) and have `needs-input.ts` skip trailing blank lines.
**Rationale:** Any terminal **layout change** triggers a full-screen ConPTY repaint
whose trailing erase-line bytes otherwise evict the prompt from the raw tail.
**Consequences:** Touching terminal layout is safe now; the guard must be preserved.
`TerminalPane` also suppresses no-op resizes to avoid the repaint entirely.

### [2026-06-14] Long-lived child processes must be abortable + unref'd

**Context:** The full e2e suite hung 2 min on `app.close()`.
**Decision:** Cloud probe children use an `AbortController` (abort on `stop()`, wired
to `win.on('closed')`) and `child.unref()`.
**Rationale:** An in-flight `execFile`/spawn child keeps the Electron main process
alive and blocks shutdown.
**Consequences:** A reusable pattern for any future long-lived child.

### [2026-06-14] Sticky AI-session detection

**Context:** Claude Code spends long stretches quietly awaiting input; naive
"is the process busy" detection flickers the chip off.
**Decision:** Mark the session from busy-time process info and **clear only on
command-done or pane close**, not on quiet.
**Rationale:** The session is still live while waiting; the UI should reflect that.
**Consequences:** Needed a new `onCommandDone` callback on the StatusEngine (OSC 133
`D` + pty exit) to drive the clear.

### [2026-06-14] No secrets persisted

**Context:** SSH connections and cloud status touch credentials.
**Decision:** Store SSH host/user/port + identity-file *path* only; SSH passwords
prompt in the terminal as usual. Store nothing for cloud status. The usage feature
reads transcripts read-only, token fields only.
**Rationale:** A workspace file should never be a credential leak.
**Consequences:** `quick.json` is sanitized on read and write.

### [2026-06-15] Claude usage: parse the cwd-mapped transcript

**Context:** Surfacing live token/context usage for a Claude session in a terminal.
**Decision:** Map the terminal's cwd → Claude's encoded project dir → watch that
**directory** and re-resolve the newest `.jsonl` on every change; parse usage from
assistant lines. Window comes from the settings **model alias** (`opus[1m]`), not
the transcript (which records only the canonical id), plus an auto-bump to 1M when
observed context exceeds 200k.
**Rationale:** The transcript is the source of truth for tokens but omits the `[1m]`
flag; a single-file watch binds to stale/empty session stubs. (See
[superpowers/usage-metrics-review-followups.md](superpowers/usage-metrics-review-followups.md).)
**Consequences:** Whole-file re-read per change (acceptable for v1; incremental is a
noted optimization). Codex deferred until its on-disk format is known.

### [2026-06-15] Keep inactive workspaces mounted on tab switch

**Context:** Switching workspace tabs blanked every pane — lost terminal scrollback
and unsaved editor text, froze live TUIs.
**Decision:** Render all workspaces; show only the active one via
`visibility: hidden` (never `display: none`). Inactive hosts stay full-size but
non-interactive.
**Rationale:** Unmounting disposed xterm instances and Monaco models. `display: none`
would zero each host's size and thrash xterm's FitAddon + the PTY grid.
**Consequences:** All workspaces' terminals spawn at launch (eager, not lazy). See
[superpowers/workspace-lifecycle-review-followups.md](superpowers/workspace-lifecycle-review-followups.md).

### [2026-06-15] Editor hot-exit via a separate drafts store + lifecycle invariant

**Context:** Unsaved editor buffers were lost on restart — `EditorConfig` persists
only file paths and `EditorPane` reloads from disk.
**Decision:** Persist each dirty buffer's `{ content, baseline }` in a separate
`editor-drafts.json` (main-process `DraftStore`) keyed by `paneId::path`, not inline
in the workspace JSON. Restore on open via the pure `resolveDraftOnOpen`, reusing the
existing "Changed on disk" reload bar for the conflict case. Delete a draft on save /
tab-close / **pane-close** (the editor-create effect's cleanup); session drafts
**survive app close** because Electron destroys the renderer without running React
cleanups.
**Rationale:** Inline storage would bloat the 500 ms-autosaved workspace files with
buffer content. The pane-close-deletes / app-close-survives split is the crux: the
same cleanup must prune orphans yet not wipe drafts we want restored — which works
only because React cleanups don't run on hard window destroy. Keeping workspaces
mounted (above) means tab switches never trigger that cleanup either.
**Consequences:** Whole-map writes (fine for few small buffers); no cursor/scroll or
untitled-buffer persistence; orphan drafts for deleted workspaces are not pruned. See
[superpowers/specs/2026-06-15-termhalla-editor-hot-exit-design.md](superpowers/specs/2026-06-15-termhalla-editor-hot-exit-design.md).

### [2026-06-15] Untitled scratch buffer reuses the drafts store; angle-bracket sentinel

**Context:** Users type into an editor pane with no file open (Monaco's auto untitled
model); that text was untracked, unsaveable, and lost on restart — which is what the
hot-exit feature appeared to "not fix" in real use.
**Decision:** Model the untitled buffer as a `Tab` keyed by a reserved sentinel
`UNTITLED` with `saved = ''`, so the existing hot-exit `persistDraft`/flush/cleanup
machinery persists and restores it (under `paneId::<untitled>`) with no new store, IPC,
or types. Save-As adds one IPC (`dialog:saveFile`). The sentinel is `'<untitled>'` —
angle brackets are invalid in Windows paths and the app only opens absolute paths, so it
can never collide with a file tab's key.
**Rationale:** `saved=''` makes "any non-empty content" automatically dirty/persisted via
the unchanged draft logic — minimal, low-risk reuse. The sentinel was originally proposed
as NUL-prefixed (`untitled`, invalid on all platforms); the angle-bracket form was
chosen as a clean-ASCII equivalent that avoids a raw NUL byte in source. (Trade-off: `<`/`>`
are valid in POSIX paths, so on a future non-Windows port a file literally named
`<untitled>` could theoretically collide — acceptable for this Windows-first app.)
**Consequences:** One scratch buffer per pane; plaintext only; no cursor/scroll persistence.
Drafts survive app close, are deleted on genuine pane removal — same invariant as hot-exit.
See [superpowers/specs/2026-06-15-termhalla-editor-scratch-buffer-design.md](superpowers/specs/2026-06-15-termhalla-editor-scratch-buffer-design.md).

### [2026-06-15] Session-identity race pattern for watchers

**Context:** Watchers that `await` between claiming a map slot and using it can leak
or emit stale data under rapid watch→unwatch→watch.
**Decision:** Claim the slot with a fresh `sess` object *before* awaiting, then
re-check `map.get(id) !== sess` after every await; thread `sess` through helpers.
**Rationale:** A concurrent call replaces the slot; the stale continuation must
detect it and bail.
**Consequences:** The canonical shape for `UsageTracker`, `WatchManager`, and any
future watcher.

### [2026-06-16] Shared `<Modal>` + central `Z` stacking scale

**Context:** Every dialog re-implemented its own `createPortal` + full-viewport backdrop
+ stop-propagation card, and z-indexes were ad-hoc literals (40/50/60/1000/1100) with two
different backdrop colors — so layering was accidental and any overlay tweak was shotgun
surgery across six files (flagged Major in the quality review).
**Decision:** All modal dialogs render through `src/renderer/components/Modal.tsx`
(`<Modal>` owns the portal, backdrop, stop-propagation, and `align: 'center' | 'top'`),
and every overlay z-index comes from the exported `Z` scale
(`popover < menu < dialog < palette < paletteForm`). `createPortal` now lives only in
`Modal.tsx`. Per-dialog look (width/padding/maxHeight) is passed via the `card` prop.
**Rationale:** One source of truth for stacking and scrim removes the duplication and makes
layering intentional; new dialogs get correct behavior for free.
**Consequences:** New dialogs should use `<Modal>` and a `Z.*` value, never a raw
`position:fixed` overlay. Non-portal dropdown menus (workspace context menu, templates) and
in-tile popovers still render inline but draw their z-index from the same `Z` scale.

### [2026-06-16] EditorPane concerns split into hooks + a shared tabs module

**Context:** `EditorPane` had grown into a god component mixing tab/model lifecycle, draft
persistence, file-watching, save logic, and theming (Major finding).
**Decision:** Extract the two self-contained concerns into `src/renderer/editor/`:
`useEditorDrafts` (debounced hot-exit draft persistence + per-path timer bookkeeping) and
`useExternalFileWatch` (on-disk change reconciliation), plus `tabs.ts` for the shared `Tab`
type and `applyContent`/`base`/`isDirty` helpers. The component keeps the Monaco/tab glue
(and its ref-held tab `Map` + `force` re-render).
**Rationale:** Behavior-preserving SRP cleanup verified by the existing editor e2e suites;
isolates the timer/IO logic from the rendering glue without rearchitecting the tab core.
**Consequences:** The deeper move of the tab `Map` into real React state (to retire the
`force` re-render hack) remains open as a future refactor.

### [2026-06-16] Renderer store decomposed into slices; WorkspaceView into PaneTile

**Context:** A second `/review-quality` pass flagged the ~600-line `store.ts` as a god module
and `WorkspaceView` as a god component (layout + six modal states + toolbar + popovers + the
status/AI display for every pane in one ~100-line `renderTile`).
**Decision:** Split the store into cohesive slice creators under `src/renderer/store/`
(`theme/runtime/quick/schedule-slice`) composed by a thin root in `store.ts`; the single `State`
type stays whole (in `store/types.ts`) so no consumer changes. Shared debounced-save and
`commitPane` helpers are passed to slices via a `SliceDeps` object; pure helpers live in
`store/internals.ts` (and are re-exported from `store.ts` for back-compat). Split `WorkspaceView`
into `PaneTile` (one per mosaic tile, owning its own single-`menu` state and subscribing only to
*its* pane's store slices) plus `PaneToolbar`, `ProcessPopover`, and `CwdMenu`.
**Rationale:** Per-tile subscriptions also cut re-renders — sibling tiles no longer re-render on
another pane's runtime churn. Behavior-preserving; verified by the full unit + e2e suites.
**Consequences:** Adding store behavior means editing the relevant slice (not one giant file);
new per-pane UI goes in `PaneTile`/its subcomponents. `data-testid`s and DOM were kept identical.

### [2026-06-16] EditorPane owns the live tab set; config.files is initializer + additive only

**Context:** The quality review flagged that `EditorPane`'s config-sync effect added tabs for new
`config.files` but never removed ones dropped elsewhere — two sources of truth. The obvious fix
(full add+remove reconciliation) was implemented and **broke Save As in e2e**: `openTab` is async,
so a freshly opened path is in the local `tabs.current` before the `config` snapshot the effect
closes over reflects it, and the removal pass tore the new tab down.
**Decision:** Keep the sync effect **additive only** and document that `EditorPane` owns the live
tab set (`tabs.current` + `order`); `config.files` is the initializer and an additive source, and
tab *removal* is driven locally by `closeTab`, which persists the shrunk list straight back. Also
fixed `openTab` to persist the accurate file list (was persisting a by-one-render-stale order) and
extracted a shared `dropTab` used by `closeTab`.
**Rationale:** Nothing in the app removes a file from `config.files` externally, so the two never
drift in practice; the additive contract avoids racing the async `openTab`. This is the
review's explicitly-offered alternative resolution.
**Consequences:** A future need to remove tabs from outside the pane would require a
race-safe reconciliation (e.g. keyed on a stable signal, not the live `config` snapshot).

### [2026-06-16] Env-vault payload is versioned and unlock rejects malformed shapes

**Context:** Review #3 found `EnvVault.unlock` coerced a decrypted-but-wrong-shaped payload via
`d.global ?? {}` / `d.terminals ?? {}`. A correct passphrase decrypting a structurally-unexpected
blob would unlock to *empty* maps, and the next `setGlobal` would `persist()` over the real file —
silent total loss of stored vars. The vault payload also carried no schema version (unlike
workspaces).
**Decision:** Add a pure `parseVaultData(d)` that strictly validates shape and a `version` field
and returns `null` (→ unlock fails) rather than coercing when `global`/`terminals` are
present-but-wrong-typed or the version is newer than supported. `persist()` now stamps
`VAULT_VERSION`. Absent fields still default to `{}`, and version-less legacy vaults are read as v1.
**Rationale:** Rejecting is strictly safer than coercing — a failed unlock leaves the encrypted
file untouched, where coercion could erase it. Backward compatibility matters because existing
users have unversioned vaults on disk.
**Consequences:** A future format change bumps `VAULT_VERSION` and adds migration in
`parseVaultData`; a too-new vault opened by old code refuses to unlock instead of corrupting.

### [2026-06-16] register.ts is a composition root over per-domain registrars

**Context:** Review #3 flagged the 178-line `registerHandlers` as a god module with divergent-change
pressure — it constructed every service, registered ~40 handlers, and owned cross-cutting teardown.
**Decision:** Split it into per-domain registrars (`register-pty`/`-fs`/`-workspaces`/`-drafts`/
`-cloud`/`-usage`/`-recording`/`-env`), each owning its handlers and returning an optional
`Disposer`. `registerHandlers` builds the genuinely-shared services (`store`, `quick`, `shells`,
`recorder`, `envVault`, the `send` teardown guard) and the PTY/status/process/ai stack — which is
in a real construction cycle, so it stays in `register-pty.ts` and returns the `PtyManager` the
recording registrar needs — then aggregates all disposers into one `win.on('closed')`.
**Rationale:** Mirrors the store-slice split: adding a feature edits one registrar, not a monolith.
The `recorder` and `envVault` are shared across domains, so they're constructed in the root and
passed down rather than owned by a single registrar.
**Consequences:** `drafts.flush()` stays on the earlier `close` event (inside `register-drafts`)
because it must run synchronously while the window still exists; only `closed`-time teardown goes
through the disposer list.

### [2026-06-16] AI working/awaiting tracks the agent's "esc to interrupt" indicator, not output silence

**Context:** Two opposite bugs. (1) "Claude always shows active": an AI agent is one long shell
command (OSC 133 **C** at launch, no **D** until it exits) sitting at its own TUI prompt, which
`looksLikePrompt` doesn't recognize — so the tracker stayed busy forever and `aiState` was
permanently `'working'`. A first fix idled AI terminals on **sustained output silence**, which then
caused (2) "idle no matter what during the sleep": an agent blocked on a `sleep`/long tool is
busy-but-quiet, so silence falsely idled it — and worse, once idle the agent's *next turn* emits no
new start marker, so it never went back to busy (genuinely "idle no matter what"). Extensive real-app
capture (max `quietMs` ≈ 200 ms during normal work; ConPTY repaints of the working bar are
pure-control and bypass the quiet timer) confirmed output timing/silence cannot distinguish
working-but-quiet from awaiting.
**Decision:** Drive AI busy/awaiting off the agent's own **working indicator** — the `esc to
interrupt` status line (`AGENT_WORKING_RE`), scanned from *all* output (including pure-control
repaints, matched space-insensitively because TUIs space words with cursor moves stripped by
`stripAnsi`). `StatusTracker` records `lastWorkingAt`; while it's within `AGENT_WORKING_GRACE_MS`
(6 s) the terminal is busy, a fresh sighting **resumes** an idle session to busy, and only when the
indicator is that stale *and* output is silent does `computeIdleFallback(…, aiActive, aiWorkingRecent)`
let it idle. If the indicator never appears, it falls back to plain sustained-silence.
**Rationale:** The agent authoritatively advertises "I'm working" via `esc to interrupt` the entire
time it's busy (incl. blocked on a tool), and drops it only when awaiting — the one signal robust to
output stalls and repaint classification. Tried and rejected: silence-only (this regression);
`looksLikePrompt` on the agent's box (fragile); the process tree (busy-gated polling stops once
idle, and "transient tool child" vs the agent's persistent helpers is fuzzy).
**Consequences:** Couples to the `esc to interrupt` wording (with a silence fallback if it changes).
~6 s lag before "awaiting" shows after a turn ends. Other non-AI TUIs (vim, top) still read as busy —
out of scope.

### [project] node-pty Spectre patch + electron-rebuild

**Context:** node-pty is native and must match Electron's ABI; its build expects
MSVC Spectre-mitigated libs we don't install.
**Decision:** Disable the Spectre mitigation via `patch-package`
(`patches/node-pty+1.1.0-beta34.patch`, applied on `postinstall`) and
`electron-rebuild` for the Electron ABI.
**Rationale:** Lets the module build and load without the Spectre toolset.
**Consequences:** First-time setup needs the rebuild; clear
`NoDefaultCurrentDirectoryInExePath` if a `.bat`-invoking build fails.

### [2026-06-16] e2e spawn flakiness: absorb with retries+headroom, NOT by slowing the CIM poll

**Context:** The launch-heavy e2e suite intermittently hangs a terminal-spawning spec (broadcast,
cwd, ssh-quick, workspace-templates) for the full 60 s timeout under whole-suite CPU contention,
and the run was being silently guillotined ("did not run") by a too-tight `globalTimeout`. A
plausible root cause was the busy-gated process poll: `queryProcesses` spawns a `powershell.exe`
(`Get-CimInstance Win32_Process`) **every second** per busy terminal, contending with node-pty
ConPTY spawns.
**Decision:** **Tried and reverted** slowing the CIM poll in e2e (a `TERMHALLA_PROC_POLL_MS` env
override, ~off suite-wide, fast only for the proc-asserting specs). It did **not** fix the spawn
hangs (broadcast/cwd still flaked) and it **broke `usage.spec`** — a third proc-derived spec I'd
missed (Claude context % flows through the same poll) — whose wasted retries ballooned the run and
worsened load. The shipped fix is config-only: `retries: 1→2` and `globalTimeout: 600s→1200s`.
**Rationale:** The hangs are node-pty ConPTY spawn under load, not the poll; the poll was a red
herring. Retries absorb the probabilistic flakiness (all flaky specs recover) and the headroom stops
the guillotine. The full suite then ran green: 52 passed + 3 flaky-recovered, 0 failed, 14 min.
**Consequences:** Don't re-attempt the proc-poll-slowdown path. If a *new* proc-dependent spec is
added it inherits the normal 1 s poll (no override to forget). The spawn flakiness is inherent to
Windows ConPTY under load — retries are the accepted mitigation, not a 100% guarantee.

### [2026-06-16] Alert-bar text colour is luminance-derived, not fixed white

**Context:** Readability audit (WCAG ratios over the real token pairs) found one hard failure:
white title text on the needs-input **orange** (`#ff8f00`) bar at **2.29:1**; the busy blue bar was
a marginal 3.68:1. The alert colours are user-themable, so any fix hardcoding white (or a darker
colour) only addresses the defaults.
**Decision:** Derive the bar's title colour from the bar colour's luminance — `readableOn()` in the
new pure `@shared/contrast.ts` (WCAG crossover L > 0.179 → dark `#182026` else white), emitted as
`--on-busy`/`--on-needs` from **both** `themeCssVars` (app) and `themeCssVarsPartial` (overrides) so
it recomputes at every theme scope. `index.css` points the alert-title rules at those vars. Keep the
bright alert *colours* unchanged. A `theme-contrast` unit guard pins the default palette to AA.
**Rationale:** Adaptive text fixes orange (→ 7.2:1) and busy (→ 4.48:1, bold-title AA) and stays
correct for any custom alert colour — strictly better than darkening the colours (which mutes the
alert and only fixes defaults). Emitting from the existing var functions means zero component wiring.
**Consequences:** The busy blue is an inherently mid-luminance colour where neither black nor white
reaches 4.5:1 for *small* text; 4.48:1 is the best achievable without darkening the colour, accepted
because the title is bold (AA-large). A user picking a mid-luminance alert colour gets the same
best-effort. The guard test fails the build if a future token edit regresses contrast.

### [2026-06-17] Fallible user actions gate success on `runOp`; vault writes propagate

**Context:** A `/review-quality` pass (4th) flagged two data-integrity Major bugs. Editor save
(`use-editor-tabs.ts`) `await`ed `fs:write` with no catch, then marked the buffer clean and deleted
its recovery draft — a rejected write silently discarded the edits. Env-vault add/create toasted
success unconditionally; worse, `env:setGlobal`/`setTerminal` were fire-and-forget `send`s and
`EnvVault.persist()` swallowed write errors, so the toast could never be truthful.
**Decision:** Route fallible user actions through one tested `runOp(op, toast, failMsg)` helper that
awaits the op and, on rejection, toasts `"<failMsg>: <message>"` and returns `false` so the caller
skips its success follow-up. Save commits clean-state + draft-drop only when `runOp` returns true.
For env, promote `setGlobal`/`setTerminal` from `send` to `invoke`, and make `persist()` **throw**
instead of swallowing — so create/set propagate a write failure to the renderer's `runOp`. The
**remove** handlers stay `send` + best-effort (swallowed at the IPC boundary).
**Rationale:** The renderer can only avoid a false success if the failure actually reaches it —
which needs both an awaitable channel (`invoke`) *and* a non-swallowing producer (`persist`). The
set-vs-remove asymmetry is deliberate: a failed *add* loses data the user just typed (must surface);
a failed *remove* loses nothing (the var simply reappears next launch), so best-effort is fine and
avoids crashing the `.on` listener. This also resolves the long-deferred "silent write-error swallow
in `EnvVault.persist()`" follow-up.
**Consequences:** Every new fallible IPC-backed action should use `runOp` rather than re-rolling a
try/catch. A vault add/create can now reject; callers must `await` it. `persist()` throwing means any
*future* automatic/background persist caller would need its own catch — today every caller is a
user action that can surface a toast.

### [2026-06-17] Renderer pure logic kept api-free so it's vitest-testable

**Context:** Consolidating the duplicated shell-id / add-pane / theme-scope logic into shared helpers
needed those helpers unit-tested. But `src/renderer/api.ts` evaluates `window.termhalla` at module
load, so *any* module that imports `../api` (directly or transitively, e.g. `store/internals.ts`)
throws under vitest's node environment — which is why the store itself has no direct unit test and
slices are tested via their isolated creators.
**Decision:** Put extracted renderer pure logic in api-free modules — `op.ts`, `store/pane-ops.ts`
(`defaultShellId`/`firstTarget`/`dispatchAddPane`), `components/theme-scope.ts` — injecting any IPC
dependency as a parameter (e.g. `dispatchAddPane(state, wsId, kind, openFolder)` takes `openFolder`;
the `addPaneOfKind` store action passes `() => api.openFolder()`). `firstTarget` moved out of
`internals.ts` into `pane-ops.ts` and is re-exported for existing call sites.
**Rationale:** Mirrors the established main-process convention (pure modules beside the impure shell)
on the renderer side. Dependency injection keeps the helpers free of `window`, so they run headless.
**Consequences:** When extracting renderer logic to unit-test it, don't import `../api` in that
module — thread the IPC call in as a function argument and call it from the thin store action.
