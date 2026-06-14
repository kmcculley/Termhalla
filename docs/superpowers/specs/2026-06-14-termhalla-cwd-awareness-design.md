# Termhalla — CWD Awareness + Explorer-to-cwd — Design Spec

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete; next step: implementation plan)
**Builds on:** Phases 1–3 (terminal workspace, status engine, editor/explorer), all merged to `main`.

## 1. Summary

Track each terminal's **live current working directory**, persist it, and use it to:
1. **Open Explorer here** — spin up Termhalla's in-app file-explorer pane rooted at the terminal's cwd.
2. **Reveal in File Explorer** — open the OS's Windows Explorer at the cwd.
3. **Restore** each terminal at its last directory when a workspace reopens (closes a Phase-1 deferral).
4. **Inherit cwd** when a new pane is opened from an existing one.

This is the first sub-project of the post-launch feature set; it is the foundational "cwd awareness" layer that later features (working-directory favorites/recents) will build on.

## 2. Decisions (from brainstorming, 2026-06-14)

| Decision | Choice |
|---|---|
| cwd detection | Emit a cwd report from the shell-integration scripts; parse it in main (same pattern as OSC 133 status). **Integration-only** (PowerShell + bash); cmd keeps its spawn cwd. |
| "Open explorer to cwd" | **Both** — an in-app explorer pane rooted at the cwd, AND a "Reveal in File Explorer" that opens the OS explorer. |
| cwd usage scope | Explorer actions **+ restore at last directory + inherit cwd on new panes**. |

## 3. Tracking the live cwd

**Mechanism.** The shell-integration scripts Termhalla already injects (`termhalla.ps1`, `termhalla.sh`) emit a cwd report on each prompt, alongside the existing OSC 133 markers:
- **PowerShell** (pwsh + Windows PowerShell): `OSC 9 ; 9 ; <path> ST` — the Windows/ConPTY cwd convention (no URL-encoding needed).
- **bash** (Git Bash/WSL): `OSC 7` → `\x1b]7;file://<host>/<path>\x07` — the standard form; the path is URL-encoded.

**Parser.** A new pure `cwd-parser` in `src/main/status/` (sibling to `osc133-parser`) scans output chunks for either form and returns the extracted absolute path, handling sequences split across chunks and URL-decoding the OSC 7 form. The PTY byte stream already flows through a single point (`PtyManager.onData` → `StatusEngine.feed`); cwd parsing hooks in there.

**Rationale / alternatives.** Polling each shell's process cwd via the OS works without integration but is racy and would report the shell's cwd, not the foreground process's, and is expensive on Windows — rejected. So live cwd is **integration-only**, consistent with status: pwsh/bash track live; **cmd uses its spawn cwd** (no live updates).

## 4. Where cwd lives & persistence

- A new main→renderer channel **`pty:cwd`** carries `(id, path)`. The renderer store holds a per-terminal runtime map (mirroring `statuses`), updated on each report.
- The live cwd is written into the terminal's **`TerminalConfig.cwd`**, so a saved workspace **restores each terminal at its last directory**. Writes ride the existing debounced auto-save, so per-prompt churn is bounded.
- On restore, `ptySpawn` already uses `config.cwd` (falling back to home for empty/invalid) — so restored terminals start in their last directory with no extra logic.

## 5. The two actions

Surfaced as a per-terminal pane-toolbar control (a 📁 button) and the right-click context menu:

- **Open Explorer here** → creates a **new** in-app explorer pane (Phase 3 `ExplorerPane`) rooted at the terminal's cwd, split off the terminal (`row`). Non-destructive: it does not re-root an existing explorer the user may have pointed elsewhere. Reuses `addExplorer(wsId, targetPaneId, dir, root)` with the cwd instead of the folder picker.
- **Reveal in File Explorer** → opens the OS Windows Explorer at the cwd via a new IPC handler calling Electron `shell.openPath(cwd)`.

Both are unavailable when no cwd is known (rare — a terminal always has at least its spawn cwd, which is a valid path).

## 6. Inherit-cwd on new panes

When a new pane is created **from** an existing pane, it starts in the source pane's cwd instead of home:
- Splitting a terminal → the new terminal's `cwd` = source terminal's cwd.
- Opening an editor / explorer from a pane, and open-from-explorer → root/initial dir derives from the source pane's cwd where applicable.

Implemented by threading the source pane's known cwd through the store's `addTerminal` / `addEditor` / `addExplorer` (falling back to home when unknown). The top-level "＋ pane" menu (no source pane) keeps current behavior.

## 7. Testing & verification

- **Unit (vitest, pure):** `cwd-parser` — OSC 9;9 and OSC 7 forms, split-across-chunks, OSC 7 URL-decoding, ignore unrelated OSC; store cwd→`config.cwd` persistence; inherit-cwd selection logic.
- **Main integration:** confirm the injected PowerShell/bash scripts emit a cwd report the parser accepts (validated for real by the e2e).
- **e2e (Playwright, hermetic launch):** in a PowerShell terminal, `cd` into a seeded temp subdir → assert the tracked cwd updates (a `data-cwd` attribute on the pane) → click **Open Explorer here** → assert an explorer pane appears rooted at that subdir showing its files → save + reload the workspace → assert the terminal restored at that subdir.

## 8. Non-goals (this sub-project)

- No live cwd for cmd / non-integrated shells (spawn cwd only).
- No favorites/recents UI yet (the next sub-project builds on this).
- No remote/SSH cwd handling (SSH is a later sub-project).
- No change to the "＋ pane" top-level menu's default directory.
