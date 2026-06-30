# 0004 — Orky status awareness in the pane chrome (Tier 0 MVP)

## Phase 2 — Specification

**Status:** draft for spec gate. Concept (`01-concept.md`) is FROZEN by the brainstorm gate; this
spec turns its settled decisions into testable requirements. Do not relitigate concept decisions.

## Concerns

`ux` `quality` `performance` `determinism` `doc-drift` `data-provenance`

- `data-provenance` is included because this feature **hardcodes a canonical phase list**
  (`brainstorm → spec → plan → tests → implement → review → doc-sync → human-review`) as a constant
  claimed to match Orky's external gatekeeper pipeline definition. Per Orky's testing stance, tests
  verify that the **code matches the embedded phase list**, never that the embedded list matches
  Orky's real pipeline. If Orky's pipeline phases change upstream, that is a data-update follow-up,
  not something a test can catch here. REQ-001 is the provenance anchor.

## Baseline fit (brownfield — `.orky/baseline/` present)

This feature is **purely additive** to the existing system and supersedes **no** baseline REQ.
Specifically:

- Baseline **REQ-004** (terminal status state machine, OSC 133 + silence) and baseline **REQ-005/006**
  (needs-input / idle-fallback) are **unchanged**. The byte-derived `TerminalStatus` still computes
  exactly as before. This feature adds a **presentation-layer override**: when a pane is an Orky run,
  Orky-derived status takes precedence over the byte-derived status *for the border and tab badge*
  (REQ-014). It does not modify `StatusTracker`, `needs-input.ts`, or their CHAR tests.
- Baseline **REQ-002/003** (typed IPC contract, `safeSend`) are extended (new `orky:status` push
  channel) following the existing pattern, not changed (REQ-013).
- Baseline **REQ-024** (versioned persistence) is **unaffected**: Orky status is live runtime state,
  not persisted. `SCHEMA_VERSION` is NOT bumped (REQ-018).

No characterization test (CHAR-001..020) should need editing for this feature. If implementation finds
one does, that is a signal the change is not purely additive — stop and revisit.

---

## Public interface

### Shared pure module (new) — `src/shared/orky-status.ts` (or a pure module beside the tracker)

Total, side-effect-free functions, unit-tested under vitest with **no Electron import** and **no
`../api` import** (CLAUDE.md / baseline REQ-001 invariant):

```ts
// Canonical pipeline phase order; human-review is the final real gate and counts toward M (REQ-001).
export const ORKY_PHASES: readonly OrkyPhase[]   // 8 entries, see REQ-001

export type OrkyKind = 'busy' | 'idle' | 'needs-input' | 'done' | 'cleared'

export interface OrkyFeatureStatus {       // one entry per feature in the roll-up
  feature: string                          // slug / id
  kind: OrkyKind
  phase: OrkyPhase | null
  gateN: number                            // gates passed
  gateM: number                            // total gates (= ORKY_PHASES.length)
  openBlocking: number
  needsHuman: boolean
  failed: boolean                          // a halted gate failure (drives lastExit:'failure' styling)
  lastActivityAt: number
  detail: string                           // human-readable, actionable (CONV-001)
}

export interface OrkyPaneStatus {          // the per-pane roll-up the tracker emits
  kind: OrkyKind                           // the chip-feature's kind (terminal-status mapping)
  label: string                            // `feature · phase · gate N/M · ●k open`
  needsHuman: boolean
  failed: boolean
  features: OrkyFeatureStatus[]            // ALL non-Idle features, for the popover (REQ-021)
  chipFeature: string | null              // selectChipFeature result; null when no features
}

export function openBlockingCount(findings: OrkyFinding[]): number                 // REQ-002
export function isStalled(activeFeatureSlug: string | null, feature: OrkyFeatureRaw,
                          lastTickAt: number | null, now: number, thresholdMs: number): boolean  // REQ-003
export function orkyFeatureStatus(raw: OrkyFeatureRaw, findings: OrkyFinding[],
                                  isActive: boolean, lastTickAt: number | null,
                                  now: number, thresholdMs: number): OrkyFeatureStatus  // REQ-004/005/006
export function orkyPaneStatus(features: OrkyFeatureStatus[]): OrkyPaneStatus        // REQ-007/008/021
export function selectChipFeature(features: OrkyFeatureStatus[]): OrkyFeatureStatus | null  // REQ-007
```

