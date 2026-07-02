# 0006 — Decision-queue panel (read)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 window-scoped drawer,
D2 renderer-only over the F5 aggregate, D3 needs-human-now membership with deterministic ordering,
D4 click-to-focus + open-terminal fallback, D5 explicit loading/empty/error states). The five
brainstorm decisions are FIXED; this spec makes them testable and **resolves** the brainstorm's
non-blocking spec-time items (component/command naming, badge placement, "open terminal here"
wiring) inline (see "Resolved spec-time decisions"). REQ-IDs are stable; never renumber.
**Revised 2026-07-01** addressing spec-gate findings FINDING-001..005: REQ-003/009/010/011 amended
in place, REQ-019 added, Verified contract re-pinned against shipped source. No REQ renumbered.

This is the **first renderer consumer** of F5's `registry:status` cross-project aggregate (Tier T1,
UI half). It ships renderer + shared code ONLY — no new main-process service, no new IPC channel, no
Orky CLI invocation, no writes under any `.orky/` tree (REQ-003, REQ-017). Because F5 shipped a
frozen scope guard asserting exactly this consumer does not exist yet, that guard is formally
superseded here (REQ-019) — retired at F6's tests phase, never silently during implementation.

## Concerns

`ux` `performance` `determinism` `quality`

- `ux` — the queue drawer must not fight the existing right-side notes drawer (both window-chrome
  collapsibles, REQ-014); badge/count semantics must match the list exactly (REQ-007); toggle + entry
  focus must be keyboard-accessible with visible focus outside the `.mosaic` subtree (REQ-014,
  CONV-007's standing rule).
- `performance` — `registry:status` pushes arrive on every tracked-root re-read and the F5 service
  emits a **new snapshot array object** on every recompute (verified: `OrkyRegistry.recompute()`
  rebuilds `this.snapshot` each emit), so reference equality never holds across pushes; a
  value-identical push must not re-render the queue or badge (REQ-008).
- `determinism` — identical aggregate in → identical DOM order out (D3): membership, grouping, and
  ordering are pure functions of the snapshot with no locale/clock/randomness dependence (REQ-005,
  REQ-006); the subscription-vs-recovery-pull race is explicitly arbitrated (REQ-003, REQ-011).
- `quality` — reuse 0004/F5 shared mappers, comparators, and types; no forked status logic in the
  panel (REQ-004, REQ-005, REQ-015). `data-provenance` is **n/a** — this feature embeds no
  factual/reference data; every displayed datum comes off the live aggregate.

## Resolved spec-time decisions (with rationale)

1. **Component + store naming** — a new window-chrome component `DecisionQueuePanel`
   (`src/renderer/components/DecisionQueuePanel.tsx`), rendered by `App.tsx` as a sibling of
   `NotesPanel` in the main flex row; store state `queueOpen` / `setQueueOpen` (session-scoped, NOT
   persisted — mirroring `notesOpen`, which is set without `scheduleQuickSave`). Names are
   suggestions; the testids and behaviors below are the contract.
2. **Command id + default chord** — new rebindable `CommandId` **`toggle-orky-queue`** in
   `src/shared/keybindings.ts` `COMMANDS`, default chord **`mod+shift+o`** (verified free against
   every existing default: k, ',', tab / shift+tab, and shift+ t, m, h, enter, w, n, f, l; and not a
   reserved `Ctrl+1..9` digit).
3. **Badge placement** — on the status-bar toggle affordance itself (`data-testid`
   `orky-queue-toggle`), next to the existing `search-toggle`/`notes-toggle` buttons; the badge is
   the queue-entry count (REQ-007).
4. **"Open terminal here" wiring** — reuse the existing `launchDir`-style pane spawn (a `terminal`
   pane committed with `cwd` = the project root), the same capability the palette's directory items
   and `relaunchFromSearch` already use. No new main-process capability (REQ-010).
5. **Focus scope is window-local** — click-to-focus targets panes in THIS window's workspaces only
   (the renderer store only knows its own window's panes; cross-window focus would need new IPC,
   which D2 forbids). A project whose panes all live in another window shows the pane-less fallback
   in this window (REQ-009/REQ-010).
6. **Pane↔root matching is derived renderer-side, on the aggregate's own binding signal** — the
   shipped `OrkyRegistryEntry` carries NO pane ids (verified against `src/shared/types.ts` — the
   wire shape is `{root, source, status}` only; the main-side `onPaneRoot` binding never reaches the
   renderer), so D4's "the F5 membership already knows pane bindings" is true only main-side. F6
   derives the binding in the renderer from the panes' **cwd-first candidate paths** — the same
   signal the aggregate itself binds on (`findOrkyRoot(cwd)`) — via a pure shared matcher (REQ-009)
   rather than adding IPC. Recorded as an upstream note, not fixed here.

## Baseline fit (brownfield — `.orky/baseline/` present)

Additive at the **baseline** level: supersedes **no** baseline REQ and edits no characterization
test. It DOES supersede one F5 **feature-level frozen test**: `tests/shared/
registry-no-renderer-ui.test.ts` (TEST-070, F5 REQ-021), whose own header names F6 as the designed
first consumer. Its retirement is normative and scheduled — see **REQ-019**: retired at F6's tests
phase, by the test-designer, in the same change that introduces F6's suite, with supersession notes
in the replacement guard and `04-tests.md`. Never silently edited during implementation.

- **Baseline REQ-017 (keybinding resolution & dispatch, CHAR-013)** is extended, not changed: one new
  entry in `COMMANDS` with a non-conflicting default chord; `resolveBindings`/`matchShortcut`
  semantics are untouched, so CHAR-013 stays green.
- **Baseline REQ-022 (pane project-key resolution, CHAR-019)** is left untouched but deliberately
  NOT reused for pane↔root matching: `resolveProjectKey`'s git-root-FIRST order contradicts the
  aggregate's own cwd-based `findOrkyRoot` binding (a pane whose `.orky` root lies beneath its git
  root would mis-match). REQ-009 records this scoped divergence; `resolveProjectKey` itself and its
  consumers (NotesPanel, CHAR-019) are byte-unchanged.
