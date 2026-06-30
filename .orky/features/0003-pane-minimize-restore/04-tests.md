# 0003 — Minimize / restore panes — Tests (Phase 4)

**Status:** test suite authored against the FROZEN [`02-spec.md`](02-spec.md) (REQ-001..019, C1–C5) and
[`03-plan.md`](03-plan.md) (TASK-001..010). Tests are written BEFORE any implementation and the suite
runs **RED**. Per ADR-009 these TESTs are frozen once the tests gate passes — the implementer conforms
to them and may not edit them.

## How to run

- **Unit (vitest, fast, headless):** `npm test` — the 23 unit tests below run now and are RED for want
  of implementation (missing `@shared/chip-status`, missing reducer exports in `@shared/workspace-model`,
  `SCHEMA_VERSION` still 6, missing `toggle-minimize-pane` command, missing docs).
- **e2e (Playwright-for-Electron):** `npm run build` then `npm run e2e`. The 12 e2e specs launch the
  real app against `out/`; they are RED until the feature ships. They typecheck cleanly today (verified
  with `tsc -p tsconfig.node.json` — zero errors in `tests/e2e/minimize-*`).

## Frozen test-id contract (asserted by the e2e)

`min-${paneId}` (toolbar) · `pane-menu-minimize` (context menu) · `min-tray-${wsId}` (tray container) ·
`min-chip-${paneId}` (chip) · `ws-empty-${wsId}` (all-minimized empty state) · `data-needs-input="1"`
(chip live-status marker). Existing: `max-${paneId}` (maximize toggle), `tile-${paneId}`,
`terminal-${paneId}`, `titlebar-${paneId}`, `save-workspace`.

## Frozen production contracts the implementer MUST satisfy (so these imports/assertions hold)

- `@shared/workspace-model` MUST export (or re-export) the pure reducers:
  - `minimizePane(ws, paneId): Workspace` — adds to `minimized` (idempotent; no-op on unknown/already-
    minimized; returns the **same ref** on no-op), clears `maximized` iff it equals `paneId`, keeps the
    pane in `panes`.
  - `restorePane(ws, paneId): Workspace` — removes from `minimized`; the resulting **visible layout**
    is a right-split `{ direction:'row', first:<prev visible layout>, second:paneId }`, or the sole leaf
    when the visible layout was empty; no-op (same ref) when not minimized/unknown.
  - `computeVisibleLayout(ws): MosaicNode | null` — `ws.layout` with every `minimized` leaf removed;
    `null` when all panes are minimized.
  - `movePane` and `removePane` MUST prune view-state: a moved/removed pane is dropped from `minimized`
    and clears `maximized` if it matched (no orphan / no dangling ref).
- `Workspace` gains persisted view-state holding **only** `minimized?: string[]` and
  `maximized?: string | null` (REQ-016). `SCHEMA_VERSION` → **7** with an explicit v6→v7 migration;
  `deserializeWorkspace` prunes dangling refs, tolerates malformed view-state (→ empty, no throw), and
  imposes **no cap**.
- `@shared/chip-status` MUST export `chipStatus({ state: TermState; recording: boolean; ai: boolean })`
  returning `{ state, needsInput, recording, ai }` (`needsInput === (state === 'needs-input')`).
- `@shared/keybindings` MUST add a `toggle-minimize-pane` command to `CommandId` + `COMMANDS` +
  `DEFAULT_BINDINGS` with a default `mod`-led chord; the toolbar/menu accelerator derives via
  `formatChord`.

## TEST-ID → REQ map

