# Remote agent runtime skeleton (feature 0017)

The walking skeleton of the Remote Agent v1 epic: a **headless Node agent** living in this repo
that speaks the F15 wire protocol (`src/shared/remote/`, see
[remote-protocol](remote-protocol.md)) over **stdio** and implements exactly the **pty + status**
domains — tmux parity. Everything downstream (flow control, replay, ssh provisioning, client
routing) builds on this process.

## Location, build, artifact

- Source: `src/agent/` (a fourth executable tree beside main/preload/renderer — nothing under
  the three Electron layers imports it, and the running app's behavior is unchanged).
- `npm run build` chains `vite build --config vite.agent.config.ts` after the electron-vite
  build and emits a **single-file plain-Node artifact**: `out/agent/termhalla-agent.cjs`.
  Node builtins and `node-pty` are external; everything else — the F15 protocol, the reused
  `src/main/status/` detection stack, the embedded `package.json` version — is bundled. With
  `--pty=fake` the artifact runs with zero `node_modules`.
- `npm run typecheck` covers `src/agent` (via `tsconfig.node.json`); `npm test` runs the agent
  suites in `tests/` — the stdio integration test bundles the agent on demand through the SAME
  vite config (outDir redirected to a temp dir), so a bare `npm test` needs no prior build.

## Process contract

```
node termhalla-agent.cjs [--pty=node-pty|fake]     (default: node-pty)
```

- **stdout carries protocol frames ONLY** — every diagnostic goes to stderr. Any byte the
  agent writes to stdout parses as F15 frames; the integration test decodes the entire stream
  to prove it.
- **The process exit code contract:** exit code `0` = clean shutdown (stdin ended — the ssh
  channel or parent went away; live panes are killed, nothing keeps the process alive), `1` =
  protocol-fatal (handshake failure, fatal framing such as an oversized declared length, or an
  outbound encode/write failure), `2` = CLI usage error (unknown flag or `--pty` value; usage
  text on stderr, nothing on stdout).

## Handshake

The agent speaks **first**: its hello carries `proto = WIRE_PROTO`, `role: 'agent'`,
`version` = this repo's `package.json` version (inlined at build time — the artifact is the
unit of version-locking, since the client provisions the agent), and `capabilities` =
`AGENT_V1_CAPABILITIES` (`['pty', 'status']`). The client's reply hello must match the version
by **exact string identity** — a version check, NOT a compatibility matrix. On any handshake
failure the agent emits no further frame, writes the reason (`version-mismatch`,
`unexpected-frame`, `bad-hello`, `proto-mismatch`) to stderr, and exits 1.

## Method surface (req → res)

Method strings are the local `CH` channel values; params are the SHARED
`src/shared/ipc-contract.ts` types. Every valid `req` gets exactly one `res` with the same id.

| method | params | result | notes |
|---|---|---|---|
| `pty:spawn` | `PtySpawnArgs` `{ id, shellId, cwd, cols, rows }` | `boolean` | `false` = fresh, `true` = adopted (id already live — never respawned; mirrors the local idempotent-adopt). Empty `cwd` resolves to the agent home; any `shellId` resolves to the agent's default POSIX shell (`$SHELL`, else `/bin/sh`). `launch`/`envId` are rejected as unsupported in v1. |
| `pty:write` | `PtyWriteArgs` `{ id, data }` | `null` | |
| `pty:resize` | `PtyResizeArgs` `{ id, cols, rows }` | `null` | positive integers required — validated, never clamped |
| `pty:kill` | the pane id as a bare string | `null` | the pane's `pty:exit` event still fires |

