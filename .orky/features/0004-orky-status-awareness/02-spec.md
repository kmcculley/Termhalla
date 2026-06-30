# 0004 — Orky status awareness in the pane chrome (Tier 0 MVP)

## Phase 2 — Specification

**Status:** AMENDED at review loop-back (iteration 1) per human-approved escalation **ESC-001**. The
original spec mis-modeled live-phase / needs-human off `state.json.phase`; this revision adopts the
**gate-based full-roll-up** detection model and folds in the contract-violation review findings
(UX-001, DA-003) plus non-blocking security / performance / determinism / quality / data-provenance
hardening. **REQ-IDs are stable** — corrected REQs keep their IDs; genuinely new obligations are
REQ-023..REQ-029. Concept (`01-concept.md`) remains FROZEN; this does not relitigate concept
decisions — it corrects how those decisions are *detected* from Orky's real on-disk files.

> **Downstream impact (read before planning/test-design):** several phase-4 tests were frozen
> against the OLD `state.json.phase` behavior (notably TEST-008/009 keying needs-human on
> `phase === 'human-review'`, and the live-phase/stall tests). Those tests MUST be updated to the
> gate-based model during the (re-opened) tests phase — see "Notes for the planner / test-designer".

## Concerns

`ux` `quality` `performance` `determinism` `doc-drift` `data-provenance` `security`

- `security` was **added in this loop-back**: the review surfaced real main-process attack surface
  in the IPC boundary and the file-read path (non-string IPC args crashing the main process,
  cross-window status disclosure, unbounded `readdir`/`readFile` DoS, symlink escape, unescaped CSS
  selector). REQ-024..REQ-026 encode the mitigations.
- `data-provenance` is included because this feature **hardcodes a canonical phase list**
  (`brainstorm → spec → plan → tests → implement → review → doc-sync → human-review`) as a constant
  claimed to match Orky's external gatekeeper pipeline definition. Per Orky's testing stance, tests
  verify that the **code matches the embedded phase list**, never that the embedded list matches
  Orky's real pipeline. If Orky's pipeline phases change upstream, that is a data-update follow-up,
  not something a test can catch here. REQ-001 is the provenance anchor; REQ-029 pins the drift
  caveat that distinguishes `ORKY_PHASES` from Orky's *separate* 9-entry `PHASE_ORDER`.

## Baseline fit (brownfield — `.orky/baseline/` present)

This feature is **purely additive** to the existing system and supersedes **no** baseline REQ.
Specifically:

- Baseline **REQ-004** (terminal status state machine, OSC 133 + silence) and baseline **REQ-005/006**
  (needs-input / idle-fallback) are **unchanged**. The byte-derived `TerminalStatus` still computes
  exactly as before. This feature adds a **presentation-layer override**: when a pane is an Orky run,
  Orky-derived status takes precedence over the byte-derived status *for the border and tab badge*
  (REQ-014). It does not modify `StatusTracker`, `needs-input.ts`, or their CHAR tests.
- Baseline **REQ-002/003** (typed IPC contract, `safeSend`) are extended (new `orky:status` push
  channel) following the existing pattern, not changed (REQ-013), AND hardened with sender-ownership
  scoping mirroring `register-pty`'s `claimPane` (REQ-024).
- Baseline **REQ-024** (versioned persistence) is **unaffected**: Orky status is live runtime state,
  not persisted. `SCHEMA_VERSION` is NOT bumped (REQ-018).

No characterization test (CHAR-001..020) should need editing for this feature. If implementation finds
one does, that is a signal the change is not purely additive — stop and revisit.

---

## Detection model (authoritative — ESC-001)

Ground truth, verified against this repo's `.orky/`: the per-feature `state.json.phase` **lags** the
real pipeline and is **never** set to `'human-review'`; completed features terminate at
`state.json.phase === 'doc-sync'` while `human-review` is recorded only as an **external gate** in
`state.json.gates['human-review']`. The authoritative *live* phase lives in `active.json.phase`, but
**only for the single active feature** named in `active.json.feature`.

The system therefore detects status from **gates**, not from `state.json.phase` string equality:

- **Live phase of a feature (REQ-023):**
  - **Active** feature (path matches `active.json.feature`): `active.json.phase` is authoritative.
  - **Non-active** feature: the **gate frontier** — the phase immediately AFTER the highest passed
    canonical gate in `state.json.gates`. `state.json.phase` is only a last-resort fallback; the
    frontier and `active.json.phase` win.
- **Awaiting human / needsHuman (REQ-005):** derived from gates so it works for ANY feature, active or
  not — all autonomous gates through `doc-sync` passed AND `human-review` not yet passed.
