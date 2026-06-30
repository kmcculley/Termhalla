# 0004 — Orky status awareness in the pane chrome — Plan (Phase 3)

**Status:** plan iteration **2** (LOOP-BACK revision). The spec [`02-spec.md`](02-spec.md) was AMENDED at
review loop-back (ESC-001): it now has **29 REQs (REQ-001…REQ-029)** — the original 22 corrected to the
**gate-based full-roll-up** detection model, plus 7 new obligations (REQ-023..REQ-029) folding in the
security / performance / determinism / data-provenance review findings. **TASK-IDs are stable** — the
original TASK-001…TASK-019 keep their IDs and are AMENDED in place where a corrected REQ touches them;
genuinely new work is TASK-020…TASK-025.

> **An implementation ALREADY EXISTS on `main`** from the prior pass (the files in the layout table
> below). This plan describes **MODIFYING that code** to the corrected detection model + hardening — it
> is NOT greenfield. The amended TASKs say what changes vs. what shipped.

**Purely additive** to the existing system (baseline-fit obligation: no CHAR test edits,
`StatusTracker`/`needs-input.ts` untouched, `SCHEMA_VERSION` NOT bumped). Tests are re-designed in the
re-opened phase 4 — several frozen tests assert the OLD `state.json.phase` model and MUST change (see
"Notes for the test-designer").

## The core correction (human-approved, ESC-001) — gate-based full roll-up

The pure mappers (`src/shared/orky-status.ts`) and the tracker (`src/main/orky/orky-tracker.ts`) MUST stop
trusting the lagging `state.json.phase`:

- **Live phase (REQ-023):** active feature → `active.json.phase`; non-active feature → the **gate
  frontier** (phase after the highest passed canonical gate). `state.json.phase` is last-resort fallback
  only. New export `gateFrontier`; `isStalled`/`orkyFeatureStatus` gain an `activePhase` parameter.
- **needsHuman / awaiting-human (REQ-005):** derived from GATES (all autonomous gates through `doc-sync`
  passed AND `human-review` gate not passed) — works for ANY feature; NOT `phase==='human-review'` (the
  real pipeline never sets that). `done` = `human-review` gate passed.
- **The tracker MUST pass the active feature's `active.json.phase` through** to the mapper — it already
  reads `active.json` but currently discards the phase.

## Architecture fit (brownfield — `.orky/baseline/` present)

Clones the **`UsageTracker`** structure for the watcher and threads status through the existing
three-layer IPC seam. REUSES (does not reinvent):

- **`UsageTracker`** (`src/main/usage/usage-tracker.ts`) — chokidar watch + debounce + session-identity
  race pattern (claim slot BEFORE `await`, re-check `sessions.get(id) === sess` after every `await`) +
  `.jsonl` event filter + `unwatch` early-return + `dispose()` + warn-on-read-failure.
- **`UsageWatcher`** (`src/renderer/components/UsageWatcher.tsx`) — renderer cwd reconciler.
- **`chip-status.ts`** (`src/shared/chip-status.ts`) — extended additively; reused by the toolbar chip
  AND the **minimized-tray** chip (`MinimizedTray` / `MinChip`).
- **`tab-badge.ts`** — `workspaceBadgeState` folds Orky needs-you through the SAME
  `resolveAlerts(cfg.alerts).tabBadge` opt-in as terminal needs-input.
- **The IPC seam** — `ipc-contract.ts` → `register-*.ts` (via `safeSend`/`send`) → `preload/index.ts`
  → `api.ts` → `App.tsx` → `runtime-slice.ts`. No new `window` bridge (baseline REQ-002).
- **`register-pty`'s `claimPane(paneId, e.sender)`** ownership check — mirrored for `orky:watch/unwatch`
  per-window scoping (REQ-024).
- **Pane chrome** — `PaneTile.tsx` (`data-status` on `.term-tile`, `statusClass`), `PaneToolbar.tsx`
  (chip buttons), portalled overlay pattern (`Modal`/`SplitMenu`).

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Canonical phases + `ORKY_AUTONOMOUS_PHASES` + gate N/M + `gateFrontier` + live-phase + tz parse + pure mappers + raw/wire types | `src/shared/orky-status.ts` | edit (exists) |
| Wire status types carried over IPC (`OrkyFeatureStatus` incl. `reason`, `OrkyPaneStatus`, `OrkyKind`, `OrkyReason`) | `src/shared/types.ts` | edit |
| Bounded `.orky/` ancestor-walk discovery (async, non-string-safe) | `src/main/orky/find-orky-root.ts` | edit (exists) |
| Main-process watcher (clone of `UsageTracker`) | `src/main/orky/orky-tracker.ts` | edit (exists) |
| IPC channel + subscription + arg types | `src/shared/ipc-contract.ts` | edit |
| Per-domain registrar + composition (+ per-window sender ownership) | `src/main/ipc/register-orky.ts`, `src/main/ipc/register.ts`, `src/main/window-manager.ts` | edit |
| Preload bridge | `src/preload/index.ts` | edit |
| Renderer api facade | `src/renderer/api.ts` (via contract) | edit |
| Renderer watch reconciler | `src/renderer/components/OrkyWatcher.tsx`, mounted in `App.tsx` | edit |
| App subscription + per-pane store | `src/renderer/App.tsx`, `src/renderer/store/runtime-slice.ts`, `src/renderer/store/types.ts` | edit |
| Chip-status Orky variant + minimized-tray wiring | `src/shared/chip-status.ts`, `src/renderer/components/MinimizedTray.tsx`, `src/renderer/components/MinimizedPaneHost.tsx` | edit |
| Toolbar Orky chip + portalled detail popover (CSS.escape selector) | `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`, `src/renderer/components/OrkyPopover.tsx`, `src/renderer/index.css` | edit |
| Border + badge precedence over byte-status + RENDERED failure treatment | `src/renderer/components/PaneTile.tsx`, `src/renderer/components/PaneToolbar.tsx`, `src/renderer/index.css` | edit |
| Tab-badge roll-up + opt-in | `src/renderer/components/tab-badge.ts`, `src/renderer/components/WorkspaceTabs.tsx`, `tab-badge.ts` | edit |
| Docs / baseline / changelog | `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` | edit |