Error codes (`res.error.code`, from `src/shared/remote-agent-api.ts` — `AGENT_ERROR_CODES`):
`bad-params` (strict validation: wrong types, unknown keys, out-of-range dims — named
offender), `unknown-method` (anything outside the four methods, including unadvertised domains
and the local-only `pty:transit-begin`), `unknown-pane` (write/resize/kill on a non-live id — a
deliberate, disclosed divergence from the local fire-and-forget voids: a remote client cannot
observe agent state any other way), `spawn-failed` (backend spawn threw; nothing registered),
`internal` (a handler failed; the session survives).

## Push events (evt)

Mirroring the local main→renderer pushes, channel strings are the `CH` values:

- `pty:data [id, data]` — per-pane, order-preserving.
- `pty:exit [id, code]` — exactly once per pane lifetime, after that pane's final data.
- `pty:status [id, TerminalStatus]` — **status detection at the source**: each pane's output
  feeds the EXISTING `src/main/status/` engine (OSC 133 markers, needs-input, cwd) on the
  agent, so status chips work identically for remote panes. Emitted on change only.
- `pty:cwd [id, cwd]` — from the engine's `CwdParser`; OSC `9;9;<path>` round-trips POSIX
  paths verbatim (OSC 7 `file://` URLs pass through the parser's pre-existing Windows-oriented
  heuristics — disclosed in the feature spec; single-letter first segments can misread).

`pty:procs` is NOT part of the v1 status domain (the local process tree is a Windows CIM
stack; a POSIX proc tree is deferred with the domain-ports epic).

## Pty backends

The core depends on an injected backend interface (`src/agent/pty-backend.ts`):

- **`node-pty`** (default) — the real thing: POSIX-shaped, **Linux-only in v1** (macOS is
  designed-cheap later; Windows-remote is a non-goal). The `node-pty` module is loaded
  **lazily, only when this backend is selected** — dev checkouts carry an Electron-ABI binary
  a plain-Node process cannot load, so `--pty=fake` must never touch it. A stock `(linux, x64,
  glibc)` remote with only `node` on it used to fail this `import` with `ERR_MODULE_NOT_FOUND` —
  feature 0023 has the client **co-provision** a released prebuilt `node-pty` onto the remote at
  connect time so the bare specifier resolves with zero manual remote setup; see
  [remote-node-pty-prebuilt](remote-node-pty-prebuilt.md).
- **`fake`** — a deterministic scripted pseudo-shell (`echo` / `cwd` / `pwd` / `size` /
  `exit <code>` / `flood <chunks> <chunkBytes>`; OSC 133 + OSC 9;9 emission; no tty echo; no
  time/RNG). This is what CI and the vitest suite drive: no real ssh and no real node-pty
  anywhere in CI, over the IDENTICAL protocol path (locked decision 1). It ships inside the
  artifact deliberately so CI exercises the exact bytes `npm run build` produces. `flood`
  (added by 0018) emits exactly `<chunks>` separate emissions of exactly `<chunkBytes>`
  deterministic filler units — the scripted cat-a-huge-file that drives the flow-control
  proofs; malformed or oversized args (total capped at 16,777,216 units) fail loud with one
  actionable line + `D;1` and leave the pane alive.

Both backends implement `pause()`/`resume()` (added by 0018 — see Flow control below): the real
backend maps them DIRECTLY onto node-pty's own socket-level flow control; the fake models them
deterministically — while paused it delivers nothing (output queues in order), `resume()`
flushes synchronously (a consumer callback may re-pause mid-flush; the remainder stays queued),
a SCRIPTED `exit` while paused defers until the queue has flushed (exit-last preserved), and
`kill()` is never deferred. Both are idempotent.

## Flow control (F17 / 0018-windowed-flow-control — protocol-level backpressure, day-one)

The cat-a-huge-file problem is solved at the protocol level (locked decision 4), over F15's
reserved `ack`/`window` frame shapes, with the semantics in ONE pure shared module —
`src/shared/remote/flow-control.ts`, exported only via `@shared/remote/protocol` — so both
endpoints share the measure by construction:

