# Orky status awareness

A read-only mirror of an Orky (the gated `spec → plan → tests → implement → review → doc-sync →
human-review` pipeline this repo is adopted into; see `.orky/`) run, surfaced in the pane chrome.
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

## Status model (gate-based full roll-up)

Detection is derived from **gates**, never from the lagging `state.json.phase` string (the real
pipeline leaves `state.json.phase` at `doc-sync` and records `human-review` only as an external gate):

- **live phase** — for the **active** feature (named in `active.json.feature`) the live phase is
  `active.json.phase`; for any **non-active** feature it is the **gate frontier** (`gateFrontier`), the
  phase immediately after the highest passed canonical gate. The lagging `state.json.phase` is a
  last-resort fallback only.
- **needs a human** when every autonomous gate through `doc-sync` has passed and `human-review` has
  **not** (awaiting-human, derived from gates so it works for any feature), OR there is an open
  escalation, OR the active feature is *stalled* (a live executing phase with no heartbeat for > 120s).
  A generic auto-passed gate boundary does **not** count; `human-review` gate passed ⇒ **done**.
- a **non-active** feature has no per-project heartbeat (one heartbeat lives in `active.json`), so it is
  **never `busy`** — only `idle` / `needs-input` / `done`.
- **gate failure** (the live phase's gate entry is `passed: false`) is a separate flag from
  needs-human: it surfaces as a **rendered** failure treatment on the border (a `term-failure` accent
  that wins over the idle toolbar background) plus a non-color chip marker (`data-failed`), not as a
  needs-input prompt. Both flags may be true at once.
- The single chip feature is chosen by a deterministic, order-independent selector: needs-human first,
  then a stable reason order `escalation > stalled > human-review`, then most-recent activity (sourced
  from each feature's own `gates[*].at`, parsed timezone-safely), then feature-id ascending.
- The detail popover lists only **busy / needs-input / failed / done-WITH-open-items** features; a clean
  `done` feature (0 open blocking items) and `idle` features are excluded, so the popover never
  accumulates every merged feature as a wall of stale "done" rows.

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

`OrkyTracker` is a structural clone of `UsageTracker`: the session-identity race pattern (claim the
per-pane slot before the first `await`, re-check after every `await` so a concurrent watch/unwatch
supersedes cleanly), an `unwatch` early-return for an unknown pane, a `dispose()` that closes all
watchers + clears all timers (so it never keeps the Electron main process alive), and warn-on-read-failure
diagnostics. It shares **one chokidar watcher + one debounced re-read per resolved `.orky/` root**,
fanning the computed status out to every pane bound to that root (never one watcher per pane), and the
event handler filters to the target `active.json` / `state.json` / `findings.json` files before
scheduling a re-read (a routine `02-spec.md` edit fires nothing). It is **strictly read-only** — it never
writes, creates, moves, or deletes anything under `.orky/` — and reads the on-disk JSON directly
(`fs/promises`), never spawning a `node`/CLI process per poll.

The read path is **bounded** (security): at most **200** feature directories per re-read (a stated cap,
warned on), `state.json` / `findings.json` above **1 MiB** are skipped via a `stat` size check before
reading, and a `features/<slug>` symlink is skipped (not followed outside the root). The IPC boundary
validates its args (a non-string `id`/`cwd` is a no-op, never an unhandled rejection) and each
`orky:watch` / `orky:unwatch` is scoped to its owning `BrowserWindow`. It tolerates missing / empty /
malformed state without throwing: an unreadable feature is skipped and the rest still report.

The `.orky/` discovery is a deterministic, bounded upward walk (`findOrkyRoot`, default cap 8 ancestors)
from the pane's tracked cwd — it never climbs to the filesystem root unbounded, and a non-string cwd
degrades to `null` rather than throwing. When the cwd has no `.orky/` ancestor (or the pane closes), the
tracker emits a cleared `orky:status` (`null`) and the renderer reverts the border/chip to the pure
byte-derived status.

## Cross-project registry (feature 0005)

Feature 0005 **generalizes** the single-root, pane-scoped watcher above to a **set of roots** rolled up
into one pane-independent, cross-project aggregate. It introduces no renderer UI (D1) — it is IPC/data
only; a later feature (F6) is the first consumer.

- **`OrkyRootEngine`** (`src/main/orky/orky-root-engine.ts`) is the per-root watch/read machinery
  *extracted* from 0004's `OrkyTracker` (a pure, behavior-preserving refactor — `OrkyTracker`'s own public
  API and emitted `orky:status` payloads are unchanged). It generalizes "consumer = a pane" to "consumer =
  an opaque string id" (`pane:<id>` / `persisted:<root>`) and exposes a multi-subscriber
  `onStatus(cb): unsubscribe`, so it can be SHARED by two independent consumers — the pane-facing
  `OrkyTracker` facade and the new `OrkyRegistry` — constructed ONCE by the composition root
  (`services.ts`). A root tracked by N panes AND the persisted explicit list below still gets exactly
  **one** chokidar watcher + one debounced re-read process-wide; this is engine-wide now, not merely
  per-`OrkyTracker`-instance.
- **`OrkyRegistry`** (`src/main/orky/orky-registry.ts`) is the cross-project aggregator. Its membership is
  the **union** of (a) every currently-open pane's resolved `.orky/` root (ephemeral — fed by the SAME
  `OrkyTracker.watch()`/`unwatch()` resolution via `registerOrky`'s `onPaneRoot` hook, not a duplicate
  `findOrkyRoot` walk) and (b) a **persisted explicit list** (manual — only changed by `registry:addRoot`
  / `registry:removeRoot`, never auto-populated from opening a pane), deduplicated by resolved
  project-root path. A root in both sources carries `source:'both'`; pane-only → `'pane'`;
  persisted-only → `'persisted'`. Each entry's `status` reuses the EXACT SAME `OrkyPaneStatus` roll-up
  0004 already computes (`@shared/orky-status`'s mappers, called once per resolved root by the shared
  engine) — no forked/parallel status type.
