# 0003 — Minimize / restore panes — Concept (Phase 1)

**Status:** brainstorm complete — awaiting final human confirmation to pass the gate.

Distills [`00-intake.md`](00-intake.md) plus the brainstorm answers into the agreed concept that the
spec-writer will turn into REQ-IDs.

## Decisions (settled)

### D1 — Minimize removes the pane from the visible layout; siblings reflow to fill 100%
A minimized pane disappears entirely from the tiled mosaic and the remaining panes expand to occupy
the full freed area (true reflow, as if closed — but kept alive). **Not** a collapsed sliver (a
0%/sliver xterm risks FitAddon/PTY-grid thrash and isn't what was asked).
*Brainstorm: "Fully gone, siblings reflow."*

### D2 — The minimized pane stays alive in the background
PTY keeps running, xterm scrollback and Monaco models are **not** disposed, live TUIs keep ticking,
editor drafts are preserved (flushed-not-deleted). The implementation must reflow the *visible*
mosaic tree while keeping the minimized pane's React subtree mounted off-layout — reusing the
existing snapshot/stash + idempotent `pty:spawn` re-adoption machinery
(`terminal-registry.ts`, the same-window cross-workspace move path), **never** an unmount.
*Intake requirement 2 + keep-mounted gotcha; this is the core technical constraint.*

### D3 — Restore home: a per-workspace minimized tray/dock
Each workspace shows a thin strip with one chip per minimized pane. Clicking a chip restores that
pane to the layout. The tray is the canonical place minimized panes "live," preventing unreachable
panes. (Overlay/menu mechanics — if any — must portal to `<body>` per the mosaic-tile gotcha.)
*Brainstorm: "Per-workspace tray/dock."*

### D4 — Tray chips surface live background status
Each chip reflects the pane's live state — running/idle, **needs-input**, recording, AI-session
active — so a backgrounded pane blocking on input is visible (no silent footgun). Reuses the same
status signals the pane chip/toolbar already consume.
*Brainstorm: "Yes — show status on the chip."*

### D5 — Minimize state is PERSISTED — and maximize is converted to persisted too
Minimize state survives app reload (and should survive undock / cross-workspace move). **Scope
expansion confirmed in brainstorm:** the existing `maximized` state — today transient
(`store/types.ts`, non-persisted) — is **also changed to persisted** so both pane view-states behave
consistently across reload.
- Requires a `SCHEMA_VERSION` bump + migration (`src/shared/types.ts`) and persisting the new
  `minimized` (and now `maximized`) view-state with the workspace/app-state.
- Must interact correctly with the multi-window handoff / undock (`win:report`, main owns
  `windows[]`) and `movePaneToWorkspace` transit paths without double-mounting a PTY or writing
  app-state from the renderer.
*Brainstorm: "Persisted. Also alter maximize to be persistent."*

### D6 — Entry points: pane toolbar button + context menu + keybinding
A minimize action joins the maximize/restore control in `PaneToolbar.tsx` and the
`PaneContextMenu.tsx`, with a keybinding registered in `src/shared/keybindings.ts` (and its
context-menu/toolbar tooltip kept in sync per CONV-005 — a native-menu accelerator, if any, derives
from the keybinding registry, not a hard-coded duplicate). New `data-testid`s for the minimize
action and tray chips.

## Decisions (defaults chosen — flagged for human review, not blocking)

These were not separately asked; sensible defaults are recorded so the spec is complete. Override any
at confirmation.

- **DF1 — Minimizing a maximized pane first clears its maximize, then minimizes it.** Maximize and
  minimize are mutually exclusive *for the same pane*. A minimized pane and a (different) maximized
  pane can coexist: maximize fills the visible tree, which already excludes minimized panes. Restoring
  a minimized pane while another is maximized: it returns to the (hidden) layout and appears on
  restore-from-maximize. (Simplest coherent precedence.)
- **DF2 — You may minimize panes down to and including the last one.** If all panes in a workspace are
  minimized, the workspace body shows an empty-state hint and the tray (the restore home). Minimizing
  is never blocked by "it's the only pane." (The tray guarantees recoverability.)
- **DF3 — Minimize applies uniformly to Terminal / Editor / Explorer panes.** Editor drafts are
  flushed-not-deleted while off-layout (`pane-transit.ts`); Explorer/editor state is preserved like
  any kept-mounted pane.
- **DF4 — Restore returns the pane to a sensible position.** On restore the pane re-enters the mosaic
  (e.g. split from the currently-focused/largest pane, or its remembered prior position if cheap to
  retain). Exact placement policy is a spec detail; the requirement is only that it returns intact and
  visible.

## Concerns (routing tags — to be committed in the spec)

- **ux** (primary) — new always-available pane action + a new restore surface (tray/dock); reflow,
  restore, and status chips must cohere with maximize.
- **state-management** — new persisted `minimized` view-state + converting `maximized` to persisted;
  interaction with layout, transit/stash, undock, and cross-workspace move.
- **persistence/migration** — `SCHEMA_VERSION` bump + migration for the newly-persisted view-state
  (CONV-003: no silent capping; migration must be explicit and tested).
- **accessibility** — minimize/restore and the tray must be keyboard- and screen-reader-operable;
  a backgrounded needs-input pane must be discoverable (CONV-007: portalled chrome carries visible
  focus/hover styling).
- **qol** — declutter the visible layout while keeping work running.
- **doc-drift** — `store.ts`/`store/types.ts`, `src/shared/types.ts` (schema), `PaneTile`/
  `PaneToolbar`/`PaneContextMenu`, `index.css`, the workspaces + window-management feature docs, the
  maximize gotcha (now persisted), and e2e testid contracts will drift.
- Always-on: **security**, **quality**, **devils-advocate**.

## Open questions

- **OQ1 (resolved)** — Restore home → per-workspace tray/dock (D3).
- **OQ2 (resolved)** — Reflow shape → fully gone, siblings reflow (D1).
- **OQ3 (resolved)** — Background status on chip → yes (D4).
- **OQ4 (resolved)** — Persistence → persisted; maximize also made persisted (D5).
- **OQ5 (deferred to spec)** — Exact restore placement policy (DF4) and tray visual/position details.
- **OQ6 (deferred to spec)** — Whether persisted maximize/minimize must round-trip through undock and
  `movePaneToWorkspace`, or only survive in-place reload (test scope decision).

No **blocking** open questions remain.

## Load-bearing gotchas the spec must carry forward

- Keep-mounted invariant (never unmount / never `display:none` to hide a pane) — D2.
- Reflow needs the leaf out of the *visible* tree while the subtree stays mounted — reuse snapshot/
  stash + idempotent `pty:spawn`, don't tear down the PTY.
- Editor drafts flushed-not-deleted off-layout (`pane-transit.ts`).
- Tray/menu overlays portal to `<body>` (mosaic-tile clipping gotcha) with visible focus/hover
  styling (CONV-007).
- Multi-window/undock + cross-workspace move own layout via `win:report` (main owns `windows[]`);
  don't double-mount the PTY or write app-state from the renderer (now also true for persisted
  view-state).
