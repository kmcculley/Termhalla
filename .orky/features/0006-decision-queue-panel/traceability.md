# 0006 — Decision-queue panel — Traceability (final, post doc-sync)

REQ → TASK → TEST matrix, the human-readable rendering of `traceability.json`. Every REQ (REQ-001…
REQ-019) maps to ≥1 TASK and ≥1 TEST; the `traceability` gate enforces this mechanically. Regenerated
in doc-sync to reflect both review-loopback rounds (TEST-368..374 landed; TEST-324 amended in place
per FINDING-020 — see `04-tests.md` "Review loopback (ESC-001)").

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | Window-scoped collapsible drawer, sibling of `NotesPanel`, not a pane kind | TASK-007, TASK-008 | TEST-330, TEST-344, TEST-359, TEST-365 | `App.tsx`, `DecisionQueuePanel.tsx` |
| REQ-002 | Three toggle surfaces (status bar, palette, rebindable keybinding `mod+shift+o`) | TASK-004, TASK-007, TASK-010, TASK-011 | TEST-325, TEST-326, TEST-327, TEST-328, TEST-329, TEST-354, TEST-355, TEST-360, TEST-365 | `keybindings.ts`, `App.tsx`, `StatusBar.tsx`, `CommandPalette.tsx` |
| REQ-003 | Renderer-only: one push subscription + one generation-guarded recovery pull, no new IPC | TASK-005, TASK-007 | TEST-331, TEST-337, TEST-353, TEST-357, TEST-358, TEST-361 | `registry-slice.ts`, `App.tsx` |
| REQ-004 | Queue membership = needs-a-human-now, reused `needsHuman`/`reason`, never re-derived | TASK-002 | TEST-301, TEST-302, TEST-303, TEST-367 | `decision-queue.ts` |
| REQ-005 | Grouping + deterministic cross-project ordering via the exported shared comparator | TASK-001, TASK-002, TASK-008 | TEST-304, TEST-305, TEST-306, TEST-307, TEST-308, TEST-346, TEST-374 | `orky-status.ts`, `decision-queue.ts`, `DecisionQueuePanel.tsx` |
| REQ-006 | Identical aggregate in → identical DOM order out (pure function of the snapshot) | TASK-002, TASK-008 | TEST-306, TEST-309, TEST-310, TEST-374 | `decision-queue.ts`, `DecisionQueuePanel.tsx` |
| REQ-007 | Badge count = list count: one selector, one number | TASK-002, TASK-005, TASK-008, TASK-010 | TEST-311, TEST-339, TEST-356, TEST-361, TEST-365 | `decision-queue.ts`, `registry-slice.ts`, `DecisionQueuePanel.tsx`, `StatusBar.tsx` |
| REQ-008 | Value-identical pushes cause zero re-renders (deep-equal short-circuit + memoization) | TASK-005, TASK-008 | TEST-332, TEST-333, TEST-339 | `registry-slice.ts`, `DecisionQueuePanel.tsx` |
| REQ-009 | Click-to-focus the MRU matching pane in this window via a pure cwd-first shared matcher, candidate AVAILABILITY gated (not a fallback chain) | TASK-003, TASK-006, TASK-009 | TEST-313, TEST-314, TEST-315, TEST-316, TEST-317, TEST-318, TEST-319, TEST-320, TEST-321, TEST-322, TEST-323, TEST-324 (amended, FINDING-020), TEST-341, TEST-342, TEST-343, TEST-352, TEST-366, TEST-368, TEST-369, TEST-370 | `decision-queue.ts`, `store.ts`, `store/types.ts`, `store/internals.ts`, `DecisionQueuePanel.tsx` |
| REQ-010 | Pane-less fallback: "open terminal here" via the existing `commitPane`/`launchDir` path, keyboard-activatable | TASK-009 | TEST-351, TEST-367, TEST-369, TEST-371, TEST-372 | `DecisionQueuePanel.tsx` |
| REQ-011 | Explicit loading state + missed-push recovery, generation-guarded | TASK-005, TASK-007, TASK-008 | TEST-337, TEST-338, TEST-340, TEST-345, TEST-357, TEST-361, TEST-365 | `registry-slice.ts`, `App.tsx`, `DecisionQueuePanel.tsx` |
| REQ-012 | Empty state: "nothing needs you", distinct from error | TASK-008 | TEST-340, TEST-345, TEST-365 | `DecisionQueuePanel.tsx` |
| REQ-013 | Error state: registry unavailable / malformed push, total tolerance, stale-valid retained, full per-feature field validation | TASK-005, TASK-008 | TEST-303, TEST-312, TEST-334, TEST-335, TEST-336, TEST-338, TEST-345, TEST-373, TEST-374 | `registry-slice.ts`, `DecisionQueuePanel.tsx` |
| REQ-014 | Drawer + toggle accessibility; coexistence with the notes drawer; nested-interactive keyboard activation | TASK-008, TASK-010 | TEST-348, TEST-349, TEST-354, TEST-365, TEST-371, TEST-372 | `DecisionQueuePanel.tsx`, `StatusBar.tsx` |
| REQ-015 | Entry content: verbatim aggregate data + stable `(projectRoot, featureSlug)` identity | TASK-008 | TEST-301, TEST-346, TEST-347, TEST-365 | `DecisionQueuePanel.tsx` |
| REQ-016 | Theme-aware, minimal presentation via existing CSS variables | TASK-008 | TEST-350 | `DecisionQueuePanel.tsx` |
| REQ-017 | Scope guard: strictly read-only, chrome-only, nothing persisted | TASK-005, TASK-009, TASK-012 | TEST-330, TEST-344, TEST-353, TEST-358, TEST-362, TEST-367 | `registry-slice.ts`, `DecisionQueuePanel.tsx` |
| REQ-018 | Documentation reconciled (feature doc, CLAUDE.md link, CHANGELOG, baseline reconcile) | TASK-014 | TEST-364 | `docs/features/decision-queue.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |
| REQ-019 | Supersede F5's TEST-070 scope guard, at the tests phase, never silently (delegated boundary) | TASK-013 | TEST-362, TEST-363 | `tests/shared/registry-no-renderer-ui.test.ts` |

## Coverage check

All 19 requirements (REQ-001…REQ-019) map to at least one TASK and at least one TEST. No REQ left
uncovered; no open issue deferred (see `03-plan.md` "Open issues" — none).

## Review-loopback deltas (ESC-001, `04-tests.md` "Review loopback")

- **REQ-009** — TEST-324 amended in place (FINDING-020: candidate AVAILABILITY is gated by
  `selectPaneCandidates`; the first available candidate is decisive — a valid non-matching candidate
  never falls through to the next signal); TEST-368/369/370 added (availability-set vectors, the
  cd'd-out discriminating vector, and the panel's own use of the `selectPaneCandidates` seam).
- **REQ-010/014** — TEST-371/372 added (FINDING-008: the pane-less fallback's Tab/Enter keyboard
  activation, structurally and via packaged e2e).
- **REQ-005/006/013** — TEST-373/374 added (FINDING-021: full consumed-field admission validation
  and NaN-hardened group ordering).

## Complexity flags (from `03-plan.md`)

- REQ-002 — 4 tasks (three independent UI surfaces + the shared keybinding registration they all read).
- REQ-007 — 4 tasks (one selector defined once, consumed by two components, wired through the store).