- **The measure** is UTF-16 code units of the `pty:data` payload string
  (`flowPayloadSize(data) === data.length`). The wire field name `bytes` is F15's frozen shape;
  proportionality, not byte-exactness, is what bounds memory.
- **Agent side** (`createAgentFlowGate`, wired in `session-store.ts` since the 0019 store
  split moved the emit path there; the connection in `session.ts` forwards inbound
  `ack`/`window` frames via `flowAck`/`flowWindow`): every DELIVERED `pty:data`
  payload is counted per pane; when unacked units EXCEED the pane's window the pane's backend
  is `pause()`d synchronously within that very delivery, and it `resume()`s when acks drain the
  count to the **low watermark** `floor(window / 2)` ("drained" — resume-at-zero would deadlock
  a quantized acker; resume-at-window would thrash). Per-pane decisions strictly alternate
  pause → resume. Under the deterministic fake backend the bound is exact: once paused, a pane
  emits nothing further, so unacked ≤ window + the crossing chunk.
- **Window** (`window` frame): with `id`, a per-pane override (live panes only — windows for
  unknown panes are diagnosed and NEVER stored, so a client cannot grow agent memory with
  speculative windows); without `id`, the connection-wide default for panes without an explicit
  override and for future panes. Defaults: `DEFAULT_FLOW_WINDOW_BYTES` = 1 MiB.
- **Ack** (`ack` frame): decrements the pane's count. Over-acks clamp to zero with ONE stderr
  diagnostic (never a silent cap); acks for unknown panes are silently tolerated — an ack
  racing a pane's exit is a normal interleaving. Flow frames are fire-and-forget: never
  answered with a `res`.
- **Client side** (`createClientAckPolicy`): acknowledges the FULL per-pane accumulation every
  `DEFAULT_ACK_EVERY_BYTES` = 64 KiB (16:1 vs the window); sub-quantum residue is flushed by
  the CONSUMER (`flush()`, sorted by pane id) — the policy holds no timers. Its production
  consumer arrives with F21 (client routing); today the vitest suites drive it.
- **Lifecycle:** a pane's exit prunes ALL its flow state (a reused id starts fresh under the
  connection default); session end clears everything.
- **Across detach/reattach (the 0018 ⊗ 0019 weld):** flow accounting is CONNECTION-scoped
  even though the gate rides the session store. Unacked units measure what the BOUND client
  has received and not yet acked; while detached no `pty:data` is delivered (output feeds only
  the replay terminal, which applies no backpressure), so `unbind()` resumes any pane the
  departed client's stall had paused — otherwise a pane paused at disconnect would record
  nothing into replay while away, breaking the survival contract — and resets counters,
  per-pane window overrides, and the connection default. The reset mirrors the client side:
  `createClientAckPolicy` is per-connection, so a persisted agent-side residue could never be
  acked away by a fresh client and would ratchet toward a permanent pause (residue past the
  low watermark is unrecoverable by any ack sequence).

Proven by a scripted flood against a deliberately stalled consumer (zero acks → bounded
emission, the session keeps serving other panes) and a recovery pass (policy-driven acks drain
the flood to completion byte-for-byte), both in-process and over the real stdio artifact
(`tests/agent-session-flow.test.ts`, `tests/agent-stdio-flow.test.ts`).

## Lifecycle taxonomy

