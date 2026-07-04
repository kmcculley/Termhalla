# Tests — 0021-exclusive-attach-lease

**Phase:** 4 (tests). **Input:** `02-spec.md` (frozen), `03-plan.md`. All suites are vitest under
`tests/` (the profile's `testRoots`), authored RED against the planned surface — the store still
throws on bind-while-bound, `BoundClient` has no `onLeaseRevoked`, and neither door exports
`AGENT_LEASE_REVOKED_EVT`. Test ids continue the epic's global sequence at `TEST-21xx`
(F19 ended at TEST-2033).

## Oracle conventions

- **The displaced-connection contract** (`expectDisplaced` helper, asserted in every steal
  vector): exactly ONE `lease:revoked` evt, `args` deep-equal `[]`, positioned as the FINAL
  frame of the loser's `sent` log, `exits === [0]`.
- **Reference-terminal / composition oracle (REQ-006b):** same as 0019 — an independent
  `@xterm/headless` + serialize reference; cross-steal exactness compares
  `serialize(snapshot ⊕ winner's post-res data)` against a **golden full stream** driven on a
  fresh fake handle with the identical writes (the loser's receipts cannot reconstruct the
  stream — some bytes are deliberately never delivered to anyone as frames).
- **Determinism normalization (REQ-007c):** `TerminalStatus.since` rides `Date.now()` through
  the reused engine (pre-existing, outside the lease surface); run-twice equality compares
  frame logs with every `since` normalized to 0 and FIXED req ids (990001…). Nothing else is
  normalized.
- **Flow observation:** the scripted stub backend records per-handle `pause`/`resume` call
  sequences and models pause-queueing/resume-flush deterministically (the 0018 flowSpy
  discipline); the frozen 0019 stubs got inert no-ops ONLY (observation lives in this
  feature's own suite).

## Suites

| File | Tests | REQs |
|------|-------|------|
| `tests/agent-lease.test.ts` | TEST-2101..TEST-2110 | REQ-002..REQ-007, REQ-009, REQ-010(a) |
| `tests/agent-lease-vocab.test.ts` | TEST-2111 | REQ-008 |
| `tests/docs-feature-0021.test.ts` | TEST-2112 | REQ-012 |
| `tests/agent-session-store.test.ts` (amended case) | TEST-1905 | REQ-011(b), REQ-003 |
| stub no-ops in the three frozen 0019 files | — (type-only) | REQ-011(a) |

- TEST-2101 — REQ-002(a)(b): voluntary release (clean EOF) emits NO revocation evt and
  re-binds fresh; after a steal exactly one connection log grows with pane events.
- TEST-2102 — REQ-003: bind-while-bound never throws; loser displaced (contract helper);
  steal-gap bytes route to NOBODY and surface in the winner's snapshot; a THROWING
  `onLeaseRevoked` is contained (raw-store vector: diagnosed, grant proceeds); identity-blind
  self-rebind displaces-then-regrants exactly once (raw store; unreachable via sessions —
  pinned for uniformity); destroyed-store binds steal without throwing and answer `[]`.
- TEST-2103 — REQ-004: post-revocation reqs get NO res; late EOF no-ops; a send that throws ON
  the evt → diagnosed, exit 0, winner unaffected; the evt round-trips F15's strict framing
  (encode → decode → deep-equal).
- TEST-2104 — REQ-002(c): after displacement, every late loser end-path shape (EOF, fatal
  item, late req) leaves the winner bound, subscribed, served, `attached: true`.
- TEST-2105 — REQ-005: a pane paused by the loser's stall resumes EXACTLY once during the
  steal, backlog feeds replay only (in the winner's snapshot; in nobody's `pty:data`); the
  loser's per-pane window override is forgotten (200 units under the fresh default window —
  no pause); a resume that throws during the steal is diagnosed and the steal completes.
- TEST-2106 — REQ-006(a)(c): controlled-barrier factory — the loser's pending attach settles
  with NO res and NO held-byte delivery (the evt stays the final frame); held bytes verifiably
  fed the replay; the winner's own attach window is undisturbed (fresh hold, drain after ITS
  res); overlap rejection still applies within the winner's connection; sequential re-attach
  works.