- A **non-active** feature has no proof of life (one heartbeat per project, in `active.json`), so it
  is **never `busy`** — only `idle` / `needs-input` / `done` (REQ-004).

---

## Public interface

### Shared pure module (new) — `src/shared/orky-status.ts` (or a pure module beside the tracker)

Total, side-effect-free functions, unit-tested under vitest with **no Electron import** and **no
`../api` import** (CLAUDE.md / baseline REQ-001 invariant):

```ts
// Canonical pipeline phase order; human-review is the final real gate and counts toward M (REQ-001).
// NOT Orky's separate 9-entry PHASE_ORDER (intake..human) — see REQ-029.
export const ORKY_PHASES: readonly OrkyPhase[]            // 8 entries, see REQ-001
export const ORKY_AUTONOMOUS_PHASES: readonly OrkyPhase[] // the 7 gates through doc-sync (ORKY_PHASES minus human-review), REQ-005

export type OrkyKind = 'busy' | 'idle' | 'needs-input' | 'done' | 'cleared'
export type OrkyReason = 'escalation' | 'stalled' | 'human-review' | null   // structured needs-you discriminator (REQ-007)

export interface OrkyFeatureStatus {       // one entry per feature in the roll-up
  feature: string                          // slug / id
  kind: OrkyKind
  phase: OrkyPhase | null                  // the LIVE phase (REQ-023), not raw state.json.phase
  reason: OrkyReason                       // null when needsHuman===false; drives the REQ-007 selector
  gateN: number                            // gates passed
  gateM: number                            // total gates (= ORKY_PHASES.length)
  openBlocking: number
  needsHuman: boolean
  failed: boolean                          // a halted gate failure (drives lastExit:'failure' styling)
  lastActivityAt: number                   // tz-safe (REQ-028); per-feature gate timestamps + active heartbeat
  detail: string                           // human-readable, actionable (CONV-001)
}

export interface OrkyPaneStatus {          // the per-pane roll-up the tracker emits
  kind: OrkyKind                           // the chip-feature's kind (terminal-status mapping)
  label: string                            // `feature · phase · gate N/M · ●k open`
  needsHuman: boolean
  failed: boolean
  features: OrkyFeatureStatus[]            // popover roll-up (REQ-020 filter applied)
  chipFeature: string | null              // selectChipFeature result; null when no features
}

export function gateN(gates: unknown): number                                       // REQ-001
export function gateFrontier(gates: unknown): OrkyPhase | null                       // REQ-023
export function openBlockingCount(findings: OrkyFinding[]): number                   // REQ-002
export function isStalled(activeFeatureSlug: string | null, feature: OrkyFeatureRaw,
                          activePhase: OrkyPhase | null, lastTickAt: number | null,
                          now: number, thresholdMs: number): boolean                 // REQ-003
export function orkyFeatureStatus(raw: OrkyFeatureRaw, findings: OrkyFinding[],
                                  isActive: boolean, activePhase: OrkyPhase | null,
                                  lastTickAt: number | null, now: number,
                                  thresholdMs: number): OrkyFeatureStatus            // REQ-004/005/006/023
export function orkyPaneStatus(features: OrkyFeatureStatus[]): OrkyPaneStatus        // REQ-007/008/020/021
export function selectChipFeature(features: OrkyFeatureStatus[]): OrkyFeatureStatus | null  // REQ-007
```

> `activePhase` is non-null ONLY for the active feature (the tracker passes `active.json.phase` there
> and `null` for every other feature). For a non-active feature the live phase is computed internally
> via `gateFrontier(raw.gates)` (REQ-023).

### IPC (new push channel) — `src/shared/ipc-contract.ts`

