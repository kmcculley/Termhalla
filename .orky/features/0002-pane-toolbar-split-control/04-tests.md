# 0002 — Pane toolbar cleanup + unified split-direction control — Tests (phase 4)

**Status:** tests authored (phase 4). FROZEN once the tests gate passes (ADR-009) — the implementer
fits code to these tests and may not edit them. Authored by the test-designer, a different actor from
the implementer (integrity boundary).

> **Phase-4 loop-back (REQ-014 reconciliation, post-implementation):** The implementation already
> landed in `src/`. The pre-existing e2e specs that drove a second pane / Record action via the
> *old* contract (`split-col-`, `split-terminal-`, `rec-${id}`) were reconciled to the **new**
> combined-popover + context-menu flow so they pass against the shipped code. A single shared helper
> `tests/e2e/split-helper.ts` (`splitSecondTerminal`) encapsulates the new flow (open `split-${id}` →
> `split-menu` visible → select Terminal kind → activate `split-dir-right-${id}`). No assertion of any
> reconciled spec changed — only HOW the second pane / Record action is triggered. The feature-0002
> frozen specs (TEST-006..024) are unchanged in intent; only the two known typecheck-cast nits in
> `split-compass.spec.ts` (TEST-007/TEST-012, `el.closest`/`e.getAttribute` inside `evaluate` on the
> DOM-less tests tsconfig) were adjusted to structural casts — assertions untouched.
>
> **Phase-7 doc-sync correction (FINDING-DOC-001):** This reconciliation was originally labelled
> `TEST-025`, but no test file carries that marker and `tests/` is frozen, so the id is not
> machine-verifiable. The reconciliation is real (the helper and reconciled specs exist), but it is
> recorded here as prose, not as a phantom test id. REQ-014 is covered by the existing
> **TEST-021/TEST-022/TEST-023** markers; `traceability.json` REQ-014 no longer cites TEST-025.

The suite currently runs **RED** against the unimplemented code: `splitDirToLayout` and `splitPane`'s
`position` arg do not exist; the combined compass popover (`split-dir-*` / `split-kind-*`), the
single split button, and the `pane-menu-record` item are not built yet. The default-after regression
pins (TEST-001, TEST-003) are intentionally GREEN now — they prove the persisted layout shape is
unchanged.

## How to run

- **Unit (vitest, headless):** `npm test` (include glob `tests/**/*.test.ts`). Covers TEST-001..005
  (`tests/shared/split-direction.test.ts` — the before/after + `splitDirToLayout` units; the frozen
  `02-spec.md` REQ-008 acceptance names `tests/shared/workspace-model.test.ts`, but the units actually
  live in `split-direction.test.ts` — `traceability.json`/`.md` is authoritative for the gate; see
  FINDING-DOC-002) and TEST-024 (`tests/docs-feature-0002.test.ts`).
- **E2E (Playwright-for-Electron):** `npm run build` then `npm run e2e`. Covers TEST-006..023 across
  `tests/e2e/split-compass.spec.ts`, `tests/e2e/pane-record-menu.spec.ts`,
  `tests/e2e/split-menu.spec.ts`, `tests/e2e/pane-actions.spec.ts`, plus the REQ-014 reconciled
  pre-existing specs (driven through `tests/e2e/split-helper.ts`).

Each test carries its `TEST-NNN` id in its `describe`/`test` name so the Gatekeeper can confirm it
exists.

## Test files

| File | Layer | Tests |
|---|---|---|
| `tests/shared/split-direction.test.ts` | vitest (pure) | TEST-001..005 |
| `tests/docs-feature-0002.test.ts` | vitest (doc guard) | TEST-024 |
| `tests/e2e/split-compass.spec.ts` | Playwright e2e | TEST-006..017 |
| `tests/e2e/pane-record-menu.spec.ts` | Playwright e2e | TEST-018..020 |
| `tests/e2e/split-menu.spec.ts` (rewritten, REQ-014) | Playwright e2e | TEST-021, TEST-022 |
| `tests/e2e/pane-actions.spec.ts` (maximize test updated, REQ-014) | Playwright e2e | TEST-023 |
| `tests/e2e/split-helper.ts` + reconciled specs (smoke, broadcast, ui-polish, notepad, persistence, run-commands, workspace-templates, recording) | Playwright e2e (REQ-014 loop-back) | _(no marker — prose only; see FINDING-DOC-001; REQ-014 covered by TEST-021/022/023)_ |

