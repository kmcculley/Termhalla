# Changelog

All notable changes to Termhalla are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

### Added
- **Orky OSC heartbeat — stream-derived status for bare-SSH panes.** A second, fallback source for the
  Orky pane chip introduced by orky-status: a strict, bounded OSC marker
  (`\x1b]9999;<single-line compact JSON>\x07`, Orky's real ADR-026 contract — `{v, feature, phase, gate,
  needsHuman, reason, action}`) parsed directly out of a pane's PTY byte stream (`OrkyOscParser`, a
  third consumer of the shared `scanOsc` scanner alongside `Osc133Parser`/`CwdParser`), for panes whose
  `.orky/` tree is not filesystem-reachable from this host (e.g. a remote shell over SSH). The
  filesystem-derived status always wins when present (`selectOrkyPaneStatus`); the stream-derived
  heartbeat is used only as a fallback, mapped to the exact same `OrkyPaneStatus` chip/popover
  presentation via `orkyHeartbeatToPaneStatus` (no new presentation, no new IPC channel, no new wire
  type — it rides the existing `orky:status` push). Payload decoding is strict-but-tolerant JSON
  validation, size-capped on actual UTF-8 byte length (4096 bytes, checked before `JSON.parse`) and
  bounded on the no-terminator carry-over path (8192 bytes) — malformed/oversized/garbage input yields
  no heartbeat and never throws, never a partial decode. This feature is **Termhalla-side only**: it
  builds the Termhalla parser + renderer. The matching emission is **real and shipped** on the separate
  `C:/dev/Orky` CLI (ADR-026), opt-in via `config.heartbeat.osc` (default `false`, best-effort, never
  throws, writes nothing) — the full byte-for-byte contract lives in
  `docs/features/orky-osc-heartbeat.md`. Once a project opts in, a bare-SSH pane shows real Orky status.
  `src/main/orky/orky-tracker.ts` (the filesystem watcher) is unmodified; `SCHEMA_VERSION` is unchanged.
- **Orky status awareness in the pane chrome.** A terminal pane whose tracked cwd sits inside an
  `.orky/` project (an Orky gated-pipeline run) now surfaces that run's live
  **status** directly in the pane chrome — a read-only mirror, derived purely from reading the
  on-disk `.orky/` JSON (`active.json`, `features/*/state.json`, `findings.json`); it never spawns a
  CLI and never writes into `.orky/`. The pane toolbar gains an **Orky chip** labelled
  `feature · phase · gate N/M · ●k open`, and clicking it opens a detail popover listing every active
  feature with its phase, gate progress, open-blocking findings, and "needs you" reason. Detection is
  **gate-based**: the live phase is `active.json.phase` for the active feature and the gate frontier
  for the rest, and "needs a human" is derived from the gates (autonomous gates through `doc-sync`
  passed while `human-review` is pending), an open escalation, or a stalled heartbeat — taking
  **precedence** over the byte-derived terminal status for the pane border and lighting the workspace
  tab's 🔔 needs-you badge (gated by the same tab-badge opt-in); a halted gate failure surfaces as a
  rendered failure accent with a non-color marker. Status is pushed over a new pane-scoped `orky:status`
  IPC channel (validated + per-window scoped) from a bounded, debounced, disposable main-process watcher
  (one watcher/read per `.orky/` root) and held as live runtime state (nothing persisted;
  `SCHEMA_VERSION` unchanged). The canonical phase list (`ORKY_PHASES`) is a hardcoded mirror of Orky's
  recorded gate keys / `DRIVER_WORK_PHASES` — see `docs/features/orky-status.md` for the data-provenance
  note.
- **Minimize / restore panes.** A pane can now be **minimized** out of the visible tiled layout
  while staying fully alive in the background (its PTY keeps running, xterm scrollback / Monaco
  models / live TUIs are preserved — kept mounted off-layout, never unmounted). Minimizing reflows
  the remaining panes to fill the freed space. Minimize from the pane toolbar button, the title-bar
  right-click menu, or the rebindable **Minimize pane** keybinding (`Ctrl+Shift+H` by default). Each
  workspace shows a per-workspace **tray** of restore chips — one chip per minimized pane, surfacing
  its live status (running/idle, **needs-input**, recording, AI session) — and clicking (or
  keyboard-activating) a chip restores the pane, split to the right. Minimizing every pane shows an
  all-minimized empty state with the tray as the restore home. Minimize and maximize are mutually
  exclusive on the same pane. Minimize and maximize view-state are now **persisted** across reload
  (`SCHEMA_VERSION` 6 → 7 with an explicit, lossless migration); only pane id references / flags are
  stored — never any pane content or secrets. Output produced *during* the minimize↔restore
  transition is buffered and replayed so nothing is dropped from scrollback; an Explorer's expanded
  folders survive a minimize/restore; a backgrounded terminal whose shell exits shows a distinct
  **exited** chip rather than reading as idle; and the tray strip never swallows clicks meant for the
  reflowed terminal beneath it.

### Changed
- **Pane toolbar cleanup + unified split-direction control.** The per-pane Record toggle (the ⏺
  button) was removed from the pane toolbar and moved into the pane title-bar **context menu**
  (right-click menu) as a terminal-only **Start recording / Stop recording** item that reflects the
  same recording state. The two separate split buttons (split-right ⬌ and split-down ⬍) were
  collapsed into a single **split** button that opens one combined popover: a four-direction
  **compass** offering **up**, **down**, **left**, and **right** plus a Terminal/Editor/Explorer
  kind selector. Pick a kind, then activate a direction (mouse or keyboard — the compass is fully
  arrow-key navigable with the right direction highlighted by default) to commit the split.
- **`splitPane` supports before/after insertion.** The pure layout helper now accepts a
  `position: 'before' | 'after'` argument (default **after**, byte-for-byte today's output). A
  `left`/`up` compass split inserts the new pane **before** the source (as the parent's `first`
  child); `right`/`down` inserts it **after** (`second`). The persisted `MosaicNode` shape is
  unchanged (no schema bump).
- **Settings reachable from the native Edit menu.** The **Edit ▸ Settings…** item (accelerator
  `Ctrl+,`) opens the Settings modal via the `menu:open-settings` main→renderer IPC push; the
  redundant gear button in the workspace tab bar was removed.
- **Success/info toast notifications default off.** Bottom-right success and info toasts are
  suppressed unless explicitly enabled in Settings → General; **error toasts always render** so
  failure feedback is never silenced.

### Fixed
- **Restoring a minimized Claude pane no longer re-issues `claude --resume`.** Minimizing then
  restoring a terminal running Claude Code — and any other re-adoption of a still-running PTY (a
  same-window cross-workspace move or a multi-window handoff) — kept the live session running but
  *also* re-fired the auto-resume, typing `claude --resume` into the already-running agent, where it
  landed as a prompt instead of a command. Auto-resume now fires **only on a genuinely fresh shell
  spawn** (app start, or a newly opened pane restoring a persisted Claude session), never when
  re-adopting a live PTY — detected by the consumed scrollback snapshot that marks a re-adoption.

## [0.8.0] - 2026-06-30

### Added
- **Orky status awareness in the pane chrome.** A terminal pane whose tracked cwd sits inside an
  `.orky/` project (an Orky gated-pipeline run) now surfaces that run's live **status** directly in
  the pane chrome — a read-only mirror, derived purely from reading the on-disk `.orky/` JSON
  (`active.json`, `features/*/state.json`, `findings.json`); it never spawns a CLI and never writes
  into `.orky/`. The pane toolbar gains an **Orky chip** labelled `feature · phase · gate N/M · ●k
  open` with a detail popover listing every active feature's phase, gate progress, open-blocking
  findings, and "needs you" reason. Detection is **gate-based**: the live phase is `active.json.phase`
  for the active feature and the gate frontier for the rest, and "needs a human" is derived from the
  gates (autonomous gates through `doc-sync` passed while `human-review` is pending), an open
  escalation, or a stalled heartbeat — taking **precedence** over the byte-derived terminal status for
  the pane border and lighting the workspace tab's 🔔 needs-you badge; a halted gate failure surfaces
  as a rendered failure accent. Status is pushed over a new pane-scoped `orky:status` IPC channel
  (validated + per-window scoped) from a bounded, debounced, disposable main-process watcher (one
  watcher/read per `.orky/` root); nothing is persisted (`SCHEMA_VERSION` unchanged). See
  `docs/features/orky-status.md`.

### Fixed
- **Restoring a minimized Claude pane no longer re-issues `claude --resume`.** Minimizing then
  restoring a terminal running Claude Code — and any other re-adoption of a still-running PTY (a
  same-window cross-workspace move or a multi-window handoff) — kept the live session running but
  *also* re-fired the auto-resume, typing `claude --resume` into the already-running agent, where it
  landed as a prompt instead of a command. Auto-resume now fires **only on a genuinely fresh shell
  spawn**, never when re-adopting a live PTY — detected by the consumed scrollback snapshot that marks
  a re-adoption.

## [0.7.0] - 2026-06-30

### Added
- **Minimize / restore panes.** A pane can now be **minimized** out of the visible tiled layout
  while staying fully alive in the background (its PTY keeps running, xterm scrollback / Monaco
  models / live TUIs are preserved — kept mounted off-layout, never unmounted). Minimizing reflows
  the remaining panes to fill the freed space. Minimize from the pane toolbar button, the title-bar
  right-click menu, or the rebindable **Minimize pane** keybinding (`Ctrl+Shift+H` by default). Each
  workspace shows a per-workspace **tray** of restore chips — one chip per minimized pane, surfacing
  its live status (running/idle, **needs-input**, recording, AI session) — and clicking (or
  keyboard-activating) a chip restores the pane, split to the right. Minimizing every pane shows an
  all-minimized empty state with the tray as the restore home. Minimize and maximize are mutually
  exclusive on the same pane. Minimize and maximize view-state are now **persisted** across reload
  (`SCHEMA_VERSION` 6 → 7 with an explicit, lossless migration); only pane id references / flags are
  stored — never any pane content or secrets. Output produced *during* the minimize↔restore
  transition is buffered and replayed so nothing is dropped from scrollback; an Explorer's expanded
  folders survive a minimize/restore; a backgrounded terminal whose shell exits shows a distinct
  **exited** chip rather than reading as idle; and the tray strip never swallows clicks meant for the
  reflowed terminal beneath it.

## [0.6.0] - 2026-06-29

### Changed
- **Pane toolbar cleanup + unified split-direction control.** The per-pane Record toggle (the ⏺
  button) was removed from the pane toolbar and moved into the pane title-bar **context menu**
  (right-click menu) as a terminal-only **Start recording / Stop recording** item that reflects the
  same recording state. The two separate split buttons (split-right ⬌ and split-down ⬍) were
  collapsed into a single **split** button that opens one combined popover: a four-direction
  **compass** offering **up**, **down**, **left**, and **right** plus a Terminal/Editor/Explorer
  kind selector. Pick a kind, then activate a direction (mouse or keyboard — the compass is fully
  arrow-key navigable with the right direction highlighted by default) to commit the split. The
  popover is portalled to `<body>` and fully keyboard- and screen-reader-accessible (roving focus,
  Enter commits, Esc dismisses, focus trapped and returned to the split button on close).
- **`splitPane` supports before/after insertion.** The pure layout helper now accepts a
  `position: 'before' | 'after'` argument (default **after**, byte-for-byte today's output). A
  `left`/`up` compass split inserts the new pane **before** the source (as the parent's `first`
  child); `right`/`down` inserts it **after** (`second`). The persisted `MosaicNode` shape is
  unchanged (no schema bump).

## [0.5.0] - 2026-06-29

### Changed
- **Settings moved to a native Edit menu.** A new top-level **Edit ▸ Settings…** menu item
  (accelerator `Ctrl+,`) opens the Settings modal at the General section, via a new
  `menu:open-settings` main→renderer IPC push. The redundant ⚙ gear button in the workspace tab
  bar was removed; Settings remains reachable from the Edit menu, the Command Palette, the pane
  context menu, and the `Ctrl+,` keybinding.
- **Success/info toast notifications now default OFF.** Bottom-right success and info toasts are
  suppressed unless explicitly enabled via Settings → General ("Show success and info toast
  notifications (errors always show)"). **Error toasts always render** regardless of the setting, so
  failure feedback (e.g. the editor "Save failed" signal) is never silenced. Existing installs (and
  any `quick.json` predating the preference) read as OFF with no migration; the `toastsEnabled`
  preference is additive (no schema bump). Suppression is gated at the single `pushToast` chokepoint,
  which branches on toast kind.

## [0.4.2] - 2026-06-22

### Fixed
- **Terminal copy no longer "sometimes" silently fails.** Two structural fragilities made copy
  intermittent, especially in a live pane (e.g. a running Claude Code session):
  - *Copy raced terminal output.* Ctrl+C only copied if `term.hasSelection()` was still true at the
    keypress, but incoming output clears the xterm selection — so in an active pane the selection was
    often gone by the time you pressed the key, and Ctrl+C fell through as a bare `^C` (copying
    nothing). New **copy-on-select** (default on) copies a selection the instant the mouse gesture
    ends, before any output can clear it; the selection is left visible and Ctrl+C still works as a
    manual copy. Toggle under Settings → General ("Copy terminal selection to clipboard on select").
  - *The write was fire-and-forget.* The Windows clipboard is a single global lock that RDP / VMware
    Horizon / PowerToys AdvancedPaste / Phone Link clipboard redirectors grab right after any change;
    Electron's `clipboard.writeText` fails silently in that window. The main-side write now verifies
    by read-back and retries with a short backoff (`writeTextReliably`), surviving the lock contention.

## [0.4.1] - 2026-06-21

### Fixed
- **cmd.exe terminals now retain their working directory across restarts.** Some workspaces never
  kept their cwd even on a plain close/reopen — those running `cmd`. Persistence was sound; the gap
  was *detection*: cmd got no shell-integration injection, so it never emitted a cwd report and there
  was nothing to save. (The v0.3.7 atomic-write/flush fix addressed a different bug — truncated files
  on auto-update restart — not this one.) cmd has no `PROMPT_COMMAND` hook, but it expands codes in
  its `PROMPT` env var every prompt, so `shellInjection` now sets `PROMPT=$E]9;9;$P$E\$P$G` to emit
  `OSC 9;9;<cwd>` (ST-terminated — cmd's `PROMPT` can produce ESC but not BEL) ahead of the normal
  `path>` prompt. `CwdParser` reads it like the script-based shells, so the cwd persists and restores.
  cmd *status* detection is unchanged (still heuristic — no OSC 133 markers added). Covered by a new
  e2e that cd's a cmd pane, relaunches, and asserts the directory is restored.

## [0.4.0] - 2026-06-21

### Added
- **Clickable terminal links + image preview.** Ctrl/Cmd+click a URL in any terminal to open it in
  the browser, or a referenced image (local path or http(s) image URL) to preview it in a lightbox.
  Detection runs on the rendered buffer, so it works under cmd/PowerShell/tmux/ssh. Local-path
  previews are disabled in SSH panes (the file is on the remote); image URLs still work there.

### Fixed
- **SSH tmux options no longer break the connection on Windows.** With a tmux session *and* any
  option enabled (mouse is on by default, so this hit almost every tmux favorite), the connection
  dropped to a bare remote shell — tmux never started and the terminal's Device-Attributes report
  (`ESC[?…c`) leaked onto the prompt as `61: command not found`. The options were appended as
  arguments to a single `tmux new \; set …` using tmux's `\;` separator, whose backslash did not
  survive Windows `ssh.exe` argv parsing, so tmux never received its separator. Each option is now a
  separate `tmux set` command joined by a bare shell `;` (which survives every quoting layer), and
  the session is `exec`'d to attach. Connections with no options were unaffected and still use the
  bare `tmux new -A -s NAME` form.

### Changed
- **"Redraw terminal" (Ctrl+Shift+L) is now aggressive enough to fix a garbled running TUI.** It
  previously only repainted xterm's own buffer plus a same-tick ±1-col resize that ConPTY could
  coalesce into a no-op, so it couldn't clear corruption living in a running program's frame (a
  half-cleared overlay, a merged Claude/tmux repaint). It now does a real cross-tick SIGWINCH nudge
  (shrink the grid 2×2, restore next tick) and sends Ctrl+L so the program re-emits a clean frame.
  As a result it may clear the screen (Ctrl+L), so it no longer preserves prior on-screen content.

## [0.3.7] - 2026-06-20

### Fixed
- **Persisted state survives an interrupted/auto-update quit.** Workspaces (incl. each terminal's
  saved cwd) and `quick.json` (SSH connections, theme, keybindings) were written with a plain
  `writeFile`, which truncates the file before writing. On quit those writes also fired
  fire-and-forget from the renderer, and the auto-update installer tore the process down mid-write —
  leaving truncated files that the loaders silently degraded to defaults on next launch (SSH
  connections wiped, some workspaces reset to their spawn directory). Two fixes: (1) **all stores now
  write atomically** (temp file + `rename`, with a retry on transient Windows `EPERM`/`EBUSY`), so an
  interrupted write can never corrupt the previous good file; (2) **quit now waits for renderers to
  flush** their workspace/quick state to disk (bounded by a 2s timeout) before the process exits.

### Added
- SSH favorites: configurable tmux options (mouse, true color, faster Esc, scrollback,
  OSC 52 clipboard) applied via `set -g` on connect. Mouse mode is on by default, fixing
  wheel-scroll inside full-screen TUIs (e.g. Claude Code) under tmux.

### Fixed
- **Ctrl+V no longer pastes twice.** The terminal's custom key handler returned `false` for Ctrl+V
  without calling `preventDefault`, so the browser still fired a native paste event that xterm's own
  listener handled too — pasting the clipboard a second time. The handler now prevents the default,
  so a paste happens exactly once.
- **Auto-update installs silently and relaunches.** The "Restart now" update flow ran the NSIS
  installer interactively — popping the full wizard (install-scope "all users / just me" question,
  install dir, "launch Termhalla?" checkbox) on every update. `quitAndInstall(true, true)` now runs
  the installer with `/S`, applying the update the same way it was already installed (per-user) with
  no prompts, then auto-launches Termhalla afterward.

## [0.3.5] - 2026-06-18

### Added
- SSH favorites can open in a named tmux session (`tmux new -A -s <name>`), attached-or-created on
  connect and reattached automatically on reconnect/restart.

## [0.3.4] - 2026-06-18

### Fixed
- **Dropdown menus are readable again.** Native `<select>` option popups (the tab bar's shell picker
  and "+ pane" menu, plus the dialog dropdowns) inherited the light chrome text on Chromium's
  default-light popup background — white-on-white. `<option>` is now themed (elevated background +
  luminance-adaptive text), so the popups are legible on light and dark themes.
- **Claude usage % no longer freezes on a stale value.** When a session's transcript is rotated or
  removed between being resolved and read, the usage tracker now clears the metric (and logs the
  read failure) instead of silently leaving the chip on its last value.
- **Previously-silent main-process failures are now diagnosable.** The Windows process-table query
  (process chips), cloud-CLI output parsing, and the encrypted env-var vault each swallowed errors
  with no log. They now emit a warning — the vault distinguishes an unreadable/permission-denied
  file from an ordinary wrong passphrase (which stays quiet) — so blank chips and failed unlocks can
  be traced.

### Changed
- **Editor drafts and the per-project notepad now flush on every window's close**, not just the main
  window's, so a floating (undocked) window that closes before main still persists its in-memory
  state. Both already wrote live on each edit; this completes the shutdown safety net.

## [0.3.3] - 2026-06-18

### Fixed
- **tmux (and other full-screen TUIs) no longer launch with a garbled first frame.** Under xterm's
  DOM renderer the initial alternate-screen draw occasionally renders garbled (a known renderer miss
  a repaint cures; subsequent frames are fine). The terminal now repaints once, after the draw
  settles, whenever it enters the alternate screen — detected from the byte stream, so it works for
  tmux over ssh (where the remote process isn't visible locally). Re-arms on each entry; no-op for
  normal shell use.

## [0.3.2] - 2026-06-18

### Fixed
- **SSH connection dialog is now typeable immediately.** Opening it from the command palette is a
  modal→modal handoff (the palette closes as the form opens); the palette's close was bouncing focus
  to the active terminal and stealing the form's autoFocus, so fields couldn't be typed into until
  the window was refocused. The terminal is now refocused only when the *last* overlay closes
  (deferred, open-modal-counted), so a dialog opened by another dialog keeps its focus.
- **Terminal resize no longer risks desyncing the grid from a remote TUI.** The post-resize
  auto-repaint now only re-renders xterm (it no longer re-runs `fit()` without a matching PTY
  resize), so xterm and a remote app (e.g. tmux over ssh) can't end up disagreeing on the size. The
  manual "Redraw terminal" command (Ctrl+Shift+L) still does a full re-fit + PTY nudge.

## [0.3.1] - 2026-06-18

### Fixed
- **Cloud status no longer gets stuck on "cloud status…" after the first run.** The `cloud:status`
  push is fire-and-forget; if it fired before the renderer subscribed (more likely when restoring a
  saved session, where the CLI probe can finish first), it was lost and the dedup guard blocked a
  re-send, leaving the chip stuck on the empty placeholder. The renderer now pulls the current
  status on mount (`cloud:current`), mirroring the existing `winReady` handshake used for
  `win:assignment`. The cloud IPC handlers are also removed on teardown.

### Changed
- **Installer filename is now version-less: `Termhalla-Setup.exe`** (was `Termhalla-Setup-<version>.exe`).
  Each release still carries its real version in `latest.yml`, so auto-update is unaffected.

## [0.3.0] - 2026-06-18

### Added
- **Split buttons offer Terminal / Editor / Explorer.** The pane split buttons no longer open a
  terminal directly — each opens a small menu to choose what the split creates, in that direction.
  Terminal and Explorer inherit the source pane's working directory.
- **Auto-resume Claude on restart.** Terminals that had Claude running when the app last closed
  re-run `claude --resume` once the restored shell is ready (in the saved cwd). On by default;
  toggle under Settings → General. A `resumeAi` marker is folded into each terminal's persisted
  config at save time (no AI session content is stored).
- **Redraw a garbled terminal.** A resize now repaints the terminal once it settles, and a new
  "Redraw terminal" command (Ctrl+Shift+L, rebindable) forces a full repaint — re-fitting xterm and
  nudging the PTY so a running TUI (e.g. Claude) redraws — for cases a resize left scrambled.
- **Ctrl/Cmd + scroll zooms the terminal font.** Holding Ctrl (or Cmd) while scrolling over a
  terminal grows/shrinks the global terminal font size (clamped 8–32), applied to every terminal
  via the existing theme path. Pure step/clamp logic is unit-tested (`font-zoom`).
- **Panes take focus automatically.** A newly created terminal/editor pane is focused so you can
  type immediately; switching workspaces focuses that workspace's pane; and closing a dialog
  returns focus to the active pane. A small per-pane focus registry retries across frames so it
  works even while a pane is still mounting or its workspace is mid-switch.

### Fixed
- **`ssh` / `aws` launches no longer fail with "File not found".** node-pty's Windows resolver
  matches a bare launch command verbatim against `Path` (no PATHEXT), so `ssh`/`aws` never matched
  `ssh.exe`/`aws.exe`. Launch commands are now resolved to a full path (PATH + PATHEXT) before
  spawning. (`resolve-bin.ts` moved to `src/main/` as a shared utility.)
- **Toast notifications no longer appear to "block typing".** The real cause was that the app did no
  programmatic focus management at all: after interacting with an overlay (which fires most toasts),
  focus was never returned to the terminal. Fixed by the focus work above. Global keyboard shortcuts
  (command palette, workspace switch, …) now also reliably pass through a focused terminal to the
  app handler instead of being swallowed by xterm.

## [0.2.1] - 2026-06-18

### Added
- **Multi-profile AWS cloud status.** The AWS chip in the status bar now covers every
  profile configured in `~/.aws/config` (`[default]` + `[profile X]` sections, capped
  at 8, `['default']` fallback when the file is missing or empty). Each profile is probed
  independently with `aws sts get-caller-identity --profile X`; login opens a terminal
  running `aws sso login --profile X`. The status-bar chip shows a `N/M` logged-in count
  when there are multiple profiles, and the popover lists each profile as its own row with
  its own state glyph and Login button. Provider list is resolved per refresh cycle so
  profile additions/removals take effect without restarting the app. `CloudStatus` gains
  `family` and `profile` fields; a new pure `groupCloudStatuses` helper collapses the flat
  status array into per-family groups for the renderer. Azure is unchanged. Pure logic
  covered by new vitest suites (`aws-profiles`, `group-cloud`); e2e updated to the grouped
  chip assertions.
- **MIT license.** The project is now MIT-licensed (`LICENSE`, `package.json` `license` field).
- **Distribution channels.** Every release now also ships a portable `Termhalla-<version>-win.zip`
  (unzip-and-run, no SmartScreen prompt) alongside the NSIS installer. winget manifests
  (`packaging/winget/`) and a Scoop manifest (`packaging/scoop/`, installs the portable zip,
  hash-verified) are provided. A `packaging/signing.md` documents the (deferred) code-signing setup
  and the auto-update ordering caveat.

### Changed
- **Release publishing hardened.** Releases are now built with `electron-builder --publish never`
  and published by a single `gh release create` step, eliminating the electron-builder
  concurrent-publisher race that created duplicate release objects for one tag. The NSIS
  `artifactName` is now space-free so the on-disk file, the uploaded asset, and `latest.yml` agree.
- **CI/Release actions** bumped to `actions/checkout@v5` + `actions/setup-node@v5` (clears the
  Node 20 deprecation).

## [0.2.0] - 2026-06-17

### Added
- **Searchable output history.** Terminal output is indexed in a local SQLite FTS5
  database (`search.db` under `userData`) as it streams. A **Search output history**
  modal (🔍 in the status bar or **Ctrl+Shift+F**) lets the user query across current
  and past sessions: results show a ranked context snippet and the working directory;
  **Reveal** focuses the source pane if it is still open, **Relaunch** opens a new
  terminal at the hit's cwd. Indexing is on by default with a per-terminal 🔇/📖 mute
  toggle (persisted as `historyMuted` in the pane config, schema 5→6). A **Clear
  history** button wipes the full index. A 50 000-segment retention cap prunes the
  oldest entries automatically. Privacy boundary: output only — keystrokes are never
  indexed; the index is local and never transmitted. Built on `better-sqlite3` (native,
  Electron-ABI, `asarUnpack`); pure logic (`segment-buffer`, `prune-policy`, `fts-query`)
  is unit-tested under vitest; `SearchService` + `Indexer` are validated by a Playwright
  e2e test.
- **Saved run commands.** Each terminal pane now has a `▷` toolbar button that
  opens a **Run commands** modal listing workspace-scoped and pane-scoped saved
  commands (label + shell command). Clicking `▷` next to a command sends it to
  the terminal as raw keystrokes + CR (via the existing `encodeBroadcast` path —
  no new IPC) and closes the modal. Commands can be added, edited, and deleted
  from the same modal. Two scopes: **pane** (this terminal only) and **workspace**
  (every terminal in the workspace); workspace commands appear first in the list.
  Both lists persist with the workspace JSON and ride into saved templates.
  Schema 4→5, additive — existing workspaces load unchanged. Pure list helpers in
  `src/shared/run-commands.ts`; store slice in
  `src/renderer/store/run-commands-slice.ts`. This is the persisted, manually-triggered
  sibling of the runtime-only scheduled-commands feature.
- **Per-project notepad.** A collapsible right-side drawer (📝 in the status bar,
  or **Ctrl+Shift+N**) provides a plain-text scratchpad scoped to the focused
  pane's project. The project key is the git repo root when available (from the
  git-status service), falling back to the pane's cwd, so every pane in the same
  repo shares one note. The drawer tracks the focused pane and stays on the last
  known project when focus moves to a non-terminal or a pane without a cwd yet.
  Notes persist in an app-global `notes.json` (`userData`) via a new `NotesStore`
  (modeled on `DraftStore`): async writes during editing, synchronous flush on
  window close, empty text prunes the key. Multi-window: note content is shared
  via main; open-state and shown-project are per-window. Pure helpers in
  `src/shared/project-key.ts`; store slice in `src/renderer/store/notes-slice.ts`;
  drawer in `src/renderer/components/NotesPanel.tsx`.
- **Git status on the pane chip.** Each terminal pane whose cwd is inside a git
  working tree now shows a compact git indicator in its toolbar: the current branch
  name plus a `●` dirty dot when there are staged, unstaged, or untracked changes.
  Detached HEAD is shown with a `⎇` glyph and the short commit sha. Clicking the
  chip opens a read-only detail popover with the upstream ref, ahead/behind counts,
  and staged/unstaged/untracked file counts. Non-repo, SSH/remote, and error panes
  degrade silently to no chip. The status is kept live by a ref-counted chokidar
  watch on `.git/HEAD`, `index`, and `refs/` (catches commits, staging, and
  checkouts) plus a command-idle re-probe (catches unstaged working-tree edits).
  Runtime-only — not persisted.

## [0.1.1] - 2026-06-17

### Added
- **GitHub Actions CI & releases.** Push/PR runs typecheck + unit tests on
  `windows-latest`; pushing a `v*` tag builds the NSIS installer and publishes it to
  GitHub Releases. The auto-updater now reads GitHub Releases (was a placeholder generic
  feed).
- **Help → Check for Updates.** A new application menu adds Help → "Check for Updates…"
  (with up-to-date / downloading / restart-now feedback) and "About Termhalla", plus a
  View submenu (reload, DevTools, zoom, fullscreen).
- **Rebindable keyboard shortcuts — Settings → Keybindings.** All app-level
  shortcuts (command palette, new terminal, maximize pane, broadcast, settings,
  next/previous workspace, close workspace) are now listed in a new
  **Settings → Keybindings** section. Click a row to capture a new chord; the
  UI rejects chords without Ctrl and warns on conflicts (with a confirm to
  proceed). Bindings are persisted to `quick.json` as a `keybindings` map
  (CommandId → chord string; `'none'` to explicitly unbind a command); only
  diffs from defaults are stored. **Ctrl+1–9** workspace-jump chords are always
  reserved and cannot be shadowed by a rebind. Individual bindings and the whole
  table can be reset to defaults from the same panel.
- **Rotating keyboard-shortcut tips in the status bar.** The bottom-right of
  the status bar now shows a rotating tip — "Press Ctrl+K to open the command
  palette", etc. — cycling through the five most useful shortcuts every 7 s.
  Tips automatically reflect the user's current bindings, including any
  custom chords set in the Keybindings panel.
- **Adaptive `--fg-on-elevated` contrast token.** Menus, modals, and the
  Settings panel are now readable on any theme. The new `--fg-on-elevated` CSS
  token is derived by `readableOn(elevatedBg)` (the same luminance-adaptive
  helper used for the alert bars), so a light-theme elevated surface gets dark
  text and a dark-theme surface keeps light text — fixing light-on-light
  dropdown menus and dark-on-dark Settings panel nav links. Recomputed at every
  theme scope that overrides `elevatedBg`.

### Added
- **Pane title-bar actions — right-click menu, maximize, and cross-workspace move.**
  Right-clicking a pane's title bar opens a context menu with four items: **Rename**
  (edits the title inline and persists it as an optional `name` on the pane config),
  **Move to workspace ▸** (lists the other workspaces the current window hosts, plus
  **New Workspace**), **Settings** (opens the unified Settings panel scoped to that
  pane), and **Close**. A **Maximize** toggle button (🗖 / 🗗) was added to every
  title bar; **Ctrl+Shift+M** toggles it from the keyboard. Maximizing fills the
  workspace with the current pane — siblings are hidden via CSS `visibility: hidden`
  so their xterm scrollback and Monaco models survive. The dedicated env (🔑),
  settings gear (⚙), and style (🎨) title-bar buttons were removed; those functions
  are now reached through the **Settings** menu item. Moving a terminal to another
  workspace preserves the live PTY (re-adopted by the idempotent `pty:spawn`) and its
  scrollback (the xterm instance is serialized into a renderer-side stash and replayed
  on remount). Moving an editor flushes its recovery draft so unsaved edits survive
  the transition. Moving to a **New Workspace** carries the source workspace's theme
  override so the pane renders identically in its new home. The context menu is
  portaled to `<body>` (like Modal) so it is never clipped by a mosaic tile's
  stacking context.
- **Windows packaging, auto-update, and an app icon.** `npm run package` builds a
  per-user NSIS installer (via electron-builder) and `npm run release` also publishes
  it; the build rebuilds `node-pty` for Electron's ABI and unpacks it from the asar so
  the native binary loads at runtime. Packaged apps check a generic HTTP update feed on
  launch (electron-updater; a no-op in dev). The app now ships a custom icon
  (`build/icon.ico`). Configure the publish `url` in `electron-builder.yml` before the
  first release. See [docs/features/packaging.md](docs/features/packaging.md).
- **Keyboard navigation + command menu (UI polish phase 3).** The command palette
  (Ctrl+K) now also runs commands — type to reveal **New terminal/editor/explorer**,
  **New workspace**, **Broadcast**, **Save all**, **Refresh cloud status** (the
  default connect/jump view is unchanged until you type). New global shortcuts:
  **Ctrl+Shift+T** new terminal, **Ctrl+Shift+W** close workspace,
  **Ctrl+Tab / Ctrl+Shift+Tab** cycle workspaces, **Ctrl+1…9** jump to a workspace.
  The workspace-tab strip is now arrow-key navigable (Left/Right, Home/End) with
  proper `tablist`/`tab` roles, and the broadcast dialog + palette results expose
  correct ARIA roles. Shortcuts use terminal-safe chords and only intercept keys
  they match, so the shell still receives everything else.
- **In-app toasts + file-explorer context menu (UI polish phase 2).** Discrete actions that
  used to succeed silently (saving a workspace template or theme preset, saving an SSH
  favorite, scheduling a command, adding an env var) now confirm with a bottom-right toast.
  Right-clicking a file or folder in the explorer opens a menu: Open, Reveal in File Explorer,
  Copy path / Copy relative path, Rename (inline), and Delete (to the Recycle Bin — recoverable,
  behind a confirm). The explorer now shows "Folder is empty" / "Couldn't read folder" instead
  of a blank pane, and the env-vault passphrase field auto-focuses.
- **Undock a workspace into its own window** — drag a workspace tab off the strip to tear it into
  a real OS window you can move onto any monitor; drag it back onto the main strip, click its
  **Dock** button, or hit the window's native ✕ to re-dock (✕ never kills the shells). The running
  PTYs keep going through the move and the terminal scrollback is preserved (each xterm is
  serialized and replayed into the new window). The multi-window arrangement — which workspaces are
  undocked and where each window sits — is restored on the next launch.
- **Terminal clipboard** — copy a mouse selection with **Ctrl+C** (falls back to `^C` interrupt
  when nothing is selected), and paste with **Ctrl+V** or **right-click** (bracketed-paste-safe,
  so multi-line pastes don't auto-run).
- **Per-terminal environment variables** — edit a single terminal's own env vars from its
  `🔑` button (layered over globals).

### Fixed
- **Editor saves no longer lose content on a failed write.** A rejected `fs:write` (disk full,
  permission, path removed) used to still mark the buffer clean and delete its recovery draft,
  silently discarding the edits. Save now commits the clean state and drops the draft only after
  the write succeeds, and shows a "Save failed" toast otherwise — the buffer stays dirty so you
  can retry. The env-vault add/create actions likewise only confirm once the write succeeds:
  `env:setGlobal`/`env:setTerminal` were promoted from fire-and-forget sends to `invoke`, and
  `EnvVault.persist()` no longer swallows write errors — so a failed vault write now surfaces a
  toast instead of a false "added"/"Vault created" (removes stay best-effort).
- **Text readability (WCAG AA).** The needs-input (orange) and busy (blue) alert bars now
  pick black-or-white title text from the bar colour's luminance instead of forcing white —
  fixing white-on-orange (2.29:1 → 7.2:1) and keeping it correct for any custom alert colour
  (a derived `--on-busy`/`--on-needs` var computed at every theme scope). The recording and
  env-error reds were brightened to clear 4.5:1, and a `--status-needs-input` typo in the
  env-error colour (a non-existent var that silently fell back) was fixed. A unit guard pins
  the default theme's text/background pairs to AA so future token edits can't regress them.
- **AI agent (Claude/Codex) working-vs-awaiting status is now accurate.** An agent runs as one long
  shell command (no command-done marker until it exits) sitting at its own TUI prompt, which the
  generic idle heuristic can't read — so it used to show **active forever**, even when idle at the
  prompt. The status now tracks the agent's own `esc to interrupt` working indicator: the terminal
  is **busy** while the agent is working (including while it's blocked-but-quiet on a long tool/`sleep`,
  and across screen repaints), **resumes** to busy when the next turn begins, and flips to
  **awaiting** (`✨⏳` + the "{agent} is waiting for you" notification) only once the agent has
  stopped showing that indicator and gone quiet. Fixes both the "always active" and the
  "idle during the sleep / idle no matter what" failure modes. Scoped to detected AI sessions;
  ordinary terminals are unaffected.
- **`MaxListenersExceededWarning` with many open terminals.** Each `TerminalPane` attached its own
  raw `ipcRenderer.on` for `pty:data`/`pty:exit`, and since every workspace stays mounted, 11+
  terminals crossed Node's default 10-listeners-per-event cap and logged a spurious leak warning.
  The preload now attaches exactly one underlying listener per push channel and fans out to its
  subscribers (detaching when the last one leaves), so listener count no longer scales with pane
  count. Also removes the per-subscriber `as never` casts.

### Changed
- **Unified Settings panel (UI polish phase 4).** Theme, environment variables, and
  terminal preferences now live in one Settings window (sidebar: General / Appearance /
  Environment / Terminal) instead of three separate surfaces. Open it from the tab-bar
  **⚙**, **Ctrl+,**, or the command palette; a pane's 🎨/🔑/⚙ open the same panel
  focused on the right section with that pane preselected. The standalone theme/env
  modals and the in-tile terminal-settings popover are gone; the global
  "record-by-default" + recordings-folder controls (previously buried in a per-pane
  popover) now live under General with the default-shell preference.
- **UI polish (phase 1) — design-token foundation (no behavior change).** Hardcoded colors and
  fonts scattered through the renderer (`#094771` palette selection, the `#5a4a00`/`#bbb` editor
  bars, eight `Consolas, monospace` literals, a spread of ad-hoc `opacity` dim-text values) now
  route through a single layer of derived `:root` tokens (`--mono`, `--sel-bg`, `--warn-bg/-fg`,
  `--shadow-pop/-modal`, `--fg-dim`, `--dim/--dimmer`) that track the active theme via `color-mix`
  — so per-app/-workspace/-pane theming restyles them automatically. Modals and in-tile popovers
  gain consistent drop-shadows and a reduced-motion-safe pop-in; long pane titles now ellipsize
  instead of shoving toolbar buttons off the bar; the file explorer gets the themed scrollbar; and
  workspace tabs show a keyboard focus ring. A guard test keeps the retired literals from creeping
  back. First of a four-phase polish/QoL pass.
