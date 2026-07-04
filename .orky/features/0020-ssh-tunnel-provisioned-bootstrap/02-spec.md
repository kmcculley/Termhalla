# Spec — 0020-ssh-tunnel-provisioned-bootstrap (F19)

**Feature:** SSH tunnel + client-provisioned agent bootstrap
**Phase:** 2 (spec) — derived from `00-intake.md`; concept fixed by the Remote Agent v1 roadmap.
**Concerns:** `networking`, `determinism` (+ always-on `security`, `quality`, `devils-advocate`)

## Summary

F19 delivers the CONNECTION layer of the Remote Agent v1 epic as a headless library:

1. A new client-side tree `src/remote-client/` (plain Node, outside `src/main`/`src/preload`/
   `src/renderer` — the TEST-746 scope guard survives unchanged; F21 wires it into the app).
2. A pure **named-agent registry** model (`src/shared/remote-agents.ts`) seeded from SSH favorites
   — host/user/port + identity-file PATH only, no secrets — plus a path-injected JSON store.
3. A **system-ssh stdio exec channel**: pure argv/command builders + an impure spawn wrapper. The
   user's `ssh` binary is spawned as a child process; NEVER an SSH library (locked decision 1).
4. **Client-provisioned bootstrap** (locked decision 2): connect → F15 client handshake →
   classify failure → (upload the bundled agent artifact atomically + retry ONCE) → connected
   session handle or a specific, actionable failure.
5. A **fake ssh shim** test fixture that emulates the remote side against a local directory and
   spawns the agent as a local child process — the identical protocol path, no network, ever.

Out of scope (F21): renderer/main/preload wiring, UI, per-workspace home, persistence wiring to
`userData`, retiring TEST-746. Out of scope (F17/F18/F20): flow-control semantics, replay/reattach,
leases. The running Electron app's behavior stays byte-identical.

## Requirements

### REQ-001 — Placement: a new `src/remote-client/` tree, invisible to the app
The client tunnel/bootstrap code MUST live in a new top-level tree `src/remote-client/` (mirroring
`src/agent/`). No file under `src/main/`, `src/preload/`, or `src/renderer/` may import it (F21 is
the sanctioned consumer and retires this guard through its own tests phase — CONV-019). Modules
under `src/remote-client/` MUST NOT import `electron`, any `src/renderer`/`src/preload` module, or
any `src/main` module (unlike `src/agent/`, not even `src/main/status` — the client side has no
status stack). `tsconfig.node.json`'s `include` MUST gain `src/remote-client` (additive — frozen
TEST-758 uses `toContain` and keeps passing).
**Acceptance:** a structural test walks `src/remote-client/` asserting the import bans; walks the
three app trees asserting zero imports of `remote-client` (regex keyed on the feature-specific path
segment `remote-client`, CONV-037, anchored per CONV-032, retirement path named in the header per
CONV-019); asserts `tsconfig.node.json` include contains BOTH `src/agent` and `src/remote-client`.

### REQ-002 — Zero behavior change to the running app; frozen surfaces intact
F19 MUST NOT modify any file under `src/main/`, `src/preload/`, or `src/renderer/`, MUST NOT
change `SCHEMA_VERSION`, MUST NOT edit `.orky/profiles/node-app.json` (equality-pinned by frozen
TEST-757), MUST NOT change the `@shared/remote/protocol` barrel's export surface (frozen TEST-747),
MUST NOT add an impure module under `src/shared/` (TEST-745 covers `src/shared/remote/`; the new
`src/shared/remote-agents.ts` must be environment-pure), and MUST NOT modify
`src/shared/quick.ts` / existing `buildSshArgs` behavior (interactive SSH panes stay byte-identical).
**Acceptance:** the full existing suite (characterization + F15 + F16 frozen suites +
`tests/shared/quick.test.ts`) passes unchanged; a structural test asserts `src/shared/remote-agents.ts`
is environment-pure (same forbidden-reference list as TEST-745).