## Determinism / injection contract (applies to every pure mapper)

`now`, `thresholdMs`, and `activePhase` are ALWAYS passed in by the caller (the tracker injects
`Date.now()` / `120_000` / `active.json.phase`); NO mapper reads the clock, fs, `Math.random`, or
derives the live phase from the lagging `state.json.phase`. Every mapper is total over empty/malformed
input (never throws) and independent of input array order. Timestamp parsing is timezone-safe (REQ-028).
These invariants are the determinism + data-provenance anchors, unit-tested in phase 4.

---

## Tasks

### TASK-001 — Canonical `ORKY_PHASES` + `ORKY_AUTONOMOUS_PHASES`, gate N/M, the Orky wire types, provenance caveat
**Satisfies:** REQ-001, REQ-018, REQ-029 · **Files:** `src/shared/orky-status.ts`, `src/shared/types.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** determinism; provenance anchor (data-provenance)
- Define `ORKY_PHASES = ['brainstorm','spec','plan','tests','implement','review','doc-sync','human-review']`
  as a single `readonly OrkyPhase[]` (the ONE source of truth; `human-review` is a real gate counting
  toward M). `gateM = ORKY_PHASES.length` (=8).
- Add `ORKY_AUTONOMOUS_PHASES = ['brainstorm','spec','plan','tests','implement','review','doc-sync']`
  (the 7 autonomous gates through `doc-sync`, = `ORKY_PHASES` minus `human-review`) — consumed by the
  gate-based needs-human test (REQ-005).
- `gateN(gates)` = count of phases in `ORKY_PHASES` whose `gates[phase]?.passed === true`; unknown keys
  ignored, never thrown on; empty/missing `gates` → 0.
- Add the WIRE types to `src/shared/types.ts`: `OrkyKind = 'busy'|'idle'|'needs-input'|'done'|'cleared'`,
  `OrkyReason = 'escalation'|'stalled'|'human-review'|null`, `OrkyFeatureStatus` (INCLUDING the
  `reason: OrkyReason` field — surfacing the structured REQ-007 discriminator the prior pass left out of
  the spec; FINDING-QUAL-006), `OrkyPaneStatus` (exact shapes from the spec "Public interface"). Raw
  on-disk shapes (`OrkyFeatureRaw`, `OrkyFinding`, `OrkyActive`) live in `orky-status.ts`.
- **REQ-029 provenance caveat:** the `ORKY_PHASES` source comment MUST cite the EXACT mirrored source —
  the recorded `state.json.gates` keys + gatekeeper `DRIVER_WORK_PHASES` — and MUST explicitly
  distinguish it from Orky's *separate* 9-entry constant literally named "Canonical phase order"
  (`PHASE_ORDER` = `['intake',…,'human']`): `intake` (no gate) and `human` (recorded as the
  `human-review` gate key) are intentionally excluded/renamed. The comment MUST NOT label `ORKY_PHASES`
  "Canonical phase order" (the name of Orky's DIFFERENT list), so a re-sync can't prepend `intake`
  (M=9) or rename `human-review → human` (zeroing `gateN`). Corrects FINDING-PROV-001.
- Explicitly DO NOT touch `SCHEMA_VERSION` (REQ-018) — status is live runtime state, never persisted.

### TASK-002 — Total parse / normalize layer for on-disk Orky JSON (CONV-002)
**Satisfies:** REQ-019 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** totality (never throws)
- Pure normalizers turning raw `JSON.parse` output (or `undefined` on read/parse failure) into the
  safe-defaulted raw shapes: `normalizeActive`, `normalizeFeatureRaw`, `normalizeFindings`. A non-array
  findings value, missing `gates`/`escalations`, empty object, or malformed value degrades to a defined
  safe default (`gates:{}`, `escalations:[]`, `findings:[]`) — NEVER throws.
- An unreadable/malformed feature is representable as a safe `idle`-ish default so the roll-up can omit or
  safe-default it. The tracker (TASK-009) does the `try/catch` file read; this layer totalizes the value.

### TASK-003 — `openBlockingCount(findings)` (pure)
**Satisfies:** REQ-002 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** totality; no silent capping (CONV-003)
- Return count of findings with `status==='open' && (severity ∈ {CRITICAL,HIGH} || contract_violation===true)`.
- Total: non-array / `undefined` / `[]` / entries missing fields → counted as non-blocking, no throw.
  Returns the REAL count (no cap; the chip renders it verbatim).

### TASK-004 — `isStalled(...)` finished-wins, active-feature-only, 120s, off the LIVE phase (pure) — AMENDED
**Satisfies:** REQ-003, REQ-023 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001, TASK-020, TASK-025 · **Order:** 3 · **Constraints:** determinism (injected `now`/`thresholdMs`/`activePhase`)
- **Signature gains `activePhase: OrkyPhase | null`** (the tracker passes `active.json.phase` for the
  active feature, `null` otherwise). Stall executing-ness is read from the **LIVE phase** (`activePhase`),
  NOT the lagging `state.json.phase` — so a hang during the long late phases (`review`, `doc-sync`),
  where the gate hasn't passed yet, CAN now light a stall (corrects FINDING-DA-002: the prior code read
  executing-ness off `state.json.phase` and could never stall after the `implement` gate passed).
- `true` ONLY when ALL hold: feature is THE active feature (matches `active.json.feature`); its live
  phase (`activePhase`) is an executing (non-finished) phase in flight; `lastTickAt` is non-null; and
  `now - lastTickAt > thresholdMs`. Default `thresholdMs = 120_000`.
- **Finished wins:** `human-review` gate passed OR live phase not executing → never stalled. Non-active
  feature → never stalled. `lastTickAt == null` → `false` (no throw). `lastTickAt` parsed tz-safely via
  TASK-025 upstream (the tracker passes ms in).
- **Cleanups (review findings):** REMOVE the internal `normalizeFeatureRaw(feature)` call — trust the
  typed param (FINDING-QUAL-003); SIMPLIFY the call site's redundant `isActive ? lastTickAt : null`
  ternary, the guard already gates non-active (FINDING-QUAL-007).

### TASK-005 — `orkyFeatureStatus(...)`: per-feature map, gate-based, live-phase aware (pure) — AMENDED
**Satisfies:** REQ-004, REQ-005, REQ-006, REQ-023 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-020, TASK-025 · **Order:** 4 · **Constraints:** totality; actionable `detail` (CONV-001)
- **Signature gains `activePhase: OrkyPhase | null` and `isActive: boolean`.** `phase` on the output is
  the **LIVE phase** (REQ-023): active → `activePhase`; non-active → `gateFrontier(raw.gates)` (TASK-020).
  `state.json.phase` is last-resort fallback only — it MUST NOT override either (corrects FINDING-DA-002).
- **`kind` mapping:** `human-review` gate passed / pipeline complete → `done`; else `needsHuman` →
  `needs-input`; else the **active** feature with a live executing phase → `busy`; else → `idle`.
  A **non-active** feature MUST NEVER be `busy` (no per-project heartbeat / proof of life) — restricted to
  `idle`/`needs-input`/`done` (corrects FINDING-DA-005, where an abandoned non-active feature read `busy`
  forever).
- **REQ-005 `needsHuman` (GATE-BASED, not phase string):** `true` iff ANY of:
  (a) every gate in `ORKY_AUTONOMOUS_PHASES` passed AND `gates['human-review']` absent/`passed!==true`
  (awaiting-human — works for ANY feature; this is the real on-disk shape where `state.json.phase` is
  still `'doc-sync'`; corrects the CRITICAL FINDING-DA-001 where the phase-string check returned `false`);
  (b) ≥1 escalation with `status==='open'`; (c) stalled (REQ-003). A generic gate boundary MUST NOT set
  it; a gate **failure** alone MUST NOT set it. When `gates['human-review'].passed===true` → `done`,
  `needsHuman:false`. `reason` set with priority `escalation > stalled > human-review`, `null` when
  `needsHuman===false`.
- **REQ-006 `failed`** = a halted gate failure; INDEPENDENT of `needsHuman` (both MAY be true). Drives the
  RENDERED failure treatment downstream (TASK-017), never `needs-input`.
- **`lastActivityAt` sourced from on-disk evidence (REQ-004 / FINDING-DA-004):** the max of the feature's
  own `gates[*].at` timestamps (tz-safe via TASK-025), falling back to the active heartbeat `lastTickAt`
  for the active feature — so the REQ-007 recency tiebreak actually ORDERS non-active features instead of
  collapsing them all to `0`.
- `detail` is specific + actionable: names the feature slug and the reason ("…: open escalation ESC-3 —
  needs you", "…: stalled 3m — no heartbeat since 12:04", "…: awaiting human-review (gates 7/8)"), NEVER a
  bare "needs input" (CONV-001).
- Carries `gateN`/`gateM`/`openBlocking`/`phase`/`reason`/`lastActivityAt`/`failed` for the chip + selector.

### TASK-006 — `selectChipFeature(features)`: deterministic most-needs-you selector (pure)
**Satisfies:** REQ-007 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-005 · **Order:** 5 · **Constraints:** determinism (order-independent; stable tiebreak)
- Exact ordering: (1) `needsHuman===true` outranks `false`; (2) within equal `needsHuman`, stable reason
  order `escalation > stalled > human-review`; (3) most-recent `lastActivityAt` (newer first — now
  meaningful for non-active features per TASK-005); (4) `feature` id ascending as the final
  fully-deterministic tiebreak. Empty input → `null`. Result MUST be invariant under any input permutation.

### TASK-007 — `orkyPaneStatus(features)` roll-up + chip label + clean-done popover filter (pure) — AMENDED
**Satisfies:** REQ-007, REQ-008, REQ-020, REQ-021 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-006 · **Order:** 5 · **Constraints:** totality, determinism, no silent capping (CONV-003)
- Total/pure (no `Date.now`, no I/O, order-independent). Picks the chip feature via `selectChipFeature`,
  sets `kind`/`needsHuman`/`failed` from it, and the `label` as `feature · phase · gate N/M · ●k open`
  (`phase` = LIVE phase; `k = openBlocking`; the `●k open` segment omitted only when `k===0`, never a
  wrong/truncated number).
- **REQ-020 popover filter — AMENDED:** `features` lists feature whose status is **busy**, **needs-input**,
  **failed**, OR **done WITH open blocking items** (`done && openBlocking > 0`), ranked by the REQ-007
  order. A **clean `done`** (`kind==='done' && openBlocking===0`) AND `idle` are EXCLUDED — the prior
  `kind !== 'idle'` filter retained every clean done feature, accumulating 0001/0002/0003… as a wall of
  stale "done" rows (corrects the contract violation FINDING-DA-003).
- Empty input → `{kind:'idle', label:'', needsHuman:false, failed:false, features:[], chipFeature:null}`
  (chosen empty value asserted — REQ-021).

### TASK-008 — Extend `chip-status.ts` with the Orky variant AND wire it into the minimized tray — AMENDED
**Satisfies:** REQ-010 · **Files:** `src/shared/chip-status.ts`, `src/renderer/components/MinimizedTray.tsx`, `src/renderer/components/MinimizedPaneHost.tsx`
**Depends on:** TASK-001, TASK-014 · **Order:** 8 · **Constraints:** existing `chipStatus(...)` behavior UNCHANGED
- Add the Orky variant (e.g. `orkyChipStatus(orky)`) WITHOUT changing the existing `chipStatus(...)`
  mapping for non-Orky panes (its tests stay green — REQ-010 acceptance).
- **Wire it into the minimized-tray chip (`MinimizedTray` / `MinChip`):** when a minimized pane is a bound
  Orky run (`s.orky[paneId]` present), its tray chip MUST reflect the Orky kind / needs-you, not only the
  byte-derived status — corrects FINDING-QUAL-005, where `orkyChipStatus` was exported but consumed
  nowhere. The function MUST NOT be left exported-and-unused. (`MinimizedPaneHost` is the kept-mounted
  off-layout body host; the tray chip reads the same store map the toolbar chip does.)

### TASK-009 — `OrkyTracker`: bounded, debounced, race-safe, disposable, read-only watcher (main) — AMENDED
**Satisfies:** REQ-011, REQ-015, REQ-017, REQ-019, REQ-023 · **Files:** `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-002, TASK-005, TASK-007, TASK-010, TASK-020, TASK-025 · **Order:** 6 · **Constraints:** clone `UsageTracker`; CLAUDE.md long-lived-watcher gotcha
- Structural clone of `UsageTracker`: `Map<paneId, Session>`; `watch(id, cwd)` claims the slot BEFORE the
  first `await` and re-checks `sessions.get(id) === sess` after EVERY `await` (session-identity race);
  `dispose()` closes ALL watchers + clears ALL timers; no lingering timers/watchers keep the main process
  alive (e2e `close()` must not hang).
