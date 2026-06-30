# Pane minimize / restore (Orky 0003) — Review Follow-ups (deferred)

Feature `0003-pane-minimize-restore` shipped READY after a two-iteration review. All **HIGH**
and **MEDIUM** contract violations were **resolved in-feature** across iterations 2–3
(buffered same-window PTY transit, Explorer view-state bridging, REQ-010 mutual exclusion on
both the runtime and load paths, host-geometry sizing, the `exited` chip state, the undock
autosave flush, the tray pointer-events fix, and the portalled `pane-menu` focus/hover
allow-list). See the per-finding records in
`.orky/features/0003-pane-minimize-restore/findings.json`.

The one non-blocking item below was **deferred, not fixed**, and is tracked here so it is not
lost.

## Deferred follow-ups

### MEDIUM

- **Residual snapshot-vs-arm gap in same-window minimize/restore transit** (FINDING-DA-005,
  `src/renderer/store.ts:305,338` + `src/preload/index.ts:37` + `src/main/window-manager.ts:235`).
  The CODEX-001 fix arms the main-side `transit` buffer for the same window via a fire-and-forget
  `pty:transit-begin` (`ptyTransitBegin`) and then reads the terminal snapshot **synchronously**
  immediately after. But main only *begins buffering* when it processes that IPC message — one IPC
  latency later — so any `pty:data` routed in that sub-millisecond window reaches only the
  soon-disposed old xterm and lands in **neither** the snapshot **nor** the buffer. This narrows
  CODEX-001 rather than fully eliminating it; it only manifests under sustained high-frequency
  contiguous output.

  **Why deferred (accepted architectural parity).** This is the *same* inherited limitation as the
  already-accepted multi-window undock and same-window cross-workspace move handoffs, which also use
  the snapshot-then-async-arm ordering. The same-window minimize path now has parity with those
  established paths rather than a unique regression, and the failure mode is a narrow, high-throughput
  edge with no data-corruption or security impact — so closing it is not release-blocking. Fixing it
  in isolation here (without also reworking the shared handoff machinery) would diverge minimize from
  the very path it was mandated to reuse.

  **Recommended fix (cut-point handshake).** Capture the snapshot at the cut point that aligns with
  the arm, by either (a) reading the snapshot in the *old* `TerminalPane`'s unmount cleanup (so it is
  taken at the same React commit that triggers the arm), or (b) making `ptyTransitBegin` a `sendSync`
  handshake that returns only once main has armed the buffer, de-duplicating the snapshot/buffer
  overlap with a sequence marker. Whichever is chosen should be applied to the shared handoff
  machinery so the multi-window and cross-workspace paths benefit too. Add a high-frequency,
  contiguous-output stress test that emits during the transition and asserts the stream stays
  contiguous across repeated toggles (an extension of TEST-036).

## Promoted to conventions

- **CONV-008** — from FINDING-DOC-001 (a stale `transient (non-persisted)` maximize claim survived
  in `docs/decisions.md` because REQ-019 hand-listed the docs to reconcile): when retiring or
  changing a documented claim, `grep` the **whole `docs/` tree** (plus `CLAUDE.md` and
  `.orky/baseline/`) for every phrasing of the old claim — not just the files a spec enumerated — so
  no copy of the retired statement is left to contradict the new behavior.

## Resolved in-feature (not deferred)

- FINDING-CODEX-001 (HIGH, contract — dropped output during the same-window unmount→remount gap) —
  same-window buffered transit armed via `pty:transit-begin`, drained on the destination's idempotent
  `pty:spawn` re-adoption (TASK-011); TEST-036 green. (Residual narrow gap tracked above as DA-005.)
- FINDING-DA-001 (HIGH, contract — Explorer expanded-folder/scroll state lost on the minimize
  remount) — `explorer-registry.ts` stash bridges the view-state across the remount (TASK-012);
  TEST-038 green.
- FINDING-SEC-001 (MEDIUM, contract — a pane could end up in both `minimized` and `maximized` via the
  stale-focus maximize path) — `toggleMaximize` no-ops a minimized pane (TASK-013); TEST-041 green.
- FINDING-CODEX-002 (MEDIUM, contract — load path did not enforce REQ-010 mutual exclusion) —
  `normalizeViewState` clears `maximized` when the same id is also minimized, minimize-wins (TASK-014);
  TEST-039 green.
- FINDING-UX-001 (HIGH, contract — portalled `pane-menu` Minimize item had no focus/hover styling) —
  `pane-menu` added to the `index.css` hover/active/disabled/focus-visible allow-lists (TASK-015);
  TEST-042 green.
- FINDING-QOL-001 (HIGH — transparent tray container swallowed clicks over the reflowed terminal) —
  `.min-tray` set `pointer-events:none`, chips `pointer-events:auto` (TASK-016); TEST-043 green.
- FINDING-QUAL-002 (MEDIUM, contract — context-menu Minimize item carried no registry-derived chord) —
  registry-derived `title` via `formatChord` (TASK-017); TEST-044 green.
- FINDING-DA-002 (MEDIUM — full-body host forced an avoidable ConPTY repaint for multi-tile panes) —
  host sized to pre-minimize tile geometry via `pane-geometry.ts` (TASK-018); TEST-037 green.
- FINDING-DA-003 (MEDIUM — a minimized terminal whose shell exited read as idle) — distinct `exited`
  chip state added to `chipStatus` (TASK-019); TEST-040 green.
- FINDING-DA-004 (MEDIUM — minimize-then-undock inside the autosave debounce handed a stale record) —
  the undock handoff flushes the pending workspace autosave before the destination loads (TASK-009
  extension); TEST-035 green.
- FINDING-SEC-003 (MEDIUM, contract — `pty:transit-begin` had no sender-ownership validation and an
  unbounded re-arm buffer) — handler resolves `windowIdOf(sender)` and no-ops on unknown/unowned/foreign
  panes (mirrors `claimPane`, C5); re-arm flushes the pending buffer; `routeToPane` caps at
  `TRANSIT_BUFFER_MAX=1024`.
- FINDING-QOL-002 (MEDIUM — minimizing the focused pane orphaned keyboard focus on `<body>`) —
  `toggleMinimize` refocuses a surviving visible pane (TASK-013).
- FINDING-QUAL-001/003/004/005/006/007, FINDING-SEC-002 (LOW/MED quality + consistency cleanup) —
  resolved in one behavior-neutral pass (TASK-020): `restorePane` uses the reducer's `restored.minimized`;
  `applyViewState` omits empty view-state on write; the split-state contract is documented and
  `minimizePane` marked as the pure-reducer/test surface; the `WorkspaceView` memo eslint-disable removed;
  `chipStatus` doc-comment added; `toggle-minimize-pane` added to `TIP_COMMANDS`.
- FINDING-QUAL-008 (LOW — `clearTileSize` leaked tile-size map entries) — `clearTileSize(paneId)` wired
  into the `PaneTile` ResizeObserver cleanup.
- FINDING-DOC-001 (MEDIUM, doc-drift — `docs/decisions.md` still called maximize transient/never
  serialized) — reconciled to persisted minimize+maximize view-state and the v6→v7 schema; lesson
  promoted to CONV-008.
- FINDING-DOC-002 (LOW, doc-drift — `docs/features/workspaces.md` Key-files/Testing tables missing the
  new modules and specs) — tables completed.
