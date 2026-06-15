# Scheduled / Automated Terminal Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Schedule command(s) to a terminal after a delay, when it becomes idle, or recurring with jitter — sent as a command or raw keystrokes.

**Architecture:** Pure `src/shared/schedule.ts` (`toMs`, `nextRecurringDelay`, `scheduleLabel`, `schedulesWithout`) + runtime types; a store `schedules` map with `addSchedule`/`cancelSchedule` + cleanup in `closePane`/`closeWorkspace`; a `Scheduler` driver (renders null, mounted in `App`) that arms timers and fires via `ptyWrite` + `encodeBroadcast`; a per-terminal `ScheduleDialog` opened from a tile toolbar `⏱` button.

**Spec:** `docs/superpowers/specs/2026-06-15-termhalla-scheduled-commands-design.md`

---

## Task 1: Types + pure core

**Files:** Modify `src/shared/types.ts`; Create `src/shared/schedule.ts`; Test `tests/shared/schedule.test.ts`.

- [ ] **Step 1: Failing test** — `tests/shared/schedule.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { toMs, nextRecurringDelay, scheduleLabel, schedulesWithout } from '../../src/shared/schedule'
import type { ScheduledTask } from '../../src/shared/types'

describe('toMs', () => {
  it('converts sec and min', () => {
    expect(toMs(5, 'sec')).toBe(5000)
    expect(toMs(2, 'min')).toBe(120000)
  })
})

describe('nextRecurringDelay', () => {
  it('is the base with rand=0.5, and base ± jitter at the extremes, clamped >= 0', () => {
    expect(nextRecurringDelay(30000, 5000, () => 0.5)).toBe(30000)
    expect(nextRecurringDelay(30000, 5000, () => 1)).toBe(35000)
    expect(nextRecurringDelay(30000, 5000, () => 0)).toBe(25000)
    expect(nextRecurringDelay(1000, 5000, () => 0)).toBe(0) // clamped
  })
})

describe('scheduleLabel', () => {
  it('summarizes each trigger', () => {
    expect(scheduleLabel({ kind: 'delay', ms: 30000 })).toContain('30s')
    expect(scheduleLabel({ kind: 'idle' })).toMatch(/idle/i)
    expect(scheduleLabel({ kind: 'recurring', everyMs: 30000, jitterMs: 5000 })).toContain('±')
  })
})

describe('schedulesWithout', () => {
  it('drops tasks whose paneId is in the removed set', () => {
    const s: Record<string, ScheduledTask> = {
      a: { id: 'a', paneId: 'p1', text: 'x', mode: 'keys', enter: true, trigger: { kind: 'idle' }, label: '' },
      b: { id: 'b', paneId: 'p2', text: 'x', mode: 'keys', enter: true, trigger: { kind: 'idle' }, label: '' }
    }
    expect(Object.keys(schedulesWithout(s, ['p1']))).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Types** — in `src/shared/types.ts`, add:
```ts
export type ScheduleTrigger =
  | { kind: 'delay'; ms: number }
  | { kind: 'idle' }
  | { kind: 'recurring'; everyMs: number; jitterMs: number }

export interface ScheduledTask {
  id: string
  paneId: string
  text: string
  mode: 'paste' | 'keys'
  enter: boolean
  trigger: ScheduleTrigger
  label: string
}
```

- [ ] **Step 4: Implement** — `src/shared/schedule.ts`:
```ts
import type { ScheduleTrigger, ScheduledTask } from './types'

export function toMs(value: number, unit: 'sec' | 'min'): number {
  return unit === 'min' ? value * 60000 : value * 1000
}

/** Next recurring fire delay: base ± up to jitter, clamped to >= 0. */
export function nextRecurringDelay(everyMs: number, jitterMs: number, rand: () => number): number {
  return Math.max(0, Math.round(everyMs + (rand() * 2 - 1) * jitterMs))
}

function secs(ms: number): string {
  return ms % 60000 === 0 && ms >= 60000 ? `${ms / 60000}m` : `${Math.round(ms / 1000)}s`
}

export function scheduleLabel(trigger: ScheduleTrigger): string {
  if (trigger.kind === 'idle') return 'when idle'
  if (trigger.kind === 'delay') return `in ${secs(trigger.ms)}`
  return `every ${secs(trigger.everyMs)} ±${secs(trigger.jitterMs)}`
}

