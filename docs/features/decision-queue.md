# Orky Decision Queue

> A right-side, window-chrome drawer listing every feature across every tracked Orky project that
> **needs a human right now** — open escalation, stalled active run, or autonomous-gates-green
> awaiting human review — with click-to-focus onto the matching pane and an "open terminal here"
> fallback. The first renderer consumer of feature 0005's cross-project `registry:status` aggregate.

**Status:** Shipped · **Feature:** 0006-decision-queue-panel

## What it does

- **Window-scoped drawer, not a pane.** `DecisionQueuePanel` renders as a sibling of the notes
  drawer in `App.tsx`'s main flex row, outside every `.mosaic`/workspace-host subtree. It adds no
  `PaneKind`, no `PaneConfig` variant, and no `SCHEMA_VERSION` bump; the drawer state (`queueOpen`)
  is session-scoped and never persisted — every launch starts with the drawer closed.
- **Three toggle surfaces.** (a) The status-bar affordance `orky-queue-toggle` (a real button with
  `aria-expanded`, next to the search/notes toggles), (b) a Ctrl+K command-palette entry, and (c) a
  new **rebindable** command `toggle-orky-queue` (default chord `Ctrl+Shift+O`, `mod+shift+o`) in
  the `COMMANDS` registry — rebind or `'none'`-unbind it under Settings ▸ Keybindings. The toggle's
  tooltip chord derives from `resolveBindings`, never a hard-coded literal (CONV-005).
- **Live badge = list count.** The status-bar toggle shows the total queue-entry count from the
  SAME memoized `queueCount` selector the drawer's list derives from — one selector, one number.
  The subscription is app-level, so the badge stays live while the drawer is closed; no numeric
  badge renders at count 0 or while loading/errored.
- **Membership is reused, never re-derived.** A queue item is a `(projectRoot, featureSlug)` pair
  whose carried `OrkyFeatureStatus` has `needsHuman: true` — exactly feature 0004's gate-based
  needs-a-human model (open escalation / stalled / awaiting human-review), read off the aggregate's
  own fields. Entries with `status: null` and features with `needsHuman: false` contribute nothing;
  `source` (`pane`/`persisted`/`both`) is never filtered — a persisted, pane-less project queues too.
- **Deterministic ordering.** Within a group, items keep the upstream `status.features` order
  verbatim (the needsHuman prefix); across groups, projects order by their top item's rank via the
  exported shared comparator `compareOrkyFeatures` (the same one `selectChipFeature` uses), ties by
  root codepoint — never `localeCompare`, no clock, no randomness.
- **Read-only, chrome-only.** The feature never writes under any `.orky/` tree, never invokes an
  Orky CLI or `orkyAction:*` method, never calls the registry mutation surface
  (`registry:addRoot`/`removeRoot`), and persists nothing.

## Data path (renderer-only)

The ONLY data path is F5's already-bridged read surface — no new IPC channel, no main-process or
preload change:

1. **Push:** `App.tsx`'s one-shot subscription block wires `onRegistryStatus` (`registry:status`)
   into the store's single ingestion chokepoint `setRegistrySnapshot`.
2. **Recovery pull:** immediately after subscribing, ONE `registryCurrent()` pull recovers a push
   that fired before React mounted the listener (the `cloudCurrent` pattern).
3. **Generation-guarded arbitration:** the store keeps a monotonic `snapshotGeneration` bumped on
   every applied snapshot; the pull records the generation at ISSUE time and its result is
   **discarded** if anything was applied after it was issued — first valid snapshot wins, then
   pushes are the sole source. No Electron invoke-vs-send ordering assumption is load-bearing.
4. **Memoized short-circuit:** F5 emits a new snapshot array object on every recompute, so the
   setter deep-equal-compares and keeps the existing state reference for value-identical pushes
   (zero re-renders); `buildDecisionQueue` runs at most once per distinct snapshot reference.

### Drawer states

| State | Testid | When |
|---|---|---|
| Loading | `decision-queue-loading` | No snapshot held AND no error (pull unresolved, push not yet received) |
| Error | `decision-queue-error` | No snapshot held AND the pull rejected / a payload was malformed (specific message, CONV-001) |
| Empty | `decision-queue-empty` | A valid snapshot is held and zero items — "nothing needs you", a healthy state |
| List | `decision-queue-group-<root>` / `decision-queue-item` | A valid snapshot with ≥1 needs-human feature |

A malformed push never throws and never replaces held data (stale-but-valid keeps rendering); a
following valid snapshot clears the error. Loading never reappears once any snapshot is held.

## Click-to-focus and the pane-less fallback

Clicking an item focuses the **most-recently-focused** open pane in this window whose project path
resolves under the item's root (`setActive` + `setFocusedPane`, the `revealPaneFromSearch`
pattern). Because the wire carries no pane ids, the pane↔root match is derived renderer-side by the
pure shared matcher in `src/shared/decision-queue.ts`, pinned on the SAME signal the aggregate
itself binds on:

