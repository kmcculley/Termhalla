# 0003 — Minimize / restore panes — Plan (Phase 3)

**Status:** plan **iteration 2** — loop-back from review (`findings.json`) after `ESC-001` was resolved
**Option A: harden the remount path** (keep the off-layout-host + true-100%-reflow design from brainstorm
D1; do NOT change the mechanism). The spec [`02-spec.md`](02-spec.md) is FROZEN and UNCHANGED. Iteration 1
(TASK-001..010) was implemented and reviewed; review found 7 blocking findings (6 contract violations)
plus cheap non-blocking ones. This iteration adds TASK-011..020 to encode the human-approved fix design
and extends TASK-009/TASK-010. Constraints C1–C5 still hold; tests are deepened in phase 4.

## Target file / module layout

Unchanged top-level layout (no new architecture). Iteration-2 hardening lands in these existing homes
plus the **main-side transit reuse** and a small renderer explorer-state stash:

| Area | File(s) | New? |
|---|---|---|
| Persisted view-state shape + schema | `src/shared/types.ts` (`Workspace`, `SCHEMA_VERSION 6→7`) | edit |
| Migration + serialize/deserialize prune + **load-path mutual exclusion** | `src/shared/workspace-model.ts` (`migrate`, `normalizeViewState`) | edit |
| Pure view-state reducers | `src/shared/workspace-model.ts` | edit |
| Store state + actions + **runtime mutual exclusion + focus** | `src/renderer/store/types.ts`, `src/renderer/store.ts` | edit |
| Apply view-state onto serialized ws | `src/renderer/store/internals.ts` (`applyViewState`) | edit |
| Off-layout reflow + **pre-minimize host geometry** | `src/renderer/components/WorkspaceView.tsx`, `src/renderer/components/MinimizedPaneHost.tsx`, `src/renderer/index.css` | edit |
| **Same-window buffered transit (main-side reuse)** | `src/shared/ipc-contract.ts`, `src/main/ipc/register-pty.ts` (or `register.ts`), `src/main/window-manager.ts`, `src/renderer/api.ts`, `src/renderer/store.ts`, `src/renderer/components/TerminalPane.tsx`, `src/preload/index.ts` | edit |
| **Explorer view-state bridge across remount** | `src/renderer/components/ExplorerPane.tsx`, new `src/renderer/components/explorer-registry.ts` | new/edit |
| Entry points + **context-menu chord title** | `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneContextMenu.tsx` | edit |
| Keybinding + dispatch + accelerator | `src/shared/keybindings.ts`, `src/renderer/App.tsx`, `src/main/menu.ts` | edit |
| Tray + chips + status mapping + **exited state** | `src/renderer/components/MinimizedTray.tsx`, `src/shared/chip-status.ts`, `WorkspaceView.tsx` | new/edit |
| **Portalled pane-menu focus/hover + tray pointer-events** | `src/renderer/index.css` | edit |
| Docs / baseline | `docs/features/workspaces.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/features/keybindings.md`, `docs/decisions.md`, `.orky/baseline/architecture.md` | edit |

## Reuse / do-not-reinvent (verified against the code)

- **Reflow keep-mounted = the same-window cross-workspace move path.** `movePaneToWorkspace`
  (`store.ts:325`) stashes the xterm via `readPaneSnapshot`/`stashSnapshot`
  (`components/terminal-registry.ts`), flushes (not deletes) editor drafts via `beginPaneTransit`
  (`components/pane-transit.ts`), prunes the visible leaf, and re-adopts the running PTY via idempotent
  `pty:spawn` on remount. Minimize/restore is the *same move*; never call `api.ptyKill`.
- **Main-side transit buffer already exists** for the MULTI-window handoff (`window-manager.ts`):
  `transit: Map<paneId, BufferedEvent[]>` (line 61), armed at the move sentinel (lines 349–352) and
  drained by `replayInto(paneId)` (line 230) when the destination re-adopts via `pty:spawn`, with a
  `TRANSIT_GC_MS` (line 22) fallback. **Iteration 1 did NOT arm this buffer for the SAME-window
  unmount→remount gap** — that is FINDING-CODEX-001 and TASK-011 reuses (not reinvents) this exact
  machinery.
