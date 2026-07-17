# Decision Log

Non-obvious architectural and implementation decisions, newest-relevant grouped by
area. Each entry: **Context → Decision → Rationale → Consequences.** Point-in-time
design specs live in [`superpowers/specs/`](superpowers/); this log captures the
*why* that outlives any single spec.

---

### [2026-07-17] Programmatic pane focus always tracks `focusedPaneId` (one helper)

**Context:** `focusedPaneId` — the store's "active pane", which the maximize/minimize
chords and every dialog-close refocus target — was seeded only by a tile-body
mouse-down. Every programmatic focus (`requestPaneFocus` on create, restore,
cross-workspace move, workspace adopt) moved the *keyboard* without updating the
*store*, so the chords and refocus aimed at the previous pane. `pane-reveal.ts` had
independently discovered the correct pattern (set, then focus); nowhere else used it.
**Decision:** All programmatic focus routes through one store-closure helper,
`focusPaneTracked(paneId)` = `setFocusedPane(paneId)` + `requestPaneFocus(paneId)`.
The toolbar (rendered by MosaicWindow *outside* the tile body) gets its own
focus-tracking mouse-down. `setActive` gains `{ refocusPane: false }` so keyboard
tab-navigation can decline the pane refocus that would otherwise steal focus off the
tab button frames later.
**Rationale:** The store and the DOM must agree on which pane is "focused" or every
focusedPaneId consumer inherits the divergence; one chokepoint keeps a future
focus-issuing action from re-introducing it (the same argument as the 2026-07-03
editable-chrome guard, one entry down).
**Consequences:** Any new action that calls `requestPaneFocus` directly on a specific
pane is almost certainly wrong — use `focusPaneTracked`. `refocusActivePane` also
tracks its fallback target, so a stale cross-workspace `focusedPaneId` self-heals on
the next tab switch.

### [2026-07-17] Keyboard chords model Alt; an alt-held event never matches a non-alt binding

**Context:** The QoL batch needed defaults for directional pane focus and terminal
font zoom, but the chord model was `mod[+shift]+key` only — and every attractive
default either collided with a shell/readline binding (Ctrl+Shift+arrows are
PSReadLine word-selection) or an Electron menu-role accelerator (Ctrl+-/Ctrl+0 are
whole-UI zoom). Separately, the matcher was alt-*blind*: AltGr reports ctrl+alt on
many layouts, so AltGr+K while typing international text could falsely fire the
mod+K palette — a latent bug for non-US users.
**Decision:** `Chord` gains an optional `alt` flag (chordKey `mod+alt+…`; persisted
pre-alt overrides parse unchanged). `eventToChord` records alt only when held, so a
chordKey comparison makes alt-held events and non-alt bindings mutually invisible.
The reserved Ctrl+digit workspace jump also requires `!altKey`. New defaults:
mod+alt+arrows (directional focus), mod+alt+=/-/0 (font zoom).
**Rationale:** Extending the model was cheaper than any single workaround and fixes
the AltGr class outright; alt-space defaults conflict with nothing the app or common
shells claim.
**Consequences:** `isValidRebind` allows digits with Alt held (the reserved-jump ban
applies only to bare mod+digit). Rebind capture in KeybindingsSettings records Alt
automatically via `eventToChord`. Mac option-key semantics (⌥ composes characters)
are untested — revisit defaults if a mac build ever ships.

### [2026-07-03] Programmatic pane refocus never steals from editable chrome

**Context:** Workspace rename was broken: activating a workspace starts a
`requestPaneFocus` retry loop (up to ~20 frames) that keeps calling `term.focus()`
until the terminal owns focus. A rename input mounting inside that window was
focus-yanked → blurred → auto-committed before the user could type. The same class
of steal threatens any chrome text field near a workspace switch.
**Decision:** The focus machinery (`terminal-registry.ts`) checks
`isEditableChromeFocus` before every attempt: if `document.activeElement` is an
editable control (input/textarea/select/contenteditable) **outside** any pane body
(`.ws-mosaic` is the boundary), the request aborts — including mid-loop. Pane-owned
editables (xterm's helper textarea, Monaco's input) are inside `.ws-mosaic`, so
workspace switches still move focus off them normally.
**Rationale:** The alternative (each chrome input cancelling pending requests) puts
the burden on every future dialog/input; a single invariant at the focus chokepoint
protects them all, and "never yank focus from a field the user is typing in" is the
right UX rule regardless of caller.
**Consequences:** New pane kinds whose bodies live outside `.ws-mosaic` would
wrongly suppress refocus — keep pane bodies under the `WorkspaceView` root. The
guard is pure and injectable (`getActive` param), unit-tested in
`tests/renderer/terminal-registry-focus.test.ts`.