```ts
CH.orkyStatus: 'orky:status'                                   // main -> renderer event (pane-scoped)
CH.orkyWatch:  'orky:watch'                                    // renderer -> main
CH.orkyUnwatch:'orky:unwatch'                                  // renderer -> main
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
ignored for the count (and MUST NOT throw). The constant's provenance caveat is REQ-029.
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

### REQ-003 — Stall detection: finished-wins, active-feature-only, 120s, off the LIVE phase
`isStalled` MUST return `true` ONLY when ALL hold: the feature is the active feature (named in
`active.json.feature`); its **live phase** (`active.json.phase`, REQ-023 — NOT the lagging
`state.json.phase`) is an executing (non-finished) phase in flight; a `lastTickAt` exists; and
`now − lastTickAt > thresholdMs`. The default threshold MUST be `120_000` ms. Because executing-ness
is read from `active.json.phase`, a hang during the **long late phases** (`review`, `doc-sync`) —
where the corresponding gate has not yet passed even though earlier gates have — MUST be able to
light a stall (the prior bug, FINDING-DA-002, computed executing-ness off the lagging
`state.json.phase` and could never stall after the `implement` gate passed). **Finished wins:** a
feature whose `human-review` gate has passed, OR whose live phase is not an executing phase, MUST
never be stalled. A non-active feature MUST never be stalled (it has no live heartbeat). A
missing/`null` `lastTickAt` MUST yield `false`, not a throw (CONV-002). `lastTickAt` MUST be parsed
tz-safely (REQ-028).
**Acceptance:** active + `active.json.phase='implement'` (gate not yet passed) + `now-lastTickAt =
121_000` → `true`; same at `119_000` → `false`; **active feature whose `state.json.phase='implement'`
(implement gate passed) but `active.json.phase='review'` (review gate pending) + tick 121_000s →
`true`** (live-phase divergence fixture — was wrongly `false`); active but `human-review` gate passed
→ `false` regardless of tick age; non-active feature with any tick age → `false`; `lastTickAt = null`
→ `false`.

### REQ-004 — Per-feature status mapping into the terminal-status model (gate-based, live-phase aware)
`orkyFeatureStatus(...)` MUST be a total pure map producing an `OrkyFeatureStatus` whose `phase` is the
**live phase** (REQ-023) and whose `kind` maps to the existing terminal-status model as:
`human-review` gate passed / pipeline complete → `done`; else `needsHuman` (REQ-005) → `needs-input`;
else the **active** feature with a live executing phase in flight → `busy`; otherwise → `idle`. A
**non-active** feature MUST NEVER be `busy` — it has no per-project heartbeat and no proof of life, so
its `kind` is restricted to `idle` / `needs-input` / `done` (corrects FINDING-DA-005, where a
non-active feature abandoned mid-phase read `busy` forever). `lastActivityAt` MUST be sourced from the
feature's own on-disk evidence — the max of its `gates[*].at` timestamps (tz-safe, REQ-028), falling
back to the active heartbeat `lastTickAt` for the active feature — so the REQ-007 recency tiebreak
orders non-active features rather than collapsing them all to `0`. The `detail` string MUST be
specific and actionable (CONV-001): it MUST name the feature and the reason (e.g. `"auth-feature: open
escalation ESC-3 (reason) — needs you"`, `"auth-feature: stalled 3m — no heartbeat since 12:04"`,
`"auth-feature: awaiting human-review (gates 7/8)"`), never a bare `"needs input"`.
**Acceptance:** the ACTIVE fixture feature mid-`implement` (`active.json.phase='implement'`, recent
tick) → `kind:'busy'`, `needsHuman:false`; a non-active feature whose `state.json.phase` names an
in-flight (gate-undefined) phase → `kind:'idle'` (NOT `busy`); a feature whose autonomous gates
through `doc-sync` are all passed and `human-review` gate is pending → `kind:'needs-input'`,
`needsHuman:true`, `reason:'human-review'`, `detail` contains the slug and `"human-review"`; a feature
with `human-review` gate passed → `kind:'done'`, `needsHuman:false`.

### REQ-005 — "Needs a human" set, derived from GATES (not the phase string)
`needsHuman` MUST be `true` for a feature iff ANY of:
(a) **awaiting human-review (gate-based):** every autonomous gate through `doc-sync`
(`ORKY_AUTONOMOUS_PHASES` = `['brainstorm','spec','plan','tests','implement','review','doc-sync']`) has
`passed === true` AND `gates['human-review']` is absent or `passed !== true`;
(b) it has at least one escalation with `status === 'open'` (unresolved);
(c) it is stalled per REQ-003.
This MUST work for ANY feature in the roll-up — active or not — because it reads gates, not
`state.json.phase` (which is never `'human-review'`; FINDING-DA-001). For the active feature,
`active.json.phase === 'human-review'` MAY corroborate (a) but the gate test is authoritative. When
`gates['human-review'].passed === true` the feature is **done/idle** and `needsHuman` MUST be `false`.
A generic gate boundary MUST NOT set `needsHuman` (full-auto auto-passes gates). A gate **failure**
(REQ-006) MUST NOT, by itself, set `needsHuman`. `reason` MUST be set with priority `escalation >
stalled > human-review` when several triggers apply, and `null` when `needsHuman === false`.
**Acceptance:** a feature with `{brainstorm..doc-sync}` all passed and no `human-review` gate →
`needsHuman:true`, `reason:'human-review'` — **even though `state.json.phase==='doc-sync'`** (the
real on-disk shape; the prior phase-string check returned `false` here); a feature with
`gates['human-review'].passed===true` → `needsHuman:false`; an open escalation while mid-`implement`
→ `true`, `reason:'escalation'`; a stalled active feature → `true`, `reason:'stalled'`; a feature
sitting `idle` between two passed gates with no open escalation and no stall → `false`,
`reason:null`; a feature whose last gate **failed** but has no open escalation and is not
awaiting-human → `needsHuman:false` (it surfaces via REQ-006 instead).

