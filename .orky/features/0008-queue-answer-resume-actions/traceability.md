# 0008 — Queue answer + resume actions — Traceability

REQ → TASK → TEST matrix, the human-readable rendering of `traceability.json`. Every REQ
(REQ-001…REQ-015) maps to ≥1 TASK and ≥1 real `TEST-NNN`; the `traceability` gate enforces both
mechanically — every referenced `TEST-NNN` id is verified present as an actual test-title marker in
the named file. Regenerated post-review (was a phase-3 planning stub with an empty tests column);
this revision reflects the final state after both loopbacks (the spec-gate revision and the
review-gate fix cycle — see `docs/superpowers/0008-queue-answer-resume-actions-review-followups.md`
for the full narrative).

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | Answer + resume actions per entry; every write exclusively through F7's existing bridges; zero new IPC/preload/main/CLI path | TASK-008, TASK-010 | TEST-597, TEST-602, TEST-607, TEST-608, TEST-619 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts`, `DecisionQueuePanel.tsx` |
| REQ-002 | Answer mode chosen from `status.reason` (escalation / human-review / stalled-no-answer) | TASK-003, TASK-008 | TEST-587, TEST-601, TEST-608, TEST-611 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts`, `DecisionQueuePanel.tsx` |
| REQ-003 | Escalation target identity-bound at display time via `registryDetail`, shown, re-verified at dispatch (amended, FINDING-003) | TASK-002 | TEST-588, TEST-589, TEST-590, TEST-591, TEST-608, TEST-612, TEST-622 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-004 | Inline answer input; request built from exactly identity + input, no smuggling | TASK-003, TASK-007 | TEST-592, TEST-608, TEST-611, TEST-620, TEST-621 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-005 | Resume = two honest parts: read-only next-action preview + resume-in-terminal (amended per coordinator Q1 resolution) | TASK-003, TASK-004 | TEST-593, TEST-596, TEST-604, TEST-607, TEST-608, TEST-609 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-006 | Every dispatch/launch tied to an explicit gesture, never an effect | TASK-003, TASK-004, TASK-010 | TEST-599, TEST-608, TEST-617, TEST-620 | `orky-entry-actions.tsx` |
| REQ-007 | Single-flight per (projectRoot, featureSlug, action), shared across every mounted instance (amended, FINDING-004/009) | TASK-001, TASK-005, TASK-007 | TEST-584, TEST-585, TEST-586, TEST-600, TEST-608, TEST-615 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-008 | Per-entry pending/result states, honest, keyed only on F7's own fields | TASK-005, TASK-007 | TEST-593, TEST-608, TEST-611, TEST-618, TEST-621, TEST-622 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-009 | Failure honesty classes: indeterminate / distinct-no-write / definite (amended, FINDING-006/007) | TASK-005, TASK-007 | TEST-594, TEST-595, TEST-596, TEST-605 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-010 | Detached outcome never silently dropped (toast chokepoint; gate released on settle) — contract blocker FINDING-012/015 fixed | TASK-006 | TEST-586, TEST-605, TEST-623 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts` |
| REQ-011 | Shared, F10-reusable action layer (`useOrkyEntryActions` + `OrkyEntryActions`) | TASK-001, TASK-007, TASK-008, TASK-010 | TEST-591, TEST-601, TEST-602, TEST-615 | `orky-entry-actions.tsx`, `orky-entry-actions-core.ts`, `DecisionQueuePanel.tsx` |
| REQ-012 | Keyboard operability + themed, accessible chrome | TASK-007, TASK-008 | TEST-606, TEST-608, TEST-616, TEST-617, TEST-618, TEST-620 | `orky-entry-actions.tsx`, `DecisionQueuePanel.tsx` |
| REQ-013 | Frozen-guard supersession (TEST-353/TEST-366) + additive ipc-contract/doc sweep | TASK-008, TASK-009, TASK-010, TASK-011 | TEST-598, TEST-613, TEST-614, TEST-353, TEST-366 | `decision-queue-panel-structure.test.ts`, `decision-queue.spec.ts`, `ipc-contract.ts`, docs, `CLAUDE.md`, `CHANGELOG.md` |
| REQ-014 | Resume-in-terminal: one gesture, one pane, `claude /orky:resume` at project root via the narrow `launchTerminalAt` store action (amended, FINDING-008/010) | TASK-004 | TEST-604, TEST-609, TEST-619 | `orky-entry-actions.tsx`, `store.ts`, `store/types.ts` |
| REQ-015 | Pointer isolation: an action-control click never fires the row's own click gesture (new, FINDING-001; the click twin of CONV-030/CONV-041) | TASK-007, TASK-008 | TEST-603, TEST-610, TEST-366 | `orky-entry-actions.tsx`, `DecisionQueuePanel.tsx` |

## Coverage check

All 15 requirements (REQ-001…REQ-015) map to at least one TASK and at least one real `TEST-NNN`.
Every listed `TEST-NNN` was verified present as an actual test-title marker in its named file
(`tests/renderer/orky-entry-actions-core.test.ts`, `orky-entry-actions-structure.test.ts`,
`orky-entry-actions-loopback.test.ts`, `decision-queue-panel-structure.test.ts`,
`tests/e2e/orky-queue-actions.spec.ts`, `orky-queue-actions-loopback.spec.ts`,
`decision-queue.spec.ts`), including the amended frozen pins `TEST-353` and `TEST-366` (retained
under `CONV-019`'s named-retirer discipline — feature 0008 named as the retiring/amending consumer
in each file's supersession note) and the amended in-place pins `TEST-593`/`TEST-604`/`TEST-605`/
`TEST-608` (amended byte-scoped to the specific finding each addressed; every other assertion in
those files stayed byte-unchanged — see `04-tests.md` "Named realizations + honest deferrals" for
the exact amendment log). No REQ left uncovered; no open blocking issue deferred (the two open
residuals, FINDING-021/022, are non-blocking LOWs — see the review follow-ups doc).

## Notes

- REQ-013 is the only REQ whose TASK set includes a **delegated, non-implementation-phase** task
  (TASK-009) — the designed CONV-019 retirement of TEST-353's `DecisionQueuePanel.tsx` clause plus
  the TEST-366 center-click tolerance check, owned by the test-designer at phase 4. Both amendments
  landed exactly as planned (byte-equivalent assertions, feature 0008 named as retirer).
- REQ-005 and REQ-014 are related but distinct: REQ-005 covers BOTH resume halves (preview +
  resume-in-terminal), while REQ-014 pins the resume-in-terminal mechanism's exact shape (amended at
  review to route through `launchTerminalAt` rather than the raw `commitPane` primitive — FINDING-008
  /FINDING-010). TASK-004 satisfies both.
- REQ-015 was NOT part of the original phase-3 plan draft — it was added at the spec gate
  (FINDING-001) after the pointer-isolation gap surfaced, and its TASK/TEST mapping was backfilled
  into TASK-007/TASK-008's scope rather than a new task, since the actions-region boundary
  `stopPropagation` lives in the same component work those tasks already covered.
- Two REQs (REQ-003, REQ-007) were substantively amended at the spec gate (identity-binding race,
  cross-instance single-flight) before the tests/plan phases ever ran against them — the traceability
  above reflects the FINAL, amended REQ text, not the original draft.