- TEST-2107 — REQ-006(b): the real-replay byte-exactness oracle ACROSS a steal with an
  interrupted attach: winner snapshot ⊕ winner events ≡ golden full stream (pre-steal echo +
  the loser's never-delivered held tail + post-steal echo).
- TEST-2108 — REQ-007: the A→B→C chain (one revocation each, C fully served, zero kills);
  steal-back (the displaced client's fresh connection displaces the thief; both eras in the
  snapshot); run-twice determinism (normalized logs deep-equal).
- TEST-2109 — REQ-009: the full two-client scenario — truthful `attached:false` inventory with
  post-steal cwd metadata; adopt without history replay; attach; write; kill prunes
  store-wide; the loser's view is a strict prefix + revocation + nothing.
- TEST-2110 — REQ-010(a): the owned composition — end-of-input still kills panes and exits 0;
  no lease frame ever appears there.
- TEST-2111 — REQ-008: `AGENT_LEASE_REVOKED_EVT === 'lease:revoked'`; both doors are one
  binding; disjoint from `AGENT_PTY_METHODS`/`AGENT_SESSION_METHODS`/`Object.values(CH)`; the
  literal appears in EXACTLY one `src/` file — `src/agent/session-api.ts` (two-door
  discipline; the frozen TEST-749/750/1908 suites keep pinning the closed sets themselves,
  unmodified).
- TEST-2112 — REQ-012: `docs/features/remote-agent.md` literals — `lease:revoked`,
  `attach -d`, `exactly one`, `lease`, /steal/i.

## Sanctioned frozen-suite amendments (REQ-011; CONV-019 retirement path)

1. **TEST-1905 bind-guard case** (`tests/agent-session-store.test.ts`): "binding while another
   connection is bound throws, naming the F20 retirement" → now pins the STEAL (no throw; the
   loser's final frame is the revocation evt; exit 0; zero kills). The case deliberately uses
   the `'lease:revoked'` LITERAL, not the constant — importing the not-yet-existing export
   would have turned the whole frozen file red at module link; literal↔constant identity is
   pinned by TEST-2111. File header annotated with the 0021 amendment note.
2. **The three TS2739 stubs** (`tests/agent-attach-sessions.test.ts` inline stub,
   `tests/agent-session-store.test.ts` `mkStub`, `tests/agent-survival.test.ts` `mkStub`):
   `pause: () => {}, resume: () => {}` no-ops with a one-line 0021 annotation. Type-only; no
   assertion or semantic change; those suites remain green.

No other frozen file is touched.

## RED verification (CONV-059)

`npm test` at authoring time: **4 failed | 248 passed (252 files)**; the failing set is
EXACTLY this feature's surface:

- `tests/agent-lease.test.ts` — 19/21 failed (the two passes are deliberate regression pins
  that must survive the change: TEST-2101's voluntary-release-emits-no-evt and TEST-2110's
  owned-composition vector).
- `tests/agent-lease-vocab.test.ts` — 2/3 failed (the pass is the disjointness pin, vacuous
  until the constant exists, meaningful after).
- `tests/docs-feature-0021.test.ts` — 1/1 failed.
- `tests/agent-session-store.test.ts` — 1/14 failed: exactly the amended TEST-1905 case (the
  store still throws). Every other case in that frozen file stays green.

23 failed tests total; no other file red. `npm run typecheck`: the three pre-existing TS2739s
are GONE (the weld's mandatory housekeeping); the remaining errors are exactly this feature's
own not-yet-implemented surface (TS2305 `AGENT_LEASE_REVOKED_EVT` on both doors; TS2353
`onLeaseRevoked` not in `BoundClient`) — the implement phase turns typecheck fully green
(REQ-011 acceptance; the ORKY gate profile itself is build+test, and CI runs typecheck).

## Loopback 1 (implement → tests): the TEST-2105 window-seeding fix

The three TEST-2105 vectors originally sent a per-pane `window` frame BEFORE any `pty:data`
for the pane — F17's own pinned contract (D4/REQ-007: the flow gate tracks a pane lazily on
first emission; windows for untracked panes are diagnosed and NEVER stored) ignores such a
frame, so the pane never paused and the vectors failed against a CORRECT implementation.
Tests-phase fix (this loopback): each vector now seeds one small emission (`'seed,'`, 5 units)
to create the gate record before the per-pane window frame; semantics unchanged (pause under
the loser's stall → exactly one resume at the steal → fresh default window for the winner).
Test-file-only; freeze re-captured at this gate. The re-gated run is GREEN on the loopback
(implementation already exists) — the original RED enumeration above stands as the CONV-059
record.

## Loopback 2 (review → tests): finding vectors (FINDING-001/002/003)

Review filed three code-addressable findings (none blocking; fixed eagerly per the 0020
precedent). TDD routing: the pinning vectors land FIRST, RED against the confirmed defects:

- **TEST-2113** (REQ-002c, FINDING-001 MEDIUM): a NEVER-bound connection (failed-handshake;
  pre-hello EOF) must not release the holder — today `end()` calls `store.unbind()`
  unconditionally and strips holder A silently (repro-verified).
- **TEST-2114** (REQ-004b, FINDING-002 LOW, codex-verified): nothing may follow the
  revocation evt even when the sink's `send` synchronously pumps inbound frames back into
  `onItem` during the notification (today a res can trail the "final" frame; a reentrant
  spawn could leak a subscription to the next holder).
- **TEST-2115** (REQ-007a, FINDING-003 LOW, codex-verified): a nested `bind()` issued inside
  the revocation callback is NEWER and must hold; the outer (older) bind self-displaces —
  today the outer grant clobbers the nested holder without revocation.

RED verification for this loopback: `tests/agent-lease.test.ts` 4 failed / 21 passed — the
four failures are exactly the three findings' vectors; no other file red. Freeze re-captured
at this gate; the implement phase fixes all three (holdsLease holder-scoped release; the
`revoked` inbound guard; the post-callback bound re-check).