### IPC (new push channel) — `src/shared/ipc-contract.ts`

```ts
CH.orkyStatus: 'orky:status'                                   // main -> renderer event
onOrkyStatus(cb: (paneId: string, status: OrkyPaneStatus | null) => void): () => void
```

`null` payload = cleared (pane is no longer an Orky run / cwd left `.orky/`) — REQ-012.

---

## Requirements

### REQ-001 — Canonical phase list and gate N/M (provenance anchor)
The system MUST define a single hardcoded canonical phase order
`['brainstorm','spec','plan','tests','implement','review','doc-sync','human-review']` as `ORKY_PHASES`.
`gateM` MUST equal `ORKY_PHASES.length` (= 8); `human-review` counts toward M (it is a real gate).
`gateN` MUST be the count of phases in `ORKY_PHASES` whose entry in `state.json.gates` has
`passed === true`. Unknown gate keys present in `state.json` but absent from `ORKY_PHASES` MUST be
ignored for the count (and MUST NOT throw).
**Acceptance:** Given a `gates` map with `{brainstorm:{passed:true}, spec:{passed:true},
plan:{passed:false}, bogus:{passed:true}}`, When `gateN`/`gateM` are computed, Then `gateN===2` and
`gateM===8`; an empty `gates` → `0/8`; an all-passed map → `8/8`.

### REQ-002 — Open-blocking findings count
`openBlockingCount(findings)` MUST return the number of findings with `status === 'open'` AND
(`severity ∈ {CRITICAL, HIGH}` OR `contract_violation === true`). It MUST be total: a non-array,
`undefined`, `[]`, or entries with missing `severity`/`status`/`contract_violation` fields MUST NOT
throw, and malformed entries count as non-blocking (CONV-002).
**Acceptance:** `openBlockingCount([{status:'open',severity:'HIGH'}, {status:'open',severity:'LOW'},
{status:'open',severity:'LOW',contract_violation:true}, {status:'resolved',severity:'CRITICAL'},
{status:'open',severity:'MEDIUM'}])===2`; `openBlockingCount([])===0`;
`openBlockingCount(undefined as any)===0`; `openBlockingCount([{}])===0`.

### REQ-003 — Stall detection: finished-wins, active-feature-only, 120s
`isStalled` MUST return `true` ONLY when ALL hold: the feature is the active feature (named in
`active.json`), it has an executing (non-finished) phase in flight, a `lastTickAt` exists, and
`now − lastTickAt > thresholdMs`. The default threshold MUST be `120_000` ms. **Finished wins:** a
feature whose `human-review` gate has passed, OR that has no active executing phase, MUST never be
stalled. A non-active feature MUST never be stalled (it has no live heartbeat). A missing/`null`
`lastTickAt` MUST yield `false`, not a throw (CONV-002).
**Acceptance:** active + executing + `now-lastTickAt = 121_000` → `true`; same at `119_000` → `false`;
active but `human-review` passed → `false` regardless of tick age; non-active feature with any tick age
→ `false`; `lastTickAt = null` → `false`.

### REQ-004 — Per-feature status mapping into the terminal-status model
`orkyFeatureStatus(...)` MUST be a total pure map producing an `OrkyFeatureStatus` whose `kind` maps to
the existing terminal-status model as: an executing phase in flight → `busy`; `needsHuman` (REQ-005) →
`needs-input`; `human-review` passed / pipeline complete → `done`; otherwise (a known last-gate state,
not executing, not needing a human) → `idle`. The `detail` string MUST be specific and actionable
(CONV-001): it MUST name the feature and the reason (e.g. `"auth-feature: open escalation ESC-3
(reason) — needs you"`, `"auth-feature: stalled 3m — no heartbeat since 12:04"`), never a bare
`"needs input"`.
**Acceptance:** a fixture feature mid-`implement` with a live recent tick → `kind:'busy'`,
`needsHuman:false`; a feature in `human-review` phase → `kind:'needs-input'`, `needsHuman:true`,
`detail` contains the feature slug and `"human-review"`; a feature with `human-review` passed →
`kind:'done'`, `needsHuman:false`.

