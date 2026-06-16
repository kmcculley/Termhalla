# Termhalla — Terminal Session Recording — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** the pty layer (`PtyManager` onData) + `QuickStore` (quick.json).

## 1. Summary

Record a terminal's session (its output stream) to a replayable **asciinema v2 `.cast`**
file. Each terminal has a ⏺ toggle to start/stop; a global setting auto-records every new
terminal when enabled. Recordings are written to `userData/recordings/`.

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Format | **asciinema cast v2** — a JSON header line + `[t, "o", data]` output events (+ `"r"` resize). Replayable with `asciinema play` / web players. |
| What is captured | Terminal **output** (the PTY `onData` stream) + resize events. (Input keystrokes are not recorded — matches asciinema's default and avoids capturing typed secrets.) |
| Trigger | A per-terminal ⏺ toolbar button (red while recording); a global **"Record new terminals by default"** checkbox in the per-terminal settings (gear) popover, persisted in `quick.json`. |
| Location | `userData/recordings/<paneId>-<startMs>.cast`; "Open recordings folder" via `shell.openPath`. |
| Lifecycle | Recording stops on explicit toggle, on pane close, and on app close (file finalized). |

## 3. Pure core (testable) — `src/shared/cast.ts`

- `castHeader(cols: number, rows: number, timestampSec: number): string` — the v2 header JSON line
  (`{"version":2,"width":cols,"height":rows,"timestamp":…}`).
- `castEvent(elapsedSec: number, code: 'o' | 'r', data: string): string` — `JSON.stringify([elapsedSec, code, data])`.
  (Elapsed is seconds-with-fraction since start; the writer computes it.)

## 4. Main — `src/main/recording/recorder.ts`

`Recorder` class (one append stream per recording terminal):
- `start(paneId, cols, rows, baseDir): string` — mkdir `recordings/`, open a write stream, write
  `castHeader(...)`, record the start time; returns the file path. No-op if already recording that pane.
- `data(paneId, chunk)` — append `castEvent(elapsed, 'o', chunk)` if recording.
- `resize(paneId, cols, rows)` — append `castEvent(elapsed, 'r', `${cols}x${rows}`)`.
- `stop(paneId): string | null` — end the stream; returns the path (or null if not recording).
- `isRecording(paneId): boolean`; `dispose()` — stop all.
- Wired in `register.ts`: the existing `pty.onData` / `pty.onExit` and resize paths feed the recorder
  when active; `win.on('closed')` → `recorder.dispose()`.

## 5. IPC

- `rec:start` (renderer→main, `(paneId, cols, rows)`), `rec:stop` (`(paneId)`),
  `rec:state` (main→renderer event, `(paneId, recording: boolean, file: string | null)`),
  `rec:reveal` (`()` → open the recordings folder).
- Preload: `recStart(id, cols, rows)`, `recStop(id)`, `onRecState(cb)`, `recReveal()`.

## 6. Renderer

- Store: `recording: Record<string, boolean>` + `setRecording(id, on)`; `quick.recordByDefault?: boolean`
  with `setRecordByDefault(on)` (persisted via quick.json).
- `TerminalPane`: after a successful spawn, if `recordByDefault`, call `api.recStart(paneId, cols, rows)`.
  Resize already flows; recording resize is handled main-side off the existing resize.
- `WorkspaceView` terminal toolbar: a ⏺ button (`data-testid="rec-${paneId}"`) — red dot while recording —
  toggling `api.recStart`/`api.recStop`.
- `TerminalSettings` (gear) popover: a **"Record new terminals by default"** checkbox (global) and an
  **"Open recordings folder"** button.
- `App`: subscribe to `rec:state` → `setRecording`.
- `closePane` calls `api.recStop(paneId)` (idempotent) so closing finalizes the file.

## 7. Error handling

- A write failure is swallowed (best-effort; recording never breaks the terminal).
- `rec:start` on an unknown/dead pane is harmless; `rec:stop` when not recording → null.
- Recordings dir is created lazily.

## 8. Testing

- **Unit (vitest):** `castHeader` (valid JSON, fields) and `castEvent` (array form, escaping of control
  bytes via `JSON.stringify`); a `Recorder` temp-dir test (start writes a header, `data` appends an `"o"`
  event, `stop` finalizes — read the file back and parse the header + first event).
- **e2e (Playwright):** open a terminal, click ⏺, type `echo rec-test`, stop ⏺, then assert a `.cast`
  file exists under the app's recordings dir and contains `rec-test` (read via the test's fs, using the
  app's `--user-data-dir`).

## 9. Non-goals

- No input/keystroke recording (output only).
- No in-app playback (the `.cast` is opened/played externally).
- No upload to asciinema.org.
