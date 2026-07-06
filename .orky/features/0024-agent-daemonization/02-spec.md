# Spec — 0024-agent-daemonization

**Phase:** 2 (spec). **Date:** 2026-07-06. **Revision 3** (loop-backs per ESC-001 / review
round 1 and ESC-002 / review round 2).
**Inputs:** `00-intake.md`, `01-concept.md` (locked D1–D9 plus the post-review refinements **D6′**
per-workspace daemon+socket, **D4′** protocol-version decoupling, and **D10** close-tab detaches;
open questions 1–4 decided in this document), `.orky/conventions.md`, `.orky/baseline/` (no
baseline REQ-001..024 touches the remote stack — nothing is superseded; the shipped remote-stack
contracts touched here are governed by the frozen F16/F17/F18/F19/F20/F21/0023 suites, surveyed
below).

**Revision 2 amendments (traceability):** REQ-003 (FINDING-005 umask-atomic 0600; FINDING-007
byte-measured AF_UNIX limit; metadata gains `proto`), REQ-004 (FINDING-010/015 in-generation log
size cap; FINDING-011 crash-output-to-log spawn spec), REQ-005 (D6′ per-workspace scope;
FINDING-006 reclaim inside the serialized critical section + ownership-checked cleanup), REQ-006
(FINDING-008 established-connection COUNT, precise establishment/end naming per FINDING-012),
REQ-007 (FINDING-016 bridge never removes — the daemon's serialized claim owns all reclaim;
FINDING-018 pid-reuse wedge disclosed), REQ-009 (D6′ `--ws` in the launch command; status line
gains `daemonProto`; FINDING-017 parse robustness), REQ-011 (`--ws` forwarding), REQ-012 (rewritten
per D4′ — protocol-range reattach, auto-update survival), REQ-013 (workspace-scoped option),
REQ-014/REQ-016/REQ-017 (propagation), **REQ-018 (new — same-host workspace coexistence,
FINDING-013/FINDING-009)**. No REQ renumbered or removed.

**Revision 3 amendments (traceability):** REQ-003 (FINDING-022 — the over-long-path guard is ONE
shared implementation enforced on the PRODUCTION bind path, failing fast with the named error
BEFORE any claim/reclaim loop, never a raw EINVAL/ENAMETOOLONG swallowed into retries or a silent
exit 0; new POSIX integration vector on the real bind path), **REQ-019 (new — locked D10,
FINDING-023: closing a remote workspace tab DETACHES — never `pty:kill` — completing the survival
story across all three going-away gestures)**, REQ-014 (confinement carved out for exactly the
REQ-019 detach routing), REQ-016 (posture: the new POSIX vector; sanctioned-amendment discipline
extended to the TEST-2283 collision), REQ-017 (docs must state the three-gesture survival story),
collision survey re-run (`closeWorkspace`/`teardownPanes` pins added). No REQ renumbered or
removed.

## Concerns

`["networking", "security", "determinism", "enterprise-arch"]`

## Problem statement

The v1 remote agent is not daemonized (the CONV-054-disclosed limitation in
`docs/features/remote-workspaces.md`): it runs as a child of the SSH stdio exec channel, so
closing Termhalla tears the tunnel down, the agent exits, and its session store — every remote
PTY, including a running `claude` — dies with it. On reconnect `pty:sessions` is empty and every
pane surfaces as exited. This feature detaches the agent from any single SSH session (a
persistent **per-workspace** daemon listening on a unix-domain socket under the agent dir, tmux
model), makes each SSH exec channel a thin byte-transparent bridge to that socket, and thereby
makes the ALREADY SHIPPED F18 inventory/replay reattach path work across a client close/reopen —
true disconnect/close/reopen survival, **including across a routine Termhalla auto-update**
(close → update → reopen is the default client lifecycle) and **across every going-away gesture**
(quit the app, banner disconnect, close the workspace tab — D10). Not host-reboot survival.

## Definitions (contract constants — names indicative, exported values are the contract)

| Term | Value |
|---|---|
| Agent dir | the directory containing the running artifact (production: `~/.termhalla/agent`, the F19 `DEFAULT_REMOTE_AGENT_DIR`); the daemon's socket/metadata/log default to living beside the artifact |
| Workspace scope token (`wsToken`) | a deterministic, reconnect-stable token derived client-side from the Termhalla workspace id, matching `^[A-Za-z0-9_-]{1,64}$` (a conforming workspace id is used as-is; a non-conforming id maps deterministically into the charset — derivation mechanism is a plan detail; the observable contract is: same workspace ⇒ same token on every reconnect, distinct workspaces ⇒ distinct tokens). Carried to the remote via the `--ws=<token>` flag |
| Socket path | `<agentDir>/agent-<wsToken>.sock` — **workspace-keyed** (locked D6′) and **version-stable** (no app or protocol version in the name, locked D4/D4′); overridable via `--socket=<path>` (tests; named-pipe paths on win32) |
| Daemon metadata file | `<agentDir>/daemon-<wsToken>.json` — `{ formatVersion: 1, pid, version, proto, backend, startedAt }` (`version` = the daemon's app version, `proto` = its wire-protocol version), a **cross-version frozen shape** (a newer client must be able to read an older daemon's file); no other fields, no secrets, no host identity |
| Daemon log | `<agentDir>/daemon-<wsToken>.log` — the detached daemon's diagnostics sink, truncated at each daemon start AND size-capped within a generation at `DAEMON_LOG_MAX_BYTES` = 1 048 576 (CONV-003 — a long-lived daemon's generation is wall-clock unbounded, so per-generation truncation alone is not a bound); NEVER contains PTY payload bytes or user keystrokes |
| Wire-protocol version | the existing F15 hello `proto` field (`WIRE_PROTO`, currently `1`) — **decoupled from the app version** (locked D4′). Any wire-visible protocol change (frame type, method, field semantics) MUST bump it; app releases that do not change the wire MUST NOT |
| Compatible protocol range | `DAEMON_PROTO_COMPAT` — the set/range of peer `proto` values a daemon-flow endpoint accepts (v1: exactly `{ WIRE_PROTO }` = `{1}`; the RANGE machinery is the contract so a future bump can keep a compatibility window) |
| Idle timeout | `DAEMON_IDLE_TIMEOUT_DEFAULT_MS` = 300 000 (5 min), overridable via `--idle-timeout-ms=<n>` (positive integer; anything else is a usage error, exit 2) |
| Spawn-readiness deadline | `DAEMON_SPAWN_WAIT_MS` = 10 000 — the bridge's bounded wait for a just-spawned daemon's socket to accept |
| Bridge sentinel exit | `BRIDGE_DAEMON_UNREACHABLE_EXIT` = 96 — the bridge could not reach a listening daemon (spawn failed, readiness deadline expired, or connect refused); distinct from 127/93/94/95/12 and from the agent's 0/1/2 |
| Bridge status line | exactly one machine-parseable stderr line, prefix `TERMHALLA_BRIDGE_V1 ` + JSON `{ spawned: boolean, daemonVersion: string \| null, daemonProto: number \| null, daemonPid: number \| null }` (from the metadata file; `null`s when unreadable), emitted before piping begins |
| Daemon flow | the opt-in launch path: remote command `test -f <path> && exec node <path> --attach --pty=<backend> --ws=<token> || exit 127` (REQ-009) instead of the direct-exec F19 shape |
| CLI modes | default (no mode flag) = the F16 stdio agent, byte-identical; `--daemon` = the persistent listener; `--attach` = the bridge. Mutually exclusive; combining them is a usage error (exit 2). `--daemon`/`--attach` each require a scope: `--ws=<token>` (derives socket/metadata/log names) or an explicit `--socket=<path>`; neither present is a usage error (exit 2) |

