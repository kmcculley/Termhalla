# 0005 — Cross-project Orky registry + multi-root aggregation

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the human-confirmed `01-concept.md` (D1 IPC/data-only, D2
ephemeral open-pane roots + manual persisted list, D3 reuse `OrkyPaneStatus` per root). This spec
**resolves** the three non-blocking open questions the brainstorm deferred to spec time — exact IPC
channel names, persisted-list storage format, and full-set-vs-diff push — and records each decision
inline (see "Resolved open questions"). REQ-IDs are stable; never renumber.

This feature **generalizes** 0004's single-root, pane-scoped `OrkyTracker` (`src/main/orky/`) to a
**set of roots** rolled up into one cross-project, pane-independent aggregate over a new IPC channel.
It introduces **no renderer UI** (D1); F6 is the first consumer.

## Concerns

`security` `performance` `determinism` `quality`

- `security` — a persisted root is a human/IPC-supplied path; it must be validated (must currently
  contain a `.orky/` dir, must normalize, no traversal/escape) and the per-root read path must apply
  0004's bounds (`MAX_FEATURE_DIRS`, `MAX_FILE_BYTES`, symlink guard) to **every** root, not only the
  first. The new add/remove IPC handlers are fresh main-process attack surface (REQ-015, REQ-016).
- `performance` — N roots × 0004's per-root chokidar-watcher + debounced-reread cost; this MUST NOT
  regress 0004's single-root cost. At most ONE watcher + one re-read per resolved root across **all**
  consumers, including the 0004 pane-chip path (REQ-014).
- `determinism` — the aggregate ordering MUST be stable (sorted by root path, codepoint order) so
  consumers never see spurious reordering on a re-read (REQ-007); tz-safe timestamps are inherited by
  reusing 0004's mappers untouched (REQ-005).
- `quality` — reuse over duplication (D3): call the SAME pure mappers in `src/shared/orky-status.ts`
  per root; do not fork them, and do not invent a parallel per-root status shape (REQ-005).
- `data-provenance` — **n/a.** This feature embeds no new factual/reference data. The `ORKY_PHASES`
  provenance caveat lives in 0004's module, which this feature reuses verbatim (REQ-005); no copy is
  made here.

## Resolved open questions (decisions, with rationale)

1. **IPC channel/method names — new `registry` domain** (`domain:verb` per CLAUDE.md; verified no
   collision with existing channels in `src/shared/ipc-contract.ts`, which has no `registry:` prefix):
   - `registry:status` — main→renderer **push** (app-global broadcast, **not** pane-scoped), full
     aggregate snapshot (REQ-008).
   - `registry:current` — renderer→main pull, returns the current aggregate snapshot on demand
     (recovers a missed push; mirrors `cloud:current`) (REQ-011).
   - `registry:roots` — renderer→main pull, returns the persisted explicit root list (the future
     write-allowlist source for F7) (REQ-012).
   - `registry:addRoot` — renderer→main, add a root to the persisted list; returns a result (REQ-009).
   - `registry:removeRoot` — renderer→main, remove a root from the persisted list; returns a result
     (REQ-010).
2. **Persisted-list storage format — a new, self-versioned file** `orky-registry.json` under Electron
   `userData`, shape `{ version: 1, roots: string[] }`, normalized-on-load + normalized-on-write +
   atomic write (mirroring `quick-store.ts`) (REQ-013). **Rationale:** a dedicated store keeps a clean
   ownership boundary (F7 reads this exact list as its write-allowlist) rather than diluting
   `quick.json` (SSH/favorites/theme). The file carries its **own** `version` integer for independent
   forward-migration; the global `SCHEMA_VERSION` (which governs the workspace/app-state migration
   chain) is **not** bumped — this file is not part of that chain. This honors the "Persistence is
   versioned" convention via the embedded version while avoiding coupling to the app-state schema.
3. **Push granularity — full set on every change.** `registry:status` carries the COMPLETE current
   aggregate every time (REQ-008). **Rationale:** determinism (consumers always receive a complete,
   sorted snapshot — no diff-application/ordering bugs), simplicity, and the set is small (open-pane
   roots + manually-added roots — low cardinality), so full-set cost is negligible versus diff
   bookkeeping. This matches D3's reuse-don't-reinvent spirit.