- **Pure view-state reducers + `normalizeViewState`** live in `workspace-model.ts`
  (`computeVisibleLayout` l.89, `minimizePane` l.102, `restorePaneModel` l.116, `normalizeViewState`
  l.195). `minimizePane` already clears `maximized` when the minimized pane held it (l.112) — that is
  the established **minimize-wins** precedence TASK-013/TASK-014 must mirror.

---

## Tasks (iteration 1 — unchanged unless noted)

### TASK-001 — Persisted view-state shape, schema bump, migration & pruning (pure, shared)
**Satisfies:** REQ-007, REQ-008, REQ-009, REQ-016 · **Files:** `src/shared/types.ts`, `src/shared/workspace-model.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** C5 · **Status:** done in iteration 1; unchanged.
- `Workspace` carries `minimized?: string[]` / `maximized?: string | null` (paneId refs + flags only,
  REQ-016). `SCHEMA_VERSION 6→7`. Named v6→v7 migration case yields empty view-state. `deserialize`
  prunes dangling paneIds, tolerates malformed view-state (→ empty, no throw), no cap (CONV-003/DF2).
- Template instancing re-keys/clears view-state coherently.
> Iteration-2 note: the load-path **mutual-exclusion** gap (FINDING-CODEX-002) is split out as TASK-014
> so TASK-001 stays a pure unchanged foundation.

### TASK-002 — Pure view-state reducers (minimize / restore / visible-layout / precedence)
**Satisfies:** REQ-002, REQ-006, REQ-010, REQ-017 (+REQ-015 move helper) · **Files:** `src/shared/workspace-model.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** C2 · **Status:** done; unchanged.
- `computeVisibleLayout` (prune minimized leaves, `null` when all minimized), `minimizePane`
  (idempotent, clears maximize for same pane — REQ-010 minimize-wins), `restorePaneModel` (right-split
  re-insert / sole leaf on empty), `dropPaneViewState` move helper. Total over ordinary input.

### TASK-003 — Store state + actions; derive-on-load; persist-on-save; precedence & idempotency wiring
**Satisfies:** REQ-001, REQ-006, REQ-007, REQ-008, REQ-010, REQ-015, REQ-017 · **Files:** `src/renderer/store/types.ts`, `src/renderer/store.ts`, `src/renderer/store/internals.ts`
**Depends on:** TASK-001, TASK-002 · **Order:** 3 · **Constraints:** C2, C3, C5 · **Status:** done in iteration 1; **amended by TASK-011/012/013** (transit arming, explorer stash, runtime mutual exclusion + focus).
- `minimized` map + `toggleMinimize`/`restorePane`; `maximized` persisted. Derive on load
  (`applyAssignment` `store.ts:146`); persist via `applyViewState` (`store/internals.ts:36`) in `saveAll`
  (C5). `closePane` drops the paneId from view-state; `movePaneToWorkspace` clears the moved pane's
  minimized flag (REQ-015). Reuses snapshot/draft stash; never `api.ptyKill`.

### TASK-004 — Off-layout reflow mechanism (pruned visible tree + kept-mounted subtree)
**Satisfies:** REQ-002, REQ-003, REQ-011, REQ-012 · **Files:** `src/renderer/components/WorkspaceView.tsx`, `src/renderer/components/MinimizedPaneHost.tsx`, `src/renderer/index.css`
**Depends on:** TASK-002, TASK-003 · **Order:** 4 · **Constraints:** C1, C2, C3 · **Status:** done in iteration 1; **host geometry amended by TASK-018**.
- `WorkspaceView` feeds `<Mosaic>` the pruned `computeVisibleLayout(ws)`; minimized bodies render in a
  kept-mounted off-layout `MinimizedPaneHost` (`visibility:hidden`, never `display:none`/unmount).
  All-minimized → empty-state branch. Transition is the sanctioned stash + idempotent `pty:spawn`.

