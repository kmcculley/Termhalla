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
  a plain-Node process cannot load, so `--pty=fake` must never touch it.
- **`fake`** — a deterministic scripted pseudo-shell (`echo` / `cwd` / `pwd` / `size` /
  `exit <code>`; OSC 133 + OSC 9;9 emission; no tty echo; no time/RNG). This is what CI and
  the vitest suite drive: no real ssh and no real node-pty anywhere in CI, over the IDENTICAL
  protocol path (locked decision 1). It ships inside the artifact deliberately so CI exercises
  the exact bytes `npm run build` produces.

## Lifecycle taxonomy

- stdin end → kill all panes, dispose the status engine, exit 0.
- Per-frame inbound errors (`bad-json` / `bad-message`) → stderr diagnostic, session continues
  (F15's taxonomy: the framing is intact).
- Fatal framing (`frame-too-large`) → stderr, panes killed, exit 1 (the decoder is dead).
- Post-handshake `hello`/`res`/`evt` (wrong direction in v1) → stderr diagnostic, ignored.
- Inbound `ack`/`window` → **inert by design**: accepted, no state change, no error. These are
  the reserved flow-control frames; **F17** (0018-windowed-flow-control) gives them semantics
  and retires the inertness pin (TEST-773) through its own tests phase.

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
  transport; v1 is **single-connection**: binding a second concurrent connection throws — an
  explicit guard that **F20** (0021-exclusive-attach-lease) retires with lease/steal semantics
  through its own tests phase.
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
