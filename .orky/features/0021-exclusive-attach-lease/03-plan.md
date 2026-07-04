# Plan — 0021-exclusive-attach-lease

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-012), the merged F15–F19 trees.
Brownfield fit: a surgical semantics change at ONE seam (`session-store.bind()`) plus its
connection-side consequence (`session.ts` revocation handler) and one additive vocabulary
constant. No new runtime module; no dependency change; touch NOTHING under
`src/main|preload|renderer`; the entire lease story runs in-process under vitest over the
survival composition (the F18 harness).

**Router note:** planner dispatched at tier low (sonnet/medium) per router; this driver
environment has no parallel agent-dispatch tool, so the producer ran driver-inline
(0016/0017/0019/0020 precedent).

## Target layout

```
src/agent/
  session-api.ts        EDIT (additive)  AGENT_LEASE_REVOKED_EVT = 'lease:revoked' as const
                                         (definition door; CONV-032 header already explains why)
  session-store.ts      EDIT  bind() steals instead of throwing (displace → notify → grant);
                              BoundClient gains required onLeaseRevoked(); header prose updated
                              (the CONV-019 guard text goes away)
  session.ts            EDIT  the bound-client wiring implements onLeaseRevoked (send the evt,
                              end(0), skip the store release via a `revoked` flag); the bind-site
                              "F20 retires it" comment updated
src/shared/remote-agent-api.ts  EDIT (additive)  re-export AGENT_LEASE_REVOKED_EVT (second door)
docs/features/remote-agent.md   EDIT  "Exclusive attach lease" section + the survival section's
                                      single-connection sentence updated to lease semantics
```

Unchanged (load-bearing): `main.ts`, `args.ts`, `validate.ts`, `pty-backend.ts`,
`fake-backend.ts`, `node-pty-backend.ts`, `error-codes.ts`, `version.ts`, `replay.ts`,
`vite.agent.config.ts`, `package.json`, `tsconfig*`, `.orky/profiles/node-app.json`, everything
under `src/shared/remote/`, `src/remote-client/`, `src/main/`, `src/preload/`, `src/renderer/`.
Frozen suites pass unmodified EXCEPT the two REQ-011 tests-phase amendments (three TS2739 stub
no-ops; the one TEST-1905 bind-guard case).

## Core design

### session-store.ts (REQ-002, REQ-003, REQ-005, REQ-006, REQ-007 mechanics)

`BoundClient` gains `onLeaseRevoked(): void` (required — the only construction site is
`session.ts`; the frozen suites never build one directly, verified at plan time).

`bind(client)` becomes the lease verb (replacing the throw):

```ts
bind(client: BoundClient): void {
  const incumbent = bound
  if (incumbent) {
    unbindInternal()                     // (a) full weld semantics, bound === null inside:
                                         //     paused backends resumed into replay only, gate
                                         //     disposed+recreated, bindGen++, subscriptions/
                                         //     holds/held cleared
    try { incumbent.onLeaseRevoked() }   // (b) the loser learns it AFTER it can no longer
    catch (e) { diag(...) }              //     receive routed frames; throw contained
  }
  bound = client                         // (c) grant — the newer attach always wins
}
```

- Uniform and identity-blind: no special-casing of the incumbent (a raw-store self-rebind
  displaces-then-regrants — pinned degenerate, unreachable through `createAgentSession`).
- The destroyed-store early-return is FOLDED into the same shape (displace-if-incumbent, then
  `bound = client`; `unbindInternal()` is harmless on an empty destroyed store) — destroyed
  stores keep answering empty inventories, no throw anywhere.
- NOTHING else in the store changes: `unbind()` stays the voluntary release (unconditional —
  holder-safety is enforced at the session layer, see below, because only the session knows
  whether ITS release is stale); `deliver`/`routeData`/`attach`/`list`/flow paths untouched.
  Between (a) and (c) `bound === null`, so any synchronously-flushed backend backlog feeds the
  replay terminal only — REQ-003(c)'s "routes to nobody".
