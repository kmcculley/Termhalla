# Terminal Session Recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Record a terminal's output to a replayable asciinema `.cast` file; per-terminal ⏺ toggle + a global "record by default" setting.

**Architecture:** Pure `src/shared/cast.ts` (header/event formatting); a main `Recorder` fed from `PtyManager.onData`; `rec:*` IPC; renderer toolbar ⏺ + a global setting in `quick.json`.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-terminal-recording-design.md`

---

## Task 1: Pure cast format

**Files:** Create `src/shared/cast.ts`; Test `tests/shared/cast.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/cast.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { castHeader, castEvent } from '../../src/shared/cast'

describe('castHeader', () => {
  it('is a v2 header with width/height/timestamp', () => {
    expect(JSON.parse(castHeader(80, 24, 1700))).toEqual({ version: 2, width: 80, height: 24, timestamp: 1700 })
  })
})
describe('castEvent', () => {
  it('is a [t, code, data] tuple with control bytes escaped', () => {
    expect(castEvent(1.5, 'o', 'hi\r\n')).toBe('[1.5,"o","hi\\r\\n"]')
    expect(JSON.parse(castEvent(2, 'r', '80x24'))).toEqual([2, 'r', '80x24'])
  })
})
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — `src/shared/cast.ts`:
```ts
/** asciinema cast v2 header line. */
export function castHeader(cols: number, rows: number, timestampSec: number): string {
  return JSON.stringify({ version: 2, width: cols, height: rows, timestamp: timestampSec })
}
/** asciinema cast v2 event line: [elapsedSec, 'o'|'r', data]. */
export function castEvent(elapsedSec: number, code: 'o' | 'r', data: string): string {
  return JSON.stringify([elapsedSec, code, data])
}
```
- [ ] **Step 4: Run, verify pass. Commit:**
```bash
git add src/shared/cast.ts tests/shared/cast.test.ts
git commit -m "feat(rec): pure asciinema cast header/event"
```

---

## Task 2: Recorder (main) + PtyManager.sizeOf

**Files:** Create `src/main/recording/recorder.ts`; Modify `src/main/pty/pty-manager.ts`; Test `tests/main/recorder.test.ts`.

- [ ] **Step 1: PtyManager.sizeOf** — in `pty-manager.ts`, next to `pidOf`, add:
```ts
  sizeOf(id: string): { cols: number; rows: number } | undefined {
    const p = this.sessions.get(id)?.proc
    return p ? { cols: p.cols, rows: p.rows } : undefined
  }
```

- [ ] **Step 2: Failing test** — `tests/main/recorder.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Recorder } from '../../src/main/recording/recorder'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'rec-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('Recorder', () => {
  it('writes a header + output event and finalizes on stop', async () => {
    const base = tmp()
    const r = new Recorder()
    const file = r.start('p1', 80, 24, base)
    expect(r.isRecording('p1')).toBe(true)
    r.data('p1', 'hello\r\n')
    const path = r.stop('p1')
    expect(path).toBe(file)
    expect(r.isRecording('p1')).toBe(false)
    await wait(50)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(JSON.parse(lines[0])).toMatchObject({ version: 2, width: 80, height: 24 })
    const ev = JSON.parse(lines[1]) as [number, string, string]
    expect(ev[1]).toBe('o'); expect(ev[2]).toBe('hello\r\n')
    expect(existsSync(join(base, 'recordings'))).toBe(true)
    void readdirSync
  })
  it('stop returns null when not recording', () => {
    expect(new Recorder().stop('nope')).toBeNull()
  })
})
```

