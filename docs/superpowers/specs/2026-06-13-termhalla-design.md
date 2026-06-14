# Termhalla — Design Spec

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete; next step: implementation plan)

## 1. Summary

Termhalla is a Windows desktop application that unifies terminals, a code editor,
and a file explorer into one window with a flexible, saveable layout. Its two
defining ideas are:

1. **Workspaces** — named, persistent arrangements of tiled panes, shown as tabs,
   saved and reloaded on demand.
2. **Terminal awareness** — each terminal communicates its state (busy / idle /
   needs-input) so a wall of terminals tells you when it needs you instead of
   requiring babysitting.

This document is the approved design. The full product requirements live in the
project spec; this document records the **technical decisions** made during
brainstorming and the **phase plan** for implementation.

## 2. Key decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Tech stack | **Electron + TypeScript** | Mature, Windows-proven path; xterm.js + Monaco + node-pty all battle-tested. |
| Status detection | **Hybrid** (shell integration + output heuristics) | Best accuracy with graceful degradation when injection can't run (e.g. cmd). |
| Phasing | **Terminal-first vertical slice** | Solidifies the hardest plumbing (PTY, layout, persistence) first; each phase is shippable. |
| Self-verification | **Playwright-for-Electron as a build-iteration loop** | Drive the real app, screenshot, read DOM/console to self-check each increment before user review. |

## 3. Architecture

### 3.1 Process model (Electron)

- **Main process** owns everything privileged and stateful: node-pty sessions,
  workspace persistence (JSON in `userData`), window state, OS notifications,
  filesystem watching (explorer), and file read/write (editor). Single source of
  truth.
- **Renderer** (one window) is the entire UI in React: workspace tab strip, the
  tiled pane layout, xterm.js terminals, Monaco editor, explorer tree.
- **IPC** is a typed, namespaced bridge exposed via `preload`. `contextIsolation`
  on, `nodeIntegration` off. PTY bytes stream main→renderer; keystrokes/resize
  stream renderer→main, keyed by session id.

### 3.2 Layout engine

- In-workspace panes are **tiled, not tabbed** (tabs are reserved for workspaces).
- Use **`react-mosaic`**: a serializable binary split tree with resize +
  drag-to-rearrange built in (MIT). Matches "split h/v, resize, rearrange" and
  gives JSON serialization for save/restore for free. Each tile renders a
  Termhalla pane plus its status chrome.
- *Alternatives considered:* hand-rolled split tree (reimplements resize/DnD for
  no real gain); `flexlayout-react` (adds pane-level tabs we don't need).
- The **workspace tab strip** is our own top-level component, not part of mosaic.

### 3.3 Pane abstraction

One `Pane` interface with three implementations — `TerminalPane`, `EditorPane`,
`ExplorerPane` — each exposing: a typed config object (what gets serialized), a
render surface, and a lifecycle (mount/dispose). Panes never talk to each other
directly; they communicate through the workspace store and IPC. Each pane is
independently understandable and testable.

### 3.4 State

A light **`zustand`** store in the renderer holds the workspace model (tab list,
active workspace, each workspace's mosaic tree + per-pane configs + per-terminal
status). Privileged state (PTYs, files) stays in main; the renderer store mirrors
what it needs via IPC events.

### 3.5 Build & tooling

`electron-vite` (HMR for renderer + bundled main), TypeScript strict throughout,
`electron-builder` for packaging, `vitest` for unit tests, Playwright-for-Electron
for smoke tests and the self-feedback loop.

## 4. Status engine (standout feature)

Modeled as a **pure state machine per terminal**, fed an event stream — making it
heavily unit-testable (feed bytes/events → assert state).

- **Parsing happens in main** as PTY bytes flow through. A parser extracts
  shell-integration markers and tracks raw output activity (timestamps, tail
  buffer).
- **States:** `Idle` (at prompt), `Busy` (command running), `NeedsInput`
  (special, below), plus a sticky `lastExit: success | failure` for idle styling.
- **Shell integration** (auto-injected at session start, per shell), emitting
  OSC 133 markers: `;A` prompt-start, `;B` command-start, `;C` pre-exec,
  `;D;<exit>` command-end.
  - PowerShell → wrap `prompt` to emit the sequences.
  - bash/zsh → `PROMPT_COMMAND` / `precmd`.
  - cmd → no clean hook → **heuristics only** (graceful degradation).
- **Heuristic fallback** when no markers seen: output activity ⇒ Busy; quiet +
  prompt-pattern tail ⇒ Idle.
- **NeedsInput** (heuristic layer — OSC 133 doesn't cover it): while `Busy`, if
  output goes quiet for *X* ms **and** the tail matches configured patterns
  (`[y/N]`, `(yes/no)`, `password:`, `? `, `Press any key`, …) ⇒ `NeedsInput`.
  Cleared when output resumes or the command ends. Patterns and quiet-threshold
  are configurable.
- **Alerting** is per-terminal config: which transitions fire which channels —
  pane border state (calm / pulsing-busy / flashing-needs-input), workspace-tab
  badge, and OS notification (only when the window is unfocused). A terminal can
  opt out entirely.

## 5. Persistence

- **Location:** Electron `userData/`. One file per workspace
  (`workspaces/<id>.json`) plus `app-state.json` (open tabs, active workspace,
  window bounds/maximized).
- **Workspace schema** captures everything needed to faithfully rebuild: name,
  mosaic layout tree, and per-pane config — for terminals: shell, cwd, theme,
  font, display name, alert settings, and *optionally* a snapshot of last
  on-screen text (reference only). Versioned with `schemaVersion` for migration.
- **Reload** rebuilds layout + styling and spawns **fresh** PTYs (no process
  resurrection, per spec). Survives app restart.

## 6. Editor & explorer (Phase 3)

- **Editor:** Monaco; main does fs read/write; dirty tracking; handles large
  files (Monaco-native, stream read where needed).
- **Explorer:** directory tree; main watches dirs (chokidar / native `fs.watch`)
  and emits change events to renderer; open-file opens an editor pane.

## 7. Testing & verification

- **Unit (vitest, TDD):** high-value pure logic written test-first — status state
  machine, OSC-133 marker parser, needs-input heuristic, layout-tree ops,
  workspace serialize/deserialize/migrate.
- **Self-feedback (Playwright-for-Electron):** after each increment, launch the
  app, drive real interactions (type into a terminal, split a pane, save/reload a
  workspace), screenshot, and read console/DOM to confirm it works — the
  developer's own loop before user review.
- **Manual smoke:** real shells where automated coverage is thin.

## 8. Phase plan

- **Phase 1 — Terminal workspace (the slice):** app shell, `react-mosaic` tiling
  (split h/v, resize, close), workspace tab strip, multiple terminals across the
  common Windows shells, save/restore workspaces, window-state memory.
  *Shippable.*
- **Phase 2 — Status & alert engine:** shell-integration injectors, marker parser,
  state machine, heuristic + needs-input layer, per-terminal alert config, OS
  notifications.
- **Phase 3 — Editor & explorer panes:** Monaco editor (open/edit/save, large
  files), explorer tree with live filesystem watching, open-from-explorer.

## 9. Non-goals (initial scope)

- Not a full IDE (no debugger, language servers, or extension marketplace).
- Windows-first; not cross-platform in v1.
- No live process resurrection across reloads.
- Single user, local machine; not remote/collaborative.
