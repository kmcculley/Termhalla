# Native Orky pane (feature 0009)

> A first-class, persisted mosaic **pane kind** (`orky`) that shows EVERYTHING about ONE tracked
> Orky project — every feature (including the idle and clean-done ones the status popover and the
> decision-queue drawer deliberately omit), its per-gate records, findings, and escalations —
> as a permanent, tiling-layout citizen. Tier T3 of the Termhalla × Orky integration: F6's drawer
> answers "what needs me across ALL projects"; this pane answers "show me everything about THIS
> project". Strictly READ-only: no `.orky/` write, no CLI, no `orkyAction:*` call, no registry
> mutation.

## The pane kind + persistence (SCHEMA_VERSION 7 → 8)

`PaneConfig` gained `OrkyConfig { kind: 'orky'; root: string; name?; theme? }` and `PaneKind`
gained `'orky'` — the pane participates in every kind-generic operation (split, drag, minimize/
restore, maximize, cross-workspace move, undock/redock, workspace templates, per-pane theme) via
the existing opaque-config machinery; no per-kind branch was added to any of those paths.

This is the first `SCHEMA_VERSION` bump since v7 (feature 0003): **v7 → v8**. The v<8 migration
step in `workspace-model.ts` is a documented identity (a pre-v8 record cannot contain an `orky`
pane, so nothing is rewritten) — the bump exists so an **older build rejects a v8 workspace file**
via its existing "newer than supported" guard instead of loading a pane kind it cannot render.
A v7 `app-state.json` still loads unchanged (its migration keys only on the version bound).

## The binding model