### [2026-07-03] Tear-off drag ghost: DOM element inside, OS window outside

**Context:** The undock drag's ghost is a DOM element, which is clipped at the
window edge — exactly where a tear-off drag goes — so users reported the ghost as
"not spawning." A DOM element can never provide out-of-window feedback.
**Decision:** Keep the DOM ghost inside the window; add a main-process
`DragGhost` — a frameless, transparent, click-through, always-on-top, non-focusable
mini `BrowserWindow` (no preload, inline `data:` URL, HTML-escaped name) shown only
while the cursor is outside **every** app window (`ghostVisibleAt` in the pure
`window-manager-core.ts`), fed by a rAF-throttled fire-and-forget `win:dragGhost`
channel, and destroyed on drop/window-close/quit.
**Rationale:** Showing the OS chip only outside app windows avoids doubling the
visual with the DOM ghost; putting the show/hide predicate in the pure core makes
the policy unit-testable (Playwright cannot move the OS cursor outside the Electron
window). Strict cosmetic-only constraints (ignores mouse, never focusable, no
preload) keep it out of the security and lifecycle surface.
**Consequences:** The ghost window transiently appears in `app.windows()` — e2e
specs must select the floating window by its `floating-header`, never "any window ≠
main" (undock/minimize-undock specs updated). Cleanup is wired to three paths so it
can never keep the app alive.

### [2026-07-03] node-pty patch also defines NDEBUG (no CRT assert dialogs in Release)

**Context:** Force-closing the app with a live PTY intermittently popped a blocking
MSVC "Assertion failed" dialog from `conpty.node` (`conpty.cc` `remove_pty_baton` —
a known upstream ConPTY teardown race) and wedged app exit. node-gyp Release builds
do **not** define `NDEBUG`, so node-pty's raw `assert()` calls ship live.
**Decision:** Extend the existing patch-package diff (`patches/node-pty+…patch`) to
add `defines: ['NDEBUG']` to `binding.gyp`'s Windows `target_defaults`, compiling
the asserts out; regenerated with `npx patch-package node-pty --include '\.gyp$'`
per the hand-edit gotcha.
**Rationale:** A blocking modal in a terminal app's exit path is strictly worse
than the assert's silent-failure mode; `NDEBUG` in release is the industry default
the gyp toolchain just happens not to set. Fixing the upstream race is out of scope.
**Consequences:** node-pty asserts are inert in our builds (verified: the assert
expression string is absent from the rebuilt binary). If the patch is ever
regenerated, run `npx patch-package` FIRST — a later `npm install` can leave
`node_modules` silently unpatched while stale built binaries keep working, and
regenerating from that state drops the existing hunks.

### [2026-07-03] Transient menus dismiss when a modal opens over them

**Context:** Frozen TEST-018 (settings round-trip then reopen the templates menu)
and `workspace-templates.spec.ts` ("menu stays open after save") pinned conflicting
behaviors: the templates menu's invisible full-viewport click-catcher survived a
Settings open/close cycle and swallowed the next tab-strip click.
**Decision:** The templates menu closes when the Settings modal opens
(`WorkspaceTabs` watches `settings !== null`); saving a template still leaves the
menu open. The shared `Modal` also takes focus on open, guarded to never yank a
child `autoFocus`.
**Rationale:** A dropdown is transient chrome; a modal opening over it is a context
switch that should dismiss it (standard menu behavior). This satisfies both frozen
specs without weakening either.
**Consequences:** Other backdrop-based menus (ws-menu, proc/cwd menus) still rely
on click-away only; if one is ever reachable while a modal opens, apply the same
rule rather than z-index tricks.

### [2026-06-20] Atomic persistence writes + flush-before-quit

