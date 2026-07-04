# Plan — 0016-remote-protocol-core-handshake

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-017), `.orky/baseline/architecture.md`.
Planner tier: low (router). No code or tests in this phase.

## Target module layout

New directory `src/shared/remote/` (pure, zero Node/Electron imports — REQ-001), consumed via the
`@shared/remote/protocol` barrel only. Mirrors the existing pure-module style of `src/shared/`
(`orky-status.ts`, `terminal-links.ts`): small focused modules, no side effects at import time.

```
src/shared/remote/
  errors.ts        ProtocolError + ProtocolFailure + the closed reason union      (REQ-015)
  capabilities.ts  CAPABILITY_IDS / CapabilityId / isCapabilityId / AGENT_V1_...  (REQ-010, REQ-011)
  messages.ts      frame type interfaces + strict parseWireMessage               (REQ-007, REQ-013, REQ-014)
  framing.ts       FRAME_HEADER_BYTES / DEFAULT_MAX_FRAME_BYTES / encodeFrame /
                   createFrameDecoder (incremental, chunking-invariant)          (REQ-003..006, REQ-016)
  handshake.ts     WIRE_PROTO / createClientHandshake / createAgentHandshake     (REQ-008, REQ-009)
  correlation.ts   createRequestTracker                                          (REQ-012)
  protocol.ts      the barrel — exactly the spec's Public interface              (REQ-001, REQ-013)
docs/features/remote-protocol.md                                                 (REQ-017)
```

Dependency direction (acyclic): `errors` ← everything; `capabilities` ← `messages`/`handshake`;
`messages` ← `framing`/`handshake`/`correlation`; `protocol` re-exports all. `WIRE_PROTO` lives in
`handshake.ts` (hello construction/checking is the only consumer; `messages.ts` validates `proto`
only as a positive integer per REQ-007, so no cycle).

Tests (authored at phase 4, NOT here) live under `tests/` per the gate profile's `testRoots`,
following the existing flat naming: `tests/remote-protocol-*.test.ts` + `tests/docs-feature-0016.test.ts`.

## Tasks

### TASK-001 — `errors.ts`: the structured error substrate
The closed reason union (`'frame-too-large' | 'decoder-dead' | 'bad-json' | 'bad-message' |
'unexpected-frame' | 'bad-hello' | 'proto-mismatch' | 'version-mismatch' | 'handshake-done' |
'tracker-closed'`), the `ProtocolFailure` shape (`reason`, machine `detail` fields, human
`message`), and the `ProtocolError` class (thrown paths) — every constructor site must name what
failed, the offending value(s), and the expectation (CONV-001).
**Files:** `src/shared/remote/errors.ts`. **Deps:** none. **Satisfies:** REQ-015 (substrate for all).

### TASK-002 — `capabilities.ts`: the closed capability vocabulary
`CAPABILITY_IDS` as const (18 entries, sorted, unique — the 17 registrar names + `'status'`, with
the REQ-010 reconciliation note as a doc comment), `CapabilityId` union type, `isCapabilityId`
guard, `AGENT_V1_CAPABILITIES = ['pty', 'status']`.
**Files:** `src/shared/remote/capabilities.ts`. **Deps:** TASK-001 (none at runtime; ordering only).
**Satisfies:** REQ-010, REQ-011.

### TASK-003 — `messages.ts`: frame types + strict validation
Interfaces `HelloFrame`/`ReqFrame`/`ResFrame`/`EvtFrame`/`AckFrame`/`WindowFrame`, `WireFrame`
union, and `parseWireMessage(value: unknown)` implementing REQ-007's exact accept/reject table:
strict unknown-key rejection, per-field type/range checks, hello capability rules
(agent-required/client-forbidden, membership via `isCapabilityId`, uniqueness), res ok/result/error
cross rules, actionable `bad-message` errors naming the offending field/key/id/type. `ack`/`window`
are shape-only here (REQ-013); `evt` is the generic push envelope (REQ-014).
**Files:** `src/shared/remote/messages.ts`. **Deps:** TASK-001, TASK-002.
**Satisfies:** REQ-007, REQ-013 (shapes), REQ-014 (envelope).

