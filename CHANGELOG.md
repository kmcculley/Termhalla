# Changelog

All notable changes to Termhalla are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

### Added
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