- **`unwatch(id)` MUST early-return when the pane was never watched** (`if (!this.sessions.has(id)) return`,
  mirroring `UsageTracker.unwatch`), so it emits no spurious `orky:status(id, null)` for an unknown pane
  (corrects FINDING-QUAL-002). A real unwatch stops the watch + emits cleared `null`.
- **PASS THE LIVE PHASE THROUGH (REQ-023):** the tracker reads `active.json` (slug + phase + `lastTickAt`)
  and MUST pass `active.json.phase` as `activePhase` into `orkyFeatureStatus`/`isStalled` for the active
  feature (it currently reads then DISCARDS the phase — FINDING-DA-002). Non-active features get
  `activePhase=null` and resolve live phase via `gateFrontier`.
- ONE bounded debounced chokidar watch on `<orkyRoot>/.orky/` (NOT a watcher per feature). De-dup across
  panes and event-filter live in TASK-024; resource bounds + symlink guard in TASK-022.
- On (re)read: read `active.json` + each `features/<slug>/state.json` + `findings.json` via `fs/promises`
  ONLY (REQ-015 — NO `child_process`/`execFile`/`spawn`/`node` per poll); run TASK-002 normalizers +
  TASK-005/007 mappers with injected `now=Date.now()`/`thresholdMs=120_000`/`activePhase`; emit
  `orky:status(paneId, OrkyPaneStatus)`. Warn-on-read-failure, never swallow (REQ-019).