## Baseline fit (brownfield — `.orky/baseline/` present)

This feature is **additive** and supersedes **no** baseline REQ.

- It **generalizes**, but does not rewrite the contract of, 0004's `OrkyTracker` / `find-orky-root` /
  `src/shared/orky-status.ts`. The per-pane `orky:status` channel and its `OrkyPaneStatus` shape are
  **reused unchanged** (D3); the existing 0004 pane-chip behavior MUST remain green (REQ-005, REQ-014).
- Baseline **REQ-024 (versioned persistence)** is honored, not changed: a **new** persisted file
  (`orky-registry.json`) is introduced with its own embedded `version`; no existing persisted shape is
  altered and the global `SCHEMA_VERSION` is not bumped (REQ-013).
- Baseline **REQ-002/003 (typed IPC contract, `safeSend`)** are extended by the new `registry:*`
  channels following the existing per-domain-registrar pattern, not changed (REQ-022).
- No characterization test (CHAR-001..020) should need editing. If implementation finds one does, the
  change is not purely additive — stop and revisit.

## Public interface

### Shared types (new) — `src/shared/types.ts` (or `src/shared/orky-status.ts`)

```ts
/** Why a root is a member of the cross-project aggregate. `both` = an open pane resolves to it AND it
 *  is in the persisted explicit list. */
export type OrkyRootSource = 'pane' | 'persisted' | 'both'

/** One project's entry in the cross-project aggregate (D3: reuse OrkyPaneStatus per resolved root). */
export interface OrkyRegistryEntry {
  root: string                    // resolved project root (the dir CONTAINING .orky/), absolute, normalized
  source: OrkyRootSource          // membership provenance
  status: OrkyPaneStatus | null   // the reused 0004 roll-up for this root; null = not yet read / unreadable
}

/** The cross-project aggregate emitted over `registry:status`. Sorted by `root` (codepoint) — REQ-007. */
export type OrkyRegistrySnapshot = OrkyRegistryEntry[]

/** Result of an add/remove-root IPC call (CONV-001: specific, actionable error on failure). */
export interface RegistryMutationResult {
  ok: boolean
  root?: string        // the normalized root, on success
  roots: string[]      // the persisted list AFTER the mutation (normalized, sorted)
  error?: string       // specific + actionable when ok === false (CONV-001)
}
```

### IPC (new `registry` domain) — `src/shared/ipc-contract.ts`

```ts
CH.registryStatus:     'registry:status'      // main -> renderer event (app-global broadcast; full snapshot)
CH.registryCurrent:    'registry:current'     // renderer -> main (pull current aggregate snapshot)
CH.registryRoots:      'registry:roots'       // renderer -> main (pull persisted explicit root list)
CH.registryAddRoot:    'registry:addRoot'     // renderer -> main (add a root to the persisted list)
CH.registryRemoveRoot: 'registry:removeRoot'  // renderer -> main (remove a root from the persisted list)

onRegistryStatus(cb: (snapshot: OrkyRegistrySnapshot) => void): () => void
registryCurrent(): Promise<OrkyRegistrySnapshot>
registryRoots(): Promise<string[]>
registryAddRoot(root: string): Promise<RegistryMutationResult>
registryRemoveRoot(root: string): Promise<RegistryMutationResult>
```

`registry:status` is **app-global** (its first arg is a snapshot, not a paneId), so the composition
root's `send` broadcasts it to every window (REQ-020).

---

## Requirements

### REQ-001 — Cross-project registry service (generalize the single-root tracker to a set of roots)
A new main-process service (e.g. `src/main/orky/orky-registry.ts`) MUST maintain a live aggregate of
the Orky status of **every** tracked root and emit it over `registry:status`. It MUST generalize
0004's `OrkyTracker` from one resolved `.orky/` root to a **set** of roots — reusing `findOrkyRoot`
for root resolution and the `src/shared/orky-status.ts` mappers per root (REQ-005) — rather than
forking that logic. The service MUST be a single app-wide instance (REQ-020), disposable (REQ-019),
and strictly read-only under any `.orky/` tree (REQ-017).
**Acceptance:** an integration harness drives the service with ≥2 fixtured `.orky/` roots and observes
one `registry:status` snapshot containing one entry per tracked root, each entry's `status` produced by
the reused 0004 mappers (a per-root `OrkyPaneStatus` equal to what `OrkyTracker` would emit for that
root in isolation).

