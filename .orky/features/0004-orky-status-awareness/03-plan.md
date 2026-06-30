# 0004 — Orky status awareness in the pane chrome — Plan (Phase 3)

**Status:** plan iteration 1. The spec [`02-spec.md`](02-spec.md) is FROZEN (22 REQs, REQ-001…REQ-022).
This plan decomposes it into atomic, dependency-ordered TASKs an implementer follows against the frozen
phase-4 test suite. **Purely additive** to the existing system (baseline-fit obligation: no CHAR test
edits, `StatusTracker`/`needs-input.ts` untouched, `SCHEMA_VERSION` NOT bumped). Tests are filled in
phase 4 (`tests` arrays in `traceability.json` are intentionally empty now).

## Architecture fit (brownfield — `.orky/baseline/` present)

This feature clones the **`UsageTracker`** structure for the main-process watcher and threads status
through the existing three-layer IPC seam. It REUSES (does not reinvent):

- **`UsageTracker`** (`src/main/usage/usage-tracker.ts`) — chokidar watch + debounce + session-identity
  race pattern (claim the map slot BEFORE `await`, re-check `sessions.get(id) === sess` after every
  `await`) + `dispose()` closing all watchers + warn-on-read-failure. The Orky tracker is a structural
  clone watching `<projectRoot>/.orky/` instead of the Claude transcript dir.
- **`UsageWatcher`** (`src/renderer/components/UsageWatcher.tsx`) — the renderer reconciler that drives
  `usage:watch`/`usage:unwatch` from `cwds`. The Orky watcher mirrors it (keyed on every terminal pane's
  cwd; no AI-session filter — main decides whether `.orky/` exists).
- **`chip-status.ts`** (`src/shared/chip-status.ts`) — extended additively for the Orky variant; reused
  by the toolbar chip and the minimized-tray chip.
- **`tab-badge.ts`** (`src/renderer/components/tab-badge.ts`) — `workspaceBadgeState`/`tabBadge` extended
  to fold Orky needs-you through the SAME `resolveAlerts(cfg.alerts).tabBadge` opt-in as terminal needs.
- **The IPC seam** — `ipc-contract.ts` (`CH`, `TermhallaApi`) → `register-*.ts` (composed by
  `register.ts`, emit via `safeSend`/`send`) → `preload/index.ts` (`pushChannel`) → `api.ts` →
  `App.tsx` subscription → `runtime-slice.ts` per-pane state. No new `window` bridge (baseline REQ-002).
- **Pane chrome** — `PaneTile.tsx` (`data-status` on `.term-tile`, `statusClass` on `MosaicWindow`),
  `PaneToolbar.tsx` (chip buttons), `GitPopover.tsx`/`ProcessPopover.tsx` (in-tile popover pattern).

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Canonical phases + gate N/M + pure mappers + raw/wire types | `src/shared/orky-status.ts` | **new** |
| Wire status types carried over IPC | `src/shared/types.ts` (`OrkyFeatureStatus`, `OrkyPaneStatus`, `OrkyKind`) | edit |
| Bounded `.orky/` ancestor-walk discovery (pure-ish fs helper) | `src/main/orky/find-orky-root.ts` | **new** |
| Main-process watcher (clone of `UsageTracker`) | `src/main/orky/orky-tracker.ts` | **new** |
| IPC channel + subscription + arg types | `src/shared/ipc-contract.ts` (`CH.orkyStatus`, `CH.orkyWatch`, `CH.orkyUnwatch`, `onOrkyStatus`) | edit |
| Per-domain registrar + composition | `src/main/ipc/register-orky.ts` (**new**), `src/main/ipc/register.ts` | new/edit |
| Preload bridge | `src/preload/index.ts` | edit |
| Renderer api facade | `src/renderer/api.ts` (type only — `window.termhalla`) via contract | edit (contract) |
| Renderer watch reconciler | `src/renderer/components/OrkyWatcher.tsx` (**new**), mounted beside `UsageWatcher` | new/edit |
| App subscription + per-pane store | `src/renderer/App.tsx`, `src/renderer/store/runtime-slice.ts`, `src/renderer/store/types.ts` | edit |
| Chip-status Orky variant | `src/shared/chip-status.ts` | edit |
| Toolbar Orky chip + portalled detail popover | `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`, `src/renderer/components/OrkyPopover.tsx` (**new**), `src/renderer/index.css` | new/edit |
| Border + badge precedence over byte-status | `src/renderer/components/PaneTile.tsx` | edit |
| Tab-badge roll-up + opt-in | `src/renderer/components/tab-badge.ts` | edit |
| Docs / baseline / changelog | `docs/features/orky-status.md` (**new**), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` | new/edit |

## Determinism / injection contract (applies to every pure mapper)

`now` and `thresholdMs` are ALWAYS passed in from the caller (the tracker injects `Date.now()` /
`120_000`); NO mapper reads the clock, fs, or `Math.random`. Every mapper is total over empty/malformed
input (never throws). Mappers do not depend on input array order. These invariants are the determinism +
data-provenance anchors and are unit-tested in phase 4.

---

## Tasks

### TASK-001 — Canonical `ORKY_PHASES`, gate N/M, and the Orky wire types (pure foundation)
**Satisfies:** REQ-001, REQ-018 · **Files:** `src/shared/orky-status.ts`, `src/shared/types.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** determinism; provenance anchor (data-provenance)
- Define `ORKY_PHASES = ['brainstorm','spec','plan','tests','implement','review','doc-sync','human-review']`
  as a single `readonly OrkyPhase[]` (the ONE source of truth; `human-review` is a real gate counting
  toward M). `gateM = ORKY_PHASES.length` (=8).
