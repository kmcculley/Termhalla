# Spec — 0021-exclusive-attach-lease

**Phase:** 2 (spec). **Inputs:** `00-intake.md` (roadmap entry F20 verbatim + locked decisions,
human-confirmed 2026-07-04, incl. the mandatory F17×F18 batch-weld items), `.orky/conventions.md`,
`.orky/baseline/` (adopted brownfield repo), the merged F15–F19 artifacts (`src/shared/remote/`,
`src/agent/`, `src/remote-client/`, `docs/features/remote-agent.md` + their frozen suites). No
`01-concept.md` — app-run mode: the concept was fixed at roadmap time.

## Concerns

`["networking", "determinism"]`

(`networking` — this feature changes the protocol endpoint's CONNECTION lifecycle: who may hold a
live agent's session set, how a displaced peer learns it, and what its final frame is; correctness
is defined across two peers' views of one steal. `determinism` — the roadmap's own acceptance
bar: "the concurrent-attach steal race must resolve deterministically (exactly one holder)";
every steal interleaving must be a deterministic function of the scripted event order. Always-on
lenses per config: security, quality, devils-advocate.)

## Scope summary

Exclusive attach via an agent-side lease (locked decision 5 — `tmux attach -d` semantics; no
mirrored attach), replacing F18's single-connection bind guard:

1. **The lease.** The session store's bound-connection slot IS the lease: at most one connection
   holds a store at any instant. Grant = binding an unbound store (what handshake establishment
   already does); release = any connection-end path (the existing detach). Nothing about grant or
   release requires new wire methods — the lease rides F18's bind/attach/inventory path.
2. **Steal.** Binding while another connection is bound no longer throws (the F20-named guard is
   retired): it DISPLACES the incumbent — atomically, within the synchronous bind — by detaching
   it with EXACTLY the established `unbind()` semantics (the F17×F18 weld contract: gate-paused
   backends resumed while no client is bound, flow gate reset, in-flight attach windows
   generation-invalidated, subscriptions cleared) and granting the lease to the newcomer. The
   newer attach always wins.
3. **The loser learns it.** The displaced connection is notified through a new store→connection
   callback; its session sends ONE `lease:revoked` evt — the loser's FINAL frame — and ends that
   connection cleanly. F21 renders the disconnected-workspace banner off that evt; this feature
   ships no UI.
4. **Deterministic race resolution.** Binds form a total order (the store is single-threaded);
   the last bind holds; a displaced connection's in-flight work (pending attach snapshots, held
   bytes, late end-path activity) settles inert and can never detach or corrupt the current
   holder; a displaced client may reconnect and steal back. Exactly one holder at every instant.
5. **Mandatory tests-phase housekeeping** (routed here by the F17×F18 weld): fix the three
   frozen-0019 stub handles missing `pause`/`resume` (TS2739; `npm run typecheck` is red today),
   and amend the frozen TEST-1905 bind-guard case that pins the retired throw — both through this
   feature's tests phase, atomically, with freezes re-captured.

The running Electron app's behavior stays byte-identical: nothing under `src/main/`,
`src/preload/`, or `src/renderer/` changes; F15's TEST-746 scope guard and every
`tests/characterization-*.test.ts` survive unchanged. The shipped stdio artifact
(`termhalla-agent.cjs`) is behavior-identical too: one stdio connection per process means a steal
is unreachable there in v1 (the lease is exercised over the survival composition in-process,
exactly where F18 proved survival).

## Baseline note (brownfield fit)

No baseline `REQ-` in `.orky/baseline/inferred-spec.md` is superseded; no characterized behavior
changes; no `SCHEMA_VERSION` change; no dependency changes. Shared files touched are exactly:
`src/shared/remote-agent-api.ts` (additive re-export) and `docs/features/remote-agent.md`
(additive section + the one sentence documenting the retired guard). `src/agent/session-store.ts`,
`src/agent/session.ts`, and `src/agent/session-api.ts` are extended in place; no new runtime
module is required. Frozen-suite touches are exactly the two SANCTIONED tests-phase amendments
enumerated in REQ-011 — nothing else under `tests/` that carries a FROZEN header may change.