### REQ-002 — Membership = union of open-pane roots ∪ persisted explicit list, deduplicated
The set of roots in the aggregate MUST be the **union** of (a) the resolved `.orky/` roots of all
currently-open panes across **all** windows (ephemeral — D2/REQ-003) and (b) the roots in the
persisted explicit list (manual — D2/REQ-004), keyed and de-duplicated by **resolved project-root
absolute path**. A root present in BOTH sources MUST appear **exactly once** with `source: 'both'`; a
root only from open panes → `source: 'pane'`; a root only from the persisted list → `source:
'persisted'`. No duplicate entries for the same resolved root may ever appear in a snapshot.
**Acceptance:** with root X open in a pane AND in the persisted list, the snapshot has exactly one
entry for X with `source:'both'`; root Y only open in a pane → one entry `source:'pane'`; root Z only
persisted → one entry `source:'persisted'`; opening a second pane that resolves to X does not add a
second X entry.

### REQ-003 — Open-pane roots are ephemeral (D2)
A pane-sourced root MUST be a member only while **at least one** currently-open pane resolves to it. It
MUST NOT be auto-written into the persisted list. When the last open pane bound to a pane-only root
closes or its cwd leaves the `.orky/` project, that root MUST leave the aggregate (and its shared
watcher torn down per REQ-014) and a new `registry:status` snapshot omitting it MUST be emitted —
unless the root is also persisted, in which case it remains with `source:'persisted'`.
**Acceptance:** open a pane in fixtured root Y (not persisted) → Y appears `source:'pane'`; close that
pane → a new snapshot omits Y and Y's watcher is torn down; the persisted list is unchanged (Y was
never written to it).

### REQ-004 — Persisted explicit list is manual and durable (D2)
The persisted explicit list MUST be modified ONLY by `registry:addRoot` / `registry:removeRoot`
(REQ-009/REQ-010) — never auto-populated from open panes. Its entries MUST survive an app restart
(loaded from `orky-registry.json`, REQ-013) and MUST contribute to the aggregate (with a live watcher,
REQ-014) **independently of whether any pane is open** on them — that pane-independence is the feature.
**Acceptance:** `registry:addRoot(Z)` with no pane open on Z → Z appears in the snapshot
`source:'persisted'` with a live status; restart the service (reload from disk) → Z is still a member;
no `registry:addRoot` is ever issued as a side effect of opening/closing a pane.

### REQ-005 — Per-root status reuses 0004's mappers verbatim (D3, quality)
Each entry's `status` MUST be computed by calling the existing pure mappers in
`src/shared/orky-status.ts` (`normalizeFeatureRaw`, `normalizeFindings`, `orkyFeatureStatus`,
`orkyPaneStatus`, `parseOrkyTimestamp`, `STALL_THRESHOLD_MS`) once per resolved root, producing an
`OrkyPaneStatus` identical to 0004's per-pane roll-up for that root. This feature MUST NOT fork, copy,
or re-implement those mappers, and MUST NOT introduce a new cross-project status type beyond the thin
`OrkyRegistryEntry` wrapper (root + source + the reused `OrkyPaneStatus`). Tz-safe timestamp handling
(0004 REQ-028) is thereby inherited, not re-derived.
**Acceptance:** a code-review/import assertion confirms `orky-status.ts` is imported (not duplicated)
and exposes no new copy of its functions; for a given fixtured root, the registry entry's `status`
deep-equals the `OrkyPaneStatus` 0004's `OrkyTracker` emits for that same root.

