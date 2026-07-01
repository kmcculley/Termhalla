# 0005 — Cross-project Orky registry + multi-root aggregation — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-023, 23 REQs). TASK-IDs below are
stable — never renumber. This feature is additive/generalizing only (baseline-fit obligation: no
characterization test edits, 0004's `orky:status`/`OrkyPaneStatus` contract unchanged for consumers,
`SCHEMA_VERSION` NOT bumped — `orky-registry.json` carries its own embedded `version`).

## The core generalization

0004 shipped `OrkyTracker` (`src/main/orky/orky-tracker.ts`) as a single class that BOTH (a) resolves a
pane's cwd to a `.orky/` root and (b) owns the per-root chokidar watcher + debounced re-read + bounds +
mappers. REQ-001/REQ-014/REQ-020 require that watch-and-read machinery to become a **shared, root-keyed
engine** with TWO independent consumers layered on top of it:

1. **`OrkyTracker`** (existing, kept name) — the thin pane-facing facade: `watch(paneId, cwd)` /
   `unwatch(paneId)`, emitting the existing pane-scoped `orky:status` push. Behavior MUST stay
   byte-identical to 0004 (no CHAR-test edits, no `orky:status`/`OrkyPaneStatus` shape change).
2. **`OrkyRegistry`** (new) — the cross-project aggregator: tracks pane-root membership (fed by the SAME
   pane watch/unwatch events as (1), not a duplicate discovery path) UNION the persisted explicit list,
   computes the sorted `OrkyRegistrySnapshot`, and emits `registry:status`.

Both consumers share ONE engine instance (constructed once in the composition root) so a root watched by
N panes + the persisted list still has exactly one chokidar watcher (REQ-014/REQ-020). This is a
refactor of `orky-tracker.ts`, not a fork: the existing per-root watch/debounce/bounds/symlink-guard/
mapper-call code is *extracted*, not duplicated.

## Architecture fit (brownfield — `.orky/baseline/` present)

Reuses, does not reinvent:

- `src/shared/orky-status.ts` pure mappers (`normalizeFeatureRaw`, `normalizeFindings`,
  `orkyFeatureStatus`, `orkyPaneStatus`, `parseOrkyTimestamp`, `STALL_THRESHOLD_MS`) — called once per
  resolved root by the shared engine, UNTOUCHED (D3/REQ-005).
- `findOrkyRoot` (`src/main/orky/find-orky-root.ts`) — root resolution, untouched.
- 0004's read-path bounds (`MAX_FEATURE_DIRS`, `MAX_FILE_BYTES`) and symlink guard — carried into the
  extracted engine verbatim, now applied per-root for every consumer (REQ-015).
- `QuickStore`'s pattern (`src/main/persistence/quick-store.ts`) — normalize-on-load/write + `atomicWrite`
  — mirrored exactly for the new `OrkyRegistryStore` / `orky-registry.json` (REQ-013).
- The IPC seam — `ipc-contract.ts` → a new per-domain registrar `register-registry.ts` → composed in
  `register.ts` → `preload/index.ts` → `src/renderer/api.ts` (a typed re-export of `window.termhalla`,
  needs no separate wrapper) — same pattern as `register-cloud.ts`/`register-usage.ts`.
- `UsageTracker`/0004's session-identity race pattern (claim a slot BEFORE the first `await`, re-check
  identity after every `await`) — reused for the engine's per-root async work and the registry's
  add/remove mutations (REQ-019).
