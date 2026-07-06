# Plan — 0024-agent-daemonization (revision 3)

**Phase:** 3 (plan), re-run after the second loop-back to spec (ESC-002 → spec revision 3,
REQ-003 amended + new REQ-019).
**Inputs:** `02-spec.md` revision 3, `01-concept.md` (D6′/D4′/D10), `findings.json` (this
revision must retire FINDING-022 (open, HIGH/contract-violation) and FINDING-023 (open, MEDIUM,
human-decided D10) — every other finding is already `resolved` against revision 2 and is NOT
re-litigated here), the round-1/round-2 implementation already on disk (everything revision-2's
plan enumerated: `src/agent/{args,daemon-constants,daemon-guard,daemon-lifecycle,daemon-server,
spawn-daemon,bridge,main}.ts`, `src/shared/remote/daemon-handshake.ts` (+ `protocol.ts`
re-export), `src/remote-client/{ws-token,ssh-command,bridge-status,classify,bootstrap-daemon,
bootstrap}.ts`, `src/main/remote/remote-workspace-manager.ts`). No `architecture.md` brownfield
baseline applies beyond the repo's own trees.

Revision 3 does NOT start over: every task below is an in-place AMENDMENT of an existing module
(TASK-004/006, carried over renumbered as amendment notes) or a NEW, narrowly-scoped task
(TASK-020..024) for the two things revision 2 did not yet cover. Tasks 001–019 from revision 2 are
carried forward unchanged (already implemented, already satisfy their REQs) and are summarized,
not repeated in full, below; see the revision-2 plan history for their original prose if needed.

## Target layout (amendments over the existing tree, revision 3 deltas only)

