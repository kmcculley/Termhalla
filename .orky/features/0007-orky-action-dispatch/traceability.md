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

**Loopback (ESC-003, 2026-07-01):** FINDING-SEC-001 (CLI-argument-injection via unguarded `--`-prefixed
`feature`/`decision`/`escalationId`/`evidence` values reaching raw gatekeeper-CLI argv) added TEST-283..
TEST-290 to `tests/shared/orky-action-validate.test.ts`, mapped below into the EXISTING REQ-005, REQ-007,
and REQ-014 rows (no new REQ-ID; see `04-tests.md`'s "Loopback (ESC-003)" section for the full rationale
and RED-verification output).

**Loopback (ESC-004, 2026-07-01):** FINDING-DA-001 (the `OrkyActionQueue` REQ-015 serialization guard is
keyed by the RAW `featureDir`/`projectRoot` string, not `normalizeProjectRoot(...)`, so two concurrent
mutating calls submitted with a case/slash-divergent — but REQ-004-accepted — `projectRoot` spelling for
the SAME physical feature do not serialize) added TEST-291..TEST-294 to
`tests/main/orky-action-dispatcher.test.ts`, mapped below into the EXISTING REQ-015 row (no new REQ-ID;
see `04-tests.md`'s "Loopback (ESC-004)" section for the full rationale and RED-verification output).

**Loopback (ESC-006, 2026-07-02):** FINDING-CODEX-001 (a feedback-emit exit-0 whose parsed stdout itself
reports `{ok:false, mode:'noop'}` was silently misdiagnosed as a disabled channel — `resolveEscalation`
fell back to gatekeeper, `submitWork` reported `feedback-disabled` — instead of surfacing `ok:false,
errorKind:'cli-error'`) added TEST-295..TEST-300 across `tests/shared/orky-action-result-codex-001-regression.test.ts`
and `tests/main/orky-action-dispatcher-codex-001-regression.test.ts`. Fixed in `mapCliRunToResult`
(`src/shared/orky-action-result.ts`), which now inspects the parsed `ok` field before any mode branching.
The subsequent FINDING-DA-004 devils-advocate loopback then amended REQ-006/REQ-007's normative text and
Acceptance blocks in place (ESC-006 ok-precedence rule) to cite this evidence; both REQs' Acceptance blocks
now name TEST-295/297/299 (REQ-006) and TEST-298/300 (REQ-007), which are folded below into the EXISTING
REQ-006/REQ-007 rows (no new REQ-ID) alongside REQ-002/REQ-011's existing TEST-295..TEST-300 mapping — see
`04-tests.md`'s "Loopback (ESC-006)" section and `findings.json`'s FINDING-CODEX-001/FINDING-DA-004 for the
full rationale, RED-verification output, and spec-amendment text.

| REQ | Summary | TASK(s) | TEST(s) | Files (primary) |
|---|---|---|---|---|
| REQ-001 | 4-action dispatch service + IPC surface, no push | TASK-008, TASK-009, TASK-010 | TEST-197, TEST-198, TEST-250, TEST-271, TEST-279, TEST-281 | `orky-action-dispatcher.ts`, `ipc-contract.ts`, `register-orky-action.ts` |
| REQ-002 | Uniform discriminated `OrkyActionResult`; feedback-path first-class | TASK-001, TASK-006, TASK-008 | TEST-184, TEST-186, TEST-234, TEST-235, TEST-177 | `types.ts`, `orky-action-result.ts`, `orky-action-dispatcher.ts` |
| REQ-003 | Sender validation on every handler | TASK-010 | TEST-272, TEST-273, TEST-274, TEST-275, TEST-276, TEST-278 | `register-orky-action.ts` |
| REQ-004 | Server-side root allowlist vs `OrkyRegistry.roots()` | TASK-008 | TEST-229, TEST-230, TEST-248 | `orky-action-dispatcher.ts`, `orky-registry.ts` |
| REQ-005 | Feature-slug path confinement, server-built `featureDir` | TASK-002, TASK-008 | TEST-148..TEST-156, TEST-161, TEST-174, TEST-231, TEST-232, TEST-233, TEST-283..TEST-286 | `orky-action-validate.ts`, `orky-action-dispatcher.ts` |
| REQ-006 | `resolveEscalation`: feedback-first, gatekeeper fallback; ESC-006 ok-precedence over mode | TASK-008 | TEST-191, TEST-192, TEST-234, TEST-235, TEST-236, TEST-295, TEST-297, TEST-299 | `orky-action-dispatcher.ts` |
| REQ-007 | `submitWork`: feedback-only, disabled surfaced distinctly; ESC-006 ok-precedence over mode | TASK-008 | TEST-166, TEST-167, TEST-168, TEST-237, TEST-238, TEST-239, TEST-290, TEST-298, TEST-300 | `orky-action-dispatcher.ts` |
| REQ-008 | `recordHumanGate`: gate restricted server-side, never `--force` | TASK-008 | TEST-170..TEST-173, TEST-186, TEST-187, TEST-240..TEST-245 | `orky-action-dispatcher.ts` |
| REQ-009 | `driveStatus`: read-only next-action query | TASK-008 | TEST-193, TEST-194, TEST-246, TEST-247, TEST-248 | `orky-action-dispatcher.ts` |
| REQ-010 | CLI invocation: abortable + `unref()`'d + timeout, injection-safe | TASK-004, TASK-006 | TEST-178, TEST-179, TEST-211..TEST-217, TEST-249, TEST-250 | `orky-cli-runner.ts`, `orky-action-result.ts` |
| REQ-011 | Total exit-code + stdout-JSON mapping | TASK-006 | TEST-180..TEST-195, TEST-211, TEST-212, TEST-251 | `orky-action-result.ts` |
| REQ-012 | Orky CLI location resolution | TASK-003, TASK-008 | TEST-204..TEST-210, TEST-252..TEST-254 | `orky-cli-locate.ts`, `orky-action-dispatcher.ts` |
| REQ-013 | Append-only audit log, attributable — every outcome that REACHES THE DISPATCHER (success or a dispatcher-level rejection); `unknown-sender` (rejected pre-dispatcher, at the registrar) is NOT audited | TASK-005, TASK-008 | TEST-218..TEST-223, TEST-255..TEST-259 | `orky-action-audit.ts`, `orky-action-dispatcher.ts` |
| REQ-014 | Malformed/empty/boundary input tolerated | TASK-002 | TEST-157..TEST-163, TEST-165..TEST-168, TEST-170, TEST-173, TEST-175, TEST-177, TEST-239, TEST-245, TEST-260..TEST-263, TEST-287..TEST-289 | `orky-action-validate.ts` |
| REQ-015 | Per-featureDir serialization of mutating actions | TASK-007, TASK-008 | TEST-224..TEST-228, TEST-264..TEST-266, TEST-291..TEST-294 | `orky-action-queue.ts`, `orky-action-dispatcher.ts` |
| REQ-016 | Exactly 4 hard-coded subcommands; no pipeline-driving | TASK-008 | TEST-267, TEST-268 | `orky-action-dispatcher.ts` |
| REQ-017 | No renderer UI (scope guard) | TASK-011 | TEST-282 | `preload/index.ts` |
| REQ-018 | Per-domain registrar pattern; shared-file co-ownership (CONV-012) | TASK-001, TASK-009, TASK-010, TASK-011 | TEST-196, TEST-197, TEST-199..TEST-203, TEST-271, TEST-277, TEST-281 | `types.ts`, `ipc-contract.ts`, `register-orky-action.ts`, `preload/index.ts` |
| REQ-019 | Strictly no direct write under any `.orky/` tree | TASK-008 | TEST-269, TEST-270 | `orky-action-dispatcher.ts` |
| REQ-020 | Documentation reconciled | TASK-012 | TEST-280 | `docs/features/orky-action-dispatch.md`, `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` |

## Coverage check

20/20 REQs have ≥1 TASK and ≥1 TEST. No uncovered requirements. 153 TEST-IDs total (TEST-148…TEST-300):
151 `vitest` (`tests/shared/*`, `tests/main/*`, `tests/docs-feature-0007.test.ts`) + 2 Playwright e2e
(`tests/e2e/orky-action-dispatch.spec.ts`). The 8-test ESC-003 loopback addition (TEST-283..TEST-290, all
`vitest`, all in the pre-existing `tests/shared/orky-action-validate.test.ts`) is folded into REQ-005 (4
tests: feature-slug `--`-prefix rejection, standalone + end-to-end), REQ-014 (3 tests: decision/
escalationId/evidence `--`-prefix rejection), and REQ-007 (1 test: the negative/scope regression proving
submitWork's title/detail/phase are correctly NOT guarded) — no new REQ-ID. The 4-test ESC-004 loopback
addition (TEST-291..TEST-294, all `vitest`, all in the pre-existing `tests/main/orky-action-dispatcher.test.ts`)
is folded entirely into REQ-015 (3 fix-target tests, one per `OrkyActionQueue.run()` call site in the
dispatcher, plus 1 sanity/no-regression test) — no new REQ-ID. The 6-test ESC-006 loopback addition
(TEST-295..TEST-300, all `vitest`, in two new files —
`tests/shared/orky-action-result-codex-001-regression.test.ts` and
`tests/main/orky-action-dispatcher-codex-001-regression.test.ts`) is folded into REQ-002/REQ-011 (all 6:
the shared discriminated-result-shape and total exit-code/stdout-JSON-mapping requirements) and, following
FINDING-DA-004's spec amendment, additionally into REQ-006 (TEST-295/297/299, the resolveEscalation
ok-precedence and disabled-fallback acceptance) and REQ-007 (TEST-298/300, the submitWork ok-precedence
and feedback-disabled acceptance) — no new REQ-ID.
