# SSH tunnel + client-provisioned agent bootstrap (Remote Agent v1, batch 3 — F19)

The CONNECTION layer of the Remote Agent epic: how the client reaches a remote host, how it knows
the agent there is the right build, and how it makes it so when it isn't. Ships as a **headless
library** in a new `src/remote-client/` tree plus a pure shared model — **no renderer/main/preload
wiring** (F21 is the consumer; F15's TEST-746 scope guard and F19's own TEST-2001 scope guard both
survive until then). Feature dir: `.orky/features/0020-ssh-tunnel-provisioned-bootstrap`.

## The transport (locked decision 1)

The tunnel is a **stdio exec channel over the SYSTEM `ssh` binary** — `spawnSsh`
(`src/remote-client/ssh-spawn.ts`) spawns the user's own OpenSSH client (default program literally
`ssh`, PATH-resolved; injectable `{ program, prefixArgs }` for tests) with an argv ARRAY (no shell)
— **never an SSH library** (frozen TEST-2003 scans dependencies and imports). This inherits
`~/.ssh/config`, jump hosts, hardware keys, and 2FA prompting for free.

`buildSshExecArgv` (`src/remote-client/ssh-command.ts`, pure) mirrors the SSH-favorites seeding
rules of `buildSshArgs` (`src/shared/quick.ts` — untouched): `[-p PORT] [-i IDENTITY] user@host
<one command string>`; port omitted when unset/0/22; **never `-t`** (stdout must stay 8-bit clean
for frames) and never a BatchMode override (interactive auth is the point). Every seeded field is
validated before any argv exists (option-injection guards: no leading `-`, no whitespace/control
chars, no `@` in host/user; remote paths against `^[A-Za-z0-9._/~-]+$` with `..` segments rejected;
version/nonce charsets) — specific, actionable errors per CONV-001.

## Named agents (the connection registry)

`src/shared/remote-agents.ts` (pure): `NamedAgent { id, name, host, user, port?, identityFile?,
remoteAgentDir? }` — connection config only, **no secrets** (identity-file PATH at most, exactly the
baseline `quick.json` posture). `seedNamedAgentFromConnection` copies exactly
host/user/port/identityFile from an SSH favorite and never the tmux fields.
`normalizeNamedAgents` strips unknown fields (nothing secret can ride a round-trip), drops invalid
records, and never throws. `src/remote-client/agents-store.ts` is the **path-injected** JSON store
(F19 binds no persistence location — F21 wires it under `userData`): normalize on read AND write,
missing/garbage file → `[]`, atomic save (unique per-call temp name + rename).

## The bootstrap (locked decision 2 — client-provisioned, version-locked)

`src/remote-client/bootstrap.ts`:

- `connectAgent` launches the (expected) installed agent via the pinned probe command
  `test -f <path> && exec node <path> --pty=<backend> || exit 127` and drives the **F15 client
  handshake** (`createClientHandshake` + `createFrameDecoder` + `encodeFrame` from
  `@shared/remote/protocol` — reused, never re-derived; the client emits NOTHING until the agent
  hello). Success → a session handle `{ version, capabilities, send, onFrame, onExit, kill }`.
- `classifyConnectOutcome` (`classify.ts`, pure truth table): **exactly two provisionable
  outcomes** — `absent` (probe sentinel 127 with zero frames) and `version-mismatch` (the F15
  failure reason the handshake header names F19 for). Everything else is `fatal` and never triggers
  an upload (an auth failure is never "fixed" by uploading): ssh transport exit 255, any other
  handshake/framing failure, unexpected exits. Diagnostics carry a bounded (400-char),
  **control-char-sanitized** stderr excerpt; pre-hello framing failures append the shell-rc-noise
  hint (see Known limitations).
- `provisionAgent` streams the bundled artifact over a SECOND exec channel:
  `mkdir -p <dir> && cat > <tmp> && [ "$(wc -c < <tmp>)" -eq <n> ] && mv <tmp> <final> ||
  { rm -f <tmp>; exit 93; }` — size-verified, atomically promoted; **the final path is never
  occupied by a partial artifact** (a truncated stream exits 93 with the temp removed). The temp
  nonce is injectable (deterministic tests), crypto-random by default.
