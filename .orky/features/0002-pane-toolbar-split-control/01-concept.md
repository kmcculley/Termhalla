# 0002 — Pane toolbar cleanup: Record → context menu, unified split-direction control

## Phase 1 — Concept (brainstorm outcome)

**Status:** concept agreed — human confirmed. No blocking open questions.

### Problem

The pane toolbar (`PaneToolbar.tsx`) is cluttered and the split affordance is limited:
- A **Record** (⏺) button lives in the always-visible toolbar though it's an occasional action.
- **Two** separate split buttons (split-right ⬌ / split-down ⬍) only offer right/down, and the
  existing in-tile `SplitMenu` lets the user pick the new pane's *kind* but never its *direction*.

### Decisions (settled in brainstorm)

1. **Remove Record from the toolbar; move it into the right-click context menu**
   (`PaneContextMenu.tsx`). The record toggle reflects/controls the existing `recording` state and
   calls `api.recStart`/`api.recStop` exactly as today — only its *location* changes.

2. **Collapse the two split buttons into a single split button** in the toolbar. Clicking it opens
   one popover.

3. **Single combined popover: direction + kind together.** The popover contains a directional
   control plus a compact Terminal / Editor / Explorer selector. The user picks a kind (default
   **Terminal**), then clicks/activates a direction to commit the split. One surface, one mental
   model — no two-step chaining. *(Chosen over reusing today's two-step SplitMenu and over
   direction-only.)*

4. **The directional control is a Compass / D-pad.** Four arrow targets (▲ ◀ ▶ ▼) arranged
   spatially around a center, mapped to where the new pane will land; hover/focus highlights the
   target. *(Chosen over layout-preview tiles and over a plain labeled list — the explicit goal is
   "modern and sleek, not basic UX.")*

5. **Fully keyboard- and screen-reader-accessible.** Arrow keys move the selection across the
   compass, **Enter** commits the highlighted direction, **Esc** dismisses; ARIA roles/labels so
   the directions and kind options are announced. This is part of the "polished" bar, not optional.

6. **Always offer all four directions.** Up/left/right/down are always selectable regardless of the
   pane's position or whether the workspace has one pane. No context-aware disabling.

### Key technical note (must flow into spec/plan)

The layout model **today supports only right/down**: `MosaicDirection = 'row' | 'column'` and
`splitPane()` (`src/shared/workspace-model.ts`) always inserts the new pane as the `second` child
(row→right, column→down). Supporting **up** and **left** requires inserting the new pane as the
`first` child (target becomes `second`). So the four UI directions map to **orientation × position**:

| UI direction | orientation | new pane position |
|---|---|---|
| right ▶ | `row` | after (`second`) — exists today |
| down ▼ | `column` | after (`second`) — exists today |
| left ◀ | `row` | **before (`first`)** — new |
| up ▲ | `column` | **before (`first`)** — new |

`splitPane`/`placePane`/`addTerminal`/`addEditor`/`addExplorer` (and the `SliceDeps.commitPane`
signature) must be extended to carry a before/after (or a 4-way direction) parameter. This is pure,
unit-testable logic in `src/shared/workspace-model.ts` — write the failing test first (TDD).

### Concerns (routing tags — committed)

- **ux** *(primary)* — restructures a core always-visible surface and introduces a new interaction
  pattern (combined direction+kind compass popover).
- **accessibility** — a spatial control must remain fully keyboard/AT-operable; routes an a11y lens.
- **qol** — fewer toolbar buttons, richer split options.
- **doc-drift** — `PaneToolbar`/`SplitMenu`/`PaneContextMenu`, the CLAUDE.md "where things live"
  table, `docs/features/workspaces.md`, and the e2e testid contracts all reference the current
  buttons and will drift.

(Always-on lenses `security`, `quality`, `devils-advocate` apply regardless.)

### Constraints the implementation must respect (load-bearing gotchas)

- **The compass popover must `createPortal` to `<body>`**, like `PaneContextMenu`/`Modal` — a
  `position:fixed` child of a react-mosaic tile is clipped/mis-stacked relative to the tile.
  Guarded by `tests/e2e/pane-actions.spec.ts`.
- **New toolbar/menu chrome must stay paint-only and scoped to chrome `data-testid`s** so Monaco /
  xterm layout is never perturbed (the `editor-tabs` sibling-box gotcha).
- **TDD throughout:** pure layout/direction logic → vitest in `tests/`; the popover, Record-in-menu,
  and split-by-direction behavior → Playwright e2e that launches the app, matching existing styles.

### Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | Direction + kind flow | **resolved** — single combined popover (decision 3) |
| 2 | Sleek control shape | **resolved** — compass / D-pad (decision 4) |
| 3 | Keyboard/a11y level | **resolved** — fully keyboard + a11y (decision 5) |
| 4 | Offer all four directions vs context-aware | **resolved** — always all four (decision 6) |
| 5 | Record placement/label/section within `PaneContextMenu` | **deferred** — non-blocking detail; spec to define exact label (start/stop) and section/separator following the menu's existing grouping |
| 6 | Exact testid contract (kept/renamed/added) and which e2e specs change | **deferred** — settled in spec/test phases; intent: one new split-button testid + direction targets, Record testid moves into the context menu |
| 7 | Default highlighted direction for one-click/Enter | **deferred** — non-blocking; spec to pick a sensible default (e.g. right ▶, today's primary) |

No **blocking** questions remain.