/** Drop any scheduled task whose paneId is in `removed`. */
export function schedulesWithout(schedules: Record<string, ScheduledTask>, removed: string[]): Record<string, ScheduledTask> {
  const set = new Set(removed)
  const out: Record<string, ScheduledTask> = {}
  for (const [id, t] of Object.entries(schedules)) if (!set.has(t.paneId)) out[id] = t
  return out
}
```

- [ ] **Step 5: Run, verify pass; typecheck.**
- [ ] **Step 6: Commit**
```bash
git add src/shared/types.ts src/shared/schedule.ts tests/shared/schedule.test.ts
git commit -m "feat(schedule): types + pure toMs/nextRecurringDelay/scheduleLabel/schedulesWithout"
```

---

## Task 2: Store

**Files:** Modify `src/renderer/store.ts`.

- [ ] **Step 1: Imports** — add `import { schedulesWithout } from '@shared/schedule'` and add `ScheduledTask` to the `@shared/types` import.

- [ ] **Step 2: State interface**
```ts
  schedules: Record<string, ScheduledTask>
  addSchedule: (task: Omit<ScheduledTask, 'id'>) => string
  cancelSchedule: (id: string) => void
```

- [ ] **Step 3: Initial state** — add `schedules: {},` near the other maps.

- [ ] **Step 4: Actions** — add near `closePane`:
```ts
    addSchedule: (task) => {
      const id = uuid()
      set(s => ({ schedules: { ...s.schedules, [id]: { ...task, id } } }))
      return id
    },

    cancelSchedule: (id) => set(s => {
      const schedules = { ...s.schedules }; delete schedules[id]
      return { schedules }
    }),
```

- [ ] **Step 5: Cleanup on close** — in `closePane`, inside the `set(s => {...})` updater, add `schedules: schedulesWithout(s.schedules, [paneId])` to the returned object (and include it). In `closeWorkspace`'s `set` updater, add `schedules: schedulesWithout(s.schedules, paneIds)`.

- [ ] **Step 6: Typecheck.**
- [ ] **Step 7: Commit**
```bash
git add src/renderer/store.ts
git commit -m "feat(schedule): store schedules map + add/cancel + close cleanup"
```

---

## Task 3: Scheduler driver

**Files:** Create `src/renderer/components/Scheduler.tsx`; Modify `src/renderer/App.tsx`.

- [ ] **Step 1: Create `Scheduler.tsx`**
```tsx
import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { encodeBroadcast } from '@shared/broadcast'
import { nextRecurringDelay } from '@shared/schedule'
import type { ScheduledTask } from '@shared/types'

