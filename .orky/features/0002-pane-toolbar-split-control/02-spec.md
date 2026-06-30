# 0002 — Pane toolbar cleanup: Record → context menu, unified split-direction control — Specification

**Status:** spec written (phase 2). Encodes the decisions agreed with the human in `01-concept.md`
(authoritative). The seven brainstorm questions are all resolved there (Q5–Q7 were deferred to this
spec and are resolved below: Record label/placement → REQ-002; testid contract → REQ-013; default
highlighted direction → REQ-010). No settled decision is re-opened.

**Concerns:** `ux` (primary), `accessibility`, `qol`, `doc-drift`
(always-on lenses `security`, `quality`, `devils-advocate` apply too).

This is a brownfield feature built against `.orky/baseline/`. It does **not** supersede any existing
baseline `REQ-`. It extends `src/shared/workspace-model.ts` (the split helpers underpinning baseline
REQ-024's persisted layout) in a way that keeps the **on-disk `MosaicNode` shape unchanged** (REQ-008),
so no characterization test is intentionally changed by this feature. The pure layout change is
new behavior (insert-before), not a redefinition of existing behavior. No `.orky/compliance/` framework
is present, so no `CTRL-` controls are assigned.

---

## Public interface

### Pure layout logic (`src/shared/workspace-model.ts`)
- `splitPane(ws, targetPaneId, direction, config, id, position?)` gains a trailing
  `position: 'before' | 'after'` parameter. It **defaults to `'after'`** so every existing call site
  keeps today's behavior unchanged. `'after'` inserts the new pane as the parent's `second` child
  (target stays `first`); `'before'` inserts the new pane as `first` (target becomes `second`).
- A pure mapping helper (e.g. `splitDirToLayout(dir: SplitDir4): { direction: MosaicDirection; position: 'before' | 'after' }`)
  maps the four UI directions to orientation × position:
  `right → { row, after }`, `down → { column, after }`, `left → { row, before }`, `up → { column, before }`.
- A UI direction type, e.g. `export type SplitDir4 = 'up' | 'down' | 'left' | 'right'`.

### Store / pane-open plumbing (renderer)
- `placePane` (`store/internals.ts`), `commitPane` (`store.ts` closure + `SliceDeps.commitPane` in
  `store/types.ts`), and the `addTerminal` / `addEditor` / `addExplorer` store actions carry the new
  `position` (or equivalently a `SplitDir4`) through to `splitPane`. Default/omitted ⇒ `'after'`
  so all non-split call sites (move-to-workspace, launch, ssh, relaunch, `dispatchAddPane`) are
  unaffected.

### Components
- `PaneToolbar` (`src/renderer/components/PaneToolbar.tsx`): Record button removed; the two split
  buttons replaced by one.
- A combined compass + kind popover component (the evolution of / replacement for `SplitMenu.tsx`),
  portalled to `<body>`.
- `PaneContextMenu` (`src/renderer/components/PaneContextMenu.tsx`): a Record start/stop item added.

No IPC contract, persisted-schema, or `SCHEMA_VERSION` change is introduced by this feature.

---

## REQ-001 — Record button removed from the pane toolbar
**MUST.** The Record toggle (`data-testid="rec-${paneId}"`, ⏺) MUST be removed from `PaneToolbar`.
No element with a `rec-${paneId}` testid may render in the pane toolbar for any pane kind.

**Acceptance:**
- e2e: after launching the app and adding a terminal, `win.getByTestId('rec-${paneId}')` has count `0`.

## REQ-002 — Record start/stop moved into the pane context menu
**MUST.** `PaneContextMenu` MUST render a single Record item (`data-testid="pane-menu-record"`) for
**terminal** panes that reflects and controls the same `recording` state as today: its label is
**"Stop recording"** when the pane is recording and **"Start recording"** otherwise, and clicking it
calls `api.recStop(paneId)` when recording, else `api.recStart(paneId)`, then closes the menu. It
MUST sit in the root view of the menu, grouped with the per-pane action items and separated from the
workspace-move/close group consistently with the menu's existing grouping (placement is paint/order
only — it MUST NOT alter the existing items' testids or behavior). The item MUST NOT render for
editor/explorer panes (which cannot record), matching the toolbar's prior `isTerminal` gating.

**Acceptance:**
- e2e: right-clicking a terminal pane title bar shows `pane-menu-record` labelled "Start recording";
  clicking it then re-opening the menu shows it labelled "Stop recording" (state round-trips through
  `recording`).
- Unit (component or store): when `recording[paneId]` is falsy, activating the item invokes
  `recStart(paneId)`; when truthy, it invokes `recStop(paneId)` (assert the branch on injected api).
- e2e: for an editor pane, `pane-menu-record` has count `0`.

## REQ-003 — Two split buttons collapsed into one toolbar button
**MUST.** `PaneToolbar` MUST render exactly **one** split button (`data-testid="split-${paneId}"`).
The old split-down button (`data-testid="split-col-${paneId}"`, ⬍) MUST be removed; no element with
that testid may render. Clicking the single split button opens the combined popover (REQ-004) and
nothing else; it MUST NOT immediately perform a split.

**Acceptance:**
- e2e: a terminal pane toolbar shows exactly one `split-${paneId}` button and `split-col-${paneId}`
  has count `0`.
- e2e: clicking `split-${paneId}` does **not** change the tile count (no split committed on open);
  it opens the popover (REQ-004).

## REQ-004 — One combined popover: compass direction control + kind selector, portalled to `<body>`
**MUST.** Clicking the split button MUST open a single popover (`data-testid="split-menu"`) containing
both (a) a compass/D-pad directional control (REQ-005) and (b) a Terminal/Editor/Explorer kind
selector (REQ-006). The popover MUST be rendered via `createPortal(..., document.body)` — like
`PaneContextMenu`/`Modal` — because a `position: fixed`/`absolute` child of a react-mosaic tile is
clipped and mis-stacked relative to the tile's transform. A single combined surface commits a split
when a kind is selected and a direction is then activated (REQ-007); there is no second chained menu.

**Acceptance:**
- e2e: after clicking `split-${paneId}`, `split-menu` is visible and is a child of `document.body`
  (not nested inside the source `.mosaic-tile` element) — asserting the portal, the same guarantee
  `pane-actions.spec.ts` already enforces for `pane-menu`.
- e2e: `split-menu` contains both the four direction targets (REQ-005) and the three kind options
  (REQ-006) simultaneously (no intermediate step).

## REQ-005 — Compass always offers all four directions
**MUST.** The compass MUST always render four direction targets — up, left, right, down — with stable
testids `split-dir-up-${paneId}`, `split-dir-left-${paneId}`, `split-dir-right-${paneId}`,
`split-dir-down-${paneId}`. All four MUST always be enabled and activatable regardless of the pane's
position in the layout or whether the workspace currently has one pane (no context-aware disabling).
The control MUST be a spatial arrangement (arrows around a center), not a plain vertical list.

**Acceptance:**
- e2e: with the popover open, all four `split-dir-{up,left,right,down}-${paneId}` targets are visible
  and not disabled, both when the workspace has a single pane and after a prior split (≥2 panes).

## REQ-006 — Kind selector with Terminal default; Explorer gated on cwd
**MUST.** The popover MUST offer three kind options with testids `split-kind-terminal-${paneId}`,
`split-kind-editor-${paneId}`, `split-kind-explorer-${paneId}`. **Terminal** MUST be the initially
selected kind. The selected kind MUST be exposed for assertion (e.g. `aria-checked="true"` /
`aria-pressed="true"` / a `data-selected` attribute on the chosen option). The Explorer option MUST
be **disabled when the source pane has no cwd** (`paneCwd(s, paneId)` empty), exactly as today's
`SplitMenu`; Terminal and Editor are always enabled.

**Acceptance:**
- e2e: on open, `split-kind-terminal-${paneId}` is the selected kind (assert the chosen indicator);
  the other two are unselected.
- e2e: with a pane whose `data-cwd` is empty, `split-kind-explorer-${paneId}` is disabled; once the
  shell has reported a cwd (`tile-${paneId}` `data-cwd` non-empty), it becomes enabled.

## REQ-007 — Selecting a kind then activating a direction commits the split with the correct geometry
**MUST.** Activating a direction target (click or keyboard, REQ-010) MUST commit a split that opens a
pane of the **currently selected kind** at the position implied by that direction (per the
REQ-005/REQ-008 mapping), then close the popover. The new pane inherits cwd exactly as today
(terminals via `addTerminal`, explorers via the source cwd as root, editors have no cwd). A `left`/`up`
split MUST place the new pane **before** the source (new pane is the parent's `first` child); a
`right`/`down` split places it **after** (`second`), with `right`/`left` ⇒ `row` and `up`/`down` ⇒
`column`.

**Acceptance:**
- e2e: with kind = Editor selected, activating `split-dir-right-${paneId}` raises the tile count to 2
  and yields one editor tile and still exactly one terminal (no extra shell) — preserving today's
  split-menu.spec behavior under the new control.
- e2e: with kind = Terminal, activating `split-dir-left-${paneId}` yields 2 tiles where the **new**
  terminal pane is ordered before the original (assert via the resulting layout / DOM tile order, the
  observable difference between before- and after-insertion).
- Unit (store-level, with a stubbed api): `addTerminal`/`addEditor`/`addExplorer` invoked for a
  `left`/`up` direction call `splitPane` with `position: 'before'`; for `right`/`down`, with
  `position: 'after'`.

## REQ-008 — `splitPane` supports before/after insertion without changing the persisted layout shape
**MUST.** `splitPane` MUST accept a `position: 'before' | 'after'` (default `'after'`). For `'after'`
the produced parent is `{ direction, first: targetPaneId, second: newPaneId }` (byte-for-byte today's
output); for `'before'` it is `{ direction, first: newPaneId, second: targetPaneId }`. The node shape
stays a `{ direction, first, second }` `MosaicParent` — only **which child** is new changes — so
existing persisted workspace layouts deserialize unchanged and `SCHEMA_VERSION` is not bumped (baseline
REQ-024 compatibility). The pure direction→layout mapping MUST be a separate, unit-tested function.

**Acceptance:**
- Unit (`tests/shared/workspace-model.test.ts`): `splitPane(ws, 'p1', 'row', cfg, () => 'p2')` with no
  `position` arg still equals `{ direction: 'row', first: 'p1', second: 'p2' }` (default-after
  regression pin); with `position: 'before'` it equals `{ direction: 'row', first: 'p2', second: 'p1' }`.
- Unit: `position: 'before'` on a deep (non-root) leaf inserts the new pane as that subtree's `first`
  and leaves the rest of the tree untouched; the round-trip `serialize → deserialize` still holds and
  `SCHEMA_VERSION` is unchanged.
- Unit: the mapping helper returns `{row,after}`/`{column,after}`/`{row,before}`/`{column,before}` for
  `right`/`down`/`left`/`up` respectively (CONV-002: all four inputs covered).

## REQ-009 — Direction threaded through the pane-open plumbing without disturbing non-split call sites
**MUST.** `placePane`, `commitPane` (and `SliceDeps.commitPane`), and the `addTerminal`/`addEditor`/
`addExplorer` actions MUST carry the new direction/position through to `splitPane`. The parameter MUST
be optional or defaulted to `'after'`/`'row'` so the existing non-direction-selecting call sites
(move-to-workspace, `launchDir`, ssh launch, relaunch-from-search, `dispatchAddPane`, drag/first-pane
paths) keep their current behavior and continue to type-check.

**Acceptance:**
- `npm run typecheck` and `npm test` pass with the extended signatures; the existing `pane-ops.test.ts`
  assertions (which expect `['terminal', 'w', 'p1', 'row']`, etc.) remain green (the added param is
  optional/defaulted, not a breaking positional insertion before existing args).
- Unit: a split committed with direction `up`/`left` reaches `splitPane` with `position: 'before'`;
  a direction `right`/`down` (and every legacy call site) reaches it with `position: 'after'`.

## REQ-010 — Compass is fully keyboard-operable; default highlight is `right`
**MUST.** The popover MUST be operable without a mouse: when it opens, focus moves into the compass
and the **right ▶** direction is the initial highlighted target (today's primary direction). Arrow
keys move the highlight between the four directions, **Enter** (or Space) commits the highlighted
direction with the currently selected kind (REQ-007), and **Esc** dismisses the popover without
splitting. The kind selector MUST also be reachable/changeable by keyboard.

**Acceptance:**
- e2e: open the popover via keyboard (focus the `split-${paneId}` button, press Enter/Space), confirm
  the right target is highlighted (assert the highlight indicator), press Enter, and the tile count
  rises to 2 with an after/right split — committed entirely by keyboard.
- e2e: arrow-key navigation moves the highlight to another direction (e.g. ArrowDown → down target
  highlighted) before Enter commits that direction.
- e2e: pressing Esc with the popover open closes it and leaves the tile count unchanged.

## REQ-011 — ARIA roles/labels announce directions and kinds
**MUST.** The compass and kind selector MUST expose accessible semantics: each direction target has an
accessible name announcing its direction (e.g. `aria-label="Split up"/"Split left"/"Split right"/
"Split down"`), the compass is grouped with an accessible name (e.g. `role="group"`/`radiogroup` with
`aria-label="Split direction"`), and each kind option exposes its name and selected state
(`role="radio"`/`aria-checked`, or button + `aria-pressed`). No direction or kind control may be an
unlabeled icon-only element.

**Acceptance:**
- e2e/a11y: each `split-dir-*-${paneId}` target has a non-empty accessible name naming its direction
  (queryable via `getByRole`/accessible-name); the compass container exposes a group role with a name;
  each `split-kind-*-${paneId}` exposes its name and a checked/pressed state reflecting REQ-006's
  selection.

## REQ-012 — New toolbar/menu chrome is paint-only and scoped to chrome testids
**MUST.** The new split button, compass popover, and Record menu item MUST be styled paint-only
(background/color/border-radius), scoped to chrome `data-testid`s, and MUST NOT introduce CSS that
changes the box (border/padding/font/height) of `[data-testid="editor-tabs"]` children or any
Monaco/xterm host — the documented sibling-box gotcha. The toolbar's height/layout box MUST be
unperturbed by collapsing two buttons into one.

**Acceptance:**
- e2e (`editor.spec.ts` and `editor`/terminal flows remain green): switching Monaco models and
  rendering terminals still works after the toolbar change — no `.view-lines`/FitAddon regression.
- Review/structural: the new chrome CSS selectors are scoped to the new chrome testids and touch only
  paint properties (verified by diff review; no global element/`body`/`editor-tabs` box rules added).

## REQ-013 — Concrete testid contract (resolves deferred Q6)
**MUST.** The feature MUST use exactly these stable testids so the test phase and e2e can assert on a
fixed contract:
- Toolbar split button: `split-${paneId}` (kept; now the single combined entry point).
- Removed: `split-col-${paneId}` (REQ-003) and `rec-${paneId}` (REQ-001) — neither may render.
- Popover container: `split-menu` (kept), portalled to `<body>`.
- Direction targets: `split-dir-up-${paneId}`, `split-dir-left-${paneId}`, `split-dir-right-${paneId}`,
  `split-dir-down-${paneId}`.
- Kind options: `split-kind-terminal-${paneId}`, `split-kind-editor-${paneId}`,
  `split-kind-explorer-${paneId}`.
- Record menu item: `pane-menu-record` (REQ-002).

**Acceptance:**
- e2e: all the "present" testids above resolve to exactly one element when their surface is open, and
  the two "removed" testids resolve to zero, in the relevant states (covered cumulatively by
  REQ-001/003/004/005/006/002 acceptance tests).

## REQ-014 — Affected e2e specs updated to the new contract; portal guarantee retained
**MUST.** The e2e specs that assert on the old contract MUST be updated to the new one: the
`split-menu.spec.ts` flows MUST drive the split via the combined popover (select kind → activate a
direction) rather than the old kind-click-commits flow, and the `pane-actions.spec.ts` maximize test
(which splits a sibling via `split-${a}` then `split-terminal-${a}`) MUST be updated to activate a
direction after selecting the Terminal kind. The portal assertion intent of `pane-actions.spec.ts`
MUST continue to hold for the compass popover (REQ-004).

**Acceptance:**
- `npm run build` then `npm run e2e` pass with the updated `split-menu.spec.ts` and
  `pane-actions.spec.ts` (no test still references `split-col-`, `rec-`, or the
  kind-click-immediately-commits flow).

## REQ-015 — Documentation updated (doc-drift)
**SHOULD.** Because a core toolbar surface is restructured and the split-direction capability is new,
docs MUST be reconciled: `CHANGELOG.md` notes the Record-moves-to-context-menu change, the single
split button with a four-direction compass, and the new insert-before split capability;
`docs/features/workspaces.md` (and the CLAUDE.md "where things live" / load-bearing references to the
old `rec-`/`split-`/`split-col-` buttons) reflect the new control and testids.

**Acceptance:** `CHANGELOG.md` contains an entry naming (a) Record moved to the pane context menu, (b)
the unified split button + compass with up/left/right/down, and (c) before/after insertion in
`splitPane`; a reviewer can trace the renamed/removed testids to a doc mention. (Doc-only; verified by
review/doc-sync, not a unit test.)

---

## Cross-cutting convention checks
- **CONV-001 (specific/actionable errors):** This feature surfaces no new user-facing error strings
  (split, record toggle, and kind/direction selection are non-failing paths). If any new guard rejects
  input, its message MUST name the offending value — no bare `"invalid"`.
- **CONV-002 (empty/boundary/malformed):** Covered by REQ-008 (default-after regression + before on a
  deep leaf + all four mapping inputs), REQ-006 (no-cwd Explorer boundary), and REQ-009 (legacy call
  sites with the param omitted).
- **CONV-003 (no silent behavior change):** The one behavior change to a shared helper — `splitPane`
  gaining `position` — is explicit, defaulted to preserve current output, and pinned by a
  default-after regression test (REQ-008); the persisted-shape invariance (no `SCHEMA_VERSION` bump)
  is asserted.
- **CONV-004 / CONV-005:** N/A — this feature adds no feedback-suppression preference and no native
  menu accelerator.
- **security / quality (always-on):** Recording moves location only; it reads/writes no new data and
  persists no secrets (the toggle still calls the existing `recStart`/`recStop`). No IPC surface or
  persisted schema is added.

## Open questions
_None._ The three deferred brainstorm details are resolved here: Record label/placement (REQ-002),
the exact testid contract (REQ-013), and the default highlighted direction = right (REQ-010). All
brainstorm decisions (combined popover, compass shape, full keyboard/a11y, always-four-directions) are
encoded as testable requirements.