- `gateN(gates)` = count of phases in `ORKY_PHASES` whose `gates[phase]?.passed === true`; unknown keys
  ignored, never thrown on; empty/missing `gates` → 0.
- Add the WIRE types to `src/shared/types.ts`: `OrkyKind = 'busy'|'idle'|'needs-input'|'done'|'cleared'`,
  `OrkyFeatureStatus`, `OrkyPaneStatus` (exact shapes from the spec "Public interface"). Add raw on-disk
  shapes (`OrkyFeatureRaw`, `OrkyFinding`, `OrkyActive`) in `orky-status.ts` (parse-layer types).
- Explicitly DO NOT touch `SCHEMA_VERSION` (REQ-018) — assert this in the diff; status is live runtime
  state, never persisted.

### TASK-002 — Total parse / normalize layer for on-disk Orky JSON (CONV-002)
**Satisfies:** REQ-019 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** totality (never throws)
- Pure normalizers turning raw `JSON.parse` output (or `undefined` on a read/parse failure) into the
  safe-defaulted raw shapes: `normalizeActive`, `normalizeFeatureRaw`, `normalizeFindings`. A non-array
  findings value, missing `gates`/`escalations`, empty object, or malformed value degrades to a defined
  safe default (`gates:{}`, `escalations:[]`, `findings:[]`) — NEVER throws.
- An unreadable/malformed feature is representable as a safe `idle`-ish default so the roll-up can omit or
  safe-default it (REQ-019 acceptance: malformed `state.json` → that feature skipped/safe, others still
  report). The tracker (TASK-009) does the `try/catch` file read; this layer totalizes the parsed value.

### TASK-003 — `openBlockingCount(findings)` (pure)
**Satisfies:** REQ-002 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** totality; no silent capping (CONV-003)
- Return count of findings with `status==='open' && (severity ∈ {CRITICAL,HIGH} || contract_violation===true)`.
- Total: non-array / `undefined` / `[]` / entries missing fields → counted as non-blocking, no throw.
  Returns the REAL count (no cap; the chip renders it verbatim).

### TASK-004 — `isStalled(...)` finished-wins, active-feature-only, 120s (pure)
**Satisfies:** REQ-003 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** determinism (injected `now`/`thresholdMs`)
- `true` ONLY when ALL hold: feature is THE active feature (matches `active.json.feature`), it has an
  executing (non-finished) phase in flight, `lastTickAt` is non-null, and `now - lastTickAt > thresholdMs`.
- Default `thresholdMs = 120_000`. **Finished wins:** `human-review` passed OR no active executing phase →
  never stalled. Non-active feature → never stalled. `lastTickAt == null` → `false` (no throw).

### TASK-005 — `orkyFeatureStatus(...)`: per-feature map into the terminal-status model (pure)
**Satisfies:** REQ-004, REQ-005, REQ-006 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004 · **Order:** 3 · **Constraints:** totality; actionable `detail` (CONV-001)
- Total pure map → `OrkyFeatureStatus`. `kind` mapping: executing phase in flight → `busy`; `needsHuman`
  → `needs-input`; `human-review` passed / pipeline complete → `done`; else → `idle`.
