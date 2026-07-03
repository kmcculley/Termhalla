# 0011 — Traceability matrix (regenerated at doc-sync, phase 7)

Regenerated from `traceability.json` (the mechanically-verified source of truth the Gatekeeper's
`traceability` gate checks). Every `REQ-NNN` below maps to the `TASK-NNN`(s) that implement it,
the `TEST-NNN`(s) that cover it, and the file(s) actually touched. Every listed `TEST-NNN` was
confirmed present as a real marker (`TEST-NNN` string) in its owning test file by direct grep at
doc-sync time (2026-07-03) — nothing here is asserted without having been checked against the
repo. `TEST-420`/`TEST-461`/`TEST-619` are frozen, pre-existing pins this feature relies on
byte-unchanged (co-owned load-bearing halves, not new tests).

| REQ | Tasks | Tests | Files |
|---|---|---|---|
| REQ-001 — pure, deterministic cockpit generator | TASK-001 | TEST-649, TEST-650, TEST-651, TEST-652, TEST-665, TEST-673 | `src/shared/orky-cockpit.ts` |
| REQ-002 — instantiation rides the shipped template seam; new workspace reported/survives pushes | TASK-003 | TEST-653, TEST-654, TEST-655, TEST-656, TEST-664, TEST-673, TEST-676, TEST-461 | `src/renderer/store.ts` |
| REQ-003 — single-gesture picker flow: palette + templates-menu, shared picker relabelled | TASK-005, TASK-006, TASK-007 | TEST-656, TEST-666, TEST-667, TEST-668, TEST-672, TEST-673, TEST-674, TEST-679, TEST-680, TEST-681, TEST-682, TEST-683 | `src/renderer/store.ts`, `src/renderer/App.tsx`, `src/shared/quick.ts`, `src/renderer/components/CommandPalette.tsx`, `src/renderer/components/TemplatesMenu.tsx` |
| REQ-004 — pre-selected-root path: picker skipped, membership-validated, 4-state honesty, queue-wired | TASK-004, TASK-008 | TEST-657, TEST-658, TEST-659, TEST-660, TEST-669, TEST-675 | `src/renderer/store.ts`, `src/renderer/components/DecisionQueuePanel.tsx` |
| REQ-005 — opened cockpit is a plain composition; no new fetch trigger | TASK-010 (verification) | TEST-664, TEST-665, TEST-673, TEST-678, TEST-679, TEST-683, TEST-420 | `src/shared/orky-cockpit.ts`, `src/renderer/store.ts` |
| REQ-006 — saveable/reusable/durable; shared template-instantiation seam repaired; no silent template write | TASK-002, TASK-003 | TEST-654, TEST-655, TEST-661, TEST-662, TEST-663, TEST-670, TEST-672, TEST-677, TEST-678 | `src/renderer/store/types.ts`, `src/renderer/store.ts`, `src/renderer/store/quick-slice.ts` |
| REQ-007 — composition-only scope guard: no new kind/schema/IPC/write path; one sanctioned seam repair | TASK-002, TASK-009 (verification) | TEST-663, TEST-670, TEST-671, TEST-619 | `src/renderer/store/types.ts`, `src/renderer/store.ts`, `src/renderer/store/quick-slice.ts` |

## Coverage confirmation

- 7/7 REQs (REQ-001…REQ-007) map to ≥1 TASK and ≥1 TEST. No uncovered requirements.
- TASK-009 and TASK-010 are verification-only passes (the 0009 TASK-018 precedent) — they produced
  no new shipped file but anchor REQ-007's and REQ-005's cross-cutting acceptance criteria.
- Test-id ranges: TEST-649…678 (the tests-gate design), TEST-679…683 (the ESC-001 review→tests
  loopback: FINDING-007's focus pins + FINDING-010's four-state cancel coverage), plus the frozen
  co-owned pins TEST-420 (`tests/renderer/orky-pane-slice.test.ts`), TEST-461
  (`tests/shared/orky-pane-template-coercion.test.ts`), and TEST-619
  (`tests/renderer/orky-entry-actions-loopback.test.ts`) — all reused byte-unchanged, all verified
  green in the full suite run at doc-sync time.
- e2e coverage: `tests/e2e/orky-cockpit.spec.ts` (TEST-673…678, witnessed 6/6 green against `out/`
  after the FINDING-008 test-authoring fixes) and `tests/e2e/orky-cockpit-loopback.spec.ts`
  (TEST-683, the FINDING-007 rendered focus pin, witnessed green after the fix).
- No frozen-guard supersession is scheduled by this feature (confirmed in `02-spec.md`'s
  frozen-guard inventory and re-confirmed by `04-tests.md`'s "Frozen-guard compatibility" section).