- Header prose: the "v1 is single-connection … F20 retires this guard (CONV-019)" paragraph is
  replaced by the lease contract summary (exactly one holder; steal order; holder-scoped
  release via the session's revoked flag).

### session.ts (REQ-004, REQ-002c, REQ-009, REQ-010a)

The bound-client wiring gains the handler; `end()` gains the holder-safe skip:

```ts
let revoked = false
store.bind({
  send:          (frame) => { if (!ended) init.send(frame) },        // unchanged
  onSendFailure: (e)     => { ...end(1) },                            // unchanged
  onLeaseRevoked: () => {
    if (ended) return                    // an already-dead connection needs no notification
    revoked = true                       // set BEFORE end(): this connection no longer holds
    try { init.send({ type: 'evt', channel: AGENT_LEASE_REVOKED_EVT, args: [] }) }
    catch (e) { init.diag(`lease revoked notification failed: ${bounded(e)} - ending anyway`) }
    end(0)                               // orderly displacement — never re-enters the store
  }
})
```

```ts
const end = (code: number): void => {
  if (ended) return
  ended = true
  if (owned) store.destroy()
  else if (!revoked) store.unbind()      // REQ-002(c): the store already detached a displaced
                                         // connection — a stale release must never touch the
                                         // winner's binding
  init.shutdown(code)
}
```

- Every loser end path funnels through `end()`; `revoked` guarantees no displaced connection
  ever calls `store.unbind()` — the chosen REQ-002(c) mechanism (the spec allows either seam;
  the session-side flag needs no store identity plumbing and keeps `unbind()`'s frozen-suite
  surface byte-stable).
- The evt is constructed HERE (the store signals; the session frames) — consistent with the
  session owning connection-lifecycle framing (hello, res) while the store owns pane framing.
  `AGENT_LEASE_REVOKED_EVT` is imported from `./session-api` (the agent-side door — TEST-752
  keeps `shared/remote`-specifiers reserved for the F15 barrel).
- A throwing `init.send` on the evt: caught + diagnosed, `end(0)` still runs, nothing
  re-enters `onSendFailure`/store paths (REQ-004d). The `ended` guard then silences every
  later inbound frame (post-revocation reqs get no res — REQ-004e) and every later end path
  (late EOF no-ops).
- The owned composition wires the SAME client shape; `onLeaseRevoked` is unreachable there
  (the owned store is never shared — REQ-010a) but present, so one code path serves both.
- The establishment-site comment ("F20 retires it with lease semantics") is updated to state
  the lease behavior ("binding while another connection is bound displaces it — see
  session-store.ts").

### session-api.ts + remote-agent-api.ts (REQ-008)

```ts
// session-api.ts (definition door; the module header's two-door rationale already covers it)
/** The lease-revocation push channel (F20/0021): sent to a displaced connection as its FINAL
 *  frame — `{ type: 'evt', channel: AGENT_LEASE_REVOKED_EVT, args: [] }`; the connection then
 *  ends (exit 0). Remote-only: no local CH channel exists for it. */
export const AGENT_LEASE_REVOKED_EVT = 'lease:revoked' as const
```

`remote-agent-api.ts` re-exports it beside `AGENT_SESSION_METHODS` (additive; TEST-749/750
untouched — no `pty:*` literal added; the module stays environment-pure). The literal
`'lease:revoked'` exists ONLY at the definition site across `src/` (structural scan in the
tests phase); `session.ts` and the suites reference the constant.

## Tasks

### TASK-001 — Vocabulary constant, both doors
**Files:** `src/agent/session-api.ts`, `src/shared/remote-agent-api.ts`. **Deps:** none.
**REQs:** REQ-008 (constant + disjointness + purity), feeds REQ-004 (the emit site imports it).
Additive exports exactly as designed; pinned arrays byte-unchanged.

### TASK-002 — Store lease semantics (the steal)
**Files:** `src/agent/session-store.ts`. **Deps:** TASK-001 (none at runtime — the store never
frames the evt; ordering only). **REQs:** REQ-002(a)(b) (grant/release model), REQ-003 (steal
order, identity-blind, contained callback, destroyed-store uniformity), REQ-005 (weld
preservation — by ROUTING the steal through the existing `unbindInternal()`), REQ-006
(in-flight inertness — by REUSING `bindGen`/holds reset; no new mechanism), REQ-007 mechanics
(total order falls out of single-threaded synchronous bind), REQ-001.
`BoundClient.onLeaseRevoked` added; the guard throw removed; header prose updated. NO other
store behavior changes (the diff should read as: interface +1 member, bind() body swap,
comments).

### TASK-003 — Session revocation handler + holder-safe release
**Files:** `src/agent/session.ts`. **Deps:** TASK-001, TASK-002. **REQs:** REQ-004 (evt final
frame, exit 0, best-effort containment, ended-guard consequences), REQ-002(c) (the `revoked`
flag skip), REQ-009 (the winner is an ordinary connection — no session-side special state for
it), REQ-010(a) (owned composition wires the same shape, unreachable), REQ-001.
As designed above; `end()` signature/callers unchanged.

### TASK-004 — Feature doc section
**Files:** `docs/features/remote-agent.md`. **Deps:** TASK-001..003 (documents them).
**REQs:** REQ-012.
Additive lease section per the REQ's content list + the survival-section sentence update
(keep every 0019 docs-test literal present). CLAUDE.md/CHANGELOG rows = doc-sync.

### TASK-005 — Sanctioned frozen-suite amendments (executed in phase 4, planned here for
traceability)
**Files:** `tests/agent-attach-sessions.test.ts` (~240), `tests/agent-session-store.test.ts`
(~41), `tests/agent-survival.test.ts` (~40) — pause/resume no-ops; `tests/
agent-session-store.test.ts` TEST-1905 bind-guard case — amended to the lease observable with
an in-file 0021 annotation. **Deps:** none (type-only + one case). **REQs:** REQ-011, REQ-010(b)
(everything else stays frozen-green), REQ-001.
`npm run typecheck` goes red→green on exactly the three TS2739s; freezes re-captured at the
tests gate.

## Order

TASK-001 → TASK-002 → TASK-003 → TASK-004; TASK-005 rides the tests phase (its file edits are
tests-phase work by definition). Phase 4 authors the new suites against this layout:

- `tests/agent-lease.test.ts` — the feature suite (REQ-002/003/004/005/006/007/009 vectors on
  the F18 harness: mkStub backend + fake replay factory for routing/flow vectors; the REAL
  replay + reference-terminal oracle for the byte-exactness vectors; the controlled-barrier
  factory for in-flight-attach vectors; every steal vector run twice for determinism).
- `tests/agent-lease-vocab.test.ts` — REQ-008 pins (constant value, disjointness, two doors
  identical, definition-site confinement scan) — or folded into the lease suite as a describe.
- `tests/docs-feature-0021.test.ts` — REQ-012 literals.
- TASK-005's amendments in the frozen files.

## Risks / notes

- **The one genuinely subtle ordering** is (a)-detach BEFORE (b)-notify inside `bind()`: the
  loser's handler runs `end(0)` SYNCHRONOUSLY inside the store's bind call — with the store
  already detached and `revoked` set, that reentrancy touches no store state (end skips
  release). Keep the handler free of any other store call (it has no store reference — the
  wiring closure only sees `init`).
- **Fake-backend resume flush during the steal** delivers queued output synchronously inside
  `unbindInternal()` → `routeData` sees `bound === null` → replay only. This is exactly
  today's detach behavior; the steal vectors pin it explicitly (REQ-005a).
- **TEST-1905 amendment scope discipline**: ONE case changes; the file's other cases and its
  FROZEN header stay; the header gains the 0021 amendment note (0018's TEST-773 retirement
  precedent).
- **CONV-059** (tests-phase RED enumeration): the enumerated red set must be exactly
  `tests/agent-lease*.test.ts` + `tests/docs-feature-0021.test.ts` + the amended TEST-1905
  case; the three stub no-ops are type-only and keep their suites green.
- **No F21 leakage**: resist adding client-side lease handling to `src/remote-client/` or a
  reason payload to the evt — `args: []` is the spec'd shape (spec Open questions (2)).
- **Batch context**: F20 runs alone in batch 4 off a base where F15–F19 are merged; no
  parallel-sibling merge hazards this time, but keep edits surgical anyway (the diff-shape
  notes in TASK-002/003) so the post-merge re-gate stays clean.
