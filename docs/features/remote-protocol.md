# Remote wire protocol core + version/capability handshake

The pure protocol layer under `src/shared/remote/` (feature 0016, Remote Agent v1 epic batch 1):
framing over a byte stream, request/response correlation, agent→client push events, the connect
handshake, the capability vocabulary, and the reserved flow-control frame types. Zero
Node/Electron imports, zero behavior change to the running app — in v1 nothing outside the vitest
suite consumes it (see the zero-consumer guarantee below). Import surface:
`@shared/remote/protocol` (the barrel; its runtime export list is pinned by TEST-747).

Stdio is the only assumed transport: the layer consumes and produces `Uint8Array` chunks and JSON
values, never spawning, connecting, or scheduling — so the identical protocol path runs over
system ssh in production (F19) and over a plain local child process in CI/e2e (F16).

## Wire format (framing)

A frame is a **4-byte big-endian unsigned 32-bit payload byte length** followed by the payload —
the UTF-8 encoding of `JSON.stringify(frame)`. The length counts payload **bytes** only (never
the header, never UTF-16 code units). `encodeFrame` validates the frame before emitting bytes;
`createFrameDecoder` decodes incrementally and is **chunking-invariant**: any partition of the
same byte stream — mid-header, mid-payload, mid-multi-byte-UTF-8, byte-at-a-time — yields the
identical item sequence.

The maximum payload is `DEFAULT_MAX_FRAME_BYTES` = **8 MiB** (8388608 bytes; both encoder and
decoder accept a `maxFrameBytes` override, and nothing is ever silently truncated or capped):

- encode side: an over-limit payload throws `frame-too-large` naming both the actual byte count
  and the limit;
- decode side: a declared length over the limit is a **fatal** framing error — the declared
  length is never trusted enough to buffer; the decoder yields one `fatal` item and any later
  `push` throws `decoder-dead`.

Per-frame errors (payload not valid UTF-8 JSON → `bad-json`; valid JSON but not a valid v1
message → `bad-message`) do NOT kill the stream: they are surfaced as `message-error` items in
stream order and decoding continues — connection policy on them belongs to the session layer
(F16).

## Message vocabulary (closed, strict)

