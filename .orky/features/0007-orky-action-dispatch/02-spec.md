# 0007 — Orky action-dispatch substrate (first write capability)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 never-drives, D2 four-action
surface, D3 server-side root allowlist). This spec **resolves** the three brainstorm-deferred, non-blocking
open questions (exact IPC channel names, the audit-log storage/schema, and the `driveStatus` read shape)
inline, and records two ambiguities the CLI source surfaced that need coordinator/tests-phase confirmation
(see **Open questions**). REQ-IDs are stable; never renumber.

This is Termhalla's **first write-capable IPC surface** into an Orky-adopted project. It introduces **no
renderer UI** (D1); F8/F10/F12 build the human-facing gestures on top of it. Every mutation is performed by
**invoking Orky's own CLIs** (`feedback emit`, `gatekeeper resolve-escalation`, `gatekeeper record`); F7
never writes a file under any `.orky/` tree itself, never spawns an agent, and never drives the pipeline.

## Concerns

`security` `networking` `quality` `enterprise-arch`

- `security` — first renderer-reachable, project-mutating surface: sender validation (`isKnownWindowSender`,
  REQ-003), the server-side root allowlist (D3, REQ-004), feature-slug path confinement (REQ-005), the
  server-enforced human-gate restriction (REQ-008), and total malformed-input tolerance (REQ-014) are
  first-class, not afterthoughts. No renderer-supplied path is ever trusted.
- `networking` — CLI subprocess invocation (`execFile`-of-node, per the cloud-probe pattern) must be
  abortable + `unref()`'d + timeout-bounded (REQ-010) so a hung `gatekeeper`/`feedback` child never hangs the
  IPC round-trip or blocks Electron shutdown (CLAUDE.md long-lived-child gotcha).
- `quality` — reuse the existing `execFile`/registrar/validation patterns (cloud probes,
  `register-registry.ts`, `validate-root.ts`) rather than inventing a new dispatch mechanism; exit-code/JSON
  mapping is total (REQ-011).
- `enterprise-arch` — every dispatch attempt is attributable via an append-only audit log (REQ-013), since
  this is the first place Termhalla mutates a third-party project's state.

`data-provenance` is **n/a** — this feature bundles no factual/reference dataset; it wraps a live CLI.

## Verified CLI contract (read from Orky source, not memory)

Confirmed against `C:/dev/Orky/plugin/gatekeeper/cli.js` + `gatekeeper.js` and
`C:/dev/Orky/plugin/feedback/cli.js` + `feedback.js` on 2026-06-30:

- **`gatekeeper record --feature <featureDir> --gate <name> --verdict pass|fail [--evidence <t>] [--force]`**
  — `featureDir` is a **feature directory path** (contains `state.json`), NOT a project root. `gatekeeper.js`
  **already** enforces `HUMAN_GATES = {brainstorm, human-review}` server-side: a non-human gate **throws**
  (CLI catch → `{error}`, **exit 2**) unless `--force`. stdout is a single JSON object (the recorded gate
  `{passed, at, evidence, external:true}`); **exit 0** when `passed`, **exit 1** when the recorded verdict is
  `fail`, **exit 2** on any thrown error.
- **`gatekeeper resolve-escalation --feature <featureDir> --id <ESC-id> --decision <t>`** — mutates
  `state.json` (marks the escalation resolved). stdout = the escalation object; **exit 0** on success, **exit
  2** if no such escalation id (throws).
- **`gatekeeper drive --feature <featureDir> [--config <path>]`** — READ-ONLY; returns the computed next
  action `{next: 'await-human'|'done'|'run-phase'|'escalate'|'loop-back'|'retry-phase'|..., ...}`; **exit 0**
  always.
- **`feedback emit --app <projectRoot> --type <t> [--feature <slug>] [--phase <p>] [--payload <json>]`** —
  `--app` is the **project root** (reads `<projectRoot>/.orky/config.json` for the feedback channel). `emit`
  **ALWAYS exits 0**. stdout on success `{ ok:true, mode:<'noop'|'file'|'http'>, event:<id>, sent, spooled }`;
  on internal error `{ ok:false, mode:'noop', error, note:'emit is non-fatal' }`. **When
  `feedback.enabled === false` (or absent) the channel is Noop and the emit returns `mode:'noop'` with
  `{sent:false, spooled:false}` — a documented no-op.** `mode !== 'noop'` is the authoritative "the control
  plane actually accepted this" signal.

## Resolved open questions (decisions, with rationale)

