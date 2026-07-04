# Tests — 0016-remote-protocol-core-handshake

**Phase:** 4 (tests). Authored by the test-designer BEFORE any implementation exists; the suite
runs RED (the `@shared/remote/protocol` barrel does not exist yet, so every importing file fails,
and the purity/docs scans fail on the missing directory/file). FROZEN once the tests gate passes
(ADR-009). TEST ids continue the repo-global sequence after TEST-724 → this feature owns
TEST-725..TEST-748 (TEST-747/748 numbered after the file-grouping was settled; no gaps in
ownership, 24 ids).

## Files

| File | Tests |
|---|---|
| `tests/remote-protocol-framing.test.ts` | TEST-725..732 |
| `tests/remote-protocol-messages.test.ts` | TEST-733..737 |
| `tests/remote-protocol-handshake.test.ts` | TEST-738..740 |
| `tests/remote-protocol-capabilities.test.ts` | TEST-741, TEST-742, TEST-747 |
| `tests/remote-protocol-correlation.test.ts` | TEST-743, TEST-744 |
| `tests/remote-protocol-guards.test.ts` | TEST-745, TEST-746 |
| `tests/docs-feature-0016.test.ts` | TEST-748 |

## TEST → REQ map

| TEST | REQ(s) | Asserts |
|---|---|---|
| TEST-725 | REQ-003, REQ-015 | `encodeFrame` emits 4-byte BE u32 payload-byte length + UTF-8 JSON (header excluded from count); `FRAME_HEADER_BYTES === 4`; encoding a malformed frame throws `bad-message` naming the type. |
| TEST-726 | REQ-003 | The length prefix counts UTF-8 BYTES: a `π€` payload's byte length strictly exceeds its UTF-16 length; round-trips. |
| TEST-727 | REQ-004, REQ-015 | `DEFAULT_MAX_FRAME_BYTES === 8388608`; over-limit encode throws `frame-too-large` with BOTH the exact actual byte count and the limit in message + detail; per-call `maxFrameBytes` override honored. |
| TEST-728 | REQ-004 | Decode side: a declared length over the limit yields a `fatal` item naming both numbers; a custom `maxFrameBytes: 64` decoder rejects a frame the default decoder accepts. |
| TEST-729 | REQ-005 | Chunking invariance: all-at-once / byte-at-a-time / mid-prefix split / every-3-bytes (splits multi-byte UTF-8) partitions of a 3-frame stream yield identical item sequences; empty chunk yields `[]`. |
| TEST-730 | REQ-006, REQ-015 | Per-frame errors don't kill the stream: [valid, bad-JSON, valid, bad-UTF-8, empty-payload, bad-message] yields kinds in order with valid neighbours intact; reasons `bad-json`×3 + `bad-message`; `bad-json` detail carries the payload byte length; decoding continues after. |
| TEST-731 | REQ-006 | After a `fatal` item, `push` throws `decoder-dead`. |
| TEST-732 | REQ-016 | Round-trip totality: 11 fixtures covering all six types (agent+client hello, req null-params, res both polarities, evt empty/unicode+C0 args, ack, window ±id) individually and concatenated. |
| TEST-733 | REQ-007 | `hello` accept/reject table: canonical agent/client hellos accepted (incl. `proto: 2` at parse layer — the `=== WIRE_PROTO` check is the handshake's); capabilities required-for-agent/forbidden-for-client; unknown/duplicate/non-string capability ids rejected naming the offender; bad proto/role/version/extra-key rejected. |
| TEST-734 | REQ-007 | `req`/`res` accept/reject: params key required (null allowed); positive-integer ids; ok/result/error cross rules; malformed nested error objects rejected. |
| TEST-735 | REQ-007, REQ-013 | `evt`/`ack`/`window` accept/reject incl. the reserved flow-control shapes exactly as spec'd; unknown types rejected naming the type; non-object inputs rejected. |
| TEST-736 | REQ-014 | Push-envelope fidelity: `pty:data` with C0 controls + multi-byte UTF-8 (incl. a surrogate-pair emoji), `pty:exit` numeric args, and a `pty:status`-shaped object round-trip deep-equal through encode→decode. |
| TEST-737 | REQ-015 | Parse-layer errors are structured + actionable: reason `bad-message`, offending value in message AND detail, no bare "invalid input"; `WIRE_PROTO === 1`. |
| TEST-738 | REQ-008 | Happy path: agent `helloFrame()` → client `ok` with capabilities SORTED + exact reply frame (no capabilities key) → agent accepts reply → both established. |
| TEST-739 | REQ-008, REQ-013 | Failure vectors: non-hello first frame (`unexpected-frame` naming `req`/`ack`), wrong-role hello (`bad-hello`), parse-invalid hello (`bad-hello`), `proto: 2` (`proto-mismatch` naming both), single-use machines (`handshake-done` throws on both sides), failures carry no reply frame. |
| TEST-740 | REQ-009 | EXACT version identity: identical establishes; near-misses (`0.11.1`, `v0.11.0`, trailing space, `-beta`) each fail `version-mismatch` with BOTH versions verbatim in message + detail; agent side applies the same check. |
| TEST-741 | REQ-010 | `CAPABILITY_IDS` deep-equals sorted(union of the 17 `src/main/ipc/register-*.ts` names + `status`), 18 entries, sorted, unique; `isCapabilityId` accepts members, rejects `'STATUS'`/`''`/`'ptyx'`/non-strings. CONV-022 amendment path in the file header. |
| TEST-742 | REQ-011 | `AGENT_V1_CAPABILITIES` deep-equals `['pty','status']`; members valid; an agent hello built from it passes validation. |
| TEST-743 | REQ-012 | Ids from 1 incrementing; ready-to-send req frames validate; out-of-order settlement reaches exactly its own request; `duplicate`/`unknown-id` outcomes; `pendingCount`; no id reuse after settlement. |
| TEST-744 | REQ-012, REQ-015 | `failAllPending` drains each pending exactly once in id order and closes; second call `[]`; late settles → `closed`; `open` after close throws `tracker-closed` (actionable). |
| TEST-745 | REQ-001 | Purity scan: `src/shared/remote/` exists, contains `protocol.ts`, and no module matches `from 'node:` / `from "electron` / `require(` / `\bBuffer\b` / `\bprocess\.` / `__dirname`. |
| TEST-746 | REQ-002 | Scope guard: zero import specifiers containing `shared/remote` under `src/main`, `src/preload`, `src/renderer` (CONV-019 retirement path — survives F16, retired by F21 — in the header; CONV-037 feature-keyed regex). |
| TEST-747 | REQ-013 | The `@shared/remote/protocol` barrel's runtime export list deep-equals exactly the 13 spec'd symbols — scope creep (e.g. a flow-control semantics API) is mechanically visible. |
| TEST-748 | REQ-017 | `docs/features/remote-protocol.md` exists and carries the load-bearing literals (`hello`, `WIRE_PROTO`, the 8 MiB cap, "version check", "compatibility matrix", `status`, `F17`). |

## Loopback 1 — tests re-entry (typecheck fidelity fix, no behavioral change)

Implementer-reported (ADR-009 route): the `res()` helper in
`tests/remote-protocol-correlation.test.ts` was annotated `: WireFrame` while being passed to
`RequestTracker.settle(response: ResFrame)`, failing `npm run typecheck` (TS2345 at the settle
call sites) even though vitest (which transforms without typechecking) ran green. Fixed on
re-entry by narrowing the annotation to `: ResFrame` (+ the matching type-only import swap).
Zero runtime assertions changed; the tests-red gate accepts the green suite on re-entry
(`iterations.tests > 0`) and recaptures the freeze snapshot.

## RED verification

Executed at authoring time (before any `src/shared/remote/` code exists): `npm test` exits
non-zero — the five protocol suites fail at import (`@shared/remote/protocol` unresolved), the
purity scan fails on the missing directory, and the docs pin fails on the missing doc. TEST-746
(scope guard) legitimately passes already — the RED requirement is suite-level, and the guard pins
an absence that must hold both before AND after implementation. See the gate's `tests-red`
re-derivation for the authoritative record.