- stdin end → kill all panes, dispose the status engine, exit 0.
- Per-frame inbound errors (`bad-json` / `bad-message`) → stderr diagnostic, session continues
  (F15's taxonomy: the framing is intact).
- Fatal framing (`frame-too-large`) → stderr, panes killed, exit 1 (the decoder is dead).
- Post-handshake `hello`/`res`/`evt` (wrong direction in v1) → stderr diagnostic, ignored.
- Inbound `ack`/`window` → **flow-control semantics** (since 0018 — see Flow control above; the
  0017-era inertness pin in TEST-773 was retired through 0018's tests phase exactly as its
  retirement path prescribed): fire-and-forget, never answered with a frame, applied to the
  pane's flow gate.

## Non-goals here

Replay/scrollback (F18 — LANDED, see "Session survival + replay" below), ssh tunnel +
provisioning (F19), attach lease (F20), client routing
and any renderer/main wiring (F21 — F15's zero-consumer scope guard TEST-746 survives this
feature unchanged, exactly as its header prescribes).

## Session survival + replay (F18 / 0019-agent-replay-session-survival)

Sessions survive client disconnect/death (locked decision 3). The machinery is agent-side and
transport-independent:

- **Store/connection split.** Pane ownership (PTY handles, replay terminals, the status engine,
  cached cwd/status/dims) lives in a **session store** (`src/agent/session-store.ts`) that can
  outlive any one protocol connection. `createAgentSession` takes either `{ backend, homeDir }`
  (the F16 composition: the session owns its store and destroys it on every end path — the
  SHIPPED stdio artifact behavior is unchanged: stdin end still kills panes and exits 0) or
  `{ sessions: store }` (the survival composition: every connection-end path — clean EOF, fatal
  framing, handshake failure, a failed outbound send — merely **detaches**; panes keep running
  and their output keeps feeding replay + status). F19/F21 wire this seam to a reattachable
  transport. Binding while another connection holds the store **steals the lease** (see
  "Exclusive attach lease" below) — the 0019-era guard that threw here was retired by **F20**
  (0021-exclusive-attach-lease) through its own tests phase, exactly as its recorded
  retirement path prescribed.
- **One `@xterm/headless` terminal per PTY** (`src/agent/replay.ts`, the only file allowed to
  import `@xterm/headless` / `@xterm/addon-serialize`), with **bounded scrollback** — the tmux
  `history-limit` analog. The default is `HISTORY_LIMIT_DEFAULT = 2000` lines (tmux's own
  default), overridable per store (`scrollback`) — deliberately NOT a CLI flag; sizing policy
  and GC of never-reattached sessions remain the roadmap's recorded open question (no GC ships
  in v1). Reboot survival is NOT promised (agent supervision is the other recorded open
  question).
