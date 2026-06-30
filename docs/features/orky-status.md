# Orky status awareness

A read-only mirror of an [Orky](https://github.com/) gated-pipeline run, surfaced in the pane chrome.
When a terminal pane's tracked cwd sits inside (or under) a project that contains a `.orky/` directory,
Termhalla watches that project's `.orky/` tree and renders the run's live status on the pane — without
ever modifying it.

## What it shows

- **Toolbar Orky chip** — `feature · phase · gate N/M · ●k open`, where `feature` is the slug, `phase`
  is the current pipeline phase, `N/M` is gates-passed / total gates, and `k` is the count of open
  *blocking* findings (CRITICAL/HIGH or contract violations). The `●k open` segment is omitted at
  `k === 0`; the count is shown verbatim (never silently capped).
- **Detail popover** — clicking the chip opens a `<body>`-portalled popover (`orky-menu`) listing every
  non-idle feature, ranked most-needs-you-first, each with its phase, gate progress, open count, and an
  actionable "needs you" reason.
- **Border precedence** — for a bound Orky run, the Orky-derived status takes precedence over the
  byte-derived (OSC 133) terminal status for the pane border and the workspace tab badge. The
  byte-status computation itself is unchanged; this is a render-time composition. The complementary
  ✨ AI chip + context-% remain visible.
- **Tab badge roll-up** — a workspace tab lights its 🔔 needs-you badge if any Orky pane has a feature
  that needs a human, folded through the same `resolveAlerts(cfg.alerts).tabBadge` opt-in that gates
  terminal needs-input. The opt-in governs only the badge summary — it never hides the pane's Orky chip
  or a gate-failure border.

## Status model

- **needs a human** when the current phase is `human-review`, OR there is an open escalation, OR the
  active feature is *stalled* (an executing phase with no heartbeat for > 120s). A generic auto-passed
  gate boundary does **not** count.
- **gate failure** (a halted gate whose entry is `passed: false`) is a separate flag from needs-human:
  it surfaces as failure styling on the border, not as a needs-input prompt. Both flags may be true at
  once.
- The single chip feature is chosen by a deterministic, order-independent selector: needs-human first,
  then a stable reason order `escalation > stalled > human-review`, then most-recent activity, then
  feature-id ascending.

## Architecture

| Concern | Location |
|---|---|
| Canonical phases, gate N/M, pure status mappers (total + pure) | `src/shared/orky-status.ts` |
| Wire types (`OrkyPaneStatus`, `OrkyFeatureStatus`, `OrkyKind`) | `src/shared/types.ts` |
| Chip-status Orky variant | `src/shared/chip-status.ts` (`orkyChipStatus`) |
| IPC channel + types | `src/shared/ipc-contract.ts` (`orky:status`, `orky:watch`, `orky:unwatch`) |
| Bounded `.orky/` discovery (ancestor walk) | `src/main/orky/find-orky-root.ts` |
| Main-process watcher | `src/main/orky/orky-tracker.ts` |
| IPC registrar | `src/main/ipc/register-orky.ts` |
| Renderer watch reconciler | `src/renderer/components/OrkyWatcher.tsx` |
| Per-pane store state | `src/renderer/store/runtime-slice.ts` (`orky` / `setOrky`) |
| Toolbar chip + popover | `src/renderer/components/PaneToolbar.tsx`, `OrkyPopover.tsx`, `PaneTile.tsx` |
| Tab-badge roll-up | `src/renderer/components/tab-badge.ts` |

### The watcher

`OrkyTracker` is a structural clone of `UsageTracker`: ONE bounded, debounced chokidar watch on
`<root>/.orky/` per pane (never a watcher per feature), the session-identity race pattern (claim the
map slot before the first `await`, re-check after every `await` so a concurrent watch/unwatch supersedes
cleanly), a `dispose()` that closes all watchers + clears all timers (so it never keeps the Electron
main process alive), and warn-on-read-failure diagnostics. It is **strictly read-only** — it never
writes, creates, moves, or deletes anything under `.orky/` — and reads the on-disk JSON directly
(`fs/promises`), never spawning a `node`/CLI process per poll. It tolerates missing / empty / malformed
state without throwing: an unreadable feature is skipped and the rest still report.

The `.orky/` discovery is a deterministic, bounded upward walk (`findOrkyRoot`, default cap 8 ancestors)
from the pane's tracked cwd — it never climbs to the filesystem root unbounded. When the cwd has no
`.orky/` ancestor (or the pane closes), the tracker emits a cleared `orky:status` (`null`) and the
renderer reverts the border/chip to the pure byte-derived status.

## Data provenance (the `ORKY_PHASES` drift caveat)

`ORKY_PHASES = ['brainstorm','spec','plan','tests','implement','review','doc-sync','human-review']` in
`src/shared/orky-status.ts` is a **hardcoded mirror** of Orky's upstream pipeline phase list. The tests
verify only that the code matches this embedded list — they cannot detect drift from Orky's *real*
pipeline. If Orky changes its phases upstream, updating `ORKY_PHASES` here is a manual data-update
follow-up; no automated test will catch it. `human-review` is a real, final gate and counts toward `M`.