- `config.root` is the persisted binding — the project root (the dir containing `.orky/`) — stored
  **verbatim, case-preserved** (the aggregate entry's exact spelling), never re-cased, re-slashed,
  or re-resolved on save/load.
- Matching the binding to an aggregate entry (and to a `registry:rootChanged` notification) uses
  `sameProjectRoot(a, b, { caseFold })` (`src/shared/orky-pane.ts`) — pure, fold-INJECTED
  **equality** (slash style and trailing separators fold always; case folds iff injected; never
  prefix/containment), with the fold mode derived once from `navigator.platform` via the shared
  `caseFoldFromPlatform`. The module never reads `process` (undefined in the contextIsolated
  renderer main world).
- Binding **never contributes registry membership**: a bound root's membership still comes from
  open terminals and the persisted list. A malformed persisted binding (missing/non-string `root`)
  is coerced to `''` at load — the pane is kept, never dropped, and renders the unbound state.

## Degraded states + re-bind

Four explicit, mutually-distinct pane states (never a silent blank):

- **loading** (`orky-pane-loading`) — bound member, before the first detail settle.
- **unbound** (`orky-pane-unbound`) — the persisted root is not a member of the held snapshot (or
  is `''`). Copy names the root verbatim; the `orky-pane-rebind` button opens the SAME
  `OrkyRootPicker` used by creation. Re-binding persists via `updatePaneConfig`/autosave and
  fetches fresh. A root that RE-ENTERS membership resumes bound rendering automatically.
- **unreadable** (`orky-pane-unreadable`) — the root IS still tracked but its `.orky/` data is
  missing or unreadable (the detail read returned `orky-missing`).
- **error** (`orky-pane-error`) — any other fetch failure, with the specific error text; a held
  stale-but-valid detail keeps rendering underneath, never blanked.

Per-FEATURE unreadability inside a healthy payload is NOT a pane-level state: a skipped slug
renders an explicit `orky-pane-feature-unreadable` row and a torn `findings.json` renders a
findings-unavailable note, with the rest of the pane intact.

## The `registry:detail` contract (the read side)

`CH.registryDetail = 'registry:detail'` — a renderer→main pull (preload `registryDetail(root)`),
registered in the existing `register-registry.ts` registrar with its sender gate and disposer.
Validation lives inside `OrkyRegistry.detail`: only a **current aggregate member** (matched by
normalized case/slash-folded key, either membership source) is readable — anything else gets a
structured `ok:false root-not-tracked` naming the input, so the channel can never read arbitrary
filesystem paths. An unknown sender gets `ok:false unknown-sender` with no filesystem read.

The assembler (`src/main/orky/orky-root-detail.ts`) reuses the SAME `@shared/orky-status` mapper
pipeline the aggregate uses (`orkyFeatureStatus`, `normalizeFeatureRaw`, `normalizeFindings`,
`parseOrkyTimestamp`, and the extracted `isBlockingFinding` predicate — `openBlockingCount` now
delegates to it), plus the detail layers the aggregate drops: all 8 per-gate records in canonical
`ORKY_PHASES` order, findings and escalations in file order verbatim. `computedAt` is the ONE
injected clock instant every time-derived datum used. Engine-parity bounds with three deliberate
divergences:

- **Sort-before-cap:** feature slugs are codepoint-sorted BEFORE the 200-dir cap
  (`capFeatureSlugs`), so the survivor set is deterministic (`featuresCapped: true` + a warn on
  truncation) — never the engine's raw-enumeration-order slice.
- **Torn-read retry:** the producer writes `state.json` non-atomically and this one-shot read has
  no watcher-style write-finish shield, so an existing-but-unparseable file is retried once after
  150 ms; if it stays unreadable it is **surfaced, never silently dropped** — a bad `state.json`
  puts its slug in `skippedFeatures`, a bad `findings.json` yields `findingsUnreadable: true` with
  gates/escalations intact, a bad `active.json` is absent-equivalent. Every feature dir whose
  `state.json` exists appears in `features` OR `skippedFeatures`.
- **No retry for absent/oversized files** (absence is legitimate; oversize is a warned,
  deterministic skip — 1 MiB cap, engine parity). Absence is classified by errno: only
  ENOENT/ENOTDIR is "absent" — any other stat failure (EACCES/EPERM) is an existing-but-unreadable
  file and flows through the retry-then-surface path above. Symlinked feature dirs are skipped, and
  the three leaf files (`active.json`, `state.json`, `findings.json`) are `lstat`-checked and never
  followed when symlinked (refused and surfaced like an unreadable file — detail-path only; the
  engine keeps its own semantics).

One-shot: no watcher, no engine consumer, no recurring timer, no write of any kind.

### Accepted staleness class — cross-FILE read skew (documented, not fixed)

An `ok:true` payload is coherent **per-file, not per-feature-across-files**: `state.json` and
`findings.json` are read sequentially with independent bounded retries, and the producer writes
them from separate commands (`state.json` via plain `writeFileSync`, `findings.json` via
temp+rename), so within one payload a feature's `status`/`gates`/`escalations` and its `findings`
can straddle a producer write (e.g. a gate recorded in `state.json` whose paired ledger write lands
after that feature's `findings.json` read). This cross-file read skew is accepted because it is
bounded and **self-healing by construction**: each producer write fires the watcher → 300 ms
debounce → completed engine re-read → `registry:rootChanged` → a DISPLAYED pane refetches (a hidden
pane marks `stale` and heals on display), so a skewed payload survives at most one notification
cycle (~450 ms) while displayed. No cross-file transaction or arbitration mechanism exists — the
notification below IS the healing mechanism.

## `registry:rootChanged` — the detail view's currency mechanism

The aggregate entry is LOSSY along exactly the dimensions the pane adds (findings edits that
preserve the blocking count; any change to an idle/clean-done feature), so aggregate deep-equality
cannot signal detail staleness. Instead `CH.registryRootChanged = 'registry:rootChanged'` — an
app-global main→renderer push carrying the **bare project-root string only** — fires on EVERY
completed engine re-read of a root (no delta gating; including the null-status emit for a vanished
`.orky/`). It rides `OrkyRegistry`'s existing `engine.onStatus` subscription (no new engine
consumer) and is bridged by preload `onRegistryRootChanged(cb)`.

Renderer-side, `App.tsx` routes it into one store action (`notifyOrkyRootChanged`) whose fan-out
is **per-root targeted**: only DISPLAYED panes whose binding `sameProjectRoot`-matches fetch.
"Displayed" is the pane's EFFECTIVE visibility across THREE keep-mounted-but-hidden hosts (the
model was amended mid-review — FINDING-013 named the first two, FINDING-035 found the third on
re-verification): a minimized pane, a pane in an inactive (background) workspace, and a pane that
is a sibling of a MAXIMIZED tile in its own (active) workspace — `.ws-max` hides every sibling tile
with the same `visibility:hidden`/`pointer-events:none` pattern as an inactive workspace, and
`PaneTile` derives a self-excluded `maximizedOver` flag from `s.maximized[wsId]` and threads
`hidden={wsInactive || maximizedOver}` into `OrkyPane`. All three hidden hosts mark themselves
`stale` (zero fetches, no matter how busy the root) and fetch exactly once on restore/workspace
activation/un-maximize; a non-stale restore fetches zero times. Other roots' panes get zero fetches
and zero re-renders. Any future keep-mounted-but-hidden host (a new overlay, a picture-in-picture
tile, etc.) MUST thread its hiding into this same boundary and its own vector into the trigger×state
test matrix — see CONV-028.
Fetches coalesce (at most one in flight per pane, one follow-up, latest root wins); a coalesced
follow-up re-checks the hidden/bound gate at settle time (hidden → converts to `stale`, unbound →
dropped); a settling response is discarded unless it still matches the pane's binding and fetch
generation. Per-pane state (`orkyPaneDetail`) is pruned through the same `clearPaneRuntime` seam
as every other per-pane runtime map.