### TASK-005 — Entry points: toolbar minimize button + context-menu item (all pane kinds)
**Satisfies:** REQ-001, REQ-012, REQ-013, REQ-018 · **Files:** `src/renderer/components/PaneToolbar.tsx`, `src/renderer/components/PaneContextMenu.tsx`
**Depends on:** TASK-003, TASK-006 · **Order:** 5 · **Constraints:** CONV-005 · **Status:** toolbar done; **context-menu chord title amended by TASK-017** (FINDING-QUAL-002).
- Toolbar `min-${paneId}` (tooltip via `formatChord`). Context-menu `pane-menu-minimize`. Both render
  for all pane kinds.

### TASK-006 — Keybinding command, App dispatch & native-menu accelerator sync
**Satisfies:** REQ-001, REQ-013 · **Files:** `src/shared/keybindings.ts`, `src/renderer/App.tsx`, `src/main/menu.ts`
**Depends on:** TASK-003 · **Order:** 5 · **Constraints:** CONV-005 · **Status:** done; `TIP_COMMANDS` discoverability gap folded into TASK-020 (FINDING-QUAL-007).

### TASK-007 — Per-workspace minimized tray, live-status chips, all-minimized empty state
**Satisfies:** REQ-004, REQ-005, REQ-011, REQ-018 · **Files:** `src/renderer/components/MinimizedTray.tsx`, `src/shared/chip-status.ts`, `src/renderer/components/WorkspaceView.tsx`, `src/renderer/index.css`
**Depends on:** TASK-003, TASK-004 · **Order:** 6 · **Constraints:** C4 · **Status:** done in iteration 1; **`exited` state amended by TASK-019; pointer-events amended by TASK-016**.
- Tray `min-tray-${wsId}` (≥1 minimized), chip `min-chip-${paneId}`, `ws-empty-${wsId}` empty state.
  Chips read `statuses`/`recording`/`aiSessions`; pure `chip-status.ts` maps to an indicator;
  `data-needs-input="1"` marker.

### TASK-008 — Accessibility: focusable/keyboard-operable chips + portalled-chrome focus/hover styling
**Satisfies:** REQ-014 · **Files:** `src/renderer/components/MinimizedTray.tsx`, `src/renderer/index.css`
**Depends on:** TASK-007 · **Order:** 7 · **Constraints:** C4, CONV-007 · **Status:** tray chips done; **the third REQ-001 entry point (portalled pane-menu) was NOT covered — added as TASK-015** (FINDING-UX-001).

### TASK-009 — Cross-workspace move / multi-window undock integrity
**Satisfies:** REQ-015 · **Files:** `src/renderer/store.ts` (`movePaneToWorkspace`), `src/main/window-manager.ts`, `src/renderer/store.ts` `applyAssignment`
**Depends on:** TASK-001, TASK-003 · **Order:** 7 · **Constraints:** C2, C5 · **Status:** done in iteration 1; **EXTENDED this iteration for FINDING-DA-004 (debounce-flush race).**
- (iteration 1) `movePaneToWorkspace` clears the moved pane's minimized flag; undock serializes/loads
  the workspace record with its persisted view-state; PTY re-adopted exactly once; no renderer app-state
  write (C5).
- **NEW (DA-004, MEDIUM):** the undock handoff loads the destination's workspace record from disk
  (`applyAssignment → api.loadWorkspace`) but the view-state only reaches disk via the 500 ms debounced
  autosave (`AUTOSAVE_DEBOUNCE_MS`). A minimize-then-undock inside the debounce window hands a STALE
  (un-minimized) record to the new window → REQ-015 corruption. **Fix:** flush the source window's
  pending workspace autosave (or serialize the in-memory view-state into the handoff) **before** the
  destination reads it — do not rely on the snapshot/drag timing exceeding the debounce. Keep C5: main
  owns `windows[]`; the renderer must not write `app-state` directly. Establish the convention
  *"a cross-window/process handoff that re-reads persisted state MUST flush the relevant pending
  debounced save first."*

