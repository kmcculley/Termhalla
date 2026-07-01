# 0005 — Cross-project Orky registry + multi-root aggregation — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-023) and `03-plan.md` (TASK-001…
TASK-013). All test files below are **FROZEN once the tests gate passes (ADR-009)** — the implementer
makes them pass without editing them. Test IDs continue the project-wide TEST-NNN sequence from where
0004 left off (TEST-001…TEST-057 already used) at **TEST-058**.

The test designer is a different actor from the implementer (the integrity boundary). No production code
(`src/`) was written by this phase — only test files, `04-tests.md`, and `traceability.json`/`.md` updates.

## Chosen contracts (the spec/plan were prose-only on internal module shapes — these tests freeze them)

The spec's "Public interface" section is authoritative for the **IPC-facing** shapes (`registry:*`
channels, `OrkyRegistryEntry`/`OrkyRegistrySnapshot`/`RegistryMutationResult`) and is matched exactly.
Internal main-process module shapes were prose-only in the plan; this suite pins the simplest contract
consistent with that prose and with the codebase's existing conventions:

1. **`mergeRegistryMembership(paneRoots, persistedRoots): Map<string, OrkyRootSource>` /
   `buildRegistrySnapshot(membership, statusByRoot): OrkyRegistrySnapshot`** (`src/shared/orky-registry.ts`,
   TASK-002) — pure, total, codepoint-sorted. Exactly as TASK-002 prose specifies.
2. **`validateRegistryRoot(input: unknown): Promise<{ok:true;root:string}|{ok:false;error:string}>`**
   (`src/main/orky/validate-root.ts`, TASK-003).
3. **`OrkyRegistryStore`** (`src/main/persistence/orky-registry-store.ts`, TASK-004) mirrors `QuickStore`
   exactly: `load(): Promise<string[]>`, `save(roots: string[]): Promise<void>`.