### REQ-005 — "Needs a human" set
`needsHuman` MUST be `true` for a feature iff ANY of: (a) its current phase is `human-review`; (b) it
has at least one escalation with `status === 'open'` (i.e. unresolved); (c) it is stalled per REQ-003.
A generic gate boundary MUST NOT set `needsHuman` (full-auto auto-passes gates). A gate **failure**
(REQ-006) MUST NOT, by itself, set `needsHuman`.
**Acceptance:** `human-review` phase → `true`; an open escalation while mid-`implement` → `true`;
stalled active feature → `true`; a feature sitting `idle` between two passed gates with no open
escalation and no stall → `false`; a feature whose last gate **failed** but has no open escalation and
is not in human-review → `needsHuman:false` (it surfaces via REQ-006 instead).

### REQ-006 — Gate failure surfaces as failure styling, separate from needs-human
A halted gate **failure** MUST set `OrkyFeatureStatus.failed = true` and MUST propagate to the pane's
rendered status as the existing `lastExit: 'failure'` styling (border treatment), NOT as
`needsHuman`/`needs-input`. `failed` and `needsHuman` are independent flags and MAY both be true (e.g.
a failure that also opened an escalation).
**Acceptance:** a feature whose latest gate attempt failed (and no open escalation, not human-review)
→ `failed:true`, `needsHuman:false`; the rendered pane status carries `lastExit:'failure'`. A clean
feature → `failed:false`.

### REQ-007 — Deterministic single-chip selector
`selectChipFeature(features)` MUST be a pure, total function returning the most-needs-you feature by
this exact ordering: (1) `needsHuman === true` ranks above `false`; (2) within equal `needsHuman`, a
stable reason order `escalation > stalled > human-review`; (3) then most-recent `lastActivityAt`
(newer first); (4) then `feature` id ascending as the final, fully-deterministic tiebreak. Empty input
MUST return `null`. The function MUST NOT depend on input array order (sorting input in any permutation
yields the same winner).
**Acceptance:** given features A (needsHuman via human-review, activity t=10), B (needsHuman via open
escalation, activity t=5), C (idle, activity t=20): winner is **B** (escalation outranks human-review
despite older activity); reversing/ shuffling the input array yields **B** every time; two features
identical on (1)-(3) are broken by id ascending; `selectChipFeature([])===null`.

### REQ-008 — Chip label format
The toolbar Orky chip label MUST render as `feature · phase · gate N/M · ●k open` for the selected
chip feature, where `feature` is the slug, `phase` is the current phase, `N/M` per REQ-001, and `k` is
`openBlockingCount`. The `●k open` segment MUST show the real count with no silent capping (CONV-003);
when `k === 0` the `●k open` segment MAY be omitted but MUST NOT show a wrong/truncated number.
**Acceptance:** a feature `auth` in phase `implement` with `5/8` gates and 2 open-blocking findings →
label `"auth · implement · 5/8 · ●2 open"`; with 0 open findings → label has no `●` count or shows
`●0 open` (chosen rendering is asserted, not silently dropped when >0).

### REQ-009 — Workspace tab-badge roll-up
A workspace tab MUST light its needs-you badge (🔔) if ANY feature in ANY Orky pane in that workspace
has `needsHuman === true`, aggregated through the existing `tab-badge.ts` path and contributing the
same way a terminal `needs-input` pane does. This contribution MUST be gated by the same
`resolveAlerts(cfg.alerts).tabBadge` opt-in that gates terminal needs-input (REQ-016). A pane that is
not an Orky run contributes nothing here.
**Acceptance:** a workspace with one Orky pane whose roll-up has a `needsHuman` feature (badge opt-in
on) → tab badge shows the needs indicator; with the opt-in off → no Orky contribution; an Orky pane
with only `idle`/`busy`/`done` features → no 🔔 from Orky.

