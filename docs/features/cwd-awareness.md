# CWD Awareness

> Track each terminal's live working directory, persist it for restore, inherit it on splits, and open the OS/in-app file explorer there.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-14-termhalla-cwd-awareness-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-14-termhalla-cwd-awareness.md)

## What it does

Each integrated shell reports its current directory on every prompt. Termhalla parses that report, surfaces it per-terminal, and uses it to:

- Show a 📁 folder menu with **Open Explorer here** (a new in-app explorer pane rooted at the cwd) and **Reveal in File Explorer** (the OS Windows Explorer).
- **Restore** each terminal at its last directory when a saved workspace reopens (closes a Phase-1 deferral).
- **Inherit** the source pane's cwd when a new pane is split off it.
- Feed the live cwd into the recent-directories quick list.

Detection is **integration-only**: PowerShell (pwsh + Windows PowerShell) and bash (Git Bash / WSL) track live; **cmd has no live cwd** and uses its spawn directory only.

## How it works

**Shell scripts emit the report.** `integration-scripts.ts` injects per-shell prompt hooks alongside the existing OSC 133 status markers:

- PowerShell `POWERSHELL_INTEGRATION` — the wrapped `prompt` function writes `ESC ]9;9;<path> BEL`, using `$pwd.ProviderPath` (the real filesystem path, correct even on PSDrives). This is the Windows/ConPTY convention; no URL-encoding.
- bash `BASH_INTEGRATION` — `__th_prompt` writes `ESC ]7;file://<host><PWD> BEL`. Git Bash `$PWD` is `/c/dev/...`; WSL is `/home/...` or `/mnt/c/...`.

**Parsing in main.** `cwd-parser.ts:CwdParser` is a pure stateful scanner that buffers PTY chunks and returns the most recent reported cwd (or `null`), handling reports split across chunks and ignoring unrelated OSC sequences. `parseOsc` reads the OSC number: `9` + `9;` prefix yields the raw Windows path (the primary path); `7` is routed through `fileUrlToWindows`, which strips `file://host`, runs a **guarded `decodeURIComponent`** (try/catch falling back to the raw string so a literal `%` cannot crash it), then normalizes DOS (`/C:/...`), WSL mount (`/mnt/c/...`), and msys (`/c/...`) forms to `C:\...`. Pure-Linux paths are left as-is.

**Channel to the renderer.** The PTY byte stream already flows `PtyManager.onData → StatusEngine.feed`. `status-engine.ts` holds a per-session `CwdParser` + `lastCwd`; in `feed` it calls `cwdParser.push(data)` and, when the cwd is non-empty and changed, fires the `onCwd(id, cwd)` callback (deduped). Main wires that callback to `safeSend(CH.ptyCwd, id, cwd)`, delivering on the `pty:cwd` channel (`ipc-contract.ts`). The renderer subscribes via `api.onPtyCwd` and calls `store.ts:setCwd`.

**Store + persistence.** `store.ts` holds a runtime `cwds: Record<string, string>` map (mirroring `statuses`). `setCwd` updates the map, refreshes `quick.recentDirs`, and schedules the debounced autosave. `saveAll` folds the live map into each workspace via `applyCwds`, which writes the live cwd into each terminal pane's `TerminalConfig.cwd`. On reload, `ptySpawn` already starts from `config.cwd` (falling back to home for empty/invalid), so terminals **restore at their last directory** with no extra logic. `paneCwd(state, paneId)` resolves the effective cwd (live map first, then persisted `config.cwd`).

**Renderer menu.** `WorkspaceView.tsx` `renderTile` computes `cwd` (live map, falling back to `config.cwd`) and stamps it onto the tile as `data-cwd`. The 📁 toolbar button toggles a `cwd-menu`: **Open Explorer here** calls `store.openExplorerHere(wsId, paneId)`, which reuses `addExplorer(wsId, paneId, 'row', root)` to split a new explorer pane rooted at the cwd; **Reveal in File Explorer** calls `api.revealPath(cwd)`, handled in main by `shell.openPath`. Both buttons are disabled when no cwd is known.