- **`pty:attach` `{ id }`** → `{ snapshot, cols, rows, cwd, status }`: the serialize-addon
  snapshot of the pane's headless terminal plus current metadata, so the client repaints the
  pane EXACTLY. `status` re-shapes `TerminalStatus` with an absent `lastExit` as a **dropped
  key** (F15's strict validator rejects `undefined` — the F16 `pty:status` precedent). Unknown
  or already-exited ids (including a pane that exits while the snapshot is in flight) fail with
  `unknown-pane`; a pane whose replay previously failed reports `internal` rather than a
  silently-wrong snapshot. **Ordering invariant:** no `pty:data` for the pane is delivered
  between the attach req and its res; bytes arriving in that window are excluded from the
  snapshot (the barrier opens with the dispatch) and delivered exactly once, in order, right
  after the res — writing the snapshot into a fresh terminal and applying subsequent `pty:data`
  reproduces the full stream byte-exactly. Overlapping attaches on one pane are rejected
  (`internal`, retry after the res) - windows never coexist, so a byte can never ride both
  a snapshot and an event. `cols`/`rows` in the result are the current authoritative pty
  dims at res time; size the terminal from them, then write the snapshot (a resize landing
  inside the window can only rewrap, never corrupt).
- **`pty:sessions` (params `null`)** → the survival inventory: one entry per LIVE pane, sorted
  by id — `{ id, shellId, cwd, cols, rows, attached, status }` (`attached` = whether the asking
  connection spawned/adopted/attached it). Exited panes vanish (an exit while detached is
  silent by design); an empty agent answers `[]`.
- **No transit-buffer reuse, no missed-event queue.** The window-manager transit buffer (a
  1024-event/10s-GC same-machine handoff primitive) is explicitly the WRONG tool and is not
  imported; while detached, NO frames are constructed or queued — the headless terminal IS the
  history, plus the cwd/status caches. `pty:spawn` on a live id still adopts (returns `true`)
  WITHOUT replaying history: `pty:attach` is the snapshot-bearing verb.
- **Vocabulary:** `AGENT_SESSION_METHODS = ['pty:attach', 'pty:sessions']`, the result types
  (`AgentAttachResult`, `AgentSessionInfo`, `AgentStatusPayload`) ride
  `src/shared/remote-agent-api.ts` (defined in `src/agent/session-api.ts`, the error-codes
  two-door pattern). No new error codes and no new frame types were added; the capability
  advertisement is unchanged (the methods live in the `pty` domain).

## Exclusive attach lease (F20 / 0021-exclusive-attach-lease)

`tmux attach -d` semantics, agent-side (locked decision 5 — **no mirrored/shared attach** in
v1): the session store's binding IS the lease, and **exactly one** connection holds it at every
instant.

- **Grant** — binding an unbound store (what handshake establishment already does).
- **Release** — every connection-end path (clean EOF, fatal framing, handshake failure, a
  failed outbound send) detaches exactly as F18 defined; a released store is re-bindable.
- **Steal** — binding while another connection is bound no longer throws: within the one
  synchronous `bind()`, the incumbent is (a) detached with the full unbind semantics (its
  gate-paused backends resume while NO client is bound, so the flushed backlog feeds the
  replay terminal only; the flow gate resets — the winner starts a fresh window, per-pane
  overrides forgotten; its in-flight attach windows are generation-invalidated and settle
  inert), then (b) notified, then (c) the newcomer holds. The newer attach always wins; binds
  resolve strictly in arrival order, so concurrent attach races resolve deterministically. A
  displaced client's fresh connection may simply bind again — steal-back is just another
  attach.
- **The loser learns it** — its connection receives `{ type: 'evt', channel: 'lease:revoked',
  args: [] }` (`AGENT_LEASE_REVOKED_EVT` in `src/shared/remote-agent-api.ts`, defined in
  `src/agent/session-api.ts` — the two-door pattern) as its **FINAL frame**, then ends with
  exit code 0 (an orderly displacement, not a protocol fault). Nothing follows the evt: no
  pane frames, no res to in-flight requests. F21's client drops that workspace to its
  disconnected state (the banner) on receipt. Delivery is best-effort: a dead sink is
  diagnosed and the end proceeds.
- **Holder-scoped release** — a displaced connection's late end activity (a trailing EOF, a
  fatal frame) can never detach the winner: the displaced session skips its store release
  (the store already detached it).
