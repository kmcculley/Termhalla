# 0007 — Orky action-dispatch substrate — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-020, 20 REQs). TASK-IDs below are
stable — never renumber. This is Termhalla's first write-capable IPC surface (D1: never drives the
pipeline; every mutation happens inside an Orky CLI child process, never a direct `.orky/` write —
REQ-019). No renderer UI ships in this feature (D1/REQ-017).

## Architecture fit (brownfield — `.orky/baseline/` present)

Reuses, does not reinvent:

- `OrkyRegistry.roots()` (`src/main/orky/orky-registry.ts`, feature 0005) — the server-side project-root
  allowlist (D3/REQ-004). F7 constructs its dispatcher with a reference to the SAME app-wide `OrkyRegistry`
  instance already built in `services.ts`; it does not read `orky-registry.json` itself.
- `normalizeProjectRoot` (`src/main/orky/validate-root.ts`, CONV-010) — the shared case/slash-folding
  comparison key, reused verbatim for allowlist membership matching (REQ-004) so this feature never forks a
  second normalizer.
- `register-registry.ts`'s sender-validation + disposer pattern — `isKnownWindowSender(e.sender)` gate per
  handler, `wm.isKnownWindowSender` passed for real by the composition root, a predicate defaulting to
  allow-all only for handler-level unit/integration tests that omit it (REQ-003).
- `src/main/cloud/probe.ts`'s abortable/`unref()`'d `execFile` pattern (`{timeout, windowsHide:true,
  maxBuffer, signal}`, `child.unref()`) — the exact shape the CLI-runner (TASK-004) mirrors for
  injection-safety (argument array, never `shell:true`) and non-hang-on-timeout (REQ-010).
- `OrkyRegistryStore`/`QuickStore`'s atomic-write discipline is NOT reused for the audit log (REQ-013 is
  explicitly an APPEND-only JSONL file, never a rewrite — `fs.appendFile`, not `atomicWrite`), but the
  "normalize + never throw on read" discipline of those stores informs the audit writer's own
  best-effort-never-fails contract.
- `OrkyRegistry`'s `exclusive()` per-instance mutation-serialization queue (a promise chain) is the pattern
  TASK-007 (REQ-015) mirrors, generalized to be keyed PER `featureDir` (a `Map<featureDir, Promise<unknown>>`)
  rather than one single chain, since unrelated feature dirs must NOT serialize against each other.
- `services.ts`'s existing `orkyEngine`/`orkyRegistry` single-instance-construct-and-dispose pattern is
  mirrored for the new `OrkyActionDispatcher` instance (TASK-009).

## No renderer UI (D1/REQ-017)

This plan adds shared types, the `orkyAction:*` IPC surface, the main-process dispatcher service, the CLI
runner, the audit log, and the preload/`api.ts` bridge — and explicitly NO React component, button, or
badge. F8/F10/F12 are later consumers.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Shared action types (`OrkyActionPath`, `OrkyFeedbackState`, `OrkyActionErrorKind`, `OrkyActionResult`, the 4 request types) | `src/shared/types.ts` | new (additive) |
| Pure request validation (REQ-005/REQ-014) | `src/shared/orky-action-validate.ts` | new |
| Pure exit-code/stdout-JSON → `OrkyActionResult` mapping (REQ-002/REQ-011) | `src/shared/orky-action-result.ts` | new |
| Orky CLI location resolver (REQ-012) | `src/main/orky/orky-cli-locate.ts` | new |
| Abortable/`unref()`'d CLI-runner (REQ-010) | `src/main/orky/orky-cli-runner.ts` | new |
| Append-only audit-log writer (REQ-013) | `src/main/orky/orky-action-audit.ts` | new |
| Per-`featureDir` mutation serialization queue (REQ-015) | `src/main/orky/orky-action-queue.ts` | new |
| Dispatcher service (the 4 actions; composes all of the above + `OrkyRegistry.roots()`) | `src/main/orky/orky-action-dispatcher.ts` | new |
| IPC channel constants + `TermhallaApi` additions | `src/shared/ipc-contract.ts` | edit |
| `orkyAction:*` registrar | `src/main/ipc/register-orky-action.ts` | new |
| Composition root (construct dispatcher once, dispose wiring) | `src/main/ipc/register.ts`, `src/main/services.ts` | edit |
| Preload bridge (no UI) | `src/preload/index.ts` | edit |
| Docs / changelog / baseline reconcile | `docs/features/orky-action-dispatch.md` (new), `CLAUDE.md`, `CHANGELOG.md`, `.orky/baseline/architecture.md` | new/edit |

