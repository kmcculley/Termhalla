# Spec — 0017-agent-runtime-skeleton

**Phase:** 2 (spec). **Inputs:** `00-intake.md` (roadmap entry F16 verbatim + locked decisions,
human-confirmed 2026-07-04), `.orky/conventions.md`, `.orky/baseline/` (adopted brownfield repo),
F15's merged artifacts (`src/shared/remote/`, its frozen suite, `docs/features/remote-protocol.md`).
No `01-concept.md` — app-run mode: the concept was fixed at roadmap time.

## Concerns

`["networking", "determinism"]`

(`networking` — this feature is the protocol's first live endpoint: a process speaking frames over
stdio, request/response dispatch, push events, partial/coalesced chunk delivery, peer-failure
handling. `determinism` — CI exercises the agent through a deterministic scripted pty backend; the
frame sequence observable on stdout must be a function of the inbound stream + backend script, with
no time/RNG dependence in any assertion path. Always-on lenses per config: security, quality,
devils-advocate. `data-provenance` is NOT tagged: no bundled external reference data — every pinned
constant derives from this repo's own source tree.)

## Scope summary

The walking skeleton of the Remote Agent v1 epic: a **headless Node agent living in this repo**
under a new `src/agent/` tree that

1. speaks **F15's protocol over stdio** — stdin carries inbound frames, stdout carries outbound
   frames and NOTHING else — reusing `@shared/remote/protocol` (framing, strict message validation,
   handshake machines, correlation shapes) and never re-deriving it;
2. performs the **agent-first handshake** (version = this repo's `package.json` version,
   capabilities = F15's pinned `AGENT_V1_CAPABILITIES` constant `['pty', 'status']`);
3. implements ONLY the **pty + status domains** (locked decision 6, tmux parity): req methods
   `pty:spawn` / `pty:write` / `pty:resize` / `pty:kill` mirroring the local `pty:*` IPC surface,
   push events `pty:data` / `pty:exit` mirroring the local main→renderer pushes;
4. runs **status detection at the source**: each pane's output stream feeds the EXISTING
   `src/main/status/` engine (OSC 133 / needs-input / cwd — imported, never forked), so the agent
   pushes `pty:status` / `pty:cwd` events computed exactly like local panes;
5. abstracts the pty behind an **injectable backend**: the real `node-pty` backend (Linux-only in
   v1, POSIX-portable by design) plus a deterministic **fake backend** that CI/vitest drives —
   because no real ssh (locked decision 1) and no real node-pty run anywhere in CI (v1 real-pty is
   Linux-only per decision 9, and dev checkouts carry an Electron-ABI node-pty a plain Node child
   cannot load); the protocol path is IDENTICAL either way;
6. **folds the agent into the existing gate commands**: `npm run build` also emits a single-file
   plain-Node agent artifact, `npm test` runs the agent suite (vitest in `tests/`), `npm run
   typecheck` covers `src/agent/` — with `.orky/profiles/node-app.json` itself byte-unchanged
   (locked decision 10).

The running Electron app's behavior stays byte-identical: nothing under `src/main/`, `src/preload/`,
or `src/renderer/` imports the agent or the protocol (F15's TEST-746 scope guard SURVIVES this
feature unchanged, exactly as its header prescribes).

## Baseline note (brownfield fit)

No baseline `REQ-` in `.orky/baseline/inferred-spec.md` is superseded; no characterized behavior
changes; no `SCHEMA_VERSION` change. The agent is a new, third executable tree beside the three
Electron layers, consuming two existing brownfield seams the roadmap names explicitly: the pure
`src/main/status/` detection stack (imported by the agent — sanctioned by the roadmap: "reusing the
existing pure src/main/status/ modules") and the `pty:*` IPC vocabulary from
`src/shared/ipc-contract.ts` (the wire `method`/`channel` strings ARE the `CH` channel values, and
req params reuse the shared `PtySpawnArgs`/`PtyWriteArgs`/`PtyResizeArgs` types — sharing
`src/shared/` types is the point of the epic's architecture). The local Windows shell registry
(`src/main/pty/shells.ts`) is NOT reused — the agent is POSIX-targeted and resolves its own default
shell.

Known-wart disclosure (CONV-054): the reused `CwdParser` applies Windows-oriented heuristics to
OSC 7 `file://` URLs (a POSIX path with a single-letter first segment, e.g. `/u/data`, is
misread as a drive path). This feature's cwd vectors therefore use the heuristic-free OSC `9;9`
form, which round-trips POSIX paths verbatim; the OSC 7 single-letter-segment misread is a
pre-existing behavior of the shared module, out of scope here and left to the epic's later
remote-UX work (F21) if it proves user-visible. It is disclosed here so the acceptance's green
result is not read as covering OSC 7.

---

## REQ-001 — Placement and isolation: a new `src/agent/` tree; the running app is untouched

All agent code MUST live under `src/agent/` (plus the shared vocabulary file of REQ-014 and the
build/config edits of REQ-011/REQ-012/REQ-013). No file under `src/main/`, `src/preload/`, or
`src/renderer/` may import (statically or dynamically) from `src/agent/` or from `shared/remote`,
and no file under `src/agent/` may import `electron` or any `src/renderer/`/`src/preload/` module.
`src/agent/` MAY import `@shared/*` modules and the pure `src/main/status/` modules (REQ-008); it
MUST NOT import any other `src/main/` subtree (the Windows-oriented pty/proc/cloud/etc. stacks are
not agent code). F15's frozen suite — TEST-745 (protocol purity), TEST-746 (zero production
consumers), TEST-747 (exact barrel surface) — MUST remain green with this feature applied, without
edits to those test files.

**Acceptance:** a structural test walks `src/agent/**/*.ts` asserting no `electron`, no
`src/renderer`/`src/preload` import specifiers, and no `../main/` specifier other than
`main/status/`; walks `src/main`, `src/preload`, `src/renderer` asserting no import specifier
containing `src/agent` or `agent/` resolving into the agent tree (regex keyed on the
feature-specific tree name per CONV-037); and `npm test` green includes the unmodified F15 frozen
suite plus every `tests/characterization-*.test.ts`.

## REQ-002 — Protocol reuse, never re-derivation

The agent MUST consume F15's protocol exclusively through the sanctioned barrel
`@shared/remote/protocol` — every import specifier under `src/agent/` that contains
`shared/remote` MUST end with `/protocol`. The agent MUST NOT contain an independent
implementation of framing (no length-prefix arithmetic outside the barrel's
encoder/decoder), message validation, or handshake sequencing; `src/shared/remote/` receives ZERO
new or modified files from this feature.

**Acceptance:** a structural test asserts (a) every `shared/remote` import specifier in
`src/agent/**` ends with `/protocol`, (b) at least one such import exists (the agent genuinely
consumes F15), and (c) no `src/agent/` source matches a byte-level framing signature
(`setUint32|getUint32|writeUInt32BE|readUInt32BE`) — the 4-byte prefix lives only in F15's
decoder/encoder; F15's own frozen suite green per REQ-001.

## REQ-003 — Stdio transport: stdout carries frames ONLY; diagnostics go to stderr

The agent process reads protocol bytes from stdin and writes protocol bytes to stdout. EVERY byte
the agent writes to stdout MUST be part of a valid encoded frame (F15 framing); all logging,
diagnostics, and error narration MUST go to stderr. The agent MUST NOT echo, print banners, or
allow any library output on stdout.

**Acceptance:** the stdio integration test (REQ-016) captures the child's ENTIRE stdout byte
stream, feeds it to a fresh F15 `createFrameDecoder`, and asserts every decoded item across the
whole session is `kind: 'message'` (zero `message-error`, zero `fatal`, zero trailing undecoded
bytes); handshake-failure vectors (REQ-005) assert their diagnostic text appears on stderr, never
stdout.

## REQ-004 — Agent-first handshake with the pinned identity

On start the agent MUST send, before any other frame, the hello produced by F15's
`createAgentHandshake({ version, capabilities })` where `version` is EXACTLY this repo's
`package.json` `version` string (carried into the artifact at build time — the artifact is the
unit of version-locking, locked decision 2) and `capabilities` is EXACTLY F15's
`AGENT_V1_CAPABILITIES` constant (imported, never a hand-typed list — locked decision 6). The
agent then waits; the session is established only when the first inbound frame validates as the
matching client hello per F15 REQ-008/REQ-009 (exact string-identity version check).

**Acceptance:** integration: the first frame decoded from the child's stdout is
`{ type: 'hello', proto: WIRE_PROTO, role: 'agent', version: <package.json version read by the
test>, capabilities: ['pty', 'status'] }`; unit: the agent core built with an injected version
emits exactly that hello first; a structural test asserts `src/agent/**` references
`AGENT_V1_CAPABILITIES` and contains no hand-typed `['pty', 'status']` literal.

## REQ-005 — Handshake failure: emit nothing further, diagnose on stderr, exit 1

If the first inbound frame is not the expected client hello — F15 failure reasons
`unexpected-frame`, `bad-hello`, `proto-mismatch`, or `version-mismatch` — the agent MUST send NO
further frames (per F15: on failure neither side emits a frame; the agent's own already-sent hello
is the only stdout output), write a diagnostic to stderr carrying the F15 failure `reason` and
message (CONV-001 — for `version-mismatch` both version strings appear), and exit with code 1.

**Acceptance:** child-process vectors: (a) a client hello with a mismatched version → stdout
decodes to exactly one frame (the agent hello), stderr contains `version-mismatch` and both
version strings, exit code 1; (b) a `req` frame sent before any hello → single-frame stdout,
stderr contains `unexpected-frame`, exit code 1.

## REQ-006 — Post-handshake dispatch: every valid req gets exactly one res, same id

After establishment, every inbound `req` frame that parses (F15-valid) MUST produce EXACTLY ONE
`res` frame with the SAME `id` — `ok: true` with the method's result, or `ok: false` with a
structured error — and the agent MUST NOT emit a `res` for any id it did not receive. A req whose
`method` is not one of the four implemented pty methods (REQ-007) — including methods of
unadvertised domains (`fs:read`, …) and the local-only `pty:transit-begin` — MUST yield
`ok: false` with `error.code = 'unknown-method'` and a message naming the received method
(CONV-001). Method dispatch MUST NOT throw across the transport: an unexpected handler failure
yields `ok: false` with `error.code = 'internal'` and a bounded message, and the session
continues.

**Acceptance:** vectors: a valid `pty:spawn` req id N yields exactly one res id N; `fs:read` and
`pty:transit-begin` reqs yield `ok: false`, code `unknown-method`, message containing the method
string; across a full scripted session the multiset of res ids on stdout equals the set of req
ids sent (no duplicates, no unsolicited ids — settled through F15's `createRequestTracker`, which
reports `duplicate`/`unknown-id` as failures); a backend stub whose `write` throws yields
`ok: false` code `internal` and a subsequent req still answers.

## REQ-007 — The pty method surface mirrors the shared contract

The four methods, their wire `method` strings being the `CH` channel values from
`@shared/ipc-contract` and their params the SHARED types:

- **`pty:spawn`** — params: the `PtySpawnArgs` shape `{ id, shellId, cwd, cols, rows }`.
  Result: `boolean` — `false` for a fresh spawn, `true` when `id` is already live (adopt: the
  existing pty is kept, no second spawn — mirroring the local idempotent-adopt semantic). After a
  pane exits, its id is spawnable again (fresh). An unknown `shellId` resolves to the agent's
  default shell (mirroring the local `shells.find(...) ?? shells[0]` fallback); v1 the agent's
  shell registry is the single POSIX default (`$SHELL`, else `/bin/sh`) for the real backend and
  the scripted shell for the fake backend. Empty `cwd` resolves to the agent process's home
  directory (`$HOME`, else the agent's cwd), mirroring the local empty-cwd fallback; the resolved
  cwd is what the pane observably runs in. A backend spawn failure yields `ok: false` with
  `error.code = 'spawn-failed'` and a message naming the cause; no pane is registered.
- **`pty:write`** — params: `PtyWriteArgs` `{ id, data }`; writes `data` to the pane's pty;
  result `null`.
- **`pty:resize`** — params: `PtyResizeArgs` `{ id, cols, rows }`; resizes the pane; result
  `null`. There is NO silent clamping (CONV-003): out-of-range dimensions are rejected by REQ-009
  validation, so the backend only ever receives the validated values.
- **`pty:kill`** — params: the pane id as a BARE string (mirroring `TermhallaApi.ptyKill(id:
  string)`); tears the pane down; result `null`. The pane's `pty:exit` event still fires
  (REQ-010).

`pty:write`, `pty:resize`, and `pty:kill` addressed to a pane id that is not live MUST yield
`ok: false` with `error.code = 'unknown-pane'` and a message naming the id. (Deliberate, disclosed
divergence from the local contract, where these are fire-and-forget voids that silently no-op on a
dead pane: a remote client cannot observe agent state any other way, and silence would hide
desynchronization. `pty:spawn` keeps the local adopt semantic instead of an error because the
local contract already defines the boolean for exactly that case.)

**Acceptance:** vectors (fake backend, in-process and via the integration round-trip): fresh
spawn → result `false`; second spawn same id → result `true` and the backend records exactly one
spawn; write of `echo hi\n` → a `pty:data` event containing `hi` (the write observably reached
the pty); resize then write `size\n` → a `pty:data` event reporting the new `cols`x`rows`; kill →
result `null` then a `pty:exit` event; write/resize/kill on `'nope'` → `unknown-pane` naming
`nope`; spawn with a backend stub that throws → `spawn-failed`; spawn after exit of the same id →
fresh (`false`).

## REQ-008 — Status detection at the source, through the EXISTING engine

The agent MUST feed every pane's output through the existing `src/main/status/` stack by
importing it (the `StatusEngine` composition or its constituent pure modules — imported from
`src/main/status/`, never copied/forked into `src/agent/`), registering the pane before its first
byte and unregistering on exit (mirroring the local register-before-spawn discipline). From that
engine the agent MUST push:

- **`pty:status`** — evt args `[id, TerminalStatus]` (the `@shared/types` shape) on each status
  CHANGE (deduplicated exactly as the engine's local consumer behaves — no per-chunk spam);
  OSC 133 markers in pane output drive `busy`/`idle`/`lastExit` exactly as locally.
- **`pty:cwd`** — evt args `[id, cwd]` on each cwd CHANGE the engine's `CwdParser` reports;
  OSC `9;9;<path>` round-trips a POSIX path verbatim (see the CONV-054 disclosure above for
  OSC 7).

The v1 status domain is exactly these two pushes: `pty:procs` (the process-tree push riding the
local status family) is OUT of scope — the local `ProcessTracker` is a Windows CIM/WMI stack; a
POSIX proc-tree is deferred with the domain ports epic.

**Acceptance:** a scripted fake-backend session: spawn (the fake shell emits the OSC 133 prompt
marker) then `echo`-style command markers produce `pty:status` transitions to `busy` on
command-start markers and back to `idle` on prompt markers, and a `D;<code>` marker surfaces
`lastExit` (`success` for 0, `failure` for non-zero); a `cwd /home/kevin/dev\n` command (fake
emits OSC `9;9`) produces `pty:cwd` args `[id, '/home/kevin/dev']` verbatim; consecutive
identical states produce no duplicate `pty:status` events; a structural test asserts
`src/agent/**` imports from `main/status/` and contains no copy of the marker/cwd parsing (no
`133;` OSC-scanning literal outside the imported modules, fake-backend EMISSION of markers
excepted — the structural regex is anchored to parsing, i.e. no `scanOsc`/`Osc133Parser`
re-implementation in `src/agent/` outside imports).

## REQ-009 — Strict method-param validation with actionable, coded errors

Params of the four methods are validated STRICTLY before touching any backend (version-locked
peers per locked decision 2 — a malformed param set is corruption or a foreign writer, exactly
F15's stance): wrong JSON type for the params value itself, a missing required key, an unknown
extra key, an empty `id`/`data`-type violation, or a non-positive/non-integer `cols`/`rows` MUST
yield `ok: false` with `error.code = 'bad-params'` and a message naming the offending
key/value and the expectation (CONV-001, CONV-002). `PtySpawnArgs`' optional local-only fields
`launch` and `envId` are KNOWN keys but unsupported in v1 remote: a spawn carrying either MUST be
rejected `bad-params` with a message naming the field and saying it is unsupported for remote
panes in v1 (never silently ignored — CONV-013's honesty principle). Validation failures MUST NOT
partially execute (no pane registered, nothing written).

**Acceptance:** a table-driven vector suite per method: `pty:spawn` with `params: null`, missing
`id`, empty `id`, `cols: 0`, `rows: 1.5`, unknown key `foo`, present `launch`, present `envId` —
each `bad-params` naming the offender; `pty:write` missing `data`; `pty:resize` `cols: -1`;
`pty:kill` with a non-string / empty-string param; after each rejection the pane set is unchanged
(a following `pty:spawn` of the same id is FRESH, and the backend spy records zero calls from the
rejected attempts).

## REQ-010 — Push events mirror the local pty pushes, ordered

- **`pty:data`** — evt args `[id, data]` (string), emitted for every backend data chunk of a live
  pane, in backend emission order per pane (no reordering, coalescing latitude only at frame
  granularity: chunk boundaries may differ but the concatenated per-pane byte sequence on the wire
  MUST equal the backend's emission sequence).
- **`pty:exit`** — evt args `[id, exitCode]` (number), emitted EXACTLY ONCE per pane lifetime,
  after that pane's final `pty:data`, for both self-exit (e.g. the fake `exit 7` command) and
  `pty:kill`. After it, the id is not live (REQ-007 unknown-pane semantics apply until respawn).

**Acceptance:** vectors: `exit 7\n` written to a spawned fake pane yields `pty:exit` args
`[id, 7]` and it is the LAST event for that pane; the concatenation of `pty:data` payloads for a
scripted multi-command session equals the fake backend's scripted output byte-for-byte; exactly
one `pty:exit` per pane across the whole session (kill-path vector included).

## REQ-011 — Injectable pty backend; the real one is node-pty, lazily loaded, POSIX-shaped

The agent core MUST depend only on a backend interface (spawn → handle with
write/resize/kill/onData/onExit); selection happens at process start via the CLI flag
`--pty=node-pty|fake`, default `node-pty`. The `node-pty` backend MUST load the `node-pty` module
LAZILY (only when that backend is selected — running `--pty=fake` MUST never load it, since dev
checkouts carry an Electron-ABI binary a plain-Node agent cannot load, and v1 real-pty support is
Linux-only per locked decision 9); it spawns the resolved shell (REQ-007) with
`name: 'xterm-256color'` at the validated cols/rows/cwd, POSIX-portably (no Windows branches —
macOS stays nearly free later; Windows-remote is a non-goal). An unknown `--pty` value or unknown
flag is a usage error: usage text on stderr, exit code 2, nothing on stdout.

**Acceptance:** the integration test runs the BUILT artifact with `--pty=fake` under plain `node`
on the CI/dev host (where the Electron-ABI node-pty is unloadable — the run succeeding IS the
lazy-load proof), and a structural test asserts the only `node-pty` import in `src/agent/**` is a
dynamic `import(`/lazy `require(` inside the node-pty backend module (never a top-level static
import reachable from the entry); a child vector with `--pty=bogus` exits 2 with usage on stderr
and zero stdout bytes. (The real backend's spawn path is exercised on a real Linux host outside
CI — v1 ships it code-complete behind the same interface; this is the disclosed, deliberate CI
boundary of locked decisions 1 + 9.)

## REQ-012 — The deterministic fake backend (the CI substance)

The fake backend is a scripted in-process pseudo-shell, deterministic given its input sequence
(no time, no RNG), shipping inside the agent (explicit opt-in via `--pty=fake`; shipping it is
deliberate so CI exercises the EXACT artifact `npm run build` produces, not a test-only variant).
Contract (each command is a `\n`-terminated line written via `pty:write`; no tty echo —
documented):

- on spawn: emits the OSC 133 prompt marker (`A`) and a prompt line — the pane starts idle;
- `echo <text>` → marker `C`, `<text>\r\n`, marker `D;0`, marker `A`;
- `cwd <path>` → marker `C`, OSC `9;9;<path>`, marker `D;0`, marker `A`;
- `pwd` → marker `C`, the pane's resolved spawn cwd + `\r\n`, `D;0`, `A` (makes REQ-007's cwd
  resolution observable);
- `size` → marker `C`, `size=<cols>x<rows>\r\n` (current, post-resize), `D;0`, `A`;
- `exit <code>` → marker `C`, `D;<code>`, then the handle exits with that code;
- unknown line → marker `C`, `fake: unknown command "<line>"\r\n`, `D;127`, `A`;
- `kill()` → the handle exits with code 0.

**Acceptance:** the REQ-007/REQ-008/REQ-010 vectors run on this contract; determinism: the same
scripted session executed twice in-process yields an identical ordered frame/event sequence (id
allocation aside — same res/evt payload sequence); the fake module imports nothing impure beyond
what determinism allows (structural: no `Date.now`, no `Math.random`, no timers in the fake
backend module).

## REQ-013 — Lifecycle: clean shutdown, per-frame recovery, fatal taxonomy honored

- **stdin end/close** (the ssh channel or the local parent went away) → the agent kills every
  live pane, disposes the status engine (CONV-011: the pane map and engine sessions are fully
  pruned), and exits 0 promptly — a live pane MUST NOT keep the process alive.
- **Per-frame inbound errors** post-handshake (F15 `message-error` items: `bad-json` /
  `bad-message`) → a stderr diagnostic carrying the F15 reason; the session CONTINUES (the
  framing is intact by F15's taxonomy) — a following valid req still answers.
- **Fatal framing** (F15 `fatal` item — oversized declared length; the decoder is dead) → stderr
  diagnostic, kill panes, exit 1. Likewise any internal failure to encode/write an outbound frame
  is fatal (exit 1, stderr) — never silently dropped output (CONV-003/CONV-034 honesty).
- **Post-handshake wrong-direction or out-of-role frames** — a second `hello`, an inbound `res`
  (the v1 agent never sends reqs) or inbound `evt` (evt is agent→client) → stderr diagnostic
  naming the frame type, frame ignored, session continues. Inbound `ack`/`window` frames are
  RESERVED (F17): the agent MUST accept and ignore them with NO state change, NO error, and NO
  diagnostic requirement — this inertness pin is a scope guard that **F17
  (0018-windowed-flow-control) MUST retire/supersede through its own tests phase** when it gives
  these frames semantics (CONV-019: the retiring feature is named here and in the test header).

**Acceptance:** child vectors: stdin closed while a pane is live → exit 0 within the test's
bound; a raw garbage-JSON frame injected mid-session → stderr notes it, a subsequent `pty:spawn`
answers; a 4-byte prefix declaring over the 8 MiB default → exit 1; in-process vectors: `ack`,
`window`, `hello`, `res`, `evt` frames post-handshake → no res emitted, no state change (pane set
unchanged), next req answers; the ack/window test header names F17's retirement path.

## REQ-014 — Shared agent vocabulary: `src/shared/remote-agent-api.ts`

A NEW pure shared module `src/shared/remote-agent-api.ts` (a sibling of — never inside — F15's
frozen `src/shared/remote/`) MUST export the closed agent error-code union
`AGENT_ERROR_CODES = ['bad-params', 'internal', 'spawn-failed', 'unknown-method', 'unknown-pane']
as const` (sorted, duplicate-free), its `AgentErrorCode` type, and
`AGENT_PTY_METHODS = [CH.ptySpawn, CH.ptyWrite, CH.ptyResize, CH.ptyKill]` derived from the
`CH` constants (never hand-typed strings). The agent imports these (every `error.code` it emits
is a member); F21's client will branch on the same constants. The module MUST be
environment-pure (F15 REQ-001's standard: no `node:`/`electron` imports, no
`Buffer`/`process`/`__dirname`).

**Acceptance:** a test pins the two constants' exact values (the methods deep-equal
`['pty:spawn', 'pty:write', 'pty:resize', 'pty:kill']` and reference equality to `CH` values is
asserted at the source level: the module's source contains `CH.ptySpawn` etc. and no
`'pty:spawn'` string literal), asserts sortedness/uniqueness of the codes, and applies the F15
purity regex set to the file; vectors in REQ-006/REQ-007/REQ-009 assert wire `error.code` values
are members of `AGENT_ERROR_CODES`.

## REQ-015 — Build folding: `npm run build` emits the agent artifact; the profile is untouched

`package.json`'s `build` script MUST chain the agent bundle build after the existing
`electron-vite build` (via a dedicated `vite build --config vite.agent.config.ts` step or
equivalent single chained command), producing a SINGLE-FILE plain-Node artifact at
`out/agent/termhalla-agent.cjs` with: entry `src/agent/main.ts`, the `@shared` alias resolved,
the repo `package.json` version embedded (REQ-004), Node builtins and `node-pty` EXTERNAL
(everything else bundled — the artifact runs with zero `node_modules` when `--pty=fake`).
`.orky/profiles/node-app.json` MUST be byte-identical to its pre-feature content (locked
decision 10: the fold happens inside the npm scripts the profile already runs).

**Acceptance:** structural pins (CONV-022-scoped: substring/member assertions, never whole-file
pins on these shared surfaces): `package.json` `scripts.build` contains BOTH `electron-vite
build` and `vite.agent.config`; `vite.agent.config.ts` exists, names entry `src/agent/main.ts`,
output `out/agent/termhalla-agent.cjs`, and externalizes `node-pty`; the profile JSON
deep-equals the merged baseline copy (commands + gates + testRoots unchanged). The artifact's
RUNNABILITY is proven by REQ-016 building through the SAME config file.

## REQ-016 — Test folding: self-sufficient vitest suite; the integration test runs the real artifact through the real protocol

All agent tests are vitest suites under `tests/` (the profile's `testRoots` — automatically part
of `npm test`). The stdio integration test MUST be SELF-SUFFICIENT: it bundles the agent
ON DEMAND through the SAME `vite.agent.config.ts` (programmatic `vite` build with only the
output directory overridden to a temp dir) — never depending on a prior `npm run build` or on
`out/` existing (CI runs `npm test` without a build) — then spawns the bundle with plain Node
(`process.execPath`) and `--pty=fake`, and drives it as a real client using F15's CLIENT-side
machinery: `createClientHandshake`, `createRequestTracker`, `createFrameDecoder`, `encodeFrame`
over the child's stdio. The round-trip MUST cover: handshake, `pty:spawn` (fresh + adopt),
`pty:write`→`pty:data`, `pty:resize` (observed via `size`), `pty:status` + `pty:cwd` events,
`pty:kill`/`exit <code>`→`pty:exit`, an `unknown-method` req, and clean shutdown (REQ-013) — the
identical protocol path production will run over ssh (locked decision 1), with no ssh anywhere.

**Acceptance:** the integration test exists under `tests/`, imports `@shared/remote/protocol`
(client side) and `vite` (programmatic build), spawns via `process.execPath`, asserts the
full-coverage list above, and passes on a checkout where `out/` is absent; `npm test` (bare, no
prior build) is green — that green IS the fold (no gate-profile edit involved).

## REQ-017 — Typecheck folding and documentation

(a) `npm run typecheck` MUST cover `src/agent/` — `tsconfig.node.json`'s `include` array gains
`"src/agent"` (CONV-022: the pin asserts membership, not the whole array). CI runs typecheck; a
type error in the agent tree fails it.

(b) `docs/features/remote-agent.md` MUST exist and document: the agent's location/entry and the
artifact path; the stdio contract (stdout = frames only, stderr = diagnostics); the handshake
(agent speaks first; version = package.json version; exact version check — "a version check, NOT
a compatibility matrix"; capabilities = `pty + status`); the four methods + four push events and
the error-code vocabulary; backend injection (`--pty=node-pty|fake`, node-pty lazy-loaded,
Linux-only v1 for the real backend, why CI drives the fake — the ABI + platform rationale); the
lifecycle/exit codes (0 clean / 1 protocol-fatal / 2 usage); and the F17 (ack/window inertness)
retirement note. (The `CLAUDE.md` "Where things live" row is doc-sync's edit and deliberately NOT
test-pinned — shared file, CONV-012/CONV-022.)

**Acceptance:** a structural pin asserts `"src/agent"` is a member of `tsconfig.node.json`'s
`include`; a docs test asserts `docs/features/remote-agent.md` exists and contains the
load-bearing literals: `termhalla-agent.cjs`, `--pty=fake`, `version check`, `pty:spawn`,
`unknown-pane`, `exit code`, and `F17` — existence + key claims only, doc-sync latitude retained.

---

## Public interface

The agent's public surface is a PROCESS contract, not a library barrel:

- **Executable:** `out/agent/termhalla-agent.cjs` (from `npm run build`), run as
  `node termhalla-agent.cjs [--pty=node-pty|fake]` (default `node-pty`).
- **Wire:** F15's protocol over stdio. Agent hello first (`version` = repo `package.json`
  version, `capabilities` = `['pty', 'status']`); then req/res + evt.
- **Methods:** `pty:spawn(PtySpawnArgs) → boolean` (adopted), `pty:write(PtyWriteArgs) → null`,
  `pty:resize(PtyResizeArgs) → null`, `pty:kill(id: string) → null` — method strings are the
  `CH` values; error codes from `AGENT_ERROR_CODES`.
- **Events:** `pty:data [id, data]`, `pty:exit [id, code]`, `pty:status [id, TerminalStatus]`,
  `pty:cwd [id, cwd]` — channel strings are the `CH` values.
- **Exit codes:** `0` clean (stdin end), `1` protocol-fatal (handshake failure / fatal framing /
  outbound write failure), `2` CLI usage.
- **Shared vocabulary:** `src/shared/remote-agent-api.ts` — `AGENT_ERROR_CODES`,
  `AgentErrorCode`, `AGENT_PTY_METHODS`.

Internal module layout under `src/agent/` (core session, backends, entry) is the plan's concern;
nothing outside the tree may depend on it (REQ-001).

## Non-goals (explicit)

- **No flow-control semantics** — inbound `ack`/`window` are inert (REQ-013); F17 retires that
  pin through its own tests phase.
- **No replay, no `@xterm/headless`, no scrollback buffer, no session survival features** — F18.
- **No ssh, no tunnel, no provisioning/upload, no remote bootstrap** — F19. No real ssh (and no
  real node-pty) anywhere in CI.
- **No attach lease / exclusivity** — F20.
- **No client routing, no renderer/main/preload wiring, no UI** — F21; TEST-746 survives
  unchanged.
- **No domain beyond pty + status; no `pty:procs`** (Windows CIM stack; POSIX proc-tree deferred
  with the domain-ports epic).
- **No macOS/Windows-remote REQs or tests** (locked decision 9) — POSIX-portable design only.
- **No `SCHEMA_VERSION` change, no `.orky/` interaction, no gate-profile edit.**
- **No tty echo in the fake backend** (documented in REQ-012) and no PTY emulation fidelity
  beyond the scripted contract.
- **No agent-side timeouts/keepalives** — the client owns liveness policy (F19/F21).

## Open questions

None. The locked roadmap decisions fix every contested point. Two spec-level derivations are
documented rather than re-opened: (1) the `unknown-pane` error for the locally-void
write/resize/kill methods (REQ-007 — the remote client needs the signal; the divergence is
disclosed), and (2) the roadmap's open question 3 (agent packaging: single-file vs node_modules
payload) is NOT resolved here beyond what F16 needs — a single-file artifact with `node-pty`
external is the minimal buildable form; F19 owns the upload/bootstrap packaging decision and may
layer on it.