| TEST | Pins | REQ(s) | Kind | File |
|---|---|---|---|---|
| TEST-001 | `SCHEMA_VERSION === 7` (schema bump) | REQ-009 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-002 | prior-version record loads → empty view-state, no data loss | REQ-009 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-003 | dangling view-state paneId pruned on load; rest retained | REQ-009 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-004 | malformed view-state → empty, no throw (CONV-002) | REQ-009 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-005 | no silent cap — 30 minimized panes all retained (CONV-003) | REQ-009 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-006 | minimized flag round-trips serialize→deserialize | REQ-007 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-007 | maximized flag round-trips serialize→deserialize | REQ-008 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-008 | persisted view-state holds only ids/flags — no content/secrets | REQ-016 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-009 | minimize reflows: sibling fills; pane stays alive in `panes` | REQ-002 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-010 | `computeVisibleLayout` is `null` when all panes minimized | REQ-002, REQ-011 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-011 | restore into non-empty layout → right-split `{row,first,second}` | REQ-006 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-012 | restore into empty layout → sole leaf | REQ-006 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-013 | minimizing the maximized pane clears its maximize | REQ-010 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-014 | a minimized pane + a different maximized pane coexist | REQ-010 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-015 | minimize twice → single entry (idempotent) | REQ-017 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-016 | restore-non-minimized / unknown-id ops are no-ops (same ref) | REQ-017 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-017 | `removePane` (closePane path) prunes view-state — no orphan | REQ-017 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-018 | `movePane` clears the moved pane's minimized flag; rest intact | REQ-015 | unit | `tests/shared/minimize-view-state.test.ts` |
| TEST-019 | `chipStatus` maps idle\|busy\|needs-input → `needsInput` | REQ-005 | unit | `tests/shared/chip-status.test.ts` |
| TEST-020 | `chipStatus` reflects recording / AI toggles | REQ-005 | unit | `tests/shared/chip-status.test.ts` |
| TEST-021 | `toggle-minimize-pane` command exists; matches; label via `formatChord` | REQ-001, REQ-013 | unit | `tests/shared/minimize-keybinding.test.ts` |
| TEST-022 | rebinding the command changes the surfaced accelerator | REQ-013 | unit | `tests/shared/minimize-keybinding.test.ts` |
| TEST-023 | CHANGELOG/feature-doc/CLAUDE.md doc-drift reconciled | REQ-019 | unit | `tests/docs-feature-0003.test.ts` |
| TEST-024 | toolbar + context-menu minimize remove the tile, add a chip | REQ-001, REQ-018 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-025 | reflow geometry — survivor fills the body width | REQ-002, REQ-018 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-026 | minimized terminal stays alive: output accumulates; restore intact | REQ-003, REQ-018 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-027 | per-workspace tray: chip-per-pane, shown only ≥1, restore-on-click | REQ-004 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-028 | restore places the pane to the right (new last tile) | REQ-006 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-029 | last-pane all-minimized → `ws-empty-` empty state + chip restore | REQ-011 | e2e | `tests/e2e/minimize-restore.spec.ts` |
| TEST-030 | editor (draft) + explorer minimize/restore intact; affordance on all kinds | REQ-012 | e2e | `tests/e2e/minimize-uniform.spec.ts` |
| TEST-031 | minimized pane stays minimized across reload | REQ-007 | e2e | `tests/e2e/minimize-persistence.spec.ts` |
| TEST-032 | maximized pane stays maximized across reload (now persisted) | REQ-008 | e2e | `tests/e2e/minimize-persistence.spec.ts` |
| TEST-033 | a minimized pane blocking on input marks its chip needs-input | REQ-005 | e2e | `tests/e2e/minimize-tray-status.spec.ts` |
| TEST-034 | tray chips focusable, named, keyboard-activatable (Enter restores) | REQ-014 | e2e | `tests/e2e/minimize-tray-status.spec.ts` |
| TEST-035 | undock preserves minimized state without double-mounting the PTY | REQ-015 | e2e | `tests/e2e/minimize-undock.spec.ts` |

## Coverage check (every REQ → ≥1 TEST)