- **Baseline REQ-024 (versioned persistence)** is honored by NOT persisting anything: no new
  persisted file, no `SCHEMA_VERSION` bump, drawer open state is session-scoped (REQ-017).
- 0004/0005 shared modules (`orky-status.ts`, `orky-registry.ts`, wire types) are consumed, never
  forked; exporting the existing feature comparator (REQ-005) changes no behavior.

**Proposed convention (for doc-sync promotion, from FINDING-001):** a frozen scope-guard test
asserting the ABSENCE of a future consumer ("no X consumes Y yet") MUST name the feature expected to
retire it, and that consumer feature's spec MUST retire/supersede the guard atomically in the same
change — at the tests phase, never silently during implementation.

## Verified contract (pinned upstream shapes — read from source, not memory)

Confirmed against `src/shared/types.ts`, `src/shared/orky-status.ts`, `src/shared/orky-registry.ts`,
`src/main/orky/orky-registry.ts`, `src/preload/index.ts`, `src/shared/ipc-contract.ts`,
`src/main/ipc/register-orky.ts`, `src/main/orky/find-orky-root.ts`, `src/shared/project-key.ts`, and
`src/renderer/components/OrkyWatcher.tsx` on 2026-07-01. F6 consumes EXACTLY these fields; if a
datum is not listed here, F6 does not display it (D2).

- **Channel `registry:status`** (`CH.registryStatus`) — main→renderer, app-global broadcast, carries
  the COMPLETE `OrkyRegistrySnapshot` on every membership or per-root status change (F5 REQ-008);
  never a diff. **Channel `registry:current`** (`CH.registryCurrent`) — renderer→main pull returning
  a snapshot deep-equal to the last push (F5 REQ-011, the missed-push recovery mirror of
  `cloud:current`). Both are already bridged: `onRegistryStatus` / `registryCurrent` exist in
  `src/preload/index.ts` (lines 77–79) and `TermhallaApi` — and are consumed by **no** renderer code
  today (verified: `App.tsx` wires no `onRegistryStatus`; F5 REQ-021 shipped no UI). Push-vs-pull
  ORDERING is NOT guaranteed by any pinned contract — the arbitration is F6's to specify (REQ-003).
- **F5's frozen scope guard TEST-070** (`tests/shared/registry-no-renderer-ui.test.ts:26-36`) greps
  every `src/renderer/**/*.{ts,tsx}` file for
  `OrkyRegistrySnapshot|OrkyRegistryEntry|RegistryMutationResult|onRegistryStatus|registryCurrent(|registryRoots(|registryAddRoot(|registryRemoveRoot(`
  and asserts zero matches; its header (lines 1-10) states "F6 is the first UI consumer". REQ-003's
  mandated subscription cannot land while it stands — hence REQ-019's scheduled supersession.
- **Pane↔root binding signal (pinned for REQ-009):** the aggregate's `source:'pane'` membership is
  resolved main-side from the pane's LIVE tracked cwd — `OrkyWatcher` sends
  `api.orkyWatch(id, cwds[id])` (`src/renderer/components/OrkyWatcher.tsx:17`);
  `register-orky.ts` resolves `void orky.watch(id, cwd).then((root) => onPaneRoot(id, root))`
  (`src/main/ipc/register-orky.ts:34-38`); the resolution is `findOrkyRoot(cwd)`, a bounded UPWARD
  `.orky/` walk from the cwd (`src/main/orky/find-orky-root.ts:13-26`). Git roots are never
  consulted in this binding. The resolved root does NOT reach the renderer: `OrkyPaneStatus` is
  exactly `{kind, label, needsHuman, failed, features, chipFeature}` with no root field
  (`src/shared/types.ts:44-51`), and `onPaneRoot` is main-process-internal. `resolveProjectKey`
  (`src/shared/project-key.ts:6-19`) is git-root-FIRST (then live cwd, then persisted terminal
  `config.cwd`) and is therefore NOT the aggregate's binding signal.
