# Termhalla — Scheduled / Automated Terminal Commands — Design Spec

**Date:** 2026-06-15
**Status:** Approved (autonomous batch; recommended options chosen)
**Builds on:** terminals + status engine + broadcast encoding, all merged to `main`.

## 1. Summary

Schedule command(s) to be sent to a specific terminal: **after a delay** (X sec/min),
**once the terminal becomes not busy**, or **on a recurring schedule with jitter**
(time-window randomization). Each send can be a normal command or raw **keystrokes**.
Covers requested features 4b (delay / until-idle) and 5 (recurring + randomization).

## 2. Decisions (recommended)

| Decision | Choice |
|---|---|
| Where timers run | **Renderer-side** (a `Scheduler` component) — it already has the store, terminal statuses, and `api.ptyWrite`. |
| Triggers | `delay` (one-shot after ms), `idle` (one-shot when the terminal is not busy), `recurring` (repeat every `everyMs` ± `jitterMs`). |
| Send encoding | Reuse `encodeBroadcast(text, mode, enter)` from sub-project A (paste vs keystrokes, optional Enter). |
| Persistence | **Runtime-only** (schedules don't survive restart) for v1; persistence is deferred. |
| UI | A `⏱` button on each terminal tile's toolbar opens a per-terminal `ScheduleDialog` (create + list/cancel). |
| Cleanup | Closing a pane or workspace cancels that pane's schedules; app close drops all (runtime-only). |

## 3. Types

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
  label: string   // human summary for the list (e.g. "every 30s ±5s")
}
```
Runtime-only — not added to any persisted config.

## 4. Pure core (testable) — `src/shared/schedule.ts`

- `toMs(value: number, unit: 'sec' | 'min'): number` — `unit === 'min' ? value*60000 : value*1000`.
- `nextRecurringDelay(everyMs: number, jitterMs: number, rand: () => number): number` —
  `Math.max(0, Math.round(everyMs + (rand() * 2 - 1) * jitterMs))` (base ± up to jitter).
- `scheduleLabel(trigger): string` — "in 30s" / "when idle" / "every 30s ±5s" (formats ms compactly).

## 5. Store

- `schedules: Record<string, ScheduledTask>`.
- `addSchedule(task: Omit<ScheduledTask, 'id'>): string` — assign a uuid, insert, return id.
- `cancelSchedule(id: string)` — delete it.
- `closePane` and `closeWorkspace` additionally drop schedules whose `paneId` was removed
  (a pure helper `schedulesWithout(schedules, paneIds)` keeps this DRY and testable).

## 6. The Scheduler (`src/renderer/components/Scheduler.tsx`, renders null)

Mounted once in `App`. Holds `timers = useRef<Map<taskId, Timeout>>` and `armed = useRef<Set<taskId>>`.

- **Arm/disarm effect** (deps `[schedules]`): for each `delay`/`recurring` task not in `armed`, arm it
  (add to `armed`, set a timeout). For each id in `armed` no longer in `schedules`, clear its timer and
  un-arm. (Idle tasks are not timer-armed.)
  - `delay`: `setTimeout(fire(task); cancelSchedule(id))` after `trigger.ms`.
  - `recurring`: `setTimeout(() => { fire(task); reArm(task) }, nextRecurringDelay(everyMs, jitterMs, Math.random))`;
    `reArm` schedules the next fire (stays armed until cancelled).
- **Idle effect** (deps `[schedules, statuses]`): for each `idle` task whose `statuses[paneId]?.state !== 'busy'`
  (treating undefined as not-busy), `fire(task)` then `cancelSchedule(id)`. (Fires on the first not-busy
  observation; if already idle, fires promptly.)
- `fire(task)` = `api.ptyWrite({ id: task.paneId, data: encodeBroadcast(task.text, task.mode, task.enter) })`.
- Unmount: clear all timers.

## 7. UI — `ScheduleDialog.tsx` + tile toolbar button

- `WorkspaceView` adds a `⏱` button (`data-testid="schedule-chip-<paneId>"`) to each terminal tile's
  toolbar; clicking toggles a `scheduleFor` state → renders `ScheduleDialog` for that pane.
- `ScheduleDialog` (`data-testid="schedule-dialog"`):
  - `<textarea data-testid="schedule-text">` for the command(s); mode select (`schedule-mode`) + Enter
    checkbox (`schedule-enter`).
  - Trigger picker (`schedule-trigger`: `delay` | `idle` | `recurring`):
    - delay → number (`schedule-delay-value`) + unit select (`schedule-delay-unit` sec/min).
    - idle → no params.
    - recurring → every number+unit (`schedule-every-value`/`-unit`) and jitter number+unit
      (`schedule-jitter-value`/`-unit`).
  - `Schedule` (`schedule-add`) → builds the `trigger` (via `toMs`) + `label` (via `scheduleLabel`) and
    calls `addSchedule`.
  - A list of this pane's active tasks (`schedule-task-<id>`) each with its `label` and a cancel `×`
    (`schedule-cancel-<id>`).

## 8. Error handling

- Empty command text → `Schedule` disabled.
- Non-positive delay/every → coerced to a small minimum (>= 1s) in the dialog.
- A task targeting a now-closed pane: store cleanup cancels it; a stray `ptyWrite` to an unknown id is harmless.
- App close: timers are dropped (runtime-only).

## 9. Testing

- **Unit (vitest):** `toMs` (sec/min); `nextRecurringDelay` (base with rand=0.5 → everyMs; rand=0/1 → ±jitter;
  clamped ≥ 0); `scheduleLabel` (delay/idle/recurring strings); `schedulesWithout` (drops removed paneIds).
- **e2e (Playwright):** open a terminal, open its schedule dialog, set a **delay** of 1s with command
  `echo sched-4242` (Enter on), Schedule → assert the terminal's `.xterm-rows` shows `sched-4242`
  within a few seconds. (Delay path exercises arm→fire→ptyWrite; recurring/idle covered by unit tests.)

## 10. Non-goals

- No persistence of schedules across restart (deferred).
- No cron-style absolute times (relative delays/intervals only).
- No "run only when idle" gating for recurring fires (fires on schedule regardless).
- No main-process scheduler / background execution when the app is closed.
