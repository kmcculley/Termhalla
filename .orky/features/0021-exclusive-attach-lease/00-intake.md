# Intake — 0021-exclusive-attach-lease

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F20 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F20
- **slug:** 0021-exclusive-attach-lease
- **title:** Exclusive attach via agent-side lease
- **controls:** [] (none assigned)
- **deps:** [F18] (batch 4 — everything upstream is MERGED on this branch's base: F15 protocol
  (`src/shared/remote/`), F16 agent runtime (`src/agent/`), F17 flow control
  (`src/shared/remote/flow-control.ts` + the session-store `deliverData` funnel), F18 replay/survival
  (`src/agent/session-store.ts`, `replay.ts`, `session-api.ts` — `pty:attach` + `pty:sessions`),
  F19 remote client (`src/remote-client/`). Build on them, do not re-derive.)

### Summary (verbatim, from the app-run dispatch)

> tmux attach -d semantics (locked decision 5): attaching a session STEALS it via an agent-side
> lease; the agent notifies the previously-attached client, which drops that workspace to a
> disconnected state (F21 renders the banner). No mirrored/shared attach in v1. Lease
> grant/steal/release rides F18's session inventory and reattach/replay path; the concurrent-attach
> steal race must resolve deterministically (exactly one holder). Stack: TypeScript/Node; already
> merged on main — F15 protocol (src/shared/remote/), F16 agent runtime (src/agent/), F17 flow
> control (src/shared/remote/flow-control.ts + session-store deliverData funnel), F18 replay/survival
> (src/agent/session-store.ts, replay.ts, session-api.ts — pty:attach + pty:sessions), F19 remote
> client (src/remote-client/). Build on them, do not re-derive. Unit tests via vitest in tests/, TDD
> per repo CLAUDE.md. CRITICAL CONTEXT FROM THE F17xF18 BATCH WELD (see
> docs/superpowers/0018-windowed-flow-control-review-followups.md, section 'Added at the F17xF18
> batch weld'): (1) F18's session-store single-connection bind guard was explicitly named as THIS
> feature's retirement target — the lease replaces it; (2) flow accounting is connection-scoped
> across detach/reattach (unbind() resumes gate-paused backends then resets the gate; a reattaching
> client starts a fresh window) — the lease steal path MUST preserve those unbind semantics for the
> loser; (3) MANDATORY tests-phase housekeeping item routed to this feature: npm run typecheck is
> red on three frozen 0019 test stubs missing pause/resume (tests/agent-attach-sessions.test.ts:240,
> tests/agent-session-store.test.ts:41, tests/agent-survival.test.ts:40 — TS2739 vs the widened
> AgentPtyHandle); this feature's tests phase is the sanctioned actor to add pause/resume no-ops to
> those three stubs and re-freeze (runtime/vitest unaffected, build+test green; only tsc sees it).

## Role in the app

Batch 4 of the Remote Agent v1 epic — the single feature between the parallel batch-3 trio
(F17 ∥ F18 ∥ F19, all merged) and the F21 UX capstone. F20 owns the EXCLUSIVITY rule: at most one
client holds an agent's live session set at a time, and a newer attach wins (`tmux attach -d`
semantics — locked decision 5, "No mirrored attach"). F21 (client routing + remote-workspace UX)
is the consumer that surfaces the loser's displacement as a disconnected-workspace banner; the
batch-6 integration phase proves "lease steal drops the losing client's workspace to disconnected"
over the stdio loopback.

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

5. **Exclusive attach v1**: attaching steals the session via an agent-side lease; the loser drops
   to a disconnected banner (`tmux attach -d` semantics). **No mirrored attach** (multiple clients
   viewing one session is explicitly deferred out of v1).
3. Reconnect/replay = agent-side `@xterm/headless` + serialize snapshot on attach (F18 — LANDED).
   The lease rides that reattach path; the window-manager transit buffer stays the wrong tool and
   is not imported.
4. Windowed flow control from day one (F17 — LANDED). Lease steal interacts with it ONLY through
   the existing `unbind()` semantics (see the weld context below).
1. Transport = stdio exec channel over SYSTEM ssh; one stdio connection per agent PROCESS in the
   shipped artifact. Multi-connection scenarios are proven in-process over the survival composition
   (`createAgentSession({ sessions: store })`) exactly as F18's frozen suites already do — no real
   ssh, no second OS transport, anywhere in tests.
