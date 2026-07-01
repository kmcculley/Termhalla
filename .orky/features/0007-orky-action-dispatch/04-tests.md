# 0007 — Orky action-dispatch substrate — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-020) and `03-plan.md`
(TASK-001…TASK-012). All test files below are **FROZEN once the tests gate passes (ADR-009)** — the
implementer makes them pass without editing them. Test IDs continue the project-wide TEST-NNN sequence
from where 0005 left off (TEST-001…TEST-147 already used across the repo) at **TEST-148**, running through
**TEST-282** (135 tests total: 133 `vitest` + 2 Playwright e2e).

The test designer is a different actor from the implementer (the integrity boundary). No production code
(`src/`) was written by this phase — only test files (all under `tests/`), this document, and
`traceability.json`/`.md` updates.

## Chosen contracts (the spec/plan were prose-only on internal module shapes — these tests freeze them)

The spec's "Public interface" section is authoritative for the IPC-facing shapes (`orkyAction:*` channels,
`OrkyActionResult`, the four request types) and is matched exactly. Internal module shapes were prose-only
in the plan; this suite pins the simplest contract consistent with that prose, the codebase's existing
conventions (`CloudStatusService`'s constructor-injection style, `atomic-write.ts`'s `AtomicFs`
dependency-injection pattern, `OrkyRegistry.exclusive()`'s promise-chain queue), and — where the plan's own
prose was internally inconsistent — a reconciliation that keeps every REQ's literal acceptance criterion
reachable (see "Reconciled judgment calls" below):

1. **`src/shared/orky-action-validate.ts`** (TASK-002):
   ```ts
   validateFeatureSlug(slug: unknown): {ok:true; slug:string} | {ok:false; error:string}
   validateResolveEscalationRequest(input: unknown): {ok:true; req:ResolveEscalationRequest} | {ok:false; error:string}
   validateSubmitWorkRequest(input: unknown): {ok:true; req:SubmitWorkRequest} | {ok:false; error:string}
   validateRecordHumanGateRequest(input: unknown): {ok:true; req:RecordHumanGateRequest} | {ok:false; error:string}
   validateDriveStatusRequest(input: unknown): {ok:true; req:DriveStatusRequest} | {ok:false; error:string}
   ```
   **`gate` is validated here ONLY for shape** (non-empty string) — the `{brainstorm,human-review}` SET
   restriction is a SEPARATE, dispatcher-level business rule returning the distinct `errorKind:
   'gate-not-allowed'` (see "Reconciled judgment calls" #1). `verdict` stays fully enum-checked here
   (`'pass'|'fail'`, malformed → `invalid-args`, per REQ-008's own last sentence).

2. **`src/shared/orky-action-result.ts`** (TASK-006) — also the single home of `DEFAULT_CLI_TIMEOUT_MS`
   (15s), imported by `orky-cli-runner.ts` so the shared, pure module never depends on a main-process one:
   ```ts
   export const DEFAULT_CLI_TIMEOUT_MS = 15_000
   type CliRun = { exitCode: number | null; stdout: string; timedOut: boolean }
   mapCliRunToResult(action: 'resolveEscalation'|'submitWork'|'recordHumanGate'|'driveStatus',
                      cliKind: 'feedback'|'gatekeeper', run: CliRun): Partial<OrkyActionResult>
   ```

3. **`src/main/orky/orky-cli-locate.ts`** (TASK-003):
   ```ts
   locateOrkyCli(kind: 'gatekeeper'|'feedback', env?: NodeJS.ProcessEnv, exists?: (p:string)=>boolean): string | null
   describeMissingCli(kind: 'gatekeeper'|'feedback'): string
   ```

4. **`src/main/orky/orky-cli-runner.ts`** (TASK-004):
   ```ts
   runOrkyCli(cliPath: string, args: string[], opts?: {timeoutMs?: number; signal?: AbortSignal}):
     Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }>   // NEVER rejects
   ```
   `execFile(process.execPath, [cliPath, ...args], {timeout, windowsHide:true, maxBuffer, signal})`,
   `child.unref()`, argument ARRAY only (never `shell:true`).

5. **`src/main/orky/orky-action-audit.ts`** (TASK-005) — an **injectable append function** (mirrors
   `atomic-write.ts`'s `AtomicFs` injection, not `vi.spyOn`'ing a built-in module):
   ```ts
   type AppendFn = (file: string, line: string) => Promise<void>
   interface OrkyActionAuditRecord {
     ts: number; windowId: number | null; action: string; projectRoot: string; feature?: string
     argsSummary: Record<string, unknown>; ok: boolean; path: 'feedback'|'gatekeeper'|null
     dispatched: boolean; errorKind?: string; exitCode?: number | null
   }
   class OrkyActionAuditLog {
     constructor(baseDir: string, appendFn?: AppendFn)
     append(record: OrkyActionAuditRecord): Promise<void>   // NEVER throws/rejects
   }
   ```
   File: `join(baseDir, 'orky-actions.jsonl')`. **`argsSummary` redaction shape** (plan risk note #3,
   resolved here): structural fields (`feature`/`gate`/`verdict`/`escalationId`/`phase`) are copied
   verbatim; free-text human-authored fields (`decision`/`title`/`detail`/`evidence`) are captured as
   `<field>Length: number` ONLY, never the raw text.

6. **`src/main/orky/orky-action-queue.ts`** (TASK-007):
   ```ts
   class OrkyActionQueue {
     run<T>(featureDir: string, fn: () => Promise<T>): Promise<T>
     size(): number   // test-only introspection, mirrors OrkyRootEngine.getConsumers()'s precedent
   }
   ```

7. **`src/main/orky/orky-action-dispatcher.ts`** (TASK-008):
   ```ts
   type RunCli = (cliPath: string, args: string[], opts?: {timeoutMs?:number; signal?:AbortSignal}) =>
     Promise<{ exitCode: number | null; stdout: string; timedOut: boolean }>
   type LocateOrkyCli = (kind: 'gatekeeper'|'feedback') => string | null
   interface OrkyActionDispatcherDeps {
     registry: { roots(): string[] }       // the SAME app-wide OrkyRegistry instance (feature 0005)
     auditLog: OrkyActionAuditLog
     queue: OrkyActionQueue
     runCli?: RunCli                        // default: the real runOrkyCli
     locateOrkyCli?: LocateOrkyCli           // default: the real locateOrkyCli bound to process.env
     now?: () => number                     // default: Date.now
   }
   class OrkyActionDispatcher {
     constructor(deps: OrkyActionDispatcherDeps)
     resolveEscalation(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
     submitWork(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
     recordHumanGate(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
     driveStatus(req: unknown, windowId?: number | null): Promise<OrkyActionResult>
     dispose(): void
   }
   ```
   `windowId` is an OPTIONAL 2nd positional arg (default `null`) threaded into the audit record — the
   registrar passes `e.sender.id`; REQ-001's "a harness invokes each handler" calls with just `req`.

8. **`src/main/ipc/register-orky-action.ts`** (TASK-010):
   ```ts
   registerOrkyAction(dispatcher: OrkyActionDispatcher, isKnownWindowSender?: (sender: WebContents) => boolean): Disposer
   ```
   Default predicate `() => true` (mirrors `registerRegistry`). A rejected sender returns the exact literal
   `{ ok:false, path:null, dispatched:false, errorKind:'unknown-sender', error:'rejected: sender is not a
   known app window' }` WITHOUT ever calling the dispatcher — no audit line results from this path (see
   "Reconciled judgment calls" #2, an ambiguity flagged rather than silently resolved).

## Reconciled judgment calls (pinned here, not left to the implementer)

1. **`gate` shape-vs-business-rule split (TASK-002 vs TASK-008).** TASK-002's prose lists `gate ∈
   {brainstorm,human-review}` as one of its own checks, but TASK-008 explicitly describes the dispatcher
   "ALSO independently re-check[ing] gate ∈ {brainstorm, human-review}... returning gate-not-allowed,
   distinct from invalid-args, when the shape was valid but the value is outside the allowed set" — which
   is only possible if the shared validator does NOT itself reject on set-membership (otherwise REQ-008's
   literal acceptance, "gate:'spec' ... returns gate-not-allowed", could never be reached — a value like
   `'spec'` would already have failed `invalid-args` one layer up). This suite pins TASK-008's resolution:
   `validateRecordHumanGateRequest` checks `gate` is a non-empty STRING only; the `{brainstorm,human-review}`
   restriction lives EXCLUSIVELY in the dispatcher. Pinned by TEST-171 (validator accepts `'spec'`
   shape-wise) + TEST-240/241 (dispatcher rejects it business-rule-wise).
2. **REQ-013 vs TASK-010: does an `unknown-sender` rejection get an audit line? — FLAGGED, not resolved
   silently.** REQ-013's acceptance text literally reads "after each of a rejected (unknown-sender /
   root-not-allowed) ... action, a new line exists in orky-actions.jsonl". But TASK-010's own prose is
   equally explicit the OTHER way: sender validation happens in the registrar, strictly BEFORE the
   dispatcher is ever called, and states outright "no audit-log entry is written for it either". These
   directly contradict each other, and resolving it either way changes what REQ-013 actually requires.
   This suite does NOT adjudicate it: `register-orky-action.test.ts` tests (TEST-272) assert the
   TASK-010-consistent behavior ("the dispatcher is NEVER invoked" for an unknown sender, hence no audit
   write is possible from dispatcher-owned code), and NO test anywhere asserts either "unknown-sender
   writes an audit line" or "unknown-sender never writes an audit line" as a REQ-013 requirement. REQ-013's
   own audit-log tests (TEST-255) instead use `root-not-allowed` — a rejection that DOES reach the
   dispatcher — as the unambiguous "rejected action still gets audited" example, satisfying the acceptance
   criterion's spirit without taking a side on the sender-rejection question. **Flagged for the coordinator
   in the final report; not resolved here.**
3. **Audit-log `argsSummary` redaction shape (plan risk note #3).** Pinned above in contract #5 — structural
   fields verbatim, free-text fields length-only. Tested by TEST-259.
4. **CLI-location config surface (plan risk note #1) and dispatcher disposal placement (risk note #4)** are
   NOT test-observable judgment calls (they only affect where a value comes from / which composition-root
   line calls `dispose()`) — no test in this suite takes a position on either; both are still open for the
   coordinator per the plan's own risk notes.

## Test catalogue

| TEST-ID | REQ(s) | File | Assertion |
|---|---|---|---|
| TEST-148 | REQ-005/014 | `tests/shared/orky-action-validate.test.ts` | Non-string slug → type-specific message. |
| TEST-149 | REQ-005/014 | same | Empty slug → distinct empty-specific message. |
| TEST-150 | REQ-005 | same | `'a/b'` (forward slash) rejected. |
| TEST-151 | REQ-005 | same | Backslash rejected with the same single-segment message. |
| TEST-152 | REQ-005 | same | `'../../etc'` traversal rejected. |
| TEST-153 | REQ-005 | same | Bare `'..'` rejected with a dedicated message. |
| TEST-154 | REQ-005 | same | `'C:foo'` drive-absolute (no separator) rejected. |
| TEST-155 | REQ-005 | same | Well-formed slug accepted, echoed verbatim. |
| TEST-156 | CONV-001 | same | All 6 FeatureSlug rejections carry unique messages. |
| TEST-157 | REQ-014 | same | `undefined` resolveEscalation input rejected, no throw. |
| TEST-158 | REQ-014 | same | Non-object primitive → request-shape message. |
| TEST-159 | REQ-014 | same | `{}` → `projectRoot is required`. |
| TEST-160 | REQ-014 | same | Non-string projectRoot → message distinct from "missing". |
| TEST-161 | REQ-005/014 | same | Malformed feature propagates `validateFeatureSlug`'s own message. |
| TEST-162 | REQ-014 | same | Empty escalationId vs empty decision → distinct messages. |
| TEST-163 | REQ-014 | same | Missing escalationId/decision → "is required", no throw. |
| TEST-164 | — | same | Well-formed resolveEscalation request round-trips exactly. |
| TEST-165 | REQ-014 | same | `undefined`/non-object submitWork input rejected, no throw. |
| TEST-166 | REQ-007/014 | same | Missing title → "title is required". |
| TEST-167 | REQ-007/014 | same | Empty title → message distinct from "missing". |
| TEST-168 | REQ-014 | same | Non-string detail/phase rejected; feature truly optional. |
| TEST-169 | — | same | Fully-populated submitWork request round-trips exactly. |
| TEST-170 | REQ-014 | same | Missing gate/verdict → distinct "is required" messages. |
| TEST-171 | REQ-008 | same | SHAPE-VALID-but-disallowed gate (`'spec'`) PASSES this validator (business rule lives in the dispatcher). |
| TEST-172 | REQ-008 | same | Malformed verdict (`'maybe'`) IS rejected here. |
| TEST-173 | REQ-014 | same | Non-string evidence rejected; evidence otherwise optional. |
| TEST-174 | REQ-005 | same | `feature` is REQUIRED for recordHumanGate (unlike submitWork). |
| TEST-175 | REQ-014 | same | Missing projectRoot/feature on driveStatus rejected, no throw. |
| TEST-176 | — | same | Well-formed driveStatus request round-trips exactly. |
| TEST-177 | CONV-001 | same | No validator returns a bare "error"/"invalid input" string across the whole matrix; every rejection ≥9 chars. |
| TEST-178 | REQ-010 | `tests/shared/orky-action-result.test.ts` | `timedOut:true` → cli-timeout, exitCode null, message names CLI kind + 15s. |
| TEST-179 | REQ-010 | same | `timedOut:true` wins even over valid-JSON stdout. |
| TEST-180 | REQ-011 | same | Empty stdout → cli-unparseable, notes 0 bytes. |
| TEST-181 | REQ-011 | same | Garbage stdout → cli-unparseable, notes byte length. |
| TEST-182 | REQ-011 | same | Valid JSON array → still cli-unparseable (not a plain object). |
| TEST-183 | REQ-011 | same | Valid JSON `null` → cli-unparseable. |
| TEST-184 | REQ-002/011 | same | feedback exit 0 → ok:true, exitCode 0, data verbatim. |
| TEST-185 | REQ-011 | same | Undocumented nonzero exit from feedback → defensive cli-error, CLI message surfaced. |
| TEST-186 | REQ-002/008/011 | same | `record` exit 0 → ok:true, data.passed===true. |
| TEST-187 | REQ-008/011 | same | `record` exit 1 (fail) → STILL ok:true, data.passed===false. |
| TEST-188 | REQ-011 | same | `record` exit 2 with `{error}` → cli-error, message verbatim. |
| TEST-189 | REQ-011 | same | `record` exit 2 with no `{error}` → specific default message. |
| TEST-190 | REQ-011 | same | `record` exit 5 (undocumented) → defensive cli-error naming the code. |
| TEST-191 | REQ-006/011 | same | `resolve-escalation` fallback exit 0 → ok:true, data = escalation object. |
| TEST-192 | REQ-006/011 | same | `resolve-escalation` fallback exit 2 → cli-error, CLI message verbatim. |
| TEST-193 | REQ-009/011 | same | `drive` exit 0 → ok:true, data = raw drive object unmodified. |
| TEST-194 | REQ-009/011 | same | `drive` exit 2 → cli-error. |
| TEST-195 | REQ-011 | same | Table-driven pass over every documented (cliKind,action,exitCode) branch. |
| TEST-196 | REQ-018 | `tests/shared/orky-action-ipc-contract.test.ts` | Exact 4 `orkyAction:*` channel name strings. |
| TEST-197 | REQ-001/018 | same | 4 values unique; no collision; none share the read-only `orky:` prefix. |
| TEST-198 | REQ-001 | same | No push-channel comment on any orkyAction CH line; no `onOrkyAction*` exists. |
| TEST-199 | REQ-018 | same | `orkyResolveEscalation(req): Promise<OrkyActionResult>` declared (source-grep). |
| TEST-200 | REQ-018 | same | `orkySubmitWork(...)` declared. |
| TEST-201 | REQ-018 | same | `orkyRecordHumanGate(...)` declared. |
| TEST-202 | REQ-018 | same | `orkyDriveStatus(...)` declared. |
| TEST-203 | REQ-018 | same | The 4 request types + `OrkyActionResult` imported from `@shared/types`, not redeclared. |
| TEST-204 | REQ-012 | `tests/main/orky-cli-locate.test.ts` | `ORKY_PLUGIN_DIR` unset → null for both kinds. |
| TEST-205 | REQ-012 | same | Set + existing cli.js → absolute joined path. |
| TEST-206 | REQ-012 | same | Set + missing cli.js → null, never a guessed path. |
| TEST-207 | REQ-012 | same | Correct kind subdirectory resolved; gatekeeper/feedback never cross. |
| TEST-208 | REQ-012 | same | Default `exists` checks the REAL filesystem. |
| TEST-209 | REQ-012 | same | `describeMissingCli` names the kind + ORKY_PLUGIN_DIR + "could not be located". |
| TEST-210 | REQ-012 | same | feedback-kind message distinct from gatekeeper-kind message. |
| TEST-211 | REQ-011 | `tests/main/orky-cli-runner.test.ts` | Real stub exits 0 with JSON → `{exitCode:0,...,timedOut:false}`. |
| TEST-212 | REQ-011 | same | Real stub exits 2 with error JSON → resolves (never rejects on nonzero exit). |
| TEST-213 | REQ-010 | same | Real stub sleeping past timeoutMs → resolves timedOut within ~timeout+ε, never waits out the sleep. |
| TEST-214 | REQ-010 | same | Aborting via `AbortSignal` resolves timedOut, never rejects/hangs. |
| TEST-215 | REQ-010 | same | Shell-metacharacter arg preserved byte-for-byte as ONE argv element (no shell interpretation). |
| TEST-216 | REQ-010 | same | Source-grep: `execFile(`, no `shell:true`, has `.unref()`. |
| TEST-217 | REQ-010 | same | `DEFAULT_CLI_TIMEOUT_MS` is a positive, sane default. |
| TEST-218 | REQ-013 | `tests/main/orky-action-audit.test.ts` | `append()` writes one JSON-parseable line matching the record. |
| TEST-219 | REQ-013 | same | Two sequential appends → two lines in call order. |
| TEST-220 | REQ-013 | same | `windowId:null` round-trips as null. |
| TEST-221 | REQ-013 | same | Default appendFn is a pure append (prior bytes never rewritten). |
| TEST-222 | REQ-013 | same | Injected failing appendFn logged (console.error) but `append()` resolves. |
| TEST-223 | REQ-013/CONV-003 | same | 50 sequential appends → all 50 lines present, none capped. |
| TEST-224 | REQ-015 | `tests/main/orky-action-queue.test.ts` | Same-key calls run strictly sequentially. |
| TEST-225 | REQ-015 | same | `run()` resolves/rejects pass-through the wrapped fn. |
| TEST-226 | REQ-015 | same | A rejecting call never poisons the next queued call on the same key. |
| TEST-227 | REQ-015 | same | Different-key calls overlap in time (never serialize against each other). |
| TEST-228 | REQ-015 | same | `size()` grows while in-flight, prunes back to 0 once settled. |
| TEST-229 | REQ-004 | `tests/main/orky-action-dispatcher.test.ts` | Un-allowlisted root → root-not-allowed, zero CLI calls. |
| TEST-230 | REQ-004 | same | Case/slash-divergent spelling of an allowlisted root accepted. |
| TEST-231 | REQ-005 | same | Malformed slug (`'a/b'`) → invalid-args via the dispatcher, zero CLI calls. |
| TEST-232 | REQ-005 | same | Well-formed slug, nonexistent feature dir → feature-not-found, zero CLI calls. |
| TEST-233 | REQ-005 | same | Valid slug resolves to the correct absolute featureDir (asserted via the CLI args actually sent). |
| TEST-234 | REQ-002/006 | same | Feedback-enabled fixture: emits, NEVER touches gatekeeper, `path:feedback,feedback:enabled,dispatched:true`; exact emit args pinned. |
| TEST-235 | REQ-002/006 | same | Feedback-disabled fixture: emits THEN falls back to gatekeeper resolve-escalation; exact fallback args pinned. |
| TEST-236 | REQ-006 | same | Fallback exit 2 (unknown escalation) → cli-error, CLI message verbatim, path:gatekeeper. |
| TEST-237 | REQ-007 | same | Feedback-enabled submitWork → dispatched:true, ok:true. |
| TEST-238 | REQ-007 | same | Feedback-disabled submitWork → DISTINCT failure (ok:false, feedback-disabled, dispatched:false); NO gatekeeper fallback ever called. |
| TEST-239 | REQ-007/014 | same | Missing/empty title → invalid-args BEFORE any emit call. |
| TEST-240 | REQ-008 | same | `gate:'spec'` → gate-not-allowed, zero CLI calls. |
| TEST-241 | REQ-008 | same | `gate:'implement'` → gate-not-allowed too. |
| TEST-242 | REQ-008 | same | `--force` NEVER appended; full args array pinned. |
| TEST-243 | REQ-008 | same | `verdict:'pass'` (exit 0) → ok:true, data.passed===true. |
| TEST-244 | REQ-008 | same | `verdict:'fail'` (exit 1) → ok:true (not error), data.passed===false. |
| TEST-245 | REQ-008/014 | same | Malformed verdict (`'maybe'`) → invalid-args, zero CLI calls. |
| TEST-246 | REQ-009 | same | Returns raw drive object, dispatched:false, ok:true. |
| TEST-247 | REQ-009 | same | `.orky/` tree byte-identical (content+mtime) before/after driveStatus. |
| TEST-248 | REQ-004/009 | same | Un-allowlisted root rejected BEFORE the CLI runs. |
| TEST-249 | REQ-010 | same | Timed-out CLI resolves the action (never hangs) as cli-timeout. |
| TEST-250 | REQ-001/010 | same | `dispose()` aborts in-flight AbortController(s); pending action still resolves. |
| TEST-251 | REQ-011 | same | Non-JSON stdout end-to-end via the dispatcher → cli-unparseable (proves real wiring, not just the pure mapper). |
| TEST-252 | REQ-012 | same | Unresolved feedback CLI → orky-cli-not-found for resolveEscalation/submitWork, zero CLI calls. |
| TEST-253 | REQ-012 | same | Unresolved gatekeeper CLI → orky-cli-not-found for recordHumanGate/driveStatus, zero CLI calls. |
| TEST-254 | REQ-012 | same | No overrides at all (real default resolver) → orky-cli-not-found in this env (ORKY_PLUGIN_DIR unset). |
| TEST-255 | REQ-013 | same | A REJECTED action (root-not-allowed) appends one attributable audit line. |
| TEST-256 | REQ-013 | same | An ACCEPTED action appends one audit line (ok/path/dispatched/exitCode). |
| TEST-257 | REQ-013 | same | Simulated audit-write failure is best-effort; the dispatcher's own result is unaffected. |
| TEST-258 | REQ-013/CONV-003 | same | 10 sequential mixed calls → 10 audit lines, none dropped. |
| TEST-259 | REQ-013 | same | `argsSummary` redaction: free-text length-only, structural fields verbatim. |
| TEST-260 | REQ-014 | same | `undefined` on all 4 actions → invalid-args, zero CLI calls, no unhandled rejection. |
| TEST-261 | REQ-014 | same | `{}` on all 4 actions → invalid-args, zero CLI calls. |
| TEST-262 | REQ-014 | same | Non-string projectRoot (42) on all 4 actions → invalid-args. |
| TEST-263 | REQ-014 | same | Empty required field per action → invalid-args, 3 DISTINCT messages. |
| TEST-264 | REQ-015 | same | Two concurrent recordHumanGate calls on the SAME featureDir serialize (2nd CLI call awaits the 1st). |
| TEST-265 | REQ-015 | same | Concurrent mutating calls on TWO DIFFERENT featureDirs never serialize against each other. |
| TEST-266 | REQ-015 | same | `driveStatus` bypasses the queue — resolves promptly even while a same-featureDir mutation is in-flight. |
| TEST-267 | REQ-016 | same | Source-grep: only the 4 hard-coded subcommand literals appear; every forbidden subcommand absent. |
| TEST-268 | REQ-016 | same | An extra request field can never select a different subcommand. |
| TEST-269 | REQ-019 | same | Source-grep: no direct `writeFile`/`appendFile`/`rename`/`rm`/`unlink` in the dispatcher. |
| TEST-270 | REQ-019 | same | Integration proof: across all 4 actions on a real fixture, the ONLY fs write anywhere is the audit log under userData. |
| TEST-271 | REQ-001/018 | `tests/main/register-orky-action.test.ts` | `ipcMain.handle` registered for the exact 4 `orkyAction:*` channels. |
| TEST-272 | REQ-003 | same | Unknown sender rejected for ALL 4 handlers with the exact literal shape; dispatcher NEVER invoked. |
| TEST-273 | REQ-003 | same | Known sender delegates resolveEscalation(req, senderId). |
| TEST-274 | REQ-003 | same | Known sender delegates submitWork(req, senderId). |
| TEST-275 | REQ-003 | same | Known sender delegates recordHumanGate(req, senderId). |
| TEST-276 | REQ-003 | same | Known sender delegates driveStatus(req, senderId). |
| TEST-277 | REQ-018 | same | Disposer removes all 4 handlers. |
| TEST-278 | REQ-003 | same | `isKnownWindowSender` defaults to allow-all when omitted. |
| TEST-279 | REQ-001 | same | Zero `ipcMain.on` (push) listeners registered by this registrar. |
| TEST-280 | REQ-020 | `tests/docs-feature-0007.test.ts` | Feature doc, CLAUDE.md link, CHANGELOG `[Unreleased]`, `.orky/baseline/architecture.md` all reconciled. |
| TEST-281 | REQ-001/018 | `tests/e2e/orky-action-dispatch.spec.ts` | The 4 methods exist on `window.termhalla` and round-trip a well-formed `OrkyActionResult` against the real packaged app. |
| TEST-282 | REQ-017 | same | No element anywhere carries an `orky-action`-scoped test id (no new visible UI). |

## RED verification

```
npx vitest run
 Test Files  10 failed | 130 passed (140)
      Tests  13 failed | 888 passed (901)
exit code 1
```

All 10 new files fail for want-of-correction reasons — missing implementation modules, or (for the two
files whose imports already resolve against pre-existing shared files) assertions against not-yet-added
content:

- `tests/shared/orky-action-validate.test.ts`, `orky-action-result.test.ts`, `main/orky-cli-locate.test.ts`,
  `main/orky-cli-runner.test.ts`, `main/orky-action-audit.test.ts`, `main/orky-action-queue.test.ts`,
  `main/orky-action-dispatcher.test.ts`, `main/register-orky-action.test.ts` — `Cannot find module`/`Failed
  to load url` for the not-yet-created `src/shared/orky-action-*.ts` / `src/main/orky/orky-*.ts` /
  `src/main/ipc/register-orky-action.ts` modules (TASK-001…TASK-010 not done).
- `tests/shared/orky-action-ipc-contract.test.ts` — imports the REAL, already-existing `@shared/ipc-contract`
  module fine, but `CH.orkyActionResolveEscalation` etc. are `undefined` and the `TermhallaApi` method
  source-greps find nothing yet (TASK-009 not done).
- `tests/docs-feature-0007.test.ts` — `docs/features/orky-action-dispatch.md` does not exist yet
  (`readFileSync` ENOENT); CLAUDE.md/CHANGELOG/baseline greps also fail (TASK-012 not done).

`tests/e2e/orky-action-dispatch.spec.ts` was NOT run as part of this RED verification (Playwright e2e
requires `npm run build` first, per CLAUDE.md, and is out of scope for the vitest-based RED check) but was
verified by inspection: `window.termhalla.orky*` are not yet bound in `src/preload/index.ts`, so TEST-281
would fail with `orkyDriveStatus is not a function` inside the page — RED for the same want-of-correction
reason. TEST-282 (no new UI) would PASS today by construction (no such code exists yet) — a regression
guard for a property already true, matching the precedent of 0005's `registry-no-renderer-ui.test.ts`.

## Coverage check

Every REQ-001…REQ-020 acceptance criterion is covered by at least one TEST-ID — see `traceability.json`.
REQ-016's "code/review assertion" acceptance is covered as a source-grep test (TEST-267/268), matching the
precedent of 0005's TEST-096 and 0014's TEST-042/043. REQ-020 is covered by a doc-presence test
(TEST-280), matching the `tests/docs-feature-000N.test.ts` house pattern.