- **Candidate AVAILABILITY is gated, not tried in a fallback chain:** `selectPaneCandidates`
  picks exactly ONE signal per pane — the live tracked cwd when known (even if it turns out not to
  match any member root), else the persisted terminal `config.cwd` only when no live cwd is known,
  else `gitStatus.root` only when neither cwd signal exists (deliberately NOT `resolveProjectKey`'s
  git-root-first order, which would mis-bind a nested `.orky/` root under its git root). A pane that
  `cd`'d out of every member root is decisively unmatched on its live cwd — it does NOT fall through
  to a stale persisted `config.cwd` or `gitStatus.root` (FINDING-020: match failure on an *available*
  signal is final, never a cue to consult the next one).
- **Match rule:** `matchPaneRootFromCandidates` runs the single selected candidate through
  `matchPaneRoot` — boundary-safe containment with slash-fold always and case-fold iff the injected
  `caseFold` — equivalent to `normalizeProjectRoot`'s comparison key (CONV-010); among containing
  member roots the LONGEST wins (nearest-ancestor semantics).
- **Fold mode is injected:** the module never reads `process` (undefined in the contextIsolated
  renderer main world); the one call site derives it via `caseFoldFromPlatform(navigator.platform)`.
- **Recency:** a store-maintained `paneFocusSeq` map stamped by `setFocusedPane` and pruned by the
  same `clearPaneRuntime` call that clears every other per-pane runtime map (CONV-011); ties break
  by workspace order then pane-id codepoint (`selectMruPane`).

A project with NO matching open pane shows `decision-queue-open-terminal`, which commits a
`kind:'terminal'` pane with `cwd === projectRoot` via the existing `launchDir` spawn path (creating
a workspace first when the window has none) — never an `.orky/` write, CLI call, or file deep-link.

## Focus management (keyboard open/close)

Opening the drawer by any surface (chord, palette, or the status-bar toggle) mounts the panel, and
its mount effect moves focus to the drawer's close button — a terminal pane consumes Tab, so without
this the just-opened drawer would be keyboard-unreachable. Closing is **conditional, not
unconditional**: focus is restored to the previously-focused element (or the `orky-queue-toggle` if
that element is gone) **only when focus actually collapsed out of the removed drawer** (i.e.
`document.activeElement` fell to `<body>`/`null`). If the user clicked a queue item while the drawer
stayed open — moving focus onto the newly-focused pane — closing the drawer does NOT yank focus back;
the pane keeps it, keeping the visual focus indicator and keystroke destination in agreement. This is
a non-modal-drawer rule (a modal's unconditional refocus-on-close does not apply here).

## Malformed-data tolerance

`buildDecisionQueue` validates the FULL consumed-field set before admitting a feature to the queue —
`reason` ∈ `{escalation, stalled, human-review, null}`, `phase` `string|null`, `gateN`/`gateM`/
`openBlocking`/`lastActivityAt` all `Number.isFinite`, `detail` `string|undefined` — in addition to
`needsHuman === true` and a non-empty `feature` slug. A feature that mistypes any of these fields
contributes NO item (never a React child crash from an object-typed field, never a `NaN` into the
cross-group rank comparator); well-formed sibling features and other entries still render. The group
sort is additionally NaN-hardened so a non-finite rank can never degrade the whole order to insertion
order.

## Key files

| File | Responsibility |
| --- | --- |
| `src/shared/decision-queue.ts` | Pure `buildDecisionQueue` / `decisionQueueCount` / `matchPaneRoot` / `matchPaneRootFromCandidates` / `caseFoldFromPlatform` / `selectMruPane` |
| `src/shared/orky-status.ts` | `compareOrkyFeatures` — the existing chip comparator, exported (single definition) |
| `src/renderer/store/registry-slice.ts` | Snapshot/error/`queueOpen` state, generation-guarded ingestion + recovery-pull arbitration, memoized `queueGroups`/`queueCount` |
| `src/renderer/components/DecisionQueuePanel.tsx` | The drawer: states, groups/items, click-to-focus, open-terminal fallback |
| `src/renderer/components/StatusBar.tsx` | `orky-queue-toggle` + live count badge |
| `src/renderer/App.tsx` | `onRegistryStatus` subscription, the single `registryCurrent()` recovery pull, drawer mount, `toggle-orky-queue` shortcut dispatch |
| `src/shared/keybindings.ts` / `src/shared/quick.ts` / `CommandPalette.tsx` | The rebindable command + palette entry |

## Forward compatibility

Each row exposes its stable identity as `data-project-root` + `data-feature` (and
`DecisionQueueItem.projectRoot`/`featureSlug`) — the `(projectRoot, feature)` pair F8's one-click
actions (via F7's `orkyAction:*` dispatch) will attach to. F6 itself renders no action buttons.

## Related

- [orky-status.md](./orky-status.md) — the per-pane status model and the cross-project registry.
- [orky-action-dispatch.md](./orky-action-dispatch.md) — the write-capable dispatch substrate (F7).
- [keybindings.md](./keybindings.md) — the command registry `toggle-orky-queue` joins.