- [ ] **Step 3: Implement** — `src/main/recording/recorder.ts`:
```ts
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { castHeader, castEvent } from '@shared/cast'

interface Rec { stream: WriteStream; start: number; file: string }

/** Records terminal output to asciinema v2 .cast files. Best-effort: write errors are swallowed. */
export class Recorder {
  private recs = new Map<string, Rec>()

  start(paneId: string, cols: number, rows: number, baseDir: string): string {
    const existing = this.recs.get(paneId)
    if (existing) return existing.file
    const dir = join(baseDir, 'recordings')
    try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    const startMs = Date.now()
    const file = join(dir, `${paneId}-${startMs}.cast`)
    const stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', () => { /* best-effort */ })
    stream.write(castHeader(cols, rows, Math.floor(startMs / 1000)) + '\n')
    this.recs.set(paneId, { stream, start: startMs, file })
    return file
  }
  private elapsed(r: Rec): number { return (Date.now() - r.start) / 1000 }
  data(paneId: string, chunk: string): void {
    const r = this.recs.get(paneId); if (!r) return
    try { r.stream.write(castEvent(this.elapsed(r), 'o', chunk) + '\n') } catch { /* ignore */ }
  }
  resize(paneId: string, cols: number, rows: number): void {
    const r = this.recs.get(paneId); if (!r) return
    try { r.stream.write(castEvent(this.elapsed(r), 'r', `${cols}x${rows}`) + '\n') } catch { /* ignore */ }
  }
  stop(paneId: string): string | null {
    const r = this.recs.get(paneId); if (!r) return null
    this.recs.delete(paneId)
    try { r.stream.end() } catch { /* ignore */ }
    return r.file
  }
  isRecording(paneId: string): boolean { return this.recs.has(paneId) }
  dispose(): void { for (const id of [...this.recs.keys()]) this.stop(id) }
}
```
- [ ] **Step 4: Run tests, typecheck. Commit:**
```bash
git add src/main/recording/recorder.ts src/main/pty/pty-manager.ts tests/main/recorder.test.ts
git commit -m "feat(rec): main Recorder (asciinema cast) + PtyManager.sizeOf"
```

---

## Task 3: IPC wiring

**Files:** Modify `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register.ts`.

- [ ] **Step 1: Contract** — in `CH` (after the drafts channels): `recStart:'rec:start', recStop:'rec:stop', recState:'rec:state', recReveal:'rec:reveal'`. In `TermhallaApi`:
```ts
  recStart(id: string): void
  recStop(id: string): void
  onRecState(cb: (id: string, recording: boolean, file: string | null) => void): () => void
  recReveal(): void
```

- [ ] **Step 2: Preload** —
```ts
  recStart: (id) => ipcRenderer.send(CH.recStart, id),
  recStop: (id) => ipcRenderer.send(CH.recStop, id),
  onRecState: (cb) => { const h = (_e: unknown, id: string, recording: boolean, file: string | null) => cb(id, recording, file); ipcRenderer.on(CH.recState, h as never); return () => ipcRenderer.removeListener(CH.recState, h as never) },
  recReveal: () => ipcRenderer.send(CH.recReveal),
```

- [ ] **Step 3: register.ts** — import `Recorder`; construct `const recorder = new Recorder()`. Tap the streams:
  - In the `PtyManager` `onData` callback, add `recorder.data(id, data)`.
  - In the `onExit` callback, add `recorder.stop(id)` (finalize on process exit). Note: the `rec:state` event for an exit-driven stop isn't strictly needed, but emit it for consistency: `safeSend(CH.recState, id, false, null)`.
  - In the `ipcMain.on(CH.ptyResize, …)` handler, add `recorder.resize(a.id, a.cols, a.rows)`.
  - Add handlers:
```ts
  ipcMain.on(CH.recStart, (_e, id: string) => {
    const sz = pty.sizeOf(id) ?? { cols: 80, rows: 24 }
    const file = recorder.start(id, sz.cols, sz.rows, userDataDir())
    safeSend(CH.recState, id, true, file)
  })
  ipcMain.on(CH.recStop, (_e, id: string) => { const f = recorder.stop(id); safeSend(CH.recState, id, false, f) })
  ipcMain.on(CH.recReveal, () => { void shell.openPath(join(userDataDir(), 'recordings')) })
  win.on('closed', () => recorder.dispose())
```
  (`pty` is the `PtyManager` returned/held in `registerHandlers`; `shell`, `join`, `userDataDir` are imported — add any missing import.)

- [ ] **Step 4: Typecheck + build. Commit:**
```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(rec): rec:* IPC + recorder wiring (data/resize/exit/reveal)"
```

---

## Task 4: Store

**Files:** Modify `src/renderer/store.ts`, `src/shared/types.ts`, `src/main/persistence/quick-store.ts`.

- [ ] **Step 1: quick.recordByDefault** — add `recordByDefault?: boolean` to the `QuickStore` interface (`types.ts`); in `normalizeQuick` add `recordByDefault: typeof v.recordByDefault === 'boolean' ? v.recordByDefault : false,` (leave `EMPTY_QUICK` without it or set `false`).