| REQ | TESTs | REQ | TESTs |
|---|---|---|---|
| REQ-001 | 021, 024 | REQ-011 | 010, 029 |
| REQ-002 | 009, 010, 025 | REQ-012 | 030 |
| REQ-003 | 026 | REQ-013 | 021, 022 |
| REQ-004 | 027 | REQ-014 | 034 |
| REQ-005 | 019, 020, 033 | REQ-015 | 018, 035 |
| REQ-006 | 011, 012, 028 | REQ-016 | 008 |
| REQ-007 | 006, 031 | REQ-017 | 015, 016, 017 |
| REQ-008 | 007, 032 | REQ-018 | 024, 025, 026 |
| REQ-009 | 001, 002, 003, 004, 005 | REQ-019 | 023 |
| REQ-010 | 013, 014 | | |

No coverage gaps.

## RED confirmation

`npx vitest run` over the five new unit files: **19 failed / 4 passed (23 total), exit 1**. The 4 that
pass now (TEST-002, TEST-006, TEST-007, TEST-008) are tolerance/round-trip/security guards that already
hold and stay valid post-implementation; REQ-007/008/009/016 each also have a RED test
(TEST-031/032, TEST-001/003/004/005, and the broader e2e), so every REQ is anchored RED. Failure reasons
are all want-of-implementation:

- `TypeError: minimizePane / restorePane / computeVisibleLayout is not a function` (TASK-002 reducers).
- `Cannot find module '@shared/chip-status'` (TASK-007 pure status map).
- `expected 6 to be 7` (SCHEMA_VERSION bump, TASK-001) and v7 fixtures tripping the current
  "newer than supported" guard (TASK-001 migration).
- `movePane` / `removePane` not yet pruning view-state.
- `toggle-minimize-pane` absent from the keybinding registry (TASK-006).
- docs not yet updated (TEST-023).

e2e specs require `npm run build` first and are expected RED at runtime (no minimize affordance / tray /
off-layout host exists yet). They were not executed in this phase (build + real-app launch); they
typecheck with zero errors.

## Characterization reconciliation (REQ-008 — maximize transient → persisted)

REQ-008 deliberately changes maximize view-state from **transient** to **persisted**. Searched the
characterization suite (`tests/characterization-*.test.ts`, CHAR-001..020): **no CHAR test asserts that
pane maximize is transient/non-persisted** — the only `maximized` references in tests are the unrelated
window-bounds `maximized` field. So no CHAR test must be edited. The remaining drift is documentary:
`CLAUDE.md` (the "Pane maximize hides siblings" gotcha says `transient (non-persisted)`) and
`.orky/baseline/architecture.md`. TEST-023 guards the CLAUDE.md reconciliation (asserts the phrase
`transient (non-persisted)` is gone) and the CHANGELOG/feature-doc updates; TASK-010 performs the
baseline-doc reconciliation. This is the deliberate, through-the-tests-phase change ADR-009 / the spec's
residual-risk note requires.

## Loop-back 1 (from implement)

Two test-authoring defects surfaced during implementation and were fixed surgically (no feature-0003
assertion weakened; the implementation already exists, so the touched tests now run GREEN):

1. **Stale cross-feature SCHEMA_VERSION assertion** — `tests/main/quick-store-toasts.test.ts` TEST-008
   (feature 0001's `quick-store-toasts` suite, NOT the feature-0003 minimize-persistence TEST-008 in the
   table above) still asserted `SCHEMA_VERSION === 6`. Feature 0003 REQ-009 / TEST-001 legitimately bumped
   the schema to 7 (`src/shared/types.ts`), so this older assertion became mutually exclusive with the
   bump. Corrected the expectation `6 → 7` and reworded the test title/comment so it pins the *current*
   SCHEMA_VERSION constant rather than claiming the additive `toastsEnabled` field is what holds the
   version fixed.
2. **e2e command never reached needs-input** — `tests/e2e/minimize-tray-status.spec.ts` TEST-033 typed
   bare `Read-Host`, which never prints a prompt that `src/main/status/needs-input.ts` recognizes, so the
   `data-needs-input="1"` chip assertion could never pass regardless of implementation. Replaced the typed
   command with the known-good prompt idiom copied from `tests/e2e/status.spec.ts`:
   `Write-Host -NoNewline "Overwrite? [y/N] "; $null = [Console]::ReadLine()`. The rest of TEST-033 is
   unchanged: it still minimizes the pane and asserts the chip carries `data-needs-input="1"` while
   off-layout.