### REQ-010 — Chip-status model extended for the Orky variant
The 0003 `chip-status.ts` model MUST be extended (additively) so the toolbar chip AND the
minimized-tray chip can render an Orky run's state, WITHOUT changing the existing `ChipStatus`
behavior for non-Orky panes (the existing `chipStatus(...)` mapping for `exited`/`needs-input`/etc.
MUST be unchanged — its tests stay green).
**Acceptance:** existing `chip-status` tests pass unchanged; a new test asserts the Orky variant
renders the Orky kind for an Orky pane; a non-Orky pane is unaffected.

### REQ-011 — OrkyTracker: bounded, debounced, race-safe, disposable watcher
A new main-process `src/main/orky/orky-tracker.ts` MUST watch `<cwd>/.orky/` (covering `active.json`
and `features/*/state.json` + `findings.json`) via chokidar with a **debounce** (coalesced re-read),
cloning the `UsageTracker` **session-identity race pattern**: claim the session map slot BEFORE the
first `await`, and re-check `sessions.get(id) === sess` after every `await` so a concurrent
watch/unwatch supersedes cleanly. The number of chokidar watchers MUST be bounded per pane (a single
debounced watch on `<cwd>/.orky/`, not an unbounded per-feature watcher set). The tracker MUST be
disposable (`dispose()` closes all watchers + clears timers) and MUST NOT keep the Electron main
process alive (watchers closed on teardown; no lingering timers) — CLAUDE.md long-lived-watcher gotcha.
**Acceptance (e2e/integration harness):** after `unwatch`/`dispose`, the tracker holds zero open
watchers and zero pending timers; a watch immediately followed by unwatch for the same paneId leaves
no orphaned session (re-check-after-await guard exercised); the app `close()`s without hanging.

### REQ-012 — Auto-bind on `.orky/` cwd; clean teardown emits cleared status
When a pane's tracked cwd (OSC 7 / OSC 9;9) enters a directory whose tree contains `.orky/`, the
tracker MUST start watching and emit `orky:status` with a populated `OrkyPaneStatus`. When the pane's
cwd leaves the `.orky/` project (or the pane closes), the tracker MUST stop watching and emit a
**cleared** status (`orky:status` with `null`), and the renderer MUST revert the pane's border/chip to
the pure byte-derived status. No manual linking or per-workspace config is required.
**Acceptance (e2e, synthetic `.orky/` fixture):** Given a pane whose cwd is a fixtured Orky project,
When the tracker binds, Then the Orky chip/border appear; When the cwd changes to a non-Orky dir, Then
an `orky:status(null)` is emitted and the border/chip revert to byte-status.

### REQ-013 — IPC wiring follows the existing contract pattern
The feature MUST add an `orky:status` main→renderer push channel to `src/shared/ipc-contract.ts`
(`CH.orkyStatus`) with an `onOrkyStatus` subscription returning an unsubscribe function, carry the new
`OrkyPaneStatus`/`OrkyFeatureStatus` types in `src/shared/types.ts` (or `src/shared/orky-status.ts`),
emit via `safeSend` from a per-domain `src/main/ipc/register-*.ts`, expose it through
`src/renderer/api.ts`, subscribe it in `App.tsx`, and hold per-pane status in
`src/renderer/store/runtime-slice.ts`. No other `window` bridge may be introduced (baseline REQ-002).
**Acceptance:** the channel name is `orky:status`; a push dispatched after a window is destroyed is a
no-op via `safeSend` (baseline REQ-003 preserved); the renderer receives `(paneId, status)` and stores
it per-pane.