### REQ-006 — Aggregate entry shape carries source provenance
Every snapshot entry MUST carry `{ root, source, status }` where `root` is the resolved project-root
absolute path (the directory containing `.orky/`, normalized), `source ∈ {'pane','persisted','both'}`
per REQ-002, and `status` is the reused `OrkyPaneStatus` or `null` when the root has not yet been read
or is currently unreadable (REQ-018). The `root` key MUST be the project root, NOT the `.orky/`
subdirectory, so a consumer (F7's write-allowlist) can address the project directly.
**Acceptance:** each entry exposes exactly those three fields; `root` is the dir containing `.orky/`
(not `<root>/.orky`); a root whose first read has not completed yet surfaces `status: null` rather than
being omitted or throwing.

### REQ-007 — Deterministic, stable ordering (determinism)
A `registry:status` snapshot MUST be sorted by `root` in a **stable, locale-independent** order
(codepoint/byte comparison, e.g. the default `Array.prototype.sort` string comparison — NOT
`localeCompare`, whose result varies by locale/ICU). The same membership set MUST always serialize to
the same order, so a re-read that does not change membership or any per-root status produces a
byte-identical snapshot and never spuriously reorders.
**Acceptance:** given roots inserted in arbitrary/shuffled order, successive snapshots list them in the
same codepoint-sorted order; reordering the internal insertion order yields an identical snapshot
array; the sort does not use `localeCompare`.

### REQ-008 — Full-set push on every change
`registry:status` MUST carry the COMPLETE current aggregate snapshot (every member root) on every
emit, NOT a diff. An emit MUST be triggered whenever membership changes (a pane-root added/removed, a
root added/removed from the persisted list) OR any tracked root's `status` changes (debounced re-read
per REQ-014). The renderer never needs prior state to interpret a push.
**Acceptance:** every observed `registry:status` payload is a full `OrkyRegistrySnapshot` containing all
current members; adding a second root then changing the first root's `state.json` each produce a full
snapshot reflecting the complete current set; no partial/delta payload is ever emitted.

### REQ-009 — `registry:addRoot` adds a validated root to the persisted list
`registry:addRoot(root)` MUST validate the argument and, on success, add the **normalized** root to the
persisted list, persist it (REQ-013), begin tracking it (watcher per REQ-014), emit an updated
`registry:status`, and return `{ ok:true, root:<normalized>, roots:<new sorted list> }`. Adding a root
already present MUST be **idempotent** (no duplicate; `ok:true`, list unchanged). On validation failure
it MUST return `{ ok:false, roots:<unchanged list>, error:<specific, actionable> }` (CONV-001) and MUST
NOT throw, MUST NOT mutate the list, and MUST NOT crash the main process. Validation rules are REQ-016.
**Acceptance:** `addRoot` of a fixtured dir that contains `.orky/` → `ok:true`, root appears in
`roots` and as a `source:'persisted'`/`'both'` entry; a second `addRoot` of the same root → `ok:true`,
no duplicate; `addRoot` of a non-string, a path that does not exist, or a dir with no `.orky/` →
`ok:false` with a specific error and an unchanged list.

### REQ-010 — `registry:removeRoot` removes a root from the persisted list
`registry:removeRoot(root)` MUST remove the normalized root from the persisted list, persist the
change, and return `{ ok:true, roots:<new sorted list> }`. After removal: if no currently-open pane
resolves to that root, it MUST leave the aggregate and its watcher MUST be torn down (REQ-014); if an
open pane still resolves to it, it MUST remain as a `source:'pane'` entry (its watcher persists). An
updated `registry:status` MUST be emitted. Removing a root not in the list MUST be a no-op returning
`{ ok:true, roots:<unchanged> }` (idempotent), never a throw.
**Acceptance:** `removeRoot(Z)` with no pane on Z → Z leaves the snapshot, watcher torn down, list no
longer contains Z; `removeRoot(X)` while a pane is open on X → X remains `source:'pane'`, watcher
persists; `removeRoot` of an absent root → `ok:true`, unchanged list, no throw.

### REQ-011 — `registry:current` pulls the current aggregate snapshot
`registry:current()` MUST return the current `OrkyRegistrySnapshot` synchronously-consistent with the
last pushed value (recovering a renderer that missed a push, mirroring `cloud:current`). It MUST be a
pure read — it MUST NOT mutate membership, the persisted list, or any watcher.
**Acceptance:** after a sequence of membership changes, `registry:current()` returns a snapshot deeply
equal to the most recent `registry:status` payload; calling it does not change the persisted list or
emit a push.

