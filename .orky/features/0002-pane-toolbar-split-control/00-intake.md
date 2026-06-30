# 0002 — Pane toolbar cleanup: Record → context menu, unified split-direction control

## Phase 0 — Intake

**Status:** intake captured — awaiting brainstorm (phase 1, human-led).

### Raw idea (verbatim)

> In the terminal menu bar, clean it up by removing the Record button and add it to the
> right click context menu. Combine the split right and split down buttons into one, and
> have a selectable up,left,right,down option after clicking the new combined button. Make
> it a modern and sleak implementation, not just basic ux.

### Restated requirements (to be confirmed in brainstorm)

1. **Remove the Record button from the pane toolbar.** The toolbar today (`PaneToolbar.tsx`)
   renders a record toggle (`data-testid="rec-${paneId}"`, ⏺) that starts/stops session
   recording. It is removed from the toolbar "menu bar."
2. **Add Record to the right-click context menu.** The record start/stop action moves into the
   pane title-bar right-click menu (`PaneContextMenu.tsx`), still reflecting and toggling the
   `recording` state for that pane.
3. **Combine the two split buttons into one.** Today there are two separate buttons —
   split-right (`split-${paneId}`, ⬌, opens a row split) and split-down (`split-col-${paneId}`,
   ⬍, opens a column split). These collapse into a **single split button**.
4. **Direction is chosen after clicking the combined button.** Clicking the new button reveals a
   selector offering **up, left, right, and down** as split directions (today only right/down
   exist). Picking a direction performs the split in that direction.
5. **Modern, sleek interaction — not basic UX.** The direction picker should feel polished
   (e.g. a directional/spatial control rather than a plain vertical list of four text buttons),
   consistent with the app's existing in-tile popover styling.

### Context grounding (current behavior, for brainstorm)

- The existing `SplitMenu.tsx` popover already lets the user choose the **kind** of the new pane
  (Terminal / Editor / Explorer) for a *fixed* direction passed in as a prop. The two toolbar
  buttons hard-code the direction (`split-row` → right, `split-col` → down). So today the user
  picks *kind* but not *direction*. This feature adds **direction selection** and unifies the two
  entry points — the interplay of direction-pick **and** kind-pick is the core design question.
- `react-mosaic` supports four split directions; up/left will need the new-pane insertion to place
  the pane before vs. after the source (today's helpers only do right/down).
- Recording state plumbing already exists end-to-end (`recording` prop, `api.recStart/recStop`).

### Open questions for brainstorm

- **Direction + kind flow:** one combined step (pick a direction *and* a kind together) or two
  steps (pick direction → then Terminal/Editor/Explorer, reusing today's `SplitMenu`)? A spatial
  control implies direction-first.
- **Sleek control shape:** a compass/D-pad (four arrows around a center), arrow-key-navigable
  popover, hover-to-preview the resulting layout, or something else? What matches the app's
  aesthetic?
- **Keyboard & accessibility:** should the combined split button and its direction picker be fully
  keyboard-operable (arrow keys to choose direction, Enter to confirm, Esc to dismiss)? Any
  keybinding implications (`src/shared/keybindings.ts`)?
- **Does up/left even make sense for every pane**, or are some directions disabled depending on
  layout/position? Default/most-common direction for one-click or Enter?
- **Context-menu placement of Record:** where in `PaneContextMenu` does the record toggle sit, and
  does it need a separator/section? Label wording for start vs. stop.
- **Test/automation impact:** `tests/e2e/pane-actions.spec.ts` and others assert on the existing
  `rec-`, `split-`, and `split-col-` testids. Which testids are kept, renamed, or added, and how
  do the e2e specs change?

### Likely concern tags (proposed — NOT yet committed; finalized in the spec)

- **ux** — primary. This restructures a core, always-visible surface (the pane toolbar) and adds a
  new interaction pattern (directional split picker); "modern and sleek" is an explicit goal.
- **accessibility** — a directional/spatial control must remain keyboard- and screen-reader-operable,
  not mouse-only.
- **qol** — fewer, cleaner toolbar buttons; richer split options.
- **doc-drift** — `PaneToolbar`/`SplitMenu`/`PaneContextMenu`, the "where things live" table, feature
  docs, and the e2e specs (testid contracts) all reference the current buttons and will drift.

(Always-on lenses `security`, `quality`, `devils-advocate` apply regardless.)

### Load-bearing gotchas this feature must respect

- **Overlays opened from inside a mosaic tile must portal to `<body>`** (a `position: fixed` child of
  a react-mosaic tile is clipped/mis-stacked relative to the tile). The new direction picker is such
  an overlay — it must portal like `PaneContextMenu`/`Modal` do. Guarded by `pane-actions.spec.ts`.
- **Chrome CSS must not change the box of `editor-tabs` children / Monaco siblings** — keep new
  toolbar chrome paint-only and scoped to chrome `data-testid`s.