### TASK-010 — Documentation, CHANGELOG & baseline reconciliation
**Satisfies:** REQ-019 · **Files:** `docs/features/workspaces.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/features/keybindings.md`, **`docs/decisions.md`**, `.orky/baseline/architecture.md`
**Depends on:** all functional tasks · **Order:** last · **Status:** EXTENDED this iteration (FINDING-DOC-001/002).
- (iteration 1) workspaces.md narrative, CLAUDE.md maximize→persisted + minimize keep-mounted/reflow
  note, CHANGELOG, keybindings doc, baseline reconcile.
- **NEW (DOC-001, MEDIUM):** `docs/decisions.md` (l.480, 493–494) still calls maximize a *transient*
  flag never serialized — now contradicted by persisted view-state (REQ-008) + the v6→v7 schema. Update
  it. **NEW (DOC-002, LOW):** add `MinimizedTray.tsx`, `MinimizedPaneHost.tsx`, `chip-status.ts`,
  `explorer-registry.ts`, and the new unit/e2e specs to the workspaces.md *Key files* + *Testing*
  tables. Document the new minimize gotcha in CLAUDE.md (same-window buffered-transit arming + explorer
  view-state bridge — so a future change doesn't re-introduce CODEX-001/DA-001).

---

## Tasks (iteration 2 — Option A hardening; new TASK-IDs)

### TASK-011 — Arm the buffered transit machinery for SAME-WINDOW minimize/restore (CORE FIX)
**Closes:** FINDING-CODEX-001 (HIGH, contract) · **Satisfies:** REQ-003 (and the REQ-002/006 transition path)
**Files:** `src/shared/ipc-contract.ts`, `src/main/ipc/register-pty.ts` (or `register.ts`), `src/main/window-manager.ts`, `src/renderer/api.ts`, `src/renderer/store.ts` (`toggleMinimize`/`restorePane`), `src/renderer/components/TerminalPane.tsx`, `src/preload/index.ts`
**Depends on:** TASK-003, TASK-004 · **Order:** 4 (with the core mechanic) · **Highest-risk task this iteration**
**Constraints:** C1 (keep-mounted), C2 (prune visible tree, keep subtree, re-adopt via idempotent
`pty:spawn`, **never** `api.ptyKill`), plus the same-window-move gotcha (no double-mount of the PTY).
**Problem (grounded):** same-window minimize stashes the renderer snapshot, then React unmounts the
source `TerminalPane` (drops its `onPtyData` subscription, `TerminalPane.tsx:195-208`) and mounts a new
one in `MinimizedPaneHost` (or, on restore, back in the tile). `preload` `pushChannel`
(`preload/index.ts:12-22`) fans `pty:data` out only to *currently registered* subscribers. Unlike the
multi-window handoff, **no main-side transit buffer is armed**, so `pty:data` emitted during the
unmount→remount gap is dropped from renderer scrollback — violating REQ-003/C2.
**Do (reuse, do NOT reinvent):**
- Reuse `WindowManager.transit` + `replayInto` (`window-manager.ts:61,230`) and the existing
  `TRANSIT_GC_MS` fallback. Add a renderer-callable IPC to **arm** the buffer for a paneId within the
  *same* window — e.g. `pty:transit-begin` (`ipc-contract.ts` → `register-pty.ts` → `api.ts`), which
  calls the same `transit.set(paneId, [])` arming used at the move sentinel (`window-manager.ts:349-352`)
  WITHOUT re-owning the pane to another window (same-window: `paneOwner` is unchanged — C5: main still
  owns `windows[]`).
- In `store.ts`, for the **terminal** branch of `toggleMinimize` AND `restorePane`, call the arm IPC
  immediately before the `set()` that prunes/re-inserts the leaf (i.e. before the source unmount),
  mirroring how the move arms transit before the source serializes.
- Drain via the EXISTING trigger: the destination `TerminalPane`'s idempotent `pty:spawn` re-adoption
  already drives `replayInto` for the move — wire the same-window re-adoption to call `replayInto(paneId)`
  (replay buffered events in order, then resume live flow), with the `TRANSIT_GC_MS` timer as the
  safety drain if the destination never re-attaches. Do NOT add a parallel buffer.
- Confirm the snapshot stash (`stashSnapshot`/`consumeSnapshot`) and the buffered `pty:data` replay
  compose without duplication (snapshot is the pre-transition frame; the buffer is only the gap bytes).
**Test obligation (for phase 4):** output emitted DURING the minimize→restore transition window appears
in scrollback after restore.

### TASK-012 — Bridge Explorer pane view-state across the minimize remount
**Closes:** FINDING-DA-001 (HIGH, contract) · **Satisfies:** REQ-012
**Files:** new `src/renderer/components/explorer-registry.ts`, `src/renderer/components/ExplorerPane.tsx`, `src/renderer/store.ts` (`toggleMinimize`/`restorePane` explorer branch)
**Depends on:** TASK-003, TASK-004 · **Order:** 5 · **Constraints:** C1 (kept-mounted parity)
**Chosen mechanism (a) — a renderer stash keyed by paneId, mirroring `terminal-registry.ts`:**
- New `explorer-registry.ts` exposing `registerExplorerState(paneId, () => ExplorerViewState)`,
  `readExplorerState(paneId)`, `stashExplorerState(paneId, state)`, `consumeExplorerState(paneId)` —
  the exact shape of `serializers`/`stashSnapshot`/`consumeSnapshot` (`terminal-registry.ts:13-20`).
  `ExplorerViewState = { expanded: string[]; scroll: number }` (NO file content/secrets — REQ-016 stays
  intact: paneId-scoped UI state only, renderer-memory only, never persisted to disk).
- `ExplorerPane.tsx`: register a serializer for its `expanded` set + scroll on mount; change the
  mount/`config.root`-change effect (`ExplorerPane.tsx:69-73`) so that instead of *unconditionally*
  resetting `expanded` to `new Set([config.root])`, it first consumes any stashed state for this paneId
  and rehydrates `expanded`/scroll (re-`loadDir`-ing the expanded dirs), falling back to root-only when
  there is no stash. (Root-change must still reset — only a transit remount rehydrates.)
- `store.ts`: in `toggleMinimize` AND `restorePane`, add an `explorer` branch sibling to the terminal
  snapshot / editor `beginPaneTransit` branches that calls `readExplorerState`+`stashExplorerState`
  before the transition (so the about-to-unmount instance's state is captured).
**Why (a) not (b):** lifting expanded/scroll into persisted `PaneConfig` (option b) would write churny,
content-adjacent UI state to disk every toggle and complicate REQ-016's "ids+flags only" persistence
guarantee; the renderer stash matches the established terminal/editor transit pattern and keeps disk
state minimal. Brownfield fit: parallels `terminal-registry.ts`/`pane-transit.ts` exactly.
**Test obligation (for phase 4):** Explorer with a subfolder EXPANDED → minimize → restore → still
expanded (strengthens the shallow TEST-030, which only checks the always-present top-level entry).

### TASK-013 — Enforce REQ-010 mutual exclusion on the runtime toggleMaximize path (+ post-minimize focus)
**Closes:** FINDING-SEC-001 (MEDIUM, contract) · folds FINDING-QOL-002 (MEDIUM) · **Satisfies:** REQ-010 (+REQ-001 focus)
**Files:** `src/renderer/store.ts` (`toggleMaximize`, `toggleMinimize`)
**Depends on:** TASK-003 · **Order:** 5 · **Constraints:** REQ-010 minimize-wins precedence (mirror `minimizePane`)
**Do:**
- `toggleMaximize` (`store.ts:268-273`): at the top of the setter, if the target pane is currently
  minimized (`(s.minimized[wsId] ?? []).includes(paneId)`) **reject** it (no-op return) — never set
  `maximized[wsId] = paneId` for a minimized pane. This closes the user-triggerable path (minimize the
  focused pane, then press toggle-maximize-pane with the stale `focusedPaneId`) that produced a pane in
  BOTH maps and persisted both via `applyViewState`. The minimize path already clears maximize
  (`minimizePane`, `toggleMinimize` `store.ts:291-292`); this enforces the symmetric direction.
- **QOL-002 (cheap, same pass):** after `toggleMinimize` minimizes the **focused** pane, move focus to a
  surviving visible pane (mirror the `requestPaneFocus` that `restorePane` already does, `store.ts:317`)
  so keyboard focus isn't orphaned on `<body>` and the stale-focus → maximize window is closed.
**Test obligation (for phase 4):** toggling maximize on a currently-minimized pane is a no-op (the pane
is never in both `minimized` and `maximized`).

### TASK-014 — Enforce REQ-010 precedence on the LOAD path (`normalizeViewState`)
**Closes:** FINDING-CODEX-002 (MEDIUM, contract) · **Satisfies:** REQ-010, REQ-009
**Files:** `src/shared/workspace-model.ts` (`normalizeViewState`)
**Depends on:** TASK-001 · **Order:** 2 (pure, with the other shared reducers) · **Constraints:** REQ-010 minimize-wins precedence
**Do:**
- `normalizeViewState` (`workspace-model.ts:195-204`) currently prunes dangling refs independently but
  does NOT enforce mutual exclusion: a v7 file with `minimized:['p1']` and `maximized:'p1'` loads with
  both intact. After computing the pruned `minimized`/`maximized`, if `maximized` is also present in
  `minimized`, **clear `maximized`** (minimize wins — the SAME precedence `minimizePane` uses at
  `workspace-model.ts:112`, so runtime and load paths agree). Keep it pure/total; no throw on malformed.
**Test obligation (for phase 4):** a current-version (v7) persisted workspace file with the SAME pane id
in both `minimized` and `maximized` loads normalized to mutual-exclusive (minimize wins).

### TASK-015 — Portalled `pane-menu` focus-visible/hover styling (third REQ-001 entry point)
**Closes:** FINDING-UX-001 (HIGH, contract) · **Satisfies:** REQ-014, CONV-007
**Files:** `src/renderer/index.css`
**Depends on:** TASK-005 · **Order:** 6 · **Constraints:** C4 (portalled-to-`<body>` chrome must carry visible paint-only focus + hover)
**Do:**
- Add `[data-testid="pane-menu"]` to the three `:is(...)` allow-list groups in `index.css` —
  hover (l.132-143), active (l.144-154), and focus-visible (l.183-194) — alongside the existing
  `ws-menu`/`proc-menu`/`cwd-menu`/`split-menu`. The context-menu Minimize item (one of REQ-001's three
  mandated entry points) lives in the portalled `pane-menu`, which was missing from these lists, so it
  had no accent focus ring and no hover affordance. Paint-only (background/border-color/outline) — never
  touch the box (per the editor-tabs/chrome gotcha).
**Test obligation (for phase 4):** the portalled `pane-menu` items match the focus-visible/hover style
allow-list (asserted like the existing portalled-chrome focus test).

### TASK-016 — Tray container must not swallow clicks over the reflowed terminal
**Closes:** FINDING-QOL-001 (HIGH) · **Satisfies:** REQ-002, REQ-004
**Files:** `src/renderer/index.css` (`.min-tray`)
**Depends on:** TASK-007 · **Order:** 6 · **Constraints:** —
**Do:**
- `.min-tray` (`index.css:256-259`) is a near-full-width, `z-index:6` transparent box pinned to the
  bottom of the workspace body with `pointer-events:auto`, so it eats clicks across the whole bottom
  strip (including between chips) over the prompt/last rows of the reflowed terminal. Set the
  **container `pointer-events:none`** and the **chips (`.min-chip`) `pointer-events:auto`** so only the
  chips are interactive and the rest of the strip passes clicks through to the terminal.
**Test obligation (for phase 4):** with ≥1 pane minimized, a click in the tray strip *between* chips
reaches the underlying reflowed terminal (the strip does not swallow it).

### TASK-017 — Context-menu Minimize item carries a registry-derived chord title
**Closes:** FINDING-QUAL-002 (MEDIUM, contract) · **Satisfies:** REQ-013, CONV-005
**Files:** `src/renderer/components/PaneContextMenu.tsx`
**Depends on:** TASK-005, TASK-006 · **Order:** 6 · **Constraints:** CONV-005 (no hard-coded duplicate)
**Do:**
- The `pane-menu-minimize` button (`PaneContextMenu.tsx:54-55`) renders `Minimize` with no `title` and
  no chord. Add a `title` built from `formatChord(resolveBindings('toggle-minimize-pane', quick.keybindings))`,
  mirroring the toolbar pattern (`PaneToolbar.tsx:25-26`); `quick.keybindings` is already accessible at
  the call site. Rebinding the command must update the surfaced chord (REQ-013).
**Test obligation (for phase 4):** rebinding `toggle-minimize-pane` changes the context-menu item's
surfaced chord (or assert the `title` derives from `formatChord`, not a literal).

### TASK-018 — Size the off-layout host to pre-minimize/restored tile geometry (avoid avoidable ConPTY repaint)
**Closes:** FINDING-DA-002 (MEDIUM) · **Satisfies:** REQ-003 (multi-tile case)
**Files:** `src/renderer/components/MinimizedPaneHost.tsx`, `src/renderer/components/WorkspaceView.tsx` (geometry source)
**Depends on:** TASK-004, TASK-011 · **Order:** 5 · **Constraints:** C1, the status-tail ConPTY repaint-eviction gotcha
**Do:**
- `MinimizedPaneHost` sizes EVERY minimized pane to `inset:0` (full body) (`MinimizedPaneHost.tsx:27-31`).
  For a multi-tile workspace a 50%-width tile is remounted at 100% width — a real cols/rows change →
  ConPTY repaint on minimize, and a second on restore. Size the host to the pane's **pre-minimize (or
  eventual restored) tile geometry** so minimize/restore does not force an avoidable resize/repaint
  (which risks evicting the prompt from the ANSI-stripped status tail and wedging needs-input). Keep
  `visibility:hidden`, `pointer-events:none`, off-layout (C1). The single-pane full-body case is the
  degenerate case of the same rule.
**Test obligation (for phase 4):** a MULTI-TILE workspace — minimize one of ≥2 panes; output still
accumulates / needs-input still marks the chip (complements the single-pane TEST-026/TEST-033).

### TASK-019 — Add an `exited` chip state for a minimized terminal whose process exits
**Closes:** FINDING-DA-003 (MEDIUM) · **Satisfies:** REQ-005
**Files:** `src/shared/chip-status.ts`, `src/renderer/components/MinimizedTray.tsx` (+ read the exit signal already pushed via `onPtyExit`)
**Depends on:** TASK-007 · **Order:** 6 · **Constraints:** REQ-005 "no silent footgun"
**Do:**
- A minimized terminal is not auto-closed when its shell exits (`TerminalPane.tsx:84` only writes
  `[process exited]` to the now-hidden xterm); its chip keeps showing the last `statuses[paneId]`
  (typically `idle`), so a dead terminal is indistinguishable from a live idle one — contrary to
  REQ-005. Add an `exited` state to the pure `chipStatus` mapping and surface it on the chip with a
  distinct icon/label (e.g. `data-status="exited"` / "exited" in the accessible name), driven by the
  exit signal the store already receives (`onPtyExit`). (Auto-pruning the chip is the alternative; the
  distinct state is preferred so the user can still restore to read the final output.)
**Test obligation (for phase 4):** a minimized terminal whose process EXITS shows an `exited` chip, not
`idle` (if feasible in e2e; otherwise a unit test over `chipStatus`).

### TASK-020 — LOW-severity quality / consistency cleanup (non-blocking, same pass)
**Closes:** FINDING-QUAL-001, -003, -004, -005, -006, -007, FINDING-SEC-002 · **Satisfies:** (hardening of REQ-005/006/007/008/013; no new REQ) — attached to REQ-017 (totality/consistency) for traceability
**Files:** `src/renderer/store.ts`, `src/renderer/store/internals.ts`, `src/renderer/components/WorkspaceView.tsx`, `src/shared/chip-status.ts`, `src/shared/keybindings.ts`
**Depends on:** TASK-003, TASK-007 · **Order:** 7 (cleanup) · **Constraints:** —
**Do (each a small, behavior-neutral fix):**
- **QUAL-001:** `restorePane` (`store.ts:309-314`) — use the reducer's returned `restored.minimized` to
  update `minimized[wsId]`, dropping the redundant independent `.filter(...)` so the two can't diverge.
- **QUAL-004 / SEC-002:** `applyViewState` (`store/internals.ts:36`) — omit empty fields on write (only
  write `minimized` when non-empty, `maximized` when non-null) so the persisted format matches the
  `normalizeViewState` byte-identical claim; OR amend the comment. Pick the omit-on-write fix.
- **QUAL-003:** document the split-state contract (runtime store maps are authoritative; `ws.minimized`/
  `ws.maximized` on the in-memory record are stale between save/load) in a prominent comment; mark
  `minimizePane` in `workspace-model.ts` as the pure-reducer/unit-test surface.
- **QUAL-005:** `WorkspaceView` `visible` `useMemo` (l.24-27) — remove the blanket
  `eslint-disable react-hooks/exhaustive-deps` by passing only the fields used (or split
  `computeVisibleLayout(layout, minimizedIds)`), so the linter polices future changes.
- **QUAL-006:** add a doc-comment to `chipStatus`/`ChipStatus` explaining it exists as the stable,
  unit-testable REQ-005 surface (prevents future inlining/over-engineering).
- **QUAL-007:** add `'toggle-minimize-pane'` to `TIP_COMMANDS` (`keybindings.ts:144`) for
  discoverability parity with `toggle-maximize-pane`.

---

## Sequencing summary (iteration 2)

```
TASK-001 (schema/migration, pure)
  ├─ TASK-002 (pure reducers)
  └─ TASK-014 (load-path mutual exclusion, pure)          [CODEX-002]
        └─ TASK-003 (store wiring)
              ├─ TASK-004 (off-layout reflow mechanism)    [core]
              │     ├─ TASK-011 (same-window buffered transit)   [CODEX-001 — core fix]
              │     ├─ TASK-012 (explorer view-state bridge)     [DA-001]
              │     ├─ TASK-018 (host geometry)                  [DA-002]
              │     └─ TASK-007 (tray + chips + empty state)
              │           ├─ TASK-008 (a11y chips)
              │           ├─ TASK-015 (portalled pane-menu focus/hover)  [UX-001]
              │           ├─ TASK-016 (tray pointer-events)              [QOL-001]
              │           └─ TASK-019 (exited chip state)                [DA-003]
              ├─ TASK-005 (toolbar + context-menu) ── TASK-017 (ctx-menu chord)  [QUAL-002]
              ├─ TASK-006 (keybinding + dispatch)
              ├─ TASK-013 (runtime mutual exclusion + focus)   [SEC-001/QOL-002]
              └─ TASK-009 (cross-ws move / undock + debounce flush)  [DA-004]
TASK-020 (LOW quality cleanup)  ── with the functional tasks
TASK-010 (docs + decisions.md + baseline)  ── after all functional tasks
```

## Risk notes (iteration 2)

- **TASK-011 (same-window buffered transit)** is the highest-risk fix: it must REUSE the multi-window
  `transit`/`replayInto` machinery (not a parallel buffer), arm same-window without re-owning the pane
  (C5), and compose the snapshot stash with the gap-byte replay without duplication. REQ-003's
  output-during-transition e2e is the proof obligation.
- **TASK-013 + TASK-014** must use the SAME minimize-wins precedence on both the runtime and load paths,
  matching `minimizePane`, so a pane can never be persisted or loaded in both states.
- **TASK-018** trades a fixed full-body host for tile-accurate geometry; verify it does not regress the
  single-pane full-body re-adopt (no-resize) case while fixing the multi-tile double-repaint.

## Open issues (under-specified REQs)

None. Every REQ-001..019 maps to ≥1 TASK (see `traceability.md`); the spec is frozen and unchanged.