- **Read-only (REQ-017):** never write/create/move/delete under `.orky/`. Fixture tree byte-identical
  before/after a session.
- Constructor takes injectable `now`/`thresholdMs`/`debounceMs` so phase-4 tests are deterministic.

### TASK-010 — Bounded `.orky/` ancestor-walk discovery rule — AMENDED
**Satisfies:** REQ-012 · **Files:** `src/main/orky/find-orky-root.ts`
**Depends on:** — · **Order:** 4 · **Constraints:** deterministic + BOUNDED; async fs; non-string-safe
- `findOrkyRoot(cwd, { maxDepth }): Promise<string | null>` — from `cwd`, check `cwd/.orky/` then walk UP
  a BOUNDED number of ancestors (fixed cap, e.g. 8 levels) checking each for `.orky/`. Returns the first
  ancestor containing `.orky/`, or `null`. Deterministic; stops at the cap or filesystem root.
- **Use async `fs.promises.stat`, not `statSync`** (the caller already `await`s `watch()`) so the bounded
  walk never blocks the main event loop / PTY routing on slow/networked FS (corrects FINDING-QUAL-004 /
  FINDING-PERF-004).
- **Non-string-safe (REQ-024 support):** a non-string `cwd` (or non-string `dir` during the walk) MUST
  degrade to `null` rather than throwing a `TypeError` (which would surface as an unhandled rejection —
  FINDING-SEC-001). Guard before `join`/`dirname`.
- Used by `OrkyTracker.watch`: `null` → emit cleared and hold no watcher; non-null → watch that root.