### TASK-004 — `framing.ts`: encoder + incremental chunking-invariant decoder
`FRAME_HEADER_BYTES = 4`, `DEFAULT_MAX_FRAME_BYTES = 8388608`. `encodeFrame(frame, opts?)`:
validate via `parseWireMessage` (throw `bad-message`), JSON.stringify, TextEncoder, 4-byte
big-endian byte-length prefix (payload bytes only), `frame-too-large` above the limit (both
numbers). `createFrameDecoder(opts?)`: buffers arbitrary `Uint8Array` chunks; yields
`DecodedItem[]` — `{kind:'message'}` / `{kind:'message-error'}` (bad-json/bad-message; stream
continues) / `{kind:'fatal'}` (declared length > limit; then `push` throws `decoder-dead`) — in
stream order, invariant under any chunk partition (accumulate bytes; decode payload only when the
full frame is buffered so split multi-byte UTF-8 is safe). No time/RNG/iteration-order dependence.
**Files:** `src/shared/remote/framing.ts`. **Deps:** TASK-001, TASK-003.
**Satisfies:** REQ-003, REQ-004, REQ-005, REQ-006, REQ-016 (with TASK-003).

### TASK-005 — `handshake.ts`: the two single-use state machines
`WIRE_PROTO = 1`. `createAgentHandshake({version, capabilities})` → `helloFrame()` +
`onMessage(frame)`; `createClientHandshake({version})` → `onMessage(frame)` returning
`{done, ok, capabilities (sorted), reply}` on success, `{done, ok:false, failure}` on
`unexpected-frame` / `bad-hello` / `proto-mismatch` / `version-mismatch` (both versions verbatim in
detail+message). Version check is `===` string identity only (REQ-009). Machines are single-use:
`onMessage` after done throws `handshake-done`. No frame is emitted on failure.
**Files:** `src/shared/remote/handshake.ts`. **Deps:** TASK-001, TASK-002, TASK-003.
**Satisfies:** REQ-008, REQ-009.

### TASK-006 — `correlation.ts`: the request tracker
`createRequestTracker()`: `open(method, params)` (ids from 1, +1, never reused; returns the ready
`req` frame), `settle(res)` → `settled | unknown-id | duplicate | closed`, `failAllPending(reason)`
(exactly-once drain in id order; closes; second call `[]`), `open` after close throws
`tracker-closed`, `pendingCount`. Pure state machine — no timers, no callbacks, no promises.
**Files:** `src/shared/remote/correlation.ts`. **Deps:** TASK-001, TASK-003.
**Satisfies:** REQ-012.

### TASK-007 — `protocol.ts`: the barrel, exactly the spec's Public interface
Re-export exactly: `WIRE_PROTO`, `FRAME_HEADER_BYTES`, `DEFAULT_MAX_FRAME_BYTES`,
`CAPABILITY_IDS`, `AGENT_V1_CAPABILITIES`; types `CapabilityId`, `WireFrame` + the six frame
types, `DecodedItem`, `ProtocolFailure`, handshake result shapes, `SettleResult`, `FailedRequest`;
`encodeFrame`, `createFrameDecoder`, `parseWireMessage`, `isCapabilityId`,
`createClientHandshake`, `createAgentHandshake`, `createRequestTracker`; `ProtocolError`. Nothing
else (the phase-4 export-surface test pins this — REQ-013).
**Files:** `src/shared/remote/protocol.ts`. **Deps:** TASK-001..006. **Satisfies:** REQ-001 (the
single import surface), REQ-013 (export pin target).

### TASK-008 — `docs/features/remote-protocol.md`
Document per REQ-017: wire format (4-byte BE length + UTF-8 JSON, 8 MiB default cap), handshake
sequence (agent hello first; two-message; EXACT-version check — "a version check, NOT a
compatibility matrix"), capability partition incl. the `status` reconciliation note, reserved
flow-control frames (semantics F17), zero-consumer guarantee + F16/F21 retirement path.
**Files:** `docs/features/remote-protocol.md`. **Deps:** TASK-007 (documents the final surface).
**Satisfies:** REQ-017.

### TASK-009 — Repo integration pass (constraints, not new artifacts)
Run `npm run typecheck` and the full `npm test` from the repo root; confirm zero imports of
`shared/remote` under `src/main/`, `src/preload/`, `src/renderer/` (the phase-4 scope-guard test
enforces it mechanically); confirm the characterization suites are untouched and green. No file
edits belong to this task — it enforces REQ-002's constraint across TASK-001..008.
**Files:** none (verification). **Deps:** TASK-001..008. **Satisfies:** REQ-002.

## Task order

TASK-001 → TASK-002 → TASK-003 → TASK-004 / TASK-005 / TASK-006 (parallelizable) → TASK-007 →
TASK-008 → TASK-009.

## Open issues

None — every REQ maps to at least one task (see `traceability.json`); no REQ is under-specified for
planning purposes.
