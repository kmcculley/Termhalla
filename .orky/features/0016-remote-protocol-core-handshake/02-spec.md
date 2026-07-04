# Spec — 0016-remote-protocol-core-handshake

**Phase:** 2 (spec). **Inputs:** `00-intake.md` (roadmap entry F15 verbatim + locked decisions,
human-confirmed 2026-07-04), `.orky/conventions.md`, `.orky/baseline/` (adopted brownfield repo).
No `01-concept.md` — app-run mode: the concept was fixed at roadmap time.

## Concerns

`["networking", "determinism"]`

(`networking` — this IS a wire protocol: framing over a byte stream, partial/coalesced delivery,
request/response correlation, backpressure frame types. `determinism` — the decoder must be a pure
function of the byte stream regardless of chunk boundaries; correlation ids are monotonic, no
time/RNG anywhere; the same frame always encodes to the same bytes. Always-on lenses per config:
security, quality, devils-advocate. `data-provenance` is NOT tagged: the only "reference data" is
the capability id list, which is derived from — and mechanically pinned against — this repo's own
source tree, not an external source.)

## Scope summary

A pure protocol layer under `src/shared/remote/` — zero Node/Electron imports, consumed in v1 by
vitest only, zero behavior change to the running app. It defines, and this feature ONLY defines:

1. **Framing** over an arbitrary byte stream: 4-byte big-endian length prefix + UTF-8 JSON payload,
   with an incremental, chunking-invariant decoder and an enforced maximum frame size.
2. **The v1 wire-message vocabulary** (closed set): `hello`, `req`, `res`, `evt`, `ack`, `window` —
   with strict validation and actionable structured errors.
3. **Request/response correlation**: monotonic id allocation, response matching,
   duplicate/unknown-id detection, drain-on-close.
4. **The connect handshake**: agent speaks first; EXACT-version check (string identity — locked:
   version-locked client/agent, NOT a compatibility matrix); capability advertisement.
5. **The capability vocabulary**: the per-domain IPC registrar names as a closed union, plus the
   `status` domain (see the reconciliation note in REQ-010), and the v1 agent advertisement
   constant `['pty', 'status']`.
6. **Flow-control frame TYPES** (`ack`, `window`) — shape only; semantics land in F17.

Stdio is the only assumed transport: the layer consumes/produces `Uint8Array` chunks and JSON
values; it never spawns, connects, reads, writes, or schedules. The identical protocol path will run
over system ssh in production (F19) and over a plain local child process in CI/e2e (F16).

## Baseline note (brownfield fit)

No baseline `REQ-` in `.orky/baseline/inferred-spec.md` is superseded; no characterized behavior
changes. The feature adds a new pure module family beside the existing pure `src/shared/` modules
(`orky-status.ts`, `terminal-links.ts`, …), mirroring their vitest-only unit-test style. The wire
vocabulary derives from `src/shared/ipc-contract.ts`: request `method` / event `channel` strings are
the `CH` channel values by convention (enforced by F16's dispatcher, not by this layer — see
Non-goals), and the capability partition derives from the `src/main/ipc/register-*.ts` registrar
set. Nothing under `src/main/`, `src/preload/`, or `src/renderer/` may import this feature's code
(REQ-002) — the running app is byte-identical.

---

## REQ-001 — Pure placement: `src/shared/remote/`, zero environment imports

All code this feature produces MUST live under `src/shared/remote/`, and every module there MUST be
environment-pure: no `import`/`require` of `node:*` modules, `electron`, or any npm package; no
references to `Buffer`, `process`, `require`, `__dirname`, or `window`. Binary data is `Uint8Array`;
text encoding uses the `TextEncoder`/`TextDecoder` globals (present in both Node ≥ 18 and the
renderer — they are web globals, not Node imports). Modules MUST load and run under vitest's plain
`node` environment without Electron.