### REQ-014 — Orky status takes precedence over byte-status for border + tab badge
For a pane that is a bound Orky run, the Orky-derived status MUST take precedence over the byte-derived
(OSC-133) `TerminalStatus` when computing the pane border (`data-status` on `.term-tile`) and the tab
badge. The byte-derived status computation itself MUST be unchanged (baseline REQ-004); precedence is a
composition-layer choice at render time. The complementary ✨ AI chip + context-% MUST remain visible
(not replaced). When the pane is not an Orky run (or status is cleared), the border/badge MUST fall
back to the byte-derived status.
**Acceptance:** a fixtured Orky pane reporting `needsHuman` shows a `needs-input` border even if the
byte status is `busy`; the ✨ chip still renders; clearing the Orky status restores the byte-derived
border.

### REQ-015 — Read files, do not spawn `node` per poll
The tracker MUST derive status by reading the on-disk JSON files (`active.json`, `state.json`,
`findings.json`) directly. It MUST NOT spawn `node` or any Orky CLI per poll/event.
**Acceptance:** code review / a test confirms no `child_process`/`execFile`/`spawn` is used in the
status read path; status is produced purely from file reads + the pure mappers.

### REQ-016 — Tab-badge opt-in respected (CONV-004 alignment)
The Orky tab-badge contribution MUST be gated by `resolveAlerts(cfg.alerts).tabBadge`, exactly like the
terminal needs-input contribution. The Orky border/chip themselves (informational status) MUST remain
visible regardless of the badge opt-in — opt-in governs only the tab-badge summary, never suppressing
the failure styling (REQ-006), consistent with CONV-004 (a feedback-suppression preference must not
hide failures).
**Acceptance:** badge opt-in off → no Orky 🔔 on the tab, but the pane's Orky chip and any
`lastExit:'failure'` border still render.

### REQ-017 — Strictly read-only: zero Orky-side writes
The feature MUST NOT write, create, move, or delete any file under `<cwd>/.orky/` (no Orky-side
changes). It only reads and watches.
**Acceptance:** an e2e/integration check confirms the `.orky/` fixture tree is byte-identical before
and after a watch session (no mtime/content changes attributable to the tracker).

### REQ-018 — No new persisted schema
Orky status is live runtime state. The feature MUST NOT add a persisted schema or bump
`SCHEMA_VERSION` (baseline REQ-024 unaffected). No new file appears under Electron `userData`.
**Acceptance:** `SCHEMA_VERSION` is unchanged in the diff; no new persistence path is registered.