- **No agent-side byte loss** — bytes the loser never received (its stalled tail, bytes held
  in its interrupted attach window) fed the replay terminal at emission; the winner's
  `pty:attach` snapshot ⊕ subsequent `pty:data` reproduces the full stream byte-exactly
  (F18's composition oracle, re-proven across the steal boundary).
- **The shipped stdio artifact's default (no-flag) mode is unaffected** — one stdio connection
  per process means a steal is unreachable there; the owned (F16) composition never shares a
  store, so it can never steal and never emits the evt. Over `--daemon` mode (feature 0024,
  below) a steal IS reachable end-to-end: two real client connections against the SAME
  persistent daemon race exactly this way, and the epic's integration phase proves the composed
  story over real bridge processes.

## Daemonization (feature 0024-agent-daemonization)

The v1 agent gained a THIRD mode, `--daemon`, that detaches the survival composition above from
any single client connection (the tmux model): `docs/features/remote-workspaces.md` § "Reconnect
+ daemon survival" tells the client-side half of this story; this section is the on-disk/wire
contract.

- **CLI modes (additive, `src/agent/args.ts` / `main.ts`):** default (no flag) = the byte-identical
  F16 stdio agent above; `--daemon` = the persistent listener (this section); `--attach` = the
  bridge (below). Mutually exclusive; combining them is a usage error (exit 2). `--daemon`/`--attach`
  each REQUIRE a scope: `--ws=<token>` (`^[A-Za-z0-9_-]{1,64}$` — derives the workspace-keyed
  socket/metadata/log names, locked D6′) or an explicit `--socket=<path>` (override; a named-pipe
  path on win32 — the portable test substrate). Both also gain `--idle-timeout-ms=<n>` (positive
  integer; overrides `DAEMON_IDLE_TIMEOUT_DEFAULT_MS` = 300000, i.e. 5 minutes).
- **One daemon PER WORKSPACE (locked D6′).** Each remote workspace gets its OWN daemon, socket, and
  F20 lease — the socket is keyed by a stable `wsToken` derived client-side from the Termhalla
  workspace id (`deriveWsToken`), so two workspaces pointed at the SAME host+user are fully
  independent (opening the second never disconnects the first — REQ-018). Reconnecting the same
  workspace derives the same token and finds the same daemon.
- **Transport: a unix-domain socket, never a network listener.** `<agentDir>/agent-<wsToken>.sock`
  (`socketFileName(wsToken)`, version-stable — no app/protocol version digits, so the socket path
  never changes across an upgrade) lives beside the running artifact (production:
  `~/.termhalla/agent`, the F19 `DEFAULT_REMOTE_AGENT_DIR`). Owner-only on POSIX (mode 0600, CREATED
  0600 by a temporarily restrictive `umask(0o077)` around the bind — no chmod-after-listen window);
  a named pipe on win32 (the test substrate only — v1 remotes are Linux).
- **Metadata: `<agentDir>/daemon-<wsToken>.json`**, written strictly AFTER the socket is listening
  (its existence therefore implies a bound listener) and removed on every clean daemon exit under an
  OWNERSHIP re-check (a superseded daemon never unlinks a successor's endpoint). The shape is
  CROSS-VERSION FROZEN — exactly `{ formatVersion: 1, pid, version, proto, backend, startedAt }`, no
  other fields, no secrets, no host identity — so a newer client can always read an older daemon's
  file (`proto` is the daemon's WIRE-protocol version, decoupled from the app `version` — this is
  how protocol-drift refusal names the daemon's proto, below).
- **Log: `<agentDir>/daemon-<wsToken>.log`**, truncated at the start of each daemon generation AND
  size-capped within a generation at `DAEMON_LOG_MAX_BYTES` (1 MiB — a survival daemon's generation
  is wall-clock unbounded, so truncate-at-start alone is not a bound), diagnostics only (the
  detached daemon's stdout/stderr route here too, so an uncaught crash leaves a trace) — NEVER PTY
  payload bytes or user keystrokes.
- **Each ssh exec channel is a thin byte-transparent bridge (`--attach`), not the daemon itself.**
  The daemon-flow remote command is `test -f <path> && exec node <path> --attach --pty=<backend>
  --ws=<token> || exit 127` (the same absent→127 classification as the F19 direct-exec probe). The
  bridge: tries the socket; on no-listener, spawns `node <sameArtifact> --daemon --pty=<backend>
  --ws=<token> [...]` DETACHED (`setsid` semantics — no inherited fds, so the ssh channel closes
  promptly on disconnect even while the daemon keeps running) and polls the socket bounded by
  `DAEMON_SPAWN_WAIT_MS` (10 s); emits exactly one machine-parseable stderr line —
  `TERMHALLA_BRIDGE_V1 {"spawned":bool,"daemonVersion":string|null,"daemonProto":number|null,"daemonPid":number|null}`
  — before piping a single application byte; then pipes stdin↔socket with ZERO frame inspection. The
  bridge NEVER removes any file (FINDING-016 — all reclaim lives in the daemon's serialized claim).
  Exit taxonomy: `0` clean end (either side's EOF, including a lease displacement, propagated by
  half-closing/ending the other side), `BRIDGE_DAEMON_UNREACHABLE_EXIT` = 96 (could not reach a
  listening daemon), `2` usage — distinct from every other reserved exit in the remote stack
  (127/93/94/95/12, the agent's own 0/1/2).
- **Exactly one daemon per workspace-scoped socket, crash-safe (locked D6′).** A bind race between
  two concurrent first-connects to ONE workspace resolves to exactly one winner; the loser concedes
  without touching the winner's socket/metadata. A dead daemon's remnants (socket file + a
  `daemon-<wsToken>.json` whose pid is no longer alive) are reclaimed INSIDE the daemon's serialized
  claim (probe → pid-liveness check → remove-proven-remnants → re-bind, one guarded loop) — the
  recorded pid is ALWAYS checked for liveness before anything is removed, so a live-but-momentarily-
  busy daemon is retried within the readiness deadline, never reclaimed (known v1 limitation: if the
  OS reuses a crashed daemon's pid, that path can wedge until manual recovery — the 96 diagnostic
  names the escape hatch).
- **Idle self-exit (locked D3).** A REALLY-scheduled timer (`src/agent/daemon-lifecycle.ts`) arms
  whenever the daemon is empty — ZERO live panes AND ZERO ESTABLISHED CONNECTIONS (a COUNT, never a
  boolean: with ≥2 connections, one ending must not arm) — and cancels on a protocol establishment
  or a pane spawn; on fire (or SIGTERM) it runs ONE shared, ownership-checked cleanup: kill remaining
  panes, dispose the store, remove the socket + metadata files it still owns, exit 0.
- **Version drift under auto-update: the wire protocol is versioned separately from the app (locked
  D4′ — survival wins).** Termhalla auto-updates on quit, so close → update → reopen bumps the APP
  version on the common path. The daemon-flow handshake therefore establishes on WIRE-PROTOCOL
  compatibility ONLY (`createDaemonAgentHandshake` / `createDaemonClientHandshake`, accepting any
  peer `proto` within `DAEMON_PROTO_COMPAT`; the app `version` is advisory), so a routine update
  (proto unchanged) reattaches to the still-running old-app-version daemon and its sessions survive
  the update. Only a genuinely protocol-BREAKING release drifts: when an upgraded client's handshake
  fails `proto-mismatch` against an EXISTING daemon (the bridge status line's `spawned: false`), the
  client classifies a distinct `daemon-protocol-drift` outcome (folded into the existing `fatal`
  `ConnectFailureKind` — no new client-visible kind): NON-destructive (no kill, no socket removal,
  no upload, no provision-retry loop — a running process is not a provisionable artifact), naming
  both proto/version pairs and `daemon-<wsToken>.json`'s recorded pid, and stating the old daemon's
  live sessions keep running unharmed. Recovery is either the daemon idling out or a manual `kill` of
  the recorded pid; the NEXT connect after that spawns the new version fresh. A mismatch that follows
  a FRESH spawn (a torn/wrong artifact at the versioned path) falls through unchanged to F19's
  existing provisionable `version-mismatch` row. The exact-version machines and the default stdio
  mode are untouched — the daemon-flow relaxation is strictly additive.
- **Client change is confined to the launch/transport layer (REQ-013/014).** `BootstrapOptions`
  gained one optional field, `daemon?: { workspaceId }` (absent ⇒ byte-identical to the pre-0024
  direct-exec flow — every pre-existing suite runs unedited); node-pty co-provisioning and the F19
  provision-once upload sequence run BEFORE the daemon launch, unchanged. Zero renderer/preload/
  IPC/`SCHEMA_VERSION` change; `src/main/services.ts` passes the workspace id as the scope. See
  `docs/features/remote-workspaces.md` for why the reconnect/reattach client code itself needed
  no change at all.