1. **IPC channel/method names — a new `orkyAction` domain** (`domain:verb` per CLAUDE.md; verified no
   collision — the existing read surfaces use `orky:*` and `registry:*`). Deliberately a **distinct** domain
   from the read-only `orky:*` channels so the write surface is grep-visibly separated from the read surface:
   - `orkyAction:resolveEscalation`, `orkyAction:submitWork`, `orkyAction:recordHumanGate`,
     `orkyAction:driveStatus`. All four are renderer→main request/response `ipcMain.handle` calls; there are
     **no** main→renderer push events in this feature.
   - `TermhallaApi` methods mirror them as `orkyResolveEscalation`, `orkySubmitWork`, `orkyRecordHumanGate`,
     `orkyDriveStatus` (the `orky` prefix groups them with the existing `orky*` read methods; the channel
     domain `orkyAction:` keeps write channels distinct from read `orky:` channels on the wire).
2. **Audit-log storage — a new append-only JSONL file** `orky-actions.jsonl` under Electron `userData` (REQ-013).
   Rationale: proportionate (one line per dispatch attempt, human-gesture frequency), atomic per-line append
   (`fs.appendFile`, never a rewrite that could truncate), no new native dependency, and independent of the
   app-state schema chain (no `SCHEMA_VERSION` bump).
3. **`driveStatus` read shape — pass the raw Gatekeeper `drive` object through** inside the standard
   `OrkyActionResult.data` (REQ-009) rather than inventing a thinner projection or reusing F5's
   `OrkyPaneStatus`. Rationale: `drive`'s `next`-action object is already the exact "what does this feature
   need before I submit anything" answer a caller wants, and re-projecting it here would duplicate Orky
   pipeline semantics (forbidden by the thin-client constraint).

## Public interface

### Shared types (new) — `src/shared/types.ts`

```ts
/** Which Orky CLI actually performed the action. `null` when the request was rejected before any CLI ran. */
export type OrkyActionPath = 'feedback' | 'gatekeeper' | null

/** Ground-truth feedback-channel state for a feedback-routed action, derived from the emit's `mode`
 *  (`'noop'` ⇒ `'disabled'`). Distinguishes "not enabled for this project" from "enabled but the CLI
 *  failed" (CONV-001) — the distinction D2/CONV-001 require F8's UI to be able to show. */
export type OrkyFeedbackState = 'enabled' | 'disabled'

/** Machine-routable rejection/failure discriminator (CONV-001: paired with a specific `error` string). */
export type OrkyActionErrorKind =
  | 'unknown-sender'      // sender not a known app window (REQ-003)
  | 'invalid-args'        // missing/ill-typed/malformed argument (REQ-014)
  | 'root-not-allowed'    // projectRoot not in registry.roots() (D3, REQ-004)
  | 'gate-not-allowed'    // recordHumanGate gate outside {brainstorm, human-review} (REQ-008)
  | 'feature-not-found'   // feature slug does not resolve to a feature dir under the root (REQ-005)
  | 'feedback-disabled'   // submitWork with no live control plane and no fallback (REQ-007)
  | 'orky-cli-not-found'  // the Orky CLI could not be located (REQ-012)
  | 'cli-timeout'         // the CLI child exceeded the timeout / was aborted (REQ-010/REQ-011)
  | 'cli-error'           // the CLI threw / exited with an error code (exit 2) (REQ-011)
  | 'cli-unparseable'     // the CLI stdout was not the expected JSON object (REQ-011)

/** The uniform result of every action (CONV-001: `ok:false` always carries `errorKind` + a specific
 *  `error`). `data` is the parsed CLI JSON object on success (escalation obj / gate obj / drive next-action /
 *  feedback emit result). */
export interface OrkyActionResult {
  ok: boolean
  path: OrkyActionPath                 // which CLI ran (null if rejected pre-CLI)
  dispatched: boolean                  // did the human input land durably? (false for driveStatus reads and
                                       //   for a feedback-disabled submitWork — never a silent success)
  feedback?: OrkyFeedbackState         // present for feedback-capable actions (resolveEscalation/submitWork)
  exitCode?: number | null             // the CLI process exit code (null on timeout/abort/spawn failure)
  data?: unknown                       // parsed CLI stdout JSON on success
  error?: string                       // specific + actionable (CONV-001) when ok === false
  errorKind?: OrkyActionErrorKind      // set iff ok === false
}

export interface ResolveEscalationRequest {
  projectRoot: string                  // the allowlisted target project root (dir containing .orky/)
  feature: string                      // feature slug (single path segment under <root>/.orky/features/)
  escalationId: string                 // e.g. "ESC-001"
  decision: string                     // the human's decision text
}
export interface SubmitWorkRequest {
  projectRoot: string
  feature?: string                     // optional: a feature-scoped work item; omit for project-level
  title: string                        // required, non-empty
  detail?: string                      // optional longer body
  phase?: string                       // optional originating phase
}
export interface RecordHumanGateRequest {
  projectRoot: string
  feature: string
  gate: 'brainstorm' | 'human-review'  // server-restricted (REQ-008); any other value → gate-not-allowed
  verdict: 'pass' | 'fail'
  evidence?: string
}
export interface DriveStatusRequest {
  projectRoot: string
  feature: string
}
```