**Context:** A user lost SSH connections (`quick.json` wiped to defaults) and some
workspaces' saved cwd after an auto-update restart. Root cause: every store wrote
with a plain `writeFile` (which truncates the target before writing), and on quit
the workspace/quick writes fired fire-and-forget from the renderer's `beforeunload`
with nothing in main awaiting them. The auto-update installer (`quitAndInstall`,
and electron-updater's `autoInstallOnAppQuit`) tore the process down mid-write,
leaving truncated files that every loader silently degrades to defaults/null on the
next launch. Notes/drafts survived because they flush *synchronously from main* on
`win.on('close')` — that asymmetry pinpointed the gap.
**Decision:** (1) Route all persistence through `atomicWrite`/`atomicWriteSync`
(`persistence/atomic-write.ts`): write a unique temp file, then `rename` over the
target (atomic on one volume), with a retry on transient Windows `EPERM`/`EBUSY`.
(2) Defer the quit: `before-quit` calls `wm.flushRenderers(2s)`, a `app:flush` →
`app:flush:done` round-trip (coordinated by the pure `coordinateFlush`), and only
quits once every window confirms or the timeout fires.
**Rationale:** `rename` makes an interrupted write leave *either* the old complete
file or the new one — never a truncated one — which alone would have prevented the
data loss. The flush wait additionally guarantees the *latest* state reaches disk
across all quit paths, not just kept-intact. The timeout means a hung/crashed
renderer can never wedge the quit.
**Consequences:** Persistence is crash-safe by construction; new stores should use
`atomicWrite`, not `writeFile`. A quit costs one bounded renderer round-trip
(normally a few ms). Orphaned `*.tmp` files can be left only by a hard kill between
temp-write and rename, and are ignored by `listWorkspaceIds`' `*.json` filter.

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
`NoDefaultCurrentDirectoryInExePath` if a `.bat`-invoking build fails. The patch must
be a real `patch-package`-generated diff — a hand-edited one with wrong hunk line
counts fails to *parse* and breaks `npm ci` postinstall (this surfaced only on a fresh
GitHub Actions checkout, never locally where node-pty was already built). Regenerate
with `npx patch-package node-pty --include '\.gyp$'`, never hand-edit hunk headers.
`.gitattributes` pins `patches/** text eol=lf` so Windows CI (core.autocrlf=true)
doesn't check the patch out as CRLF, which would also break parsing.

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
**Note (2026-06-29, feature 0001 / ESC-001):** the toast on/off preference added with the Edit ▸
Settings… menu (`quick.toastsEnabled`) governs **success/info toasts only** — `error`-kind toasts
always render regardless of the setting (`pushToast` branches on `kind` in `toasts-slice.ts`). The
`runOp` failure-feedback guarantee above is therefore **preserved**: a failed save/vault write still
surfaces its "Save failed"/error toast even when toasts are disabled.

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

### [2026-06-17] Packaging: electron-builder + NSIS + generic auto-update feed

> **Superseded in part (2026-06-17):** the repo went public; the auto-update feed moved
> from the generic HTTP placeholder to the GitHub provider, and build/release moved to
> GitHub Actions. See *"CI/build/releases on GitHub Actions; auto-update from GitHub
> Releases"* at the end of this file. The electron-builder / NSIS / unsigned / asarUnpack
> decisions below still stand.

**Context:** Termhalla had no distribution path — `electron-vite` built to `out/` but nothing turned
that into an installer. Target audience is currently internal (single dev), Windows-only, and wants
auto-updates without standing up signing infra or a private update server.
**Decision:** Package with **electron-builder** (not Electron Forge), per-user **NSIS** installer,
**unsigned**, auto-update via **electron-updater** against a **generic HTTP feed** (not GitHub
Releases). `node-pty` is `asarUnpack`'d. App icon is `build/icon.ico`, auto-discovered.
**Rationale:** electron-builder slots alongside the existing `electron-vite` build and native-rebuild
workflow with one config file, and has first-class `electron-updater` integration — Forge would mean
reworking the build pipeline for a weaker update story. A *generic* feed sidesteps the private-repo
token dance a single internal user would otherwise hit with GitHub Releases. Unsigned is acceptable
internally (click through SmartScreen); a cert can be added later under `win:`. Native `.node` files
can't be `require`'d from inside an asar, so node-pty must be unpacked or the packaged app crashes on
first PTY spawn — the one packaging failure mode that dev never exercises.
**Consequences:** The publish `url` in `electron-builder.yml` is a placeholder and must point at a
real host before the first `npm run release`. Packaging must run after `npm install` (so patch-package
applies the Spectre patch) and with `NoDefaultCurrentDirectoryInExePath` cleared (native rebuild
invokes `.bat`s). Going public later means adding signing/notarization, not changing tools.

### [2026-06-17] Pane title-bar actions: renderer-only move + CSS-hide maximize

**Context:** The pane title bar gained a right-click menu (Rename / Move to workspace / Settings /
Close) and a Maximize toggle, and shed its env/⚙/🎨 buttons. Two sub-problems had multiple viable
approaches: (a) moving a pane to another workspace without killing its PTY or losing scrollback, and
(b) maximizing one pane without destroying its siblings' xterm/Monaco state.
**Decision:** **Move** is renderer-only — serialize the xterm into a renderer stash before the
layout mutation, re-parent the `PaneNode` between workspaces, and let the destination's idempotent
`pty:spawn` re-adopt the still-running PTY (`pty.has`) and replay the stash. No main-side `transit`
buffer (unlike the cross-*window* undock handoff). Editors flush their hot-exit draft (not delete it)
while in transit; moving to a new workspace clones the source workspace's theme override (`carryTheme`).
**Maximize** keeps every sibling mounted and uses CSS — a `maximized[wsId]` flag, a `data-max`
attribute set imperatively on the tile, and `!important` rules that fill it while siblings get
`visibility: hidden` — rather than swapping `ws.layout` to the single pane.

> **Update [2026-06] — minimize/restore (feature 0003):** the pane view-state (`maximized` *and* the
> new per-workspace `minimized` list) is now **persisted** (schema `v6→v7`): it rides each
> per-workspace record (`workspaces/<id>.json`), folded on at save (`applyViewState`) and re-derived
> on load (`normalizeViewState`), so a maximized/minimized pane survives reload (REQ-007/008). The
> runtime store maps (`minimized`/`maximized`) remain the live source of truth; the record's fields
> are stale in memory between save/load and `minimize`/`maximize` are kept mutually exclusive on both
> the runtime and load paths (minimize wins). Minimize reuses the *same-window move* plumbing AND — to
> avoid dropping output during the unmount→remount gap — arms the main-side `transit` buffer for the
> same window (`pty:transit-begin`), draining it on the destination's idempotent `pty:spawn`
> re-adoption (no pane re-ownership; main still owns `windows[]`).
**Rationale:** The same-window unmount→remount is a single synchronous React commit, so no `pty:data`
can interleave — the main-side transit machinery the undock path needs is unnecessary here, and
omitting it keeps the feature in one layer. Layout-swap maximize was rejected because it unmounts
siblings (disposing scrollback, freezing live TUIs, losing unsaved Monaco edits) and risks persisting
a collapsed layout — both violate the "never unmount" invariant; the CSS approach reuses the proven
inactive-workspace `visibility:hidden` pattern and leaves the layout tree (and autosave) untouched.
**Consequences:** Move must never route through `closePane`/`teardownPanes` (they `api.ptyKill`).
Overlays opened from inside a mosaic tile must `createPortal` to `<body>` to escape the tile's
transform containing block (a real bug caught in review — the menu rendered under the toolbar).
A pre-existing `WindowManager.routeToPane` crash (asserted a main window during teardown) was hardened
in passing. `focusedPaneId` is transient and never serialized; the pane view-state (`minimized`/
`maximized`) is serialized as of feature 0003 (see the 2026-06 update above) — `serializeWorkspace`
now also writes `minimized`/`maximized` when non-empty (absent fields = empty, round-trip identical).

### [2026-06-17] CI/build/releases on GitHub Actions; auto-update from GitHub Releases

**Context:** The repo went public, so build/release no longer needs to run on the local
machine, and the private-repo token concern that motivated the generic feed is gone.
**Decision:** Two workflows run on `windows-latest` (the only supported target; native
node-pty rebuilds there): **CI** (`typecheck` + unit tests on push/PR — e2e stays local,
it's `workers: 1` and flaky on hosted runners) and **Release** (on a `v*` tag →
`electron-builder --win --publish always`). The updater's `publish:` switched from the
placeholder generic feed to the **`github`** provider (`releaseType: release`), so
`electron-updater` reads the public repo's Releases with no runtime token. A workflow
guard fails the release if the tag and `package.json` version disagree. The Help menu's
"Check for Updates…" drives an interactive check whose dialog copy is decided by a pure
`update-ui.ts` mapper (unit-tested), keeping the Electron shell thin.
**Rationale:** Public Releases is the lowest-friction feed now that no token is needed;
GitHub Actions reuses the existing npm build/native-rebuild steps with no new
infrastructure. The tag↔version guard prevents a `latest.yml`/installer version skew that
would silently wedge the updater. Splitting the dialog decision into a pure module keeps
the testable logic out of the impure Electron/dialog shell, matching the repo's
pure-core/thin-shell convention.
**Consequences:** Cutting a release is now: bump `package.json` version, commit, tag
`vX.Y.Z`, push the tag. Auto-update works from the *second* release onward (an installed
build needs a newer `latest.yml`). Builds remain unsigned (SmartScreen prompt accepted).
To review notes before going live, switch `releaseType: release` → `draft`.

### [2026-06-17] Second native module (better-sqlite3) for output search; ABI-driven test split
**Context:** The searchable-output-history feature needs a persistent full-text index over terminal
output. The app had no database dependency.
**Decision:** Use **better-sqlite3 + FTS5** (a native module), added alongside `node-pty`:
`electron-rebuild` for Electron's ABI + `asarUnpack` for its `.node` and runtime deps
(`bindings`, `file-uri-to-path`). Because the installed binary is built for Electron's ABI, it
**cannot load under vitest's Node** — so the code that imports it (`search-service.ts`, `indexer.ts`)
is **e2e-tested only**, while all real logic is pushed into pure modules unit-tested under vitest
(`segment-buffer.ts`, `prune-policy.ts`, `fts-query.ts`).
**Rationale:** FTS5 gives ranked, scalable search no hand-rolled JS index matches; the project already
runs the `electron-rebuild` machinery for `node-pty`, so the build cost is incremental. The pure/impure
split keeps the bulk of the logic testable without the ABI conflict, matching the repo's
pure-core/thin-shell convention. (Considered and rejected: sql.js/WASM — avoids native build but adds
manual whole-file persistence + RAM; pure-JS index — no FTS ranking.)
**Consequences:** A fresh checkout must `electron-rebuild` better-sqlite3 before `dev`/`e2e` (same as
node-pty); on this sandbox, clear `NoDefaultCurrentDirectoryInExePath` first and use
`electron-rebuild -o better-sqlite3` to avoid rebuilding (and breaking) node-pty's winpty `.bat` step.
Native-importing code carries no unit tests by design — the e2e is its sole gate.

### [2026-06-17] Pane hibernation deferred (keep-mounted invariant left intact)
**Context:** The 2026-06-17 feature batch included pane hibernation (sleep/wake a terminal: serialize
scrollback, kill the PTY + trackers, render a dormant tile, re-spawn + replay on wake). It is the one
feature that deliberately challenges the load-bearing "never unmount a pane" rule.
**Decision:** **Deferred, not built.** The design was explored (sleep = readPaneSnapshot →
teardownPanes → clearPaneRuntime → mark `asleep`, keep the pane in the layout; wake = stash snapshot →
TerminalPane remounts + re-spawns) but stopped before implementation.
**Rationale:** Owner deferred it during brainstorming when the open decisions surfaced
(scrollback-persist-across-restart vs same-session; SSH reconnect-on-wake). The other four batch
features were lower-risk and shipped; hibernation warrants its own focused cycle.
**Consequences:** The keep-mounted invariant is unchanged. If revived, resume from the brainstorm:
reuse the `stashSnapshot`/`consumeSnapshot` + serialize-before-dispose machinery; do NOT route through
`closePane`/`teardownPanes` (those drop the persisted pane). No branch exists.

### [2026-06-18] Release publishing via `gh release create`, not electron-builder's publisher
**Context:** Cutting v0.2.0 produced **two GitHub release objects for the same `v0.2.0` tag** with
the assets split between them — one had only the `.blockmap`, the other the installer + `latest.yml`.
electron-builder's GitHub publisher uploads artifacts concurrently and each lazily creates the
release, racing into duplicates (visible as doubled `publishing publisher=Github` log lines). The
tag resolved to the incomplete release, so auto-update would have broken. Cleaned up by deleting the
incomplete release object via the API.
**Decision:** Take electron-builder out of the release-creation path. `npm run package` now builds
with `--publish never` (still emits `latest.yml`, since the `publish:` config is present); the
`release.yml` workflow publishes in one deterministic step with `gh release create "$TAG"
--generate-notes dist/*.exe dist/*.blockmap dist/latest.yml` (idempotent on re-run via `gh release
upload --clobber`). Added `nsis.artifactName: ${productName}-Setup-${version}.${ext}` so the on-disk
filename is space-free and matches both the uploaded asset name and the name baked into `latest.yml`
(GitHub rewrites spaces in asset filenames, which would otherwise desync the updater's download URL).
The `npm run release` script is removed.
**Rationale:** `gh release create` creates exactly one release object, so the duplicate-release race
is structurally impossible. The `publish:` block stays in `electron-builder.yml` only so
`app-update.yml` (the runtime feed coordinates) and `latest.yml` are still generated. Verified
locally: `npm run package` emits `dist/Termhalla-Setup-0.2.0.exe` + `.blockmap` + `latest.yml` with
`latest.yml` referencing the dashed name, and creates no GitHub release.
**Consequences:** Releasing is unchanged for the operator (bump version, commit, tag `vX.Y.Z`, push
tag). There is no local one-shot publish script anymore — publishing only happens in CI. If the
artifactName is ever changed, keep it space-free or the updater URL will break.

### [2026-06-29] CHANGELOG releases keep feature bullets in `[Unreleased]` (doc-guard coupling)
**Context:** The per-feature doc-traceability guards (`tests/docs-feature-NNNN.test.ts`, e.g. TEST-021
for 0001 and TEST-024 for 0002) assert that specific keywords describing a user-facing change live in
the `## [Unreleased]` CHANGELOG section — they slice from `## [Unreleased]` to the next `## [`
heading and grep that block. A Keep-a-Changelog-style release that *moves* `[Unreleased]` content into
a dated version section therefore empties the block those guards read and turns them RED. This already
bit v0.5.0: cutting it emptied `[Unreleased]`, breaking the feature-0001 guard, which then had to be
repaired by re-adding the 0001 bullets back into `[Unreleased]`.
**Decision:** On release, **do not empty `[Unreleased]`**. Add the new dated `## [X.Y.Z]` section with
the feature's bullets, but **leave the same bullets in `[Unreleased]`** so each active doc-guard stays
green. Result is intentional duplication: a shipped feature's bullets appear in both `[Unreleased]` and
its version section (0001 is in both `[Unreleased]` and `[0.5.0]`; 0002 in both `[Unreleased]` and
`[0.6.0]`). Don't move a feature's bullets out of `[Unreleased]` until its `docs-feature-NNNN` guard is
retired.
**Rationale:** Keeps `npm test` green across a release without editing frozen/merged test files, and
matches the convention v0.5.0 already established. The guards' real intent ("this change is documented
in the CHANGELOG") is preserved.
**Consequences:** `[Unreleased]` accumulates released features and is not a clean "pending" list — a
known wart. The proper fix (deferred) is to make the `docs-feature-NNNN` guards search the whole
CHANGELOG (or the feature's own version section) instead of only `[Unreleased]`, after which released
bullets can be moved out normally. Tracked in
[`docs/superpowers/0002-pane-toolbar-split-control-review-followups.md`].

---

### [2026-07-08] A pane's status may change how chrome is painted, never the size of its box

**Context:** SSH/agent terminals oscillated between busy and idle forever. The idle
toolbar rule declared a `border-bottom: 1px solid` the busy and needs-input rules did
not, and `.mosaic-window-toolbar` is content-box with a fixed `height: 30px`
(react-mosaic scopes `box-sizing: border-box` to `.mosaic, .mosaic > *`, which never
reaches the nested toolbar). The idle bar was 31px, the busy bar 30px. Being a flex
sibling of the terminal host, each status flip resized the host by 1px → refit xterm →
resize the PTY → full-screen repaint → which re-marked the pane busy → border gone →
resize again.
**Decision:** The idle hairline is an inset `box-shadow`, not a border. Any status-keyed
toolbar rule is paint-only (`background`/`color`/`border-radius`/`box-shadow`); a
box-changing property there is a bug. Pinned structurally by
`tests/renderer/pane-status-css.test.ts` and behaviorally by a real-box measurement in
`tests/e2e/status.spec.ts`.
**Rationale:** Two fixes were available. Adding `box-sizing: border-box` to the toolbar
would also have equalized the heights, but it silently changes react-mosaic's intended
30px *content* box and would leave the next `padding`/`border` addition free to
reintroduce the coupling. The inset shadow is visually identical, changes no box in any
state, and states the invariant the CSS should have had all along — the same one CLAUDE.md
already records for the editor tab strip, and that this file's own `.term-failure` rule
already asserted ("Paint-only: a red toolbar accent, never a box change").
**Consequences:** The hairline can no longer be given a width, and a future toolbar tweak
that needs real spacing must apply it to *all* status states at once, or to a child. The
guard test fails loudly otherwise.

### [2026-07-08] A marker-less pane goes busy on real output only — never on a repaint

**Context:** `StatusTracker.onOutput`'s `!hasMarkers → busy` rule sat *outside* the
`isPureControl` guard that exists to keep screen repaints from touching status. So a
repaint marked the pane busy while leaving `lastOutputAt` untouched, and the next 500ms
`tick()` idled it straight back. Combined with the box change above, that closed the
oscillation. `hasMarkers` is false for the whole life of an `ssh` pane (a launch override
runs verbatim with no shell-integration injection) and of every remote-agent pane
(`src/agent` injects none), which is why only those panes looped.
**Decision:** The marker-less busy rule moved inside the `!isPureControl` branch, next to
the tail and quiet-timer updates it belongs with.
**Rationale:** A repaint is not evidence a program is working; treating it as such gives a
pane a busy signal whose own timer immediately contradicts it. The CSS fix alone would have
broken the *loop* (a real prompt repaint is not `isPureControl`, so the tracker was still
wrong), but this rule was independently incorrect and contradicted the comment three lines
above it.
**Consequences:** A full-screen TUI over ssh whose frames *begin* with a cursor-home
sequence (`top`, `vim`) now reads **idle** rather than flapping busy/idle. That widens the
blast radius of known bug #4 (the `CURSOR_HOME_RE` catch-all in
`.orky/baseline/architecture.md`) and is the deliberate trade over an oscillating pane —
a marker-less pane simply cannot distinguish a redrawing TUI from a quiet one. AI sessions
are unaffected: `AGENT_WORKING_RE` is scanned on all output, before the pure-control check.

**Update (2026-07-09, feature 0025-cursor-home-output-suppression):** known bug #4 is now
fixed — `isPureControl` dropped its `CURSOR_HOME_RE` early-return, so a repaint chunk that
carries printable text is no longer "pure control": that text IS now admitted to the
needs-input tail with the same append-and-cap discipline as real output. This decision's own
policy is preserved **verbatim**: the marker-less busy rule (and the quiet timer, and the
needs-input→busy reset) moved to a dedicated `isRepaintChunk` check, decoupled from "has
printable content", so a repaint still never marks a marker-less pane busy and a full-screen
TUI over ssh still reads idle rather than flapping. The *intended* change is needs-input
reachability; because the tail is shared state also read by `computeIdleFallback`, two residual
consequences were disclosed and deferred (a repaint-painted prompt-shaped last line can idle a
busy marker-driven pane for the command's remainder, and a repaint-delivered needs-input has no
exit path for raw-mode TUIs until the next real-output chunk) — see
[status-engine](features/status-engine.md) → Behaviors and the
[0025 review follow-ups](superpowers/0025-cursor-home-output-suppression-review-followups.md).

### [2026-07-08] Every `fit()` is paired with a `ptyResize`, and an adopted PTY is reconciled

**Context:** Ctrl+L could not clear a garbled terminal, but maximizing the pane could.
`FitAddon.fit()` calls `term.resize()` internally and nothing listens to `term.onResize`,
so an unpaired `fit()` left the PTY on the old grid — the program drew at the old width
into a terminal of a new width. Ctrl+L just makes the program redraw at the *same wrong
width*; only a real resize re-syncs them. Two sites were unpaired: the font/theme effect
(a new cell size re-grids xterm), and PTY adoption, where `pty:spawn` short-circuits on
`pty.has(id)` and drops the renderer's cols/rows while the remounted pane seeds its
ResizeObserver guard from xterm — so the discrepancy was never corrected.
**Decision:** Both renderer fit sites go through `syncGrid` (`grid-sync.ts`) sharing one
`gridRef`; main reconciles an adopted pty at adopt time via `needsGridReconcile`
(`grid-reconcile.ts`).
**Rationale:** The no-redundant-resize rule (a redundant resize forces a ConPTY repaint
that can evict the status tail) is exactly what hid these: a guard seeded from xterm can
never notice that the *PTY* disagrees. Routing every fit through one place keeps the guard
while making the pairing structural rather than a thing each call site must remember. The
adopt-time probe compares against `pty.sizeOf(id)` — the PTY's real grid — so it upholds the
same rule from the only vantage point that can see the difference.
**Consequences:** Adoption can now emit one resize (and therefore one repaint) when a pane
lands in a differently-sized tile. That is the correct, previously-missing behavior; it is
suppressed when the grids already agree. The remote manager already did this on reconnect
(`remote-workspace-manager.ts`), so the paths now agree.

### [2026-07-08] The e2e suite never presents its Electron windows

**Context:** The suite launches its own app per spec (~190) and `win.show()` raises **and**
focuses each window, so a ~13 minute run interrupts the developer ~190 times — including
over an installed Termhalla.
**Decision:** `playwright.config.ts` defaults `TERMHALLA_E2E_WINDOW=hidden`;
`window-manager.ts` skips presentation entirely on `ready-to-show` and sets
`backgroundThrottling: false`. `=inactive` and `=show` remain available. The variable is
unset outside the harness, so product behavior is untouched.
**Rationale:** `showInactive()` was tried first and is *not* sufficient: it withholds
keyboard focus but still raises the window, so it still covers your work. A window does not
need to be presented to be laid out, so the layout-measuring specs (Monaco, xterm's
FitAddon, toolbar boxes) are unaffected — verified. Throttling is disabled because a
never-shown window is a background window and xterm paints its rows on `requestAnimationFrame`.
**Consequences:** Presentation is now a test-controlled seam in `createBrowserWindow` — a
small amount of test-awareness in product code, chosen over the alternative of a separate
window factory. The runtime `show()` sites (notification click, `orkyNotify:focus`) were
left raising a window when a spec exercises them, judged "at most twice per run" — that
judgement was wrong, and both it and the whole-suite validation are settled by the next entry.

### [2026-07-08] …and it raises no desktop notifications either

**Context:** Suppressing window presentation did not make an e2e run invisible. The Orky needs-you
notifier (`register.ts`) runs entirely in main and consults no window, so it raised a real Windows
toast for every spec that seeds a needs-you root without arming `TERMHALLA_E2E_NOTIFY_SPY`; its
click handler then called `mw.show()` on the main window — and `orky-notify.spec.ts` invokes that
handler directly through the spy. `win.maximize()` is a third path: Electron documents it as showing
an undisplayed window.
**Decision:** One predicate, `raisesOsSurfaces()` (true only for `show`/unset), gates both
`Notification` sites and the click-time window raise; `presentsWindows()` (false only for `hidden`)
gates presentation, including `maximize()`. Both live in `src/main/e2e-presentation.ts`; a structural
test forbids any other `src/main` file from reading `TERMHALLA_E2E_WINDOW`, and another pins every
`new Notification(` to the gate. `menu.ts`'s Settings… item joins the File items in falling back to
the first window when none is focused.
**Rationale:** Keyed on the *mode*, not on `hidden` alone: `inactive` presents a window but never
activates it, so `BrowserWindow.getFocusedWindow()` is still null and a raise would still steal the
foreground. `show` is left alone so production reaches the toast by the same code path. The spy check
in `register.ts` stays ahead of the gate, since it is the surface TEST-573/574 assert on.
**Measured, not assumed:** an earlier draft of this entry claimed the *renderer's* needs-input toast
also fired, reasoning that an unpresented window can never report focus. It is wrong. Playwright
enables CDP focus emulation, so `document.hasFocus()` is **true in every mode** and the product's own
`!document.hasFocus()` guard already closes that path; the `register-pty.ts` gate is defense in depth
only. Main-process focus is the opposite — `getFocusedWindow()` really is null under `hidden`. Probe
before theorizing about focus; the two focuses are unrelated.
**Consequences:** Four specs failed on the default and are fixed. `edit-menu-settings` TEST-014 was a
real gap (no focused window ⇒ the menu sent nothing). `redraw` and `terminal-links` typed before the
xterm textarea had focus — no OS focus ever settles it under `hidden`, so they now click
`.xterm-screen` first, the idiom the passing terminal specs already used. `statusbar-tips` raced the
7s tip rotation across a >7s settings interaction and now polls for the tip to come around.
`undock.spec.ts` asserted exactly one **visible** window, which is zero under `hidden`. Assert on a
specific window's visibility, never on a count. The tear-off drag ghost is deliberately *not* gated:
it shows only when the drag cursor leaves every window's bounds, which a Playwright drag never does.

### [2026-07-09] The connected remote stack is e2e-tested in-app through a second env-gated seam

**Context:** Every layer of the remote stack was well tested in vitest — real agent/bridge/daemon
processes over the `fake-ssh.mjs` shim — but the production composition (renderer → preload →
`register-remote` → `RemoteWorkspaceManager` → `connectWithProvisioning`) had never once run green
in the app: the only in-app remote spec deliberately connects to an RFC 6761 `.invalid` host, and a
Playwright spec can reach neither a real ssh host nor the Linux-only native pty backend. Native-ssh
(marker-less launch-override) panes had no in-app coverage at all.
**Decision:** `TERMHALLA_E2E_REMOTE_SSH` (JSON `{program, prefixArgs}`) is read by exactly ONE
module, `src/main/e2e-remote.ts` — the `e2e-presentation.ts` discipline, with the same structural
test forbidding other readers across `src/main` AND `src/remote-client` — and `services.ts` spreads
the parsed override into `connectWithProvisioning` with `ptyBackend: 'fake'` FORCED, never
configurable. Unset (the product default), the spread is `undefined` and production connects are
byte-identical. Marker-less panes are driven by seeding a workspace whose terminal `launch` runs a
tiny deterministic Node fixture verbatim — the exact spawn path an SSH favorite rides, no product
seam needed.
**Rationale:** The shim, not a mock: the specs exercise the real out/agent bundle, real framing,
real provisioning, and the real per-workspace daemon. The backend is forced to `fake` because a
native backend under the harness has no Windows target and its failure mode is a silent hang, not a
red assertion. The seam earned its keep on its first green run, catching two composition bugs
nothing else could see: the dev artifact path doubling under entry-file launches
(`app.getAppPath()` is `out/main` there, fixed via a bundle-derived devAppRoot), and the fake
backend not recognizing the CR a real keyboard sends (every programmatic writer sends `\n`).
**Measured, not assumed:** with a live daemon, `app.close()` hangs the Playwright worker's full
teardown timeout with ZERO surviving app children — the detached daemon inherits Playwright's
control-pipe handles down the Windows spawn chain (Electron → shim → bridge → daemon), so the
runner never sees EOF; kill the daemon first and close() resolves in milliseconds. And
`app.process().pid` is a launcher process, not the Electron main that spawns the wire — a
`ParentProcessId`-filtered transport kill matches nothing; match the shim's command line. Both
rules live in `tests/e2e/remote-harness.ts`.
**Consequences:** `remote-connected.spec.ts`, `remote-reconnect.spec.ts`, and
`marker-less-pane.spec.ts` pin the connected surface, daemon-reattach survival (history exactly
once — replay, not duplication), and the marker-less status story (no busy⇄idle oscillation)
against production wiring. The daemon's idle self-exit never arms while it holds a live pane (0024
FINDING-027, deliberately deferred), so the harness reaps its own daemons per run — if that ledger
item is ever fixed, the reap becomes belt-and-braces, not wrong.