### TASK-011 — IPC contract: `orky:status` push + `orky:watch`/`orky:unwatch` + `onOrkyStatus`
**Satisfies:** REQ-012, REQ-013 · **Files:** `src/shared/ipc-contract.ts`, `src/shared/types.ts`
**Depends on:** TASK-001 · **Order:** 6 · **Constraints:** follow the existing contract pattern (baseline REQ-002)
- Add to `CH`: `orkyStatus: 'orky:status'` (main→renderer event, pane-scoped — first arg paneId so
  `send`/`isPaneScoped` routes it to the owning window), `orkyWatch: 'orky:watch'`,
  `orkyUnwatch: 'orky:unwatch'` (renderer→main), mirroring `usageWatch`/`usageUnwatch`/`usageMetrics`.
- Add to `TermhallaApi`: `orkyWatch(id, cwd): void`, `orkyUnwatch(id): void`,
  `onOrkyStatus(cb: (paneId: string, status: OrkyPaneStatus | null) => void): () => void`. `null` payload =
  cleared (REQ-012). No other `window` bridge.

### TASK-012 — `register-orky.ts` registrar + compose into `register.ts`
**Satisfies:** REQ-011, REQ-012, REQ-013 · **Files:** `src/main/ipc/register-orky.ts`, `src/main/ipc/register.ts`
**Depends on:** TASK-009, TASK-011 · **Order:** 7 · **Constraints:** emit via the routed `send` (`safeSend`); disposer registered
- `registerOrky(send, win): Disposer` mirroring `registerUsage`: construct
  `OrkyTracker((id, status) => send(CH.orkyStatus, id, status))`, wire `ipcMain.on(CH.orkyWatch, …)` /
  `ipcMain.on(CH.orkyUnwatch, …)`, return `() => { removeListener(...); tracker.dispose() }`.
- Add to the `disposers` array in `register.ts` (so `onAllWindowsClosed` disposes it — teardown
  obligation). The per-window sender ownership + arg validation are TASK-021.

### TASK-013 — Preload bridge for the Orky channels
**Satisfies:** REQ-013 · **Files:** `src/preload/index.ts`
**Depends on:** TASK-011 · **Order:** 7 · **Constraints:** typed bridge only (contextIsolation)
- Add `orkyWatch: (id, cwd) => ipcRenderer.send(CH.orkyWatch, id, cwd)`,
  `orkyUnwatch: (id) => ipcRenderer.send(CH.orkyUnwatch, id)`,
  `onOrkyStatus: pushChannel<[string, OrkyPaneStatus | null]>(CH.orkyStatus)` — mirroring usage exactly.

### TASK-014 — Renderer store: per-pane Orky status in `runtime-slice.ts` + App subscription
**Satisfies:** REQ-013 · **Files:** `src/renderer/store/runtime-slice.ts`, `src/renderer/store/types.ts`, `src/renderer/App.tsx`
**Depends on:** TASK-011, TASK-013 · **Order:** 8 · **Constraints:** mirror `setUsage`/`onUsageMetrics`
- `runtime-slice.ts`: add `orky: Record<string, OrkyPaneStatus>` + `setOrky(id, status)` (delete the key on
  `null` — cleared, mirroring `setUsage`/`setGitStatus`). Declare in `store/types.ts`.
- `App.tsx`: add `api.onOrkyStatus((id, st) => s().setOrky(id, st))` to the `offs` subscription array.

### TASK-015 — `OrkyWatcher` reconciler: auto-bind/teardown on pane cwd
**Satisfies:** REQ-012 · **Files:** `src/renderer/components/OrkyWatcher.tsx`, `src/renderer/App.tsx` (mount)
**Depends on:** TASK-013, TASK-014 · **Order:** 8 · **Constraints:** mirror `UsageWatcher`; clean teardown
- Clone `UsageWatcher`: reconcile `orky:watch`/`orky:unwatch` from `cwds` for every TERMINAL pane with a
  cwd (no AI-session filter — main does `.orky/` discovery + emits cleared if absent). Watch on
  cwd-appear/change, unwatch on cwd-clear/pane-close; release all watches on unmount. Mount beside
  `<UsageWatcher/>`.
- Result: a pane entering an `.orky/` project auto-shows the chip/border; leaving it emits
  `orky:status(null)` → store clears → chrome reverts to byte-status (REQ-012 acceptance).

### TASK-016 — Toolbar Orky chip + `<body>`-portalled detail popover
**Satisfies:** REQ-008, REQ-020 · **Files:** `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`, `src/renderer/components/OrkyPopover.tsx`, `src/renderer/index.css`
**Depends on:** TASK-007, TASK-014 · **Order:** 9 · **Constraints:** portal-to-`<body>` (overlay-in-mosaic-tile gotcha); paint-only focus/hover allow-list (CONV-007)
- In `PaneTile`, read `s.orky[paneId]`; when present pass it to `PaneToolbar`, which renders an Orky chip
  button (`orky-chip-${paneId}`, label = `OrkyPaneStatus.label`, REQ-008 format) ALONGSIDE the existing ✨
  AI chip + git/process chips (complementary, not replacing — REQ-014). The chip toggles a new `'orky'`
  `PaneMenu`.
- `OrkyPopover.tsx`: lists `paneStatus.features` (already filtered to exclude clean-done + idle per REQ-020
  in TASK-007) — phase, gate N/M, open count, needs-you reason — in REQ-007 ranking order. Because it
  opens from inside a react-mosaic tile it MUST `createPortal` to `<body>` (CLAUDE.md overlay gotcha — it
  portals like `Modal`/`SplitMenu`). Add its `data-testid` (e.g. `orky-menu`) to the chrome
  focus-visible/hover allow-lists in `index.css` (paint-only — never change the box). Selector escaping is
  TASK-023.