### IPC (new `orkyAction` domain) — `src/shared/ipc-contract.ts`

```ts
CH.orkyActionResolveEscalation: 'orkyAction:resolveEscalation' // renderer -> main (request/response)
CH.orkyActionSubmitWork:        'orkyAction:submitWork'        // renderer -> main
CH.orkyActionRecordHumanGate:   'orkyAction:recordHumanGate'   // renderer -> main
CH.orkyActionDriveStatus:       'orkyAction:driveStatus'       // renderer -> main (read-only)

orkyResolveEscalation(req: ResolveEscalationRequest): Promise<OrkyActionResult>
orkySubmitWork(req: SubmitWorkRequest): Promise<OrkyActionResult>
orkyRecordHumanGate(req: RecordHumanGateRequest): Promise<OrkyActionResult>
orkyDriveStatus(req: DriveStatusRequest): Promise<OrkyActionResult>
```

Implemented in a new per-domain registrar `src/main/ipc/register-orky-action.ts`, composed by `register.ts`,
bridged through `src/preload/` and exposed via `src/renderer/api.ts` (REQ-018).

---

## Requirements

### REQ-001 — New `orkyAction:*` dispatch service + IPC surface (four actions, no push) — `quality`
A new main-process service (e.g. `src/main/orky/orky-action-dispatcher.ts`) MUST expose exactly the four
actions `resolveEscalation`, `submitWork`, `recordHumanGate`, `driveStatus`, each a renderer→main
request/response call over the corresponding `orkyAction:*` channel returning an `OrkyActionResult`. The
feature MUST introduce NO main→renderer push channel. The service MUST be a single app-wide instance
(constructed in `services.ts` / composed by `register.ts`), disposable, and MUST NOT keep the Electron main
process alive after dispose (no lingering child processes/timers — CLAUDE.md long-lived-child obligation).
**Acceptance:** the contract exposes exactly those four channels + four `TermhallaApi` methods; a harness
invokes each handler and receives an `OrkyActionResult`; after `dispose()` the service holds zero in-flight
children and the app `close()`s without hanging; `typecheck` passes.

### REQ-002 — Uniform, discriminated result shape; feedback-path distinction is first-class — `quality`
Every action MUST return an `OrkyActionResult` (Public interface). On success `ok:true` and `data` carries the
parsed CLI JSON object; on any failure `ok:false` with BOTH a specific, actionable `error` (CONV-001) AND a
machine-routable `errorKind`. `path` MUST report which CLI actually ran (`'feedback'`/`'gatekeeper'`, or
`null` when rejected before any CLI). For feedback-capable actions the result MUST carry `feedback:'enabled'
|'disabled'` derived from the emit `mode` (`'noop'` ⇒ `'disabled'`). `dispatched` MUST be `true` only when the
human input landed durably (a live feedback emit, or a completed gatekeeper mutation) and `false` for a
read-only `driveStatus` or a dropped-because-disabled `submitWork`.
**Acceptance:** a bare `"error"`/`"invalid input"` string never appears; every `ok:false` result has a
non-empty `error` and a set `errorKind`; a resolveEscalation against a feedback-enabled fixture reports
`path:'feedback', feedback:'enabled', dispatched:true`, and against a feedback-disabled fixture reports
`path:'gatekeeper', feedback:'disabled', dispatched:true`.

### REQ-003 — Sender validation on every handler — `security`
Every `orkyAction:*` handler MUST gate on `isKnownWindowSender(e.sender)` (mirroring `register-registry.ts`).
A rejected sender MUST return `{ ok:false, path:null, dispatched:false, errorKind:'unknown-sender', error:...
}` WITHOUT throwing and WITHOUT invoking any CLI — distinct from a validation failure inside the service, so a
caller can tell the two apart. The composition root MUST pass the real `wm.isKnownWindowSender`; the predicate
MUST default to allow-all only for tests that omit it (mirroring the existing pattern).
**Acceptance:** a handler invoked with a sender the window manager does not recognize returns
`errorKind:'unknown-sender'`, spawns no child process, and does not throw; the real composition wiring passes
`wm.isKnownWindowSender`.

