# 0010 — Traceability matrix (Phase 3, regenerated at doc-sync)

Machine-checkable source of truth: `traceability.json`. This is its human-readable rendering,
regenerated at the doc-sync (phase 7) gate against the shipped tests and implementation — every
`tests` cell below is a real TEST-NNN id verified present as a marker in its named test file
(vitest `.test.ts` structural/loopback pins, or Playwright `.spec.ts` e2e pins run against the
built app; frozen F8/F9 pins reused byte-unchanged are included where they carry a REQ's load).

| REQ | Description (short) | Tasks | Tests | Files |
|---|---|---|---|---|
| REQ-001 | Mount F8's `OrkyEntryActions` in F9's reserved slot per row, keyed on row identity; no fork | TASK-002 | TEST-624, TEST-632, TEST-633, TEST-607 | `src/renderer/components/OrkyPane.tsx` |
| REQ-002 | Escalation id binds from the pane's already-held detail; zero display-time pulls when supplied, submit-verify pull retained | TASK-002 | TEST-625, TEST-632, TEST-635, TEST-588, TEST-591, TEST-612 | `src/renderer/components/OrkyPane.tsx` |
| REQ-003 | Pane-header inject affordance opens F12's capture pre-targeted to the pane's root, no picker | TASK-003 | TEST-626, TEST-634, TEST-639, TEST-646 | `src/renderer/components/OrkyPane.tsx` |
| REQ-004 | Scope: read-only-except-via-F7/F12; every action gesture-tied, no new IPC/preload/main surface | TASK-002, TASK-003, TASK-004 | TEST-627, TEST-632, TEST-633, TEST-634, TEST-433, TEST-494 | `src/renderer/components/OrkyPane.tsx`, `src/shared/ipc-contract.ts` |
| REQ-005 | Cross-instance single-flight (pane + queue mounts of the same target): one dispatch, shared pending/refusal; hidden-at-settle outcome delivery | TASK-002, TASK-004 | TEST-636, TEST-585, TEST-608, TEST-615, TEST-640, TEST-648 | `src/renderer/components/OrkyPane.tsx`, `src/renderer/components/orky-entry-actions.tsx`, `src/renderer/components/orky-entry-actions-core.ts` |
| REQ-006 | CONV-046: a data-driven reason flip disarms the open answer form (shared component fix, fixes F8 FINDING-022); draft-lost notice + focus fallback | TASK-001 | TEST-630, TEST-637, TEST-598, TEST-599, TEST-601, TEST-641, TEST-642, TEST-643, TEST-647 | `src/renderer/components/orky-entry-actions.tsx` |
| REQ-007 | Tile-context UX: CONV-041/042/043/044 hold inside a mosaic tile row; slot shrinks, header wraps | TASK-002, TASK-004 | TEST-629, TEST-632, TEST-438, TEST-638, TEST-646 | `src/renderer/components/OrkyPane.tsx`, `src/renderer/components/orky-entry-actions.tsx` |
| REQ-008 | The pane's F9 read contract survives: row identity, states, displayed-escalation agreement | TASK-002 | TEST-628, TEST-632, TEST-428, TEST-429, TEST-430, TEST-442, TEST-453, TEST-454 | `src/renderer/components/OrkyPane.tsx` |
| REQ-009 | Frozen-guard supersession (TEST-433) + doc read-only claim corrections, deliberate and atomic | TASK-005, TASK-006 | TEST-433, TEST-631, TEST-503, TEST-613, TEST-614, TEST-644, TEST-645 | `tests/renderer/orky-pane-structure.test.ts`, `docs/features/orky-pane.md`, `src/renderer/components/OrkyPane.tsx`, `CHANGELOG.md` |

## Coverage

Every REQ-001…REQ-009 maps to at least one TASK, at least one real TEST-NNN (verified present as a
marker in its file), and the file(s) it touches. No uncovered requirements.

- TASK-005 is a deliberately delegated, non-implementation boundary marker (owner: test-designer,
  phase 4) — recorded per the 0009 TASK-019 precedent so REQ-009 has a traceability anchor without
  an implementation-phase edit to a frozen guard.
- Bold-in-04-tests.md ids (TEST-624…637 phase 4, TEST-638…648 the ESC-001 tests loopback) are new
  F10-owned pins; the rest are frozen F8/F9 pins reused byte-unchanged as a REQ's load-bearing
  co-owned half (REQ-002/REQ-005/REQ-006/REQ-007/REQ-008/REQ-009 all cite at least one).
- The ESC-001 loopback (FINDING-016) amended the argv-log READ SITES in three e2e files (this
  feature's `orky-pane-actions.spec.ts` and, per CONV-012 co-ownership, F8's
  `orky-queue-actions.spec.ts` / `orky-queue-actions-loopback.spec.ts`) to a handshake-aware
  `readActionLog` helper — the amendment is a call-site swap, not an assertion-intent change; every
  TEST-NNN id and its normative claim listed above is unchanged.
- e2e run evidence (2026-07-03, against the implement-gate build): `orky-pane-actions.spec.ts`
  5/6 passed (TEST-632/634/635/636/637 green; TEST-633 fails on FINDING-017's build-environment
  prerequisite — node-pty's native binding, not a code defect); `orky-pane-actions-loopback.spec.ts`
  3/3 passed; the co-owned `orky-queue-actions.spec.ts` + loopback 7/9 passed (TEST-608/612 —
  the pins F10's REQ-002/REQ-005 require byte-unchanged — witnessed green; TEST-609/610 share
  FINDING-017's environment class). The full vitest gate (202 files) passes clean except the
  intentionally-red frozen-until-fixed pins already resolved by this feature's implement phase.