---

## REQ-001 — Placement and isolation: agent-side only; the running app is untouched

All production edits MUST live under `src/agent/` plus the enumerated shared edits
(`src/shared/remote-agent-api.ts` — REQ-008; `docs/features/remote-agent.md` — REQ-012). No file
under `src/main/`, `src/preload/`, or `src/renderer/` may be added, removed, or modified. F16's
structural invariants keep holding over the modified tree: no `electron`/renderer/preload imports
in `src/agent/`; `src/main` reachable only via `status/`; every `shared/remote` specifier ends
with `/protocol`; `node-pty` and `@xterm/*` confinement unchanged. F15's frozen suite
(TEST-745/746/747), F16's frozen suites, F17's flow suites, F18's suites (as amended per
REQ-011), F19's suites, and every `tests/characterization-*.test.ts` MUST be green with this
feature applied — with NO test-file edits beyond REQ-011's two sanctioned amendments.

**Acceptance:** `npm test` green including all frozen suites; review confirms the diff touches
only `src/agent/session-store.ts`, `src/agent/session.ts`, `src/agent/session-api.ts`,
`src/shared/remote-agent-api.ts`, `docs/features/remote-agent.md`, the feature's new test
file(s), and REQ-011's enumerated test amendments; the existing structural guards (TEST-746,
TEST-751, TEST-752, TEST-1910) re-run green unmodified.

## REQ-002 — The lease model: exactly one holder; holder-scoped release

The store's binding IS the agent-side lease:

- (a) **Exactly one holder at every instant.** `bind(client)` on an unbound store grants the
  lease to `client` (unchanged from F18). At no observable point may two clients be bound, and
  at no point during a steal (REQ-003) may pane events route to more than one connection.
- (b) **Release on every connection end.** Every connection-end path — clean EOF, fatal framing,
  handshake failure, outbound send failure — releases the lease via the existing detach
  (`unbind()` semantics unchanged for a voluntary release: resume gate-paused backends with no
  client bound, reset the flow gate, bump the attach generation, clear
  subscriptions/holds/held). A released store is re-bindable (F18's sequential-reconnect
  contract, TEST-1905's surviving cases).
- (c) **Release is holder-scoped.** A connection that no longer holds the lease (because a steal
  displaced it) MUST NOT be able to release or reset the CURRENT holder's binding through any of
  its end paths — a displaced connection's late `endOfInput`/fatal-item/send-failure activity
  leaves the winner bound, subscribed, and served. (Without this, the retired guard's absence
  would let a zombie's cleanup detach the new holder — the non-deterministic outcome the roadmap
  forbids.) The mechanism is the implementer's choice (holder-identity check in the store, or
  the displaced session skipping its store release because the store already detached it), but
  the observable MUST hold for every loser end path.

**Acceptance:** store-composed vectors (spy backend, fake replay factory — the F18 suite
harness): grant/release round-trip unchanged (a re-bind after clean EOF works — the surviving
TEST-1905 cases); after a steal, drive EACH loser end path (endOfInput; a fatal decode item; a
throwing send on its next frame — note the loser receives no further frames, so this collapses
to endOfInput/fatal) and assert the winner still receives pane events, its `pty:sessions`
answers, and its flow gate state is unaffected; at every point exactly one connection's `sent`
log grows with pane events.

## REQ-003 — Steal: bind-while-bound displaces the incumbent atomically

`bind(client)` while another connection is bound MUST NOT throw (retiring the F20-named guard in
`session-store.ts` and the "F20 retires it" comment in `session.ts`). Instead, within the ONE
synchronous `bind()` call, in this observable order:

- (a) **Detach the incumbent with the established unbind semantics** (the F17×F18 weld contract,
  REQ-005 pins the flow half): gate-paused backends resumed while NO client is bound (flushed
  backlog feeds the replay terminal only — never the newcomer, never the loser), flow gate
  disposed and recreated (the newcomer starts a fresh window), `bindGen` bumped (in-flight attach
  windows of the incumbent settle inert, REQ-006), every pane's `subscribed`/`holds`/`held`
  cleared.