### REQ-019 — Robust to missing / partial / malformed Orky state (CONV-002)
The tracker and pure mappers MUST tolerate, without throwing: a `.orky/` dir with no `active.json`; a
feature dir with no `state.json` or no `findings.json`; empty files; and malformed JSON. In each case
the affected feature MUST degrade to a defined safe status (e.g. an unreadable feature is omitted or
reads `idle`/`cleared`) rather than crashing the tracker or wedging the watch. Diagnostics SHOULD be
logged (mirroring `UsageTracker`'s warn-on-read-failure), not silently swallowed.
**Acceptance:** a fixture with malformed `state.json` → that feature is skipped/safe-defaulted, other
features still report, no throw; a `.orky/` with only `active.json` and no `features/` → an empty
roll-up (`features:[]`, `chipFeature:null`), no throw; an empty `findings.json` → `openBlocking:0`.

### REQ-020 — Popover lists all non-Idle features (CONV-007 styling)
The detail popover MUST list every feature in the roll-up whose status is non-Idle (busy / needs-input
/ done-with-open-items / failed), each with its phase, gate N/M, open count, and needs-you reason,
ordered by the same selector ranking as REQ-007. As a `<body>`-portalled chrome popover, it MUST carry
visible paint-only focus and hover styling (or be added to the focus-visible/hover allow-lists) per
CONV-007.
**Acceptance:** a roll-up of 3 features (2 non-Idle, 1 idle) → the popover lists exactly the 2
non-Idle, top-ranked first; the popover element matches the chrome focus/hover allow-list.

### REQ-021 — Determinism of the pane roll-up mapper
`orkyPaneStatus(features)` MUST be total and pure (no Date.now, no I/O, no ambient state — `now` is
passed in upstream to `orkyFeatureStatus`). Given the same inputs it MUST produce identical output,
independent of input ordering. Empty input → `{kind:'idle'|'cleared', features:[], chipFeature:null}`
(chosen value asserted).
**Acceptance:** calling the mapper twice with the same (and with reordered) inputs yields deeply-equal
output; no `Date`/`Math.random`/fs reference appears in the pure module.

### REQ-022 — Documentation reconciled (doc-drift)
A feature doc MUST be added under `docs/features/` (e.g. `orky-status.md`) and linked from the
CLAUDE.md "Where things live" table; the `CHANGELOG.md` `[Unreleased]` section MUST record the feature;
and the new `orky:status` channel + types MUST be reflected wherever IPC channels are documented. When
changing any existing documented claim, the whole `docs/` tree plus `CLAUDE.md` and `.orky/baseline/`
MUST be grepped for stale phrasings (CONV-008).
**Acceptance:** `docs/features/orky-status.md` exists and is referenced; `CHANGELOG.md [Unreleased]`
mentions Orky status awareness; the doc-guard / doc-sync gate passes.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** unit tests for `ORKY_PHASES`/gate N-M (REQ-001),
  `openBlockingCount` (REQ-002), `isStalled` (REQ-003), `orkyFeatureStatus` (REQ-004/005/006),
  `selectChipFeature` (REQ-007), chip label (REQ-008), `orkyBadgeRollup`/tab-badge contribution
  (REQ-009), `orkyPaneStatus` determinism (REQ-021), and the CONV-002 empty/malformed cases
  (REQ-019). Match the style of the existing status-state-machine / `chip-status` tests.
- **e2e (Playwright-for-Electron, against `out/`):** fixture a **synthetic `.orky/` tree**
  (`active.json` + `features/<slug>/state.json` + `findings.json`), point a pane's cwd at it, and
  assert: the toolbar Orky chip + label, the pane border precedence (REQ-014), the tab badge roll-up +
  opt-in gating (REQ-009/REQ-016), clean teardown on cwd-leave (REQ-012), read-only invariant
  (REQ-017), and watcher disposal (REQ-011). This is the chosen DoD verification mechanism — a
  synthetic fixture, not a manual "point at a live run" check (which remains a nice-to-have smoke test).

## Open questions

None blocking. The three concept-deferred items are resolved in this spec:
- Canonical phase list + `human-review` counts toward M → **resolved** (REQ-001, recommended `yes`).
- DoD verification mechanism → **resolved**: synthetic-fixture e2e + pure unit tests (above).
- Watcher cost ceiling → **resolved as a bounded requirement** (REQ-011: a single debounced watch on
  `<cwd>/.orky/`, bounded per pane); the exact chokidar `depth`/glob mechanism is left to the plan.

## Notes for the planner

- The pure module is the determinism + data-provenance anchor; build it first, TDD, fully decoupled
  from Electron and `../api`. Inject `now` and `thresholdMs`; never read the clock inside the mappers.
- Reuse, do not reinvent, `tab-badge.ts` aggregation and the `resolveAlerts(...).tabBadge` opt-in;
  thread the Orky needs-you the same way terminal needs-input is threaded.
- Clone `UsageTracker` structure verbatim for the tracker (slot-claim-before-await, re-check-after,
  debounce, `dispose`, `unref`-equivalent watcher close). The roll-up watches MORE files than usage —
  keep it to a single bounded debounced watch on `<cwd>/.orky/`; do NOT spin a watcher per feature.
- Risk: `.orky/` discovery must walk up from cwd or check cwd itself — clarify in the plan whether
  "cwd contains `.orky/`" means cwd is the project root or any ancestor; the spec says "a directory
  whose tree contains `.orky/`" (REQ-012). Keep it deterministic and bounded (don't walk to filesystem
  root unbounded).
- Risk (`data-provenance`): the embedded `ORKY_PHASES` can drift from Orky's real pipeline. Tests
  cannot catch upstream drift; note this in the feature doc so a future Orky phase change triggers a
  data update here.
- Precedence (REQ-014) is a render-time composition over byte-status — keep `StatusTracker` and the
  CHAR tests untouched (baseline-fit obligation).