## Creation affordances

Three, matching the existing kinds' full set, all routed through `dispatchAddPane`'s `'orky'`
branch with an injected root-picker callback: the command palette (`New Orky pane…`), the tab
bar's `add-pane` select, and the split compass (`split-kind-orky-<paneId>`, disabled with an
explanatory name while the snapshot has no member). All three open the shared `OrkyRootPicker`,
which lists the held registry snapshot's member roots with four distinct states
(loading/error/empty/list); selecting commits the root verbatim, cancel/Escape commits nothing.

`data-feature` — and the row key, and the `expandedRows` disclosure key — is the payload's `slug`
field (the feature DIR name from the sorted walk, unique by construction), **never**
`status.feature` (`state.json`'s free-text `feature` field, `'(unknown)'`-falling-back, and NOT
unique — a copied feature dir or two malformed `state.json` files can collide on it). Display
order falls through a stable sort to a slug codepoint tiebreak, so duplicate `feature` values stay
deterministic end-to-end even under that collision.

## Forward compatibility (F10)

Every feature row carries the stable `(data-project-root, data-feature)` identity (F7's request
pair, `data-feature` = the unique `slug`), escalation rows carry `data-escalation-id`, and each row
ends in a reserved, deliberately EMPTY `orky-pane-row-actions` slot — F10 attaches answer/resume/
record-gate affordances there without restructuring row layout, identity, or ordering. F10 also
inherits the post-action currency path for free: its writes land on disk → the engine re-reads →
`registry:rootChanged` refreshes the pane.

## Where things live

| Piece | Path |
|---|---|
| Persisted config + detail wire types + `SCHEMA_VERSION = 8` | `src/shared/types.ts` |
| v<8 migration + malformed-binding load coercion | `src/shared/workspace-model.ts` |
| Binding equality (`sameProjectRoot`) | `src/shared/orky-pane.ts` |
| Blocking predicate (`isBlockingFinding`) | `src/shared/orky-status.ts` |
| Detail assembler (`assembleOrkyRootDetail`, `capFeatureSlugs`) | `src/main/orky/orky-root-detail.ts` |
| `OrkyRegistry.detail` / `onRootChanged` | `src/main/orky/orky-registry.ts` |
| IPC channels (`registry:detail`, `registry:rootChanged`) + registrar | `src/shared/ipc-contract.ts`, `src/main/ipc/register-registry.ts` |
| Renderer detail slice (fetch/coalesce/fan-out/rebind) | `src/renderer/store/orky-pane-slice.ts` |
| Pane component + root picker | `src/renderer/components/OrkyPane.tsx`, `src/renderer/components/OrkyRootPicker.tsx` |
