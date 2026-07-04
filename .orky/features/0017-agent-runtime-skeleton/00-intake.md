# Intake — 0017-agent-runtime-skeleton

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F16 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F16
- **slug:** 0017-agent-runtime-skeleton
- **title:** Agent runtime skeleton — pty + status domains over stdio
- **controls:** [] (none assigned)
- **deps:** [F15] (batch 2 — F15 / 0016-remote-protocol-core-handshake is merged on main)

### Summary (verbatim)

> The walking skeleton: a headless Node agent living in THIS repo (sharing src/shared/ protocol
> types — that is the point of the epic's architecture) that speaks F15's protocol over stdio and
> implements ONLY the pty + status domains (locked: that is tmux parity; the 17 per-domain
> registrars are the capability partition). Agent-side node-pty spawn/write/resize/data/exit
> round-trips through the real protocol against a plain locally-spawned agent child process (no
> real ssh anywhere in CI — identical protocol path, locked decision 1). Status detection (OSC 133
> / needs-input / cwd, reusing the existing pure src/main/status/ modules) consumes the byte stream
> AT THE SOURCE on the agent, so status chips work identically for remote panes. Agent platform v1
> = Linux only; design POSIX-portable (macOS nearly free later) but no macOS/Windows-remote REQs or
> tests in v1. MUST fold the agent build + tests into npm run build and npm test so the verified
> gate profile (.orky/profiles/node-app.json) actually builds and tests the agent without the
> profile file itself changing. Stack: TypeScript/Node (Electron app; the agent is a plain Node
> target sharing @shared/ via the existing path alias), unit tests via vitest in tests/, TDD per
> repo CLAUDE.md. F15's protocol layer is already merged on main at src/shared/remote/ — build on
> it, do not re-derive it.

## Role in the app

Batch 2 of the Remote Agent v1 epic — "the walking skeleton; everything downstream needs the agent +
client round-trip." F17 (windowed flow control), F18 (replay + session survival), and F19 (ssh
tunnel + provisioned bootstrap) all branch off this skeleton; F21 (client routing) is its eventual
production consumer. Brownfield seams named by the roadmap: F16 reuses the pure `src/main/status/`
modules and mirrors the `pty:*` IPC path.

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

1. Transport = stdio exec channel over SYSTEM ssh; CI/e2e spawns the agent as a plain local child
   process over the IDENTICAL protocol path — no real ssh anywhere in CI.
2. Client-provisioned agent: EXACT version check on connect (version-locked; NOT a compatibility
   matrix). F15's handshake machines implement this; F16 advertises through them.
6. Capability handshake: the agent advertises which IPC domains it implements; the per-domain IPC
   registrar names ARE the capability partition. v1 agent = **pty + status only** (tmux parity —
   status detection consumes the byte stream at the source, so status chips work identically for
   remote panes).
9. Agent platform v1 = **Linux only**; design POSIX-portable (macOS nearly free later), no
   macOS/Windows-remote REQs or tests in v1.
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`) must
    end up actually building and testing the agent — folded into those npm scripts (F16); the
    profile file itself does not change.
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code stays pure
    `src/shared/`; characterization tests stay green; local-only behavior unchanged when no remote
    workspace exists.

## Pre-existing structural anchors (read at scaffold time; the spec must honor them)

- F15's protocol layer is merged at `src/shared/remote/` behind the ONE sanctioned barrel
  `@shared/remote/protocol`. Its frozen suite pins: TEST-747 (the barrel exports EXACTLY F15's
  public interface — F16 must NOT extend it), TEST-745 (every module under `src/shared/remote/` is
  environment-pure — F16 adds no impure file there), and TEST-746 (scope guard: no file under
  `src/main/`, `src/preload/`, or `src/renderer/` imports `shared/remote`; its header names F16's
  sanctioned path — the agent consumer lives OUTSIDE those trees and the guard SURVIVES F16
  unchanged; F21 retires it).
- `AGENT_V1_CAPABILITIES` (`['pty', 'status']`) is already pinned by F15 (TEST-742); F16 advertises
  THIS constant, never a hand-typed list.
- The wire `evt` envelope mirrors the main→renderer `send(channel, ...args)` shape; the local pty
  push family is `pty:data` (id, data), `pty:exit` (id, code), `pty:status` (id, TerminalStatus),
  `pty:cwd` (id, cwd) per `src/shared/ipc-contract.ts` + `src/main/ipc/register-pty.ts`.
- CI (`.github/workflows/ci.yml`) runs `npm ci` → `npm run typecheck` → `npm test` on
  windows-latest / Node 22 WITHOUT `npm run build` — agent tests must be self-sufficient (no
  dependency on `out/` artifacts). Local `node_modules/node-pty` is electron-rebuilt (Electron ABI)
  on dev boxes, so a plain-Node test process CANNOT load the real node-pty binding — and v1 real-pty
  support is Linux-only anyway (decision 9). The pty backend must therefore be injectable, with a
  deterministic fake exercising the identical protocol path in CI.

## Explicit non-goals (from the roadmap)

- No flow-control SEMANTICS (ack/window pause/resume behavior) — F17. The frame shapes exist (F15)
  and are inert here.
- No replay / `@xterm/headless` / serialize snapshots / scrollback history-limit — F18.
- No ssh spawning, tunnel, provisioning, or version-check-and-upload bootstrap — F19.
- No attach lease / exclusivity — F20.
- No renderer/main/preload wiring, no UI, no client-side routing — F21. The running Electron app's
  behavior stays byte-identical; TEST-746 survives unchanged.
- No domain ports beyond pty + status (fs/git/usage/orky remain deferred).
- No macOS/Windows-remote REQs or tests (decision 9); no session survival across host reboot.