## Loop-back 2 (from review)

Plan **iteration 2** (Option A — harden the remount path) added TASK-011..020 to close 7 blocking
findings (+ cheap non-blocking ones). The implementation of the hardening does NOT exist yet, so the
9 new tests below run **RED for want of implementation** (correct TDD); the pre-existing TEST-001..035
are unchanged and still pass (no assertion weakened — TEST-030's shallow explorer check is left intact
and *complemented* by the new TEST-038, not edited).

### New TEST-ID → REQ / finding map

| TEST | Pins | REQ(s) | Closes | Kind | File |
|---|---|---|---|---|---|
| TEST-036 | output emitted DURING the minimize↔restore unmount/remount GAP is buffered (same-window transit) and not dropped — a streamed counter stays contiguous across repeated toggles | REQ-003 | FINDING-CODEX-001 | e2e | `tests/e2e/minimize-hardening.spec.ts` |
| TEST-037 | a minimized pane in a MULTI-tile workspace still accumulates delayed output AND still marks needs-input on its chip (host-geometry / double-repaint path) | REQ-003, REQ-005 | FINDING-DA-002 | e2e | `tests/e2e/minimize-hardening.spec.ts` |
| TEST-038 | an Explorer pane with a SUBFOLDER expanded keeps it expanded across minimize/restore (child still rendered) — strengthens the top-level-only TEST-030 | REQ-012 | FINDING-DA-001 | e2e | `tests/e2e/minimize-hardening.spec.ts` |
| TEST-039 | a v7 record with the SAME pane id in both `minimized` and `maximized` loads mutual-exclusive (minimize wins; a DIFFERENT maximized pane is preserved) | REQ-010, REQ-009 | FINDING-CODEX-002 | unit | `tests/shared/minimize-persistence.test.ts` |
| TEST-040 | `chipStatus({…, exited:true})` returns `state:'exited'` (exited wins over idle/busy); omitting/`false` passes the live state through | REQ-005 | FINDING-DA-003 | unit | `tests/shared/chip-status.test.ts` |
| TEST-041 | toggle-maximize on a currently-minimized (focused) pane is a no-op — the survivor stays visible, the pane stays a chip (never in both maps) | REQ-010 | FINDING-SEC-001 (+QOL-002) | e2e | `tests/e2e/minimize-hardening.spec.ts` |
| TEST-042 | the portalled `pane-menu` is a member of the focus-visible AND hover styling allow-lists in `index.css` | REQ-014 | FINDING-UX-001 | unit | `tests/minimize-pane-menu-style.test.ts` |
| TEST-043 | a point in the tray strip BETWEEN/away-from chips hit-tests THROUGH to the reflowed terminal (`elementFromPoint` is not the tray container) | REQ-002, REQ-004 | FINDING-QOL-001 | e2e | `tests/e2e/minimize-hardening.spec.ts` |
| TEST-044 | the context-menu Minimize item's `title` carries the registry-derived chord (same as the toolbar) and updates after a rebind to `Ctrl+Shift+Y` | REQ-013 | FINDING-QUAL-002 | e2e | `tests/e2e/minimize-hardening.spec.ts` |

### Unit-vs-e2e choices (where the obligation allowed either)

- **TEST-040 (exited chip) — chose UNIT** over `@shared/chip-status`. An e2e that exits a minimized
  shell and reads `data-status` is feasible but slow/flaky; the pure mapping is the stable REQ-005
  surface (TASK-019 puts the state there). **Contract for the implementer:** `chipStatus` gains an
  OPTIONAL `exited?: boolean` (default false → existing callers/TEST-019/020 unaffected); when true the
  returned `.state` is `'exited'` and wins over idle/busy/needs-input. The chip surfaces it distinctly
  (the plan notes `data-status="exited"`; not asserted here since this is the unit test).