### TASK-017 — Border + tab-badge precedence + RENDERED failure treatment (render-time composition) — AMENDED
**Satisfies:** REQ-006, REQ-014 · **Files:** `src/renderer/components/PaneTile.tsx`, `src/renderer/components/PaneToolbar.tsx`, `src/renderer/index.css`
**Depends on:** TASK-014 · **Order:** 9 · **Constraints:** byte-status computation UNCHANGED (baseline REQ-004); ✨ chip stays
- In `PaneTile`, when `s.orky[paneId]` is present (bound Orky run), DERIVE the rendered `state` used for
  `statusClass` (`MosaicWindow` className) and `data-status` on `.term-tile` from the Orky kind with
  PRECEDENCE over `status?.state` (REQ-014). The byte-derived `status` object is NOT recomputed — pure
  render-time composition. When `orky[paneId]` is absent/cleared, fall back to byte-derived `state` as
  today. The ✨ AI chip + context-% (`chipText`) remain rendered.
- **REQ-006 RENDERABLE failure (corrects HIGH contract violation FINDING-UX-001):** the canonical failed
  feature maps to `kind:'idle'`, so the failure styling MUST WIN at render over the `!important` idle
  toolbar background. Carry it on a dedicated `term-failure` marker whose `background-color` has CSS
  precedence over the idle rule — via `!important` AND/OR by EXCLUDING `.term-failure` from the idle
  `:not(.term-busy):not(.term-needs-input)` background rule in `index.css` — so the red accent appears for
  the **failed-AND-idle** pane (exactly what a halted gate failure produces; the prior non-`!important`
  rule rendered nowhere). `failed` and `needsHuman` are independent flags and MAY both be true.
- **Non-color affordance (WCAG 1.4.1 / FINDING-UX-002):** add a non-color failure marker on the chip
  (glyph/text prefix the way needs-human adds 🔔, or a styled visible treatment for `data-failed`), not
  color alone.
- **Acceptance carries a render/e2e assertion** (not just the pure mapper): a failed-AND-idle Orky pane's
  computed toolbar `background-color` resolves to `var(--status-failure)`, not `var(--panel)`.

### TASK-018 — Workspace tab-badge roll-up + opt-in gating
**Satisfies:** REQ-009, REQ-016 · **Files:** `src/renderer/components/tab-badge.ts`, `src/renderer/components/WorkspaceTabs.tsx`
**Depends on:** TASK-014 · **Order:** 9 · **Constraints:** reuse `resolveAlerts(cfg.alerts).tabBadge`; opt-in MUST NOT hide failure styling (CONV-004)
- Extend `workspaceBadgeState` (and its callers/signature) to accept the per-pane Orky map and fold an
  Orky pane whose roll-up has ANY `needsHuman` feature into `needs`, the SAME way a terminal `needs-input`
  pane contributes, gated by the SAME `resolveAlerts(cfg.alerts).tabBadge` opt-in (REQ-016). A non-Orky
  pane (or one with only idle/busy/done features) contributes nothing.
- The opt-in governs ONLY the tab-badge summary — it never suppresses the pane's Orky chip or the failure
  treatment (TASK-016/TASK-017 stay visible regardless — CONV-004).

### TASK-019 — Documentation, CHANGELOG, baseline reconcile + provenance caveat (doc-drift) — AMENDED
**Satisfies:** REQ-022, REQ-029 · **Files:** `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md`
**Depends on:** all functional tasks · **Order:** last · **Constraints:** grep `docs/`+`CLAUDE.md`+`.orky/baseline/` for stale claims (CONV-008)
- `docs/features/orky-status.md`: the read-only status mirror, the `orky:status`/`orky:watch`/`orky:unwatch`
  channels + types, the gate-based detection model (live phase, gate-frontier, gate-based needs-human),
  the watcher/precedence/badge model, and the **REQ-029 provenance caveat**: `ORKY_PHASES` mirrors the
  recorded `state.json.gates` keys + gatekeeper `DRIVER_WORK_PHASES` — NOT Orky's separate 9-entry
  `PHASE_ORDER` — and `intake`/`human` are deliberately excluded/renamed. Tests cannot catch upstream
  drift; the doc records it. Replace the placeholder `https://github.com/` link (FINDING-DOC-002).
- **Reconcile `.orky/baseline/architecture.md` (REQ-022 / FINDING-DOC-001 — the prior pass skipped it):**
  add the new privileged `src/main/orky/` subsystem (read-only `.orky/` chokidar watcher + fs reads),
  the `orky:status` channel, and the render-time precedence of Orky status over byte-derived
  `TerminalStatus` for the pane border / tab badge.
- Link the feature doc from the CLAUDE.md "Where things live" table; record the feature in
  `CHANGELOG.md [Unreleased]`; reflect the new IPC channels/types wherever channels are documented. Grep
  the docs tree + `CLAUDE.md` + `.orky/baseline/` for stale phrasings before finishing (CONV-008).

---

### TASK-020 — `gateFrontier` + live-phase resolution (pure foundation) — NEW
**Satisfies:** REQ-023 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** totality (never throws); determinism
- Export `gateFrontier(gates: unknown): OrkyPhase | null` — the phase in `ORKY_PHASES` immediately AFTER
  the highest canonical gate with `passed===true`: gates through `implement` passed → `'review'`; `{}` →
  `'brainstorm'`; all 8 passed → `null` (complete). Total: unknown/empty/malformed gates → defined value,
  never a throw.
