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
- **The shipped stdio artifact is unaffected** — one stdio connection per agent process means
  a steal is unreachable over `termhalla-agent.cjs` in v1; the lease is exercised over the
  survival composition in-process (the F19/F21 transport wiring makes steals reachable
  end-to-end; the epic's integration phase proves the composed story). The owned (F16)
  composition never shares a store, so it can never steal and never emits the evt.
