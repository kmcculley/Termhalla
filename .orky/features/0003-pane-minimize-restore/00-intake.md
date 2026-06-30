# 0003 — Minimize / restore panes (siblings reflow to fill the freed space)

## Phase 0 — Intake

**Status:** intake captured — awaiting brainstorm (phase 1, human-led).

### Raw idea (verbatim)

> the ability to minimize panes and restore them. They should remain active in the background, and
> other panes should adjust to fit the space it left

### Restated requirements (to be confirmed in brainstorm)

1. **A pane can be minimized.** A new per-pane action (alongside the existing maximize/restore
   toggle in `PaneToolbar.tsx`, `data-testid="max-${paneId}"`, and/or the right-click
   `PaneContextMenu`) removes the pane from the visible tiled layout.
2. **Minimized panes stay alive in the background.** The minimized pane's PTY keeps running and its
   xterm scrollback / Monaco model are **not** disposed — output continues to accumulate, live TUIs
   keep ticking. (This is the "remain active in the background" requirement and the core technical
   constraint — see gotchas.)
3. **Remaining panes reflow to fill the vacated space.** When a pane is minimized, the other
   panes in that workspace expand to occupy the area it left (no empty/blank region where the
   minimized pane used to be).
4. **A minimized pane can be restored.** There is a visible affordance to bring a minimized pane
   back into the tiled layout; on restore the layout re-accommodates it and its still-running
   content is intact.
5. **Per-workspace.** Minimize state is scoped to a workspace (like `maximized`), and likely
   transient/non-persisted unless brainstorm decides otherwise.

### Context grounding (current behavior, for brainstorm)

- **Maximize is the closest existing feature and the design foil.** `toggleMaximize(wsId, paneId)`
  (`store.ts`) sets a transient, non-persisted `maximized: Record<wsId, paneId>` (`store/types.ts`).
  `PaneTile.tsx` imperatively sets `data-max="1"` on its mosaic tile, and `index.css` (`.ws-max …`)
  fills that tile with `!important` geometry while siblings get `visibility: hidden` (kept mounted).
  Maximize hides *all but one*; minimize is the inverse — hide *one*, let the rest reflow.
- **Crucial difference from maximize:** maximize can use pure CSS (`visibility: hidden`) because the
  hidden siblings don't need to give up their *space* — the maximized tile just paints over them.
  Minimize requires the siblings to actually **reflow into the freed space**, which react-mosaic only
  does if the node leaves the layout tree. So `visibility: hidden` alone is insufficient for the
  "others adjust to fit" requirement — this is the central design question.
- **The keep-mounted invariant forbids the naive fix.** Per CLAUDE.md, removing a pane node from
  `ws.layout` unmounts its xterm (lost scrollback, frozen live TUIs) and Monaco model (lost edits) —
  exactly what requirement 2 forbids. The maximize doc explicitly warns "swapping `ws.layout` to
  maximize would unmount siblings — don't." Minimize must reflow the *visible* tree while keeping the
  minimized pane's React subtree mounted somewhere off-layout. How to do that cleanly is the brainstorm's
  job (candidate approaches below).
- `maximized` and a future `minimized` interact: what happens to a minimized pane when another is
  maximized, or vice versa? Need a defined precedence.

### Candidate approaches (for brainstorm to weigh — not decided)

- **A. Off-layout mounted stash + reflowed mosaic.** Render the minimized pane's subtree mounted but
  detached from the mosaic (e.g. portalled/absolutely-positioned `visibility: hidden`, zero-impact on
  layout), and feed react-mosaic a layout tree with that leaf pruned so siblings reflow. On restore,
  re-insert the leaf. Hard part: keeping one xterm/PTY instance across the prune/re-insert without a
  remount — relates to the existing transit/stash machinery (`terminal-registry.ts` stash,
  `stashSnapshot`/`consumeSnapshot`, idempotent `pty:spawn`).
- **B. CSS-collapsed leaf.** Keep the node in the tree but drive its mosaic split percentage to ~0 so
  it visually vanishes and siblings grow. Keeps the subtree mounted trivially, but a 0%-sized xterm
  may thrash FitAddon (cf. the `display:none` warning) and "fully gone vs. a sliver" is a UX question.