- Define the **live-phase resolution** consumed by TASK-004/005/007/009: for the active feature the live
  phase is `active.json.phase` (passed in as `activePhase`); for a non-active feature it is
  `gateFrontier(raw.gates)`. `state.json.phase` is a last-resort fallback ONLY and MUST NOT override
  either (corrects FINDING-DA-002). This live phase is what REQ-004/REQ-008 surface as `phase`.

### TASK-021 — IPC boundary: input validation + per-window sender ownership (security) — NEW
**Satisfies:** REQ-024 · **Files:** `src/main/ipc/register-orky.ts`, `src/main/orky/find-orky-root.ts`, `src/main/window-manager.ts`
**Depends on:** TASK-012 · **Order:** 7 · **Constraints:** mirror `register-pty`'s `claimPane(paneId, e.sender)`
- **Arg validation:** in the `orky:watch`/`orky:unwatch` handlers, `if (typeof id !== 'string' || typeof
  cwd !== 'string') return;` BEFORE `orky.watch(id, cwd)`, so a malformed IPC message cannot produce an
  unhandled promise rejection that crashes the main process (Node 22 `--unhandled-rejections=throw`;
  corrects FINDING-SEC-001). `findOrkyRoot` already degrades to `null` on non-string input (TASK-010).
- **Per-window sender ownership:** because `ipcMain.on` is process-global, each handler MUST act ONLY for
  events whose `sender` belongs to its own `BrowserWindow` (mirroring `register-pty`'s `claimPane` —
  e.g. `BrowserWindow.fromWebContents(e.sender) === win`, or named per-window listeners removed in the
  disposer). With N windows a `watch`/`unwatch` from one window MUST NOT open spurious watchers in,
  disclose status to, or cancel watches in another window (corrects FINDING-SEC-002 cross-window
  disclosure).