- **Renderer platform facts (pinned for REQ-009's fold mode):** zero `process`/`platform`/
  `navigator` reads exist under `src/renderer/` today (grep verified 2026-07-01), and the preload
  exposes no platform constant (`src/preload/index.ts`, full API surface read). The renderer main
  world is contextIsolated: `process` is NOT defined there at runtime, while vitest/jsdom DOES
  define it — the exact test-green/runtime-broken trap. `navigator` (a standard DOM global, present
  in both the real renderer and jsdom) is the only platform signal available without a preload or
  main change.
- **`OrkyRegistrySnapshot = OrkyRegistryEntry[]`** — sorted by `root`, **codepoint** order, never
  `localeCompare` (F5 REQ-007), so equal membership+status always serializes identically.
- **`OrkyRegistryEntry`** — exactly `{ root, source, status }`:
  - `root: string` — resolved project-root absolute path (the dir CONTAINING `.orky/`), original
    case-preserved `resolve()` form (NOT case-folded; folding is comparison-only via
    `normalizeProjectRoot`).
  - `source: 'pane' | 'persisted' | 'both'` — membership provenance (F6 displays entries regardless
    of source; it does not filter on it).
  - `status: OrkyPaneStatus | null` — the reused 0004 roll-up; `null` = not yet read / unreadable
    (F5 REQ-006/REQ-018). **No pane ids are on the wire.**
- **`OrkyPaneStatus.features: OrkyFeatureStatus[]`** — the popover-eligible set: idle and clean-done
  features are already excluded (`inPopover`), and the array is already sorted by the chip
  comparator (`compareFeatures`: needsHuman-first, then reason rank escalation(0) < stalled(1) <
  human-review(2), then newer `lastActivityAt`, then feature-id codepoint). **Pinned property F6's
  ordering relies on:** every `needsHuman: true` item precedes every `needsHuman: false` item — the
  queue for an entry is a contiguous leading prefix of `status.features`.
- **`OrkyFeatureStatus` fields consumed:** `feature` (slug), `needsHuman: boolean`,
  `reason: 'escalation' | 'stalled' | 'human-review' | null` (0004's gate-based needs-human model:
  open escalation / stall / autonomous-gates-green-awaiting-human-review), `phase`
  (`OrkyPhase | null` — the LIVE phase; `null` = complete), `gateN`/`gateM` (numbers,
  `gateM === ORKY_PHASES.length === 8`), `openBlocking: number`, `lastActivityAt: number` (epoch ms,
  tz-safe per 0004 REQ-028), `detail: string` (already specific + actionable per CONV-001).
- **`normalizeProjectRoot`** (`src/main/orky/validate-root.ts`) — the CONV-010 comparison key:
  `path.resolve()` then lowercase on win32 only. It is a **main-process module** (imports
  `node:path` and reads `process.platform`), so F6's renderer-side matcher must implement the SAME
  fold semantics in a pure shared module with the fold mode INJECTED — never read from `process` —
  and pin equivalence with host-independent `path.win32`/`path.posix` test vectors (REQ-009).

## Public interface

No new IPC. Renderer/shared additions only (D2's allowed set: palette entry, keybinding
registration, store selectors — plus the drawer component itself and its store state).

```ts
// src/shared/keybindings.ts — one new rebindable command (REQ-002)
type CommandId = ... | 'toggle-orky-queue'
type Shortcut  = ... | { type: 'toggle-orky-queue' }
// COMMANDS += { id: 'toggle-orky-queue', label: 'Toggle Orky decision queue', category: 'General',
//               defaultChord: mod+shift+o, tip: 'open the Orky decision queue' }

// src/shared/decision-queue.ts (new, pure — no DOM, no Electron, no ../api, NO `process` reads)
// (REQ-004/005/007/009)
export interface DecisionQueueItem {
  projectRoot: string            // OrkyRegistryEntry.root, verbatim (the stable identity for F8)
  featureSlug: string            // OrkyFeatureStatus.feature, verbatim
  status: OrkyFeatureStatus      // the reused upstream shape — no re-projection
}
export interface DecisionQueueGroup {
  projectRoot: string            // verbatim root (full path — the hover/title text)
  projectName: string            // display name = basename of root
  items: DecisionQueueItem[]     // ≥1, in upstream `status.features` (comparator) order
}
/** Total: null/[]/malformed snapshot → []. Groups ordered by top-item rank (shared comparator),
 *  ties by root codepoint. */
export function buildDecisionQueue(snapshot: OrkyRegistrySnapshot | null): DecisionQueueGroup[]
/** THE single count source (badge AND list): sum of items across groups. */
export function decisionQueueCount(groups: DecisionQueueGroup[]): number
/** Renderer-safe root matcher (REQ-009): the LONGEST aggregate root that contains `panePath`
 *  (boundary-safe; slash-fold always, case-fold iff `opts.caseFold`), or null. Fold mode is
 *  INJECTED — this module never reads `process` (undefined in the contextIsolated main world). */
export function matchPaneRoot(
  panePath: string, roots: readonly string[], opts: { caseFold: boolean }
): string | null
/** Fold-mode derivation for the renderer caller: true iff `platform` names Windows (e.g.
 *  navigator.platform 'Win32'). Pure string → boolean; tests inject strings directly. */
export function caseFoldFromPlatform(platform: string): boolean

// src/shared/orky-status.ts — EXPORT the existing private comparator (no copy, no behavior change):
export function compareOrkyFeatures(a: OrkyFeatureStatus, b: OrkyFeatureStatus): number  // = compareFeatures

// src/renderer/store (new state; names indicative)
registrySnapshot: OrkyRegistrySnapshot | null   // last VALID snapshot (null until first receipt)
registryError: string | null                    // error-state text (REQ-013); null when healthy
queueOpen: boolean                              // session-scoped drawer state (not persisted)
setQueueOpen(open: boolean): void
setRegistrySnapshot(s: OrkyRegistrySnapshot): void   // deep-equal short-circuit (REQ-008);
                                                     // generation-guarded vs the recovery pull (REQ-003)
paneFocusSeq: Record<string, number>            // paneId -> monotonic focus sequence (REQ-009);
                                                // pruned when the pane leaves the store (CONV-011)
```

Key testids (the DOM contract tests pin): `orky-queue-toggle` (+ badge text), `decision-queue-panel`,
`decision-queue-loading` / `decision-queue-empty` / `decision-queue-error`,
`decision-queue-group-<root>` with `data-project-root`, `decision-queue-item` rows with
`data-project-root` + `data-feature`, and `decision-queue-open-terminal` for the fallback affordance.

---

## Requirements

### REQ-001 — Window-scoped collapsible drawer, NOT a pane kind (D1) — `ux`
The queue MUST render as a right-side collapsible drawer at **window scope** — a sibling of
`NotesPanel` in `App.tsx`'s main flex row, the same interaction family as the notes drawer — mounted
only while open. It MUST NOT be a workspace-mosaic pane kind: no new `PaneKind`, no `PaneConfig`
variant, no mosaic-layout participation, and no workspace/app-state schema change (a first-class
OrkyPane is F9's job).
**Acceptance:** with `queueOpen`, an element `data-testid="decision-queue-panel"` renders OUTSIDE
every `.mosaic`/workspace-host subtree and outside the mosaic layout tree; the diff adds no
`PaneKind`/`PaneConfig` variant; `SCHEMA_VERSION` is unchanged; closing the drawer unmounts it
without altering any workspace layout.

### REQ-002 — Three toggle surfaces: status bar, palette, rebindable keybinding (D1) — `ux`
The drawer MUST be toggleable from (a) a status-bar affordance (`orky-queue-toggle`, alongside the
existing search/notes toggles), (b) a Ctrl+K command-palette command entry, and (c) a new
**rebindable** command `toggle-orky-queue` registered in the `COMMANDS` table with default chord
`mod+shift+o` and dispatched by the existing `App.tsx` shortcut switch. The default chord MUST NOT
conflict with any existing default binding or the reserved `Ctrl+1..9` jumps. Any surface that
DISPLAYS the chord (tooltip/title text) MUST derive it from `resolveBindings` (the user-customizable
registry), never hard-code the chord string (CONV-005's standing rule).
**Acceptance:** each of the three surfaces toggles `queueOpen` (open→close→open observable in DOM);
`findConflict(DEFAULT_BINDINGS, mod+shift+o, 'toggle-orky-queue') === null`; the command appears in
Settings ▸ Keybindings and honors a rebind + an explicit `'none'` unbind; the toggle's tooltip chord
text changes when the binding is rebound (no hard-coded "Ctrl+Shift+O" literal in the tooltip path).

### REQ-003 — Renderer-only; the F5 aggregate is the sole data source (D2) — `quality` `determinism`
The feature's ONLY data path MUST be: subscribe to `registry:status` in `App.tsx`'s one-shot push
subscription block, plus ONE `registryCurrent()` recovery pull after subscribing (mirroring the
existing `cloudCurrent()` missed-push recovery — the push may fire before React mounts the
listener). It MUST introduce NO new IPC channel, NO main-process code change, NO preload change, and
MUST NOT call `registry:addRoot`/`registry:removeRoot`, any `orkyAction:*` method, or any Orky CLI.
If a datum is not in the aggregate, the panel MUST NOT display it.
**Race arbitration (FINDING-004):** the recovery pull MUST be generation-guarded. The store keeps a
monotonic snapshot generation incremented on every applied snapshot; the pull records the generation
at ISSUE time, and its result MUST be discarded if ANY snapshot (push or pull) was applied after the
pull was issued — first valid snapshot wins, and once any snapshot is held, pushes are the sole
source. No ordering assumption about Electron invoke-reply vs send delivery may be load-bearing.
**Acceptance:** the diff touches no file under `src/main/` or `src/preload/` and adds no `CH.*`
constant; a harness that only pushes `registry:status` (or only answers `registryCurrent`) fully
drives the panel; a snapshot delivered BEFORE the renderer subscribed is recovered via the
`registryCurrent()` pull (drawer leaves loading without any push); a `registryCurrent()` promise
that resolves with a STALE snapshot AFTER a `registry:status` push has been applied leaves the
store and DOM on the PUSHED data (badge/list unchanged — a render probe asserts no regression
render); grep confirms no `registryAddRoot`/`registryRemoveRoot`/`orky*` action-method call in the
feature's code.

### REQ-004 — Queue membership = needs-a-human-now, reused not re-derived (D3) — `quality` `determinism`
A queue item MUST be a `(projectRoot, featureSlug)` pair where the entry's `status` is non-null and
the feature appears in `status.features` with `needsHuman === true` — i.e. exactly 0004's
established semantics (open escalation, stalled active run, or autonomous-gates-green awaiting
`human-review`), read off the carried `needsHuman`/`reason` fields. The selector MUST NOT recompute
gates, escalations, or stalls from any other data, MUST NOT re-implement `inPopover`/`isStalled`/
gate logic, and MUST include entries regardless of `source`. Entries with `status: null` and
features with `needsHuman: false` (busy/idle/done/failed-but-not-needs-human) contribute NO items.
**Acceptance:** a fixture snapshot with features covering all three reasons plus a busy, an idle-
excluded, a clean-done-excluded, and a `status:null` entry yields items for exactly the three
`needsHuman` features; the selector reads `needsHuman`/`reason` (code assertion: no import or copy
of gate-evaluation logic); a `source:'persisted'` root with no open pane still contributes items
(pane-independence is the feature).

### REQ-005 — Grouping + deterministic ordering via the shared comparator (D3) — `determinism` `quality`
Items MUST be grouped by project: group label = basename of `root`, with the FULL root path exposed
on hover (`title`/tooltip). **Within** a group, items MUST preserve the relative order they already
have in `status.features` (the upstream `selectChipFeature`/`compareFeatures` ranking — pinned
contiguous-prefix property, Verified contract). **Across** groups, projects MUST be ordered by their
top item's rank using the SAME comparator `selectChipFeature` uses — exported from
`src/shared/orky-status.ts` as `compareOrkyFeatures`, never copied or re-implemented — with ties
broken by `root` codepoint comparison (never `localeCompare`).
**Acceptance:** given project A whose top item is `stalled` and project B whose top item is
`escalation`, B's group precedes A's; two groups with comparator-equal top items order by root
codepoint; within a group the item order equals the `needsHuman` prefix of `status.features`
verbatim (no re-sort); a code assertion confirms the cross-project rank calls the exported
`compareOrkyFeatures` (single definition; `selectChipFeature`'s behavior unchanged).

### REQ-006 — Identical aggregate in → identical DOM order out (D3) — `determinism`
The rendered entry order MUST be a pure function of the snapshot value: two deep-equal snapshots
(regardless of array-object identity or delivery order) MUST render byte-identical group/item
orders, and successive pushes that do not change membership or status MUST NOT reorder any row. The
pipeline MUST use no locale-dependent comparison, no `Date.now()`/randomness, and no Map-iteration-
order dependence beyond the already-sorted snapshot.
**Acceptance:** rendering two deep-equal but non-identical snapshot objects yields the same ordered
list of `(data-project-root, data-feature)` pairs; 100 shuffled-fixture rebuilds of
`buildDecisionQueue` produce one order; the sort path contains no `localeCompare`.

### REQ-007 — Badge count = list count: one selector, one number (D5) — `ux` `quality`
The status-bar affordance MUST show a badge with the total queue-entry count, and that number MUST
be produced by the SAME shared selector output that renders the list (`decisionQueueCount` over the
same `buildDecisionQueue` result) — never a second, independently-computed count. When the count is
0 (or the snapshot is not yet received / errored) NO numeric badge is shown. The badge MUST be live
while the drawer is closed (the subscription is app-level, not drawer-mounted).
**Acceptance:** a fixture producing 3 items renders badge text "3" AND exactly 3
`decision-queue-item` rows; pushing a snapshot that drops one item updates badge and list together
to 2/2 with the drawer closed-then-opened; count 0 renders no numeric badge; a code assertion
confirms badge and list derive from one selector call chain (no duplicate counting logic).

### REQ-008 — Value-identical pushes cause zero re-renders (memoization) — `performance`
Because F5 emits a NEW snapshot array object on every root re-read, the store's snapshot setter MUST
short-circuit on deep-equality: an incoming snapshot deep-equal to the current one MUST keep the
existing state reference so no subscribed component re-renders. Derived selectors (queue groups,
count) MUST be memoized on the snapshot reference so an unchanged store value re-derives nothing.
A CHANGED snapshot MUST re-render promptly (no over-memoization).
**Acceptance:** with a render-count probe on the queue list and badge, dispatching a deep-equal (but
`!==`) snapshot causes 0 re-renders of both; dispatching a snapshot with one changed field causes
exactly one re-render pass reflecting the change; `buildDecisionQueue` is invoked at most once per
distinct snapshot reference (probe/spy assertion).

### REQ-009 — Click-to-focus the most-recently-focused matching pane in this window (D4) — `ux` `determinism`
Clicking a queue item MUST focus the most-recently-focused open pane **in this window** whose
project path resolves under the item's `projectRoot`, activating that pane's workspace and focusing
the pane (the `revealPaneFromSearch` pattern: `setActive` + `setFocusedPane`). Because the wire
carries no pane bindings and the main-side resolved per-pane root never reaches the renderer
(Verified contract), the pane↔root match MUST be derived renderer-side by a pure shared matcher,
pinned on the SAME signal the aggregate itself binds on — the pane's cwd, NOT its git root:

- **Candidate paths, tried in order:** (1) the pane's live tracked cwd (`cwds[paneId]` — the exact
  value `OrkyWatcher` sends to `orkyWatch`, from which the main process resolves the pane's
  `source:'pane'` root via `findOrkyRoot`'s upward `.orky/` walk); (2) the pane's persisted terminal
  `config.cwd` when no live cwd is known; (3) the pane's `gitStatus.root` ONLY when neither cwd
  signal exists. This deliberately inverts baseline REQ-022's git-root-first `resolveProjectKey`
  order **for this matching only** (a recorded divergence — `resolveProjectKey` itself and
  NotesPanel/CHAR-019 are unchanged): git-root-first would mis-bind any pane whose `.orky` project
  root lies beneath its git root, contradicting the aggregate's own `findOrkyRoot(cwd)` binding.
- **Match rule:** a candidate matches root R iff it equals R or lies beneath R at a path-segment
  boundary, compared with `normalizeProjectRoot`-equivalent folding (resolve-style separator
  normalization always; case-fold iff `opts.caseFold` — CONV-010; one shared matcher, no second
  ad-hoc key). Among member roots containing the candidate, the LONGEST root wins (mirroring
  `findOrkyRoot`'s nearest-ancestor semantics). The first candidate in the order above that matches
  any member root decides the pane's root.
- **Fold-mode source (FINDING-003):** the matcher takes the fold mode as an EXPLICIT injected
  argument (`opts.caseFold`) and MUST NOT read `process` (undefined in the contextIsolated renderer
  main world, though defined under vitest — the trap). The renderer caller MUST derive it once via
  `caseFoldFromPlatform(navigator.platform)` — `navigator` is a standard DOM global present in both
  the real renderer main world and jsdom; the derivation is a pure string function tests drive with
  injected strings.

Recency MUST come from a store-maintained focus sequence (updated on every `setFocusedPane`) whose
entries MUST be pruned when their pane leaves the store — pane close or workspace removal
(CONV-011, FINDING-005) — so the map never outlives the open-pane set and a reused pane id inherits
no stale rank. Panes never focused this session rank last; tied panes break deterministically
(workspace order, then pane-id codepoint).
**Acceptance:** with panes P1 and P2 both under root R, focusing P2 then P1 then clicking R's item
focuses P1 and activates its workspace; a pane whose live cwd is a SUBDIRECTORY of R matches; a pane
whose live cwd is under nested root R2 ⊂ R1 (both members) matches R2 even when
`gitStatus[pane].root === R1` is present (cwd candidate + longest-root rule; git root not
consulted); a pane whose live cwd is inside member root R but whose `gitStatus.root` is a strict
ANCESTOR of R (outside the member set) still matches R; a pane at `C:\dev\TermhallaX` does NOT
match root `C:\dev\Termhalla` and root `C:\dev\Term` does NOT match a pane at `C:\dev\Termhalla`
(boundary-safe both directions); matcher-vs-`normalizeProjectRoot` equivalence is pinned by
HOST-INDEPENDENT vectors built with explicit `path.win32`/`path.posix`, covering BOTH fold modes:
trailing separators (`C:\dev\Termhalla\` vs root `C:\dev\Termhalla`), a UNC root
(`\\server\share\proj` and a pane beneath it), a drive-letter root (`C:\`), mixed `/`-vs-`\`
spellings, and case-divergent spellings that match with `caseFold: true` and do NOT match with
`caseFold: false`; `caseFoldFromPlatform` returns true for `'Win32'` and false for `'MacIntel'`/
`'Linux x86_64'`/`''`; a code assertion confirms no `process` reference in `src/shared/
decision-queue.ts` or the renderer fold-mode call path; closing a focused pane removes its key from
`paneFocusSeq` (assert the key is gone); an e2e run in the packaged renderer (where `process` is
undefined in the main world) clicks an item and observes the pane focused — guarding the
test-green/runtime-broken trap; with no matching pane the click performs no focus change (the
fallback affordance path, REQ-010, applies instead).

### REQ-010 — Pane-less fallback: "open terminal here" (D4) — `ux`
A queue item whose project has NO matching open pane in this window (per REQ-009's cwd-first
matcher) MUST expose an "open terminal here" affordance (`decision-queue-open-terminal`, carrying
the project's `data-project-root`). Activating it MUST create a terminal pane whose cwd is the
project ROOT (not `.orky/`, not a feature dir) via the existing pane-spawn path
(`launchDir`-equivalent `commitPane`), creating a workspace first when the window has none — never
a throw, never a silent no-op. The affordance is read-only with respect to Orky: it MUST NOT write
under `.orky/`, invoke any CLI, or deep-link/open any `.orky` file (no F6 deep-linking, per D4).
**Acceptance:** a `source:'persisted'` project with no open pane shows the affordance where a
matched project's item shows none (matched = a pane whose live cwd is under the root, REQ-009);
activating it commits a `kind:'terminal'` pane with `cwd === projectRoot` in the active workspace;
with zero workspaces it still produces the pane (a workspace is created); the fixture's `.orky/`
tree is byte-identical afterwards and no editor/file open is triggered.

### REQ-011 — Explicit loading state + missed-push recovery (D5) — `ux`
Until the FIRST snapshot is received (no `registry:status` push yet AND the `registryCurrent()`
recovery pull unresolved), the open drawer MUST show an explicit loading state
(`decision-queue-loading`) — visually and programmatically distinct from empty and error — and the
badge MUST show no number. Receipt of the first valid snapshot (from either source) MUST replace
loading with the list or the empty state. Snapshot arbitration follows REQ-003's generation guard:
first valid snapshot wins; a late-settling pull never replaces applied data and never resurrects
loading.
**Acceptance:** with both the push withheld and `registryCurrent()` pending, the drawer shows
`decision-queue-loading` (and neither `-empty` nor `-error`); resolving `registryCurrent` with `[]`
transitions to `decision-queue-empty`; delivering a push first transitions equivalently; a pull that
settles AFTER a push was applied changes neither the rendered data nor the state (no loading, no
regression — REQ-003's acceptance vector observed at the DOM level); the loading state never
reappears after a valid snapshot exists.

### REQ-012 — Empty state: "nothing needs you", distinct from error (D5) — `ux`
When a valid snapshot is held and the queue has ZERO items — whether the aggregate is empty OR every
member's features are all `needsHuman:false` — the drawer MUST show an explicit "nothing needs you"
empty state (`decision-queue-empty`), distinct in testid and copy from both loading and error. It is
a healthy state and MUST NOT be styled or worded as a failure.
**Acceptance:** pushing `[]` shows `decision-queue-empty`; pushing a snapshot whose only features
are busy/idle/clean-done also shows it; the empty, loading, and error testids are mutually exclusive
in every reachable state (a state-matrix test drives all three).

### REQ-013 — Error state: registry unavailable / malformed push, total tolerance (D5) — `ux` `quality`
The panel MUST surface an explicit error state (`decision-queue-error`) with a SPECIFIC, actionable
message (what failed — the pull or a malformed payload — and that Orky project tracking is
unavailable; CONV-001, never a bare "error") when (a) no valid snapshot is held and the
`registryCurrent()` recovery pull rejects, or (b) a received payload is not an array. A malformed
push MUST NOT throw, MUST NOT crash the renderer, and MUST NOT replace the last valid snapshot (the
queue keeps rendering stale-but-valid data; the error is only shown when there is no valid snapshot
to render). A subsequent valid snapshot MUST clear the error. Per-entry tolerance (CONV-002): an
entry or feature missing/mistyping the consumed fields contributes no items and throws nowhere,
while well-formed siblings still render.
**Acceptance:** `registryCurrent` rejection with no prior snapshot → `decision-queue-error` whose
text names the failure (no bare `"error"` string); a non-array push after a valid snapshot → list
unchanged, no error shown, no throw; a non-array push with NO prior snapshot → error state; a
following valid push clears it; a snapshot containing one garbage entry (`{}`/non-object/non-string
`root`) renders the other entries' items and skips the garbage without throwing.

### REQ-014 — Drawer + toggle accessibility; coexistence with the notes drawer — `ux`
The status-bar toggle MUST be a real `button` with an accessible name and `aria-expanded` reflecting
the drawer state; the drawer MUST carry a landmark role + label (e.g. `role="complementary"`,
`aria-label` naming the Orky decision queue) and a keyboard-operable close button; queue items and
the fallback affordance MUST be reachable by Tab and activatable by Enter/Space with VISIBLE
`:focus-visible` styling — window chrome outside the `.mosaic` subtree must carry paint-only focus
and hover styling or be added to the existing allow-lists (CONV-007's standing rule). The queue and
notes drawers MUST coexist: with both open, both render side by side in the chrome row; toggling
either MUST NOT change the other's open state.
**Acceptance:** the toggle exposes `aria-expanded` true/false in sync with the drawer; keyboard-only
navigation reaches and activates an item (focus moves to the target pane) and the fallback
affordance; focused rows show a non-`outline: none` visible indicator (style/allow-list assertion);
with `notesOpen` and `queueOpen` both true, `notes-panel` and `decision-queue-panel` are both
visible, and toggling the queue leaves `notesOpen` unchanged (and vice versa).

### REQ-015 — Entry content: verbatim aggregate data + stable (projectRoot, featureSlug) identity — `quality` `ux`
Each rendered item MUST expose its stable identity as `data-project-root` (the entry's `root`,
verbatim) and `data-feature` (the feature slug, verbatim) — the identity F8 will attach actions to —
and MUST display, from the carried `OrkyFeatureStatus` only: the feature slug, its `reason`
(escalation / stalled / awaiting human-review), the live `phase` and `gateN/gateM` fraction, and the
upstream `detail` string verbatim (already CONV-001-actionable). The panel MUST NOT re-derive or
invent status wording: no completeness word ("done"/"complete") may be rendered for an item unless
carried by the aggregate's own fields (CONV-009 — moot for needs-human items, which are never
`done`, but binding on any label fallback), and a `null` phase MUST NOT render the literal string
"null". Room for F8's future action buttons MUST NOT require new data (identity suffices).
**Acceptance:** each row carries `data-project-root` + `data-feature` matching the fixture; the
row's detail text byte-equals the fixture feature's `detail`; a fixture item's rendered
reason/phase/gate text maps 1:1 from `reason`/`phase`/`gateN`/`gateM` (no recomputation — code
assertion: the row renders fields, not derived gate math); no row text contains "null" for a null
phase or an un-carried completeness word.

### REQ-016 — Theme-aware, minimal presentation (D5) — `ux`
The drawer, its states, and the badge MUST style via the existing theme CSS variables (the
`var(--panel)`/`var(--fg)`/`var(--border)`/`var(--fg-dim)` family `NotesPanel` and `StatusBar` use,
with their standard fallbacks) so workspace/app themes apply; no hard-coded colors that bypass the
variable system for surfaces the theme already parameterizes.
**Acceptance:** the drawer's computed background/border/foreground derive from the theme variables
(changing `--panel` on the ancestor changes the drawer's rendered background); the loading/empty/
error states use `--fg-dim`-family styling, not fixed hex values, for text the theme parameterizes.

### REQ-017 — Scope guard: strictly read-only, chrome-only, nothing persisted — `quality`
This feature MUST NOT: write/create/delete any file under any `.orky/` tree; invoke any Orky CLI or
`orkyAction:*` method; call `registry:addRoot`/`removeRoot` (no "track project" gesture here — see
Open questions); add a pane kind or bump `SCHEMA_VERSION`; persist the drawer state or any queue
data (session-scoped only); or open/deep-link `.orky` files. Shared multi-owner files it touches
(`keybindings.ts`, `orky-status.ts`, store composition, `App.tsx`) MUST NOT gain a whole-file
content-freeze test (CONV-012) — pin the feature's OWN additions structurally.
**Acceptance:** an integration check confirms a fixtured `.orky/` tree is byte-identical after a
full interaction session (toggle, click-to-focus, fallback spawn); grep confirms no
`child_process`/CLI/`orkyAction`/`registryAddRoot` usage in the feature's code; `SCHEMA_VERSION`
unchanged; restarting the renderer starts with the drawer closed; no content-freeze test is added on
a shared file.

### REQ-018 — Documentation reconciled — `quality`
A feature doc MUST be added under `docs/features/` (e.g. `decision-queue.md`) and linked from the
CLAUDE.md "Where things live" table; `CHANGELOG.md [Unreleased]` MUST record the decision-queue
drawer; the new `toggle-orky-queue` command MUST appear wherever keybindings are documented; and
`.orky/baseline/architecture.md` MUST be reconciled to note that `registry:status` now HAS a
renderer consumer (F5's "no renderer UI consumes this" claim in `ipc-contract.ts`'s comment and any
doc echo of it must be updated — grep the whole `docs/` tree plus `CLAUDE.md` and `.orky/baseline/`
for stale phrasings, CONV-008).
**Acceptance:** the feature doc exists and is referenced; `CHANGELOG.md [Unreleased]` mentions the
queue drawer; no remaining doc/comment claims the registry aggregate has no renderer consumer; the
doc-sync gate passes.

### REQ-019 — Supersede F5's TEST-070 renderer scope guard, at the tests phase, never silently — `quality`
F5's frozen scope guard `tests/shared/registry-no-renderer-ui.test.ts` (TEST-070, F5 REQ-021) greps
`src/renderer/` for the exact read-surface symbols this feature MUST introduce (Verified contract),
and its own header names F6 as the designed first consumer. That guard is hereby **superseded**: it
was scoped to F5's development window, and F6 is its designated retiring feature. The retirement
MUST happen at F6's TESTS phase, performed by the test-designer in the SAME change that introduces
F6's own suite — never silently deleted, skipped, or edited by the implementer during
implementation. The retirement MUST (a) record a supersession note in `04-tests.md` naming TEST-070,
F5 REQ-021, and this REQ, and (b) replace the guard with a NARROWED scope guard carrying the same
supersession note in its header, preserving the still-true prohibitions — no file under
`src/renderer/` may reference the registry MUTATION surface (`RegistryMutationResult`,
`registryRoots(`, `registryAddRoot(`, `registryRemoveRoot(`), which REQ-017 still forbids — while
permitting the read surface F6 consumes (`OrkyRegistrySnapshot`, `OrkyRegistryEntry`,
`onRegistryStatus`, `registryCurrent(`). The replacement guard's header MUST itself name its own
designated retiring feature — the feature that first ships a sanctioned renderer-side mutation
consumer (the "track this project" gesture, currently unowned; plausibly F13 or a successor) — so
an absence-of-consumer guard is never again frozen without a scheduled retirement path (the
convention this feature's own Baseline-fit proposal records).
**Acceptance:** after F6's tests phase lands, `tests/shared/registry-no-renderer-ui.test.ts` (or its
replacement) no longer asserts absence of the read-surface symbols and PASSES with F6's renderer
code present; the replacement guard still FAILS on an injected renderer reference to any mutation-
surface symbol; both the replacement's header and `04-tests.md` name TEST-070 as superseded by F6
(this REQ); the retirement lands in the same change as F6's suite (no implementation-phase edit of
a frozen test); the full frozen-suite run is green at F6's implementation gate without touching any
other frozen file.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`, no `process` reads in the module under test):**
  `buildDecisionQueue` membership/grouping/ordering incl. malformed tolerance (REQ-004/005/006/013),
  `decisionQueueCount` single-source (REQ-007), `matchPaneRoot` boundary/longest-root/candidate-order
  vectors with INJECTED fold mode, built host-independently via explicit `path.win32`/`path.posix` —
  trailing separators, UNC root, drive root, sibling-prefix dirs, mixed separators, both fold
  modes — plus `normalizeProjectRoot` equivalence and `caseFoldFromPlatform` (REQ-009),
  comparator-export identity (REQ-005), keybinding conflict/rebind (REQ-002).
- **Component/store tests (jsdom):** deep-equal short-circuit + render-count probes (REQ-008),
  push-vs-recovery-pull generation arbitration incl. a late-settling stale pull (REQ-003/011),
  state matrix loading/empty/error (REQ-011/012/013), badge=list (REQ-007), click-to-focus MRU +
  cwd-first candidate order + `paneFocusSeq` pruning on pane close + fallback spawn against a
  stubbed store (REQ-009/010), a11y attributes + drawer coexistence (REQ-014), verbatim field
  rendering (REQ-015).
- **e2e (Playwright-for-Electron, against `out/`):** toggle via status bar/palette/chord (REQ-002),
  drawer renders outside the mosaic (REQ-001), live badge with drawer closed (REQ-007), recovery
  pull on a pre-push snapshot (REQ-003/011), click-to-focus of a real pane in the packaged renderer
  — the fold-mode source must work where `process` is undefined (REQ-009), `.orky/` byte-identical
  invariant (REQ-017).
- **Frozen-suite supersession (tests phase deliverable):** TEST-070's retirement + narrowed
  replacement guard + supersession notes land with F6's suite (REQ-019) — verified structurally
  (replacement header, `04-tests.md` note, mutation-surface guard still failing on injection).

## Forward compatibility (F8)

F8 will attach one-click answer/resume actions (via F7's shipped `orkyAction:*` dispatch) directly
onto these queue entries. The ONLY contract F6 owes it is the stable per-row identity
`(projectRoot, featureSlug)` — exposed as `data-project-root` + `data-feature` and as
`DecisionQueueItem.projectRoot`/`featureSlug` (REQ-015) — which is exactly the
`(projectRoot, feature)` pair F7's request shapes take. Entry layout must therefore tolerate a
trailing action affordance per row without reflowing identity or ordering; F6 itself renders no
action buttons and depends on nothing from F7.

## Open questions

None blocking. Two upstream notes recorded for the coordinator (flagged, not fixed here):

1. **Pane bindings are not on the wire.** Concept D4 says "the F5 membership already knows pane
   bindings" — true in the main process (`OrkyRegistry.paneRoots`, fed by `register-orky.ts`'s
   `onPaneRoot`), but the shipped `OrkyRegistryEntry` is `{root, source, status}` with no pane ids,
   and `OrkyPaneStatus` carries no root. F6 resolves this renderer-side (REQ-009's cwd-first shared
   matcher) within D2's no-new-IPC constraint; if a future feature needs the EXACT main-side
   bindings (e.g. cross-window focus, or eliminating the renderer-side re-derivation entirely),
   that is an F5 extension — e.g. adding the resolved root to the `orky:status` payload or pane ids
   to `OrkyRegistryEntry` — a separate feature.
2. **The "track this project" gesture is still unowned.** F5's spec deferred the human
   `registry:addRoot` gesture "to F6 per D1/D2", but F6's gate-fixed concept scope (D2's allowed
   additions) does not include it and REQ-017 explicitly excludes it. It remains unassigned (F13
   Settings is the plausible owner); flagged so the app-level roadmap doesn't silently drop it.
