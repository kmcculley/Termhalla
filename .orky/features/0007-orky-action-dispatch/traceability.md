# 0007 — Requirement → Task → Test traceability (Phase 3 plan / Phase 4 tests)

REQ → TASK → TEST matrix, the human-readable rendering of `traceability.json`. Every REQ (REQ-001…REQ-020)
maps to ≥1 TASK; the `traceability-plan` gate enforces this mechanically. The `TEST(s)` column was filled
in phase 4 ([`04-tests.md`](04-tests.md)) — see that doc for the full TEST-ID → assertion catalogue and the
reconciled judgment calls. **Re-verified 2026-07-01** against the corrected `02-spec.md` REQ-013 (ESC-001):
the previously-flagged REQ-013-vs-TASK-010 spec/plan wording conflict is now RESOLVED — a spec-writer applied
a narrow wording-only fix to REQ-013 (audit every dispatcher-level outcome, success or rejection; a sender
rejected at the IPC-registrar boundary per REQ-003 happens strictly before the dispatcher and is not
audited), which matches TASK-010's existing description verbatim. No REQ/TASK/TEST mapping below changed as
a result.

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | 4-action dispatch service + IPC surface, no push | TASK-008, TASK-009, TASK-010 | TEST-197, TEST-198, TEST-250, TEST-271, TEST-279, TEST-281 | `orky-action-dispatcher.ts`, `ipc-contract.ts`, `register-orky-action.ts` |
| REQ-002 | Uniform discriminated `OrkyActionResult`; feedback-path first-class | TASK-001, TASK-006, TASK-008 | TEST-184, TEST-186, TEST-234, TEST-235, TEST-177 | `types.ts`, `orky-action-result.ts`, `orky-action-dispatcher.ts` |
| REQ-003 | Sender validation on every handler | TASK-010 | TEST-272, TEST-273, TEST-274, TEST-275, TEST-276, TEST-278 | `register-orky-action.ts` |
| REQ-004 | Server-side root allowlist vs `OrkyRegistry.roots()` | TASK-008 | TEST-229, TEST-230, TEST-248 | `orky-action-dispatcher.ts`, `orky-registry.ts` |
| REQ-005 | Feature-slug path confinement, server-built `featureDir` | TASK-002, TASK-008 | TEST-148..TEST-156, TEST-161, TEST-174, TEST-231, TEST-232, TEST-233 | `orky-action-validate.ts`, `orky-action-dispatcher.ts` |
| REQ-006 | `resolveEscalation`: feedback-first, gatekeeper fallback | TASK-008 | TEST-191, TEST-192, TEST-234, TEST-235, TEST-236 | `orky-action-dispatcher.ts` |
| REQ-007 | `submitWork`: feedback-only, disabled surfaced distinctly | TASK-008 | TEST-166, TEST-167, TEST-168, TEST-237, TEST-238, TEST-239 | `orky-action-dispatcher.ts` |
| REQ-008 | `recordHumanGate`: gate restricted server-side, never `--force` | TASK-008 | TEST-170..TEST-173, TEST-186, TEST-187, TEST-240..TEST-245 | `orky-action-dispatcher.ts` |
| REQ-009 | `driveStatus`: read-only next-action query | TASK-008 | TEST-193, TEST-194, TEST-246, TEST-247, TEST-248 | `orky-action-dispatcher.ts` |
| REQ-010 | CLI invocation: abortable + `unref()`'d + timeout, injection-safe | TASK-004, TASK-006 | TEST-178, TEST-179, TEST-211..TEST-217, TEST-249, TEST-250 | `orky-cli-runner.ts`, `orky-action-result.ts` |
| REQ-011 | Total exit-code + stdout-JSON mapping | TASK-006 | TEST-180..TEST-195, TEST-211, TEST-212, TEST-251 | `orky-action-result.ts` |
| REQ-012 | Orky CLI location resolution | TASK-003, TASK-008 | TEST-204..TEST-210, TEST-252..TEST-254 | `orky-cli-locate.ts`, `orky-action-dispatcher.ts` |
| REQ-013 | Append-only audit log, attributable — every outcome that REACHES THE DISPATCHER (success or a dispatcher-level rejection); `unknown-sender` (rejected pre-dispatcher, at the registrar) is NOT audited | TASK-005, TASK-008 | TEST-218..TEST-223, TEST-255..TEST-259 | `orky-action-audit.ts`, `orky-action-dispatcher.ts` |
| REQ-014 | Malformed/empty/boundary input tolerated | TASK-002 | TEST-157..TEST-163, TEST-165..TEST-168, TEST-170, TEST-173, TEST-175, TEST-177, TEST-239, TEST-245, TEST-260..TEST-263 | `orky-action-validate.ts` |
| REQ-015 | Per-featureDir serialization of mutating actions | TASK-007, TASK-008 | TEST-224..TEST-228, TEST-264..TEST-266 | `orky-action-queue.ts`, `orky-action-dispatcher.ts` |
| REQ-016 | Exactly 4 hard-coded subcommands; no pipeline-driving | TASK-008 | TEST-267, TEST-268 | `orky-action-dispatcher.ts` |
| REQ-017 | No renderer UI (scope guard) | TASK-011 | TEST-282 | `preload/index.ts` |
| REQ-018 | Per-domain registrar pattern; shared-file co-ownership (CONV-012) | TASK-001, TASK-009, TASK-010, TASK-011 | TEST-196, TEST-197, TEST-199..TEST-203, TEST-271, TEST-277, TEST-281 | `types.ts`, `ipc-contract.ts`, `register-orky-action.ts`, `preload/index.ts` |
| REQ-019 | Strictly no direct write under any `.orky/` tree | TASK-008 | TEST-269, TEST-270 | `orky-action-dispatcher.ts` |
| REQ-020 | Documentation reconciled | TASK-012 | TEST-280 | `docs/features/orky-action-dispatch.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |

## Coverage check

20/20 REQs have ≥1 TASK and ≥1 TEST. No uncovered requirements. 135 TEST-IDs total (TEST-148…TEST-282):
133 `vitest` (`tests/shared/*`, `tests/main/*`, `tests/docs-feature-0007.test.ts`) + 2 Playwright e2e
(`tests/e2e/orky-action-dispatch.spec.ts`).