## TEST → REQ map and assertions

| TEST | REQ(s) | Asserts |
|---|---|---|
| TEST-001 | REQ-008, REQ-009 | `splitPane` with NO `position` arg still equals `{direction, first: target, second: new}` (default-after regression pin; legacy call sites/persisted shape unchanged). **GREEN now.** |
| TEST-002 | REQ-008, REQ-007 | `position: 'before'` makes the new pane the parent's `first` and target its `second`. |
| TEST-003 | REQ-008 | Explicit `position: 'after'` equals the default output. **GREEN now.** |
| TEST-004 | REQ-008 | `'before'` on a deep non-root leaf inserts as that subtree's `first`, leaves the rest untouched, and the serialize→deserialize round-trip + `SCHEMA_VERSION` are unchanged. |
| TEST-005 | REQ-005, REQ-007, REQ-008, REQ-009 | `splitDirToLayout` maps `right→{row,after}`, `down→{column,after}`, `left→{row,before}`, `up→{column,before}` (all four inputs). |
| TEST-006 | REQ-003, REQ-013 | Exactly one `split-${id}` button; `split-col-${id}` count 0; clicking opens `split-menu` and does NOT change the tile count (no commit on open). |
| TEST-007 | REQ-004 | `split-menu` is portalled to `<body>` — `el.closest('.mosaic-tile')` is null (not clipped inside the source tile). |
| TEST-008 | REQ-005 | All four `split-dir-{up,left,right,down}-${id}` are visible + enabled, both with a single pane and after a prior split (≥2 panes). |
| TEST-009 | REQ-006, REQ-004 | Three kind options + four directions on one popover simultaneously; Terminal is the initially selected kind (aria-checked/aria-pressed true), the others unselected. |
| TEST-010 | REQ-006 | `split-kind-explorer-${id}` is disabled for a (seeded) editor pane with no cwd, and enabled for a terminal pane once its shell reports a cwd. |
| TEST-011 | REQ-007 | Select Editor kind, activate `split-dir-right` → 2 tiles, exactly one editor pane and still exactly one terminal (no extra shell). |
| TEST-012 | REQ-007, REQ-009 | Select Terminal kind, activate `split-dir-left` → 2 tiles where the new pane is ordered BEFORE the source (source is the second DOM tile). |
| TEST-013 | REQ-010 | Keyboard: focus `split-${id}`, Enter opens; `split-dir-right` is focused (default highlight); Enter commits → 2 tiles. |
| TEST-014 | REQ-010 | Keyboard: ArrowDown moves the highlight to `split-dir-down` (focused); Enter commits → 2 tiles. |
| TEST-015 | REQ-010 | Esc closes the popover (`split-menu` count 0) and leaves the tile count unchanged. |
| TEST-016 | REQ-011 | Each `split-dir-*` exposes an `aria-label` naming its direction; each `split-kind-*` exposes its name + a checked/pressed state attribute. |
| TEST-017 | REQ-012 | Opening the new popover over an editor pane (asserting the new `split-kind-*` contract) then dismissing it leaves Monaco model-switching working (`.view-lines` updates on tab switch) — no editor-tabs sibling-box regression. |
| TEST-018 | REQ-001, REQ-013 | `rec-${id}` has count 0 in the pane toolbar. |
| TEST-019 | REQ-002 | Right-click a terminal title bar → `pane-menu-record` labelled "Start recording"; clicking it (closes menu) then re-opening shows "Stop recording" (state round-trips through `recording`). |
| TEST-020 | REQ-002 | An editor pane's context menu has `pane-menu-record` count 0 (terminal-only). |
| TEST-021 | REQ-014, REQ-007 | (rewritten split-menu) Single split button opens one popover (no `split-col-`); selecting Editor alone does not commit; activating a direction commits one editor pane, still one terminal. |
| TEST-022 | REQ-014, REQ-007 | (rewritten split-menu) Explorer kind + a downward direction opens an explorer pane rooted at the source cwd. |
| TEST-023 | REQ-014 | (updated maximize test) Sibling split driven via select-Terminal-kind → activate-direction; maximize hides the sibling (visibility:hidden), restore brings it back. |
| TEST-024 | REQ-015 | CHANGELOG `[Unreleased]` documents (a) Record → pane context menu, (b) the unified split button + four-direction compass (up/down/left/right), (c) before/after insertion in `splitPane`. |
| _(reconciliation, no TEST id)_ | REQ-014 | (loop-back reconciliation — recorded as prose, FINDING-DOC-001, since no marker exists and `tests/` is frozen) The pre-existing e2e specs that previously drove a second pane via `split-col-`/`split-terminal-` and Record via `rec-${id}` now drive them through the new contract — `splitSecondTerminal` helper (open `split-${id}` → `split-menu` → Terminal kind → `split-dir-right-${id}`) for smoke/broadcast/ui-polish/notepad/persistence/run-commands/workspace-templates, and the title-bar context-menu `pane-menu-record` start/stop for recording. Each spec's original intent (what it asserts about its own feature) is unchanged; only the trigger mechanism moved to the new contract. No reconciled spec references `split-col-`/`split-row-`/`split-terminal-`/`split-editor-`/`split-explorer-`/`rec-${id}`. REQ-014's gate coverage is the existing TEST-021/022/023 markers. |