- **REQ-005 `needsHuman`** = `true` iff current phase is `human-review` OR ≥1 escalation with
  `status==='open'` OR stalled (REQ-003). A generic gate boundary MUST NOT set it (full-auto auto-passes);
  a gate **failure** alone MUST NOT set it.
- **REQ-006 `failed`** = a halted gate failure; independent of `needsHuman` (both MAY be true). Drives the
  `lastExit:'failure'` border styling downstream (TASK-017), never `needs-input`.
- `detail` is specific + actionable: names the feature slug and the reason (escalation id / "stalled Nm —
  no heartbeat since …" / "human-review"), NEVER a bare "needs input" (CONV-001).
- Carries `gateN`/`gateM`/`openBlocking`/`phase`/`lastActivityAt` for the chip + selector.

### TASK-006 — `selectChipFeature(features)`: deterministic most-needs-you selector (pure)
**Satisfies:** REQ-007 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-005 · **Order:** 4 · **Constraints:** determinism (order-independent; stable tiebreak)
- Exact ordering: (1) `needsHuman===true` outranks `false`; (2) within equal `needsHuman`, stable reason
  order `escalation > stalled > human-review`; (3) most-recent `lastActivityAt` (newer first); (4)
  `feature` id ascending as the final fully-deterministic tiebreak. Empty input → `null`. Result MUST be
  invariant under any input permutation.

### TASK-007 — `orkyPaneStatus(features)` roll-up + chip label format (pure)
**Satisfies:** REQ-007, REQ-008, REQ-021 · **Files:** `src/shared/orky-status.ts`
**Depends on:** TASK-006 · **Order:** 4 · **Constraints:** totality, determinism, no silent capping (CONV-003)
- Total/pure (no `Date.now`, no I/O, order-independent). Picks the chip feature via `selectChipFeature`,
  sets `kind`/`needsHuman`/`failed` from it, and the `label` as `feature · phase · gate N/M · ●k open`
  (`k = openBlocking`; the `●k open` segment omitted only when `k===0`, never a wrong/truncated number).
- `features` = ALL non-Idle features for the popover (REQ-020 consumer), ranked by the REQ-007 order.
  Empty input → `{kind:'idle', label:'', needsHuman:false, failed:false, features:[], chipFeature:null}`
  (chosen empty value asserted — REQ-021).

### TASK-008 — Extend `chip-status.ts` with the Orky variant (additive)
**Satisfies:** REQ-010 · **Files:** `src/shared/chip-status.ts`
**Depends on:** TASK-001 · **Order:** 4 · **Constraints:** existing `chipStatus(...)` behavior UNCHANGED
- Add an Orky variant (e.g. an optional `orky?: OrkyPaneStatus` input or a sibling `orkyChipStatus`) so the
  toolbar chip AND the minimized-tray chip can render an Orky run's kind WITHOUT changing the existing
  `chipStatus` mapping for non-Orky panes (its current tests stay green — REQ-010 acceptance).

### TASK-009 — `OrkyTracker`: bounded, debounced, race-safe, disposable, read-only watcher (main)
**Satisfies:** REQ-011, REQ-015, REQ-017, REQ-019 · **Files:** `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-002, TASK-005, TASK-007, TASK-010 · **Order:** 5 · **Constraints:** clone `UsageTracker`; CLAUDE.md long-lived-watcher gotcha
- Structural clone of `UsageTracker`: `Map<paneId, Session>`; `watch(id, cwd)` claims the slot BEFORE the
  first `await` and re-checks `sessions.get(id) === sess` after EVERY `await` (session-identity race);
  `unwatch(id)` stops + emits cleared `null`; `dispose()` closes ALL watchers + clears ALL timers; no
  lingering timers/watchers keep the main process alive (e2e `close()` must not hang).
- **ONE bounded debounced chokidar watch** on `<orkyRoot>/.orky/` (NOT a watcher per feature — REQ-011 /
  performance risk #3). Use a small recursive `depth` sufficient to cover `active.json`,
  `features/*/state.json`, `features/*/findings.json`; coalesce events with a debounce timer (mirror
  `schedule`/`reparse`).
- On (re)read: read `active.json` + each `features/<slug>/state.json` + `findings.json` via
  `fs/promises` ONLY (REQ-015 — NO `child_process`/`execFile`/`spawn`/`node` per poll); run TASK-002
  normalizers + TASK-005/007 mappers with injected `now=Date.now()` and `thresholdMs=120_000`; emit
  `orky:status(paneId, OrkyPaneStatus)`. Warn-on-read-failure like `UsageTracker`, never swallow silently
  (REQ-019).
- **Read-only (REQ-017):** never write/create/move/delete under `.orky/`. Watcher opens read-only; the
  fixture tree is byte-identical before/after a session.
- Constructor takes injectable `now`/`thresholdMs`/`debounceMs` so phase-4 tests are deterministic.

### TASK-010 — Bounded `.orky/` ancestor-walk discovery rule
**Satisfies:** REQ-012 · **Files:** `src/main/orky/find-orky-root.ts`
**Depends on:** — · **Order:** 4 · **Constraints:** deterministic + BOUNDED (risk #1: do not walk to FS root unbounded)
- `findOrkyRoot(cwd, { maxDepth }): string | null` — from `cwd`, check `cwd/.orky/` then walk UP a
  BOUNDED number of ancestors (define a fixed cap, e.g. 8 levels) checking each for `.orky/`. Returns the
  first ancestor containing `.orky/`, or `null`. Deterministic; stops at the cap or filesystem root,
  whichever first. This resolves the spec's "a directory whose tree contains `.orky/`" (REQ-012) to a
  bounded upward search keyed on the pane's tracked cwd (OSC 7 / OSC 9;9).
- Used by `OrkyTracker.watch`: `null` → emit cleared (`orky:status(null)`) and hold no watcher; non-null →
  watch that root's `.orky/`.

### TASK-011 — IPC contract: `orky:status` push + `orky:watch`/`orky:unwatch` + `onOrkyStatus`
**Satisfies:** REQ-012, REQ-013 · **Files:** `src/shared/ipc-contract.ts`, `src/shared/types.ts`
**Depends on:** TASK-001 · **Order:** 5 · **Constraints:** follow the existing contract pattern (baseline REQ-002)
- Add to `CH`: `orkyStatus: 'orky:status'` (main→renderer event, pane-scoped — first arg is paneId so
  `send`/`isPaneScoped` routes it to the owning window), `orkyWatch: 'orky:watch'`,
  `orkyUnwatch: 'orky:unwatch'` (renderer→main), mirroring `usageWatch`/`usageUnwatch`/`usageMetrics`.
- Add to `TermhallaApi`: `orkyWatch(id, cwd): void`, `orkyUnwatch(id): void`,
  `onOrkyStatus(cb: (paneId: string, status: OrkyPaneStatus | null) => void): () => void`. `null` payload =
  cleared (REQ-012). No other `window` bridge introduced.

### TASK-012 — `register-orky.ts` registrar + compose into `register.ts`
**Satisfies:** REQ-011, REQ-012, REQ-013 · **Files:** `src/main/ipc/register-orky.ts`, `src/main/ipc/register.ts`
**Depends on:** TASK-009, TASK-011 · **Order:** 6 · **Constraints:** emit via the routed `send` (`safeSend`); disposer registered
- `registerOrky(send): Disposer` mirroring `registerUsage`: construct `OrkyTracker((id, status) =>
  send(CH.orkyStatus, id, status))`, wire `ipcMain.on(CH.orkyWatch, …watch)` / `ipcMain.on(CH.orkyUnwatch,
  …unwatch)`, return `() => tracker.dispose()`.
- Add `registerOrky(send)` to the `disposers` array in `register.ts` (so `onAllWindowsClosed` disposes it —
  CLAUDE.md teardown obligation).

### TASK-013 — Preload bridge for the Orky channels
**Satisfies:** REQ-013 · **Files:** `src/preload/index.ts`
**Depends on:** TASK-011 · **Order:** 6 · **Constraints:** typed bridge only (contextIsolation)
- Add `orkyWatch: (id, cwd) => ipcRenderer.send(CH.orkyWatch, id, cwd)`,
  `orkyUnwatch: (id) => ipcRenderer.send(CH.orkyUnwatch, id)`,
  `onOrkyStatus: pushChannel<[string, OrkyPaneStatus | null]>(CH.orkyStatus)` — mirroring the usage
  bridge exactly.

### TASK-014 — Renderer store: per-pane Orky status in `runtime-slice.ts` + App subscription
**Satisfies:** REQ-013 · **Files:** `src/renderer/store/runtime-slice.ts`, `src/renderer/store/types.ts`, `src/renderer/App.tsx`
**Depends on:** TASK-011, TASK-013 · **Order:** 7 · **Constraints:** mirror `setUsage`/`onUsageMetrics`
- `runtime-slice.ts`: add `orky: Record<string, OrkyPaneStatus>` + `setOrky(id, status)` (delete the key on
  `null` — cleared, mirroring `setUsage`/`setGitStatus`). Declare in `store/types.ts`.
- `App.tsx`: add `api.onOrkyStatus((id, st) => s().setOrky(id, st))` to the `offs` subscription array.

### TASK-015 — `OrkyWatcher` reconciler: auto-bind/teardown on pane cwd
**Satisfies:** REQ-012 · **Files:** `src/renderer/components/OrkyWatcher.tsx`, `src/renderer/App.tsx` (mount)
**Depends on:** TASK-013, TASK-014 · **Order:** 7 · **Constraints:** mirror `UsageWatcher`; clean teardown
- Clone `UsageWatcher`: reconcile `orky:watch`/`orky:unwatch` from `cwds` for every TERMINAL pane that has
  a cwd (no AI-session filter — main does the `.orky/` discovery and emits cleared if absent). Watch on
  cwd-appear/change, unwatch on cwd-clear/pane-close; release all watches on unmount. Mount beside
  `<UsageWatcher/>`.
- Result: a pane entering an `.orky/` project auto-shows the chip/border; leaving it emits
  `orky:status(null)` → store clears → chrome reverts to byte-status (REQ-012 acceptance).

### TASK-016 — Toolbar Orky chip + `<body>`-portalled detail popover
**Satisfies:** REQ-008, REQ-020 · **Files:** `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneTile.tsx`, `src/renderer/components/OrkyPopover.tsx`, `src/renderer/index.css`
**Depends on:** TASK-007, TASK-014 · **Order:** 8 · **Constraints:** portal-to-`<body>` (overlay-in-mosaic-tile gotcha); paint-only focus/hover allow-list (CONV-007)
- In `PaneTile`, read `s.orky[paneId]`; when present pass it to `PaneToolbar`, which renders an Orky chip
  button (`orky-chip-${paneId}`, label = `OrkyPaneStatus.label`, REQ-008 format) ALONGSIDE the existing
  ✨ AI chip + git/process chips (complementary, not replacing — REQ-014). The chip toggles a new
  `'orky'` `PaneMenu`.
- `OrkyPopover.tsx`: lists every non-Idle feature (REQ-020) — phase, gate N/M, open count, needs-you
  reason — ordered by the REQ-007 ranking (reuse `paneStatus.features`). Because it opens from inside a
  react-mosaic tile it MUST `createPortal` to `<body>` (CLAUDE.md overlay gotcha — git/process popovers
  are in-tile absolute; this richer popover portals like `Modal`/`SplitMenu`). Add its `data-testid`
  (e.g. `orky-menu`) to the chrome focus-visible/hover allow-lists in `index.css` (paint-only — never
  change the box).

### TASK-017 — Border + tab-badge precedence: Orky over byte-status (render-time composition)
**Satisfies:** REQ-006, REQ-014 · **Files:** `src/renderer/components/PaneTile.tsx`
**Depends on:** TASK-014 · **Order:** 8 · **Constraints:** byte-status computation UNCHANGED (baseline REQ-004); ✨ chip stays
- In `PaneTile`, when `s.orky[paneId]` is present (bound Orky run), DERIVE the rendered `state` used for
  `statusClass` (`MosaicWindow` className) and `data-status` on `.term-tile` from the Orky kind
  (busy/idle/needs-input/done) with PRECEDENCE over `status?.state`; map `OrkyPaneStatus.failed` to the
  existing `lastExit:'failure'` styling treatment (REQ-006). The byte-derived `status` object is NOT
  recomputed — this is a pure composition at render time.
- When `orky[paneId]` is absent/cleared, fall back to the byte-derived `state` exactly as today
  (REQ-012/REQ-014 fallback). The ✨ AI chip + context-% (`chipText`) remain rendered.

### TASK-018 — Workspace tab-badge roll-up + opt-in gating
**Satisfies:** REQ-009, REQ-016 · **Files:** `src/renderer/components/tab-badge.ts`
**Depends on:** TASK-014 · **Order:** 8 · **Constraints:** reuse `resolveAlerts(cfg.alerts).tabBadge`; opt-in MUST NOT hide failure styling (CONV-004)
- Extend `workspaceBadgeState` (and its callers/signature) to accept the per-pane Orky map and fold an
  Orky pane whose roll-up has ANY `needsHuman` feature into `needs`, the SAME way a terminal `needs-input`
  pane contributes, gated by the SAME `resolveAlerts(cfg.alerts).tabBadge` opt-in (REQ-016). A non-Orky
  pane (or one with only idle/busy/done features) contributes nothing.
- The opt-in governs ONLY the tab-badge summary — it never suppresses the pane's Orky chip or the
  `lastExit:'failure'` border (those are TASK-016/TASK-017 and stay visible regardless — CONV-004).

### TASK-019 — Documentation, CHANGELOG, baseline + data-provenance note (doc-drift)
**Satisfies:** REQ-022 · **Files:** `docs/features/orky-status.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md`
**Depends on:** all functional tasks · **Order:** last · **Constraints:** grep `docs/`+`CLAUDE.md`+`.orky/baseline/` for stale claims (CONV-008)
- New `docs/features/orky-status.md`: the read-only status mirror, the `orky:status` channel + types, the
  watcher/precedence/badge model, and — for **risk #2 / data-provenance** — an explicit note that
  `ORKY_PHASES` is a HARDCODED mirror of Orky's upstream pipeline; if Orky's phases change upstream that
  is a manual data-update follow-up here (tests cannot catch the drift).
- Link it from the CLAUDE.md "Where things live" table; record the feature in `CHANGELOG.md`
  `[Unreleased]`; reflect the new IPC channel/types wherever channels are documented; reconcile
  `.orky/baseline/architecture.md` (this feature is additive — note the presentation-layer override of
  byte-status for Orky panes). Grep the docs tree for stale phrasings before finishing.

---

## Sequencing summary

```
TASK-001 (ORKY_PHASES + gate N/M + wire types)
  ├─ TASK-002 (parse/normalize totality)
  ├─ TASK-003 (openBlockingCount)
  ├─ TASK-004 (isStalled)
  ├─ TASK-008 (chip-status Orky variant)
  ├─ TASK-010 (.orky bounded ancestor-walk)            [risk #1]
  └─ TASK-005 (orkyFeatureStatus)  [needs 002/003/004]
        └─ TASK-006 (selectChipFeature)
              └─ TASK-007 (orkyPaneStatus + label)
TASK-009 (OrkyTracker)  [needs 002/005/007/010]        [clone UsageTracker; risk #3]
TASK-011 (IPC contract)  ──┬─ TASK-012 (register-orky + compose)   [needs 009]
                           ├─ TASK-013 (preload bridge)
                           └─ TASK-014 (store + App subscription)
                                 ├─ TASK-015 (OrkyWatcher reconciler)
                                 ├─ TASK-016 (toolbar chip + portalled popover)
                                 ├─ TASK-017 (border/badge precedence)
                                 └─ TASK-018 (tab-badge roll-up + opt-in)
TASK-019 (docs + baseline + provenance note)  ── after all functional tasks
```

## Risk notes

1. **`.orky/` discovery (risk #1)** — TASK-010 makes it a deterministic, BOUNDED upward walk with a fixed
   ancestor cap; never an unbounded walk to the filesystem root.
2. **`ORKY_PHASES` drift (risk #2 / data-provenance)** — TASK-001 is the single source of truth; TASK-019
   documents that upstream Orky phase changes are a manual data update here (untestable drift).
3. **Roll-up watcher cost (risk #3)** — TASK-009 mandates ONE bounded debounced watch on `<root>/.orky/`,
   never a per-feature watcher set, and `fs/promises` reads only (no per-poll `node` spawn — REQ-015).
4. **Baseline-fit** — no CHAR test edits; `StatusTracker`/`needs-input.ts` untouched; precedence
   (TASK-017) is a render-time composition over the unchanged byte-status; `SCHEMA_VERSION` NOT bumped
   (TASK-001). If implementation finds a CHAR test must change, STOP — the change isn't purely additive.

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-022 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen and unchanged.