- `connectWithProvisioning`: classify → provision → **retry exactly once** →
  `provision-ineffective` (never a loop). Aborting mid-upload reports **indeterminate** (CONV-015:
  the atomic promote may or may not have landed — the install path holds either the old artifact or
  the complete new one, never a tear).

**Version-lock:** ONE canonical `version` input drives both the handshake identity check and the
versioned install path `~/.termhalla/agent/termhalla-agent-<version>.cjs` (an upload for V can
never tear the artifact a running W was launched from). Production pairing: the repo
`package.json` version + `out/agent/termhalla-agent.cjs` (whose `AGENT_VERSION` was inlined from
the same file at build time — the artifact is the unit of version-locking). The library never
reads `package.json` itself (TEST-2004); the caller injects both.

## Testing (no network, no real ssh — ever)

`tests/fixtures/fake-ssh.mjs` is the **fake system-ssh shim**: spawned as
`process.execPath + [shim, ...real argv]`, it parses the builder-produced argv, emulates the two
pinned remote-command shapes against an env-configured fake remote home (`FAKE_SSH_HOME`) with Node
primitives (windows-latest-safe, no POSIX shell), spawns the agent as a **local child process**
(the identical protocol path production runs over ssh), logs invocations (`FAKE_SSH_LOG`) for
CONV-051-scoped spawn counting, and offers deterministic failure rigs via `FAKE_SSH_RIG`
(`exit255`, `stall`, `ignore-upload`, `truncate:<n>`). Scenario agents are canned-bytes scripts
generated per test with the real `encodeFrame`. The gold test (TEST-2033) builds the REAL bundle
through `vite.agent.config.ts` (scratch outDir, the TEST-774 pattern) and proves absent → upload →
handshake against the real F16 agent with the real version. Suite: TEST-2001..TEST-2033
(feature-number-keyed id block — see `04-tests.md` for the collision rationale).

## Contract notes / known limitations (v1)

- **Cancellation is the caller's.** There is deliberately NO built-in connect/handshake timeout —
  a hard timeout would race 2FA/hardware-key prompting, which the system-ssh transport exists to
  inherit. A signal-less `connectAgent`/`connectWithProvisioning` against a host that accepts the
  TCP connection and then wedges will wait indefinitely: **the caller (F21 UX) MUST own
  cancellation via `options.signal`** (abort kills the children and settles; mid-upload aborts are
  reported indeterminate). Recorded as FINDING-005.
- **Remote `node` is assumed on the login shell's PATH.** A missing node exits 127 exactly like a
  missing artifact, so the flow classifies `absent`, provisions once, and ends
  `provision-ineffective` — the diagnostic names this conflation and the fix (FINDING-004; the
  distinct-sentinel probe is a recorded follow-up needing a tests-phase amendment).
- **Shell-rc stdout noise corrupts framing by design-honesty.** A `.bashrc` that prints to stdout
  on non-interactive exec corrupts the length-prefixed stream before the hello; the connect fails
  `fatal` with a diagnostic hinting at the rc-noise cause (FINDING-006). Skip-to-first-frame
  recovery is deliberately rejected (it would mask real corruption).
- **No artifact GC:** old `termhalla-agent-<v>.cjs` files accumulate (~52 KB each) — FINDING-007,
  deferred.
- Deferred items live in
  [`docs/superpowers/0020-ssh-tunnel-provisioned-bootstrap-review-followups.md`](../superpowers/0020-ssh-tunnel-provisioned-bootstrap-review-followups.md).

## Structural guards

`tests/remote-client-structure.test.ts`: `src/remote-client/` imports no electron/renderer/
preload/main module; **no file under the three app trees imports `remote-client`** (scope guard,
retirement named: F21, CONV-019/CONV-037); `src/shared/remote-agents.ts` is environment-pure;
no ssh-implementation dependency (a scoped invariant, deliberately NOT an equality pin of the
dependency sets — CONV-022); remote-client never references `package.json`; the protocol barrel is
the only handshake source (no hand-built hello literals); the shim imports no network module.
`tsconfig.node.json` include gained `src/remote-client` (additive; frozen TEST-758 unaffected).
Zero behavior change to the running Electron app; `SCHEMA_VERSION` untouched.