- **Internal refactor — code-quality pass #3 (no behavior change).** Resolved the 2 Critical and
  9 Major findings from the third quality review. Correctness: `EditorPane.closeTab` no longer
  runs side effects (model switch + persist) *inside* a `setOrder` updater — React can
  double-invoke those under StrictMode/batching — and `EnvVault.unlock` no longer silently
  destroys stored vars when a decrypted payload is malformed (a new pure `parseVaultData`
  validates shape + a `version` field and rejects rather than coercing to empty; legacy
  version-less vaults still read). Structure: `EditorPane` shed its entire Monaco/tab/draft/save/
  untitled/theme lifecycle into `editor/use-editor-tabs.ts`, with the tab strip now in
  `EditorTabStrip.tsx`; the 178-line `register.ts` god module is split into eight per-domain
  registrars (`register-pty`/`-fs`/`-workspaces`/`-drafts`/`-cloud`/`-usage`/`-recording`/`-env`)
  composed by a thin root that aggregates disposers into one `win.on('closed')`; the env-vault
  unlock backoff moved out of the IPC layer into `EnvVault.unlock`; the `StatusTracker.tick` idle
  heuristic extracted to a pure, unit-tested `computeIdleFallback`. Resilience: `loadWorkspace`/
  `loadAppState` degrade a corrupt file to `null` instead of rejecting the IPC call. Dedup: a
  shared `@shared/paths` `basename` replaces four divergent copies, a `useResolvedPaneTheme` hook
  replaces the per-pane theme effect duplicated in `EditorPane`/`TerminalPane`, `App` uses a
  scoped `useShallow` selector, and `pushRecent` gained an equality predicate so `nextRecentDirs`
  delegates to it. Covered by the existing unit + e2e suites plus new unit tests.