## Notes on contract choices (frozen)

- **Highlight = focus.** REQ-010 says "focus moves into the compass and the right direction is the
  initial highlighted target." TEST-013/014 assert the highlighted direction target via
  `toBeFocused()` (roving-tabindex model). The implementer must move DOM focus onto the highlighted
  `split-dir-*` element.
- **Selected kind exposure.** REQ-006/REQ-011 require the chosen kind to be assertable; TEST-009/016
  accept either `aria-checked="true"` or `aria-pressed="true"` on the selected `split-kind-*`.
- **Direction accessible name.** TEST-016 reads `aria-label` on each `split-dir-*` and requires it to
  contain the direction word (e.g. "Split up").
- **REQ-009 store threading** is pinned via the pure `splitDirToLayout` mapping the store uses
  (TEST-005) plus the observable before-insertion DOM ordering (TEST-012); the renderer store helpers
  (`placePane`/`commitPane` in `store/internals.ts`/`store.ts`) import `../api` and so per CLAUDE.md
  cannot be imported under vitest's node env — they are exercised end-to-end instead.

## RED confirmation (vitest layer)

`npx vitest run tests/shared/split-direction.test.ts tests/docs-feature-0002.test.ts` → **9 failed,
2 passed** (non-zero exit). Representative failures: `TypeError: splitDirToLayout is not a function`
(TEST-005), `expected { first: 'p1', second: 'p2' } to deeply equal { first: 'p2', second: 'p1' }`
(TEST-002 before-insertion), and the three CHANGELOG doc-guard assertions (TEST-024). The two passing
are the default-after regression pins (TEST-001, TEST-003), which prove the persisted shape is
unchanged. The e2e layer is RED by construction (the `split-dir-*`/`split-kind-*`/`pane-menu-record`
testids and the single split button do not exist yet).

## GREEN confirmation (post-implementation, REQ-014 loop-back)

After the implementation landed, the reconciled suite is GREEN against `src/`:
- `npm run typecheck` — clean.
- `npm test` (vitest) — 656 passed / 99 files.
- `npm run build` then `npm run e2e` — all feature-0002 specs and the REQ-014 reconciled specs pass
  (smoke, broadcast, ui-polish, notepad, persistence, run-commands, workspace-templates, recording,
  split-compass TEST-006..017, pane-record-menu TEST-018..020, split-menu TEST-021/022,
  pane-actions TEST-023). The only e2e failures are nine pre-existing specs unrelated to this feature
  (clipboard ×5 — the documented clipboard-redirector contention on this box —, edit-menu-settings
  TEST-018 toasts, env-per-terminal, env-vars, focus); they reproduce identically in isolation on a
  clean run, share no code with the reconciliation (no `split-helper`/split/`rec-` usage), and are
  not regressions from this loop-back.