### REQ-004 — Server-side project-root allowlist against `registry.roots()` (D3) — `security`
Every action's `projectRoot` MUST be validated in the main process against `OrkyRegistry.roots()` (the
persisted explicit list, F5) and REJECTED if it is not a member — never trusting the renderer-supplied path.
Membership MUST be decided using the SHARED `normalizeProjectRoot` normalizer from
`src/main/orky/validate-root.ts` (CONV-010) so a case-/slash-divergent but physically identical spelling still
matches an allowlisted root. A rejected root MUST return `{ ok:false, path:null, dispatched:false,
errorKind:'root-not-allowed', error:'project <root> is not a tracked Orky project; add it via the registry
first' }` and MUST NOT invoke any CLI. Using the persisted list (not pane-only roots) is deliberate: the
first write surface only mutates projects a human has explicitly tracked.
**Acceptance:** an action whose `projectRoot` is not in `registry.roots()` returns `root-not-allowed` and runs
no CLI; the same physical root spelled with different case/slash style than the allowlisted entry is accepted;
the check reads `registry.roots()`, never a raw renderer argument, and never the pane-only membership.

### REQ-005 — Feature-slug path confinement; `featureDir` built server-side — `security`
For every action that names a `feature`, the target feature directory MUST be constructed in the main process
as `join(projectRoot, '.orky', 'features', <slug>)` — never accepted directly from the renderer. The `slug`
MUST be validated to be a single, non-empty path segment: reject any value containing a path separator (`/` or
`\`), a `..` segment, an absolute path, or one whose resolved path escapes `<projectRoot>/.orky/features/`
(CONV-002 malformed input). A slug that does not resolve to an existing feature directory MUST return
`errorKind:'feature-not-found'` with a specific error. The resolved `featureDir` MUST stay confined under the
allowlisted root.
**Acceptance:** `feature:'../../etc'`, `feature:'a/b'`, an absolute path, and an empty string each return
`invalid-args`/`feature-not-found` (never a read/write outside `<root>/.orky/features/`); a valid existing
slug resolves to the correct absolute `featureDir`; a well-formed slug for a non-existent feature dir returns
`feature-not-found`.

### REQ-006 — `resolveEscalation`: feedback-first with a gatekeeper direct fallback (D2) — `enterprise-arch` `quality`
`resolveEscalation(req)` MUST first attempt `feedback emit --app <projectRoot> --type decision --feature
<slug> --payload <json{escalationId, decision}>`. It MUST inspect the emit result's own `ok` field FIRST
(**Amended (ESC-006):** parsed `ok:false` takes precedence over mode-based branching): a feedback-emit exit-0
result whose parsed `ok === false` is an INTERNAL ERROR of the feedback CLI and MUST return `{ ok:false,
path:'feedback', dispatched:false, errorKind:'cli-error', exitCode:0, error:<the CLI's own error message> }`
— the gatekeeper fallback MUST NOT run for it. Only when `ok` is not literally `false` does the `mode`
branching apply: when `mode !== 'noop'` the decision was accepted by the live control plane → return `{
ok:true, path:'feedback', feedback:'enabled', dispatched:true, data:<emit result> }`. When `mode === 'noop'`
(feedback genuinely disabled) it MUST fall back to `gatekeeper resolve-escalation --feature <featureDir> --id
<escalationId> --decision <decision>` and return `{ ok:true, path:'gatekeeper', feedback:'disabled',
dispatched:true, data:<escalation obj> }`. The result MUST make the taken path unambiguous so the audit trail
(REQ-013) and F8's UI can show which route ran. A gatekeeper fallback that exits 2 (e.g. unknown escalation
id) MUST return `errorKind:'cli-error'` with the CLI's message.
**Acceptance:** against a feedback-enabled fixture the call emits (mode `file`/`http`), never touches
gatekeeper, and reports `path:'feedback'`; against a disabled fixture it emits (exit 0, `ok:true`, mode
`noop`) then runs gatekeeper direct, mutates `state.json`'s escalation to `resolved`, and reports
`path:'gatekeeper', feedback:'disabled'` (pinned by TEST-299); an emit returning exit 0 with `{ok:false,
mode:'noop', error}` yields `ok:false, errorKind:'cli-error'` carrying the CLI's own error with NO gatekeeper
invocation (ESC-006; pinned by TEST-295/TEST-297); a non-existent `escalationId` on the fallback path returns
`cli-error` with a specific message.

### REQ-007 — `submitWork`: feedback-only; disabled is surfaced distinctly, never a silent drop (D2/CONV-001) — `quality` `enterprise-arch`
`submitWork(req)` MUST invoke `feedback emit --app <projectRoot> --type work.request [--feature <slug>]
--payload <json{title, detail?, phase?}>`. The emit result's own `ok` field takes precedence over mode-based
branching (**Amended (ESC-006)**): an exit-0 emit whose parsed `ok === false` is an INTERNAL ERROR and MUST
return `{ ok:false, path:'feedback', dispatched:false, errorKind:'cli-error', exitCode:0, error:<the CLI's
own error message> }` — never the `feedback-disabled` outcome below. Only when `ok` is not literally `false`
does the `mode` branching apply: when `mode !== 'noop'` → `{ ok:true, path:'feedback', feedback:'enabled',
dispatched:true, data:<emit result> }`. When `mode === 'noop'` (feedback genuinely disabled) there is NO
fallback (work items have no direct gatekeeper equivalent), so the result MUST be a DISTINCT non-dispatch
outcome — `{ ok:false, path:'feedback', feedback:'disabled', dispatched:false, errorKind:'feedback-disabled',
error:'the feedback control plane is disabled for <root>; work items cannot be submitted until it is enabled'
}` — never a success that silently discards the human's input.
**Acceptance:** against a feedback-enabled fixture the work item is emitted and `dispatched:true`; against a
disabled fixture (exit 0, `ok:true`, mode `noop`) the result is `ok:false, errorKind:'feedback-disabled',
dispatched:false` with a specific, actionable message and the outbox is unchanged (nothing durably written)
(pinned by TEST-300); an emit returning exit 0 with `{ok:false, mode:'noop', error}` yields `ok:false,
errorKind:'cli-error'` carrying the CLI's own error, NOT `feedback-disabled` (ESC-006; pinned by TEST-298);
`title` missing/empty → `invalid-args` (REQ-014) before any emit.

### REQ-008 — `recordHumanGate`: gate restricted server-side to `{brainstorm, human-review}`, never `--force` — `security`
`recordHumanGate(req)` MUST reject any `gate` outside `{brainstorm, human-review}` in the main process BEFORE
invoking the CLI — returning `{ ok:false, path:null, dispatched:false, errorKind:'gate-not-allowed', error:...
}` — independent of (and in addition to) `gatekeeper.js`'s own `HUMAN_GATES` enforcement, and it MUST NEVER
pass `--force`. On an allowed gate it MUST invoke `gatekeeper record --feature <featureDir> --gate <gate>
--verdict <pass|fail> [--evidence <evidence>]`. A recorded `pass` (exit 0) and a recorded `fail` (exit 1) are
BOTH successful outcomes (`ok:true, data:<gate obj>` with the recorded verdict in `data.passed`); only an exit
2 (thrown) is `cli-error`.
**Acceptance:** `gate:'spec'` / `gate:'implement'` / any non-human gate returns `gate-not-allowed` and spawns
no CLI; the invocation never includes `--force`; `verdict:'pass'` records and returns `ok:true` with
`data.passed === true`; `verdict:'fail'` (CLI exit 1) returns `ok:true` with `data.passed === false` (NOT
treated as an error); a malformed `verdict` value returns `invalid-args`.

### REQ-009 — `driveStatus`: read-only next-action query — `quality`
`driveStatus(req)` MUST invoke `gatekeeper drive --feature <featureDir>` (read-only) and return `{ ok:true,
path:'gatekeeper', dispatched:false, data:<drive next-action obj> }`. It MUST NOT mutate any `.orky/` file and
MUST report `dispatched:false` (it submits nothing). It MUST still be sender-validated (REQ-003) and
root-allowlisted (REQ-004) — it reveals a project's pipeline state.
**Acceptance:** `driveStatus` on a fixture returns the Gatekeeper `drive` object (e.g.
`{next:'await-human',...}`) with `dispatched:false`; the feature's `.orky/` tree is byte-identical before and
after the call; an un-allowlisted root is rejected before the CLI runs.

### REQ-010 — CLI subprocess invocation: abortable + `unref()`'d + timeout, injection-safe — `networking`
All CLI invocations MUST use `execFile` of the Node executable with the CLI `.js` path and an **argument
array** (never `shell:true`, never string concatenation — no shell-injection surface), mirroring
`src/main/cloud/probe.ts`: `{ timeout, windowsHide:true, maxBuffer, signal }`, with `child.unref()` and an
`AbortController` wired so an in-flight child is aborted on service `dispose()` / owning-window close. A
timed-out or aborted child MUST resolve the action promise (NOT reject/hang) as `{ ok:false, path,
dispatched:false, errorKind:'cli-timeout', exitCode:null, error:'the <cli> command timed out after <n>s' }`, so
a hung CLI can neither wedge the IPC round-trip nor keep the main process alive at shutdown.
**Acceptance:** invocations pass args as an array with no `shell:true`; a CLI stub that sleeps past the timeout
yields `cli-timeout` within ~timeout+ε and leaves no live child (the app `close()`s promptly); aborting the
service mid-call resolves the pending action rather than leaking a child.

### REQ-011 — Total exit-code + stdout-JSON mapping — `quality` `networking`
Each action MUST parse the CLI's single-JSON-object stdout and map exit codes totally: `feedback emit` always
exits 0 and its `mode`/`ok` fields drive REQ-006/REQ-007; for `gatekeeper record`, exit 0 = pass, exit 1 =
recorded fail (both `ok:true`), exit 2 = `cli-error`; for `resolve-escalation`/`drive`, exit 0 = success, exit
2 = `cli-error`. stdout that is not the expected JSON object (empty, truncated, or non-JSON) MUST yield
`errorKind:'cli-unparseable'` with the raw output length noted, never a throw and never a silently-assumed
success. The CLI's own `{error}` message MUST be surfaced in the action's `error` (CONV-001).
**Acceptance:** a stub emitting non-JSON on stdout → `cli-unparseable`; a `gatekeeper` stub exiting 2 with
`{error:'no escalation ...'}` → `cli-error` carrying that message; a `record` stub exiting 1 → `ok:true` with
`data.passed===false`; every exit-code branch has a test.

### REQ-012 — Orky CLI location resolution — `quality`
The dispatcher MUST resolve the on-disk location of the Orky `gatekeeper/cli.js` and `feedback/cli.js` through
a single shared resolver, and MUST fail any action that needs a CLI it cannot locate with `{ ok:false,
path:null, dispatched:false, errorKind:'orky-cli-not-found', error:'the Orky <gatekeeper|feedback> CLI could
not be located; set <config key> to your Orky plugin directory' }` — never a silent no-op and never a hard
throw. Resolution order (see Open questions #1 — final config surface may be shared with F13): an explicit
configured path first, then a documented default, else the specific error above.
**Acceptance:** with the CLI location unresolved, every action returns `orky-cli-not-found` with an actionable
message and spawns nothing; with it configured, the resolver returns the absolute `cli.js` path; the resolver
is a single function reused by all four actions (no duplicated lookup).

### REQ-013 — Append-only audit log; every dispatch attempt is attributable — `enterprise-arch`
Every action invocation that REACHES THE DISPATCHER — i.e. every dispatcher-level outcome, whether a success
or a dispatcher-level rejection (`root-not-allowed`, `feature-not-found`, `gate-not-allowed`, `invalid-args`,
`orky-cli-not-found`, `cli-error`, `cli-timeout`, `cli-unparseable`) — MUST append one JSON record to
`orky-actions.jsonl` under Electron `userData` capturing: `ts`, `windowId` (from `e.sender.id`), `action`,
`projectRoot`, `feature` (when present), a redaction-safe argument summary, and the outcome (`ok`, `path`,
`dispatched`, `errorKind`, `exitCode`). A sender rejected at the IPC-registrar boundary
(`unknown-sender`, REQ-003) is turned away strictly BEFORE the dispatcher is ever invoked, so it is NOT
audited by this feature — the registrar owns that rejection and never references the audit log (the audit log
lives only inside the dispatcher). The write MUST be an atomic single-line append (`fs.appendFile`), MUST be
best-effort — an audit write failure MUST be logged but MUST NOT fail the action nor alter its returned
result — and MUST NOT silently cap/rotate/truncate the log (CONV-003: any future size limit must be a stated
policy with a test). The audit log is F7's ONLY write, and it is under `userData`, never under any `.orky/`
tree (REQ-020).
**Acceptance:** after each of a dispatcher-level rejection (e.g. `root-not-allowed`) and an accepted action, a
new line exists in `orky-actions.jsonl` with the attributable fields; an `unknown-sender` rejection at the
registrar boundary produces NO audit line (it never reaches the dispatcher); a simulated append failure is
logged but the action still returns its normal result; no code path truncates or caps the file.

### REQ-014 — Malformed/empty/boundary input tolerated on every action (CONV-002) — `security` `quality`
Every handler MUST validate its request object at the IPC boundary and NEVER let a malformed message crash the
main process (Node 22 `--unhandled-rejections=throw`). A non-object request, a missing/non-string
`projectRoot`, a missing/non-string `feature` where required, a missing/empty `escalationId`/`decision`/`title`,
or a `verdict`/`gate` outside its allowed set MUST each return `{ ok:false, errorKind:'invalid-args', error:<
specific, actionable> }` (CONV-001) — never a throw, never a spawned CLI. Each distinct rejection MUST carry a
DISTINCT actionable message (which field, why), not one generic string.
**Acceptance:** for each action, passing `undefined`, `{}`, a non-string `projectRoot`, and an empty required
field each return `invalid-args` with a field-specific message and the main process survives (no unhandled
rejection); no CLI child is spawned for any rejected request.

### REQ-015 — Per-feature serialization of mutating actions (state.json lost-update safety) — `quality`
Because `gatekeeper record`/`resolve-escalation` perform a non-atomic read-modify-write of `state.json`,
mutating actions targeting the SAME resolved `featureDir` MUST be serialized (a per-`featureDir` promise chain,
the moral equivalent of `OrkyRegistry.exclusive`) so two concurrent submissions cannot lose one another's
update. Actions on DIFFERENT feature dirs MAY run concurrently, and read-only `driveStatus` need not serialize.
**Acceptance:** two concurrent `recordHumanGate` calls (or a record + a resolve-escalation) on the same
`featureDir` both land in `state.json` with no lost write; concurrent actions on two different feature dirs run
without serializing against each other.

### REQ-016 — Action surface is exactly the four commands; no pipeline-driving (D1 scope guard) — `security` `enterprise-arch`
The dispatcher MUST expose ONLY `resolve-escalation`, `record` (human gates), `drive`, and `feedback emit`. It
MUST NOT invoke `loopback`, `escalate`, `check`, `probe`, `can-advance`, `record-implementer`, `heartbeat`,
`enable-feedback`, or `disable-feedback`, MUST NOT spawn a Claude/Orky agent, and MUST NOT run or resume any
pipeline phase (D1). No renderer-supplied string may select an arbitrary CLI subcommand — the subcommand is
hard-coded per action in the main process.
**Acceptance:** a code/review assertion confirms only those four Orky subcommands appear in the dispatch code
path and the subcommand for each action is a hard-coded literal (not derived from a request field); no request
field can cause any other Orky subcommand to run.

### REQ-017 — No renderer UI in this feature (scope guard, D1) — `quality`
This feature MUST ship NO renderer component, button, form, or badge. It MAY add the contract types,
`src/renderer/api.ts` bindings, and preload bridge needed for F8/F10/F12 to consume the channels, but no
visible surface.
**Acceptance:** the diff adds the `orkyAction:*` channels + API bindings but no React component; an e2e launch
shows no new visible UI attributable to this feature.

### REQ-018 — IPC wiring follows the per-domain registrar pattern; shared-file co-ownership (CONV-012) — `quality`
The feature MUST add the `orkyAction:*` channel constants + `TermhallaApi` methods to
`src/shared/ipc-contract.ts`, the request/result types to `src/shared/types.ts`, implement a per-domain
registrar `src/main/ipc/register-orky-action.ts` composed by `register.ts`, expose the methods via
`src/renderer/api.ts`, and bridge them through `src/preload/`. Because F6/F9/F13 will also touch
`ipc-contract.ts`, `types.ts`, `register.ts`, `services.ts`, this feature MUST NOT pin a brittle
content-hash/golden test against any of those shared files (CONV-012) — assert the feature's OWN channel
names/shapes structurally, not a whole-file freeze.
**Acceptance:** channel names are exactly `orkyAction:resolveEscalation`/`submitWork`/`recordHumanGate`/
`driveStatus`; the registrar is composed once in `register.ts`; `typecheck` passes; no content-freeze test is
added on a shared multi-owner file.

### REQ-019 — Strictly no direct write under any `.orky/` tree — `security`
F7 MUST NOT create, modify, move, or delete any file under any `<projectRoot>/.orky/` tree itself: EVERY
mutation to a target project happens through an Orky CLI subprocess (which owns the write). F7's only
filesystem write is its own audit log under `userData` (REQ-013). F7 MUST NOT read a target's `.orky/config.json`
to *decide* the feedback path by parsing it itself if that would duplicate Orky's channel logic — the
authoritative feedback-enabled signal is the emit's returned `mode` (REQ-006/REQ-007).
**Acceptance:** an integration check confirms each fixtured `.orky/` tree is mutated ONLY by the CLI child (no
direct `fs.write` under `.orky/` in F7's code path); the only F7-owned write is `orky-actions.jsonl` under
`userData`; a code review confirms no `writeFile`/`rename`/`rm` targets a `.orky/` path in this feature.

### REQ-020 — Documentation reconciled — `quality`
A feature doc MUST be added under `docs/features/` (e.g. `orky-action-dispatch.md`) and linked from the
CLAUDE.md "Where things live" table; `CHANGELOG.md [Unreleased]` MUST record the first write capability; the
new `orkyAction:*` channels + types MUST be reflected wherever IPC channels are documented; and
`.orky/baseline/architecture.md` MUST be reconciled to note this first write-capable surface (and that it only
ever submits human verdicts/decisions/work through Orky's CLIs, never drives the pipeline). When changing any
existing documented claim, the whole `docs/` tree plus `CLAUDE.md` and `.orky/baseline/` MUST be grepped for
stale phrasings (CONV-008).
**Acceptance:** the feature doc exists and is referenced; `CHANGELOG.md [Unreleased]` mentions the action-dispatch
substrate; `.orky/baseline/architecture.md` names the new write surface; the doc-sync gate passes.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, no `../api`):** request validation + slug confinement (REQ-005/REQ-014),
  root-allowlist matching via `normalizeProjectRoot` (REQ-004), exit-code/JSON → `OrkyActionResult` mapping for
  every branch incl. unparseable/timeout/exit-1-fail (REQ-002/REQ-011), and the feedback-path decision
  (mode `noop` vs `file`/`http` → REQ-006/REQ-007). Inject the CLI-runner as an argument so these are testable
  without spawning real processes (match the `op.ts`/`store/pane-ops.ts` injection pattern CLAUDE.md mandates).
- **Main/integration harness:** drive the dispatcher with fake CLI runners (stubs that emit chosen
  stdout/exit-code/delay) and real `OrkyRegistry` fixtures to assert: sender rejection (REQ-003), root
  allowlist (REQ-004), gate restriction + no `--force` (REQ-008), timeout/abort non-hang (REQ-010), audit-log
  append incl. rejections (REQ-013), per-feature serialization (REQ-015), and the no-direct-`.orky/`-write
  invariant (REQ-019).
- **e2e (Playwright-for-Electron, against `out/`):** confirm the four channels round-trip through
  preload/`api.ts` and that NO new UI renders (REQ-017).

## Open questions

Two items surfaced from reading the Orky CLI source that need coordinator / tests-phase confirmation (neither
blocks writing the spec; each has a stated, testable default above):

1. **Orky CLI location (REQ-012).** Termhalla currently has no resolver for the Orky plugin directory (all
   prior Orky features are read-only file watchers and spawn nothing). The intake references the absolute path
   `C:/dev/Orky/plugin/...`, which is machine-specific. The exact configuration surface (env var vs. a Settings
   field vs. `quick.json`) plausibly overlaps F13 (Settings). Spec assumes a single shared resolver with a
   configured-path-then-default order and a specific `orky-cli-not-found` error; **coordinator should confirm
   whether the config surface is owned here or by F13** so the two don't diverge (CONV-012).
2. **`feedback emit` event shape vs. `applyItems` item shape.** `feedback/cli.js`'s `buildEvent` produces an
   EVENT `{ type, feature, phase, payload }`, but `feedback.js` `applyItems` consumes an ITEM keyed on
   top-level `kind` + `escalationId`/`decision` (decisions) and `title`/`detail`/`priority` (work.request).
   The outbox-event → inbox-item mapping (which lifts `payload` fields and maps `type`→`kind`) is Orky's own
   transport, not F7's, so this spec pins only F7's boundary (invoke `emit` with `--type decision|work.request`
   and a payload carrying `{escalationId, decision}` / `{title, detail, phase}` per D2). **The tests phase
   should verify, against a live Orky feedback round-trip, that these payload field names survive
   emit→apply**; if Orky expects different field names, only the payload construction in REQ-006/REQ-007
   changes (the IPC contract is unaffected). No disagreement with 00-intake.md's description of
   `emit`/`resolve-escalation`/`record`/`drive` was found — the CLI flags and exit codes match the intake.