- **Internal refactor — code-quality pass #2 (no behavior change).** Resolved the Critical and
  Major findings from the second quality review. Renderer: `WorkspaceView` was a god component
  doing layout + six modal states + toolbar + popovers for every pane; it is split into
  `PaneTile` (owns its own menu state and subscribes only to *its* pane's slices), `PaneToolbar`,
  `ProcessPopover`, and `CwdMenu`. The 600-line zustand store is decomposed into cohesive slice
  modules (`store/theme-slice`, `runtime-slice`, `quick-slice`, `schedule-slice`, plus
  `internals`/`types`) composed by a thin root; the seven copy-pasted "open a pane" actions now
  share a `commitPane` helper and the drift-prone per-pane cleanup (status/cwd/procs/ai/usage/
  recording) goes through one `clearPaneRuntime` + `teardownPanes` path (fixing inconsistent
  workspace-close teardown). `WorkspaceTabs` now uses scoped `useShallow` selectors with derived
  badge strings (no longer re-renders on every line of terminal output); `App` collapses eight
  identical IPC-subscription effects into one; the floating popover surfaces share a `SURFACE`
  style from `Modal`. Main: the duplicated OSC scan loop in `osc133-parser`/`cwd-parser` is
  extracted to `scanOsc`; `register.ts` consolidates per-service teardown into one
  `win.on('closed')` and drops the `tracker!`/`ai!` non-null assertions. Contract: named
  `RecState`/`EnvVaultState`/`AiTool` types replace anonymous callback shapes, and the
  `draftsSet`/`draftsDelete` API names match their channels. Covered by the existing unit + e2e
  suites.
- **Internal refactor — code-quality pass (no behavior change).** Resolved the three Major
  findings from the quality review: (1) the seven copy-pasted "open a pane" branches in the
  renderer store now route through a single `placePane`/`firstTarget` helper; (2) the five-plus
  hand-rolled modal overlays (broadcast, schedule, env, theme, command palette, SSH form) now
  share one `<Modal>` component with a centralized `Z` stacking scale, replacing the ad-hoc
  z-index/backdrop literals; (3) `EditorPane` shed its draft-persistence and external-file-watch
  concerns into dedicated `useEditorDrafts`/`useExternalFileWatch` hooks plus a shared `editor/tabs`
  module. Covered by the existing editor, dialog, theme, and workspace e2e suites.
- **UI polish pass — cohesive dark chrome.** The react-mosaic window toolbars are now dark when
  idle (instead of the default light blueprint bar), and buttons, selects, and inputs across the
  tab bar, pane toolbars, status bar, and every dialog/popover share a themed look with
  hover/active feedback and an accent keyboard-focus ring. The active workspace tab gets an accent
  highlight. All scoped to chrome surfaces, so the terminal, Monaco, and their own widgets are
  untouched.
- **Theming is now scoped** — a Scope selector in the `🎨` editor themes the **app**, a
  **workspace**, or an individual **pane** (terminal/editor/explorer), layered nearest-wins.
  The window-background color is now visible (app root + mosaic gutters), and the color picker
  no longer lags (live preview writes the CSS var directly; Monaco re-theme is debounced).
- **Broadcast dialog** — **Shift+Enter** now sends; added quick-key buttons (Esc, Ctrl+C/D/Z/L,
  Tab, Enter, ↑/↓) that send the control sequence to all terminals.
- **Workspace rename** — the existing name is selected on focus, so you can type to replace it.

### Fixed
- **Scheduled-command dialog** was clipped by adjacent terminals — it now portals to `<body>`
  and covers the full window (react-mosaic tiles created a transform containing block).
- **Claude usage metrics** showed a stuck `0%` and the wrong context window.
  The transcript watcher now watches the project *directory* and re-resolves the
  newest transcript on every change (fixes binding to stale/empty session stubs),
  and the 1M context window is detected from the Claude settings model alias
  (`opus[1m]`) since the `[1m]` flag is never written to transcripts — plus an
  auto-bump to 1M when observed context exceeds 200k.
- **Switching workspace tabs blanked every pane** — terminals lost scrollback,
  the editor lost unsaved text, and a live Claude TUI froze until its next write.
  Inactive workspaces now stay mounted (hidden via `visibility`, not unmounted),
  preserving all pane state across switches.

### Added
- **Environment variable manager** — a `🔑` button opens an encrypted-local vault for env vars
  injected into terminals on spawn (global vars for every shell, plus per-terminal overrides).
  Values are stored only as an AES-256-GCM blob (scrypt-derived key) at `userData/env-vault.json`;
  decrypted values and the passphrase live in main-process memory only while unlocked, and
  workspace JSON stores only an `envId`, never values.
- **Terminal session recording** — a `⏺` button records a terminal's output to a replayable
  asciinema `.cast` file (in `userData/recordings/`); a per-terminal-settings toggle auto-records
  every new terminal.
- **Customizable UI theming** — a `🎨` editor to customize colors (window, toolbars, menus,
  borders, text, accent, busy/needs-input alerts, terminal), fonts, and sizes throughout the
  app, applied live via CSS variables and themed xterm/Monaco. Save named **presets**; the
  active theme and presets persist in `quick.json`.
- **Scheduled terminal commands** — schedule command(s) to a terminal after a delay,
  once it becomes idle, or recurring with a jitter window (the `⏱` tile button), sent as
  a command or raw keystrokes.
- **Workspace layout templates** — save a workspace's pane layout as a named template
  (the `▾` button) and create new workspaces from it; templates persist in `quick.json`.
- **Workspace tab management** — right-click a workspace tab for Rename / Save / Close,
  name a new workspace inline the moment you create it, and drag tabs to reorder them.
- **Broadcast input** — send a command to every terminal in the active workspace at
  once (the `⇉` button or `Ctrl+Shift+Enter`), as raw keystrokes or a bracketed paste.
- **Editor scratch buffer** — every editor pane now has a persistent **Untitled**
  scratch tab: type into an empty editor and the text survives a restart. **Ctrl+S**
  (or "Save As…") turns the scratch into a real file.
- **Editor hot-exit** — unsaved editor buffers now persist across an app restart
  (or crash) and are restored exactly on reopen. If a drafted file also changed on
  disk while the app was closed, the existing "Changed on disk" bar appears
  (Reload / Keep mine). Drafts are stored separately (`editor-drafts.json`), so
  workspace files stay small.
- Project documentation: `README.md`, `CLAUDE.md`, `docs/architecture.md`,
  `docs/decisions.md`, this changelog, and a doc per feature under `docs/features/`.

## [0.1.0] — in development

The initial feature set, built as a sequence of spec→plan→implement sub-projects
(see `docs/superpowers/` and `docs/features/`).

### Added — core (Phases 1–3)
- **Tiled terminal workspaces** (2026-06-13): multiple real Windows shells with a
  shell picker, react-mosaic split/resize/rearrange, named workspace tabs,
  save/restore with debounced auto-save, and window-state memory.
- **Terminal status & alert engine** (2026-06-14): OSC 133 shell integration
  (PowerShell + bash; cmd heuristics) driving busy/idle/needs-input; pane status
  borders, 🔔 tab badges, OS notifications, and per-terminal alert settings.
- **Monaco editor + live file explorer** (2026-06-14): editor panes with per-file
  tabs, dirty tracking, Ctrl+S, and undo-preserving external-change reload; a lazy,
  chokidar-watched file-tree explorer that opens files into the editor.

### Added — awareness (roadmap A–F)
- **A · CWD awareness** (2026-06-14): live per-terminal working directory via
  OSC 9;9 / OSC 7; "Open Explorer here" / "Reveal in File Explorer"; restored on
  reload; split-inherit.
- **B · SSH & favorites** (2026-06-14): Ctrl+K command palette, saved SSH
  connections (no secrets stored), recent/favorite directories, launch-override
  terminals. App-global `quick.json`.
- **C · Child-process tracking** (2026-06-14): foreground process on a chip and a
  descendant process-tree popover, via busy-gated `Get-CimInstance` polling. Works
  for all shells including cmd and SSH.
- **D · Cloud CLI status** (2026-06-14): a global bottom status bar showing AWS
  (`sts get-caller-identity`) and Azure (`az account show`) login state, with a
  detail popover and a "Log in" action.
- **E · AI session awareness** (2026-06-14): detects Claude Code / Codex sessions
  from the process tree; `✨ Claude` pane chip + workspace-tab indicator; a
  "waiting for you" notification on busy→quiet.
- **F · Claude usage metrics** (2026-06-15): live context-window % on the chip and
  a token breakdown (input/output/cache) in the popover, parsed from the session's
  Claude transcript. Claude-only; pluggable for Codex later.

### Notes
- No secrets are persisted (SSH stores host/user/port + key path only; cloud status
  stores nothing; usage reads transcripts read-only).
- Windows-first; the awareness features target Windows (ConPTY, CIM, PowerShell).
