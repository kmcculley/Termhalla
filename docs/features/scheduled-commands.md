# Scheduled / Automated Terminal Commands

> Send command(s) to a terminal after a delay, once it becomes idle, or on a recurring schedule with jitter — as a command or raw keystrokes.

**Status:** Shipped · **Spec:** [design](../superpowers/specs/2026-06-15-termhalla-scheduled-commands-design.md) · **Plan:** [plan](../superpowers/plans/2026-06-15-termhalla-scheduled-commands.md)

## What it does

Each terminal tile has a `⏱` button that opens a per-terminal **Schedule** dialog. Type the command(s), choose **Keystrokes** or **Paste** and whether to append Enter, then pick a trigger:

- **After delay** — fire once after N seconds/minutes.
- **When idle** — fire once as soon as the terminal is not busy.
- **Recurring** — fire every N sec/min, with a `±` jitter window (time randomization).

The dialog also lists this terminal's active schedules with a `×` to cancel each. Schedules are runtime-only (they don't survive an app restart).

## How it works

Pure `src/shared/schedule.ts`: `toMs(value, unit)`, `nextRecurringDelay(everyMs, jitterMs, rand)` (base ± jitter, clamped ≥ 0), `scheduleLabel(trigger)`, and `schedulesWithout(schedules, removedPaneIds)`. The store holds a runtime `schedules: Record<id, ScheduledTask>` with `addSchedule`/`cancelSchedule`; `closePane`/`closeWorkspace` drop a removed pane's schedules via `schedulesWithout`. The `Scheduler` component (renders null, mounted in `App`) arms a timer per `delay`/`recurring` task (tracked in `armed`/`timers` refs; recurring re-arms itself with a fresh jittered delay and stops on cancel), and fires `idle` tasks when `statuses[paneId]` is not busy. Firing calls `api.ptyWrite({ id, data: encodeBroadcast(text, mode, enter) })` — reusing the broadcast encoding. `ScheduleDialog.tsx` is the per-terminal UI; `WorkspaceView` adds the `⏱` tile button.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/types.ts` | `ScheduleTrigger`, `ScheduledTask` |
| `src/shared/schedule.ts` | pure `toMs` / `nextRecurringDelay` / `scheduleLabel` / `schedulesWithout` |
| `src/renderer/store.ts` | `schedules` map, `addSchedule` / `cancelSchedule`, close cleanup |
| `src/renderer/components/Scheduler.tsx` | the timer driver (delay / idle / recurring) |
| `src/renderer/components/ScheduleDialog.tsx` | the per-terminal dialog |
| `src/renderer/components/WorkspaceView.tsx` | the `⏱` tile button |

## Behaviors & edge cases

- Delay/every are coerced to ≥ 1 second; jitter ≥ 0.
- A recurring task keeps firing until cancelled; the next delay is re-randomized each fire.
- An `idle` task fires once on the first not-busy observation (immediately if already idle), then auto-cancels.
- Closing a terminal or workspace cancels its schedules; app close drops all (runtime-only).
- The dialog portals to `<body>` so it covers the full window rather than being confined to (and clipped by) the mosaic tile it was opened from.

## Testing

- **Unit:** `tests/shared/schedule.test.ts` (`toMs`; `nextRecurringDelay` base/extremes/clamp; `scheduleLabel`; `schedulesWithout`).
- **e2e:** `tests/e2e/schedule.spec.ts` — schedule `echo …` with a 1s delay → the output appears in the terminal. (Recurring/idle paths are covered by the unit tests.)

## Related

- [Architecture](../architecture.md) · [Broadcast input](broadcast-input.md) (shares `encodeBroadcast`) · [Status & alerts](status-engine.md) (idle trigger)