### REQ-012 — `registry:roots` pulls the persisted explicit list
`registry:roots()` MUST return the persisted explicit root list (normalized, codepoint-sorted) — the
roots a human deliberately tracked — as the future write-target allowlist source for F7. It MUST NOT
include ephemeral pane-only roots, and MUST be a pure read.
**Acceptance:** with persisted roots {Z} and a pane-only root Y open, `registry:roots()` returns `[Z]`
(not Y); it is sorted; it does not mutate state.

### REQ-013 — Persisted storage: new self-versioned `orky-registry.json`
The persisted list MUST live in a new file `orky-registry.json` under Electron `userData`, shape
`{ version: 1, roots: string[] }`, with a normalize-on-load and normalize-on-write step (each `roots`
entry coerced to a normalized absolute path; non-strings dropped; duplicates collapsed) and an
**atomic** write (mirroring `quick-store.ts`'s `atomicWrite`, so a killed write cannot truncate the
file into a corrupt one). A missing/corrupt/partial file MUST load as an empty list (`roots: []`)
without throwing (CONV-002). The file MUST carry its own `version` integer for independent forward
migration; the global `SCHEMA_VERSION` MUST NOT be bumped (this file is not part of the app-state
migration chain).
**Acceptance:** after `addRoot`, `orky-registry.json` exists under `userData` with
`{version:1,roots:[...]}`; a hand-corrupted/garbage file loads as `roots:[]` (no throw); a load of a
file with a non-string or duplicate entry yields a normalized, de-duplicated list; the write is atomic
(a temp-then-rename, no partial file observable); `SCHEMA_VERSION` is unchanged in the diff.