- **IPC (`registry` domain)** — `registry:status` (main → renderer, APP-GLOBAL broadcast of the
  **complete** current `OrkyRegistrySnapshot` on every membership/status change, never a diff),
  `registry:current` (pull the current snapshot), `registry:roots` (pull the persisted list only),
  `registry:addRoot` / `registry:removeRoot` (mutate the persisted list; validated, idempotent, never
  throw). See `src/shared/ipc-contract.ts`.
- **Persistence** — a new, self-versioned `orky-registry.json` under Electron `userData`
  (`src/main/persistence/orky-registry-store.ts`), shape `{ version: 1, roots: string[] }`, normalized on
  load/write and written via the shared `atomicWrite` helper (temp-then-rename). Its `version` is
  independent of the app-wide `SCHEMA_VERSION` — this file is not part of the workspace/app-state
  migration chain.
- **Security** — `registry:addRoot` validates its argument (`src/main/orky/validate-root.ts`): a
  non-string, a path that does not resolve, or a directory without a `.orky/` subdirectory is rejected
  with a specific, actionable error (never a throw); the resolved root is confined by `path.resolve`'s own
  `..`-collapsing. The per-root read-path bounds (200 feature dirs, 1 MiB file size cap) and the
  `features/<slug>` symlink guard apply to **every** tracked root, not only the first.
- **Window-aware sender validation** — `WindowManager.isKnownWindowSender` (built on the existing private
  `windowIdOf`) replaces 0004's "exactly one owning window" check in `registerOrky`'s IPC handlers with
  "any currently-tracked app window" — a real, narrow widening of existing security-hardening code, needed
  because pane-root membership must aggregate across **every** window (not just the one `register.ts`
  happened to pass in), while still rejecting a truly foreign/destroyed sender. All four `registry:*`
  handlers (`register-registry.ts`) gate on the SAME `isKnownWindowSender` predicate (threaded in from
  `register.ts`, mirroring the `registerOrky` call site immediately above it): an unrecognized sender gets
  `[]` from the two pure reads (`current`/`roots`) and `{ ok:false, roots:[] }` from the two mutating calls
  (`addRoot`/`removeRoot`) — never the real aggregate/list, and never a throw.

| Concern | Location |
|---|---|
| Shared per-root watch/read engine | `src/main/orky/orky-root-engine.ts` |
| Cross-project aggregator | `src/main/orky/orky-registry.ts` |
| Pure membership-merge + deterministic sort | `src/shared/orky-registry.ts` |
| Root-add validation | `src/main/orky/validate-root.ts` |
| Persisted root list (`orky-registry.json`) | `src/main/persistence/orky-registry-store.ts` |
| Registry types (`OrkyRegistryEntry`, `OrkyRegistrySnapshot`, `RegistryMutationResult`) | `src/shared/types.ts` |
| IPC channels + types | `src/shared/ipc-contract.ts` (`registry:status`, `registry:current`, `registry:roots`, `registry:addRoot`, `registry:removeRoot`) |
| IPC registrar | `src/main/ipc/register-registry.ts` |
| Window-aware sender check | `src/main/window-manager.ts` (`isKnownWindowSender`) |

## Data provenance (the `ORKY_PHASES` drift caveat)

`ORKY_PHASES = ['brainstorm','spec','plan','tests','implement','review','doc-sync','human-review']` in
`src/shared/orky-status.ts` is a **hardcoded mirror** of the EXACT recorded `state.json.gates` keys and
the gatekeeper's `DRIVER_WORK_PHASES` (its driver/work phase list). It is deliberately **NOT** Orky's
*separate* 9-entry constant literally named "Canonical phase order" — `PHASE_ORDER =
['intake','brainstorm','spec','plan','tests','implement','review','doc-sync','human']`. Two intentional
differences a future maintainer re-syncing the mirror MUST NOT undo:

- Orky's leading **`intake`** (a pre-pipeline artifact step that records **no** gate) is **excluded** —
  prepending it would wrongly make `M = 9`.
- Orky's trailing **`human`** is recorded on disk as the **`human-review`** gate key, so it is renamed to
  `human-review` here — renaming it back to `human` would zero `gateN`'s match on the recorded key.

So a re-sync MUST be against `DRIVER_WORK_PHASES` + the recorded gate keys, **not** `PHASE_ORDER`. The
tests verify only that the code matches this embedded list — they cannot detect drift from Orky's *real*
pipeline; updating `ORKY_PHASES` is a manual data-update follow-up. `human-review` is a real, final gate
and counts toward `M`.