export function Scheduler() {
  const schedules = useStore(s => s.schedules)
  const statuses = useStore(s => s.statuses)
  const cancelSchedule = useStore(s => s.cancelSchedule)
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const armed = useRef<Set<string>>(new Set())
  const schedulesRef = useRef(schedules); schedulesRef.current = schedules
  const cancelRef = useRef(cancelSchedule); cancelRef.current = cancelSchedule

  const fire = (task: ScheduledTask) => {
    api.ptyWrite({ id: task.paneId, data: encodeBroadcast(task.text, task.mode, task.enter) })
  }

  // Arm/disarm delay + recurring tasks.
  useEffect(() => {
    for (const id of [...armed.current]) {
      if (!schedules[id]) {
        const t = timers.current.get(id); if (t) clearTimeout(t)
        timers.current.delete(id); armed.current.delete(id)
      }
    }
    for (const id of Object.keys(schedules)) {
      if (armed.current.has(id)) continue
      const task = schedules[id]
      if (task.trigger.kind === 'delay') {
        armed.current.add(id)
        timers.current.set(id, setTimeout(() => { fire(task); cancelRef.current(id) }, task.trigger.ms))
      } else if (task.trigger.kind === 'recurring') {
        armed.current.add(id)
        const { everyMs, jitterMs } = task.trigger
        const reArm = () => {
          if (!schedulesRef.current[id]) return
          fire(task)
          timers.current.set(id, setTimeout(reArm, nextRecurringDelay(everyMs, jitterMs, Math.random)))
        }
        timers.current.set(id, setTimeout(reArm, nextRecurringDelay(everyMs, jitterMs, Math.random)))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules])

  // Idle tasks: fire when the target terminal is not busy.
  useEffect(() => {
    for (const id of Object.keys(schedules)) {
      const task = schedules[id]
      if (task.trigger.kind !== 'idle') continue
      if ((statuses[task.paneId]?.state ?? 'idle') !== 'busy') { fire(task); cancelSchedule(id) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, statuses])

  useEffect(() => () => {
    for (const t of timers.current.values()) clearTimeout(t)
    timers.current.clear(); armed.current.clear()
  }, [])

  return null
}
```

- [ ] **Step 2: Mount in `App.tsx`** — import `{ Scheduler }` and render `<Scheduler />` next to `<UsageWatcher />`.

- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit**
```bash
git add src/renderer/components/Scheduler.tsx src/renderer/App.tsx
git commit -m "feat(schedule): Scheduler driver (delay/idle/recurring) + mount"
```

---

## Task 4: ScheduleDialog + tile button

**Files:** Create `src/renderer/components/ScheduleDialog.tsx`; Modify `src/renderer/components/WorkspaceView.tsx`.

- [ ] **Step 1: Create `ScheduleDialog.tsx`**
```tsx
import { useState } from 'react'
import { useStore } from '../store'
import { toMs, scheduleLabel } from '@shared/schedule'
import type { ScheduleTrigger } from '@shared/types'

const numStyle = { width: 56 }

export function ScheduleDialog({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const addSchedule = useStore(s => s.addSchedule)
  const cancelSchedule = useStore(s => s.cancelSchedule)
  const schedules = useStore(s => s.schedules)
  const tasks = Object.values(schedules).filter(t => t.paneId === paneId)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<'paste' | 'keys'>('keys')
  const [enter, setEnter] = useState(true)
  const [kind, setKind] = useState<'delay' | 'idle' | 'recurring'>('delay')
  const [dV, setDV] = useState(5); const [dU, setDU] = useState<'sec' | 'min'>('sec')
  const [eV, setEV] = useState(30); const [eU, setEU] = useState<'sec' | 'min'>('sec')
  const [jV, setJV] = useState(5); const [jU, setJU] = useState<'sec' | 'min'>('sec')

  const build = (): ScheduleTrigger =>
    kind === 'idle' ? { kind: 'idle' }
      : kind === 'delay' ? { kind: 'delay', ms: Math.max(1000, toMs(dV, dU)) }
        : { kind: 'recurring', everyMs: Math.max(1000, toMs(eV, eU)), jitterMs: Math.max(0, toMs(jV, jU)) }

  const add = () => {
    const trigger = build()
    addSchedule({ paneId, text, mode, enter, trigger, label: scheduleLabel(trigger) })
    setText('')
  }

  const unit = (v: 'sec' | 'min', set: (u: 'sec' | 'min') => void, tid: string) => (
    <select data-testid={tid} value={v} onChange={e => set(e.target.value as 'sec' | 'min')}>
      <option value="sec">sec</option><option value="min">min</option>
    </select>
  )

  return (
    <div data-testid="schedule-dialog" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: '#252526', color: '#eee', border: '1px solid #444', borderRadius: 6, padding: 12, width: 480, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 600 }}>Schedule command for this terminal</div>
        <textarea data-testid="schedule-text" value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
          style={{ fontFamily: 'Consolas, monospace', fontSize: 13 }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>Send as:&nbsp;
            <select data-testid="schedule-mode" value={mode} onChange={e => setMode(e.target.value as 'paste' | 'keys')}>
              <option value="keys">Keystrokes</option><option value="paste">Paste</option>
            </select>
          </label>
          <label><input data-testid="schedule-enter" type="checkbox" checked={enter} onChange={e => setEnter(e.target.checked)} /> Send Enter</label>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select data-testid="schedule-trigger" value={kind} onChange={e => setKind(e.target.value as 'delay' | 'idle' | 'recurring')}>
            <option value="delay">After delay</option>
            <option value="idle">When idle</option>
            <option value="recurring">Recurring</option>
          </select>
          {kind === 'delay' && <>
            <input data-testid="schedule-delay-value" type="number" min={1} value={dV} onChange={e => setDV(+e.target.value)} style={numStyle} />
            {unit(dU, setDU, 'schedule-delay-unit')}
          </>}
          {kind === 'recurring' && <>
            every <input data-testid="schedule-every-value" type="number" min={1} value={eV} onChange={e => setEV(+e.target.value)} style={numStyle} />
            {unit(eU, setEU, 'schedule-every-unit')}
            ± <input data-testid="schedule-jitter-value" type="number" min={0} value={jV} onChange={e => setJV(+e.target.value)} style={numStyle} />
            {unit(jU, setJU, 'schedule-jitter-unit')}
          </>}
          <span style={{ flex: 1 }} />
          <button data-testid="schedule-add" disabled={!text.trim()} onClick={add}>Schedule</button>
        </div>
        {tasks.length > 0 && (
          <div style={{ borderTop: '1px solid #444', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {tasks.map(t => (
              <div key={t.id} data-testid={`schedule-task-${t.id}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ flex: 1, fontFamily: 'Consolas, monospace', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.label} — {t.text.split('\n')[0]}
                </span>
                <button data-testid={`schedule-cancel-${t.id}`} onClick={() => cancelSchedule(t.id)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire into `WorkspaceView.tsx`** — read it. It renders a per-tile toolbar via `toolbarControls`, with a `termCfg ? [ <proc chip> ] : []` block, and has `useState` hooks like `settingsFor`/`procsMenuFor`. Add:
  - Import: `import { ScheduleDialog } from './ScheduleDialog'`.
  - State: `const [scheduleFor, setScheduleFor] = useState<string | null>(null)`.
  - In the `termCfg ? [ ... ] : []` toolbar-controls array (next to the `proc` chip button), add a button:
```tsx
                <button key="sched" type="button" data-testid={`schedule-chip-${paneId}`} title="Schedule a command"
                  onClick={() => setScheduleFor(scheduleFor === paneId ? null : paneId)}>⏱</button>
```
  - In the tile body (where `settingsFor === paneId && ...` and `procsMenuFor === paneId && ...` are rendered), add:
```tsx
              {scheduleFor === paneId && <ScheduleDialog paneId={paneId} onClose={() => setScheduleFor(null)} />}
```

- [ ] **Step 3: Typecheck + build.**
- [ ] **Step 4: Commit**
```bash
git add src/renderer/components/ScheduleDialog.tsx src/renderer/components/WorkspaceView.tsx
git commit -m "feat(schedule): ScheduleDialog + per-terminal ⏱ button"
```

---

## Task 5: e2e (delay path)

**Files:** Create `tests/e2e/schedule.spec.ts`.

- [ ] **Step 1: Write the spec**
```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}

test('runs a delayed scheduled command in the terminal', async () => {
  test.setTimeout(60_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-sched-'))
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`]
  })
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toHaveCount(1, { timeout: 15_000 })

  // Open the schedule dialog for the only terminal.
  await win.locator('[data-testid^="schedule-chip-"]').first().click()
  await expect(win.getByTestId('schedule-dialog')).toBeVisible()
  await win.getByTestId('schedule-text').fill('echo sched-4242')
  // default trigger is "After delay"; set 1 sec
  await win.getByTestId('schedule-delay-value').fill('1')
  await win.getByTestId('schedule-add').click()

  // Within a few seconds the command fires into the terminal.
  await expect(win.locator('.xterm-rows')).toContainText('sched-4242', { timeout: 15_000 })

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build + run** — `npm run build` then `npx playwright test tests/e2e/schedule.spec.ts` → 1 passed. (Clicking `schedule-add` closes nothing; the dialog stays open, which is fine — the echo appears in the terminal behind it. If the overlay blocks reading `.xterm-rows`, `toContainText` still matches text content regardless of overlay; if needed, close the dialog by clicking the backdrop before asserting.)
- [ ] **Step 3: Commit**
```bash
git add tests/e2e/schedule.spec.ts
git commit -m "test(schedule): e2e delayed scheduled command"
```

---

## Task 6: Verify + docs

- [ ] **Step 1:** `npm run typecheck` (exit 0), `npm test`, `npm run e2e` → all green.
- [ ] **Step 2:** New `docs/features/scheduled-commands.md`; `CHANGELOG.md` `[Unreleased] → Added`.
```bash
git add docs/features/scheduled-commands.md CHANGELOG.md
git commit -m "docs: document scheduled terminal commands"
```

---

## Self-review notes
- Spec coverage: types+pure (T1), store+cleanup (T2), Scheduler driver all 3 triggers (T3), dialog+button (T4), e2e delay (T5), docs (T6).
- Type consistency: `ScheduledTask`/`ScheduleTrigger`, `toMs`/`nextRecurringDelay`/`scheduleLabel`/`schedulesWithout` consistent across schedule.ts/store/Scheduler/dialog/tests.
- Runtime-only (no persistence); recurring uses `Math.random` (app code, allowed); close-cleanup via `schedulesWithout` in both `closePane` and `closeWorkspace`. Non-goals respected.