### REQ-006 — Gate failure surfaces as a RENDERED failure treatment, separate from needs-human
A halted gate **failure** MUST set `OrkyFeatureStatus.failed = true` and MUST propagate to the pane as
a **distinct, actually-rendered failure treatment** — NOT as `needsHuman`/`needs-input`. Because the
canonical failed feature maps to `kind:'idle'`, the failure styling MUST win at render time over the
idle toolbar background: it MUST be carried by a dedicated, renderable failure marker (e.g. a
`term-failure` class whose `background-color` has CSS precedence over the `!important` idle-toolbar
rule — via `!important` and/or by excluding `.term-failure` from the idle
`:not(.term-busy):not(.term-needs-input)` background rule) so the red accent appears for the
failed-AND-idle pane, which is exactly the state a halted gate failure produces (corrects the HIGH
contract violation FINDING-UX-001, where the non-`!important` failure rule lost to the idle
`!important` rule and the failure border rendered nowhere). `failed` and `needsHuman` are independent
flags and MAY both be true. Failure MUST also carry a **non-color** affordance per WCAG 1.4.1 (e.g. a
glyph/text marker on the chip), not color alone.
**Acceptance:** a feature whose latest gate attempt failed (no open escalation, not awaiting-human) →
`failed:true`, `needsHuman:false`; a render/e2e assertion confirms a **failed-AND-idle** Orky pane
RENDERS the failure accent (the computed toolbar `background-color` resolves to `var(--status-failure)`,
not `var(--panel)`) — a pure-mapper assertion alone is NOT sufficient for this REQ. A clean feature →
`failed:false`.

### REQ-007 — Deterministic single-chip selector
`selectChipFeature(features)` MUST be a pure, total function returning the most-needs-you feature by
this exact ordering: (1) `needsHuman === true` ranks above `false`; (2) within equal `needsHuman`, a
stable `reason` order `escalation > stalled > human-review`; (3) then most-recent `lastActivityAt`
(newer first); (4) then `feature` id ascending as the final, fully-deterministic tiebreak. Empty input
MUST return `null`. The function MUST NOT depend on input array order (sorting input in any permutation
yields the same winner).
**Acceptance:** given features A (needsHuman via human-review, activity t=10), B (needsHuman via open
escalation, activity t=5), C (idle, activity t=20): winner is **B** (escalation outranks human-review
despite older activity); reversing/ shuffling the input array yields **B** every time; two features
identical on (1)-(3) are broken by id ascending; `selectChipFeature([])===null`.

### REQ-008 — Chip label format
The toolbar Orky chip label MUST render as `feature · phase · gate N/M · ●k open` for the selected
chip feature, where `feature` is the slug, `phase` is the **live phase** (REQ-023), `N/M` per REQ-001,
and `k` is `openBlockingCount`. The `●k open` segment MUST show the real count with no silent capping
(CONV-003); when `k === 0` the `●k open` segment MAY be omitted but MUST NOT show a wrong/truncated
number.
**Acceptance:** a feature `auth` in live phase `implement` with `5/8` gates and 2 open-blocking
findings → label `"auth · implement · 5/8 · ●2 open"`; with 0 open findings → label has no `●` count
or shows `●0 open` (chosen rendering is asserted, not silently dropped when >0).

### REQ-009 — Workspace tab-badge roll-up
A workspace tab MUST light its needs-you badge (🔔) if ANY feature in ANY Orky pane in that workspace
has `needsHuman === true`, aggregated through the existing `tab-badge.ts` path and contributing the
same way a terminal `needs-input` pane does. This contribution MUST be gated by the same
`resolveAlerts(cfg.alerts).tabBadge` opt-in that gates terminal needs-input (REQ-016). A pane that is
not an Orky run contributes nothing here.
**Acceptance:** a workspace with one Orky pane whose roll-up has a `needsHuman` feature (badge opt-in
on) → tab badge shows the needs indicator; with the opt-in off → no Orky contribution; an Orky pane
with only `idle`/`busy`/`done` features → no 🔔 from Orky.