- (b) **Signal the displaced connection** through the incumbent's `onLeaseRevoked()` callback
  (REQ-004). The callback runs AFTER the detach — by the time the loser learns it, it can no
  longer receive routed pane frames — and any throw from it is contained (diagnosed, bounded)
  and MUST NOT prevent the grant.
- (c) **Grant to the newcomer**: `client` becomes the bound connection. The steal is
  identity-blind (the incumbent — whoever it is — is displaced; no special-casing), and no pane
  event produced during the steal routes to EITHER connection (no client is bound between (a)
  and (c); such bytes are reachable via the winner's later attach snapshot).

A `bind()` on a DESTROYED store keeps F18's behavior (the connection is accepted and answers
empty inventories); if a destroyed store somehow carries a bound client, the same
displace-then-grant order applies (uniformity; no throw).

**Acceptance:** store-composed vectors: A established + subscribed + receiving data → B
establishes (no throw) → A's `sent` log gains EXACTLY one `lease:revoked` evt after its last
pane frame and nothing after it; B handshakes and is served; data emitted between A's
displacement and B's attach appears in B's attach snapshot and was routed to NOBODY as
`pty:data`; a spy `onLeaseRevoked` that throws → diagnosed via the store diag channel, B still
bound and served; identity-blind: at the raw store level, re-binding the CURRENTLY bound client
object displaces-then-regrants it (its `onLeaseRevoked` fires once) — a degenerate case
unreachable through `createAgentSession` (each connection binds exactly once at establishment)
but pinned for uniformity.

## REQ-004 — The revocation notification: `lease:revoked` is the loser's final frame

The store→connection displacement signal and its wire consequence:

- (a) **`BoundClient` gains a REQUIRED `onLeaseRevoked(): void`** beside `send`/`onSendFailure`
  (an in-repo seam — both construction sites live in `session.ts`; no compatibility shim).
- (b) **The session's handler** (the survival composition AND the owned composition use the same
  code path; in the owned composition it is unreachable — REQ-010): send ONE
  `{ type: 'evt', channel: 'lease:revoked', args: [] }` frame to its client, then end the
  connection with exit code 0 — WITHOUT re-releasing the store (the store already detached it;
  see REQ-002(c)). The evt is the loser's FINAL frame: nothing — no `pty:data`, `pty:status`,
  `pty:cwd`, `pty:exit`, no res to any in-flight req — may follow it on that connection.
- (c) **Exit code 0** (an orderly, agent-initiated displacement — not a protocol fault; the F16
  taxonomy's 1 stays reserved for protocol-fatal ends). `main.ts`'s process contract is
  UNCHANGED (the path is unreachable over single-connection stdio in v1).
- (d) **Best-effort delivery, total containment.** A throwing `send` while emitting the evt is
  diagnosed (bounded, CONV-001) and the connection still ends with code 0; the failure MUST NOT
  propagate into the store's `bind()` (the winner's grant proceeds), MUST NOT re-enter the
  send-failure death path (`onSendFailure`/`unbind` — the store already detached this
  connection), and MUST NOT surface as an unhandled rejection.
- (e) **After the revocation**, inbound frames on the loser's session are dropped by the existing
  `ended` guard: a post-revocation req yields NO res (consistent with every ended connection);
  a late `endOfInput` no-ops.

