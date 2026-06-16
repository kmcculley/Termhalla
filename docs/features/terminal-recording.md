# Terminal Session Recording

> Record a terminal's output to a replayable asciinema `.cast` file — per-terminal, or automatically for every new terminal.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-terminal-recording-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-terminal-recording.md)

## What it does

Each terminal has a **⏺** button in its toolbar; click it to start recording (the button turns red), click again to stop. The session's output is written to a standard **asciinema cast v2** `.cast` file under `…/userData/recordings/`, replayable with `asciinema play <file>` or any asciinema web player. The per-terminal settings (⚙) popover has **"Record new terminals by default"** (auto-records every new terminal) and an **"Open recordings folder"** button.

Only terminal **output** (and resize events) are recorded — keystrokes are not, matching asciinema's default and avoiding capturing anything typed.

## How it works

Pure `src/shared/cast.ts` formats the v2 `castHeader(cols, rows, ts)` and `castEvent(t, 'o'|'r', data)` lines. The main `Recorder` (`src/main/recording/recorder.ts`) keeps one append stream per recording terminal, writing the header on `start` and timestamped `"o"` (output) / `"r"` (resize) events; it's fed from the existing `PtyManager.onData` and the resize handler in `register.ts`, and finalizes on stop / pane close / process exit / app close. `rec:start`/`rec:stop`/`rec:reveal` IPC drive it; `rec:start` reads the live size via `PtyManager.sizeOf`. The renderer tracks `recording` state (updated from the `rec:state` event) for the toolbar button; `TerminalPane` calls `recStart` after spawn when `quick.recordByDefault` is set; the global setting persists in `quick.json`.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/cast.ts` | pure asciinema v2 header/event formatting |
| `src/main/recording/recorder.ts` | `Recorder` — per-terminal `.cast` write streams |
| `src/main/pty/pty-manager.ts` | `sizeOf(id)` for the recording header |
| `src/main/ipc/register.ts` | feeds `onData`/resize/exit; `rec:*` handlers |
| `src/renderer/store.ts` | `recording` map + `recordByDefault` setting |
| `src/renderer/components/WorkspaceView.tsx` | ⏺ toolbar toggle |
| `src/renderer/components/TerminalSettings.tsx` | default toggle + open-folder |

## Behaviors & edge cases

- Best-effort writes — a recording write failure never disrupts the terminal.
- Recording stops (and the file is finalized) on the toolbar toggle, pane close, the shell process exiting, and app close.
- `recStart` on an already-recording or dead pane is a no-op; `recStop` when not recording returns null.
- The recordings directory is created lazily on first record.

## Testing

- **Unit:** `tests/shared/cast.test.ts` (header/event JSON), `tests/main/recorder.test.ts` (temp-dir: header + output event written, finalized on stop).
- **e2e:** `tests/e2e/recording.spec.ts` — record a terminal, `echo` a marker, stop, and assert a v2 `.cast` file under the app's recordings dir contains the marker.

## Non-goals

- No keystroke/input recording (output only); no in-app playback (open the `.cast` externally); no upload to asciinema.org.

## Related

- [Architecture](../architecture.md) · [Workspaces](workspaces.md)