7. Per-workspace home / one connection per workspace — F21's wiring; F20 stays agent-side.
9. Agent platform v1 = Linux only; tests platform-neutral (CI is windows-latest, `--pty=fake` /
   injected stubs).
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`) keeps
    building/testing everything; the profile file itself does not change (frozen TEST-757 pins it).
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code stays pure
    `src/shared/`; characterization tests stay green; local-only behavior unchanged when no remote
    workspace exists (no renderer/main/preload wiring in this feature).

## Critical context from the F17×F18 batch weld (routed to THIS feature; mandatory)

From `docs/superpowers/0018-windowed-flow-control-review-followups.md` § "Added at the F17×F18
batch weld (2026-07-04)":

1. **The single-connection bind guard is THIS feature's retirement target.**
   `src/agent/session-store.ts` `bind()` currently throws when already bound, with a message
   naming F20; `session.ts` calls `store.bind(...)` at handshake establishment with the comment
   "F20 retires it with lease semantics". The frozen case
   `tests/agent-session-store.test.ts` TEST-1905 "binding while another connection is bound
   throws, naming the F20 retirement" (`expect(() => establish(b)).toThrow(/F20/)`) is the pinned
   behavior being retired — CONV-019's retirement path: this feature's tests phase amends that
   frozen case atomically and re-freezes.
2. **The lease steal path MUST preserve `unbind()` semantics for the loser.** Flow accounting is
   connection-scoped across detach/reattach: `unbindInternal()` resumes any gate-paused backends
   FIRST (with `bound` already null, so the flushed backlog feeds the replay terminal — REQ-011
   "output continues while away"), then disposes + recreates the flow gate (fresh window for the
   next client), bumps `bindGen` (generation-scopes in-flight attach hold windows), and clears
   `subscribed`/`holds`/`held` on every pane. A steal displacing the loser must route through
   exactly these semantics; the persist-counters alternative was already rejected on evidence
   (documented in `docs/features/remote-agent.md` § Flow control).
3. **Mandatory tests-phase housekeeping:** `npm run typecheck` is red (verified at scaffold time)
   on exactly three frozen 0019 stub handles missing `pause`/`resume` (TS2739 vs the 0018-widened
   `AgentPtyHandle`): `tests/agent-attach-sessions.test.ts:240` (inline stub in the
   exit-during-barrier case), `tests/agent-session-store.test.ts:41` (`mkStub`),
   `tests/agent-survival.test.ts:40` (`mkStub`). This feature's tests phase is the sanctioned
   actor: add `pause`/`resume` no-ops to the three stubs and re-freeze (runtime/vitest unaffected —
   build + `npm test` are green today; only tsc sees it).

## Pre-existing structural anchors (read at scaffold time; the spec must honor them)

- **The bind seam** (`src/agent/session-store.ts`): `bound: BoundClient | null` is the single
  connection slot; `BoundClient = { send(frame), onSendFailure(error) }` is what a connection
  registers at bind time. `deliver()` treats a throwing `send` as a connection death (unbind
  FIRST, then `onSendFailure`). `session.ts` binds at handshake establishment ("Bind BEFORE
  flipping established") and every connection-end path funnels through `end()` → owned
  `store.destroy()` / external `store.unbind()` → `init.shutdown(code)`. Exit codes: 0 clean,
  1 protocol-fatal, 2 usage (`main.ts`; a displaced loser's code is the spec's call — the stdio
  artifact never sees a second connection in v1, so the taxonomy is exercised in-process).
- **Notification vocabulary constraints.** The wire envelope is CLOSED
  (`hello|req|res|evt|ack|window` — F15; no new frame types): a lease-lost notification rides an
  `evt` frame with a NEW channel string, and/or new method strings ride `req`/`res`. Frozen pins:
  TEST-749 (`AGENT_ERROR_CODES` EXACTLY the closed five; `AGENT_PTY_METHODS` EXACTLY the four CH
  pty values), TEST-1908 (`AGENT_SESSION_METHODS` EXACTLY `['pty:attach','pty:sessions']`, sorted,
  disjoint from the pty four; unknown-method messages enumerate the implemented surface —
  `session.ts`'s default-case message must be extended if the surface grows), TEST-750
  (`src/shared/remote-agent-api.ts` stays environment-pure, CH-derived, no hand-typed
  `pty:spawn|write|resize|kill` literals — OTHER literals are fine). New remote-only strings need a
  NEW constant (never extend a pinned array) DEFINED under `src/agent/` and re-exported by
  `src/shared/remote-agent-api.ts` — the two-door pattern of `error-codes.ts`/`session-api.ts`
  (frozen TEST-752 reserves `shared/remote`-containing specifiers inside `src/agent/` for the F15
  barrel; the module-header comment carrying this rationale is load-bearing, CONV-032).
- **F15 barrel is closed** (TEST-747 pins its export surface exactly — do NOT extend
  `@shared/remote/protocol`); TEST-745 (`src/shared/remote/` environment-pure); TEST-746 (NO file
  under `src/main/`, `src/preload/`, `src/renderer/` imports `shared/remote` — F20 touches none of
  those trees; the guard survives unchanged; its header names F21 as the retiring feature).
- **Attach machinery the lease rides** (`session-store.ts`): per-pane `subscribed` flags scope
  event routing to panes the bound connection spawned/adopted/attached during ITS life;
  `pty:attach` opens a hold window synchronously with the req dispatch (snapshot ⊕ held ≡ stream,
  REQ-006d), `bindGen` generation-scopes stale settlements after unbind, overlapping attaches on
  one pane are rejected (`internal`), exit-during-attach flushes held bytes before final
  status/exit. `pty:sessions` reports `attached` = "the ASKING connection is subscribed"
  (TEST-1907 pins truthful attached flags ACROSS connections). The exactly-one-res dispatch and
  the async attach continuation (res first, then `drain()` in the same continuation, FINDING-007
  release-even-on-throwing-send) live in `session.ts`.
- **Determinism reality:** the store is single-threaded JS — "concurrent" attach/bind races are
  event-ordering races (interleaved `onItem` feeds, snapshot barriers in flight across a steal),
  not thread races. Deterministic resolution = a total order of bind events with exactly one
  holder at every instant, stale in-flight work from a displaced connection settling inert
  (`bindGen` is the existing tool), and both sides observing a consistent outcome.
- **F16 composition compatibility:** `createAgentSession({ backend, homeDir })` (what `main.ts`
  ships) creates an OWNED store per connection — a steal can never occur there (one connection per
  process); F16's frozen suites (TEST-751..758, TEST-766, TEST-773 semantics via 0018/0019
  amendments) must stay green unmodified. The survival composition (`{ sessions: store }`) is
  where lease semantics live and are tested.
- **Replay/structure pins:** TEST-1910 (`@xterm/headless`/serialize confined to
  `src/agent/replay.ts`; version-locked pair). The replay layer is untouched by F20 (the lease
  changes WHO receives frames, never what feeds replay/status).
- **CI reality** (`.github/workflows/ci.yml`): `npm ci` → `npm run typecheck` → `npm test`,
  windows-latest / Node 22, no real node-pty loadable — lease tests run in-process against
  injected stub backends / the fake backend, exactly like the F18 suites. NOTE typecheck is red
  TODAY (weld item 3) — this feature's tests phase turns it green.
- **F19's remote client** (`src/remote-client/` — agents-store, bootstrap, classify, ssh-command,
  ssh-spawn) is merged but is NOT this feature's surface: it provisions + spawns agents; it holds
  no attach/lease logic. F21 wires both.

## Explicit non-goals (from the roadmap)

- No mirrored/shared attach (multiple clients viewing one session) — deferred out of v1 by locked
  decision 5.
- No renderer/main/preload wiring, no UI, no disconnected-state banner — F21 renders the banner;
  F20 only guarantees the loser learns it was displaced. TEST-746 survives unchanged; no
  `SCHEMA_VERSION` bump.
- No transport/tunnel/supervision work: no second OS-level connection path, no socket listeners,
  no agent daemonization (recorded open question 1 stays open). Multi-connection is exercised
  in-process over the survival composition only.
- No new frame types, no F15 barrel extension, no new agent error codes unless a pinned list is
  amended through the tests phase (prefer reusing the closed five).
- No client-side lease bookkeeping beyond what F21 needs to consume the notification (F20 is
  agent-side; `src/remote-client/` stays connection-plumbing only).
- No session GC / reboot survival (recorded open questions); no flow-control semantic changes
  beyond routing the loser through the existing `unbind()`.
- No window-manager transit buffer reuse (locked decision 3's standing exclusion).