- **C. Minimized tray/dock.** A strip (per workspace) showing chips for each minimized pane (title +
  live status), click to restore. Pairs with A or B for the layout mechanics; gives requirement 4 a
  home and a place to surface that a background pane "needs input."

### Open questions for brainstorm

- **Reflow mechanism:** approach A (prune the visible tree, stash the live subtree) vs. B (collapse to
  0%) vs. something else? This determines whether we touch the transit/stash machinery.
- **Restore affordance & discoverability:** where do minimized panes "go," and how does the user get
  them back — a per-workspace minimized tray/dock, a menu, a keybinding, or all three? Without a tray,
  a minimized pane could become unreachable.
- **Background-activity signal:** since a minimized pane stays live, should its restore chip surface
  status (running/idle, **needs-input**, recording, AI-session active)? A backgrounded pane silently
  blocking on input is a real footgun.
- **Interaction with maximize:** precedence and mutual exclusion between `maximized` and minimized
  state; can you minimize the maximized pane; does maximizing auto-restore minimized ones?
- **Single-pane / last-pane edge cases:** can the *only* pane be minimized (leaving an empty
  workspace + tray)? Can all panes be minimized at once? What renders then?
- **Persistence:** is minimize transient like maximize, or should it survive reload / window
  undock / cross-workspace move (`movePaneToWorkspace`, multi-window handoff)?
- **Editor & non-terminal panes:** does minimize apply uniformly to Terminal / Editor / Explorer
  panes? Editor drafts must be flushed-not-deleted while off-layout (cf. `pane-transit.ts`).
- **Keybinding:** a bind for minimize/restore (`src/shared/keybindings.ts`), and a context-menu entry
  (`PaneContextMenu.tsx`)?
- **Test/automation impact:** new `data-testid`s for the minimize action and tray chips; e2e proving
  the PTY stays alive (output accumulates) while minimized and is intact after restore, and that
  siblings actually reflow.

### Likely concern tags (proposed — NOT yet committed; finalized in the spec)

- **ux** — primary. New always-available pane action plus a restore surface (tray/dock); reflow and
  restore must feel coherent with maximize.
- **state-management** — new per-workspace transient state interacting with `maximized`, layout,
  transit/stash, and (maybe) persistence.
- **accessibility** — minimize/restore and any tray must be keyboard- and screen-reader-operable, and
  a backgrounded needs-input pane must be discoverable.
- **qol** — declutter the visible layout while keeping work running.
- **doc-drift** — `store.ts`/`store/types.ts`, `PaneTile`/`PaneToolbar`/`PaneContextMenu`, `index.css`,
  the workspaces/window-management feature docs, the maximize gotcha, and e2e testid contracts will
  drift.

(Always-on lenses `security`, `quality`, `devils-advocate` apply regardless.)

### Load-bearing gotchas this feature must respect

- **Never unmount a workspace/pane to hide it.** Inactive workspaces and maximized siblings use
  `visibility: hidden` (kept mounted), never `display: none` (zeros size → FitAddon/PTY-grid thrash)
  and never an unmount (disposes xterm scrollback + Monaco models). A minimized pane must stay mounted
  by the same rule — requirement 2 depends on it.
- **Reflow needs the leaf out of the layout tree, but the subtree must stay mounted.** These two pull
  in opposite directions; reconciling them (stash the live subtree off-layout while feeding mosaic a
  pruned tree) is the heart of the feature. Reuse, don't reinvent, the existing snapshot/stash + idempotent
  `pty:spawn` re-adoption machinery (`terminal-registry.ts`, the same-window cross-workspace move path)
  rather than tearing the PTY down.
- **Editor drafts are flushed, not deleted, while a pane is off-layout** (`pane-transit.ts`); a
  minimized editor pane must not lose unsaved edits.
- **Overlays opened from inside a mosaic tile must portal to `<body>`** — if the restore tray or any
  minimize popover is a `position: fixed` child of a tile it mis-positions/clips; portal like
  `PaneContextMenu`/`Modal`/`SplitMenu`.
- **Multi-window / undock + cross-workspace move** own layout via `win:report` (main owns
  `windows[]`); a minimized pane crossing windows or workspaces must not double-mount its PTY or write
  app-state from the renderer.