## The CLI-location resolver — pragmatic default (REQ-012, open question #1)

`src/main/orky/orky-cli-locate.ts` exposes ONE function, `locateOrkyCli(kind: 'gatekeeper' | 'feedback',
env = process.env): string | null`, used by every action needing a CLI (TASK-005) — never duplicated.
Resolution order, in priority:

1. **Explicit override** — an env var `ORKY_PLUGIN_DIR` (checked first: `join(env.ORKY_PLUGIN_DIR, kind,
   'cli.js')`, existence-checked with `existsSync` before being trusted). This is deliberately an env var,
   not a `quick.json`/Settings field — F13 (Settings) may later add a UI to *set* this same env var's
   persisted equivalent, but that ownership question is explicitly left open (see Report); the resolver
   itself is a single swappable function so wiring a Settings-backed value in later is a one-line change at
   the call site, not a rewrite.
2. **Documented default** — no default path is assumed valid on an arbitrary machine (the intake's
   `C:/dev/Orky/plugin/...` is Kevin's machine only); the resolver's "default" is simply "no path" (returns
   `null`) when `ORKY_PLUGIN_DIR` is unset, so a fresh machine gets the honest `orky-cli-not-found` error
   (REQ-012 acceptance) rather than a guess that silently succeeds on one dev box and fails everywhere else.
3. Reject → `null`, mapped by the dispatcher to `{ok:false, path:null, dispatched:false,
   errorKind:'orky-cli-not-found', error:'the Orky <kind> CLI could not be located; set ORKY_PLUGIN_DIR to
   your Orky plugin directory'}` — never a throw, never a silent no-op (REQ-012 acceptance).

This keeps the feature functionally complete and testable (inject a fake env / fake `existsSync` in vitest)
without blocking on the F13 Settings-ownership question. Flagged for the coordinator in the report below.

## Determinism / injection contract

- `orky-action-dispatcher.ts`'s constructor takes an injected `runCli` (TASK-004's function type) and an
  injected `locateOrkyCli` (TASK-003), exactly the `op.ts`/`store/pane-ops.ts` injection pattern CLAUDE.md
  mandates — so the pure vitest suite (Definition of Done, phase 4) can stub CLI stdout/exit-code/delay
  without spawning a real process.
- `Date.now()` (audit-log `ts`) is injected as a `now: () => number` parameter, defaulting to `Date.now`,
  mirroring the existing pattern for testable timestamps elsewhere in the codebase (`orky-status.ts`).
- The result-mapping function (TASK-002) is pure: `(action, exitCode, stdout) => OrkyActionResult` shaped,
  with NO fs/IPC/clock access, so REQ-011's exit-code branches are exhaustively unit-testable in isolation.

---

## Tasks

### TASK-001 — Shared action types
**Satisfies:** REQ-001, REQ-002, REQ-018 · **Files:** `src/shared/types.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** additive only; no existing type's shape changes
- Add `OrkyActionPath`, `OrkyFeedbackState`, `OrkyActionErrorKind`, `OrkyActionResult` verbatim per the
  spec's Public Interface section.
- Add `ResolveEscalationRequest`, `SubmitWorkRequest`, `RecordHumanGateRequest`, `DriveStatusRequest`
  verbatim per the spec.
- No changes to any existing exported type; `SCHEMA_VERSION` untouched (this feature adds no persisted
  schema — the audit log is a plain JSONL file, not part of the migration chain, mirroring
  `orky-registry.json`'s own `version:1` precedent).

### TASK-002 — Pure request validation (REQ-005/REQ-014, CONV-002)
**Satisfies:** REQ-005, REQ-014 · **Files:** `src/shared/orky-action-validate.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure (no fs/IPC/clock); never throws; every
  rejection carries a DISTINCT, field-specific message (CONV-001)
- `validateResolveEscalationRequest(input: unknown)`, `validateSubmitWorkRequest`,
  `validateRecordHumanGateRequest`, `validateDriveStatusRequest` — each returns
  `{ok:true, req:<TypedRequest>} | {ok:false, error:string}` (never `errorKind` here; the dispatcher maps
  every validation failure to `errorKind:'invalid-args'` uniformly at the call site — keeps this module
  free of the `OrkyActionErrorKind` import for pure-logic minimalism, still testable standalone).