4. **`OrkyRootEngine`** (`src/main/orky/orky-root-engine.ts`, TASK-005) is **shared** by two independent
   consumers (`OrkyTracker` facade + `OrkyRegistry`), constructed ONCE by the composition root. A single
   constructor-bound callback (as `OrkyTracker` itself uses) cannot serve two independent subscribers, so
   the engine uses a **multi-subscriber `onStatus(cb): unsubscribe`** pattern instead — mirroring the
   codebase's pervasive `onXxx(cb) => () => void` convention (`WindowManager.onWindowClose`,
   `onCloudStatus`, etc.):
   ```ts
   new OrkyRootEngine(opts?: { now?, thresholdMs?, debounceMs? })
   engine.onStatus(cb: (orkyDir: string, status: OrkyPaneStatus | null) => void): () => void
   engine.addConsumer(consumerId: string, orkyDir: string): Promise<void>   // idempotent
   engine.removeConsumer(consumerId: string): void                          // silent no-op if unknown
   engine.getConsumers(orkyDir: string): ReadonlySet<string>
   engine.dispose(): void
   ```
   A root whose `orkyDir` does not exist on disk at all surfaces `status: null` via `onStatus` — this
   distinguishes "unreadable root" (REQ-018's persisted-root-deleted scenario) from a present-but-empty
   `.orky/` tree (a valid, if empty, roll-up — REQ-006).
5. **`OrkyTracker.watch(id, cwd)` now resolves to the project root (or `null`)** — an ADDITIVE,
   non-breaking widening of its return type (previously effectively `Promise<void>`; 0004's frozen
   `tests/main/orky-tracker.test.ts` never inspects the return value). This is what lets
   `register-orky.ts` forward pane-root membership to the registry "with no second `findOrkyRoot` walk"
   (TASK-009).
6. **`OrkyRegistry`** (`src/main/orky/orky-registry.ts`, TASK-007) mirrors the engine's subscribe pattern
   for the SAME reason (the registrar, not a constructor arg, is what wires the push to IPC):
   ```ts
   new OrkyRegistry(engine: OrkyRootEngine, store: OrkyRegistryStore)
   registry.onSnapshot(cb: (snapshot: OrkyRegistrySnapshot) => void): () => void
   registry.init(): Promise<void>
   registry.trackPaneRoot(paneId: string, root: string | null): void   // root = PROJECT root, not .orky/
   registry.addRoot(input: unknown): Promise<RegistryMutationResult>
   registry.removeRoot(input: unknown): Promise<RegistryMutationResult>
   registry.current(): OrkyRegistrySnapshot   // pure read
   registry.roots(): string[]                 // pure read, persisted-only
   registry.dispose(): void
   ```
7. **`WindowManager.isKnownWindowSender(sender: WebContents): boolean`** (TASK-008) — public, built on
   the existing private `windowIdOf`; true iff the sender belongs to ANY currently-tracked app window.
8. **`registerOrky(send, isKnownWindowSender, onPaneRoot): Disposer`** (TASK-009) — widened from 0004's
   `registerOrky(send, win)`. See "Amended existing test" below.
9. **`registerRegistry(registry: OrkyRegistry, send: Send): Disposer`** (TASK-011) — registers
   `ipcMain.handle` for `registry:current`/`registry:roots`/`registry:addRoot`/`registry:removeRoot` and
   subscribes `registry.onSnapshot((snap) => send(CH.registryStatus, snap))`; its disposer unsubscribes +
   removes the four handlers but does **not** call `registry.dispose()` (the composition root owns that
   single shared `OrkyRootEngine`/`OrkyRegistry` lifecycle once, per plan risk note #3).

## Amended existing test (the ONE frozen 0004 file this feature intentionally touches)

`tests/main/orky-ipc-validation.test.ts` (0004, REQ-024) asserted `registerOrky(send, win)` ignores any
window other than the single owning one. REQ-002/REQ-020 require pane-root membership aggregated **across
all windows** — 03-plan.md's risk note #2 calls this out explicitly as an intentional, narrow behavior
change to existing security-hardening code, not a regression. The file was rewritten:

- **Kept:** malformed-arg rejection (now TEST-139, was TEST-054), "a truly foreign/destroyed sender is
  rejected" (now TEST-141, narrowed from "non-owning window" to "unrecognized sender" — the original
  FINDING-SEC-002 intent survives, just widened in scope).
- **Changed:** "a watch from window B is ignored" → "a watch from window B (a SECOND known window) is
  now honored" (TEST-140) — the REQ-002/REQ-020 widening.
- **Added:** TEST-142/TEST-143 for the new `onPaneRoot` hookup (REQ-002/REQ-003).

`tests/main/orky-tracker.test.ts` and `tests/shared/orky-status.test.ts` (the rest of 0004's frozen suite)
are **untouched** — TASK-005/006 is a behavior-preserving extraction; `tests/main/orky-root-engine.test.ts`
ports the SAME fixtures against the new engine and includes a direct equality test (TEST-089) against the
unmodified `OrkyTracker`. The widened `OrkyTracker.watch()` return value gets its own NEW, additive test
file (`tests/main/orky-tracker-watch-root.test.ts`) rather than editing the frozen 0004 file.

## Test catalogue

| TEST-ID | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-058 | REQ-002 | `tests/shared/orky-registry.test.ts` | A root in both pane+persisted sets → `'both'`; pane-only → `'pane'`; persisted-only → `'persisted'`; one entry per root. |
| TEST-059 | REQ-002 | same | Empty inputs → empty map, never throws. |
| TEST-060 | REQ-002 | same | A duplicate persisted entry / two panes on the same root still collapse to one map entry. |
| TEST-061 | REQ-002 | same | Single-source roots never get tagged `'both'`. |
| TEST-062 | REQ-006 | same | Every snapshot entry is exactly `{root, source, status}`; `status:null` when absent. |
| TEST-063 | REQ-006 | same | A present status flows through unchanged (no new wrapper fields). |
| TEST-064 | REQ-007 | same | Sort is codepoint (`'Banana' < 'apple'`), NOT `localeCompare`. |
| TEST-065 | REQ-007 | same | Shuffled insertion order → byte-identical snapshot array. |
| TEST-066 | REQ-007 | same | Empty membership → empty array, never throws. |
| TEST-067 | REQ-006/007 | same | Mixed-source/status realistic set: one entry per root, sorted. |
| TEST-068 | REQ-022 | `tests/shared/registry-ipc-contract.test.ts` | `CH.registryStatus/Current/Roots/AddRoot/RemoveRoot` exactly match the spec's channel names. |
| TEST-069 | REQ-022 | same | All 5 channel values unique; no collision with any existing `CH` value. |
| TEST-070 | REQ-021 | `tests/shared/registry-no-renderer-ui.test.ts` | No file under `src/renderer/` references the registry snapshot type or `registry:*` API surface (D1 scope guard). |
| TEST-071 | REQ-016 | `tests/main/validate-root.test.ts` | A non-string `root` → `{ok:false}`, never throws, string-specific error. |
| TEST-072 | REQ-009 | same | A dir containing `.orky/` → `{ok:true, root: <resolved absolute path>}`. |
| TEST-073 | REQ-009/016 | same | A dir with no `.orky/` → `{ok:false}`, error distinct from the non-string case. |
| TEST-074 | REQ-009/016 | same | A non-existent path → `{ok:false}`, error distinct from the no-`.orky/` case. |
| TEST-075 | REQ-016 | same | `'../../etc'` → `{ok:false}`, never throws. |
| TEST-076 | REQ-016 | same | A `..`-laden path that collapses onto a valid project → accepted, normalized, no literal `..` survives. |
| TEST-077 | REQ-009 | same | Validating the same root twice resolves identically (stable). |
| TEST-078 | REQ-013 | `tests/main/orky-registry-store.test.ts` | Missing `orky-registry.json` → `load()` returns `[]`, never throws. |
| TEST-079 | REQ-013 | same | Malformed JSON → `[]`, no throw (CONV-002). |
| TEST-080 | REQ-013 | same | Garbage/non-JSON content → `[]`, no throw. |
| TEST-081 | REQ-013 | same | Load normalizes: drops non-strings, dedupes, codepoint-sorts. |
| TEST-082 | REQ-013 | same | Missing/non-array `roots` field → `[]`, no throw. |
| TEST-083 | REQ-013 | same | `save()`/`load()` round-trip; on-disk shape is exactly `{version:1, roots:[...]}`. |
| TEST-084 | REQ-013 | same | `save()` normalizes the same way as `load()` (dedupe, drop non-strings) before writing. |
| TEST-085 | REQ-013 | same | Saving `[]` round-trips to `[]`; the file still exists. |
| TEST-086 | REQ-013/017 | same | Source-grep: `save()` goes through `atomicWrite`, never a direct `writeFileSync`/plain `writeFile`. |
| TEST-087 | REQ-013 | same | `SCHEMA_VERSION` (global) is unchanged (still 7); the on-disk file embeds its own `version:1`. |
| TEST-088 | REQ-001/005 | `tests/main/orky-root-engine.test.ts` | `addConsumer` populates a roll-up via `onStatus`; a malformed feature safe-defaults + warns. |
| TEST-089 | REQ-001/005 | same | The engine's status for a root deep-equals 0004's unmodified `OrkyTracker`'s status for the same root (reuse, not a fork). |
| TEST-090 | REQ-005 | same | Source-grep: imports (not redefines) the `@shared/orky-status` mapper functions. |
| TEST-091 | REQ-019 | same | Removing the LAST consumer of a root tears the watcher down; no further emits. |
| TEST-092 | REQ-019 | same | `addConsumer` then immediate `removeConsumer` (before discovery completes) leaves no orphaned watcher/membership (race pattern). |
| TEST-093 | REQ-019 | same | `dispose()` closes ALL watchers/timers across multiple roots; no further emits. |
| TEST-094 | REQ-019 | same | `removeConsumer` of a never-added id is a silent no-op. |
| TEST-095 | REQ-017 | same | A tracking session leaves the `.orky/` tree byte-identical (content + mtime). |
| TEST-096 | REQ-017 | same | Source-grep: no `child_process`/`execFile`/`spawn`. |
| TEST-097 | REQ-014 | same | A single consumer on a single root → exactly ONE chokidar watcher (no regression vs. 0004). |
| TEST-098 | REQ-014 | same | 2 pane-namespaced + 1 persisted-namespaced consumer on the same root → ONE watcher; `getConsumers` reflects all 3. |
| TEST-099 | REQ-014 | same | Watcher torn down ONLY at zero consumers (removing 1 of 3 keeps it alive and re-reading). |
| TEST-100 | REQ-014 | same | A `.md` change does not trigger a re-read; a `.json` change does. |
| TEST-101 | REQ-015 | same | `MAX_FEATURE_DIRS`=200 cap + warn applies on a SECOND (non-first) tracked root; the first root still reports. |
| TEST-102 | REQ-015 | same | `MAX_FILE_BYTES` (1 MiB) skip+warn applies on a non-first root; other features/roots still report. |
| TEST-103 | REQ-015 | same | A `features/<slug>` symlink-out is skipped on a non-first root. |
| TEST-104 | REQ-018 | same | A malformed root never breaks an independently-tracked good root. |
| TEST-105 | REQ-018/006 | same | A root whose `orkyDir` does not exist at all → `status:null` (the persisted-root-deleted scenario), distinct from an empty-but-present tree. |
| TEST-106 | REQ-018 | same | Missing `active.json` / missing `findings.json` tolerated without throwing. |
| TEST-107 | REQ-016/020 | `tests/main/window-manager-registry-sender.test.ts` | A sender of the single prepared window is recognized. |
| TEST-108 | REQ-002/020 | same | A sender of EITHER of two prepared windows is recognized (the cross-window widening). |
| TEST-109 | REQ-016 | same | A truly foreign/unrecognized sender is rejected (FINDING-SEC-002 intent preserved). |
| TEST-110 | REQ-016 | same | A destroyed window's sender is no longer recognized. |
| TEST-111 | REQ-020/022 | same | `CH.registryStatus` is NOT pane-scoped (`wm.isPaneScoped` returns false) — broadcasts to all windows. |
| TEST-112 | REQ-002/006 | `tests/main/orky-registry-service.test.ts` | Root X (pane+persisted) → `'both'`; Y (pane-only) → `'pane'`; Z (persisted-only) → `'persisted'`; exactly 3 entries. |
| TEST-113 | REQ-002 | same | A second pane on the same root X does not duplicate the entry. |
| TEST-114 | REQ-006 | same | Entry shape is exactly `{root,source,status}`; `root` is the project root, not the `.orky/` subdir. |
| TEST-115 | REQ-003 | same | A pane-only root leaves the aggregate + its watcher on last-pane-close; persisted list unaffected. |
| TEST-116 | REQ-003 | same | A pane+persisted root degrades `'both'`→`'persisted'` (not removed) when its last pane closes. |
| TEST-117 | REQ-004 | same | `addRoot(Z)` with no pane contributes a live, pane-independent member; pane activity never auto-persists. |
| TEST-118 | REQ-004 | same | A simulated restart (fresh engine+registry, same on-disk store) re-loads the persisted root as a member immediately. |
| TEST-119 | REQ-008 | same | Every emitted snapshot is the COMPLETE current aggregate, never a delta. |
| TEST-120 | REQ-009 | same | A valid `.orky/`-containing dir succeeds; re-adding is idempotent (no duplicate). |
| TEST-121 | REQ-009/016 | same | Non-string / non-existent / no-`.orky/` each fail with a DISTINCT specific error; list unchanged. |
| TEST-122 | REQ-010 | same | `removeRoot` with no pane open removes the root + tears down its watcher; persisted list updated. |
| TEST-123 | REQ-010 | same | `removeRoot` while a pane is open leaves the root as `source:'pane'` (watcher persists). |
| TEST-124 | REQ-010 | same | `removeRoot` of an absent root is an idempotent `{ok:true}` no-op, never a throw. |
| TEST-125 | REQ-011 | same | `current()` deep-equals the last push; repeated calls never mutate or emit. |
| TEST-126 | REQ-012 | same | `roots()` returns ONLY the persisted list, sorted, excluding pane-only roots. |
| TEST-127 | REQ-018 | same | A root with malformed `state.json` is present (safe-defaulted); the other root reports normally. |
| TEST-128 | REQ-018 | same | A persisted root whose `.orky/` is deleted at runtime keeps membership (still persisted); aggregate keeps emitting. |
| TEST-129 | REQ-019 | same | `dispose()` leaves zero `persisted:*` consumers on the shared engine for this registry's own roots. |
| TEST-130 | REQ-019 | same | Concurrent `addRoot`+`removeRoot` for the same root leaves store and snapshot internally consistent (never split). |
| TEST-131 | REQ-014/020 | same | A root BOTH pane-tracked AND persisted shares exactly ONE chokidar watcher (registry-specific sharing). |
| TEST-132 | REQ-013 | same | `addRoot` persists to `orky-registry.json` under the given `userData` dir (integration). |
| TEST-133 | REQ-022 | `tests/main/register-registry.test.ts` | `ipcMain.handle` registered for all 4 `registry:*` pull/mutation channels. |
| TEST-134 | REQ-011/012 | same | `registry:current`/`registry:roots` handlers delegate to `registry.current()`/`registry.roots()`. |
| TEST-135 | REQ-009/016 | same | `registry:addRoot` passes the raw (possibly malformed) arg straight through — validation lives in `addRoot` itself. |
| TEST-136 | REQ-010 | same | `registry:removeRoot` passes the raw arg straight through. |
| TEST-137 | REQ-008/020/022 | same | Subscribes `registry.onSnapshot` and routes every push to `send(CH.registryStatus, snapshot)`. |
| TEST-138 | REQ-019/022 | same | The disposer removes all 4 handlers + unsubscribes `onSnapshot`, but does NOT call `registry.dispose()`. |
| TEST-139 | REQ-016 | `tests/main/orky-ipc-validation.test.ts` (amended) | Non-string `id`/`cwd` rejected, never throws, tracker untouched (preserves 0004 TEST-054). |
| TEST-140 | REQ-020 | same | A valid watch from EITHER of two known windows starts the tracker (the cross-window widening). |
| TEST-141 | REQ-016/020 | same | A truly foreign/unrecognized sender is still ignored; a known window's unwatch still works. |
| TEST-142 | REQ-002 | same | A successful watch resolution invokes `onPaneRoot(id, root)` with exactly what `tracker.watch()` resolved. |
| TEST-143 | REQ-003 | same | A watch resolving to `null` AND an `unwatch` both invoke `onPaneRoot(id, null)`. |
| TEST-144 | REQ-002 | `tests/main/orky-tracker-watch-root.test.ts` (new, additive) | `OrkyTracker.watch()` resolves to the PROJECT root (not the `.orky/` subdir). |
| TEST-145 | REQ-002 | same | `watch()` resolves to `null` when there is no `.orky` ancestor. |
| TEST-146 | REQ-023 | `tests/docs-feature-0005.test.ts` | Feature doc, CLAUDE.md link, CHANGELOG `[Unreleased]`, and `.orky/baseline/architecture.md` all reconciled. |
| TEST-147 | REQ-001 | `tests/main/orky-root-engine.test.ts` | `onStatus` supports multiple independent subscribers; unsubscribing one doesn't affect the other. |

## RED verification

```
npx vitest run
 Test Files  11 failed | 116 passed (127)
      Tests  17 failed | 754 passed (771)
exit code 1
```

All failures are want-of-correction signals — missing modules or unmet new contracts — not test bugs:

- `Cannot find module '@shared/orky-registry'` / `'.../orky-root-engine'` / `'.../orky-registry'` /
  `'.../orky-registry-store'` / `'.../validate-root'` / `'.../register-registry'` — none of these new
  modules exist yet (TASK-001..TASK-011).
- `tests/shared/registry-ipc-contract.test.ts` — `CH.registryStatus` etc. are `undefined` (TASK-010 not
  done).
- `tests/main/window-manager-registry-sender.test.ts` — `wm.isKnownWindowSender is not a function`
  (TASK-008 not done).
- `tests/main/orky-ipc-validation.test.ts` (amended) — the shipped `registerOrky(send, win)` still has the
  OLD 2-arg, single-window-only contract; calling it per the new 3-arg contract and asserting cross-window
  acceptance fails (TASK-009 not done).
- `tests/main/orky-tracker-watch-root.test.ts` — `OrkyTracker.watch()` resolves to `undefined`, not the
  project root (TASK-006 not done).
- `tests/docs-feature-0005.test.ts` — the registry feature doc / CLAUDE.md / CHANGELOG / baseline
  architecture references do not exist yet (TASK-013 not done).

`tests/shared/registry-no-renderer-ui.test.ts` (REQ-021 scope guard) PASSES today — by design, it is a
regression guard for a property already true (no such renderer code exists), not a want-of-correction
signal for new code.

## Coverage check

Every REQ-001…REQ-023 acceptance criterion is covered by at least one TEST-ID (see `traceability.md` /
`traceability.json`). REQ-017's "code review confirms no `child_process`/`execFile`/`spawn`" acceptance is
covered as a source-grep assertion (TEST-096), matching the precedent of 0004's TEST-030.