```
src/agent/
  daemon-guard.ts        (CHANGED — FINDING-022: the REQ-003 over-long-socket-path guard
                           (Buffer.byteLength(path,'utf8') > AF_UNIX_PATH_MAX -> named error) is
                           extracted into ONE shared exported helper, e.g. `checkSocketPathLength
                           (socketPath): DaemonGuardError | null`, callable from BOTH the pure
                           bootstrap seam AND the production bind path — single source of truth,
                           no duplicated limit constant)
  daemon-server.ts        (CHANGED — FINDING-022: `claimSocket`/`listenOnce` (the production bind
                           sequence) call the TASK-020 shared guard FIRST, before any claim/reclaim
                           attempt or retry loop; a failing guard exits the daemon nonzero with the
                           named error on stderr/daemon-log — never a raw EINVAL/ENAMETOOLONG
                           swallowed into the 200-attempt loop, never a silent exit 0;
                           `bootstrapDaemonEndpoint` (the pure seam) is changed to CALL the same
                           shared helper rather than reimplementing the check, so the two can never
                           diverge again)

src/renderer/store/
  internals.ts            (CHANGED — REQ-019: new pure exported core
                           `planWorkspaceTeardown({ isRemote, paneIds }): { kill: string[]; detach:
                           boolean }` — injectable-shape decision only, no `api`/renderer import
                           (repo's renderer-injection convention): a remote workspace yields
                           `{ kill: [], detach: true }`; a local workspace yields `{ kill: paneIds,
                           detach: false }`. `teardownPanes`/`clearPaneRuntime` unchanged.)
  store.ts                (CHANGED — REQ-019: `closeWorkspace` consumes `planWorkspaceTeardown`:
                           for a LOCAL workspace, behavior is byte-identical to today
                           (`teardownPanes(paneIds)`, no detach call); for a REMOTE workspace, ZERO
                           `teardownPanes`/`ptyKill` calls — instead `disconnectRemote(id, { forget:
                           true })` (TASK-022's additive param) then `pruneRemoteStates(...)`, kept
                           in the SAME literal order `disconnectRemote(` → `pruneRemoteStates(` the
                           TEST-2283 pin already checks, so the source-order pin needs no rewording
                           if the collision survey's assumption holds — see TASK-021 acceptance)
  remote-slice.ts          (CHANGED — REQ-019: `disconnectRemote(workspaceId, opts?: { forget?:
                           boolean })` threads the optional `opts` through to `deps.remoteDisconnect`
                           unchanged in shape for every existing call site (opts omitted
                           everywhere else — banner disconnect, app quit path — stays
                           byte-identical))

src/shared/ipc-contract.ts (CHANGED — REQ-019, additive only: `remoteDisconnect(workspaceId:
                           string, opts?: { forget?: boolean }): void` on `TermhallaApi`; the
                           `remote:disconnect` channel name/direction is unchanged — no new
                           channel)
src/preload/index.ts       (CHANGED — REQ-019: `remoteDisconnect: (workspaceId, opts) =>
                           ipcRenderer.send(CH.remoteDisconnect, workspaceId, opts)` — additive
                           trailing arg, every existing one-arg call site keeps working)
src/main/ipc/register-remote.ts (CHANGED — REQ-019: the `remote:disconnect` listener reads an
                           optional second IPC arg and passes it through to
                           `manager.disconnectWorkspace(workspaceId, opts)`)
src/main/remote/remote-workspace-manager.ts (CHANGED — REQ-019: `disconnectWorkspace(workspaceId,
                           opts?: { forget?: boolean })`: unchanged teardownWire/markDisconnected
                           sequence; the existing `if (entry.panes.size === 0) this.entries.delete
                           (workspaceId)` forget-guard gains `|| opts?.forget` so a close-tab-shaped
                           disconnect ALWAYS forgets the entry even with panes still tracked (the
                           daemon + its PTYs are a SEPARATE process — forgetting local bookkeeping
                           does not touch them); every other caller (banner disconnect, `stop()`)
                           passes no `opts` and is byte-identical)

docs/
  CLAUDE.md, docs/features/remote-agent.md, docs/features/remote-workspaces.md,
  .orky/baseline/ (grep-located)   (CHANGED — amend TASK-019's doc-sync pass to additionally state
                                     the THREE-GESTURE survival story (D10/REQ-019): quit-app,
                                     banner-disconnect, and close-tab all detach; closing an
                                     individual pane remains a deliberate kill)

tests/fixtures/fake-ssh.mjs   (no NEW rig required for REQ-019 beyond what TASK-017 already
                                planned — the close-tab scenario reuses the existing persistent
                                per-`wsToken` daemon rig; tests-phase discretion)
```

No `src/renderer/` UI/component change, no new IPC channel, no `SCHEMA_VERSION` bump (REQ-014,
carved out for exactly this REQ-019 routing per the spec's amended confinement).

## Tasks carried forward unchanged from revision 2 (already implemented; not re-run)

TASK-001 (`--ws` CLI surface) · TASK-002 (workspace-keyed daemon-tree constants) · TASK-003
(established-connection COUNT lifecycle) · TASK-004 (serialized single-instance/reclaim guard —
AMENDED below by TASK-020, see note) · TASK-005 (detached spawn: log-routed stdio, `--ws`
forwarding) · TASK-006 (atomic-0600 bind, byte-accurate path guard, capped log, workspace-keyed
paths — AMENDED below by TASK-020) · TASK-007 (bridge: delete unguarded reclaim, workspace-keyed
paths, `daemonProto`, `--ws` forwarding) · TASK-008 (agent entry arg threading) · TASK-009
(additive protocol-range daemon-flow handshake + `DAEMON_PROTO_COMPAT`) · TASK-010 (workspace-scope
token derivation) · TASK-011 (daemon-flow launch command gains `--ws`) · TASK-012 (bridge status
parser gains `daemonProto`) · TASK-013 (`daemon-protocol-drift` classification) · TASK-014
(daemon-flow connect leg: relaxed handshake, raw-stderr status parse, `--ws` threading) · TASK-015
(opt-in wiring gains the workspace scope) · TASK-016 (production wiring passes the workspace id) ·
TASK-017 (sanctioned fake-ssh shim amendment) · TASK-018 (end-to-end survival composition incl.
same-host coexistence).

Each satisfies the REQ(s) recorded for it in `traceability.json` (unchanged from revision 2 for
REQ-001/002/004..013/015/016/018).

## New / amended tasks (revision 3)

### TASK-004 (amended) — Serialized single-instance/reclaim guard now also exports the shared over-long-path check
In addition to revision 2's scope (FINDING-006: reclaim inside one serialized critical section;
ownership-checked cleanup; FINDING-018 manual-recovery wording), `src/agent/daemon-guard.ts` gains
one new exported function, `checkSocketPathLength(socketPath): DaemonGuardError | null` —
`Buffer.byteLength(socketPath, 'utf8') > AF_UNIX_PATH_MAX` → the named path-and-limit error object;
otherwise `null`. This is the ONE implementation FINDING-022 requires; both the pure bootstrap seam
and the production bind path (TASK-006 amendment) call it — never a re-derived copy of the byte
comparison or the limit constant.
**Files:** `src/agent/daemon-guard.ts`.
**Depends on:** none (extends the existing module).
**Satisfies:** REQ-003.

### TASK-006 (amended) — Production bind path calls the shared over-long-path guard BEFORE any claim/reclaim attempt
`src/agent/daemon-server.ts`'s real `claimSocket`/`listenOnce` sequence calls
`checkSocketPathLength` (TASK-004's new export) as its FIRST step, before the probe/pid-liveness/
reclaim loop begins: on a violation the daemon exits nonzero with the named error written to its
diagnostic sink (stderr when run directly, the daemon log when detached per REQ-004) — never
iterating the claim loop, never exiting 0 silently. `bootstrapDaemonEndpoint` (the pure seam) is
changed from its own inline byte-length comparison to CALLING the same shared helper, so seam and
production are provably the same code path (a structural/unit test asserts this — e.g. both resolve
to the same function reference, or a single shared unit test suite drives both entry points through
one assertion table). Every other revision-2 responsibility of this file (umask-atomic 0600 bind,
capped log, workspace-keyed paths, real establishment/end signal wiring, the relaxed daemon-flow
handshake composition) is unchanged.
**Files:** `src/agent/daemon-server.ts`.
**Depends on:** TASK-004 (amended).
**Satisfies:** REQ-003.
**Acceptance (FINDING-022 vectors, from the spec):** a POSIX-guarded (`describe.skipIf(win32)`)
integration test drives the REAL daemon entry/production bind path with an over-long socket path
and asserts a PROMPT nonzero exit — no claim-loop retries, well under `DAEMON_SPAWN_WAIT_MS` — whose
diagnostic output contains the named path-and-limit error (never EINVAL/ENAMETOOLONG, never exit
0); a structural/unit assertion proves the production bind path and the bootstrap seam invoke the
SAME shared guard implementation.

### TASK-020 — (folded into TASK-004/006 above; no separate task) — intentionally not used
Reserved: revision 3's FINDING-022 fix is expressed as amendments to the existing TASK-004/006
(the module boundaries revision 2 already established) rather than a new module, per the plan
rule "prefer the smallest plan that satisfies the spec." No TASK-020 module is created.

### TASK-021 — Pure teardown-routing core: remote workspace close detaches, local is unchanged
New pure, exported decision core in `src/renderer/store/internals.ts` (or a small sibling module
if that file is judged too large — implementer's call, kept under `store/`):
`planWorkspaceTeardown({ isRemote }): { paneKillIds: string[]; detach: boolean }` shape (exact
signature is an implementation detail; the OBSERVABLE contract is what the acceptance vectors
below pin) — takes the workspace's `paneIds` and its `isRemote` flag (derived from `ws.home`
truthiness, matching the existing `if (ws.home)` check) and returns which panes to kill locally
(none for remote, all for local) and whether to detach (remote only). Must not import
`renderer/api` (the repo's renderer-pure-logic convention — inject the actual kill/detach
functions as arguments at the call site in `store.ts`, per `op.ts`/`store/pane-ops.ts`'s
established pattern).
Change `closeWorkspace` in `store.ts` to consume this core: a LOCAL workspace close is
BYTE-IDENTICAL to today (`teardownPanes(paneIds)`, no detach, no `disconnectRemote` call); a
REMOTE workspace close issues ZERO `teardownPanes`/`ptyKill` calls and instead calls
`disconnectRemote(id, { forget: true })` (TASK-022) then `pruneRemoteStates(...)` — preserving the
literal source order `disconnectRemote(` → `pruneRemoteStates(` that TEST-2283 pins (per the
collision survey: if the extracted-core routing can no longer satisfy that literal order, the pin
is a SANCTIONED tests-phase amendment under CONV-012 — not a silent implementation-time rewrite).
The renderer still runs `clearPaneRuntime`/other per-workspace cleanup exactly as today for both
branches (corollary (c) — no leaked pane runtime, no ghost remote state).
**Files:** `src/renderer/store/internals.ts` (or a new sibling pure module), `src/renderer/store.ts`.
**Depends on:** TASK-022 (the `disconnectRemote`/`remote:disconnect` additive param it calls).
**Satisfies:** REQ-019 (a, b, c).
**Acceptance:** a unit test on the extracted pure core (injected kill/detach functions) asserts a
remote workspace close issues zero kill calls and exactly one detach call while local issues one
kill per pane and no detach; `closeWorkspace`'s existing local-path behavior is asserted
byte-identical (REQ-019 corollary (a)); closing an individual remote PANE (not the tab) is
unaffected (`closePane` is untouched — corollary (b)).

### TASK-022 — `remote:disconnect` gains one additive optional `{ forget }` parameter; main-side manager always-forgets on it
Thread one additive optional parameter end-to-end through the EXISTING `remote:disconnect`
surface — no new channel:
- `src/shared/ipc-contract.ts`: `remoteDisconnect(workspaceId: string, opts?: { forget?: boolean
  }): void` on `TermhallaApi`; channel name/direction unchanged.
- `src/preload/index.ts`: pass the optional second arg through `ipcRenderer.send`.
- `src/main/ipc/register-remote.ts`: read an optional second IPC arg (validated: an object with an
  optional boolean `forget`, anything else ignored/treated as absent — never trusted blindly from
  the renderer beyond that shape) and pass it to `manager.disconnectWorkspace`.
- `src/main/remote/remote-workspace-manager.ts`: `disconnectWorkspace(workspaceId, opts?: {
  forget?: boolean })` — the teardownWire/markDisconnected sequence is UNCHANGED; only the existing
  `if (entry.panes.size === 0) this.entries.delete(workspaceId)` guard gains `|| opts?.forget` so a
  close-tab-shaped disconnect always forgets the manager's entry (no ghost in
  `currentStates()`/`remote:current`) even though its panes are still tracked (never killed) — the
  daemon and its PTYs are a separate process untouched by forgetting local bookkeeping.
- `src/renderer/store/remote-slice.ts`: `disconnectRemote(workspaceId, opts?)` threads `opts`
  through to `deps.remoteDisconnect` unchanged for every existing call site (banner disconnect
  passes no `opts`, byte-identical).
Every existing call site (banner disconnect, any other `disconnectRemote`/`remote:disconnect`
caller) passes no `opts` and stays byte-identical; only TASK-021's remote close-tab path passes
`{ forget: true }`.
**Files:** `src/shared/ipc-contract.ts`, `src/preload/index.ts`, `src/main/ipc/register-remote.ts`,
`src/main/remote/remote-workspace-manager.ts`, `src/renderer/store/remote-slice.ts`.
**Depends on:** none (extends existing surfaces additively).
**Satisfies:** REQ-014 (confinement — additive optional param only), REQ-019 (d).
**Acceptance:** a main-side manager unit test (canned transport, `remote-manager-routing` style)
asserts: `disconnectWorkspace(id)` (no opts) with tracked panes keeps the entry (unchanged
behavior); `disconnectWorkspace(id, { forget: true })` with tracked panes REMOVES the entry from
`currentStates()` while sending NO `pty:kill` frame on the wire and ending the connection normally
(teardownWire); every existing `remote-manager-routing`/`register-remote` test passes unamended (no
opts arg supplied ⇒ identical to today).

### TASK-023 — Fake-lane end-to-end: close-tab-shaped teardown survives; no-reopen idles out
A fake-lane integration scenario (reusing the TASK-017 persistent per-`wsToken` daemon rig — no
NEW fake-ssh rig anticipated) drives: connect → spawn a pane → produce output → a close-tab-shaped
teardown (TASK-021/022's routing: zero kill frames, one detach) → assert the daemon pid stays
alive and the pane keeps running → reconnect with the SAME `wsToken` → `pty:sessions` lists the
pane and the F18 byte-exact composition oracle passes on reattach. A second, no-reopen variant
observes the daemon idle-reap (socket + metadata gone, pid dead) once its established-connection
count reaches zero and its idle timeout elapses — synchronized on observed signals, never a bare
sleep (CONV-062).
**Files:** none new anticipated in `src/` (test-only; `tests/` is out of this phase's scope per
CONV-012 — listed here only so REQ-019 traces to a task).
**Depends on:** TASK-017, TASK-018, TASK-021, TASK-022.
**Satisfies:** REQ-015 (composition, unchanged), REQ-019.

### TASK-019 (amended) — Doc-sync additionally states the three-gesture survival story
In addition to revision 2's scope (retire "not daemonized" claims; state the per-workspace daemon
model and the proto-versioning rule), the same doc-sync pass over `CLAUDE.md`,
`docs/features/remote-agent.md`, `docs/features/remote-workspaces.md` MUST additionally state the
THREE-GESTURE survival story (D10/REQ-019): quit-app, banner disconnect, AND closing the workspace
tab all DETACH — a tab close never kills remote panes, reopening reattaches, and an unreopened
workspace's daemon idle-reaps; closing an individual remote pane remains a deliberate kill. Keep
`tests/docs-feature-0022.test.ts` green (still requires the word `daemon` in
`remote-workspaces.md`); amend `docs-feature-0017.test.ts`/`docs-feature-0022.test.ts` pins only if
a pinned phrase must literally change (enumerated at the red gate, CONV-059).
**Files:** `CLAUDE.md`, `docs/features/remote-agent.md`, `docs/features/remote-workspaces.md`, any
other grep hit under `docs/`/`.orky/baseline/`.
**Depends on:** TASK-006 (amended), TASK-016, TASK-018, TASK-021, TASK-022, TASK-023 (the shipped
three-gesture shape being documented).
**Satisfies:** REQ-017.

## Ordering summary (revision 3 deltas; revision-2 ordering for TASK-001..018 is unchanged and
already satisfied)

1. TASK-004 (amended), TASK-006 (amended) — FINDING-022 fix, parallel-safe with the REQ-019 track.
2. TASK-022 (additive `remote:disconnect` param + main-side manager forget-guard) — parallel-safe
   with 1.
3. TASK-021 (renderer pure teardown-routing core + `closeWorkspace` wiring) — depends on TASK-022.
4. TASK-023 (fake-lane end-to-end, close-tab survival + no-reopen idle-reap) — depends on
   TASK-017/018/021/022.
5. TASK-019 (amended) (doc-sync, last) — depends on everything above plus the carried-forward
   revision-2 shape.

## Findings retired by this plan (revision 3 delta)

- FINDING-022 (production over-long-path guard is test-seam-only; production loops/silently
  exits 0) → TASK-004 (amended, shared export) + TASK-006 (amended, production wiring +
  POSIX integration vector).
- FINDING-023 (close-tab silently `pty:kill`s remote panes — the third going-away gesture was
  never routed through detach) → TASK-021 (renderer routing) + TASK-022 (main-side additive
  `{forget}` param + manager forget-guard) + TASK-023 (end-to-end proof).

All other findings (001–021, excluding 022/023) are `resolved` against revision 2 and are not
re-litigated by this revision — see `findings.json`.

## Open issues

None — every REQ-001..019 maps to at least one task (see `traceability.json`); REQ-003's
FINDING-022 gap and REQ-019 (new) are both closed by this revision's task set.