- [ ] **Step 2: store state** — add:
```ts
  recording: Record<string, boolean>
  setRecording: (id: string, on: boolean) => void
  setRecordByDefault: (on: boolean) => void
```
initial `recording: {}`. Actions:
```ts
    setRecording: (id, on) => set(s => { const r = { ...s.recording }; if (on) r[id] = true; else delete r[id]; return { recording: r } }),
    setRecordByDefault: (on) => { set(s => ({ quick: { ...s.quick, recordByDefault: on } })); scheduleQuickSave() },
```

- [ ] **Step 3: closePane** — add `api.recStop(paneId)` alongside the existing `api.ptyKill(paneId)` / `api.usageUnwatch(paneId)`.

- [ ] **Step 4: Typecheck. Commit:**
```bash
git add src/renderer/store.ts src/shared/types.ts src/main/persistence/quick-store.ts
git commit -m "feat(rec): store recording state + recordByDefault setting"
```

---

## Task 5: UI

**Files:** Modify `src/renderer/components/WorkspaceView.tsx`, `TerminalPane.tsx`, `TerminalSettings.tsx`, `App.tsx`.

- [ ] **Step 1: App rec:state subscription** — add an effect mirroring the others:
```tsx
  useEffect(() => { const off = api.onRecState((id, on) => useStore.getState().setRecording(id, on)); return off }, [])
```

- [ ] **Step 2: WorkspaceView ⏺ button** — read it; it builds the terminal toolbar (`termCfg ? [...]`). Add (next to the schedule/theme buttons) a record toggle. Read `const recording = useStore(s => s.recording)` at the top. In the `termCfg ? [...]` array:
```tsx
                <button key="rec" type="button" data-testid={`rec-${paneId}`} title={recording[paneId] ? 'Stop recording' : 'Record session'}
                  style={{ color: recording[paneId] ? '#e53935' : undefined }}
                  onClick={() => recording[paneId] ? api.recStop(paneId) : api.recStart(paneId)}>⏺</button>
```

- [ ] **Step 3: TerminalPane auto-record** — after the successful `api.ptySpawn(...)` in the create effect, add:
```ts
    if (useStore.getState().quick.recordByDefault) api.recStart(paneId)
```
(`useStore` is imported from the theming work; `api` already imported.)

- [ ] **Step 4: TerminalSettings global toggle** — read `TerminalSettings.tsx`. Add a global checkbox + folder button (it already renders per-terminal toggles; append):
```tsx
      <label style={{ display: 'block', marginTop: 6 }}>
        <input data-testid="rec-default" type="checkbox"
          checked={!!useStore.getState().quick.recordByDefault}
          onChange={e => useStore.getState().setRecordByDefault(e.target.checked)} /> Record new terminals by default
      </label>
      <button data-testid="rec-folder" onClick={() => api.recReveal()}>Open recordings folder</button>
```
(Subscribe reactively if the component already uses `useStore`; otherwise the `getState()` read is fine since the checkbox reflects on toggle. If `TerminalSettings` doesn't import `useStore`/`api`, add them. Prefer a reactive `const recordByDefault = useStore(s => s.quick.recordByDefault)` for the `checked` value.)

- [ ] **Step 5: Typecheck + build. Commit:**
```bash
git add src/renderer/components/WorkspaceView.tsx src/renderer/components/TerminalPane.tsx src/renderer/components/TerminalSettings.tsx src/renderer/App.tsx
git commit -m "feat(rec): record toolbar toggle, auto-record default, settings folder"
```

---

## Task 6: e2e + verify + docs

- [ ] **Step 1: e2e** — `tests/e2e/recording.spec.ts`: launch with a temp `--user-data-dir`; add a terminal; click `rec-<paneId>` (locate via `[data-testid^="rec-"]`); type `echo rec-7788` + Enter; wait; click the same button to stop; then assert (via the test's `fs`) that a `.cast` file exists in `<userData>/recordings/` whose contents include `rec-7788`. (Use `expect.poll` reading the dir.)
- [ ] **Step 2: Full gate** — `npm run typecheck`, `npm test`, `npm run e2e` → green.
- [ ] **Step 3: Docs** — `docs/features/terminal-recording.md`; `CHANGELOG.md`. Commit.

---

## Self-review notes
- Spec coverage: cast (T1), Recorder+size (T2), IPC (T3), store (T4), UI (T5), e2e (T6).
- Output-only (no keystroke capture); best-effort writes; stop on toggle/close/exit; recordByDefault in quick.json.