### REQ-010 — Chip-status model extended for the Orky variant AND wired into the minimized tray
The 0003 `chip-status.ts` model MUST be extended (additively) with an Orky variant (e.g.
`orkyChipStatus(orky)`), WITHOUT changing the existing `ChipStatus` behavior for non-Orky panes (the
existing `chipStatus(...)` mapping for `exited`/`needs-input`/etc. MUST be unchanged — its tests stay
green). Per the intake's explicit "toolbar chip AND minimized-tray chip" reuse, the Orky variant MUST
be **wired into the minimized-tray chip** (`MinimizedTray` / `MinChip`): when a minimized pane is a
bound Orky run, its tray chip MUST reflect the Orky kind / needs-you, not only the byte-derived status
(corrects FINDING-QUAL-005, where `orkyChipStatus` was exported but consumed nowhere). The function
MUST NOT be left exported-and-unused.
**Acceptance:** existing `chip-status` tests pass unchanged; a new test asserts the Orky variant
renders the Orky kind for an Orky pane; an e2e/integration assertion confirms a minimized Orky pane's
tray chip reflects its Orky state (e.g. a `needsHuman` Orky pane minimized → its tray chip shows the
needs-you affordance); a non-Orky pane is unaffected.

### REQ-011 — OrkyTracker: bounded, debounced, race-safe, disposable watcher
A new main-process `src/main/orky/orky-tracker.ts` MUST watch `<root>/.orky/` (covering `active.json`
and `features/*/state.json` + `findings.json`) via chokidar with a **debounce** (coalesced re-read),
cloning the `UsageTracker` **session-identity race pattern**: claim the session map slot BEFORE the
first `await`, and re-check `sessions.get(id) === sess` after every `await` so a concurrent
watch/unwatch supersedes cleanly. `unwatch(id)` MUST early-return when the pane was never watched
(mirroring `UsageTracker.unwatch`'s `if (!this.sessions.has(id)) return`) so it emits no spurious
`orky:status(id, null)` for an unknown pane. The number of chokidar watchers MUST be bounded per pane
(a single debounced watch on `<root>/.orky/`, not an unbounded per-feature watcher set) AND
de-duplicated across panes resolving to the same root (REQ-027). The tracker MUST be disposable
(`dispose()` closes all watchers + clears timers) and MUST NOT keep the Electron main process alive
(watchers closed on teardown; no lingering timers) — CLAUDE.md long-lived-watcher gotcha.
**Acceptance (e2e/integration harness):** after `unwatch`/`dispose`, the tracker holds zero open
watchers and zero pending timers; `unwatch` of a never-watched pane emits nothing; a watch immediately
followed by unwatch for the same paneId leaves no orphaned session (re-check-after-await guard
exercised); the app `close()`s without hanging.

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
The feature MUST NOT write, create, move, or delete any file under `<root>/.orky/` (no Orky-side
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

### REQ-020 — Popover lists busy / needs-input / done-WITH-open-items features (clean done excluded)
The detail popover MUST list every feature in the roll-up whose status is **busy**, **needs-input**,
**failed**, or **done WITH open blocking items** (`done` AND `openBlocking > 0`), each with its phase,
gate N/M, open count, and needs-you reason, ordered by the same selector ranking as REQ-007. A **clean
`done` feature** (`kind === 'done'` AND `openBlocking === 0`) MUST be **excluded** — otherwise an Orky
pane's popover would permanently accumulate every merged feature (0001/0002/0003…) as a wall of stale
"done" rows implying attention where none is needed (corrects the contract violation FINDING-DA-003,
where the filter was `kind !== 'idle'`, which retained every clean done feature). `idle` features are
likewise excluded. As a `<body>`-portalled chrome popover, it MUST carry visible paint-only focus and
hover styling (or be added to the focus-visible/hover allow-lists) per CONV-007.
**Acceptance:** a roll-up of two `done` features — one with `openBlocking>0`, one with `openBlocking===0`
— lists **only** the former; a roll-up of 3 features (2 non-Idle-and-not-clean-done, 1 idle) → the
popover lists exactly the 2, top-ranked first; the popover element matches the chrome focus/hover
allow-list.

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
the new `orky:status`/`orky:watch`/`orky:unwatch` channels + types MUST be reflected wherever IPC
channels are documented; and `.orky/baseline/architecture.md` MUST be reconciled to add the new
privileged `src/main/orky/` subsystem (read-only `.orky/` watcher) and the render-time precedence of
Orky status over byte-derived `TerminalStatus`. When changing any existing documented claim, the whole
`docs/` tree plus `CLAUDE.md` and `.orky/baseline/` MUST be grepped for stale phrasings (CONV-008).
The feature doc MUST carry the `ORKY_PHASES` drift caveat (REQ-029).
**Acceptance:** `docs/features/orky-status.md` exists and is referenced; `CHANGELOG.md [Unreleased]`
mentions Orky status awareness; `.orky/baseline/architecture.md` names `src/main/orky/` + `orky:status`;
the doc-guard / doc-sync gate passes.

### REQ-023 — Live-phase resolution (gate frontier for non-active; `active.json.phase` for active)
The system MUST compute a feature's **live phase** as follows: for the **active** feature (its path
matches `active.json.feature`), the live phase is `active.json.phase`; for a **non-active** feature,
the live phase is the **gate frontier** — the phase in `ORKY_PHASES` immediately AFTER the highest
canonical gate with `passed === true` (`gateFrontier(gates)`), e.g. gates through `implement` passed →
frontier `review`; all 8 passed → frontier is `null`/complete; no gates passed → frontier `brainstorm`.
`state.json.phase` MAY be used ONLY as a last-resort fallback when neither source is available; it MUST
NOT override `active.json.phase` or the gate frontier (corrects FINDING-DA-002, where the lagging
`state.json.phase` was used as the live phase, mis-reporting an actively-running feature as `idle`).
`gateFrontier` MUST be total (unknown/empty/malformed gates → `brainstorm`/`null` as defined, never a
throw). This live phase is what REQ-004/REQ-008 surface as `phase`.
**Acceptance:** non-active feature with gates `{brainstorm..implement}` passed → `gateFrontier` ===
`'review'`; `{}` → `'brainstorm'`; all 8 passed → `null`; the ACTIVE feature whose `state.json.phase`
lags at `'implement'` but `active.json.phase==='review'` → live phase `'review'` (used by REQ-004 to
report `busy` in review, and by REQ-003 to allow a review-phase stall).

### REQ-024 — IPC boundary: input validation + per-window sender ownership (security)
The `orky:watch` / `orky:unwatch` IPC handlers MUST validate their arguments and scope to the owning
window before acting. They MUST reject a non-string `id` or non-string `cwd`
(`if (typeof id !== 'string' || typeof cwd !== 'string') return;`) so a malformed IPC message cannot
produce an unhandled promise rejection that crashes the main process (Node 22 default
`--unhandled-rejections=throw`; corrects FINDING-SEC-001). Because `ipcMain.on` is process-global, each
handler MUST act ONLY for events whose `sender` belongs to its own `BrowserWindow` (mirroring
`register-pty`'s `claimPane(paneId, e.sender)` ownership check), so that with N windows a `watch`/
`unwatch` from one window cannot open spurious watchers in, disclose status to, or cancel watches in
another window (corrects FINDING-SEC-002 cross-window status disclosure). `findOrkyRoot` MUST also
degrade to `null` (not throw) on a non-string input.
**Acceptance:** an `orky:watch` with a non-string `cwd` is a no-op (no throw, no unhandled rejection,
main process survives); a `watch`/`unwatch` event whose `sender` is window A's webContents does not
start/stop a tracker owned by window B, and B receives no `orky:status` for A's pane ids.

### REQ-025 — Read-path resource bounds + symlink safety (security)
The re-read path MUST bound resource consumption and refuse symlink escape from the `.orky/` tree:
(a) cap the number of feature directories processed per re-read (e.g. `slice(0, 200)` with a warning
log) so an adversarial `features/` tree with thousands of dirs cannot occupy the re-read coroutine for
seconds (FINDING-SEC-003); (b) check `stat.size` before `readFile` and skip+warn any `state.json` /
`findings.json` above a fixed cap (e.g. 1 MiB) so a multi-hundred-MiB file cannot drive a GiB-class
main-process allocation (FINDING-SEC-003); (c) `realpath`-guard (or `lstat` + skip symlinks on) each
`features/<slug>` entry, verifying the resolved path stays inside the resolved `.orky/` root before
reading beneath it, so a symlink under `features/` cannot redirect a read outside the project
(FINDING-SEC-004). Each cap MUST be a STATED limit with a test (CONV-003) — no silent capping.
**Acceptance:** a fixture `features/` with > the cap of dirs → only the cap is processed, a warning is
logged, no throw; an oversized `state.json` (> the size cap) → skipped + warned, the feature
safe-defaults, other features still report; a `features/<slug>` symlink pointing outside the root →
skipped (not read).

### REQ-026 — Escape interpolated selectors in the popover (security)
Any DOM selector the popover builds from a pane id MUST escape the id with `CSS.escape(...)` (e.g.
`document.querySelector(\`[data-testid="orky-chip-${CSS.escape(paneId)}"]\`)`), so a pane id containing
CSS-reserved characters cannot throw a `DOMException: SyntaxError` that crashes the positioning effect
and blanks the popover (FINDING-SEC-005). The selector MUST NOT depend on the undocumented invariant
that pane ids are UUIDs.
**Acceptance:** a unit/render test passes a pane id containing a CSS-special character (e.g. `a"b]c`)
and the popover positioning code does not throw (the selector is built via `CSS.escape`).

### REQ-027 — Watch event filter + per-root de-duplication (performance)
The chokidar event handler MUST filter to the relevant target files (`active.json`, `state.json`,
`findings.json` — i.e. basename/`.json` filtering) BEFORE scheduling a re-read, so routine edits to
the many non-target artifacts under `features/<slug>/` (e.g. `01-concept.md`, `02-spec.md`,
plan/test/findings markdown) do NOT fire a full roll-up re-read (mirrors `UsageTracker`'s `.jsonl`
guard; corrects FINDING-PERF-001). The tracker MUST de-duplicate the watch + re-read across panes that
resolve to the **same `.orky/` root**: one chokidar watcher + one debounced re-read per resolved root,
fanning the computed status out to every paneId bound to that root, rather than P independent
watchers + P× file-read amplification for identical data (corrects FINDING-PERF-002). Per-pane emit
granularity (REQ-013) is preserved.
**Acceptance:** a change to a non-target file (e.g. `02-spec.md`) under the watched tree does NOT
trigger a re-read/emit, while a change to `state.json` does; two panes whose cwds resolve to the same
`.orky/` root share a single watcher and a single re-read per event (asserted via a read/watch counter
or a single chokidar instance), yet both panes receive their `orky:status` emit.

### REQ-028 — Timezone-safe timestamp parsing (determinism)
All Orky timestamps the tracker consumes (`active.json.lastTickAt`, `gates[*].at`, escalation
timestamps) MUST be parsed timezone-safely so identical bytes yield identical epoch-ms — and therefore
identical stall (REQ-003) and recency-ordering (REQ-004/REQ-007) decisions — on any machine. A
tz-less ISO string (no `Z`/offset) MUST NOT be interpreted in the machine's local timezone (the
`Date.parse` default); it MUST be treated as UTC (or rejected to `null`), so two users in different
timezones reading the same synced `.orky/` tree compute the same result (corrects FINDING-DET-001).
**Acceptance:** a unit test pins that a fixed tz-less timestamp (e.g. `"2026-06-30T12:04:00"`) yields
the same epoch ms regardless of `process.env.TZ` (test run under at least one non-UTC zone); a
`Z`/offset timestamp is unaffected.

### REQ-029 — `ORKY_PHASES` provenance caveat distinguishes Orky's separate `PHASE_ORDER` (data-provenance)
`ORKY_PHASES` (and the feature doc, REQ-022) MUST carry a provenance caveat that (a) cites the EXACT
mirrored source — the recorded `state.json.gates` keys and gatekeeper `DRIVER_WORK_PHASES` — and (b)
explicitly distinguishes it from Orky's *separate* constant literally named "Canonical phase order"
(`PHASE_ORDER`, 9 entries `['intake','brainstorm','spec','plan','tests','implement','review',
'doc-sync','human']`): the leading `intake` (a pre-pipeline artifact step that records no gate) and the
trailing `human` (recorded on disk as the `human-review` gate key) are intentionally excluded/renamed
here. The local source comment MUST NOT call `ORKY_PHASES` "Canonical phase order" (the name of Orky's
DIFFERENT 9-element list), so a future maintainer re-syncing the mirror does not wrongly prepend
`intake` (M=9) or rename `human-review → human` (zeroing `gateN`'s match on the recorded
`human-review` key) — corrects FINDING-PROV-001.
**Acceptance:** the caveat text appears at the `ORKY_PHASES` definition and in `docs/features/orky-status.md`,
names `DRIVER_WORK_PHASES`/the gate keys as the source, and states that `intake`/`human` are
deliberately excluded/renamed; the source comment does not label `ORKY_PHASES` "Canonical phase order".
A docs test (REQ-022 suite) asserts the caveat's presence.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** unit tests for `ORKY_PHASES`/gate N-M (REQ-001),
  `gateFrontier`/live-phase (REQ-023), `openBlockingCount` (REQ-002), `isStalled` incl. the
  live-phase divergence + review-phase stall (REQ-003), `orkyFeatureStatus` incl. gate-based
  needs-human, non-active-never-busy, gate-sourced `lastActivityAt` (REQ-004/005/006/023),
  `selectChipFeature` (REQ-007), chip label (REQ-008), tab-badge contribution (REQ-009), popover
  filter excluding clean-done (REQ-020), `orkyPaneStatus` determinism (REQ-021), tz-safe timestamp
  parse under a non-UTC `TZ` (REQ-028), and the CONV-002 empty/malformed cases (REQ-019). Match the
  style of the existing status-state-machine / `chip-status` tests.
- **Render/e2e (Playwright-for-Electron, against `out/`):** fixture a **synthetic `.orky/` tree**
  (`active.json` + `features/<slug>/state.json` + `findings.json`) reproducing the REAL on-disk shape
  (a completed feature at `state.json.phase==='doc-sync'` with `human-review` gate pending; the
  active feature whose `state.json.phase` lags `active.json.phase`), point a pane's cwd at it, and
  assert: the toolbar Orky chip + label, the pane border precedence (REQ-014), **the RENDERED failure
  accent for a failed-AND-idle pane (REQ-006)**, the popover excluding clean-done features (REQ-020),
  the minimized-tray Orky chip (REQ-010), the tab badge roll-up + opt-in gating (REQ-009/REQ-016),
  clean teardown on cwd-leave (REQ-012), read-only invariant (REQ-017), and watcher disposal
  (REQ-011). Per-root watcher de-dup (REQ-027) and the IPC sender-ownership/validation (REQ-024) are
  exercised in the main/integration harness.

## Open questions

None blocking. The ESC-001 escalation resolved the detection-model defect (gate-based roll-up). The
three original concept-deferred items remain resolved (canonical phase list REQ-001/REQ-029; synthetic
-fixture DoD; bounded watcher REQ-011/REQ-027).

## Notes for the planner / test-designer

- **BIGGEST downstream change — frozen tests MUST be updated (re-opened tests phase).** Several phase-4
  tests were frozen against the OLD `state.json.phase` model and now assert the WRONG thing:
  - TEST-008 ("`human-review` *phase*") and TEST-009 must key on **gates** (`human-review` gate
    passed/pending), not on `state.json.phase === 'human-review'` — which the real pipeline never sets
    (REQ-005). The fixtures must use the REAL shape: `state.json.phase==='doc-sync'` + `human-review`
    gate absent → `needsHuman:true, reason:'human-review'`.
  - TEST-005/006/007 (stall + busy) must pass `activePhase` (`active.json.phase`) and add the
    live-phase divergence fixture (state.phase lags active.phase) for REQ-003/REQ-004/REQ-023.
  - TEST-018 (popover roll-up) must assert clean-`done` features are EXCLUDED (REQ-020), not merely
    "non-idle".
  - The mapper signatures changed: `isStalled` and `orkyFeatureStatus` gain an `activePhase`
    argument; `gateFrontier`/`ORKY_AUTONOMOUS_PHASES` are new exports.
  - REQ-006 now requires a **render/e2e** assertion of the actual failure styling (computed
    `background-color`), not just the pure-mapper `failed:true` (TEST-011 alone is insufficient).
- The pure module is the determinism + data-provenance anchor; build it first, TDD, fully decoupled
  from Electron and `../api`. Inject `now`, `thresholdMs`, and `activePhase`; never read the clock or
  derive the live phase from the lagging `state.json.phase` inside the mappers.
- Reuse, do not reinvent, `tab-badge.ts` aggregation and the `resolveAlerts(...).tabBadge` opt-in;
  thread the Orky needs-you the same way terminal needs-input is threaded.
- Clone `UsageTracker` structure for the tracker (slot-claim-before-await, re-check-after, debounce,
  `dispose`, `unwatch` early-return, `.json` event filter). Keep ONE watcher per resolved `.orky/`
  root (REQ-027) — do NOT spin a watcher per feature or per pane.
- Security (REQ-024..REQ-026) is main-process attack surface: validate IPC args + scope to the owning
  window (`claimPane`-style), bound `readdir`/`readFile` + realpath-guard symlinks, `CSS.escape` the
  popover selector. These are concrete, testable obligations — not "hardening to taste".
- Precedence (REQ-014) and the failure styling (REQ-006) are render-time composition over byte-status —
  keep `StatusTracker` and the CHAR tests untouched (baseline-fit obligation).
- Risk (`data-provenance`): `ORKY_PHASES` mirrors Orky's `DRIVER_WORK_PHASES` / recorded gate keys —
  NOT Orky's 9-entry `PHASE_ORDER`. REQ-029 pins the caveat so a future re-sync does not corrupt
  `gateM`/`gateN`. Tests cannot catch upstream drift; the doc records it.