**Acceptance:** a structural purity test enumerates `src/shared/remote/*.ts` sources and asserts no
match for `from 'node:`, `from "electron`, `require(`, or the bare identifiers
`Buffer`/`process.`/`__dirname` (identifier-anchored regexes, scoped to this new directory per
CONV-037); the unit suite imports every public symbol via the `@shared/remote/protocol` entry and
exercises it under the `node` environment (the import itself failing would fail the suite).

## REQ-002 — Zero behavior change: no production consumer in this feature

No file under `src/main/`, `src/preload/`, or `src/renderer/` may import from `shared/remote` (any
specifier containing `shared/remote`). The existing suite — including every
`tests/characterization-*.test.ts` — MUST remain green with the feature applied.

Scope-guard provenance (CONV-019): the guard test MUST name its retirement path in its header —
**F16 (0017-agent-runtime-skeleton)** adds the agent-side consumer OUTSIDE the guarded trees (the
guard survives), and **F21 (0022-client-routing-remote-workspace-ux)** is the feature expected to
RETIRE/supersede the guard when client routing legitimately imports the protocol into `src/main`'s
transport layer; F21 must do so through its own tests phase. The guard's regex is keyed to the
feature-specific path segment `shared/remote` (CONV-037), never to a shared module name.

**Acceptance:** the scope-guard test scans `src/main/**/*.ts`, `src/preload/**/*.ts`,
`src/renderer/**/*.{ts,tsx}` for `shared/remote` in import specifiers and asserts zero matches,
with the CONV-019 retirement note in the test header; `npm test` green is the gate's ground truth
for the characterization suites.

## REQ-003 — Frame encoding: 4-byte big-endian length prefix + UTF-8 JSON

`encodeFrame(frame)` MUST produce exactly: a 4-byte **big-endian unsigned 32-bit** payload byte
length, followed by the payload — the UTF-8 encoding of `JSON.stringify(frame)`. The length counts
**payload bytes only** (never the 4 header bytes), and counts UTF-8 **bytes**, not UTF-16 code
units. `encodeFrame` MUST validate its input via the same validator as REQ-007 and throw a
structured error (reason `bad-message`, REQ-015) on a malformed frame — never emit unparseable
bytes.

**Acceptance:** a golden byte vector: `encodeFrame({ type: 'ack', id: 'p1', bytes: 1 })` yields a
`Uint8Array` whose first 4 bytes are the big-endian length of the JSON payload and whose remaining
bytes decode (TextDecoder) to a JSON string deep-equal-parsing to the input; a non-ASCII vector
(e.g. an `evt` arg containing `'π€'`) asserts the prefix equals the UTF-8 **byte** length and
differs from `.length` of the JSON string; `encodeFrame({ type: 'nope' } as never)` throws with
reason `bad-message`.

## REQ-004 — Enforced maximum frame size, both directions, never silent (CONV-003)

`DEFAULT_MAX_FRAME_BYTES` MUST be exported and equal `8 * 1024 * 1024` (8 MiB). Both the encoder
and the decoder accept an optional `maxFrameBytes` override. Encoding a frame whose payload exceeds
the limit MUST throw a structured error (reason `frame-too-large`) naming the actual byte length
AND the limit. A decoder that reads a length prefix exceeding the limit MUST surface a **fatal**
framing error (same reason, both numbers, REQ-006) — the declared length is never trusted enough to
buffer. There is NO silent truncation, capping, or clamping anywhere in the layer.

**Acceptance:** encode-side: a frame with a > 8 MiB string payload throws `frame-too-large` with
both numbers in the structured detail and the message; decode-side: pushing a hand-built 4-byte
prefix declaring `DEFAULT_MAX_FRAME_BYTES + 1` yields a `fatal` item with both numbers; a custom
`maxFrameBytes: 64` decoder rejects a 65-byte-payload frame that the default decoder accepts.

## REQ-005 — Incremental decoding is chunking-invariant (determinism)