**Acceptance:** session-composed vectors: on a steal the loser's `sent` log ends with exactly one
`lease:revoked` evt (`args` deep-equal `[]`), `exits` equals `[0]`, and a req fed to the loser
afterwards produces no res; a loser whose `send` throws ON the evt → `exits` `[0]`, diagnostic
emitted, winner unaffected; the evt parses through F15's strict `parseWireMessage` (a
round-trip vector encodes and re-parses it); no `unhandledRejection` in any steal vector (the
suite's existing zero-tolerance harness pattern).

## REQ-005 — Flow-control preservation across a steal (the F17×F18 weld contract)

The steal path MUST route the loser through the SAME flow semantics as every other detach —
verified specifically under a steal, not merely inherited:

- (a) A pane paused by the LOSER's stall (unacked > window, backend `pause()`d) is `resume()`d
  during the steal, BEFORE any client is bound, so the flushed backlog feeds the replay terminal
  and is NOT delivered to either connection as frames (REQ-011-0019's "output continues while
  away" — a pane must never stay frozen because its previous holder died mid-flood).
- (b) The flow gate is reset: the WINNER starts a fresh connection-scoped window (default
  window, no per-pane overrides, zero unacked) — a loser-era residue could never be acked away
  by the winner (the weld's rejected-alternative rationale).
- (c) A backend whose `resume()` throws during the steal is contained per the existing detach
  contract (diagnosed; the steal completes; the winner binds).
- (d) Loser-era `ack`/`window` frames can never arrive post-steal through the protocol (the
  loser's connection is ended), and the winner's `ack`s apply to the fresh gate only.

**Acceptance:** flow vectors (spy backend recording `pause`/`resume`, scripted flood per the
0018 harness): drive pane `p` past the loser's window (backend paused), steal → exactly one
`resume` on `p` during the steal, the post-resume flush lands in replay (winner's later attach
snapshot contains it; neither connection got it as `pty:data`); winner floods the same pane →
pauses at the DEFAULT window (loser's per-pane `window` override forgotten), gate `stats`
fresh; a `resume`-throwing backend → diagnostic, winner bound and served.

## REQ-006 — In-flight attach work settles inert across a steal; no agent-side byte loss

A steal landing while the LOSER has attach work in flight MUST leave the winner's world
consistent (the concurrent-attach half of the roadmap's race clause):

- (a) A loser `pty:attach` whose snapshot barrier is pending at steal time settles WITHOUT a
  res (its connection ended — the existing ended-guard) and WITHOUT delivering its held bytes
  (the hold window belonged to the displaced generation — `bindGen`); its settlement MUST NOT
  disturb the winner's pane state (`holds`/`held` were reset by the steal; a stale release
  no-ops, the F18 generation contract now exercised via steal).
- (b) Bytes held for the loser's never-completed attach window are NOT lost agent-side: they fed
  the replay terminal at emission, so the WINNER's subsequent `pty:attach` snapshot contains
  them, and the winner's snapshot ⊕ its subsequent `pty:data` events ≡ the pane's full
  agent-side stream (F18's REQ-006(d) composition oracle, re-proven across a steal boundary).
- (c) The winner's OWN attach behavior is unaffected by loser-era leftovers: attach immediately
  after the grant works, opens a fresh hold window, and overlapping-attach rejection (one
  window per pane) applies within the winner's connection only.

**Acceptance:** the controlled-barrier harness from the frozen 0019 suite (test-controlled
snapshot factory): loser attaches `p` (barrier pending, bytes held) → steal → release the
barrier → loser got NO res and NO held bytes (its `sent` ends with the revocation evt); winner
attaches `p` with the REAL replay factory in a parallel vector → reference-oracle equality over
pre-steal + held + post-steal bytes (the byte-exact composition oracle); winner's attach-then-
attach overlap on one pane still rejects the second (`internal`) while a sequential re-attach
succeeds.

## REQ-007 — Deterministic race resolution: a total order of binds; the last bind holds

- (a) **Total order.** Binds are resolved strictly in arrival order (the store is
  single-threaded; "concurrent" means interleaved event dispatch): after any prefix of a
  scripted bind sequence, the holder is exactly the most recent binder. A steal CHAIN (A → B →
  C in one synchronous burst or spread across ticks) ends with C holding, A and B each having
  received exactly one `lease:revoked` evt, in their displacement order.
- (b) **Steal-back.** A displaced client's FRESH connection (new session over the same store)
  may bind again and steals per REQ-003 — reconnect-after-loss is just another attach (`tmux
  attach -d` symmetry). Nothing distinguishes clients beyond bind order (v1 has no client
  identity — disclosed boundary; F21 owns any identity/UX layering).
- (c) **Determinism.** Running the same scripted steal scenario twice yields byte-identical
  per-connection frame sequences (res ids, evt order, the revocation evt's position) — no
  wall-clock, RNG, or map-iteration dependence in any lease code path.

**Acceptance:** a chain vector (A→B→C, mixed same-tick and cross-tick binds, pane output
interleaved) asserting holder-at-every-step, one revocation evt each for A and B, C fully
served; a steal-back vector (A loses to B; A' — a fresh session — steals back; B gets the evt;
A' attaches and the snapshot equals the reference oracle); each vector executed twice with
deep-equal `sent`/`exits` logs across runs.

## REQ-008 — Vocabulary: the `lease:revoked` evt constant; closed sets stay closed

- (a) A new exported constant `AGENT_LEASE_REVOKED_EVT = 'lease:revoked' as const` DEFINED in
  `src/agent/session-api.ts` (the session-survival vocabulary home; the CONV-032 load-bearing
  two-door header already explains why definitions live agent-side) and RE-EXPORTED by
  `src/shared/remote-agent-api.ts` (the door F21's client imports). Both doors expose the SAME
  binding. The agent's emit site and the tests MUST reference the constant, never a re-typed
  literal (beyond the constant's own definition).
- (b) **No new methods** (`AGENT_SESSION_METHODS` stays EXACTLY `['pty:attach','pty:sessions']`
  — frozen TEST-1908 green unmodified; `session.ts`'s unknown-method message keeps enumerating
  exactly the six-method surface), **no new error codes** (`AGENT_ERROR_CODES` unmodified —
  frozen TEST-749), **no new frame types** (the notification rides the existing `evt` frame;
  F15's barrel and validator untouched — frozen TEST-747), and the evt channel string is
  disjoint from every `AGENT_PTY_METHODS`/`AGENT_SESSION_METHODS` member and from the local
  `CH` pty channel values (it is remote-only; there is no local lease concept).
- (c) `src/shared/remote-agent-api.ts` stays environment-pure and CH-derived (frozen TEST-750
  green unmodified — the new export adds no `pty:*` literal).

**Acceptance:** a vocabulary test pins `AGENT_LEASE_REVOKED_EVT === 'lease:revoked'`, its
disjointness from the pinned method arrays and from `Object.values(CH)`, and that BOTH doors
export the identical value; a structural scan asserts `'lease:revoked'` appears as a literal
ONLY in `src/agent/session-api.ts` (the definition site) across `src/`; the frozen TEST-749/
TEST-750/TEST-1908 suites pass unmodified.

## REQ-009 — Post-steal service correctness: the winner is a fully ordinary connection

After a steal, the winner MUST be indistinguishable from a fresh sequential reconnect (F18's
contract), pinned across the steal boundary:

- (a) `pty:sessions` answers with truthful `attached` flags: every surviving pane `false` until
  the winner spawns/adopts/attaches it (subscriptions never leak across a steal), cwd/status
  metadata reflecting output emitted while the loser held the lease and during the steal.
- (b) `pty:attach`/`pty:spawn`(adopt)/`pty:write`/`pty:resize`/`pty:kill` from the winner work
  immediately; a winner kill prunes store-wide (F16/F18 semantics unchanged).
- (c) The LOSER's user-visible outcome is exactly: its delivered pane stream stops (a prefix of
  the agent-side stream; no partial duplicates, nothing after the revocation evt), then
  `lease:revoked`, then connection end — the client-side state F21 will render as the
  disconnected banner. No mirrored window exists at any point (locked decision 5).

**Acceptance:** a full two-client scenario vector: A spawns `a`+`b`, attaches both, receives
data; B steals; B's inventory → both panes `attached: false`, post-steal cwd/status; B adopts
`a` (spawn → `true`, no history replay) and attaches `b` (snapshot = reference oracle over the
full stream); B writes/kills `a` → pruned for the store (B's next inventory omits it); A's
`sent` log: pane frames (a strict prefix of the stream), then exactly one `lease:revoked`,
then nothing.

## REQ-010 — Composition compatibility: owned composition and shipped artifact unchanged

- (a) The OWNED composition (`createAgentSession({ backend, homeDir })` — what `main.ts` ships)
  keeps F16/F18 behavior byte-compatible: its store is created inside the session and never
  shared, so a steal is unreachable; end-of-input still kills every live pane and exits 0.
  The `onLeaseRevoked` seam exists there but never fires. Every F16 frozen suite passes
  unmodified.
- (b) `main.ts`, `args.ts`, the CLI surface, `vite.agent.config.ts`, `package.json`
  dependencies, and the gate profile are NOT modified (frozen TEST-757/758 green; locked
  decision 10). The stdio artifact suites (roundtrip, attach, flow) pass unmodified.
- (c) v1 keeps ONE stdio connection per agent process: this feature adds no transport, no
  socket listener, no second-channel accept path. The lease's multi-connection reality is
  proven in-process over the survival composition — the seam F19/F21 wire later (their
  transport work will make steals reachable end-to-end; the batch-6 integration phase proves
  the composed story).

**Acceptance:** `npm run build` + `npm test` green (gate tokens); the frozen stdio suites and
TEST-757/758 pass unmodified; review confirms no diff outside REQ-001's file list.

## REQ-011 — Sanctioned frozen-suite amendments (the mandatory weld housekeeping)

Exactly TWO amendments to frozen test files, both through this feature's tests phase,
atomically, with freezes re-captured (CONV-019's retirement path; the suite headers/comments
name this feature as the sanctioned actor):

- (a) **The three TS2739 stubs**: add `pause`/`resume` NO-OPS to the stub `AgentPtyHandle`
  literals at `tests/agent-attach-sessions.test.ts` (~line 240, the inline
  exit-during-barrier stub), `tests/agent-session-store.test.ts` (~line 41, `mkStub`), and
  `tests/agent-survival.test.ts` (~line 40, `mkStub`) — after which `npm run typecheck` exits 0
  (it is red TODAY on exactly those three TS2739 errors and nothing else). No assertion or
  semantic change; `npm test` stays green throughout. (Where a steal vector needs pause/resume
  OBSERVATION, this feature's OWN new suite uses its own recording stubs — the frozen stubs
  get inert no-ops only.)
- (b) **The TEST-1905 bind-guard case**: the frozen case "binding while another connection is
  bound throws, naming the F20 retirement" (`expect(() => establish(b)).toThrow(/F20/)`) pins
  the exact behavior this feature retires. Amend that ONE case to pin the replacement
  observable (a second establishment succeeds; the first connection's `sent` ends with the
  revocation evt and it exits 0) or replace it with a pointer to this feature's suite — the
  amendment MUST be annotated in-file as a 0021 sanctioned amendment (the file header's FROZEN
  provenance note is extended, not removed). Every OTHER case in that file — and every other
  frozen suite — stays byte-identical.

**Acceptance:** `npm run typecheck` exits 0 (from red at scaffold time — the delta is exactly
the three stub fixes); `npm test` green; the tests-phase RED verification (CONV-059) enumerates
the failing set as exactly this feature's own new suite(s) BEFORE implementation (the two
amendments themselves keep the amended files green — (a) is type-only; (b)'s amended case is
allowed to be RED until the steal semantics land, and its red is part of the enumerated set);
diff review: no other frozen file touched.

## REQ-012 — Documentation

`docs/features/remote-agent.md` MUST gain an "Exclusive attach lease (F20 /
0021-exclusive-attach-lease)" section documenting: the lease model (one holder; grant at
establishment; release on every end path; steal on bind-while-bound — `tmux attach -d`
semantics, no mirrored attach); the `lease:revoked` evt (channel constant, `args: []`, the
loser's final frame, exit-0 end, F21 renders the banner); the flow-control weld preservation
(loser resumed into replay, winner's fresh window); the determinism story (total bind order,
exactly one holder, steal-back); and that the shipped stdio artifact is unaffected (one
connection per process — transport arrives with F19/F21 wiring). The existing survival
section's sentence documenting the single-connection throw guard MUST be updated to the lease
semantics (the 0019 docs test's literals — `pty:attach`, `pty:sessions`,
`HISTORY_LIMIT_DEFAULT`, `2000`, `history-limit`, `transit`, `F20`, `snapshot` — all remain
satisfied). The CLAUDE.md/CHANGELOG rows are doc-sync's edits and deliberately NOT test-pinned
(CONV-012/CONV-022).

**Acceptance:** a docs test (`tests/docs-feature-0021.test.ts`) asserts the file contains the
load-bearing literals: `lease:revoked`, `attach -d`, `steal` (case-insensitive), `exactly one`,
`lease` — existence + key claims only, doc-sync latitude retained; the 0019 docs test passes
unmodified.

---

## Public interface

Additions/changes to the agent's process/wire contract (everything else unchanged):

- **Wire:** ONE new push event — `{ type: 'evt', channel: 'lease:revoked', args: [] }` — sent
  exactly once to a displaced connection as its final frame. No new methods, no new frame
  types, no new error codes, capabilities unchanged (`['pty','status']`).
- **Shared vocabulary** (`src/shared/remote-agent-api.ts`): `AGENT_LEASE_REVOKED_EVT`
  (re-exported from `src/agent/session-api.ts` — the two-door pattern).
- **Agent library surface** (in-repo composition seam):
  - `BoundClient` gains required `onLeaseRevoked(): void`.
  - `AgentSessionStore.bind(client)` no longer throws when bound — it steals (displace,
    notify, grant; synchronous). `unbind()` release becomes holder-safe per REQ-002(c).
  - `createAgentSession` (unchanged signature): its bound-client wiring implements the
    revocation handler (evt + exit-0 end); the displaced session never re-releases the store.
- **Executable behavior:** `out/agent/termhalla-agent.cjs` unchanged (flags, lifecycle, exit
  codes; single stdio connection — steals unreachable in the shipped v1 artifact).

## Non-goals (explicit)

- **No mirrored/shared attach** (locked decision 5 — deferred out of v1 by the roadmap).
- **No UI, no banner, no renderer/main/preload wiring, no client routing** — F21 consumes
  `lease:revoked`; TEST-746 survives unchanged; no `SCHEMA_VERSION` bump.
- **No transport work**: no second OS-level channel, no socket listener, no daemonization/
  supervision (open question 1 stays open), no `src/remote-client/` changes (F19's tree holds
  connection plumbing only; F21 wires both).
- **No client identity / lease ownership tokens / priorities** — v1 lease holdership is bind
  order alone (disclosed boundary; any identity layering is F21+).
- **No flow-control semantic changes** beyond routing the loser through the existing unbind
  contract; `flow-control.ts` is not modified.
- **No new frame types, no F15 barrel extension, no new agent error codes, no dependency or
  build/profile changes.**
- **No session GC / reboot survival** (recorded open questions); **no window-manager transit
  buffer reuse** (locked decision 3's standing exclusion — nothing here buffers events for a
  future connection; the revocation evt is constructed only for a live, bound-until-now
  connection).

## Open questions

None requiring escalation. Two spec-level derivations are documented rather than re-opened:
(1) the displaced connection is ENDED (exit 0) rather than left alive-but-detached — a live
unbound connection could still write to panes through the store (a mirrored-attach hole
decision 5 forbids) and would leave TWO peers believing they hold the workspace; ending it is
the deterministic "exactly one holder" resolution and matches "drops that workspace to a
disconnected state" (F21's banner is client-side rendering of that end). (2) The revocation
evt carries `args: []` (no payload) — the evt's existence on THIS connection is the entire
message; any richer payload (who stole, when) would invent client identity v1 does not have
(disclosed above; F21 can extend via a NEW constant if its UX needs it).