- `register-pty`'s `claimPane`/`WindowManager.windowIdOf` per-window ownership discipline — extended so
  pane-root membership is recognized from EVERY window, not just the single window `registerOrky`
  currently scopes to (REQ-002/REQ-020 require cross-window aggregation; 0004 only needed one window's
  panes to render that window's own chip).

## No renderer UI (D1/REQ-021)

This plan adds the main-process service, the `registry:*` IPC surface, the preload bridge, and the
`TermhallaApi` contract additions — and explicitly NO React component that renders `OrkyRegistrySnapshot`.
F6 (a later feature) is the first UI consumer.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Shared registry types (`OrkyRootSource`, `OrkyRegistryEntry`, `OrkyRegistrySnapshot`, `RegistryMutationResult`) | `src/shared/types.ts` | new (additive) |
| Pure membership-merge + deterministic sort | `src/shared/orky-registry.ts` | new |
| Root-add validation (`.orky/`-existence, traversal/absolute-path safety) | `src/main/orky/validate-root.ts` | new |
| Persisted root-list store (`orky-registry.json`) | `src/main/persistence/orky-registry-store.ts` | new |
| Shared per-root watch/read engine (extracted from `OrkyTracker`) | `src/main/orky/orky-root-engine.ts` | new (extraction) |
| Pane-facing facade (existing public API preserved) | `src/main/orky/orky-tracker.ts` | edit (refactor onto the engine) |
| Cross-project aggregator service | `src/main/orky/orky-registry.ts` | new |
| Window-aware sender validation helper | `src/main/window-manager.ts` | edit (expose a public "known sender" check) |
| IPC channel constants + `TermhallaApi` additions | `src/shared/ipc-contract.ts` | edit |
| `registry:*` registrar | `src/main/ipc/register-registry.ts` | new |
| Composition root (single shared engine+registry instance; pane-root hookup; disposer wiring) | `src/main/ipc/register.ts`, `src/main/ipc/register-orky.ts`, `src/main/services.ts` | edit |
| Preload bridge (no UI) | `src/preload/index.ts` | edit |
| Docs / changelog / baseline reconcile | `docs/features/orky-status.md` (or new `docs/features/orky-registry.md`), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` | new/edit |

## Determinism / injection contract

`now`, `thresholdMs`, and `activePhase` continue to be injected by the engine into the reused mappers
exactly as 0004 does (no behavior change). The registry's snapshot-sort is pure codepoint comparison
(`Array.prototype.sort` default, NEVER `localeCompare`) so re-reads that don't change membership/status
produce a byte-identical array (REQ-007).

---

## Tasks

### TASK-001 — Shared registry types
**Satisfies:** REQ-006 · **Files:** `src/shared/types.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** additive only; no existing type's shape changes
- Add `OrkyRootSource = 'pane' | 'persisted' | 'both'`.
- Add `OrkyRegistryEntry { root: string; source: OrkyRootSource; status: OrkyPaneStatus | null }` — `root`
  is the resolved project root (the dir CONTAINING `.orky/`), absolute, normalized; `status` reuses the
  existing `OrkyPaneStatus` verbatim (no new status type).
- Add `OrkyRegistrySnapshot = OrkyRegistryEntry[]`.
- Add `RegistryMutationResult { ok: boolean; root?: string; roots: string[]; error?: string }` —
  `error` MUST be specific/actionable on `ok:false` (CONV-001).

### TASK-002 — Pure membership-merge + deterministic snapshot sort
**Satisfies:** REQ-002, REQ-006, REQ-007 · **Files:** `src/shared/orky-registry.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure (no fs/clock/IPC); total; order-independent input
- `mergeRegistryMembership(paneRoots: ReadonlySet<string>, persistedRoots: readonly string[]):
  Map<string, OrkyRootSource>` — union keyed by resolved root, de-duplicated; a root in both sets → `'both'`;
  pane-only → `'pane'`; persisted-only → `'persisted'`. Total over empty inputs.
- `buildRegistrySnapshot(membership: ReadonlyMap<string, OrkyRootSource>, statusByRoot: ReadonlyMap<string,
  OrkyPaneStatus | null>): OrkyRegistrySnapshot` — one entry per membership key (`status` from the map,
  `null` when absent/not-yet-read per REQ-018), sorted by `root` using the DEFAULT string comparator
  (codepoint order) — explicitly NOT `localeCompare`. Same membership+status → byte-identical array
  regardless of insertion order (REQ-007 acceptance: shuffled insertion order yields identical output).
- No I/O, no `Date.now`, no randomness — straightforward to unit test exhaustively in isolation from the
  engine/registry service.

### TASK-003 — Root-add validation (security)
**Satisfies:** REQ-009, REQ-016 · **Files:** `src/main/orky/validate-root.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** never throws; specific/actionable error (CONV-001); no traversal/escape
- `validateRegistryRoot(input: unknown): Promise<{ ok: true; root: string } | { ok: false; error: string }>`.
- Reject non-string input → `{ok:false, error:'root must be a string path'}` (no throw, REQ-016).
- Resolve/normalize to an absolute path (`path.resolve`); reject a path that fails to resolve.
- Accept ONLY if the resolved directory currently contains a `.orky/` directory (reuse the SAME
  `.orky/`-existence check semantics as `findOrkyRoot`, but checked AT the resolved dir — not an upward
  walk, since `addRoot` names the project root directly per REQ-009's acceptance).
- Reads/validation MUST stay confined to `<resolved root>/.orky/` — no `..` segment in the resolved
  absolute path may escape outside what `path.resolve` already normalizes; this guard is exercised
  together with the engine's symlink guard (TASK-005) once the root is tracked.
- Every rejection path returns a distinct, specific `error` string (a non-string root, a non-existent
  path, and a dir lacking `.orky/` must NOT share one generic message — CONV-001).

### TASK-004 — Persisted root-list store (`orky-registry.json`)
**Satisfies:** REQ-013 · **Files:** `src/main/persistence/orky-registry-store.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** mirror `QuickStore`; atomic write; corrupt-tolerant (CONV-002); `SCHEMA_VERSION` untouched
- `OrkyRegistryStore` class, constructed with a `baseDir` (Electron `userData`), file `orky-registry.json`.
- `load(): Promise<string[]>` — `JSON.parse` the file; normalize: shape `{version:1, roots:string[]}`,
  coerce each `roots` entry to a normalized absolute path, drop non-strings, de-duplicate, sort
  (codepoint). ANY read/parse failure (missing, corrupt, partial, garbage) → `[]`, never throws.
- `save(roots: string[]): Promise<void>` — normalize the same way on write, then
  `atomicWrite(file, JSON.stringify({version:1, roots: normalized}, null, 2))` (reuse
  `src/main/persistence/atomic-write.ts` verbatim — temp-then-rename, no plain `writeFile`).
- The embedded `version: 1` is THIS file's own forward-migration counter — `SCHEMA_VERSION` in
  `src/shared/types.ts` is NOT touched (REQ-013 acceptance).

### TASK-005 — Extract the shared per-root watch/read engine from `OrkyTracker`
**Satisfies:** REQ-001, REQ-005, REQ-014, REQ-015, REQ-017, REQ-018, REQ-019 · **Files:** `src/main/orky/orky-root-engine.ts` (new), `src/main/orky/orky-tracker.ts` (source to extract from)
**Depends on:** — · **Order:** 2 · **Constraints:** behavior-preserving extraction; CLAUDE.md long-lived-watcher gotcha; no CHAR-test edits
- Move the CURRENT `OrkyTracker` internals — the `roots: Map<orkyDir, Root>` (watcher/timer/bounds-checked
  re-read), `MAX_FEATURE_DIRS`/`MAX_FILE_BYTES` caps, symlink guard, `.json` basename event filter,
  debounce, and the calls into `src/shared/orky-status.ts`'s mappers — into a new
  `OrkyRootEngine` class, generalized from "consumer = paneId" to "consumer = an opaque string id"
  (e.g. `pane:<id>` / `persisted:<root>`, namespaced by the caller — the engine itself doesn't care about
  the namespace, only about consumer-set cardinality per root).
- Public surface: `addConsumer(consumerId: string, orkyDir: string): Promise<void>` (idempotent — adding
  the same consumer to the same root twice is a no-op; switching a consumer to a different root detaches
  it from the old one first), `removeConsumer(consumerId: string): void`, `getConsumers(orkyDir: string):
  ReadonlySet<string>` (so a caller can derive provenance), `dispose(): void`. A constructor callback
  `onStatus(orkyDir: string, status: OrkyPaneStatus | null) => void` fires on every (re)read, fanned out
  to ALL current consumers of that root — callers translate that into their own per-consumer or
  per-snapshot emit.
- Preserve VERBATIM: the session-identity race pattern per consumer (claim before first `await`, re-check
  after every `await`); `MAX_FEATURE_DIRS`=200 warn-on-cap; `MAX_FILE_BYTES`=1 MiB skip+warn; symlink skip
  on `features/<slug>`; the `.json`/basename event filter so non-target file edits never fire a re-read;
  one chokidar watcher + one debounced re-read per resolved root shared across EVERY consumer regardless
  of namespace (REQ-014's "at most one watcher per root across ALL consumers" — pane-chip AND registry);
  warn-on-read-failure (never silently swallowed, REQ-018); `dispose()` closes every watcher/timer (no
  process-keep-alive, REQ-019); strictly read-only under `.orky/` (REQ-017) — only `fs/promises` reads,
  never a write/`child_process`.
- A root with zero consumers tears its watcher/timer down immediately (mirrors 0004's current
  "last pane leaves → close" rule, now per-consumer rather than per-pane).

### TASK-006 — Refactor `OrkyTracker` into a thin pane-facing facade over the engine
**Satisfies:** REQ-001, REQ-014 · **Files:** `src/main/orky/orky-tracker.ts`
**Depends on:** TASK-005 · **Order:** 3 · **Constraints:** PUBLIC API + emitted `orky:status` payloads byte-identical to 0004; no CHAR-test edits
- `OrkyTracker` now takes an injected `OrkyRootEngine` instance (constructed once, shared with
  `OrkyRegistry` — TASK-011) instead of owning its own `roots` map.
- `watch(id, cwd)`: resolve `root = await findOrkyRoot(cwd, {maxDepth:8})` (unchanged); on `null` emit
  cleared exactly as today; on a resolved root, `engine.addConsumer(`pane:${id}`, orkyDir)` and translate
  the engine's per-root `onStatus` fan-out into the existing pane-scoped `emit(id, status)` callback this
  class already exposes to `register-orky.ts`.
- `unwatch(id)`: `engine.removeConsumer(`pane:${id}`)`, emit cleared — same early-return-on-unknown-id
  guard as today (no spurious cleared emit for a never-watched pane).
- `dispose()`: removes this tracker's own consumers from the engine (the engine itself is disposed once,
  at the composition root — TASK-011 — not per-tracker, since it is now SHARED with the registry).
- **Regression gate:** every existing 0004 vitest/e2e assertion (incl. CHAR tests) must stay green
  unmodified — this is a structural refactor, not a behavior change.

### TASK-007 — `OrkyRegistry` cross-project aggregator service
**Satisfies:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-006, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-018, REQ-019, REQ-020 · **Files:** `src/main/orky/orky-registry.ts`
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005 · **Order:** 4 · **Constraints:** single instance; full-set push only; pure reads (`current`/`roots`) never mutate
- Constructed with the SHARED `OrkyRootEngine` instance, an `OrkyRegistryStore`, and an `emit:
  (snapshot: OrkyRegistrySnapshot) => void` callback (wired to `registry:status` by the registrar).
- Internal state: `paneRoots: Map<paneId, root>` (root = the project-root dir, not the `.orky/`
  subdirectory) and `persistedRoots: string[]` (loaded from the store at `init()`); `statusByRoot:
  Map<root, OrkyPaneStatus | null>` fed by the engine's `onStatus` callback.
- `async init(): Promise<void>` — `persistedRoots = await store.load()`; for each, `await
  engine.addConsumer(`persisted:${root}`, join(root, '.orky'))` (tolerating a root whose `.orky/` no
  longer exists on disk — REQ-018: the engine's own read-failure tolerance surfaces `status:null`, the
  root REMAINS a member because persistence, not pane-presence, is the membership rule for it); compute
  and emit the initial snapshot.
- `trackPaneRoot(paneId: string, root: string | null): void` — called by the pane-chip wiring (TASK-009)
  on every pane root resolution/clear, across ALL windows: on a resolved root, record `paneRoots.set(id,
  root)` and `engine.addConsumer(`pane:${paneId}`, join(root,'.orky'))`; on `null`/pane-close,
  `paneRoots.delete(id)` + `engine.removeConsumer(`pane:${paneId}`)`. Recompute + emit (REQ-003: a
  pane-only root that loses its last pane consumer leaves the aggregate UNLESS it is also persisted, in
  which case `source` degrades from `'both'`→`'persisted'` rather than the entry disappearing).
- `async addRoot(input: unknown): Promise<RegistryMutationResult>` — `validateRegistryRoot` (TASK-003); on
  failure return `{ok:false, roots:<unchanged>, error}` (never throw, list never mutated); on success,
  idempotent insert into `persistedRoots` (no duplicate), `await store.save(persistedRoots)`,
  `engine.addConsumer(`persisted:${root}`, ...)`, recompute + emit snapshot, return `{ok:true, root,
  roots:<new sorted list>}`.
- `async removeRoot(input: unknown): Promise<RegistryMutationResult>` — non-string/absent → idempotent
  `{ok:true, roots:<unchanged>}` (REQ-010's "no-op, never a throw" — removing an absent root is success,
  not an error); on a present root, remove from `persistedRoots`, persist, `engine.removeConsumer(`persisted:${root}`)`
  — if a pane consumer (`pane:*`) still references the SAME root, the root remains a member with
  `source:'pane'` (the engine itself still has that consumer; only the registry's bookkeeping of WHICH
  source contributed changes) — recompute + emit, return `{ok:true, roots:<new list>}`.
- `current(): OrkyRegistrySnapshot` — returns the last computed snapshot; pure read, no mutation
  (REQ-011).
- `roots(): string[]` — returns `persistedRoots` (sorted, codepoint); pure read; does NOT include
  pane-only roots (REQ-012).
- Recompute helper (private): `mergeRegistryMembership(new Set(paneRoots.values()), persistedRoots)` then
  `buildRegistrySnapshot(membership, statusByRoot)` (TASK-002) — the ONLY place membership+status are
  turned into the emitted shape, so REQ-007's determinism is inherited automatically.
- `dispose(): void` — removes every `persisted:*` consumer this instance registered (pane consumers are
  owned by `OrkyTracker` instances and removed by THEM); does not close the shared engine itself (the
  composition root owns that lifecycle — TASK-011).
- Session-identity race-pattern reuse: `addRoot`/`removeRoot`/`init` each `await` (store I/O, engine
  consumer registration which itself awaits); guard against a concurrent add/remove/dispose superseding
  mid-flight exactly like `UsageTracker` (REQ-019).

### TASK-008 — Window-aware sender validation (security, cross-window prerequisite)
**Satisfies:** REQ-002, REQ-016, REQ-020 · **Files:** `src/main/window-manager.ts`
**Depends on:** — · **Order:** 2 · **Constraints:** preserve FINDING-SEC-002's intent (reject a truly unknown/foreign sender), now scoped to "any known app window" rather than "exactly one window"
- 0004's `registerOrky(send, win)` validates `BrowserWindow.fromWebContents(e.sender) === win`, which
  silently drops `orky:watch`/`orky:unwatch` from any window OTHER than the one `register.ts` happened to
  pass in. REQ-002/REQ-020 require pane-root membership aggregated "across all windows" — this MUST be
  fixed for the registry to see panes opened in a floating/secondary window.
- Expose a public method on `WindowManager` (e.g. `isKnownWindowSender(sender: WebContents): boolean`,
  built on the existing private `windowIdOf`) that returns true iff the sender belongs to ANY currently
  tracked app window (main or floating) — false for a destroyed/foreign/unrecognized sender (preserving
  the original security intent: an out-of-process or already-closed sender is still rejected).
- This is infrastructure-only in this task; the call-site change (passing `wm` instead of a single `win`
  into the orky registrars) is TASK-009/TASK-010.

### TASK-009 — Wire pane-root membership into the registry, from every window
**Satisfies:** REQ-002, REQ-003, REQ-016, REQ-020 · **Files:** `src/main/ipc/register-orky.ts`
**Depends on:** TASK-006, TASK-007, TASK-008 · **Order:** 5 · **Constraints:** arg validation before touching the tracker (REQ-016 inherited from 0004); no `orky:status` regression
- `registerOrky` takes `wm: WindowManager` (or an injected `isKnownWindowSender` predicate) in place of a
  single `win`, using TASK-008's accessor in place of the `=== win` check — so `orky:watch`/`orky:unwatch`
  from ANY window are honored (not just the main window), closing the REQ-002/REQ-020 gap.
- On every `watch(id, cwd)` resolution (success or `null`), additionally call the injected
  `onPaneRoot(id, root | null)` hook — wired in TASK-011 to `registry.trackPaneRoot` — so the registry's
  pane-membership mirrors EXACTLY what `OrkyTracker` resolves, with no second `findOrkyRoot` walk.
- On `unwatch(id)`, call `onPaneRoot(id, null)` so a closed/cwd-left pane's root membership is removed
  from the registry in the same call that clears the pane-chip status (REQ-003 acceptance: closing the
  last pane on a pane-only root removes it from the NEXT `registry:status` snapshot).
- Existing non-string `id`/`cwd` rejection (REQ-016 inherited) is preserved unchanged.

### TASK-010 — IPC contract: `registry:*` channels + `TermhallaApi`
**Satisfies:** REQ-022 · **Files:** `src/shared/ipc-contract.ts`
**Depends on:** TASK-001 · **Order:** 3 · **Constraints:** follow the existing `CH`/`TermhallaApi` pattern; exact channel names from the spec
- Add to `CH`: `registryStatus: 'registry:status'` (main→renderer event, APP-GLOBAL — first arg is a
  snapshot array, not a paneId, so it must NOT be added to `PANE_SCOPED` in `window-manager.ts` — the
  existing `send` already broadcasts anything not pane-scoped, REQ-020/REQ-022), `registryCurrent:
  'registry:current'`, `registryRoots: 'registry:roots'`, `registryAddRoot: 'registry:addRoot'`,
  `registryRemoveRoot: 'registry:removeRoot'` (renderer→main pulls/mutations).
- Add to `TermhallaApi`: `onRegistryStatus(cb: (snapshot: OrkyRegistrySnapshot) => void): () => void`,
  `registryCurrent(): Promise<OrkyRegistrySnapshot>`, `registryRoots(): Promise<string[]>`,
  `registryAddRoot(root: string): Promise<RegistryMutationResult>`, `registryRemoveRoot(root: string):
  Promise<RegistryMutationResult>`.
- Import `OrkyRegistrySnapshot`/`RegistryMutationResult` from `@shared/types` (TASK-001) into the contract
  file's type import line, alongside the existing `OrkyPaneStatus` import.

### TASK-011 — `register-registry.ts` registrar + composition wiring
**Satisfies:** REQ-008, REQ-009, REQ-010, REQ-011, REQ-012, REQ-016, REQ-020, REQ-022 · **Files:** `src/main/ipc/register-registry.ts` (new), `src/main/ipc/register.ts`, `src/main/services.ts`
**Depends on:** TASK-007, TASK-009, TASK-010 · **Order:** 6 · **Constraints:** SINGLE shared engine+registry instance app-wide; pushes via `send`/`safeSend`; disposer registered
- `services.ts`: construct the SHARED `OrkyRootEngine` instance once (it currently lives implicitly inside
  `OrkyTracker`; now it's a first-class service field, e.g. `services.orkyEngine`), and construct
  `OrkyRegistry` (TASK-007) wrapping it + a new `OrkyRegistryStore(dir)` (TASK-004). `await
  registry.init()` during composition (or the registrar's setup) before the first `registry:status`
  emit, so a restart's persisted roots are members from the first snapshot (REQ-004 acceptance).
- `register-registry.ts`: `registerRegistry(registry: OrkyRegistry, send: Send): Disposer` —
  - `ipcMain.handle(CH.registryCurrent, () => registry.current())`
  - `ipcMain.handle(CH.registryRoots, () => registry.roots())`
  - `ipcMain.handle(CH.registryAddRoot, (_e, root: unknown) => registry.addRoot(root))` (TASK-003's
    validation runs INSIDE `addRoot`, so a malformed arg here cannot throw — REQ-016)
  - `ipcMain.handle(CH.registryRemoveRoot, (_e, root: unknown) => registry.removeRoot(root))`
  - the registry's `emit` callback is `(snapshot) => send(CH.registryStatus, snapshot)` — broadcasts to
    every window automatically (REQ-020) because `registry:status`'s first arg is not a paneId.
  - returns a `Disposer` removing all four handlers (`registry.dispose()` is called once, by the
    composition root alongside the shared engine's `dispose()` — NOT by this registrar, since the engine
    is also used by `registerOrky`).
- `register.ts`: import + call `registerOrky(send, wm, onPaneRoot)` (TASK-009's new signature) and
  `registerRegistry(registry, send)`, add both disposers to the existing `disposers` array; on
  `wm.onAllWindowsClosed`, also `await engine.dispose()` once (a single shared dispose, not one per
  registrar) to fully satisfy REQ-019's "no lingering watchers/timers" for the WHOLE shared engine.

### TASK-012 — Preload bridge (no UI)
**Satisfies:** REQ-021, REQ-022 · **Files:** `src/preload/index.ts`
**Depends on:** TASK-010 · **Order:** 4 · **Constraints:** typed bridge only (contextIsolation); no React component added anywhere in this task or any other
- Add `registryAddRoot: (root) => ipcRenderer.invoke(CH.registryAddRoot, root)`, `registryRemoveRoot:
  (root) => ipcRenderer.invoke(CH.registryRemoveRoot, root)`, `registryCurrent: () =>
  ipcRenderer.invoke(CH.registryCurrent)`, `registryRoots: () => ipcRenderer.invoke(CH.registryRoots)`,
  `onRegistryStatus: pushChannel<[OrkyRegistrySnapshot]>(CH.registryStatus)` — mirroring
  `onCloudStatus`/`cloudCurrent`'s invoke/push split.
- `src/renderer/api.ts` needs NO edit — it is a typed re-export of `window.termhalla: TermhallaApi`
  (TASK-010 already extends that interface), exactly how `cloud:*`/`usage:*` are exposed today.
- **Scope guard (REQ-021):** confirm (code review, not a new file) that this diff and the whole feature
  introduce no React component/hook that renders `OrkyRegistrySnapshot` — the channels exist, nothing
  consumes them in the renderer yet.

### TASK-013 — Documentation reconciliation
**Satisfies:** REQ-023 · **Files:** `docs/features/orky-status.md` (extend) or `docs/features/orky-registry.md` (new), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md`
**Depends on:** all functional tasks · **Order:** last · **Constraints:** grep `docs/` + `CLAUDE.md` + `.orky/baseline/` for stale phrasing (CONV-008)
- Document: the shared `OrkyRootEngine` (one watcher/read per root across pane-chip AND registry
  consumers), the new `OrkyRegistry` service + its membership/provenance rules (D2/D3), the `registry:*`
  channels + types, and the new `orky-registry.json` persisted file (shape, atomic write, own `version`).
- Link the doc from the CLAUDE.md "Where things live" table (the existing `orky-status` row, or a new
  row if a dedicated doc file is used).
- `CHANGELOG.md [Unreleased]`: record the cross-project registry feature.
- `.orky/baseline/architecture.md`: name the new `OrkyRegistry` service + `orky-registry.json` (REQ-013's
  baseline-fit note already says this file does not alter any existing persisted shape).
- Grep the existing `docs/features/orky-status.md` (and CLAUDE.md's orky gotcha paragraph) for any
  phrasing that now reads as stale given the `OrkyTracker` → `OrkyRootEngine`-backed-facade refactor
  (e.g. "ONE debounced chokidar watcher" wording should still be true but now applies engine-wide, not
  per-`OrkyTracker`-instance) and correct it (CONV-008).

---

## Sequencing summary

```
TASK-001 (shared types)
  ├─ TASK-002 (pure merge + sort)
  └─ TASK-010 (IPC contract)              [needs 001]
        └─ TASK-012 (preload bridge)      [needs 010]
TASK-003 (root-add validation)            [independent]
TASK-004 (orky-registry.json store)       [independent]
TASK-005 (extract OrkyRootEngine)         [independent — refactor of existing orky-tracker.ts]
  └─ TASK-006 (OrkyTracker facade over engine)   [needs 005]
TASK-008 (window-aware sender validation) [independent — window-manager.ts infra]
TASK-007 (OrkyRegistry service)           [needs 001, 002, 003, 004, 005]
  └─ TASK-009 (pane-root hookup, cross-window)   [needs 006, 007, 008]
        └─ TASK-011 (register-registry.ts + composition)  [needs 007, 009, 010]
              └─ TASK-012 also depends on 010 (preload) — independent track, merges before e2e
TASK-013 (docs)                           [after all functional tasks]
```

## Risk notes

1. **Refactor risk (TASK-005/006).** Extracting `OrkyRootEngine` out of `OrkyTracker` is the highest-risk
   task — it MUST NOT change any byte of what 0004 already emits or any CHAR test's outcome. Treat it as
   a pure refactor: write/port the engine's tests against the EXACT same fixtures 0004 already uses for
   `OrkyTracker`, asserting identical output before/after.
2. **Cross-window sender scoping (TASK-008/009).** 0004 only ever validated panes against the single
   `win` passed into `registerOrky`; this plan deliberately widens that to "any known window" to satisfy
   REQ-002/REQ-020. This is a real (if narrow) behavior change to 0004's wiring — call it out explicitly
   in review since it touches existing security-hardening code (FINDING-SEC-002's original fix).
3. **Single shared engine lifecycle (TASK-011).** Exactly one `dispose()` of the shared `OrkyRootEngine`
   must happen at app-teardown — calling it from BOTH `registerOrky`'s disposer and
   `registerRegistry`'s disposer would double-close watchers already closed by the first call. The
   composition root, not either registrar, owns that single `dispose()` call.
4. **Baseline-fit.** No CHAR test edits; `SCHEMA_VERSION` unchanged (`orky-registry.json` carries its own
   `version`); no renderer UI added (REQ-021). If implementation finds it needs to touch a CHAR test or
   bump `SCHEMA_VERSION`, STOP — the change is not purely additive and needs human review.

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-023 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen at 23 REQs.