**Split-inherit.** `addTerminal` derives the new terminal's `cwd` from `paneCwd(get(), targetPaneId)` when split off an existing pane (empty for the top-level "＋ pane" path), so a split starts in the source terminal's directory.

## Key files

| File | Responsibility |
|---|---|
| `src/main/status/cwd-parser.ts` | `CwdParser` — pure OSC 9;9 / OSC 7 scanner → Windows path; guarded `decodeURIComponent` |
| `src/main/status/integration-scripts.ts` | Injects the per-prompt cwd reports (ps1 OSC 9;9, sh OSC 7) |
| `src/main/status/status-engine.ts` | Per-session `CwdParser`; deduped `onCwd` emission in `feed` |
| `src/shared/ipc-contract.ts` | `CH.ptyCwd` (`pty:cwd`), `CH.revealPath` (`shell:reveal`); `onPtyCwd` / `revealPath` API |
| `src/main/ipc/register.ts` | Wires `onCwd → safeSend(ptyCwd)`; `shell.openPath` reveal handler |
| `src/renderer/store.ts` | `cwds` map, `setCwd`, `applyCwds`/`paneCwd`, `openExplorerHere`, split-inherit in `addTerminal` |
| `src/renderer/components/WorkspaceView.tsx` | 📁 menu (Open Explorer here / Reveal), `data-cwd` tile attribute |
| `src/renderer/App.tsx` | Subscribes `onPtyCwd → setCwd` |

## Behaviors & edge cases

- **bash decode fallback** — OSC 7 paths run through a try/catch `decodeURIComponent`; a literal `%` that isn't a valid percent-escape falls back to the raw path instead of throwing (regression-tested).
- **Raw vs. encoded bash path** — the spec calls the OSC 7 path "URL-encoded", but `termhalla.sh` actually emits raw `$PWD`. The guarded decoder handles both, so behavior is correct either way.
- **cmd = spawn cwd only** — cmd has no integration script, so no live updates; the 📁 menu still targets its spawn directory (a valid path). Consistent with the status engine.
- **Split inherit** — terminals split from a pane start in that pane's cwd; the top-level "＋ pane" menu keeps the default (home) directory.
- **Pure-Linux WSL cwds** — paths like `/home/...` are left untranslated; Windows Explorer can't open them, so Reveal fails gracefully (known limitation).
- **Cleanup parity** — `closePane` deletes the pane's entry from `cwds` (and `statuses`, `procs`, etc.), so the runtime maps don't leak. (The follow-ups doc flagged this as parity work; it is addressed in the shipped `closePane`.)
- **Deferred** — an OSC 7 path containing a literal `;` mis-parses because the parser splits the OSC body on the first `;`. Bash-only and rare on Windows; OSC 9;9 (the primary PowerShell path) is immune. Deferred per the follow-ups doc.

## Testing

- **`tests/main/cwd-parser.test.ts`** (vitest, pure) — verified present. Covers OSC 9;9 Windows paths, OSC 7 DOS / msys (`/c/`) / WSL mount (`/mnt/c/`) forms, `%20` space decoding, latest-of-several-in-one-chunk, split-across-chunks buffering, ignoring unrelated OSC (title, OSC 133), plain output → `null`, and the literal-`%` no-throw regression.
- **`tests/main/status-engine.test.ts`** — verified present. Includes `emits cwd changes (deduped) from OSC 9;9 reports`, asserting no emit on plain output and on an unchanged cwd, and one emit per distinct directory.
- **`tests/e2e/cwd.spec.ts`** (Playwright, hermetic launch) — verified present. `Set-Location` into a seeded temp subdir → asserts the tile's `data-cwd` updates → clicks **Open Explorer here** and asserts the explorer pane shows the seeded marker file → saves and relaunches → asserts the terminal **restored** at the subdir. (e2e covers PowerShell; bash live-cwd has unit coverage only.)

## Related

- Architecture overview: [../architecture.md](../architecture.md)
- Decision log: [../decisions.md](../decisions.md)
- Sibling features: [status-engine.md](status-engine.md) · [editor-explorer.md](editor-explorer.md) · [ssh-favorites.md](ssh-favorites.md)