- Each validator checks: request is a non-null object; `projectRoot` present + non-empty string;
  `feature` (where required) present + non-empty string AND a single path segment — reject any value
  containing `/`, `\`, a literal `..` segment, or an absolute-path form (REQ-005's malformed-input list);
  action-specific required fields (`escalationId`+`decision` for resolveEscalation, non-empty `title` for
  submitWork, `gate` ∈ `{brainstorm,human-review}` + `verdict` ∈ `{pass,fail}` for recordHumanGate).
- `validateFeatureSlug(slug: unknown): {ok:true; slug:string} | {ok:false; error:string}` — the shared
  single-segment check reused by all three feature-scoped validators (REQ-005 acceptance: `'../../etc'`,
  `'a/b'`, an absolute path, and `''` each rejected with a distinct message — never a generic one).
- Every distinct rejection reason gets its own message (`'projectRoot is required'` vs `'projectRoot must be
  a string'` vs `'feature must be a single path segment (no / \\ or ..)'` vs `'gate must be one of
  brainstorm, human-review'`, etc.) — this is what REQ-014's "distinct actionable message per rejection"
  acceptance is graded against, so do not collapse branches into one shared string.

### TASK-003 — Orky CLI location resolver
**Satisfies:** REQ-012 · **Files:** `src/main/orky/orky-cli-locate.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** single shared function, no duplicated lookup; never throws
- `locateOrkyCli(kind: 'gatekeeper' | 'feedback', env?: Env, exists?: (p:string)=>boolean): string | null`
  per the "CLI-location resolver" section above (`ORKY_PLUGIN_DIR` env var → `join(dir, kind, 'cli.js')`
  existence-checked → else `null`). Injectable `env`/`exists` (mirrors `resolve-bin.ts`'s own signature) so
  it is unit-testable without touching the real filesystem/env.
- Exported alongside a `describeMissingCli(kind): string` helper producing the exact actionable message
  REQ-012 requires, reused by the dispatcher (TASK-005) for both `resolveEscalation`'s/`submitWork`'s
  `feedback` lookup and `recordHumanGate`'s/`driveStatus`'s `gatekeeper` lookup.

### TASK-004 — Abortable/`unref()`'d CLI-runner
**Satisfies:** REQ-010, REQ-011 · **Files:** `src/main/orky/orky-cli-runner.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** mirror `src/main/cloud/probe.ts`; argument array only,
  never `shell:true`; never rejects; `child.unref()`; timeout resolves (never hangs)
- `runOrkyCli(cliPath: string, args: string[], opts?: {timeoutMs?: number; signal?: AbortSignal}):
  Promise<{exitCode: number | null; stdout: string; timedOut: boolean}>` — `execFile(process.execPath,
  [cliPath, ...args], {timeout, windowsHide:true, maxBuffer, signal})`, argument array (never string
  concatenation — no shell-injection surface, REQ-010), `child.unref()` immediately after spawn, default
  timeout a named constant (e.g. `DEFAULT_CLI_TIMEOUT_MS = 15_000`).