### TASK-022 — Read-path resource bounds + symlink realpath guard (security) — NEW
**Satisfies:** REQ-025 · **Files:** `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-009 · **Order:** 7 · **Constraints:** every cap is a STATED limit with a test (CONV-003)
- (a) **Feature-dir count cap:** `slugs.slice(0, 200)` (a stated constant) with a warning log, so an
  adversarial `features/` tree with thousands of dirs cannot occupy the re-read coroutine for seconds
  (FINDING-SEC-003).
- (b) **File-size cap:** check `stat.size` before `readFile` and skip+warn any `state.json`/`findings.json`
  above a fixed cap (e.g. 1 MiB), so a multi-hundred-MiB file cannot drive a GiB-class main-process
  allocation; the feature safe-defaults, others still report (FINDING-SEC-003).
- (c) **Symlink guard:** `realpath`-guard (or `lstat` + skip symlinks on) each `features/<slug>` entry,
  verifying the resolved path stays inside the resolved `.orky/` root before reading beneath it, so a
  symlink under `features/` cannot redirect a read outside the project (FINDING-SEC-004).

### TASK-023 — `CSS.escape` the popover querySelector paneId (security) — NEW
**Satisfies:** REQ-026 · **Files:** `src/renderer/components/OrkyPopover.tsx`
**Depends on:** TASK-016 · **Order:** 9 · **Constraints:** no dependency on the UUID invariant
- Build the positioning selector via `CSS.escape`:
  `document.querySelector(\`[data-testid="orky-chip-${CSS.escape(paneId)}"]\`)`, so a pane id containing
  CSS-reserved characters (`"`, `]`, `\`, …) cannot throw a `DOMException: SyntaxError` that crashes the
  `useLayoutEffect` positioning and blanks the popover (FINDING-SEC-005). The selector MUST NOT rely on
  pane ids being UUIDs.

### TASK-024 — chokidar `.json` event filter + per-`.orky/`-root watch/read de-dup (performance) — NEW
**Satisfies:** REQ-027 · **Files:** `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-009 · **Order:** 7 · **Constraints:** preserve per-pane emit granularity (REQ-013)
- **Event filter:** the chokidar handler MUST filter to the target basenames (`active.json`,
  `state.json`, `findings.json` — i.e. `.json`/basename filtering) BEFORE scheduling a re-read, so routine
  edits to the many non-target artifacts under `features/<slug>/` (`01-concept.md`, `02-spec.md`, plan/
  test/findings markdown) do NOT fire a full roll-up re-read (mirrors `UsageTracker`'s `.jsonl` guard;
  corrects FINDING-PERF-001).
- **Per-root de-dup:** maintain ONE chokidar watcher + ONE debounced re-read per resolved `.orky/` root,
  fanning the computed status out to every paneId bound to that root, rather than P independent watchers +
  P× file-read amplification for identical data (corrects FINDING-PERF-002). Two panes whose cwds resolve
  to the same root share a single watcher/read, yet both panes still receive their own `orky:status`
  emit.

### TASK-025 — Timezone-safe timestamp parsing (determinism) — NEW
**Satisfies:** REQ-028 · **Files:** `src/shared/orky-status.ts`, `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure, no clock read; injected into mappers as ms
- Add a pure `parseOrkyTimestamp(s): number | null` in `orky-status.ts` that parses all Orky timestamps
  (`active.json.lastTickAt`, `gates[*].at`, escalation timestamps) timezone-safely: a tz-less ISO string
  (no `Z`/offset) MUST NOT be interpreted in the machine's local timezone (the `Date.parse` default) — it
  MUST be treated as UTC (or rejected to `null`). A `Z`/offset timestamp is unaffected. Identical bytes →
  identical epoch ms on any machine, so stall (REQ-003) and recency-ordering (REQ-004/007) are
  TZ/DST-independent (corrects FINDING-DET-001).
- The tracker (TASK-009) and the `lastActivityAt` derivation (TASK-005) consume this helper instead of raw
  `Date.parse`.

---

## Sequencing summary

```
TASK-001 (ORKY_PHASES + ORKY_AUTONOMOUS_PHASES + gate N/M + wire types + provenance caveat)
  ├─ TASK-002 (parse/normalize totality)
  ├─ TASK-003 (openBlockingCount)
  ├─ TASK-020 (gateFrontier + live-phase resolution)            [NEW · REQ-023]
  ├─ TASK-025 (tz-safe timestamp parse)                          [NEW · REQ-028]
  ├─ TASK-010 (.orky bounded async ancestor-walk, non-string-safe)
  └─ TASK-004 (isStalled, activePhase)  [needs 020/025]
        └─ TASK-005 (orkyFeatureStatus, gate-based, live-phase)  [needs 002/003/004/020/025]
              └─ TASK-006 (selectChipFeature)
                    └─ TASK-007 (orkyPaneStatus + label + clean-done filter)
TASK-009 (OrkyTracker; pass activePhase; unwatch early-return)   [needs 002/005/007/010/020/025]
  ├─ TASK-022 (read-path bounds + symlink guard)                 [NEW · REQ-025]
  └─ TASK-024 (.json event filter + per-root de-dup)             [NEW · REQ-027]
TASK-011 (IPC contract)
  ├─ TASK-012 (register-orky + compose)  [needs 009]
  │     └─ TASK-021 (arg validation + per-window sender ownership)  [NEW · REQ-024]
  ├─ TASK-013 (preload bridge)
  └─ TASK-014 (store + App subscription)
        ├─ TASK-008 (chip-status Orky variant + minimized-tray wiring)  [needs 014]
        ├─ TASK-015 (OrkyWatcher reconciler)
        ├─ TASK-016 (toolbar chip + portalled popover)
        │     └─ TASK-023 (CSS.escape popover selector)          [NEW · REQ-026]
        ├─ TASK-017 (border/badge precedence + RENDERED failure)
        └─ TASK-018 (tab-badge roll-up + opt-in)
TASK-019 (docs + baseline reconcile + provenance caveat)  ── after all functional tasks
```

## Risk notes

1. **Lagging `state.json.phase` (the loop-back defect)** — TASK-020/004/005/009 move live-phase + stall +
   needs-human onto gates / `active.json.phase`; `state.json.phase` is fallback-only. This is the
   human-approved ESC-001 correction.
2. **`ORKY_PHASES` drift (data-provenance)** — TASK-001 is the single source of truth with the REQ-029
   provenance caveat distinguishing Orky's separate 9-entry `PHASE_ORDER`; TASK-019 documents that
   upstream drift is a manual data update (untestable).
3. **Main-process attack surface (security)** — TASK-021 (arg validation + per-window ownership),
   TASK-022 (readdir/readFile bounds + symlink realpath guard), TASK-023 (`CSS.escape`) are concrete,
   testable obligations.
4. **Watcher cost (performance)** — TASK-024 mandates a `.json` event filter + one watcher/read per
   resolved root; TASK-009 keeps `fs/promises` reads only (no per-poll `node` spawn — REQ-015).
5. **Baseline-fit** — no CHAR test edits; `StatusTracker`/`needs-input.ts` untouched; precedence
   (TASK-017) is render-time composition; `SCHEMA_VERSION` NOT bumped (TASK-001). If implementation finds
   a CHAR test must change, STOP — the change isn't purely additive.

## Notes for the test-designer (re-opened phase 4)

Several frozen phase-4 tests assert the OLD `state.json.phase` model and MUST be updated:
- **TEST-005/006/007** (stall + busy): pass `activePhase` (`active.json.phase`); add the live-phase
  divergence fixture (`state.json.phase` lags `active.json.phase`) for REQ-003/REQ-004/REQ-023.
- **TEST-008/009** (was "human-review *phase*"): key on **gates** (`human-review` gate passed/pending),
  NOT `state.json.phase === 'human-review'`. Fixtures must use the REAL shape:
  `state.json.phase==='doc-sync'` + `human-review` gate absent → `needsHuman:true, reason:'human-review'`.
- **TEST-018** (popover roll-up): assert clean-`done` features are EXCLUDED (REQ-020), not merely "non-idle".
- **TEST-011** (failure): REQ-006 now needs a **render/e2e** assertion of the actual failure styling
  (computed `background-color` = `var(--status-failure)`), not just the pure-mapper `failed:true`.
- Mapper signatures changed: `isStalled`/`orkyFeatureStatus` gain `activePhase`; `gateFrontier`,
  `ORKY_AUTONOMOUS_PHASES`, `parseOrkyTimestamp` are new exports.
- **New tests for REQ-023..REQ-029:** `gateFrontier`/live-phase (REQ-023), IPC arg-validation +
  per-window sender ownership in the main/integration harness (REQ-024), readdir/readFile caps + symlink
  skip (REQ-025), `CSS.escape` popover selector with a CSS-special paneId (REQ-026), `.json` event filter
  + per-root watcher de-dup (REQ-027), tz-safe timestamp parse under a non-UTC `TZ` (REQ-028), and the
  `ORKY_PHASES` provenance-caveat docs assertion (REQ-029).

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-029 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen at 29 REQs.