Decisions of record for the concept's deferred questions:
1. **Cross-version reattach (concept Q1 — decided by D4′, superseding revision 1's
   same-version-bounded answer):** the wire-protocol version (the F15 hello `proto`) is decoupled
   from the app version, and the **daemon-flow** handshake establishes on protocol compatibility
   ONLY — a peer `proto` within the compatible range — never on app-version string identity. A
   routine auto-update (app version bumps, `proto` unchanged) therefore reattaches and sessions
   survive: the motivating close→update→reopen flow works. Only a genuinely protocol-breaking
   release drifts, and drift is refused non-destructively (REQ-012). The existing exact-version
   handshake machines and the default stdio mode are unchanged (additive relaxation — REQ-012,
   REQ-014); F19's provisioning classification is untouched.
2. **Idle timeout (Q2):** default 5 minutes, a named exported constant, configurable only via the
   daemon CLI flag (no user-facing setting in v1) — REQ-006.
3. **Single-instance mechanism (Q3):** the spec fixes the observable guarantee (REQ-005, with a
   mandatory interleaved vector per CONV-060) plus the reclaim discipline (all remnant removal
   inside the same serialized critical section that re-binds, ownership-checked cleanup —
   CONV-045); the mechanism (O_EXCL lock file with pid-liveness reclaim vs. equivalent) is a plan
   detail.
4. **Client change scope (Q4):** confined to `src/remote-client/` (launch command, bridge-aware
   classification, the drift outcome), additive vocabulary in the `src/shared/remote/` protocol
   barrel (the relaxed daemon-flow handshake variant + the compat-range constant), and
   `src/main/remote/` wiring (the daemon option + workspace id pass-through) — no renderer,
   preload, IPC, or `SCHEMA_VERSION` change (REQ-013/REQ-014). **Amended in revision 3 (D10):**
   plus exactly the REQ-019 close-tab detach routing (the `closeWorkspace` teardown path in the
   renderer store, and at most an additive optional parameter threaded through the EXISTING
   `remote:disconnect` surface) — no new channel, no new renderer UI; see REQ-014's amended
   confinement.

---

## A — Daemon runtime (the agent artifact, remote side)

### REQ-001 — Additive CLI modes; the shipped stdio contract stays byte-identical
The agent artifact MUST gain `--daemon`, `--attach`, `--ws=<token>`, `--socket=<path>`, and
`--idle-timeout-ms=<n>` as strictly additive CLI surface. With NO mode flag the process MUST
behave byte-identically to the shipped F16 stdio agent (hello-first exact-version handshake,
stdin end → kill panes → exit 0, exit taxonomy 0/1/2, stdout frames-only). Mutually exclusive
mode flags, a `--daemon`/`--attach` without a scope (`--ws` or `--socket`), a `--ws` token not
matching `^[A-Za-z0-9_-]{1,64}$`, a non-positive/non-integer `--idle-timeout-ms`, and unknown
flags MUST fail as usage errors (usage on stderr, exit 2, nothing on stdout — the existing
contract). `--pty=` keeps its existing semantics in every mode; `--attach` additionally forwards
`--ws`/`--pty`/`--idle-timeout-ms`/`--socket` to any daemon it spawns (REQ-011).
**Acceptance:** the frozen agent suites (`tests/agent-stdio-roundtrip.test.ts`,
`agent-stdio-flow.test.ts`, `agent-stdio-attach.test.ts`, `agent-args-validate.test.ts`
TEST-759, `agent-structure.test.ts`) pass with ZERO edits (TEST-759's exact `toEqual` pins
require any new `AgentArgs` fields to be absent/`undefined` for legacy inputs — see the collision
survey). New unit vectors: each new flag parses; `--daemon --attach` → exit-2 usage naming the
conflict; `--daemon` with no scope → exit-2 naming the missing scope; `--ws=../evil`,
`--ws=` and a 65-char token → exit-2 naming the offending token (CONV-001/CONV-002);
`--idle-timeout-ms=0`/`-5`/`abc` → exit-2 usage naming the offending value; default mode with the
new parser is `{ ok: true, ptyBackend: 'node-pty' }`-compatible.

### REQ-002 — The daemon is the survival composition; no connection end ever exits it
In `--daemon` mode the process MUST own exactly ONE process-lifetime session store (the F18
survival composition — pane PTY handles, bounded `@xterm/headless` replay terminals, the status
engine, cached cwd/status/dims) and serve each accepted socket connection as an independent
protocol connection: the agent-first F15 handshake runs per connection (with the REQ-012
protocol-range acceptance); the F16 method surface, F17 flow gate, F18 `pty:attach`/
`pty:sessions`, and F20 lease semantics apply unchanged by composition. Every connection-end
path — clean EOF, fatal framing on that connection (`frame-too-large` kills the CONNECTION, never
the process), handshake failure, failed outbound send, lease displacement — MUST only detach:
live panes keep running, their output keeps feeding replay + status, and the daemon process keeps
listening. The daemon exits ONLY via REQ-006 (idle/signal) — never because a connection ended.
**Acceptance:** driving the daemon core in-process (injected transport pairs): spawn a pane over
connection A; end A abruptly; the pane's backend is still live and subsequent output lands in its
replay terminal; connection B handshakes on the same daemon, `pty:sessions` lists the pane, and
`pty:attach`'s snapshot ⊕ subsequent `pty:data` reproduces the full stream byte-exactly (the F18
oracle, now across a real connection boundary). A fatal-framing frame on one connection ends only
that connection (a concurrent second connection keeps operating). CONV-002 failure-mode vectors:
handshake failure on a connection leaves the daemon serving others.

