# Orky action-dispatch substrate

Termhalla's **first write-capable IPC surface** into an Orky-adopted project. Four `orkyAction:*`
channels let a (future) renderer surface submit human input — resolve an escalation, submit a work
item, record a human gate verdict, or read the pipeline's next-action status — into a project's `.orky/`
run. This feature ships **no renderer UI** (D1): it is the dispatch substrate only. F8/F10/F12 build the
human-facing gestures on top of it.

Every mutation is performed by **invoking Orky's own CLIs** (`feedback emit`, `gatekeeper
resolve-escalation`, `gatekeeper record`) — this feature never writes a file under any `.orky/` tree
itself, never spawns an agent, and never drives the pipeline (D1). The only filesystem write this
feature performs anywhere is its own append-only audit log under Electron `userData`.

## The four actions

| Action | IPC channel | `TermhallaApi` method | CLI invoked |
|---|---|---|---|
| Resolve an escalation | `orkyAction:resolveEscalation` | `orkyResolveEscalation` | `feedback emit --type decision`, falling back to `gatekeeper resolve-escalation` |
| Submit a work item | `orkyAction:submitWork` | `orkySubmitWork` | `feedback emit --type work.request` (no fallback) |
| Record a human gate | `orkyAction:recordHumanGate` | `orkyRecordHumanGate` | `gatekeeper record` |
| Read pipeline status | `orkyAction:driveStatus` | `orkyDriveStatus` | `gatekeeper drive` (read-only) |

All four are renderer → main request/response calls (`ipcMain.handle`); this feature introduces **no**
main → renderer push channel. Every call returns a uniform, discriminated `OrkyActionResult`:

```ts
interface OrkyActionResult {
  ok: boolean
  path: 'feedback' | 'gatekeeper' | null   // which CLI ran; null if rejected before any CLI
  dispatched: boolean                      // did the human input land durably?
  feedback?: 'enabled' | 'disabled'        // present for feedback-capable actions
  exitCode?: number | null
  data?: unknown                           // parsed CLI stdout JSON on success
  error?: string                           // specific + actionable when ok===false
  errorKind?: OrkyActionErrorKind          // set iff ok===false
}
```

### `resolveEscalation` — feedback-first, gatekeeper direct fallback

First attempts `feedback emit --app <projectRoot> --type decision --feature <slug> --payload
{escalationId, decision}`. The emit result's own `ok` field is inspected FIRST, before any `mode`
branching (**ESC-006**): a feedback-emit that exits 0 but whose parsed stdout itself reports
`ok:false` is an INTERNAL error of the feedback CLI (e.g. disk full while spooling) — this returns
`ok:false, path:'feedback', dispatched:false, errorKind:'cli-error', exitCode:0` carrying the CLI's
own error message, and the gatekeeper fallback below is **never** attempted for it. Only when `ok`
is not literally `false` does `mode` branching apply: when `mode !== 'noop'` the decision was
accepted by the live control plane: `path:'feedback', feedback:'enabled', dispatched:true`. When
`mode === 'noop'` (feedback genuinely disabled for the project) it falls back to `gatekeeper
resolve-escalation --feature <featureDir> --id <escalationId> --decision <decision>`, mutating
`state.json`'s escalation directly: `path:'gatekeeper', feedback:'disabled', dispatched:true`.

### `submitWork` — feedback-only; disabled is a distinct, non-silent failure

Invokes `feedback emit --app <projectRoot> --type work.request [--feature <slug>] --payload {title,
detail?, phase?}`. There is **no gatekeeper fallback** for work items (D2). As with
`resolveEscalation`, the emit result's own `ok` field is inspected before `mode` branching
(**ESC-006**): an exit-0 emit whose parsed `ok === false` is an internal feedback-CLI error and
returns `ok:false, path:'feedback', dispatched:false, errorKind:'cli-error', exitCode:0` carrying
the CLI's own error — never the `feedback-disabled` outcome below. Only when `ok` is not literally
`false` and the feedback channel is genuinely disabled (`mode === 'noop'`) does the result become
`ok:false, errorKind:'feedback-disabled', dispatched:false` with a specific, actionable message. It
is never a silent success that discards the human's input.

### `recordHumanGate` — gate restricted server-side, never `--force`

Rejects any `gate` outside `{brainstorm, human-review}` **in the main process**, before invoking any CLI
— independent of (and in addition to) `gatekeeper.js`'s own `HUMAN_GATES` server-side enforcement. On an
allowed gate it invokes `gatekeeper record --feature <featureDir> --gate <gate> --verdict <pass|fail>
[--evidence <evidence>]` — `--force` is **never** appended, a hard-coded absence, not a conditional. A
recorded `pass` (exit 0) and a recorded `fail` (exit 1) are BOTH successful outcomes (`ok:true`, the
verdict lives in `data.passed`); only an exit 2 (thrown) is `errorKind:'cli-error'`.

### `driveStatus` — read-only next-action query

Invokes `gatekeeper drive --feature <featureDir>` (read-only) and returns the raw Gatekeeper `drive`
object verbatim inside `data`. Always `dispatched:false` — it submits nothing, and mutates no `.orky/`
file. Still sender-validated and root-allowlisted like every other action, since it reveals a project's
pipeline state.

## Security layering (every action, in order)

1. **Request validation** (`src/shared/orky-action-validate.ts`) — a non-object request, a missing/
   non-string `projectRoot`, a missing/empty required field, or a malformed enum value each return
   `errorKind:'invalid-args'` with a field-specific message. Never throws.
2. **Server-side project-root allowlist (D3)** — every `projectRoot` is checked against
   `OrkyRegistry.roots()` (the persisted explicit list, feature 0005) using the shared
   `normalizeProjectRoot` comparison key (`src/main/orky/validate-root.ts`) so a case-/slash-divergent but
   physically identical spelling still matches. A root not on the list is rejected
   `errorKind:'root-not-allowed'` — never trusting the renderer-supplied path, and never the pane-only
   membership.
3. **Feature-slug confinement** — the target feature directory is always built server-side as
   `join(projectRoot, '.orky', 'features', <slug>)`. `slug` must be a single, non-empty path segment
   (no `/`, `\`, `..`, or absolute-path form); a slug that does not resolve to an existing feature
   directory returns `errorKind:'feature-not-found'`.
4. **CLI location resolution** (`src/main/orky/orky-cli-locate.ts`) — a single shared `locateOrkyCli(kind,
   env?, exists?)` resolver. Resolution order: the `ORKY_PLUGIN_DIR` environment variable →
   `join(dir, kind, 'cli.js')`, existence-checked → else `null`. There is **no** default path assumed
   valid on an arbitrary machine — an unset/misconfigured `ORKY_PLUGIN_DIR` yields the honest
   `errorKind:'orky-cli-not-found'` with an actionable message naming the missing kind, rather than a
   guess that silently succeeds on one dev box and fails everywhere else.
5. **Per-featureDir mutation serialization** (`src/main/orky/orky-action-queue.ts`) — because
   `gatekeeper record`/`resolve-escalation` perform a non-atomic read-modify-write of `state.json`, two
   mutating actions targeting the SAME resolved `featureDir` are serialized through a per-key promise
   chain (`OrkyActionQueue`) so a concurrent submission can never lose the other's update. Actions on
   DIFFERENT feature dirs run without serializing against each other; read-only `driveStatus` bypasses the
   queue entirely.
6. **Abortable, `unref()`'d, timeout-bounded CLI invocation** (`src/main/orky/orky-cli-runner.ts`) —
   `execFile(process.execPath, [cliPath, ...args], {timeout, windowsHide:true, maxBuffer, signal})`, an
   **argument array only** (never `shell:true`, never string concatenation — no shell-injection surface),
   `child.unref()` immediately after spawn, and an `AbortController` wired so an in-flight child is
   aborted on dispatcher `dispose()`. A timed-out/aborted child resolves the action (never hangs/rejects)
   as `errorKind:'cli-timeout'`.
7. **Total exit-code + stdout-JSON mapping** (`src/shared/orky-action-result.ts`,
   `mapCliRunToResult`) — a pure function mapping every documented `(cliKind, action, exitCode)` branch
   plus a defensive catch-all for any undocumented exit code. Non-JSON/empty/non-object stdout maps to
   `errorKind:'cli-unparseable'`, never a throw and never an assumed success.

## Action surface is exactly four commands (D1 scope guard)

The dispatcher (`src/main/orky/orky-action-dispatcher.ts`) may invoke ONLY the four hard-coded Orky
subcommands `emit`, `resolve-escalation`, `record`, `drive` — never `loopback`, `escalate`, `check`,
`probe`, `can-advance`, `record-implementer`, `heartbeat`, `enable-feedback`, or `disable-feedback`. No
renderer-supplied request field ever selects a subcommand string; the subcommand is a literal per action.
This feature never spawns a Claude/Orky agent and never runs or resumes any pipeline phase.

## Audit log

Every action invocation that reaches the dispatcher — a success **or** a dispatcher-level rejection
(`root-not-allowed`, `feature-not-found`, `gate-not-allowed`, `invalid-args`, `orky-cli-not-found`,
`cli-error`, `cli-timeout`, `cli-unparseable`) — appends one JSON record to an append-only
**`orky-actions.jsonl`** file under Electron `userData` (`src/main/orky/orky-action-audit.ts`,
`OrkyActionAuditLog`), capturing `ts`, `windowId`, `action`, `projectRoot`, `feature` (when present), a
redaction-safe `argsSummary`, and the outcome (`ok`, `path`, `dispatched`, `errorKind`, `exitCode`).
Structural fields (`feature`/`gate`/`verdict`/`escalationId`/`phase`) are copied verbatim into
`argsSummary`; free-text human-authored fields (`decision`/`title`/`detail`/`evidence`) are captured as
`<field>Length: number` only — the raw text is never written to the log.

A sender rejected at the IPC-registrar boundary (`errorKind:'unknown-sender'`, `register-orky-action.ts`)
is turned away **strictly before** the dispatcher is ever invoked, so it is **not** audited — the
registrar owns that rejection and never references the audit log; the audit log lives only inside the
dispatcher.

The write is a single atomic `fs.appendFile` line — never a rewrite that could truncate the log — and is
best-effort: a write failure is logged (`console.error`) but never fails the action nor alters its
returned result. There is no cap, rotation, or truncation of the file.

## No direct `.orky/` write (REQ-019)

This feature's ONLY filesystem write, anywhere, is its own `orky-actions.jsonl` audit log under
`userData`. Every `.orky/` mutation happens inside an Orky CLI child process, which owns the write —
the dispatcher itself never calls `writeFile`/`appendFile`/`rename`/`rm`/`unlink` against any `.orky/`
path.

## Architecture

| Concern | Location |
|---|---|
| Shared action types (`OrkyActionResult`, the 4 request types, `OrkyActionErrorKind`) | `src/shared/types.ts` |
| Pure request validation (feature-slug confinement, malformed-input tolerance) | `src/shared/orky-action-validate.ts` |
| Pure exit-code/stdout-JSON → `OrkyActionResult` mapping | `src/shared/orky-action-result.ts` |
| Orky CLI location resolver (`ORKY_PLUGIN_DIR`) | `src/main/orky/orky-cli-locate.ts` |
| Abortable/`unref()`'d CLI-runner | `src/main/orky/orky-cli-runner.ts` |
| Append-only audit-log writer | `src/main/orky/orky-action-audit.ts` |
| Per-`featureDir` mutation-serialization queue | `src/main/orky/orky-action-queue.ts` |
| Dispatcher service (the 4 actions) | `src/main/orky/orky-action-dispatcher.ts` |
| IPC channels + `TermhallaApi` methods | `src/shared/ipc-contract.ts` (`orkyAction:resolveEscalation`/`submitWork`/`recordHumanGate`/`driveStatus`) |
| IPC registrar | `src/main/ipc/register-orky-action.ts` |
| Composition root (single instance, disposal) | `src/main/services.ts`, `src/main/ipc/register.ts` |
| Preload bridge | `src/preload/index.ts` |

Constructed once in `services.ts`, wired to the SAME app-wide `OrkyRegistry` instance feature 0005 already
built (no second registry, no duplicated allowlist). Owned solely by `register-orky-action.ts`;
`register.ts` calls `dispose()` once, aborting any in-flight CLI child so the app can `close()` promptly.