`createFrameDecoder()` returns a decoder whose `push(chunk: Uint8Array): DecodedItem[]` yields —
concatenated across calls — an item sequence that is a pure function of the concatenated byte
stream, IDENTICAL for **every** partition of that stream: split points inside the 4-byte length
prefix, inside a payload, inside a multi-byte UTF-8 sequence, byte-at-a-time, multiple frames
coalesced into one chunk, and the whole stream in one push. An empty chunk yields `[]` and no
error. Decoding MUST NOT depend on time, randomness, or map iteration order.

**Acceptance:** one canonical stream of ≥ 3 frames (at least one containing multi-byte UTF-8) is
fed to fresh decoders under ≥ 4 partitions — byte-at-a-time, split mid-prefix, split mid-multibyte-
sequence, all-at-once — and the concatenated item sequences are deep-equal across all partitions
and equal to the expected frame list; `push(new Uint8Array(0))` returns `[]`.

## REQ-006 — Error taxonomy: fatal framing errors vs per-frame message errors

The decoder MUST distinguish two error classes, observable in its output items:

- **Fatal** (stream position unrecoverable): a declared frame length exceeding the limit
  (REQ-004). The decoder yields one `{ kind: 'fatal', error }` item; any later `push` MUST throw a
  structured error with reason `decoder-dead` (it must be impossible to silently resume a corrupt
  stream).
- **Per-frame** (framing intact, this frame bad): payload bytes that are not valid UTF-8 JSON
  (reason `bad-json`) or JSON that is not a valid v1 wire message (reason `bad-message`,
  REQ-007). The decoder yields `{ kind: 'message-error', error }` **in stream order** and MUST
  continue decoding subsequent frames.

Valid frames are yielded as `{ kind: 'message', frame }` in stream order.

**Acceptance:** a stream of [valid frame, bad-JSON frame, valid frame] yields exactly
`['message', 'message-error', 'message']` in order with both valid frames intact; a stream of
[valid frame, oversized-declared frame] yields `['message', 'fatal']` and a subsequent `push`
throws `decoder-dead`; the `bad-json` error detail carries the frame's payload byte length and a
parse-failure description (REQ-015).

## REQ-007 — Closed v1 wire-message vocabulary with strict validation

`parseWireMessage(value: unknown)` MUST return `{ ok: true, frame }` for exactly the following
shapes and `{ ok: false, error }` (reason `bad-message`, naming the offending field/type,
REQ-015) for everything else. Validation is STRICT (version-locked peers share one build, so
strictness is pure corruption/foreign-writer detection): unknown `type` values are rejected naming
the received type, unknown top-level keys on a known type are rejected naming the key, and every
field is type- and range-checked:

- `hello` — `{ type: 'hello', proto: <positive integer>, role: 'agent' | 'client',
  version: <non-empty string>, capabilities?: CapabilityId[] }`. `capabilities` is REQUIRED for
  `role: 'agent'` and FORBIDDEN for `role: 'client'`. Every entry MUST be a member of
  `CAPABILITY_IDS` (unknown ids rejected naming the id) and entries MUST be unique (duplicates
  rejected naming the duplicate). An empty array is valid shape-wise (the v1 advertisement content
  is REQ-011 / F16's concern). NOTE: `proto` is validated here only as a positive integer; the
  `=== WIRE_PROTO` check is the handshake's (REQ-008), so a foreign proto yields the crisper
  `proto-mismatch` there, not `bad-message` here.
- `req` — `{ type: 'req', id: <positive integer>, method: <non-empty string>, params: <any JSON
  value, null allowed, key REQUIRED> }`.
- `res` — `{ type: 'res', id: <positive integer>, ok: true, result: <any JSON value, key
  REQUIRED> }` or `{ type: 'res', id: <positive integer>, ok: false, error: { message: <non-empty
  string>, code?: <non-empty string> } }`. `result` on an `ok: false` frame or `error` on an
  `ok: true` frame is rejected.
- `evt` — `{ type: 'evt', channel: <non-empty string>, args: <array> }` (empty array allowed).
- `ack` — `{ type: 'ack', id: <non-empty string>, bytes: <positive integer> }` (reserved — F17).
- `window` — `{ type: 'window', size: <positive integer>, id?: <non-empty string> }` (`id` absent
  = connection-wide default; reserved — F17).

Non-object inputs (`null`, arrays, primitives) are rejected naming the received JSON type. `method`
and `channel` are NOT runtime-restricted to `CH` values (see Non-goals).

**Acceptance:** a table-driven accept/reject vector suite covering, per type: the canonical valid
shape(s); missing-field, wrong-type, empty-string, non-positive-integer, and unknown-extra-key
rejections; the `hello` capability rules (client-with-capabilities rejected, agent-without
rejected, unknown id rejected naming it, duplicate rejected naming it); the `res` ok/result/error
cross rules; and non-object inputs.

## REQ-008 — Connect handshake: agent speaks first; two-message establishment

The handshake MUST be expressible as two pure, single-use state machines (no IO, no timers):

- `createAgentHandshake({ version, capabilities })` — exposes `helloFrame()`: the
  `{ type: 'hello', proto: WIRE_PROTO, role: 'agent', version, capabilities }` frame the agent MUST
  send **first** on any new connection, before any other frame. Its `onMessage(frame)` consumes the
  first inbound frame: a valid client `hello` (parse-valid per REQ-007, `role: 'client'`,
  `proto === WIRE_PROTO`, `version` exactly equal per REQ-009) → `{ done: true, ok: true }`
  (established); anything else → `{ done: true, ok: false, failure }` with reason
  `unexpected-frame` (a non-hello frame, naming the received type), `bad-hello` (a hello failing
  parse or with `role: 'agent'`), `proto-mismatch`, or `version-mismatch`.
- `createClientHandshake({ version })` — emits NOTHING initially (the client MUST NOT send any
  frame before receiving the agent's hello). Its `onMessage(frame)` consumes the first inbound
  frame: a valid agent `hello` (parse-valid, `role: 'agent'`, `proto === WIRE_PROTO`, exact version
  match) → `{ done: true, ok: true, capabilities, reply }` where `reply` is the client hello frame
  to send (`{ type: 'hello', proto: WIRE_PROTO, role: 'client', version }`) and `capabilities` is
  the agent's advertised set exposed **sorted ascending** (already unique per REQ-007); anything
  else → `{ done: true, ok: false, failure }` (same reason taxonomy) with NO reply frame.

On any handshake failure neither machine produces a frame to send (v1 has no error/goodbye frame;
the failure object is the local diagnostic — F19 consumes `version-mismatch` vs the rest to decide
provisioning). Both machines are single-use: `onMessage` after `done` MUST throw a structured error
(reason `handshake-done`) — post-establishment frame routing belongs to F16, and a post-handshake
`hello` is that router's protocol error, pinned here only via the machines' single-use contract.

**Acceptance:** a full happy-path vector — agent machine's `helloFrame()` fed to a client machine
yields `ok: true` + sorted capabilities + a reply frame; that reply fed to the agent machine yields
`ok: true` — plus failure vectors each side: `req` before hello (`unexpected-frame`, naming
`req`), a hello with the wrong role (`bad-hello`), `proto: 2` (`proto-mismatch`),
mismatched versions (`version-mismatch`, detail carrying BOTH versions verbatim), and
`onMessage` after `done` throwing `handshake-done`.

## REQ-009 — The version check is EXACT string identity (locked decision 2)

Version comparison MUST be string identity (`===`) on the two `version` fields — no semver parsing,
no ranges, no minimum-version tolerance, no normalization (case, whitespace, or `v` prefixes are
significant). The client provisions the agent, so client and agent are version-locked; the
handshake is a version CHECK, never a compatibility matrix. A mismatch failure MUST carry both
version strings verbatim in its structured detail and its message (CONV-001).

**Acceptance:** identical strings (`'0.11.0'` vs `'0.11.0'`) establish; each near-miss —
`'0.11.0'` vs `'0.11.1'`, `'0.11.0'` vs `'v0.11.0'`, `'0.11.0'` vs `'0.11.0 '`, `'0.11.0'` vs
`'0.11.0-beta'` — fails with reason `version-mismatch` and a detail/message containing both
strings verbatim.

## REQ-010 — Capability vocabulary: the per-domain registrar names, plus `status` (closed union)

`CAPABILITY_IDS` MUST be exported `as const`, sorted ascending, unique, and equal to the 17
per-domain IPC registrar names — derived from the `src/main/ipc/register-*.ts` files (every
`register-<name>.ts` except the `register.ts` composition root, `<name>` verbatim) — **plus**
`'status'`: `['clipboard', 'cloud', 'drafts', 'env', 'fs', 'git', 'notes', 'orky', 'orky-action',
'preview', 'pty', 'recording', 'registry', 'search', 'shell', 'status', 'usage', 'workspaces']`
(18 entries). `CapabilityId` is the union type of exactly these strings, and `isCapabilityId(x)`
is the exported runtime guard.

**Reconciliation note (spec-level derivation, not a re-opened decision):** locked decision 6 states
both "the 17 per-domain registrars ARE the capability partition" and "v1 agent = pty + status
only" — and `status` is not a registrar file name. The status domain (the `pty:status` /
`pty:cwd` / `pty:procs` push family and the `src/main/status/` detection stack) locally rides
`register-pty.ts` rather than owning a registrar file, but the epic names it as its own advertised
domain in F15's summary, F16's title, and locked decision 6. This spec therefore makes `status`
expressible as the 18th id so the locked advertisement `['pty', 'status']` typechecks; every other
id remains exactly a registrar file name.

**Amendment path (CONV-022):** the registrar file set is a shared, legitimately-evolving surface. A
future feature adding `src/main/ipc/register-<new>.ts` MUST extend `CAPABILITY_IDS` (and the
pinning test's expected list) in the same change, through ITS OWN tests phase — the pinning test's
header MUST state this sanctioned amendment path so the derivation check is an enforcement of the
partition staying in sync, never a false-positive trap for an unrelated feature.

**Acceptance:** a test derives the registrar name set from the `src/main/ipc/` directory listing
(`register-*.ts` minus `register.ts`, names verbatim) and asserts `CAPABILITY_IDS` deep-equals
`sorted(derived ∪ {'status'})`; asserts the array is sorted, duplicate-free, and 18 long; asserts
`isCapabilityId` accepts every member and rejects `'STATUS'`, `''`, and `'ptyx'`; and the test
file header carries the CONV-022 amendment-path note verbatim enough to grep
(`CAPABILITY_IDS` + `amendment`).

## REQ-011 — The v1 agent advertisement constant

`AGENT_V1_CAPABILITIES` MUST be exported and deep-equal `['pty', 'status']` (locked decision 6:
tmux parity — the v1 agent implements only the pty + status domains). It exists so F16 advertises a
constant this feature already pinned, not a hand-typed list.

**Acceptance:** `AGENT_V1_CAPABILITIES` deep-equals `['pty', 'status']`; every entry satisfies
`isCapabilityId`; an agent `hello` built with it round-trips REQ-007 validation.

## REQ-012 — Request/response correlation

`createRequestTracker()` MUST return a tracker with:

- `open(method, params)` → `{ id, frame }`: allocates ids starting at **1**, incrementing by 1 per
  call, never reused within a tracker; `frame` is the ready-to-send `req` frame.
- `settle(resFrame)` → exactly one of: `{ kind: 'settled', id, method, response }` (first response
  for a pending id — `response` is the `res` frame), `{ kind: 'unknown-id', id }` (never opened),
  `{ kind: 'duplicate', id }` (already settled), `{ kind: 'closed', id }` (tracker closed). A
  response settles ONLY its own id; out-of-order settlement is supported.
- `failAllPending(reason)` → an array with EXACTLY ONE entry per still-pending request
  (`{ id, method, reason }`, in id order), closing the tracker. Calling it again returns `[]`.
- `open(...)` after close MUST throw a structured error (reason `tracker-closed`, CONV-001).
- `pendingCount` observable at any time.

The tracker holds no timers, no clocks, no randomness (determinism), and never invokes callbacks —
it is a pure state machine the F16 transport wraps.

**Acceptance:** vectors: three opens get ids 1, 2, 3; settling id 2 then 1 (out of order) each
yield `settled` with the right `method`; re-settling id 2 yields `duplicate`; settling id 99
yields `unknown-id`; `failAllPending('closed')` with id 3 pending returns exactly
`[{ id: 3, method, reason: 'closed' }]`, a second call returns `[]`, a late `settle(3)` yields
`closed`, and `open` afterwards throws `tracker-closed`; `pendingCount` tracks 3 → 1 → 0.

## REQ-013 — Flow-control frames are shape-only in this feature (semantics = F17)

The `ack` and `window` frame types MUST validate and round-trip per REQ-007/REQ-016, and this
feature MUST attach NO semantics to them: no exported function consumes or produces them, no state
changes on their receipt, and the public interface contains no flow-control API beyond the shapes.
The shapes are reserved for F17 (`ack`: the client acknowledges `bytes` of pty output for pane
`id`; `window`: the unacked-byte window; cumulative-vs-delta accounting and pause/resume behavior
are F17's to fix). During handshake they are `unexpected-frame` like any non-hello (REQ-008).

**Acceptance:** the REQ-007 vectors cover both shapes' accept/reject cases; the REQ-016 round-trip
covers both; the public-interface enumeration test (REQ-017's doc pin is prose — the executable
check is the barrel's export list) asserts the `@shared/remote/protocol` barrel exports exactly
the enumerated public symbols and nothing flow-control-semantic; an `ack` fed to either handshake
machine pre-establishment yields `unexpected-frame`.

## REQ-014 — Push-event envelope carries the agent→client pushes with full fidelity

The `evt` envelope (`channel` + `args` array) mirrors the main→renderer push signature
(`send(channel, ...args)` — `src/shared/ipc-contract.ts` push channels). Representative real
payloads MUST round-trip encode→decode byte-faithfully: `pty:data` with a string arg containing
multi-byte UTF-8 AND C0 control characters (e.g. `'[31mπ'`), `pty:exit` with
`(id, code)` number args, and a `pty:status`-shaped object arg. JSON-representable values only
(the local contract already sends JSON-serializable args over Electron IPC; anything beyond that
is out of scope until a feature needs it).

**Acceptance:** round-trip vectors for the three payload shapes above, asserting deep equality
including the exact control/multi-byte characters.

## REQ-015 — Every surfaced error is structured AND actionable (CONV-001)

Every error this layer surfaces — thrown `ProtocolError`s, decoder error items, handshake
failures — MUST carry (a) a `reason` from the closed union `'frame-too-large' | 'decoder-dead' |
'bad-json' | 'bad-message' | 'unexpected-frame' | 'bad-hello' | 'proto-mismatch' |
'version-mismatch' | 'handshake-done' | 'tracker-closed'`, (b) machine-readable detail fields
carrying the offending values (lengths and limits; both version strings; the received frame type;
the offending field/key/capability id), and (c) a human message naming what failed, the offending
value, and the expectation. No bare `"invalid input"` / `"error"` strings anywhere.

**Acceptance:** targeted assertions on `reason` + detail fields + message substrings for at
least: `frame-too-large` (actual and limit numbers), `version-mismatch` (both versions),
`bad-message` on an unknown type (the received type string), `bad-message` on an unknown
capability (the id), `unexpected-frame` (the received type), and `tracker-closed`.

## REQ-016 — Round-trip totality over the whole vocabulary

For a canonical fixture list covering ALL six frame types — including: a `hello` for each role
(agent with `AGENT_V1_CAPABILITIES`, client without capabilities), a `req` with `params: null`, a
`res` with `ok: false` + `error.code`, an `evt` with empty `args`, unicode-heavy strings, and a
`window` without `id` — `decode(encodeFrame(f))` MUST yield exactly `[{ kind: 'message',
frame: f }]` (deep equal) for every `f`, and encoding the whole list into one concatenated stream
MUST decode to the same list in order.

**Acceptance:** the table-driven round-trip test over that fixture list, individually and
concatenated.

## REQ-017 — Documentation

`docs/features/remote-protocol.md` MUST exist and document: the frame wire format (4-byte BE
length + UTF-8 JSON, the 8 MiB default cap), the handshake sequence (agent hello first,
two-message establishment, EXACT-version check — explicitly "a version check, NOT a compatibility
matrix"), the capability partition INCLUDING the `status` reconciliation note from REQ-010, the
flow-control frames' reserved status (semantics F17), and the zero-consumer guarantee (REQ-002)
with its F16/F21 retirement path. (The `CLAUDE.md` "Where things live" row is doc-sync's edit and
deliberately NOT test-pinned — shared file, CONV-012/CONV-022.)

**Acceptance:** a docs test asserts the file exists and contains the load-bearing literals:
`hello`, `WIRE_PROTO`, `8 MiB` (or `8388608`), `version check`, `status`, and `F17` — existence +
key claims only, leaving doc-sync latitude to refine prose.

---

## Public interface

One import surface: **`@shared/remote/protocol`** (the barrel; internal file layout is the plan's
concern). Exports, exhaustively:

- Constants: `WIRE_PROTO` (`1`), `FRAME_HEADER_BYTES` (`4`), `DEFAULT_MAX_FRAME_BYTES`
  (`8388608`), `CAPABILITY_IDS`, `AGENT_V1_CAPABILITIES`.
- Types: `CapabilityId`, `WireFrame` = `HelloFrame | ReqFrame | ResFrame | EvtFrame | AckFrame |
  WindowFrame` (each also exported), `DecodedItem`, `ProtocolFailure` (reason + detail + message),
  `HandshakeResult` shapes, `SettleResult`, `FailedRequest`.
- Functions/factories: `encodeFrame(frame, opts?)`, `createFrameDecoder(opts?)`,
  `parseWireMessage(value)`, `isCapabilityId(x)`, `createClientHandshake({ version })`,
  `createAgentHandshake({ version, capabilities })`, `createRequestTracker()`.
- Error class: `ProtocolError` (thrown paths), carrying `reason` + structured detail (REQ-015).

The barrel MUST export exactly this surface (the REQ-013 acceptance pins the export list) so scope
creep is mechanically visible.

## Non-goals (explicit)

- **No transport**: no ssh/child-process spawning, no stream wiring, no reconnect, no timeouts, no
  promise plumbing around the tracker — F16/F19.
- **No flow-control semantics** — frame shapes only; F17 (locked decision 4 fixes the day-one
  requirement; the SHAPES land here so F16's dispatcher needn't churn its vocabulary).
- **No per-method payload validation and no runtime restriction of `method`/`channel` to `CH`
  values** — the agent's dispatcher (F16) owns which methods exist per capability; this layer is
  the envelope.
- **No renderer/main/preload wiring, no UI, no `SCHEMA_VERSION` change, no `.orky/` interaction.**
- **No compatibility matrix, ever** (locked decision 2).
- **No `01-concept.md` retrofit** — app-run mode.

## Open questions

None. The locked roadmap decisions fix every contested point; the single ambiguity found (the
`status` capability naming vs the 17-registrar partition) is resolved and documented in REQ-010 as
a derivation, with the reconciliation recorded rather than re-opened.