### REQ-014 — One shared watcher + re-read per resolved root across ALL consumers (performance)
There MUST be at most **one** chokidar watcher and **one** debounced re-read per resolved `.orky/`
root in the entire main process, shared across every consumer of that root — both the cross-project
registry membership AND 0004's per-pane chip path. The recommended implementation is to make this
service the single per-root watch owner (the roadmap's "generalize the single-root `OrkyTracker`"),
fanning each re-read out to both the per-pane `orky:status` emits and the registry aggregate. A root
that is a member via several sources (multiple panes + persisted) MUST still have only one watcher; the
watcher MUST be torn down only when the root has **zero** pane consumers AND is **not** persisted.
Routine edits to non-target files MUST NOT fire a re-read (the 0004 basename/`.json` filter — REQ-027
of 0004 — MUST be preserved). This MUST NOT regress 0004's single-root cost: a single pane open on a
single root yields exactly one watcher, not two.
**Acceptance:** an instance/watcher counter shows exactly one chokidar watcher for a root tracked by N
panes + the persisted list simultaneously; opening a single pane on a single root creates exactly one
watcher (no second registry watcher); a change to a non-target file (e.g. `02-spec.md`) triggers no
re-read while a change to `state.json` does; tearing down the last pane on a persisted root keeps its
watcher, while removing it from the persisted list with no panes tears the watcher down.

### REQ-015 — Per-root read-path bounds + symlink safety apply to EVERY root (security)
The per-root read path MUST apply 0004's resource bounds and symlink guard to **every** tracked root,
including persisted ones — never only the first/active root: cap feature directories per re-read
(`MAX_FEATURE_DIRS`, 200, warn-on-cap), size-cap each `state.json`/`findings.json` before reading
(`MAX_FILE_BYTES`, 1 MiB, skip+warn over cap), and skip (do not follow) any symlinked `features/<slug>`
entry so a symlink cannot redirect a read outside the project. Each cap MUST be a stated limit with a
test, no silent capping (CONV-003).
**Acceptance:** a persisted root whose `features/` has > 200 dirs → only 200 processed + a warning, no
throw, and **other** roots in the aggregate still report; an oversized `state.json` under a non-first
root → skipped+warned, that feature safe-defaults, the rest report; a symlinked `features/<slug>` under
any tracked root → skipped, not read.

### REQ-016 — Add/remove IPC boundary: input validation + path safety (security)
`registry:addRoot` / `registry:removeRoot` (and the read pulls) MUST validate arguments at the IPC
boundary and never let a malformed message crash the main process (Node 22 default
`--unhandled-rejections=throw`): a non-string `root` MUST yield `{ ok:false, error:... }` (not a throw).
For `addRoot`, the path MUST be normalized/resolved to an absolute path and accepted ONLY if the
resolved directory currently contains a `.orky/` directory (reusing the `.orky/`-existence check
semantics of `findOrkyRoot`); a relative path, a path that does not resolve, or a directory with no
`.orky/` MUST be rejected with a specific, actionable error (CONV-001). The resolved root and all reads
beneath it MUST stay confined to `<root>/.orky/` (no `..` traversal/escape), enforced together with the
REQ-015 symlink guard. The new handlers MUST also follow the existing per-window sender discipline of
`register-orky.ts` where applicable (an app-global service still validates the sender per CLAUDE.md's
read-only/sender-scoped pattern).
**Acceptance:** `addRoot(42 as any)` / `addRoot('../../etc')` / `addRoot('/no/orky/here')` each return
`{ok:false}` with a specific error and the main process survives (no unhandled rejection); `addRoot` of
a valid `.orky/`-containing absolute dir succeeds; a crafted path with `..` segments cannot cause a read
outside the resolved root.

### REQ-017 — Strictly read-only under `.orky/`; writes confined to the registry's own store
The service MUST NOT write, create, move, or delete any file under any `<root>/.orky/` tree. Its ONLY
persistence write is `orky-registry.json` under `userData` (REQ-013). It MUST NOT spawn `node` or any
Orky CLI to derive status — status comes purely from file reads + the reused mappers (inherited from
0004 REQ-015).
**Acceptance:** an integration check confirms each fixtured `.orky/` tree is byte-identical (content +
mtime) before and after a tracking session; the only file the service writes is `orky-registry.json`;
code review confirms no `child_process`/`execFile`/`spawn` in the status read path.

### REQ-018 — Robust to missing/partial/malformed per-root state; one bad root never breaks the aggregate
The service MUST tolerate, without throwing or wedging any other root's watch: a tracked root whose
`.orky/` has no `active.json`; a feature dir missing `state.json`/`findings.json`; empty files;
malformed JSON; and a persisted root whose `.orky/` has been deleted on disk after it was added. A root
that is currently unreadable MUST surface `status: null` (REQ-006) rather than be dropped silently or
throw, and the OTHER roots in the snapshot MUST still report correctly. Diagnostics SHOULD be logged
(mirroring 0004's warn-on-read-failure), not silently swallowed (CONV-002).
**Acceptance:** an aggregate of three roots where one has malformed `state.json` → that root's entry is
present with a safe/`null`-or-degraded status, the other two report normally, no throw; a persisted root
whose `.orky/` is deleted at runtime → its entry shows `status:null` (still a member because it is
persisted), the aggregate keeps emitting.

### REQ-019 — Race-safe, disposable, leak-free
The service MUST clone 0004/`UsageTracker`'s **session-identity race pattern** for any per-root async
work that awaits between claiming a slot and using it (claim before the first `await`, re-check
identity after every `await` so a concurrent add/remove/teardown supersedes cleanly). It MUST be
disposable (`dispose()` closes all watchers + clears all timers) and MUST NOT keep the Electron main
process alive after dispose (no lingering watchers/timers — CLAUDE.md long-lived-watcher obligation).
**Acceptance:** after `dispose()`, the service holds zero open watchers and zero pending timers and the
app `close()`s without hanging; an add immediately followed by a remove for the same root leaves no
orphaned watcher or membership entry (the re-check-after-await guard is exercised); a remove of a
never-added root emits no spurious state.

### REQ-020 — Single app-wide instance; aggregate broadcast to all windows
The registry MUST be a single main-process instance (constructed once in the composition root /
`services`), aggregating open-pane roots across **all** windows and the one persisted list. Its
`registry:status` push MUST be broadcast to every window (it is app-global, not pane-scoped — its first
arg is a snapshot, so the existing `send` broadcasts it). There MUST NOT be one registry per window.
**Acceptance:** with two windows each owning panes in different `.orky/` roots, a single aggregate
contains both roots and the `registry:status` snapshot is delivered to BOTH windows; exactly one
registry instance exists (no per-window duplication of watchers for the same root — REQ-014).

### REQ-021 — No renderer UI in this feature (scope guard, D1)
This feature MUST ship NO renderer component that renders the aggregate (no queue panel, settings list,
or badge) — it is IPC/data only. It MAY add the contract types, `src/renderer/api.ts` bindings, and
preload bridge needed for F6 to consume the channels, but no UI surface that displays registry data.
**Acceptance:** the diff introduces the `registry:*` channels + API bindings but no React component
that renders `OrkyRegistrySnapshot`; an e2e launch shows no new visible UI attributable to this feature.

### REQ-022 — IPC contract wiring follows the existing per-domain pattern
The feature MUST add the `registry:*` channel constants + `TermhallaApi` methods to
`src/shared/ipc-contract.ts`, implement them in a per-domain registrar under `src/main/ipc/` (e.g.
`register-registry.ts`) composed by the `register.ts` root, expose them through `src/renderer/api.ts`,
and bridge them through `src/preload/`. Pushes MUST go through the composition root's `send`/`safeSend`
so a push to a destroyed window is a no-op (baseline REQ-002/REQ-003 preserved). No other `window`
bridge may be introduced.
**Acceptance:** the channel names are exactly `registry:status`/`current`/`roots`/`addRoot`/`removeRoot`;
a push dispatched after a window is destroyed is a no-op via `safeSend`; the renderer receives the
snapshot through `onRegistryStatus`; `typecheck` passes with the new `TermhallaApi` methods.

### REQ-023 — Documentation reconciled
A feature doc MUST be added/extended under `docs/features/` (e.g. extend `orky-status.md` or add
`orky-registry.md`) and linked from the CLAUDE.md "Where things live" table; `CHANGELOG.md`
`[Unreleased]` MUST record the feature; the new `registry:*` channels + types MUST be reflected wherever
IPC channels are documented; and `.orky/baseline/architecture.md` MUST be reconciled to note the new
app-wide cross-project registry (generalizing the per-pane `OrkyTracker`) and the new
`orky-registry.json` persisted file. When changing any existing documented claim, the whole `docs/`
tree plus `CLAUDE.md` and `.orky/baseline/` MUST be grepped for stale phrasings (CONV-008).
**Acceptance:** the feature doc exists and is referenced; `CHANGELOG.md [Unreleased]` mentions the
cross-project registry; `.orky/baseline/architecture.md` names the registry service + `orky-registry.json`;
the doc-sync gate passes.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** union/dedup/source-provenance (REQ-002/REQ-006),
  codepoint ordering (REQ-007), persisted-store normalize/load/corrupt-tolerance (REQ-013), and the
  per-root mapper reuse equality (REQ-005) are unit-testable against the pure pieces. Match the style
  of 0004's `orky-status` tests and `quick-store` normalization tests.
- **Main/integration harness:** drive the service with ≥2 synthetic `.orky/` fixtures + a simulated
  pane-cwd signal; assert membership lifecycle (REQ-003/REQ-004/REQ-010), full-set push (REQ-008),
  single-watcher-per-root across panes+persisted (REQ-014), per-root bounds/symlink safety on a
  non-first root (REQ-015), add/remove validation incl. non-string + no-`.orky/` + traversal (REQ-016),
  read-only invariant (REQ-017), malformed-root isolation (REQ-018), race-safety + leak-free dispose
  (REQ-019), and cross-window broadcast with a single instance (REQ-020).
- **e2e (Playwright-for-Electron, against `out/`):** confirm the channels are reachable and that NO new
  UI renders the aggregate (REQ-021), and that `registry:addRoot`/`removeRoot`/`current`/`roots` round-trip.

## Open questions

None blocking. The three brainstorm-deferred items (IPC names, storage format, push granularity) are
resolved above. One forward note (not a blocker): how a human triggers `registry:addRoot` (the
"track this project" gesture) is **intentionally** deferred to F6 per D1/D2 — F5 only exposes the IPC.