### REQ-003 — Named-agent pure model, seeded from SSH favorites, no secrets
`src/shared/remote-agents.ts` MUST define the named-agent record
`NamedAgent { id: string; name: string; host: string; user: string; port?: number; identityFile?:
string; remoteAgentDir?: string }` — connection config ONLY: an identity-file *path* is the closest
thing to a credential the record may carry; the type MUST NOT have password/passphrase/key-material
fields, and the normalizer MUST strip unknown fields so no secret can ride along.
`seedNamedAgentFromConnection(conn: SshConnection, id, name)` MUST copy exactly
`host`/`user`/`port`/`identityFile` from an SSH favorite and MUST NOT copy tmux fields
(`tmuxSession`/`tmuxOptions` — the exec channel never allocates a TTY).
**Acceptance:** unit tests: seeding copies exactly those fields; a `normalizeNamedAgents` round-trip
strips unknown/extra fields (e.g. an injected `password` key) and drops records missing
`id`/`name`/`host`/`user`; empty/malformed input (non-array, nulls, wrong types) yields `[]` or the
valid subset, never a throw (CONV-002).

### REQ-004 — Registry store: path-injected, normalized, atomic
`src/remote-client/agents-store.ts` MUST provide `loadNamedAgents(filePath)` /
`saveNamedAgents(filePath, agents)` over a caller-supplied JSON file path (F21 wires it under
Electron `userData`; F19 itself binds no persistence location). Load MUST apply
`normalizeNamedAgents` (missing file / unparsable JSON → `[]`, never a throw); save MUST apply the
same normalizer and write ATOMICALLY (temp file in the same directory + rename) so a crashed or
aborted save can never leave a torn registry file (CONV-014 posture).
**Acceptance:** unit tests against a temp dir: missing file → `[]`; garbage JSON → `[]`; round-trip
preserves valid records and strips injected unknown fields; the final file parses as JSON after a
save; save-over-existing replaces content fully.