### REQ-003 — Socket + metadata security posture: local-only, owner-only from birth, no secrets
The daemon MUST listen ONLY on a filesystem IPC endpoint (AF_UNIX socket; the injectable
`--socket` path may be a named pipe under test) — never any TCP/network listener. On POSIX the
socket file MUST be owner-only (mode 0600) **from the instant it exists**: the bind MUST run
under a temporarily restrictive `process.umask(0o077)` (prior umask saved immediately before and
restored immediately after the listen call) so the socket is CREATED 0600 atomically — a
chmod-after-listen ordering is non-compliant because the kernel accepts connections at the
creation-time mode the moment `listen()` succeeds (FINDING-005). This discipline applies to BOTH
the real endpoint path and the pure bootstrap seam that models it. The metadata file MUST be
written 0600, MUST contain exactly the Definitions shape (`formatVersion`, `pid`, `version`,
`proto`, `backend`, `startedAt` — no credentials, no host identity beyond what the filesystem
already implies), MUST be written only AFTER the socket is listening (its existence implies a
bound listener at write time), and removed on every clean daemon exit (subject to the REQ-005
ownership re-check). A socket path exceeding the platform's AF_UNIX limit **measured in BYTES of
the encoded path** (`Buffer.byteLength`, not UTF-16 code units — a non-ASCII home dir must not
slip past the guard, FINDING-007) MUST fail daemon start with a specific error naming the path
and the limit (CONV-001), never a raw EINVAL. **The over-long-path guard MUST be ONE shared
implementation enforced on the PRODUCTION bind path** (the real claim/listen sequence —
`claimSocket`/`listenOnce` or their successors — as well as the pure bootstrap seam that models
it, whether by extracting a shared helper both call or by routing the real bind through the seam):
an over-long path fails fast BEFORE any single-instance claim/reclaim attempt or retry loop
begins — the daemon exits nonzero with the named error on its diagnostic sink (stderr when run
directly; the daemon log when detached per REQ-004), never iterates the claim loop on it, and
never exits 0 silently; the spawning bridge's resulting exit-96 diagnostic (REQ-007/REQ-011)
still names the daemon log, which now contains the named error (FINDING-022: a guard that lives
only in a test-only seam while the production path swallows raw EINVAL/ENAMETOOLONG into a
200-attempt loop and a silent exit 0 is non-compliant — the MUST binds the production path).
**Acceptance:** unit tests on the daemon bootstrap core with injected umask/fs/net seams assert
the exact order save-umask → restrict(0o077) → listen → restore, and that metadata write happens
strictly after listen; a POSIX-guarded integration test (`describe.skipIf(win32)` — exercised on
any POSIX runner, passes-by-skip on windows-latest CI; the seam-ordering vector is the always-on
portable guard) binds the REAL endpoint and asserts the socket file's mode is 0600 upon existence
with the restrictive umask in force during the bind (no wider-mode window can exist by
construction); the metadata object's key set equals exactly `{formatVersion, pid, version, proto,
backend, startedAt}`; an over-long POSIX socket path yields the named error, including a
multibyte vector (≤ 107 UTF-16 units but > 107 bytes) that MUST hit the named error, never
EINVAL. **FINDING-022 vectors:** a POSIX-guarded integration test drives the REAL daemon
entry/production bind path with an over-long socket path and asserts a PROMPT nonzero exit —
completing without claim-loop retries, well under the spawn-readiness deadline — whose diagnostic
output contains the named path-and-limit error (never EINVAL/ENAMETOOLONG, never exit 0); a
structural/unit assertion proves the production bind path and the bootstrap seam invoke the SAME
shared guard implementation (single source of truth — no duplicated limit constant to drift). A
structural test asserts the daemon/bridge modules import no TCP-listening surface
(`net.createServer().listen` is called with a path, never a port — keyed on this feature's own
modules per CONV-037).

### REQ-004 — Detach hygiene: the daemon holds nothing of the spawning channel; bounded forensics
A daemon spawned by the bridge (REQ-011) MUST run in a new session (POSIX `setsid` semantics —
`detached` spawn), retain NO file descriptor of the spawning SSH exec channel (stdin ignored;
stdout/stderr redirected — never inherited), and survive the bridge's exit and the channel's
teardown/SIGHUP. The spawn spec SHOULD route the child's stdout/stderr to the daemon log sink
rather than discarding them, so an uncaught crash of the long-lived headless daemon leaves a
forensic trace (FINDING-011). Consequence (each side testable): (a) the SSH exec channel closes
promptly when the bridge exits even while the daemon keeps running — a lingering channel would
wedge every disconnect; (b) no daemon output can ever reach any channel's stdout (frames-only
stdout survives by construction). The daemon log MUST be truncated at each daemon start AND MUST
NOT grow beyond `DAEMON_LOG_MAX_BYTES` within a generation (rotation or ring-style truncation —
oldest content may be discarded; the observable is: the log file's size never exceeds the cap and
the most recent diagnostic is present) — a survival daemon's generation is wall-clock unbounded,
so truncate-at-start alone is not a bound (FINDING-010/FINDING-015; CONV-003 — the bound is
stated and asserted). The log MUST NOT contain PTY payload data or user keystrokes (diagnostics
only, the no-secrets posture).
**Acceptance:** unit tests on the spawn-spec builder assert `detached` + non-inherited stdio with
stdout/stderr targeting the log sink + `unref`; an integration scenario (fake lane) asserts the
bridge process's exit is observed while the daemon's pid remains alive and its socket
connectable; a log-discipline unit drives a pane write through the daemon core and asserts the
log sink received no payload bytes; a cap vector drives more than `DAEMON_LOG_MAX_BYTES` of
diagnostics through the log sink and asserts the file never exceeds the cap while the latest
diagnostic is present; a second daemon start truncates the prior log.

### REQ-005 — Exactly one daemon per workspace-scoped socket, race-proof; reclaim is serialized
At most ONE daemon may serve a given workspace-scoped socket (agent dir × `wsToken` — locked
D6′: one daemon, one socket, per user+host+workspace). Under two CONCURRENT first-connects to the
SAME workspace, exactly one daemon process MUST survive (the loser exits cleanly without
disturbing the winner's socket/metadata) and BOTH clients MUST complete their connects against
the surviving daemon. (Concurrent connects to DISTINCT workspaces are independent — REQ-018.)
The guard MUST be crash-safe: stale remnants left by a dead daemon are reclaimed (REQ-007), and
reclaim MUST obey this discipline (FINDING-006 / CONV-045): (a) ANY removal of socket/metadata
remnants MUST happen inside the SAME serialized critical section that performs the re-bind (the
single-instance guard) — never on the strength of a prior liveness probe alone, so a stale-remnant
unlink can NEVER remove a concurrent winner's live socket; (b) reclaim MUST never kill or orphan
a LIVE daemon (pid-liveness is checked inside the critical section before any removal); (c) a
daemon's cleanup/idle-exit MUST remove only files it still owns — it re-verifies the recorded
metadata pid is its own pid before unlinking, so a superseded daemon can never unlink a
successor's live socket/metadata.
**Acceptance (CONV-060 — the guarantee carries its own interleaved vector, never prose-only):**
a deterministically interleaved test starts two daemon bootstraps against one workspace-scoped
socket with overlapping bind windows and asserts: exactly one listener results; the loser exited
0-or-quietly without unlinking the winner's socket/metadata; two bridge connects both handshake
against the winner. A reclaim-under-concurrency vector pre-seeds dead-pid remnants AND starts two
bootstraps with overlapping windows, asserting exactly one listener and that no live socket was
ever unlinked. An ownership vector: a daemon whose metadata has been superseded by a live
successor exits WITHOUT removing the successor's socket/metadata. A crash-reclaim vector
(REQ-007) proves the guard never wedges after a kill -9-shaped death.

### REQ-006 — Idle self-exit on a really-scheduled timer over an established-connection COUNT
The daemon MUST self-exit when it has had ZERO live panes AND ZERO established connections
continuously for the idle timeout (locked D3). The lifecycle MUST track a COUNT of established
connections — incremented when a connection completes the protocol handshake, decremented when
that connection ends by ANY path (clean EOF, fatal framing, failed send, lease displacement) —
never a boolean (FINDING-008: with ≥2 established connections, one ending must NOT arm the
timer). The lifecycle's signals are protocol establishment and connection end — named and wired
as such, not conflated with the F20 lease bind (FINDING-012). The timer is ARMED whenever the
daemon becomes (or starts) empty — connection count === 0 AND live panes === 0 — and CANCELLED
when a connection establishes or a pane spawns: a really-scheduled timer per CONV-036 (a lazy
check on the next inbound event would strand a quiet daemon forever: exactly the
orphan-accumulation D3 rejects), with the pure lifecycle core taking an injected scheduler and
the process entry injecting real timers. On idle exit AND on SIGTERM the daemon MUST run ONE
shared cleanup path: kill remaining panes (SIGTERM only — idle implies none), dispose the store,
remove the socket and metadata files (under the REQ-005 ownership re-check), exit 0. The default
(5 min) is a named exported constant; `--idle-timeout-ms` overrides it (CONV-003: the limit is
stated here and asserted by test).
**Acceptance:** unit tests on the lifecycle core with a fake scheduler: arm at empty start;
establishment cancels; last connection end with zero panes re-arms; pane spawn cancels; last pane
exit with zero connections re-arms; **two concurrent established connections with zero panes —
one ends and the timer MUST NOT arm (the daemon stays alive); the second ends and it arms**; a
lease-steal displacement (loser's connection ends while the winner stays established) never
reaches count 0; timer fire runs cleanup exactly once (socket+metadata removal observed via the
injected fs). An end-to-end fake-lane scenario with a small `--idle-timeout-ms` observes the
daemon's metadata/socket disappear and the pid die — synchronized on those observed signals,
never a bare wall-clock sleep (CONV-062). A SIGTERM vector (driven through the injected signal
seam, since windows-latest cannot deliver real SIGTERM semantics) asserts the same cleanup path
runs.

### REQ-007 — Stale-socket / crashed-daemon recovery: the bridge never removes; the daemon's serialized claim owns all reclaim
The bridge MUST NOT remove any socket/metadata/lock file, ever — there is no bridge-side unlink
(FINDING-016: an unguarded bridge-side check-then-unlink can orphan a live daemon that has bound
but not yet written metadata). When the bridge finds a socket that does not accept, its decision
table is: (a) recorded metadata pid dead, or metadata absent/unreadable → spawn a fresh daemon
(REQ-011) WITHOUT removing anything — the daemon's own claim sequence, inside the REQ-005
serialized critical section, performs all reclaim (probe, pid-liveness check, unlink of proven
remnants, immediate re-bind) — then poll-connect and proceed; never wedge on a dead socket
(locked D7); (b) recorded pid alive but the socket never accepts → NO removal and NO spawn:
connect retries within the readiness deadline, then a 96 failure with a diagnostic naming the
socket path, the recorded pid, and the daemon log location (CONV-001). **Known v1 limitation
(disclosed per FINDING-018):** pid-liveness is `kill(pid, 0)` on the recorded pid; if the OS
reuses a crashed daemon's pid for an unrelated long-lived process, path (b) repeats indefinitely
and the workspace's agent dir stays wedged until manual recovery — the 96 diagnostic MUST name
the manual escape hatch (terminate the recorded pid or remove the named socket/metadata files
from any SSH shell).
**Acceptance:** fake-lane scenarios: (a) remnants of a killed daemon (socket file + metadata with
a dead pid) → the next connect spawns fresh, the daemon reclaims and binds, the connect completes
— the ledger shows exactly one daemon spawn and the prior generation's log handling per REQ-004;
(b) metadata pid alive and socket connectable → no spawn, ordinary attach; (c) pid alive, socket
never accepting → NO spawn, bridge exits 96, client fatal diagnostic contains the socket path,
pid, log location, and the manual-recovery wording. A structural/unit assertion proves the bridge
performs zero file removals in every scenario (the bridge core's fs seam records no
unlink/rm calls; grep-level guard keyed on this feature's bridge module per CONV-037). The
reclaim-vs-concurrent-spawn interleaving rides the REQ-005 vectors (reclaim lives inside the
daemon's serialized critical section — CONV-045: no unguarded check-then-unlink window exists
anywhere, bridge or daemon).

### REQ-008 — The F20 lease steal is now reachable end-to-end and byte-lossless
With two live connections racing on ONE daemon (i.e. the same workspace — distinct workspaces
never contend, REQ-018), binding MUST steal per F20's shipped semantics (newest bind wins;
displace-with-full-unbind → notify → grant): the loser's connection receives `lease:revoked` as
its FINAL frame, that CONNECTION then ends (its bridge sees EOF and exits 0 — an orderly
displacement), and the daemon process keeps running with the winner bound (locked D9: the lease
lives in the store and survives disconnects unchanged). No agent-side byte loss across the steal:
the winner's `pty:attach` snapshot ⊕ subsequent `pty:data` reproduces the full stream byte-exactly
including bytes the loser never received.
**Acceptance:** an end-to-end scenario (in-process daemon core with two injected transports, plus
a fake-lane variant over two bridge invocations against one persistent daemon): connection A
holds a flooding pane; B binds; A's final frame is `lease:revoked` (nothing after it), A's
channel closes with exit 0; B's attach composition oracle passes byte-exactly; the daemon pid
survives; a third connection can steal back (steal-back is just another attach).

---

## B — The bridge and the client flow (`src/remote-client/` + the artifact's `--attach` mode)

### REQ-009 — Daemon-flow launch command and the bridge status line
A pure builder MUST produce the daemon-flow remote command
`test -f <installPath> && exec node <installPath> --attach --pty=<backend> --ws=<token> || exit
127`, with `installPath` validated by the same `checkRemotePath` rules, the backend restricted to
`node-pty`/`fake`, and the `wsToken` validated against `^[A-Za-z0-9_-]{1,64}$` (all CONV-001
rejections with specific errors — the token is interpolated into a remote shell command and a
filesystem path, so the charset gate is the injection/traversal guard). The absent→127
classification (F19 REQ-009) MUST keep working unchanged. The existing two-argument
`buildAgentLaunchCommand` behavior MUST stay byte-identical (the frozen pins in
`tests/remote-client-command.test.ts` pass unamended — the daemon shape is a new builder or a
strictly additive parameter). Before piping any frame byte, the bridge MUST emit exactly ONE
machine-parseable status line on stderr (Definitions: `TERMHALLA_BRIDGE_V1 { spawned,
daemonVersion, daemonProto, daemonPid }`) so the client can distinguish attached-to-existing from
freshly-spawned (REQ-012's classification input); all other bridge output on stderr is free-form
diagnostics. The client-side status-line parse MUST operate on a raw, line-structure-preserving
view of the bridge's stderr: the status line MUST parse correctly even when other diagnostic
lines precede or follow it (e.g. the REQ-011 backend-mismatch line) — a sanitized/
newline-collapsed copy MUST NOT be the parse input (FINDING-017).
**Acceptance:** frozen-style unit pins of the exact daemon-flow command string for a given path/
backend/token; invalid path/backend/token rejections with specific errors; the existing
launch-command pins (lines pinning the F19 shape) pass with zero edits; a bridge unit asserts the
status line is emitted exactly once, before the first stdout byte, parses as the Definitions
shape, and reports `spawned` truthfully in both the fresh-spawn and attach-to-existing cases
(metadata-unreadable ⇒ `daemonVersion`/`daemonProto`/`daemonPid` null, never a throw); a parse
vector with a diagnostic line BEFORE the status line and trailing diagnostics after it still
yields the parsed shape (and the parsed values reach the REQ-012 drift diagnostic).

### REQ-010 — Bridge byte-transparency and exit taxonomy
Once connected, the bridge MUST be a pure byte pipe in both directions — no frame inspection, no
re-framing, no injected bytes on stdout (the client↔daemon handshake and every frame pass
end-to-end untouched; the hello the client sees is the DAEMON's). Bridge stdout MUST carry only
bytes received from the daemon socket; every bridge diagnostic goes to stderr. Exit taxonomy:
`0` = clean end (socket EOF — including lease displacement — or stdin EOF, each propagated by
half-closing/ending the other side so neither peer waits on a dead pipe); `96` = could not reach
a listening daemon (REQ-007/REQ-011 failures) with an actionable stderr reason; `2` = usage
(REQ-001). A client-side classifier MUST map a zero-frame exit-96 launch to a `fatal` outcome
carrying the sanitized bridge stderr excerpt (the F19 `sanitizeStderr` + bounded-excerpt
posture).
**Acceptance:** a transparency unit drives scripted daemon bytes (including partial frames split
at arbitrary boundaries) through the bridge core and asserts stdout equals the socket bytes
exactly and in order, both directions; stdin EOF ends the socket write side and the bridge exits
0; socket EOF ends stdout and exits 0; an unreachable-daemon rig exits 96 with a diagnostic
naming the socket path; classifier vectors map 96 → fatal with the excerpt, and 127 stays
`absent` (unchanged F19 row).

### REQ-011 — First-connect spawn-then-attach with a bounded readiness wait
In `--attach` mode the bridge MUST: try the socket; on no-listener (absent, or stale per REQ-007
path (a)) spawn the daemon — `node <ownArtifactPath> --daemon --pty=<backend> --ws=<token>` plus
any `--socket`/`--idle-timeout-ms` it was itself given, detached per REQ-004 — then poll-connect
until the socket accepts, bounded by `DAEMON_SPAWN_WAIT_MS`; deadline expiry is exit 96 with a
diagnostic naming the socket path and daemon log. The daemon MUST be launched from the
version-embedded artifact path so module resolution still starts in the agent dir (the 0023
co-provisioned node-pty MUST resolve from the daemon exactly as it does from the direct-exec
agent). When attaching to an EXISTING daemon whose metadata `backend` differs from the bridge's
`--pty` flag, the bridge MUST emit one stderr diagnostic naming both backends and proceed (the
daemon's backend governs; v1 never respawns for a backend mismatch).
**Acceptance:** fake-lane scenarios: fresh dir → ledger shows spawn + attach, handshake reaches
hello; second connect to the same workspace → NO second daemon spawn (the CONV-051-scoped ledger
filters the probe/launch traffic explicitly, never raw-zero asserts); readiness synchronization
is on observed connect success, never a fixed sleep (CONV-062); a never-accepting daemon rig →
exit 96 within the deadline; the backend-mismatch vector shows the diagnostic and a successful
attach; a node-pty-backend variant (stub module per 0023's REQ-020 fixture pattern) proves the
daemon resolves `node-pty` from the agent dir.

### REQ-012 — Version drift under auto-update: protocol-range reattach; refusal only on protocol drift, non-destructive and honest
(Rewritten per locked D4′ — FINDING-014.) The socket is version-stable and the daemon-flow
handshake establishes on **wire-protocol compatibility only**: each daemon-flow endpoint accepts
a peer hello whose `proto` falls within its compatible range (`DAEMON_PROTO_COMPAT`; v1 exactly
`{WIRE_PROTO}`), and an app-version string difference alone MUST NOT fail the daemon-flow
handshake — the `version` field remains advertised for diagnostics. This relaxation is ADDITIVE:
the existing exact-version handshake machines (`createAgentHandshake`/`createClientHandshake`)
stay byte-identical, the default stdio mode keeps the exact-version check (REQ-001; F19's
provisioning classification is untouched), and only the daemon flow composes the relaxed variant.
**The motivating flow MUST work:** close → auto-update → reopen (client app version bumps,
`proto` unchanged) reattaches to the still-running old-app-version daemon and its sessions
survive. When the daemon flow attaches to an EXISTING daemon (bridge status line
`spawned: false`) and the handshake fails on protocol incompatibility, the client MUST classify a
distinct **daemon-protocol-drift** outcome that is `fatal` and NON-destructive: no daemon kill,
no socket removal, no artifact upload in response, no F19 provision-retry loop. The diagnostic
MUST name the client's proto + app version and the daemon's proto + app version (from the bridge
status line when readable; an "unknown daemon protocol/version" wording when not), state that
live remote sessions may exist on the old daemon and continue running unharmed, and name both
recovery paths: the daemon exits on its own once its sessions end and it idles out (REQ-006), or
the user may manually terminate the pid recorded in `<agentDir>/daemon-<wsToken>.json` from any
SSH shell. **Stated user-visible consequence (CONV-054 discipline, scoped honestly):** ROUTINE
Termhalla updates (which do not change the wire protocol) preserve remote sessions across the
update; only a protocol-BREAKING release leaves an old daemon's sessions reachable solely by a
protocol-compatible client, the idle-out path, or manual termination — never silently killed.
When a protocol mismatch follows a FRESH spawn (`spawned: true` — a torn/wrong artifact at the
versioned path), classification MUST fall through to F19's existing provision-once row unchanged
(re-uploading the client's own artifact is the correct remedy there). After an old daemon exits,
the next connect MUST spawn the new-version daemon from the already-provisioned new artifact
(D4's tail). Any wire-visible protocol change MUST bump `proto` — the compatibility contract this
REQ relies on; REQ-017 requires it documented at the protocol barrel and in the feature docs.
**Acceptance:** handshake truth-table vectors on the relaxed daemon-flow variant: same proto +
DIFFERENT app-version strings → establish; proto outside the range → failure naming both protos
and both app versions; the exact-version machines' frozen suites pass with zero edits. Classifier
vectors: (proto-drift, spawned:false) → daemon-protocol-drift with a diagnostic containing both
proto/version pairs, the metadata path, and both recovery paths; (proto-drift, spawned:true) →
the F19 provisionable row; (proto-drift, status line unreadable) → daemon-protocol-drift with the
client's versions and the "unknown" wording, never a throw. Fake-lane end-to-end: (1) the
AUTO-UPDATE rig — a persistent daemon advertising an older app version with the SAME proto + a
newer-app-version client ⇒ establish, `pty:sessions` lists the surviving pane, and the F18
byte-exact oracle passes; (2) a proto-drift rig — fatal drift outcome, the daemon pid still alive
after the connect, its sessions intact (a protocol-compatible client then attaches and the F18
oracle passes), and the ledger shows zero uploads and zero kill attempts after the drift was
detected; after the old daemon idles out, a reconnect spawns the new version and reaches hello.

### REQ-013 — Opt-in flow integration: legacy byte-identical, production wired on per-workspace
`BootstrapOptions` MUST gain one optional field carrying the daemon scope (e.g.
`daemon?: { workspaceId: string }`): **absent** ⇒ the launch command, exec-channel sequence, and
every result are byte-identical to v0.13.0+0023 (all frozen F19/F21/0023 suites —
`remote-client-bootstrap`, `remote-client-gold`, `integration-remote-full-stack`,
`integration-node-pty-prebuilt`, `main/remote-manager-routing` — pass with ZERO edits);
**present** ⇒ the daemon flow (REQ-009..012) replaces the direct-exec launch, with the `wsToken`
derived deterministically from `workspaceId` (Definitions — same workspace ⇒ same token on every
reconnect; distinct workspaces ⇒ distinct tokens). Ordering is preserved: node-pty
co-provisioning (0023) and the F19 artifact provision-once flow run BEFORE the daemon launch,
against the same version-embedded install path. All new failure paths surface through the
EXISTING `ConnectFailureKind` values (`fatal`/`aborted`) so F21's banner/picker need no change.
`src/main/remote/` MUST wire the option on for production connects, passing each remote
workspace's id as the scope (`services.ts`/`remote-workspace-manager.ts` — the per-workspace
daemon is what preserves same-host coexistence, REQ-018). The caller's `AbortSignal` MUST cover
the bridge launch and daemon spawn-wait; an abort there is a determinate `aborted` whose wording
MAY note that a freshly spawned daemon self-reaps via its idle timeout (no durable-write tear
exists on this path — the 0023 install-abort indeterminate contract is unchanged).
**Acceptance:** a no-option scenario against the amended shim asserts the pre-0024 pinned ledger
byte-identically; the frozen suites named above run green unedited; a structural check asserts
the main-side wiring passes the option with the workspace id (mirroring 0023's REQ-018 check);
token-derivation vectors: a conforming workspace id round-trips as-is, a non-conforming id maps
deterministically into the charset and the SAME token results on repeat derivation; an
abort-during-spawn-wait vector settles `aborted` with the children killed/`unref`-safe (the F19
posture) and no indeterminate flag.

### REQ-014 — Scope confinement and structural guards survive
This feature MUST NOT: add any new IPC channel; bump `SCHEMA_VERSION`; add a persisted store
under `userData`; write any new local persistence; or add any new renderer UI/components.
Renderer/preload change is confined to EXACTLY the REQ-019 close-tab detach routing (amended in
revision 3 per locked D10): the `closeWorkspace` teardown path in the renderer store (routing a
remote workspace's close through detach instead of per-pane kill), plus — if the plan needs it —
at most one additive OPTIONAL parameter threaded through the EXISTING `remote:disconnect`
surface (contract + preload pass-through; all existing call shapes byte-identical). No other
renderer or preload file changes; no new channel either way.
`tests/remote-client-structure.test.ts` (TEST-2001..2006) MUST pass unamended (new client-side
code lives under `src/remote-client/`; no electron/ssh-library/`shell: true`/
`package.json`-literal). New agent-side modules live under `src/agent/` and satisfy the frozen
`tests/agent-structure.test.ts` invariants (only the `@shared/remote/protocol` barrel; `src/main`
imports confined to `status/`; only `node-pty-backend.ts` references node-pty; `fake-backend.ts`
stays clock/timer-free — the idle timer lives in the daemon lifecycle module, never the backend).
The D4′ vocabulary (the relaxed daemon-flow handshake variant + `DAEMON_PROTO_COMPAT`) is
strictly ADDITIVE in the `src/shared/remote/` protocol barrel — the existing exported machines
and their frozen suites are untouched. Other shared client/agent vocabulary, if any is needed,
rides `src/shared/remote-agent-api.ts` via the established two-door pattern; socket/metadata/log
path constants are agent-tree-only (the Electron client never touches them — the bridge is the
only socket consumer, and the renderer never references any of this feature's new exported
symbols).
**Acceptance:** the frozen structural suites named above pass with zero edits; a feature-scoped
structural test (CONV-022-safe: pinning this feature's own invariant) asserts no file added by
this feature references `SCHEMA_VERSION`, Electron `userData` APIs, or `ipcMain`/`contextBridge`;
a grep-based check asserts the renderer/preload trees contain no reference to this feature's new
agent/remote-client exported symbols (CONV-037: keyed on feature-specific names such as the
bridge sentinel constant, never shared module paths) — the sanctioned renderer delta is confined
to the `closeWorkspace`/teardown routing exercised by the REQ-019 vectors.

---

## C — End-to-end survival and verification

### REQ-015 — The headline scenario: close, reopen, and the pane is exactly where it was
Over the daemon flow, the full survival story MUST hold end-to-end: connect → spawn a pane →
produce output → tear the SSH channel down (the close-Termhalla shape) → the daemon and pane
survive → reconnect (same workspace ⇒ same `wsToken` socket) → `pty:sessions` lists the live
pane → `pty:attach`'s snapshot ⊕ subsequent `pty:data` reproduces the full stream byte-exactly,
including output produced WHILE disconnected (bounded by the F18 scrollback limit, whose
truncation semantics are unchanged and not re-specified here). The F17×F18 weld MUST hold across
a bridge-mediated disconnect: a pane paused by a stalled client's flow gate resumes on unbind so
its backlog reaches the replay terminal, and the reconnecting client starts a fresh flow window.
**Acceptance:** a fake-lane integration test (the real agent artifact bundled on demand through
`vite.agent.config.ts`, the TEST-774 pattern; `--pty=fake`) runs the sequence above with
mid-disconnect output and asserts the byte-exact composition oracle on reattach; a stalled-acks
variant pauses a flooding pane, disconnects, and asserts the reattach snapshot contains the
flushed backlog. Synchronization is on observed frames/files, never fixed sleeps (CONV-062).

### REQ-016 — Testing posture: plain `npm test`, no real ssh/network; sanctioned shim amendment
Every test this feature adds MUST pass under plain `npm test` on windows-latest with no
`npm run build`, docker, real ssh, real network, or native module (locked posture; the REQ-003
POSIX real-socket-mode and over-long-production-bind vectors are `skipIf(win32)`-guarded —
exercised on any POSIX runner — and their portable seam twins are always-on).
The daemon and bridge cores MUST be factored to run under test with injected seams (transport
pairs, fs, umask, scheduler, signals), and the REAL daemon/bridge processes MUST be exercisable
portably via the injectable `--socket` path (a named-pipe path on win32 — Node's `net`
path-listen API covers both; POSIX-only behaviors such as socket-file mode/unlink are
seam-injected and unit-covered). `tests/fixtures/fake-ssh.mjs` (frozen; `die(12)`s on unknown
shapes) MUST be amended through THIS feature's tests phase (CONV-012 — never silently during
implementation) to: recognize the REQ-009 daemon-flow launch shape (including `--ws`); host
PERSISTENT local daemon children per fake home KEYED BY `wsToken` that outlive individual shim
invocations (the reconnect-fidelity and same-host-coexistence substrate); log a `daemon-attach` /
`daemon-spawn` kind (with the token) to `FAKE_SSH_LOG`; and gain rigs for stale remnants, a
never-accepting daemon, an old-APP-version-same-proto persistent daemon (the REQ-012 auto-update
rig), a proto-drift persistent daemon (REQ-012), concurrent first-connects to ONE workspace
(REQ-005), and two DISTINCT workspaces on one fake home (REQ-018). Any OTHER frozen-suite
amendment this revision necessitates rides the SAME tests-phase discipline (CONV-012) — the
survey enumerates exactly one candidate, `tests/renderer/remote-ux-structure.test.ts` TEST-2283
(the `closeWorkspace` source-order pin whose remote branch REQ-019 rewrites). All pre-existing
F19/F21/0023/integration suites MUST pass against the amended shim with zero test edits; `ci.yml`
gains nothing.
**Acceptance:** the full new suite runs green via `npm test` on a fresh checkout; the amended
shim keeps TEST-2006 (no network module) green; each new rig is exercised by at least one
scenario; a red-gate check per CONV-059 enumerates exactly this feature's new suites (plus any
sanctioned amendment, e.g. TEST-2283 if its literal order breaks) as the failing set at the tests
phase.

### REQ-017 — Retire the shipped no-daemonization claims everywhere they are written
The documented v1 limitation MUST be retired coherently (CONV-008): every phrasing of the claim —
"the v1 agent is **not daemonized**", "its owned session store **dies with the stdio
connection**", "the inventory is empty and every pane surfaces as exited", "agent daemonization
lands with no client change" (now inaccurate as stated: it lands with a launch/transport-layer
client change, the REQ-019 close-tab detach routing, and zero new renderer UI), and the
roadmap/CLAUDE.md/`docs/features/remote-agent.md`
/`remote-workspaces.md` echoes — MUST be updated or superseded in the SAME change, located by a
repo-wide grep (patterns at minimum: `daemoniz`, `dies with the stdio`, `CONV-054` outside
`.orky/conventions.md` and feature-dir history, `not daemonized`) over `docs/`, `CLAUDE.md`, and
`.orky/baseline/`, never only the files this spec enumerates. The updated docs MUST additionally
state: (a) the PER-WORKSPACE daemon model — one daemon per remote workspace, same-host workspaces
independent (D6′, REQ-018); (b) the protocol-versioning rule REQ-012 relies on — the wire
protocol (`proto`) is versioned separately from the app, any wire-visible change MUST bump it,
and routine app updates preserve remote sessions — recorded both in the feature docs and at the
protocol barrel's doc comment; (c) the THREE-GESTURE survival story (D10, REQ-019) — quit-app,
banner disconnect, AND closing the workspace tab all DETACH (a tab close never kills remote
panes; reopening reattaches; an unreopened workspace's daemon idle-reaps), while closing an
individual remote pane remains a deliberate kill. The frozen doc-drift guard
`tests/docs-feature-0022.test.ts`
(which requires `remote-workspaces.md` to mention `daemon`) MUST remain green — the updated
section keeps discussing daemonization as a shipped fact.
**Acceptance:** after doc-sync, the greps above find no live claim that the agent is not
daemonized or that sessions die with the connection (historical feature-dir/`followups` records
excepted); a grep finds the per-workspace-daemon statement and the close-tab-detach statement in
`remote-workspaces.md` and the proto-bump rule at the protocol barrel; `docs-feature-0022.test.ts`
and `docs-feature-0017.test.ts` pass (amended through the tests phase only if a pinned phrase
must change — enumerated in the collision survey).

### REQ-018 — Same-host workspace coexistence (new — locked D6′; FINDING-013/FINDING-009)
N remote workspaces pointed at the SAME host+user MUST coexist independently: each resolves its
own workspace-keyed socket (`agent-<wsToken>.sock`) and its own daemon process, store, and F20
lease. Connecting a second workspace to a host MUST NOT displace, steal from, end, or otherwise
perturb the first workspace's connection or sessions — no `lease:revoked` ever crosses workspace
boundaries, and no shared idle/lifecycle state exists between the daemons. Each per-workspace
daemon idles out independently per REQ-006 (idle reaping is what bounds accumulation of
per-workspace daemons, per D6′). The pre-daemonization behavior — multiple same-host workspaces
working concurrently — is thereby preserved, not regressed.
**Acceptance:** a fake-lane scenario with TWO distinct workspace tokens against ONE fake home:
two daemon pids on two sockets result; both connections are concurrently established and serve
panes with interleaved traffic (each workspace's F18 oracle passes independently); ending
workspace A's connection leaves B's connection established and B's daemon alive (B's idle timer
state untouched — composed with the REQ-006 count vectors); A's daemon idles out on its own
timeout while B's keeps running; the ledger shows no `lease:revoked` delivered to either
workspace during the other's connect/disconnect. An in-process variant drives two daemon cores
side by side and asserts zero shared mutable state via construction (two independent stores).

### REQ-019 — Closing a remote workspace tab DETACHES; survival holds across all three going-away gestures (new — locked D10; FINDING-023)
Closing a remote workspace's tab (the renderer `closeWorkspace` gesture) MUST detach, never
destroy: NO `pty:kill` may be issued for any of that workspace's remote panes — not over the
wire, not via the local kill path — and the workspace's connection MUST end through the same
wire-teardown semantics quit-app and banner-disconnect already use (`teardownWire`-shaped: the
connection ends; the daemon and its PTYs keep running for the F18 reattach; an unreopened
workspace's daemon is idle-reaped per REQ-006 once its established-connection count reaches 0).
All three going-away gestures — quit the app, banner disconnect, close the tab — thereby share
ONE survival story (FINDING-023: pre-revision-3 the tab close silently `pty:kill`ed the remote
panes, destroying the session the feature exists to preserve). Corollaries, each testable:
(a) LOCAL (non-remote) workspace close is byte-identical to today — one kill per pane, no detach
path; (b) closing an individual remote PANE (not the tab) remains a deliberate kill of that one
pane — unchanged; (c) the renderer still clears the closed panes' runtime bookkeeping (no leaked
pane runtime), and the closed workspace serves NO ghost remote state — after the close settles,
`remote:current`/`currentStates()` has no entry for the closed workspace id (the no-ghost
discipline TEST-2283 pinned survives, achieved by detach-then-forget rather than
kill-then-forget); (d) reopening a workspace that resolves the SAME workspace id (⇒ same
`wsToken`, Definitions) reconnects to the same socket and passes the REQ-015 byte-exact reattach
oracle.
**Acceptance:** a unit test on the extracted teardown-routing logic (injected kill/detach
functions per the repo's renderer-injection convention — the pure core must not import
`renderer/api`) asserts: a remote workspace close issues ZERO kill calls and exactly one
detach/disconnect for the workspace, while a local workspace close issues one kill per pane and
no detach; a main-side manager vector (canned transport, `remote-manager-routing` style) asserts
the close-tab detach path sends NO `pty:kill` frame on the wire, ends the connection, and leaves
no entry for the closed workspace in `currentStates()`; a fake-lane end-to-end scenario runs
connect → spawn pane → output → close-tab-shaped teardown → daemon pid alive + pane live →
reconnect with the same `wsToken` ⇒ `pty:sessions` lists the pane and the F18 byte-exact oracle
passes; a no-reopen variant observes the daemon idle-reap (socket + metadata gone, pid dead —
synchronized on observed signals, never a bare sleep, CONV-062). The TEST-2283 source-order pin
is handled per the collision survey: if the detach branch breaks its literal
`teardownPanes → disconnectRemote → pruneRemoteStates` ordering, the pin is amended through THIS
feature's tests phase (CONV-012), never silently during implementation.

---

## Public interface

- **Agent artifact CLI (additive):** `--daemon`, `--attach`, `--ws=<token>`, `--socket=<path>`,
  `--idle-timeout-ms=<n>`; default mode byte-identical to F16. Exit codes: agent 0/1/2 unchanged;
  bridge 0 / 96 (`BRIDGE_DAEMON_UNREACHABLE_EXIT`) / 2.
- **Remote on-disk contract (under `<agentDir>`, per workspace):** `agent-<wsToken>.sock`
  (workspace-keyed, version-stable, 0600 from creation), `daemon-<wsToken>.json`
  (`{ formatVersion: 1, pid, version, proto, backend, startedAt }`, 0600, cross-version frozen),
  `daemon-<wsToken>.log` (truncated per daemon start, capped at `DAEMON_LOG_MAX_BYTES` within a
  generation, no payload data).
- **Wire-adjacent contract:** the bridge stderr status line `TERMHALLA_BRIDGE_V1 { spawned,
  daemonVersion, daemonProto, daemonPid }`; the daemon-flow launch command
  `test -f <path> && exec node <path> --attach --pty=<backend> --ws=<token> || exit 127`. No new
  F15 frame types; the daemon flow composes an ADDITIVE relaxed handshake variant (protocol-range
  acceptance over the existing hello `proto`; app-version advisory only) exported beside the
  unchanged exact-version machines in the `src/shared/remote/` protocol barrel, together with
  `DAEMON_PROTO_COMPAT`. Any other new shared vocabulary rides `src/shared/remote-agent-api.ts`
  two-door.
- **`src/remote-client/`:** the daemon-flow launch-command builder (path/backend/token
  validation); the raw-stderr bridge-status-line parser; the extended connect classification
  including `daemon-protocol-drift`; `BootstrapOptions.daemon?` carrying the workspace scope
  (absent ⇒ pre-0024 byte-identical). `ConnectFailureKind` unchanged.
- **`src/main/remote/`:** wiring only — the daemon option with the workspace id per remote
  workspace, plus the REQ-019 detach path (close-tab routes through the existing wire-teardown
  semantics and forgets the workspace's client-side pane tracking WITHOUT killing the remote
  panes). No new IPC channel; at most one additive optional parameter on the existing
  `remote:disconnect` surface (mechanism is a plan detail; existing call shapes byte-identical).
  No `SCHEMA_VERSION` change.
- **Renderer (REQ-019 only):** the `closeWorkspace` teardown routing — remote workspaces detach
  (zero `ptyKill` for remote panes), local workspaces unchanged. No new UI/components.
- **Constants (named exports):** agent tree — `DAEMON_IDLE_TIMEOUT_DEFAULT_MS = 300000`,
  `DAEMON_SPAWN_WAIT_MS = 10000`, `BRIDGE_DAEMON_UNREACHABLE_EXIT = 96`,
  `DAEMON_LOG_MAX_BYTES = 1048576`, the socket/metadata/log name patterns, the bridge sentinel
  prefix, and the shared over-long-socket-path guard (one implementation, used by the seam AND
  the production bind path — REQ-003); protocol barrel — `DAEMON_PROTO_COMPAT` (beside the
  existing `WIRE_PROTO`).

## Frozen-test collision survey (CONV-023)

Greps run 2026-07-06 over `C:\dev\Termhalla` (excluding `node_modules`); re-verified for
revisions 2 and 3:
- `test -f|exec node|--pty=` over `tests/` → 11 files. Pins requiring NO amendment under the
  opt-in design: `remote-client-command.test.ts` (exact F19 launch-command strings — preserved by
  an additive builder, REQ-009), `agent-stdio-{roundtrip,flow,attach}.test.ts` (default-mode
  stdio contract — REQ-001 keeps it byte-identical), `integration-node-pty-prebuilt.test.ts` and
  `integration-remote-full-stack.test.ts` (no `daemon` option passed → pre-0024 ledgers hold),
  `agent-structure.test.ts` (REQ-014 satisfies its invariants; the fake-backend timer scan
  constrains where the idle timer may live), `docs-feature-0017.test.ts` (doc pins — verify at
  REQ-017), `fixtures/node-pty-stub`. The frozen artifacts needing sanctioned amendment are
  `tests/fixtures/fake-ssh.mjs` (unknown shapes `die(12)`) — REQ-016 — and, conditionally,
  TEST-2283 (next bullet).
- **`closeWorkspace|teardownPanes` over `tests/` (new for revision 3, REQ-019)** → 3 files:
  `tests/renderer/remote-ux-structure.test.ts` **TEST-2283** (owned by F21/0022) pins, by SOURCE
  ORDER inside `closeWorkspace`, the literal sequence `teardownPanes(` → `disconnectRemote(` →
  `pruneRemoteStates(` — the FINDING-002 kill-first rationale ("the manager sees a pane-less
  entry and forgets it") that D10 supersedes for the REMOTE branch. If the REQ-019 routing keeps
  the literal order satisfiable (the local branch still calls `teardownPanes` and the remote
  branch still ends with disconnect + prune), TEST-2283 stays green unamended; if not, it is a
  SANCTIONED tests-phase amendment (CONV-012, enumerated at the CONV-059 red gate) — the no-ghost
  intent it protects is re-pinned by the REQ-019 acceptance vectors.
  `tests/renderer/clear-pane-runtime.test.ts` and `pane-focus-seq.test.ts` mock `window.termhalla`
  wholesale and assert runtime-map hygiene, which REQ-019 corollary (c) preserves — no amendment
  expected.
- **F15 handshake suites (`version-mismatch`/`WIRE_PROTO` pins):** the exact-version machines in
  `src/shared/remote/handshake.ts` are NOT modified — the D4′ relaxation is a new additive export
  the daemon flow composes (REQ-012/REQ-014) — so the frozen F15 suites pass with zero edits. The
  client's handshake `version` input (`services.ts:108` passes `MANIFEST_VERSION`) is unchanged
  for the direct-exec path; the daemon flow's establishment simply no longer depends on it.
  Confirmed at round 2: the barrel-pin TEST-747 amendment (+3 sorted D4′ names) was sanctioned
  through the tests phase (state.json loop-back record) and stands.
- `daemon` (case-insensitive) over `tests/` → 3 files: `docs-feature-0022.test.ts` (requires the
  word `daemon` in `remote-workspaces.md` — stays green through REQ-017's rewrite),
  `integration-remote-full-stack.test.ts` (comment-only; behavior preserved by the absent
  option), `main/remote-manager-routing.test.ts` TEST-2252 (empty inventory ⇒ exited — still a
  valid client behavior for an idled-out daemon; canned inventory, unaffected).
- `parseAgentArgs` pins (`tests/agent-args-validate.test.ts` TEST-759): exact `toEqual` on
  `{ ok: true, ptyBackend }` — new `AgentArgs` fields MUST be absent/`undefined` for legacy
  inputs (vitest `toEqual` ignores `undefined` properties), else this is a sanctioned tests-phase
  amendment to enumerate at the red gate (CONV-059).
- `lease:revoked|AGENT_LEASE_REVOKED_EVT` suites (F20) and the F17/F18 flow/replay suites are
  composition-level and unmodified; REQ-008/REQ-015/REQ-018 ADD scenarios rather than amending
  them. No frozen absence guard names this feature as its retirement path (TEST-746/TEST-2001
  were already superseded by F21; nothing to retire per CONV-019).
- **Prior-round implementation artifacts:** the round-1/round-2 tests (TEST-24xx) are this
  feature's own — they are re-derived through the tests phase against these amended REQs (no
  external freeze applies to them); the round-2 review's 8 non-blocking findings (deferred to the
  followups doc per the loop-back record) plus the still-open round-1 guidance items remain
  implementation guidance for the re-run except where encoded above (FINDING-022 → REQ-003,
  FINDING-023 → REQ-019, which are now contract-level).

## Out of scope (confirmed from concept)

- Host-reboot survival / daemon supervision across reboot (`.orky/roadmap.md` open question 1).
- macOS/Windows remotes (v1 remote = Linux; the win32 named-pipe path is a TEST substrate only).
- Any change to local (non-remote) workspaces (their close-tab kill semantics are explicitly
  unchanged — REQ-019 corollary (a)), any new renderer UI, any new IPC channel, any persistence
  change.
- Cross-PROTOCOL session hand-off (drain/respawn or a client that speaks older protocol dialects)
  for a protocol-BREAKING release — the compatible-range machinery ships now (D4′); a breaking
  release's migration affordance is separately-decided future work. Drift is refused
  non-destructively per REQ-012.
- A client-side takeover affordance for a proto-drifted daemon (manual escape hatch only in v1).
- A UI affordance to "close tab AND kill the remote session" (v1 offers the per-pane close for a
  deliberate kill; a destructive tab-close variant is future work if ever wanted).
- Scrollback sizing/GC of never-reattached sessions (pre-existing roadmap open question,
  unchanged by this feature).

## Open questions

None blocking. The concept's four deferred questions are decided in Definitions (decisions 1–4,
with decision 1 superseded-in-place by D4′ and decision 4 amended for D10) and made normative in
REQ-012 (protocol-range reattach; auto-update survival; non-destructive proto-drift refusal with
the honestly-scoped consequence), REQ-006 (idle default 5 min + flag, established-connection
COUNT), REQ-005 (single-instance guarantee per workspace-scoped socket, serialized reclaim,
mechanism left to plan under mandatory interleaved vectors), REQ-013/REQ-014/REQ-018 (client
change = launch/transport layer + main wiring + the REQ-019 close-tab detach routing only; no new
renderer UI confirmed; same-host coexistence preserved via per-workspace daemons), and REQ-019
(close-tab detaches — the D10 three-gesture survival story, with the exact detach mechanism a
plan detail bounded by the observable no-kill / no-ghost / reattach contract).