- On a timeout/abort, Node's `execFile` callback fires with an error whose `.killed`/`.signal` indicates
  the process was killed — map that (and any non-numeric `err.code`) to `{exitCode: null, stdout: '',
  timedOut: true}`; a numeric `err.code` (thrown-CLI nonzero exit) maps to `{exitCode: err.code, stdout,
  timedOut: false}`; a clean exit maps to `{exitCode: 0, stdout, timedOut: false}`. The function itself
  NEVER rejects — always resolves (mirrors `runCliProbe`'s "never rejects" contract).
- No parsing/mapping to `OrkyActionResult` here — that is TASK-006's job; this module's only concern is
  "run this exact CLI + these exact args safely and hand back exit code + stdout".

### TASK-005 — Append-only audit-log writer
**Satisfies:** REQ-013 · **Files:** `src/main/orky/orky-action-audit.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** `fs.appendFile` only, never a rewrite; best-effort
  (never throws into the caller); no cap/rotation/truncation (CONV-003)
- `OrkyActionAuditLog` class, constructed with a `baseDir` (Electron `userData`), file
  `orky-actions.jsonl`.
- `async append(record: OrkyActionAuditRecord): Promise<void>` — `JSON.stringify(record) + '\n'` via
  `fs.appendFile` (atomic single-line append per REQ-013; explicitly NOT `atomicWrite`, which is a
  temp-then-rename REWRITE and would be wrong for an append-only log). On any write failure, `console.error`
  (or the app's existing logger) and swallow — the promise resolves regardless, so a disk-full audit-log
  write can never fail or alter the caller's returned `OrkyActionResult` (REQ-013 acceptance: "a simulated
  append failure is logged but the action still returns its normal result").
- `OrkyActionAuditRecord` type (declared here or re-exported from `src/shared/types.ts` if the dispatcher
  needs to import it too — planner's call: keep it main-process-only since audit records never cross IPC):
  `{ts: number; windowId: number | null; action: string; projectRoot: string; feature?: string; argsSummary:
  Record<string, unknown>; ok: boolean; path: OrkyActionPath; dispatched: boolean; errorKind?:
  OrkyActionErrorKind; exitCode?: number | null}`. `argsSummary` is a REDACTION-SAFE projection built by the
  dispatcher (TASK-006) — e.g. `decision`/`title`/`detail` text bodies are length-only (`{titleLength: 12}`),
  never the raw human-authored text, so the audit log cannot become an unbounded transcript dump (consistent
  with CLAUDE.md's "never dump conversation content" spirit, applied here to human-submitted decision/work
  text).
- No size limit/rotation logic in this task (REQ-013 explicitly forbids one without a stated, tested policy)
  — a future feature may add one; this task does not.

### TASK-006 — Pure exit-code/stdout-JSON → `OrkyActionResult` mapping
**Satisfies:** REQ-002, REQ-011 · **Files:** `src/shared/orky-action-result.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure; total over every exit-code branch; no throw
- `mapCliRunToResult(action: 'resolveEscalation'|'submitWork'|'recordHumanGate'|'driveStatus', cliKind:
  'feedback'|'gatekeeper', run: {exitCode: number|null; stdout: string; timedOut: boolean}):
  Partial<OrkyActionResult>` (the dispatcher layers `feedback`/`dispatched` on top per-action; this function
  owns ONLY the exit-code/JSON-parse → `{ok, exitCode, data, error, errorKind}` core, shared across all four
  actions per REQ-011's "total exit-code + stdout-JSON mapping").
- `timedOut: true` → `{ok:false, exitCode:null, errorKind:'cli-timeout', error:'the <cliKind> command timed
  out after <n>s'}` (REQ-010).
- stdout that fails `JSON.parse` or does not parse to a plain object → `{ok:false, errorKind:
  'cli-unparseable', error:'the <cliKind> command produced unexpected output (<n> bytes)'}` (REQ-011) — never
  a throw, the raw output length noted per the acceptance criterion.
- Per-CLI exit-code semantics table (REQ-011), branching on `cliKind` + `action`:
  - `feedback emit` (`action` ∈ `{resolveEscalation, submitWork}` on the feedback path): ALWAYS exit 0;
    `{ok:true, data:<parsed>}` (the dispatcher, TASK-007, separately branches on `data.mode` for the
    feedback-vs-fallback decision — this function does not know about `mode`).
  - `gatekeeper record` (`action:'recordHumanGate'`): exit 0 → `{ok:true, data}` (`data.passed===true`);
    exit 1 → `{ok:true, data}` (`data.passed===false` — a recorded FAIL is still `ok:true`, REQ-011); exit 2
    → `{ok:false, errorKind:'cli-error', error:<parsed.error ?? 'gatekeeper record failed'>}`.
  - `gatekeeper resolve-escalation` / `gatekeeper drive` (`action` ∈ `{resolveEscalation (fallback),
    driveStatus}`): exit 0 → `{ok:true, data}`; exit 2 → `{ok:false, errorKind:'cli-error',
    error:<parsed.error ?? '<cli> failed'>}`.
  - Any OTHER exit code (defensive — not documented by the CLI contract) → `{ok:false,
    errorKind:'cli-error', error:'unexpected exit code <n> from <cliKind>'}` — total, never an unhandled
    branch.
- The CLI's own `{error}` field, when present in parsed JSON, MUST be surfaced verbatim inside the action's
  `error` string (CONV-001, REQ-011 acceptance).

### TASK-007 — Per-`featureDir` mutation serialization queue
**Satisfies:** REQ-015 · **Files:** `src/main/orky/orky-action-queue.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** mirror `OrkyRegistry.exclusive()`, but keyed (a
  `Map<featureDir, Promise<unknown>>`), not a single global chain; unrelated keys never serialize
- `class OrkyActionQueue { run<T>(featureDir: string, fn: () => Promise<T>): Promise<T> }` — looks up (or
  creates) the promise chain tail for `featureDir`, chains `fn` onto it (`.then(fn, fn)` so a prior
  rejection never poisons the next queued call — same shape as `OrkyRegistry.exclusive`), stores the new
  tail, and PRUNES the map entry once the chain settles back to empty (so the map does not grow unbounded
  for the life of the app — a `featureDir`-keyed mirror of CONV-011's "prune keys that leave membership"
  discipline, applied here to a queue rather than a cache).
- Read-only `driveStatus` MUST NOT be routed through this queue (REQ-015: "read-only `driveStatus` need not
  serialize") — enforced at the dispatcher call site (TASK-008), not inside this class (this class has no
  opinion about which actions are mutating).
- Two different `featureDir` keys' `run()` calls MUST be independently resolvable with no ordering
  coupling (REQ-015 acceptance: "concurrent actions on two different feature dirs run without serializing
  against each other") — verified by construction (separate map entries), no test-only assertion needed
  here, but the shape must not accidentally share one chain across keys.

### TASK-008 — `OrkyActionDispatcher` service (the four actions)
**Satisfies:** REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-016,
  REQ-019 · **Files:** `src/main/orky/orky-action-dispatcher.ts`
**Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007 · **Order:** 3 ·
  **Constraints:** single app-wide instance; hard-coded subcommands only (REQ-016); no direct `.orky/`
  write (REQ-019); disposable with zero lingering children
- Constructed with: an `OrkyRegistry` reference (for `roots()`, REQ-004 — this dispatcher does NOT own its
  own copy of the allowlist, it reads the SAME shared `OrkyRegistry` instance `services.ts` already
  constructs for feature 0005), an injected `runCli` (TASK-004's function type, defaulting to
  `runOrkyCli`), an injected `locateOrkyCli` (TASK-003, defaulting to the real resolver), an
  `OrkyActionAuditLog` (TASK-005), and an `OrkyActionQueue` (TASK-007). All four injectable for the pure
  vitest suite per the Determinism/injection contract above.
- Internal helper `resolveFeatureDir(projectRoot: string, slug: string): Promise<{ok:true;
  featureDir:string} | {ok:false; errorKind:'feature-not-found'; error:string}>` — builds
  `join(projectRoot, '.orky', 'features', slug)` SERVER-SIDE (never renderer-supplied, REQ-005), confirms
  it `stat`s as an existing directory containing (at minimum) a plausible feature marker (mirrors
  `validate-root.ts`'s existence-check style) confined under `<projectRoot>/.orky/features/`; a slug that
  passed TASK-002's shape validation but does not resolve to an existing dir → `feature-not-found`.
- Internal helper `checkRoot(projectRoot: string): {ok:true} | {ok:false; errorKind:'root-not-allowed';
  error:string}` — membership test against `this.orkyRegistry.roots()` using `normalizeProjectRoot`
  (CONV-010) for comparison (REQ-004).
- `async resolveEscalation(req: unknown): Promise<OrkyActionResult>` (REQ-006):
  1. `validateResolveEscalationRequest` (TASK-002) → `invalid-args` on failure.
  2. `checkRoot` → `root-not-allowed` on failure.
  3. `resolveFeatureDir` → `feature-not-found` on failure.
  4. `locateOrkyCli('feedback')` → `orky-cli-not-found` on failure (checked BEFORE queueing, so a
     misconfigured install fails fast without ever entering the per-featureDir queue).
  5. Route the REST through `queue.run(featureDir, async () => {...})` (REQ-015): first
     `runCli(feedbackCliPath, ['emit','--app',projectRoot,'--type','decision','--feature',slug,'--payload',
     JSON.stringify({escalationId,decision})])`; map via TASK-006; if `data.mode !== 'noop'` → return
     `{ok:true, path:'feedback', feedback:'enabled', dispatched:true, data}`. If `mode === 'noop'`, locate
     `gatekeeper` (`orky-cli-not-found` if missing), run `resolve-escalation --feature <featureDir> --id
     <escalationId> --decision <decision>`, map via TASK-006, and on success return `{ok:true,
     path:'gatekeeper', feedback:'disabled', dispatched:true, data}`; on `cli-error` propagate with
     `path:'gatekeeper', feedback:'disabled'`.
  6. Every branch appends one audit record (TASK-005) before returning, including the pre-CLI rejections
     (steps 1–4) — the audit write happens at EVERY return point, not only on success.
- `async submitWork(req: unknown): Promise<OrkyActionResult>` (REQ-007): same validate → root-check →
  (optional) `resolveFeatureDir` when `feature` present → locate `feedback` → `queue.run` (keyed by
  `featureDir` when present, else a project-level key `projectRoot` so two project-level submits to the
  SAME root still serialize; two DIFFERENT roots never do) → `emit --app <root> --type work.request
  [--feature <slug>] --payload {title,detail?,phase?}` → map; `mode !== 'noop'` → `ok:true,
  dispatched:true`; `mode === 'noop'` → `{ok:false, path:'feedback', feedback:'disabled',
  dispatched:false, errorKind:'feedback-disabled', error:...}` — NO gatekeeper fallback (D2/REQ-007).
- `async recordHumanGate(req: unknown): Promise<OrkyActionResult>` (REQ-008): validate (TASK-002 already
  restricts `gate`/`verdict` to their allowed sets, but this method ALSO independently re-checks `gate ∈
  {brainstorm, human-review}` before invoking anything — REQ-008's "independent of (and in addition to)
  gatekeeper.js's own enforcement" — returning `gate-not-allowed`, distinct from `invalid-args`, when the
  shape was valid but the value is outside the allowed set) → root-check → `resolveFeatureDir` → locate
  `gatekeeper` → `queue.run(featureDir, ...)` → `record --feature <featureDir> --gate <gate> --verdict
  <verdict> [--evidence <evidence>]` — `--force` is NEVER appended, hard-coded absence, not a conditional
  (REQ-008) → map via TASK-006 (exit 0/1 both `ok:true`, exit 2 `cli-error`).
- `async driveStatus(req: unknown): Promise<OrkyActionResult>` (REQ-009): validate → root-check →
  `resolveFeatureDir` → locate `gatekeeper` → run `drive --feature <featureDir>` DIRECTLY (bypassing
  `queue.run` — read-only, REQ-015) → map; always `dispatched:false` regardless of `ok`.
- **REQ-016 scope guard (code-level, checked at implementation/review, not a runtime branch):** the four
  hard-coded subcommand arrays above (`emit`, `resolve-escalation`, `record`, `drive`) are the ONLY Orky
  subcommands this file may reference; no request field ever selects a subcommand string. A grep-style
  review assertion (not a new test file — the tests phase owns that) is planned as part of TASK-008's
  acceptance, not a separate task.
- `dispose(): void` — no owned timers/watchers here (the CLI-runner's children are already `unref()`'d and
  self-terminating on timeout — TASK-004); `dispose()` exists for symmetry with the composition-root
  disposer contract and to abort any in-flight `AbortController` this instance created per call (REQ-001
  acceptance: "after dispose(), zero in-flight children").

### TASK-009 — IPC contract: `orkyAction:*` channels + `TermhallaApi`
**Satisfies:** REQ-018 · **Files:** `src/shared/ipc-contract.ts`
**Depends on:** TASK-001 · **Order:** 3 · **Constraints:** exact channel names from the spec; import new
  types alongside the existing `OrkyPaneStatus`/`OrkyRegistrySnapshot` import; NO content-freeze test added
  on this shared file (CONV-012 — REQ-018 already encodes this)
- Add to `CH`: `orkyActionResolveEscalation: 'orkyAction:resolveEscalation'`,
  `orkyActionSubmitWork: 'orkyAction:submitWork'`, `orkyActionRecordHumanGate:
  'orkyAction:recordHumanGate'`, `orkyActionDriveStatus: 'orkyAction:driveStatus'` — all four
  renderer→main, no push channel added (REQ-001).
- Add to `TermhallaApi`: `orkyResolveEscalation(req: ResolveEscalationRequest): Promise<OrkyActionResult>`,
  `orkySubmitWork(req: SubmitWorkRequest): Promise<OrkyActionResult>`, `orkyRecordHumanGate(req:
  RecordHumanGateRequest): Promise<OrkyActionResult>`, `orkyDriveStatus(req: DriveStatusRequest):
  Promise<OrkyActionResult>`.
- Import the 4 request types + `OrkyActionResult` from `@shared/types` into the contract file's existing
  type-import line.

### TASK-010 — `register-orky-action.ts` registrar + composition wiring
**Satisfies:** REQ-001, REQ-003, REQ-014, REQ-018, REQ-020 · **Files:**
  `src/main/ipc/register-orky-action.ts` (new), `src/main/ipc/register.ts`, `src/main/services.ts`
**Depends on:** TASK-008, TASK-009 · **Order:** 4 · **Constraints:** SINGLE dispatcher instance app-wide;
  sender validation at the registrar boundary (REQ-003), mirroring `register-registry.ts`
- `services.ts`: construct ONE `OrkyActionDispatcher` (TASK-008), wired to the SAME `orkyRegistry`
  instance already built there (feature 0005) — no second `OrkyRegistry`. Add it to the `Services`
  interface (`orkyActionDispatcher`) alongside the existing `orkyEngine`/`orkyRegistry` fields, with a
  doc-comment cross-referencing this feature.
- `register-orky-action.ts`: `registerOrkyAction(dispatcher: OrkyActionDispatcher,
  isKnownWindowSender: (sender: WebContents) => boolean = () => true): Disposer` —
  - `ipcMain.handle(CH.orkyActionResolveEscalation, (e, req) => isKnownWindowSender(e.sender) ?
    dispatcher.resolveEscalation(req) : REJECTED)` where `REJECTED = {ok:false, path:null,
    dispatched:false, errorKind:'unknown-sender', error:'rejected: sender is not a known app window'}`
    (REQ-003) — mirrored for all four handlers. The unknown-sender path returns WITHOUT ever calling into
    the dispatcher (so no audit-log entry is written for it either — REQ-003's "without invoking any CLI"
    is satisfied trivially since sender-rejection happens strictly before the dispatcher method runs).
  - No push-event subscription in this registrar (REQ-001: no main→renderer channel).
  - Returned disposer removes all four `ipcMain.handle`s; does NOT call `dispatcher.dispose()` (composition
    root owns that, mirroring `registerRegistry`'s own "shared lifecycle owned once" note) — actually here
    the dispatcher IS owned solely by this feature (unlike the shared engine), so `register.ts` calls
    `dispatcher.dispose()` once in its own disposer array entry, analogous to how `orkyRegistry.dispose()`
    is called there today.
- `register.ts`: import + call `registerOrkyAction(services.orkyActionDispatcher, (sender) =>
  wm.isKnownWindowSender(sender))`, push its disposer (+ a `() => services.orkyActionDispatcher.dispose()`
  entry) into the existing `disposers` array alongside the other registrars.

### TASK-011 — Preload bridge (no UI)
**Satisfies:** REQ-017, REQ-018 · **Files:** `src/preload/index.ts`
**Depends on:** TASK-009 · **Order:** 4 · **Constraints:** typed bridge only (contextIsolation); no React
  component added anywhere in this task or any other
- Add `orkyResolveEscalation: (req) => ipcRenderer.invoke(CH.orkyActionResolveEscalation, req)`,
  `orkySubmitWork: (req) => ipcRenderer.invoke(CH.orkyActionSubmitWork, req)`, `orkyRecordHumanGate: (req)
  => ipcRenderer.invoke(CH.orkyActionRecordHumanGate, req)`, `orkyDriveStatus: (req) =>
  ipcRenderer.invoke(CH.orkyActionDriveStatus, req)` — mirroring the existing `registryAddRoot`/etc.
  invoke-wrapper style (no push-channel wiring needed, REQ-001).
- `src/renderer/api.ts` needs NO edit — it is a typed re-export of `window.termhalla: TermhallaApi`
  (TASK-009 already extends that interface), exactly the existing `cloud:*`/`registry:*` precedent.
- **Scope guard (REQ-017):** confirm (code review, not a new file) that this diff and the whole feature
  introduce no React component/hook/button/badge that calls these four methods — the channels exist,
  nothing renders them yet.

### TASK-012 — Documentation reconciliation
**Satisfies:** REQ-020 · **Files:** `docs/features/orky-action-dispatch.md` (new), `CLAUDE.md`,
  `CHANGELOG.md`, `.orky/baseline/architecture.md`
**Depends on:** all functional tasks · **Order:** last · **Constraints:** grep `docs/` + `CLAUDE.md` +
  `.orky/baseline/` for stale phrasing (CONV-008)
- New `docs/features/orky-action-dispatch.md`: document the four actions, the feedback-first/gatekeeper-
  fallback decision (REQ-006), the server-side root allowlist + feature-slug confinement (REQ-004/REQ-005),
  the CLI-location resolver's `ORKY_PLUGIN_DIR` env var + its "no default, honest not-found error" stance
  (REQ-012), the audit-log shape/location (REQ-013), the per-featureDir serialization queue (REQ-015), and
  the explicit "no `.orky/` write, no pipeline-driving" scope guard (D1/REQ-016/REQ-019).
- Link the doc from the CLAUDE.md "Where things live" table (a new row, e.g. `Orky action dispatch
  (write-capable IPC into an Orky-adopted project)` → `src/main/orky/orky-action-dispatcher.ts` →
  `docs/features/orky-action-dispatch.md`).
- `CHANGELOG.md [Unreleased]`: record "first write-capable IPC surface: `orkyAction:*` dispatch substrate
  (resolveEscalation/submitWork/recordHumanGate/driveStatus), no UI yet".
- `.orky/baseline/architecture.md`: name the new write surface explicitly, noting it only ever submits
  human verdicts/decisions/work THROUGH Orky's own CLIs and never drives the pipeline (mirroring how 0005's
  doc-sync updated the baseline for the read-only registry).
- Grep the whole `docs/` tree + `CLAUDE.md` + `.orky/baseline/` for any existing phrasing that claims
  Termhalla is "strictly read-only" toward `.orky/` trees (several existing docs/gotchas say exactly this
  about 0004/F5/F14) and add the explicit "except F7's CLI-mediated writes, never a direct file write"
  caveat wherever that stale absolute claim appears (CONV-008) — this is the single most likely
  doc-sync surface given prior features' emphatic "read-only" framing.

---

## Sequencing summary

```
TASK-001 (shared types)
  ├─ TASK-002 (pure request validation)          [needs 001]
  ├─ TASK-006 (pure exit-code/JSON mapping)        [needs 001]
  └─ TASK-009 (IPC contract)                       [needs 001]
        └─ TASK-011 (preload bridge)               [needs 009]
TASK-003 (CLI-location resolver)                   [independent]
TASK-004 (CLI-runner)                              [independent]
TASK-005 (audit-log writer)                        [independent]
TASK-007 (per-featureDir queue)                    [independent]
TASK-008 (OrkyActionDispatcher)          [needs 001,002,003,004,005,006,007]
  └─ TASK-010 (registrar + composition)  [needs 008, 009]
        └─ TASK-011 also depends on 009 (preload) — parallel track, merges before e2e
TASK-012 (docs)                                    [after all functional tasks]
```

## Risk notes

1. **CLI-location config-surface ambiguity (TASK-003).** The spec's open question #1 flags a possible
   overlap with F13 (Settings). This plan implements a working, testable env-var-only resolver
   (`ORKY_PLUGIN_DIR`) behind a single swappable function so F13 can later wire a persisted/Settings-backed
   value without touching any call site — but the coordinator should confirm this ownership split before
   F13 is planned, so the two features don't independently invent divergent config surfaces (CONV-012's
   spirit, applied to a config key rather than a shared source file).
2. **Feedback payload field-name risk (spec open question #2).** TASK-008's `emit --payload` field names
   (`{escalationId,decision}` / `{title,detail,phase}`) are F7's own boundary per the spec; if the tests
   phase's live Orky round-trip check finds Orky's `applyItems` expects different field names, ONLY the
   payload construction inside `resolveEscalation`/`submitWork` (TASK-008) changes — no IPC contract or
   type change follows from that discovery. Flagging so the tests-phase producer knows this is the one
   place a live-fixture surprise would land.
3. **Audit-log redaction judgment call (TASK-005).** The spec requires "a redaction-safe argument summary"
   without pinning an exact shape; this plan's `argsSummary` (length-only for free-text fields, full values
   for structural fields like `gate`/`verdict`/`escalationId`) is a judgment call consistent with CLAUDE.md's
   "never dump conversation content" norm (applied here to human-authored decision/work text, not Claude
   transcripts) — the tests phase should pin the exact shape it asserts against.
4. **Dispatcher-owned vs shared-lifecycle disposal (TASK-010).** Unlike `orkyRegistry`/`orkyEngine` (shared
   between two registrars, disposed once by the composition root for that reason), `OrkyActionDispatcher`
   is used ONLY by `register-orky-action.ts` — so its `dispose()` is safe to call from that registrar's own
   returned disposer OR from a separate composition-root entry; this plan picks the composition-root entry
   for consistency with the existing `orkyRegistry`/`orkyEngine` disposal style already in `register.ts`,
   but either is correct — call this out in review if the tests phase expects the other placement.

## Open issues (under-specified REQs)

None. Every REQ-001..REQ-020 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). The spec is
frozen at 20 REQs.
