# Intake — 0018-windowed-flow-control

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F17 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F17
- **slug:** 0018-windowed-flow-control
- **title:** Windowed flow control (protocol-level backpressure)
- **controls:** [] (none assigned)
- **deps:** [F16] (batch 3 — F16 / 0017-agent-runtime-skeleton is merged on this branch)

### Summary (verbatim)

> Day-one, protocol-level backpressure (locked decision 4 — the cat-a-huge-file problem, not an
> afterthought): the client acks pty output every N KB; the agent calls node-pty pause() when
> unacked bytes exceed the window and resume() when drained, so agent memory stays bounded under
> an output flood even with a slow or stalled client. Implements the semantics over F15's
> ack/window frames in F16's agent + client; tested with a scripted flood and a deliberately
> stalled consumer. Stack: TypeScript/Node. Already merged on main — F15 protocol layer at
> src/shared/remote/ and F16 agent runtime at src/agent/ (session.ts, pty-backend.ts +
> node-pty/fake backends, stdio main.ts, folded into npm run build/test). Build on them, do not
> re-derive. Unit tests via vitest in tests/, TDD per repo CLAUDE.md.

## Role in the app

Batch 3 of the Remote Agent v1 epic. F15 (protocol core) reserved the `ack`/`window` frame SHAPES
and validates/round-trips them inertly; F16 (agent runtime) receives them and deliberately does
nothing (`session.ts`'s inert `case 'ack': case 'window':` branch, pinned by TEST-773 with an
explicit retirement path naming THIS feature). F17 supplies the semantics on both sides of the
wire: agent-side accounting + backend pause/resume, and the client-side ack policy the eventual
F21 client routing will consume. F18 (replay + session survival) and downstream features assume
flow control already exists — it is a day-one property, not an afterthought (locked decision 4).

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

4. **Day-one, protocol-level windowed flow control** — the cat-a-huge-file problem is solved at
   the protocol level, not deferred: client acks output every N KB; agent pauses the pty when
   unacked bytes exceed the window and resumes when drained; agent memory stays bounded under an
   output flood even with a slow or stalled client.
1. Transport = stdio exec channel over SYSTEM ssh; CI/e2e spawns the agent as a plain local child
   process over the IDENTICAL protocol path — no real ssh anywhere in CI.
9. Agent platform v1 = **Linux only** for the real node-pty backend; design POSIX-portable. CI
   exercises the identical protocol path via the deterministic fake backend (`--pty=fake`).
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`)
    already builds and tests the agent (folded by F16); F17's code and tests ride those same
    scripts — the profile file itself does not change.
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code stays pure
    `src/shared/`; characterization tests stay green; local-only behavior unchanged when no
    remote workspace exists.

## Pre-existing structural anchors (read at scaffold time; the spec must honor them)

- **F15 frame shapes are already on the wire and MUST NOT change.** `AckFrame` =
  `{ type: 'ack', id: string, bytes: positive integer }` — "the client acknowledges `bytes` of pty
  output for pane `id`". `WindowFrame` = `{ type: 'window', size: positive integer, id?: string }`
  — "the unacked-byte window; `id` absent = connection-wide default"
  (`src/shared/remote/messages.ts`; shapes + validation pinned by the frozen
  `tests/remote-protocol-messages.test.ts`). F17 gives these frames semantics over the existing
  shapes.
- **TEST-773** (`tests/agent-session.test.ts`) pins ack/window INERTNESS in the agent session,
  with a SCOPE-GUARD RETIREMENT PATH (CONV-019) naming F17: this feature "gives these frames
  semantics and MUST retire/supersede these assertions through its own tests phase — never
  silently during implementation."
- **TEST-747** (`tests/remote-protocol-capabilities.test.ts`) pins the runtime export surface of
  `@shared/remote/protocol` to exactly F15's public interface; its stated purpose is to make "a
  premature flow-control semantics API — that is F17's" mechanically visible. If F17 adds a pure
  client-side flow-control module under `src/shared/remote/` exported via the barrel, TEST-747's
  export list must be superseded through F17's tests phase (same CONV-019 discipline), never
  silently.
- **TEST-745** (`tests/remote-protocol-guards.test.ts`): every module under `src/shared/remote/`
  must stay environment-pure — no `node:` imports, no `electron`, no `require()`, no `Buffer`, no
  `process.`, no `__dirname`. Any shared byte-count measure must respect this (e.g. `TextEncoder`
  or code-unit counting — the spec must pin ONE measure used identically by both sides).
- **TEST-746** (`tests/remote-protocol-guards.test.ts`): no file under `src/main/`, `src/preload/`,
  or `src/renderer/` imports `shared/remote`. This guard SURVIVES F17 unchanged — the client-side
  ack policy ships as a pure module with no production consumer until F21 retires the guard.
- **F16 agent seams** (`src/agent/`): `AgentPtyHandle` (`pty-backend.ts`) currently exposes
  `write/resize/kill/onData/onExit` — NO pause/resume. The real backend's `NodePtyProc` structural
  mirror (`node-pty-backend.ts`) must widen to node-pty's `pause()`/`resume()`; the deterministic
  fake backend (`fake-backend.ts`, closure-based handles, synchronous ordered emission, buffered
  until callbacks attach) needs deterministic pause/resume semantics so CI exercises the identical
  protocol path. `session.ts` emits `pty:data` evts inside `handle.onData` — outbound byte
  accounting hooks there; the inert `case 'ack': case 'window':` branch is where inbound semantics
  land. The session is fully IO-injected and unit-testable in-process.
- **The stdio integration harness** (`tests/agent-stdio-roundtrip.test.ts`) bundles the agent ON
  DEMAND via `vite.agent.config.ts` (scratch outDir — `npm test` never depends on a prior
  `npm run build`), spawns the artifact under plain Node with `--pty=fake`, and drives it with
  F15's own client machinery over stdio. This is the established pattern for the scripted-flood
  and stalled-consumer integration proofs. CI (`.github/workflows/ci.yml`) runs
  `npm ci` → `npm run typecheck` → `npm test` on windows-latest / Node 22 WITHOUT `npm run build`
  and cannot load the real node-pty (Electron ABI locally; Linux-only anyway) — tests must stay
  self-sufficient on the fake backend.
- Wire channel names come from `CH` in `src/shared/ipc-contract.ts` (`pty:data`, `pty:exit`,
  `pty:status`, `pty:cwd`); the local pty push family is the shape the agent mirrors.

## Explicit non-goals (from the roadmap)

- No replay / `@xterm/headless` / serialize snapshots / scrollback history-limit — F18.
- No ssh spawning, tunnel, provisioning, or version-check-and-upload bootstrap — F19.
- No attach lease / exclusivity — F20.
- No renderer/main/preload wiring, no UI, no client-side routing — F21. The running Electron
  app's behavior stays byte-identical; TEST-746 survives unchanged. The client-side ack policy is
  a pure module consumed (for now) only by tests, exactly as F15's machines were.
- No new agent capabilities/domains (pty + status only, `AGENT_V1_CAPABILITIES` unchanged); no
  handshake or version-lock changes.
- No changes to F15 frame SHAPES or validation rules — semantics only.
- No macOS/Windows-remote REQs or tests (decision 9); no session survival across host reboot.