### REQ-005 — Exec-channel argv builder (mirrors the favorites seeding rules)
`buildSshExecArgv(agent, remoteCommand: string)` (pure, `src/remote-client/ssh-command.ts`) MUST
return `[-p PORT?] [-i IDENTITY?] user@host <remoteCommand>` where: `-p` is omitted when `port` is
unset, `0`, or `22` (exactly `buildSshArgs`' rule); `-i IDENTITY` appears only when `identityFile`
is a non-empty string; the destination is the single token `user@host`; the remote command is
appended as ONE final argv element; and the argv MUST NOT contain `-t` (no TTY — stdout must stay
8-bit clean for frames) and MUST NOT contain any option that defeats interactive auth (no
`-oBatchMode=yes` — inheriting 2FA/hardware-key prompts is the point of locked decision 1).
**Acceptance:** unit tests assert exact argv arrays for: default port, explicit 22, non-22 port,
with/without identity file; assert `-t` and `BatchMode` never appear.

### REQ-006 — Argv-injection guards on every seeded field
The builders MUST validate seeded fields before producing argv and return/throw a specific,
actionable error (naming the field and the offending value — CONV-001) instead: `host` and `user`
MUST be non-empty, MUST NOT start with `-` (ssh option injection), and MUST NOT contain whitespace
or control characters; `host` additionally MUST NOT contain `@`; `port` outside `1..65535` (when
set and non-zero) MUST be rejected; `identityFile` MUST NOT start with `-` and MUST NOT contain
control characters; `remoteAgentDir` (when set) and every remote path interpolated into a remote
command MUST match the safe-path charset `^[A-Za-z0-9._/~-]+$` (single-quote-free and space-free —
the remote shell evaluates the command string).
**Acceptance:** unit tests: a host of `-oProxyCommand=calc`, a user with a space, a port of `70000`,
an identityFile of `-i`, and a `remoteAgentDir` containing a quote or space are each rejected with
an error message naming the field; no argv is produced for any rejected seed.

### REQ-007 — The system ssh binary, injectable, never a library
The spawn seam MUST default to the program name `ssh` (resolved via `PATH` at spawn time — the
user's system OpenSSH, inheriting `~/.ssh/config`, jump hosts, hardware keys, 2FA) and MUST accept
an injected override `{ program, prefixArgs }` (tests substitute `process.execPath` + the shim
script). The child MUST be spawned WITHOUT a shell (argv array semantics — no client-side shell
interpolation). F19 MUST NOT add any npm dependency (no ssh2/node-ssh/libssh binding — locked
decision 1), and no module under `src/remote-client/` may import one.
**Acceptance:** unit test pins the default program literal `ssh`; a structural test asserts
`package.json` `dependencies`/`devDependencies` contain NO ssh-implementation package (name equal
to or starting with `ssh2`, `node-ssh`, `simple-ssh`, `libssh`, `russh`, `electron-ssh2`) and scans
`src/remote-client/` import specifiers for the same banned names. (Deliberately NOT an equality pin
of the whole dependency set — parallel sibling features legitimately add unrelated deps; pinning a
shared evolving global would false-trip this frozen suite at the batch merge re-gate, CONV-022.)

### REQ-008 — Versioned remote install path
`remoteAgentInstallPath(dirOrDefault, version)` (pure) MUST produce
`<dir>/termhalla-agent-<version>.cjs` with the default dir `~/.termhalla/agent`. The version MUST
be embedded in the FILE NAME (an upload for version V can never overwrite or tear the artifact a
running version-W agent was launched from). `version` MUST be validated against
`^[0-9A-Za-z.-]+$` before interpolation (it enters a remote command string).
**Acceptance:** unit tests: exact path for the default dir and a custom `remoteAgentDir`; a version
of `1.0.0 && rm -rf ~` is rejected with an actionable error; the default-dir literal
`~/.termhalla/agent` is pinned.

### REQ-009 — Launch command: probe-then-exec with a reserved absent sentinel
`buildAgentLaunchCommand(installPath, ptyBackend)` (pure) MUST produce a POSIX one-liner that:
(a) tests the artifact's existence and, when ABSENT, exits with the reserved sentinel code **127**
having written NOTHING to stdout; (b) when present, `exec`s `node <installPath> --pty=<backend>`
(the F16 agent CLI contract; default backend `node-pty`, tests use `fake`). The command MUST be
exactly `test -f <path> && exec node <path> --pty=<backend> || exit 127` so the shim and the
builder share one pinned shape.
**Acceptance:** unit test pins the exact command string for both backends; shim-based integration:
launching against an empty fake remote home yields exit 127 and zero decoded frames.

### REQ-010 — Connect: F15 client handshake over the child's stdio, reused never re-derived
`connectAgent(options)` (impure, `src/remote-client/bootstrap.ts`) MUST drive the child's stdio
with `createFrameDecoder` + `createClientHandshake` + `encodeFrame` imported from
`@shared/remote/protocol` (the ONE sanctioned barrel; no local reimplementation of framing or
handshake — a structural test bans a local `WIRE_PROTO`/hello-construction copy). Per the F15
sequence the client MUST send NOTHING until the agent hello arrives and MUST send the machine's
`reply` frame on success. On success it MUST resolve to a live session handle exposing at minimum:
the advertised `capabilities`, the agent `version`, a `send(frame)` writer, an `onFrame` /
`onExit` subscription surface, and `kill()`.
**Acceptance:** integration through the shim + a scripted fake agent: handshake completes, the
handle reports the fake agent's capabilities/version; frames written via `send` reach the agent
process and its responses surface via `onFrame` (one `req`/`res` ping proves the duplex path);
a structural test asserts `bootstrap.ts` imports those symbols from `@shared/remote/protocol`.

### REQ-011 — Failure classification: provisionable vs not
Connect failures MUST be classified into exactly three outcomes:
- `absent` (provisionable): the child exited with the launch sentinel **127** having produced ZERO
  decoded frames.
- `version-mismatch` (provisionable): the F15 client handshake failed with failure kind
  `version-mismatch` (the handshake header names F19 as this consumer).
- `fatal` (NOT provisionable): everything else — ssh transport/auth failure (OpenSSH exit **255**),
  any other handshake failure kind (`proto-mismatch`, `bad-hello`, `unexpected-frame`, framing
  errors), or an unexpected exit. The result MUST carry a specific diagnostic including the failure
  kind or exit code and a bounded excerpt of the child's stderr (CONV-001).
Provisioning MUST NEVER be attempted for a `fatal` classification (an auth failure is never "fixed"
by an upload).
**Acceptance:** scenario tests via the shim: empty home → `absent`; fake agent with a different
version → `version-mismatch`; shim forced to exit 255 before any frame → `fatal` carrying the
stderr excerpt; a proto-mismatch fake agent → `fatal`. A spawn-recording seam proves no upload
spawn occurs in the `fatal` cases (assertion scoped to upload commands, CONV-051).

### REQ-012 — Upload: streamed over a second exec channel, size-verified, atomic
`provisionAgent(options)` MUST stream the agent artifact bytes to a second system-ssh exec channel
whose remote command — `buildAgentUploadCommand(installPath, byteCount, nonce)` (pure) — MUST:
create the install dir (`mkdir -p`), `cat` stdin to a temp file `<installPath>.<nonce>.tmp` in the
SAME directory, verify the received byte count equals the client-computed `byteCount`
(`wc -c`), and only then atomically `mv` the temp file onto `installPath`; on a byte-count mismatch
it MUST remove the temp file and exit with the distinct sentinel **93** (so truncation is
detectable and the FINAL path is never occupied by a partial artifact — CONV-014, CONV-003). The
client MUST treat any nonzero upload exit as a failed provision with an actionable diagnostic
distinguishing size-mismatch (93) from transport failure (255) from other codes.
**Acceptance:** unit test pins the exact command string (given a fixed nonce). Shim integration:
a successful upload lands byte-identical artifact bytes at the install path and leaves no `.tmp`
file; a mid-stream-truncated upload leaves the install path ABSENT (or its previous content
intact) and reports the size-mismatch sentinel.

### REQ-013 — Nonce injection: deterministic tests, collision-safe default
The temp-file nonce MUST come from an injectable source (`options.nonce()`), defaulting to a
crypto-random string matching `^[a-z0-9]{8,}$`; the builder MUST reject a nonce outside
`^[A-Za-z0-9]+$` (it enters the remote command string). Tests inject a fixed nonce (determinism);
two concurrent provisions with distinct nonces cannot collide on the temp path.
**Acceptance:** unit tests: builder output with an injected nonce is byte-stable; an injected
nonce of `x; rm -rf ~` is rejected; the default source produces distinct values across calls and
matches the charset.

### REQ-014 — Bootstrap orchestration: classify → provision → retry ONCE
`connectWithProvisioning(options)` MUST: attempt connect; on a provisionable classification
(`absent` / `version-mismatch`) run provision then retry connect exactly ONCE; on a second
provisionable failure return a definitive failure whose diagnostic names both attempts' outcomes
(never a third attempt, never a loop); on `fatal` at any point return that failure immediately with
no (further) provisioning. Every terminal state MUST be one of: connected handle, `fatal` failure,
or `provision-ineffective` failure.
**Acceptance:** shim scenario tests: (a) absent → provision → connected; (b) mismatched fake agent
→ provision with the REAL artifact semantics (install path now matching version) → connected;
(c) a shim rigged so the artifact stays mismatched after provision → `provision-ineffective` after
exactly 2 connect attempts and 1 upload (spawn counts asserted, scoped per CONV-051); (d) auth-like
255 failure → `fatal`, zero uploads.

### REQ-015 — Version-lock: ONE canonical version, artifact injected
The bootstrap options MUST take the agent artifact as `{ artifactPath, version }` and MUST use that
single `version` value BOTH as the client handshake version AND for the remote install path — there
is no second version parameter that can silently diverge (CONV-006). The production pairing is the
repo `package.json` version with the `out/agent/termhalla-agent.cjs` bundle (`AGENT_VERSION` is
inlined from `package.json` at build time — the artifact is the unit of version-locking); the
library MUST NOT read `package.json` at runtime (the caller injects).
**Acceptance:** unit: the handshake init version and the install path version are provably the same
input; a structural test asserts `src/remote-client/` never imports/reads `package.json`. The
gold round-trip (REQ-017) proves the production pairing.

### REQ-016 — Abort semantics: kill children, indeterminate provision outcome
An in-flight `connectAgent`/`provisionAgent`/`connectWithProvisioning` MUST be abortable
(`AbortSignal` in options): abort kills the live child process(es) and settles the promise with an
aborted outcome. Aborting DURING an upload MUST report the provision outcome as **indeterminate**
(the atomic promote may or may not have completed remotely — CONV-015's honesty class), never as a
definite non-dispatch; the atomicity of REQ-012 guarantees the remote install path holds either the
old artifact or the complete new one, never a tear. Spawned children MUST NOT keep the parent
process alive after abort/settle (`unref` posture — the repo's long-lived-child gotcha).
**Acceptance:** integration: aborting mid-upload (shim rigged to stall reading stdin) settles with
an indeterminate-marked failure and the shim child exits; aborting before the agent hello settles
the connect with an aborted outcome; the vitest process exits without hanging (the suite completing
is the leak check).

### REQ-017 — Gold round-trip: the real bundle, provisioned through the shim, handshakes
One integration test MUST build the REAL agent bundle through the SAME `vite.agent.config.ts`
(scratch `outDir`, exactly like frozen TEST-774), then run `connectWithProvisioning` against an
EMPTY fake remote home via the shim with `{ artifactPath: <scratch bundle>, version: <package.json
version> }` and `--pty=fake`: the flow must classify `absent`, upload, relaunch, and complete the
F15 handshake against the real F16 agent — proving the uploaded artifact IS the runnable agent and
the version-lock holds end-to-end with no network and no real ssh.
**Acceptance:** the test passes on a checkout with no prior `npm run build` (CI reality: vitest
builds the bundle on demand); asserts the handle's version equals the `package.json` version and
capabilities equal `AGENT_V1_CAPABILITIES`.

### REQ-018 — The fake ssh shim: local, deterministic, network-free
The shim (`tests/fixtures/fake-ssh.mjs` or `.cjs`, spawned as `process.execPath + [shimPath]`) MUST
accept the REAL builder-produced argv (destination + one remote-command string), consult an
env-configured fake remote home (`FAKE_SSH_HOME`), and emulate exactly the two pinned remote
command shapes: the REQ-009 launch probe (absent → exit 127, no stdout; present → spawn
`process.execPath <installPath> --pty=<backend>` wiring stdio through — the agent runs as a LOCAL
child process) and the REQ-012 upload (stdin → temp file, byte-count check, atomic rename, exit 93
on mismatch) — implemented with Node `fs`/`child_process` primitives so it runs on windows-latest
CI (no `sh`, no POSIX shell dependency). Rig switches for failure scenarios (exit-255, stall) MUST
be env-driven (deterministic). The shim MUST NOT import `net`/`http`/`tls`/`dgram` (never a
network).
**Acceptance:** the scenario tests above all run through the shim; a structural test scans the shim
source for the banned network-module imports; the full suite passes with no network access.

## Public interface

`src/shared/remote-agents.ts` (pure):
- `interface NamedAgent`, `normalizeNamedAgents(raw: unknown): NamedAgent[]`,
  `seedNamedAgentFromConnection(conn, id, name): NamedAgent`.

`src/remote-client/ssh-command.ts` (pure):
- `buildSshExecArgv(agent: NamedAgentSeed, remoteCommand: string): string[]`
- `remoteAgentInstallPath(dir: string | undefined, version: string): string`
- `buildAgentLaunchCommand(installPath: string, ptyBackend: 'node-pty' | 'fake'): string`
- `buildAgentUploadCommand(installPath: string, byteCount: number, nonce: string): string`
- `DEFAULT_REMOTE_AGENT_DIR = '~/.termhalla/agent'`, sentinel constants (`127`, `93`).

`src/remote-client/agents-store.ts` (impure, path-injected):
- `loadNamedAgents(filePath): Promise<NamedAgent[]>`, `saveNamedAgents(filePath, agents): Promise<void>`.

`src/remote-client/bootstrap.ts` (impure):
- `connectAgent(opts): Promise<ConnectResult>`, `provisionAgent(opts): Promise<ProvisionResult>`,
  `connectWithProvisioning(opts): Promise<ConnectResult>` with
  `opts: { agent, artifactPath, version, ptyBackend?, ssh?: { program, prefixArgs }, nonce?,
  signal?, onDiagnostic? }`; results carry the classification (`absent` / `version-mismatch` /
  `fatal` / `provision-ineffective` / `aborted` / indeterminate-marked) and the session handle on
  success.

## Open questions

None blocking — the concept, transport, provisioning policy, and packaging were locked at roadmap
time (decisions 1, 2, 9–11; F16's single-file bundle answers roadmap open question 3 for this
feature). Non-blocking, recorded for F21: whether the remote `node` binary name/path should be
per-agent configurable (v1 pins the literal `node` on PATH of the remote login shell), and where
the registry file lives under `userData`.