Six frame types: `hello`, `req`, `res`, `evt`, `ack`, `window`. `parseWireMessage` validates
strictly — unknown types, unknown keys, and out-of-range fields are rejected with the offender
named in message and detail. Version-locked peers share one build, so strictness is pure
corruption/foreign-writer detection. Request `method` / event `channel` strings carry the
`src/shared/ipc-contract.ts` `CH` values by convention; the protocol layer does not restrict them
at runtime (the agent's dispatcher, F16, owns which methods exist per capability).

The three **any-JSON positions** — `req.params`, `res(ok:true).result`, and `evt.args` — are
additionally **deep-checked for JSON representability** (review FINDING-009, human-decided
ESC-001): values `JSON.stringify` cannot faithfully emit are rejected with a structured
`bad-message` naming the offending path (e.g. `req.params.a[2].b`) — `undefined` (drops the key:
the frame would validate locally yet decode-fail on the peer), functions/symbols, `BigInt` and
reference cycles (would escape as raw `TypeError`s), non-finite numbers (silently become
`null`), non-plain objects like `Date`/`Map`/class instances (serialize as their
toJSON/enumerable projection — the rejection names the constructor), `toJSON` carriers on arrays
AND objects (checked via the same `[[Get]]` lookup `JSON.stringify` uses, own or inherited), and
own non-index array expando keys (silently dropped). The walk is **iterative** (deeply-nested
frames decoded from the wire can never hit a recursion limit), tracks only the current ancestor
path (shared non-cyclic references stay accepted, like `JSON.stringify`), and converts
accessor/Proxy-trap throws into structured rejections. **Wire-decoded input never pays a
rejection here** — `JSON.parse` cannot produce any rejected value, so this is purely local-API
hardening for the F16 transport's `params: unknown` construction path; the hot-path cost is
O(value-graph nodes), so a flood-rate `pty:data` string is a single node.

## Handshake: agent speaks first; a version check, NOT a compatibility matrix

1. On a new connection the **agent sends its hello first**: `{ type: 'hello', proto: WIRE_PROTO,
   role: 'agent', version, capabilities }`. `WIRE_PROTO` (currently `1`) is a sanity marker —
   exact-equality checked, distinct from the version so "not our protocol at all"
   (`proto-mismatch`) diagnoses differently from "right agent, wrong build"
   (`version-mismatch`).
2. The **client sends nothing** until that hello arrives. It validates the hello and applies the
   **EXACT version check**: string identity, no semver ranges, no normalization. The client
   provisions the agent (locked decision 2), so client and agent are version-locked — the
   handshake is a **version check**, never a **compatibility matrix**. On a match the client
   replies `{ type: 'hello', proto: WIRE_PROTO, role: 'client', version }` (no capabilities —
   only the agent advertises) and the session is established on both sides after this second
   message.
3. On ANY failure (`unexpected-frame`, `bad-hello`, `proto-mismatch`, `version-mismatch`)
   **neither side emits a frame**; the failure object is the local diagnostic. F19's provisioning
   distinguishes `version-mismatch` (re-provision the bundled matching build) from the rest.

Both handshake machines (`createClientHandshake` / `createAgentHandshake`) are pure and
single-use; `onMessage` after completion throws `handshake-done`.

## Capability partition

`CAPABILITY_IDS` (18, closed, sorted): the 17 per-domain IPC registrar names — derived from
`src/main/ipc/register-*.ts`, `register.ts` composition root excluded — **plus `status`**.
`status` is the one non-registrar id: the status domain (the `pty:status`/`pty:cwd`/`pty:procs`
push family and the `src/main/status/` detection stack) locally rides `register-pty.ts`, but the
epic names it as its own advertised agent domain (locked decision 6: "v1 agent = pty + status
only"), so the vocabulary makes it expressible. The v1 agent advertises `AGENT_V1_CAPABILITIES =
['pty', 'status']` — F16 uses this constant. The partition is pinned against the registrar file
set by TEST-741; a future feature adding a registrar extends both in the same change (see the
CONV-022 amendment path in that test's header).

## Correlation

`createRequestTracker()`: monotonic ids from 1 (never reused per tracker), out-of-order
settlement, `duplicate`/`unknown-id` detection, and `failAllPending(reason)` — the
connection-closed drain that reports every still-pending request exactly once, in id order, then
closes the tracker (`open` afterwards throws `tracker-closed`; late responses settle as
`closed`). No timers, no promises — the F16 transport wraps it.

## Flow-control frames — semantics landed with F17 (0018-windowed-flow-control)

`ack` (`{ id, bytes }` — the client acknowledges pty output for a pane; delta, not cumulative)
and `window` (`{ size, id? }` — the unacked-byte window; `id` absent = connection default) were
shape-only in THIS feature (validated and round-tripped, deliberately inert). F17 gave them
their semantics over these exact, unchanged shapes in `src/shared/remote/flow-control.ts`
(exported via this barrel: `flowPayloadSize`, `createAgentFlowGate`, `createClientAckPolicy`,
`DEFAULT_FLOW_WINDOW_BYTES`, `DEFAULT_ACK_EVERY_BYTES`) — windowed backpressure with watermark
hysteresis, applied to the backend's `pause()`/`resume()` by the agent session. The TEST-747
export pin was extended accordingly through 0018's tests phase; details live in
[remote-agent.md](remote-agent.md) § Flow control.

## Zero-consumer guarantee

Nothing under `src/main/`, `src/preload/`, or `src/renderer/` imports `shared/remote`
(TEST-746). Expected lifecycle: F16 adds the agent-side consumer OUTSIDE those trees (the guard
survives); F21 legitimately routes client pty/status IPC through the protocol inside `src/main`
and retires the guard through its own tests phase.