- **TEST-041 (runtime mutual exclusion) — chose E2E.** The precedence/guard lives in the store action
  `toggleMaximize` (TASK-013), not a pure reducer, and the store transitively imports `../api` (cannot
  be unit-tested under vitest per CLAUDE.md). The e2e reproduces the exact SEC-001 path (minimize the
  focused pane via `Ctrl+Shift+H`, then `Ctrl+Shift+M`) and asserts the observable invariant.
- **TEST-042 (portalled-menu focus/hover) — chose UNIT** (source-of-truth assertion over `index.css`).
  There is no existing runtime CONV-007 test to mirror, and `:focus-visible` needs real keyboard focus
  (flaky in computed-style probes). Mirroring the TEST-023 docs guard's read-the-source approach, it
  pins TASK-015's required edit deterministically (pane-menu present in the hover + focus-visible
  groups).
- **TEST-044 (context-menu chord) — chose E2E.** A component-level test is infeasible (PaneContextMenu
  imports the store/`../api`). The e2e proves both "derived not hard-coded" (title carries the toolbar's
  chord) and "tracks a rebind" (REQ-013) via the real keybindings-settings flow.

### New data-* / contract notes for the implementer

- No NEW e2e `data-*` markers are introduced beyond the frozen contract; TEST-036/037/038/041/043/044
  reuse `min-${paneId}`, `min-chip-${paneId}`, `tile-${paneId}`, `terminal-${paneId}`,
  `titlebar-${paneId}`, `pane-menu`, `pane-menu-minimize`, `min-tray-${wsId}`, `data-needs-input="1"`,
  and the keybindings-settings ids (`kb-change-…`, `kb-chord-…`).
- TEST-044 requires `pane-menu-minimize` to gain a `title` attribute derived via
  `formatChord(resolveBindings(quick.keybindings)['toggle-minimize-pane'])` (mirroring `PaneToolbar`).
- Default chords assumed by the e2e: minimize `Ctrl+Shift+H`, maximize `Ctrl+Shift+M`
  (`src/shared/keybindings.ts`).

### RED confirmation (Loop-back 2)

`npx vitest run` over the whole unit suite: **4 failed / 685 passed (3 files failed)** — the 4 failures
are exactly the new RED units: TEST-039 (load-path still keeps both fields), TEST-040 (chipStatus
ignores `exited`), and TEST-042 ×2 (pane-menu absent from the hover + focus-visible allow-lists). The
second cases of TEST-039/040 (different-maximized-preserved / live-state-passthrough) pass now and stay
valid post-implementation — every new REQ obligation is still anchored by ≥1 RED assertion. No
pre-existing test changed status. The new e2e specs (`minimize-hardening.spec.ts`) were not executed
(require `npm run build` + a real-app launch) but typecheck with zero errors
(`tsc -p tsconfig.node.json --noEmit`, exit 0; both new files confirmed in the compilation set).

## Loop-back 3 (from implement) — TEST-042 helper off-by-one fix

TEST-042 (`tests/minimize-pane-menu-style.test.ts`) was unsatisfiable due to a defect in its own
`groupBefore()` helper: `start = css.lastIndexOf(':is(', end)` where `end = css.indexOf(anchor)` and
each anchor itself begins with `:is(` — so `lastIndexOf` matched the anchor's own `:is(` at `end` and
`css.slice(end, end)` was always `''`, making `toContain('[data-testid="pane-menu"]')` impossible for
any CSS. Fixed to `lastIndexOf(':is(', end - 1)` so the helper skips the anchor's `:is(` and captures
the preceding allow-list group. No assertion weakened; the production fix (TASK-015 / FINDING-UX-001 —
`pane-menu` added to the hover/active/disabled/focus-visible allow-lists in `index.css`) was already
correctly applied and TEST-042 now passes (2/2) against it.
