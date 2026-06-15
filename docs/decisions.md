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

### [2026-06-15] Session-identity race pattern for watchers

**Context:** Watchers that `await` between claiming a map slot and using it can leak
or emit stale data under rapid watch→unwatch→watch.
**Decision:** Claim the slot with a fresh `sess` object *before* awaiting, then
re-check `map.get(id) !== sess` after every await; thread `sess` through helpers.
**Rationale:** A concurrent call replaces the slot; the stale continuation must
detect it and bail.
**Consequences:** The canonical shape for `UsageTracker`, `WatchManager`, and any
future watcher.

### [project] node-pty Spectre patch + electron-rebuild

**Context:** node-pty is native and must match Electron's ABI; its build expects
MSVC Spectre-mitigated libs we don't install.
**Decision:** Disable the Spectre mitigation via `patch-package`
(`patches/node-pty+1.1.0-beta34.patch`, applied on `postinstall`) and
`electron-rebuild` for the Electron ABI.
**Rationale:** Lets the module build and load without the Spectre toolset.
**Consequences:** First-time setup needs the rebuild; clear
`NoDefaultCurrentDirectoryInExePath` if a `.bat`-invoking build fails.
