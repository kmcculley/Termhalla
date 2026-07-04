# Remote wire protocol core + handshake (Orky F15) — Review Follow-ups (deferred)

Feature `0016-remote-protocol-core-handshake` — the first Remote Agent v1 feature: the pure
protocol layer under `src/shared/remote/` (framing, strict v1 vocabulary, exact-version handshake,
correlation, reserved flow-control shapes), vitest-only in v1 with a mechanical zero-consumer
guard. Review ran six lenses (security, quality, devils-advocate, networking, determinism, codex
cross-check) over a `networking`+`determinism` concern routing; the one blocking finding
(FINDING-009, HIGH, contract-violation) escalated to a human (ESC-001), was fixed per the decided
option across two implement loop-backs (an A/B contest won by the codex candidate, then an inline
completion patch closing the inherited-`toJSON`-on-arrays residual the codex cross-check caught on
re-review), and is closed along with the three re-review LOWs (FINDING-010/011/012). See
`.orky/features/0016-remote-protocol-core-handshake/` for the full ledger.

Everything below is OPEN, deliberately deferred, and non-blocking (all MEDIUM/LOW at the HIGH
escalation threshold). **F17 (windowed flow control) is the natural landing site for most of it**
— its flood/backpressure scenario is the roadmap's committed proving ground for this layer.

## Open findings (deferred to F17-era hardening unless noted)

- **FINDING-001 (MEDIUM, quality)** — `correlation.ts`: the tracker's `settled` Set grows
  unboundedly for the tracker's life (every completed request id retained to distinguish
  `duplicate` from `unknown-id`). Ids are monotonic from 1, so membership is derivable with no
  cache: `id >= nextId` ⇒ unknown-id; `pending.has(id)` ⇒ settled; else duplicate. Drop the Set.
  Fix when F16 gives the tracker a long-lived consumer.
- **FINDING-002 (MEDIUM, quality)** — `framing.ts`: the `maxFrameBytes` override is never
  validated — `NaN` silently DISABLES the size limit in BOTH directions; 0/negative/fractional
  values are undocumented. Validate at `encodeFrame`/`createFrameDecoder` entry (positive safe
  integer ≤ 0xFFFFFFFF) and reject actionably.
- **FINDING-003 (MEDIUM, security)** — diagnostic messages embed peer-controlled values UNBOUNDED
  via `JSON.stringify` interpolation in the ORIGINAL envelope `bad()` call sites and
  `handshake.ts` (the FINDING-009-era walker rejections deliberately avoid this — they name
  path + type only, values never). Route embedded values through one clamp+escape helper before
  any consumer (F16 agent log) prints them. Terminal-escape-injection + log-flooding hazard.
- **FINDING-004 (LOW, security)** — envelope presence checks use `'key' in obj` (satisfied by
  inherited properties): a locally crafted object with a poisoned prototype passes validation yet
  serializes WITHOUT the key. Switch to `Object.hasOwn`. Wire input unaffected.
- **FINDING-005 (MEDIUM, networking)** — the decoder grows its buffer by full-array concat on
  EVERY push, compacting only at frame boundaries: O(n²) bytes copied for a large frame in small
  chunks (8 MiB frame in 64 KiB chunks ≈ 0.5 GB copied). Sits directly on the F17 flood hot path;
  fix with a pending-chunk list (join lazily) or ring buffer, and benchmark in F17's flood suite.
- **FINDING-006 (LOW, quality)** — frozen-suite coverage gaps: nothing pins (a) a frame EXACTLY at
  `maxFrameBytes` being accepted (an off-by-one would pass) or (b) lone-surrogate round-trips for
  `pty:data` strings (a PTY chunk split mid-emoji). Amend through F17's tests phase.
- **FINDING-007 (LOW, qol)** — `createAgentHandshake` does no construction-time validation of its
  own advertisement (unknown/duplicate capability ids only fail later at encode/peer-parse, far
  from the mistake). Validate in the factory and throw immediately.
- **FINDING-008 (LOW, devils-advocate)** — design risk: `pty:data` rides a JSON STRING inside the
  envelope (JSON escaping is 2–6× expansion for control-heavy bytes + UTF-16↔UTF-8 transcoding per
  chunk, both ends). **F17's flood benchmark is the decision gate**: if throughput/agent memory
  miss targets, reserve a length-prefixed BINARY payload frame type (the protocol is
  version-locked per build, so adding one later is cheap).

## Residual notes from the FINDING-009 descent (recorded in resolutions, no open finding)

- **Envelope-level trap escapes (pre-existing, LOW-class).** The walker converts accessor/Proxy
  throws to structured `bad-message`, but TOP-LEVEL envelope reads (`m.type`, `m.params`,
  `Object.keys(m)`, the old `JSON.stringify` diagnostics) sit outside it — a hostile local Proxy
  AS THE FRAME ITSELF can still raw-throw. Unreachable from wire input and from ordinary local
  construction; fold into the FINDING-003/004 local-domain hardening pass.
- **Lying-Proxy TOCTOU is inherent.** A local Proxy returning different values across the
  validation read and the `JSON.stringify` read defeats ANY validate-then-stringify design; only
  stringify-first-then-validate-the-string closes it. Out of scope by the decided option (a);
  revisit only if F16 ever feeds genuinely untrusted objects into frames (it should not).
- **`-0` mutates to `0`** across encode (`JSON.stringify(-0)` → `"0"`): the one remaining silent
  numeric normalization; arithmetically invisible to consumers, noted for completeness.

## Verification trail

The FINDING-009 fix is exercised by scratch verifiers (18 checks: every rejected class + DAG /
null-prototype / plain-JSON / 200k-deep acceptance + round-trip integrity), the frozen suite
(unchanged, green through every gate re-derivation), and a codex cross-check re-verification
(VERIFIED-FIXED, "no new defect in the completion patch"). Frozen-test pins for the new rejections
are deliberately deferred to F17's tests phase (the freeze boundary was not reopened for the
loop-backs; see FINDING-006).
