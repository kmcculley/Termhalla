# Intake — 0019-agent-replay-session-survival

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F18 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F18
- **slug:** 0019-agent-replay-session-survival
- **title:** Agent-side replay + session survival
- **controls:** [] (none assigned)
- **deps:** [F16] (batch 3 — F16 / 0017-agent-runtime-skeleton is merged on main; F17 and F19 run in
  PARALLEL worktrees off the same base — keep this feature's edits additive/modular so the batch
  merge stays tractable)

### Summary (verbatim)

> Sessions survive client disconnect/death (locked decision 3): the agent keeps PTYs alive with one
> @xterm/headless terminal per PTY running AGENT-side, bounded scrollback (tmux history-limit
> analog), and a serialize-addon snapshot sent to the client on (re)attach so the pane repaints
> exactly. Adds the agent-side session inventory (list/identify surviving sessions for reattach).
> Explicitly NOT the window-manager transit buffer — that is a 1024-event/10s-GC same-machine
> handoff primitive and the wrong tool here; no code in this feature may reuse it. Surviving
> DISCONNECT is v1; surviving host reboot is not promised (supervision is a recorded open
> question). Stack: TypeScript/Node. Already merged on main — F15 protocol layer at
> src/shared/remote/ and F16 agent runtime at src/agent/ (session.ts, pty-backend.ts +
> node-pty/fake backends, stdio main.ts, folded into npm run build/test). Build on them, do not
> re-derive. Unit tests via vitest in tests/, TDD per repo CLAUDE.md.

## Role in the app

Batch 3 of the Remote Agent v1 epic — one of three independent branches off F16's walking skeleton
(F17 flow control ∥ F18 replay/survival ∥ F19 ssh bootstrap). F20 (exclusive attach lease) depends
on THIS feature's session inventory + reattach path; F21 (client routing) consumes the replay
snapshot to repaint remote panes. The batch-6 integration phase proves the full end-to-end story
("disconnect → agent-side output continues → reattach → replayed serialize snapshot matches an
independent headless reference terminal") over the stdio loopback.

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

3. **Reconnect/replay** = `@xterm/headless` running AGENT-side (one per PTY) + serialize-addon
   snapshot on attach; bounded scrollback (tmux history-limit analog). Explicitly **not** the
   window-manager transit buffer (a 1024-event/10s-GC same-machine handoff primitive — wrong tool;
   no code in this feature may reuse `src/main/window-manager*.ts` transit machinery).
1. Transport = stdio exec channel over SYSTEM ssh; CI/e2e spawns the agent as a plain local child
   process over the IDENTICAL protocol path — no real ssh anywhere in CI (context for how reattach
   is exercised in tests: in-process / local child, never a network).
5. Exclusive attach v1 = an agent-side lease is **F20**, not this feature. F18 needs only what F20
   builds on: surviving sessions + inventory + a snapshot-bearing (re)attach path.
9. Agent platform v1 = **Linux only**; design POSIX-portable, no macOS/Windows-remote REQs or tests
   (CI itself runs windows-latest with `--pty=fake` — tests stay platform-neutral).
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`) keeps
    building/testing the agent; the profile file itself does not change (frozen TEST-757 pins it).
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code stays pure
    `src/shared/`; characterization tests stay green; local-only behavior unchanged when no remote
    workspace exists (no renderer/main/preload wiring in this feature).

## Recorded open questions this feature must NOT resolve (roadmap "Open questions")

- **Supervision** (systemd-user vs `setsid`/`nohup`) — how the agent PROCESS outlives the ssh
  channel and reboots is open; it affects F19 and reboot survival. F18 delivers the agent-SIDE
  machinery (sessions that outlive a client CONNECTION within a live agent process) and the
  protocol surface; surviving host reboot is explicitly not promised.
- **Scrollback history-limit sizing + session GC policy** for never-reattached sessions — pick a
  sane bounded default (tmux's default history-limit is 2000 lines) and keep it overridable;
  do NOT build a GC policy (record it as deferred).

## Pre-existing structural anchors (read at scaffold time; the spec must honor them)

- **F16's agent runtime is merged** at `src/agent/`: `session.ts` (handshake-first session core —
  ALL IO injected: `send`/`diag`/`shutdown` + backend; panes map; StatusEngine fed at the source;
  exactly-one-res dispatch over the four `CH.pty*` methods; `pty:spawn` on a live id = ADOPT,
  returns `ok(true)`, never respawns), `pty-backend.ts` (`AgentPtyBackend`/`AgentPtyHandle`
  interfaces), `fake-backend.ts` (deterministic scripted pseudo-shell, `--pty=fake`),
  `node-pty-backend.ts` (lazy dynamic-import, Linux-only v1), `args.ts`, `validate.ts` (strict
  param validation), `error-codes.ts`, `version.ts`, `main.ts` (the ONLY stdio shell).
- **F16 frozen suites pin** (tests/agent-*.test.ts — sanctioned amendment ONLY through this
  feature's tests phase, atomically, if a pinned behavior is the very thing F18 changes):
  - TEST-751: src/agent imports no electron/renderer/preload; src/main only via `status/`; and no
    file under src/main|preload|renderer imports the agent tree.
  - TEST-752: every `shared/remote` specifier in src/agent ends with `/protocol` (the F15 barrel);
    no byte-framing primitives re-derived.
  - TEST-753: capabilities advertised via `AGENT_V1_CAPABILITIES`, never hand-typed.
  - TEST-754: status parsing imported from `src/main/status/`, never forked.
  - TEST-755: the `node-pty` module specifier confined to `node-pty-backend.ts`, lazy-only.
  - TEST-756: fake backend deterministic (no time/RNG/timers).
  - TEST-757: `package.json` build script keeps `electron-vite build` + chains
    `vite.agent.config`; the vite agent config pins `src/agent/main.ts` / `out/agent` /
    `termhalla-agent.cjs` / external `node-pty`; the gate profile JSON is byte-stable.
  - TEST-758: `tsconfig.node.json` includes `src/agent`.
  - TEST-749/750 (agent-vocab): `AGENT_ERROR_CODES` is EXACTLY
    `['bad-params','internal','spawn-failed','unknown-method','unknown-pane']` and
    `AGENT_PTY_METHODS` is EXACTLY the four CH pty values — new remote-only method strings need a
    NEW constant in `src/shared/remote-agent-api.ts` (do not extend the pinned arrays; do not mint
    new error codes unless a pinned list is amended through the tests phase); that module must stay
    environment-pure and must not hand-type `pty:spawn|write|resize|kill` literals (other literals
    are fine).
  - TEST-773 (agent-session): "end of input kills every live pane and exits 0" — THE semantic F18
    generalizes. Default construction must keep that observable contract OR the frozen case is
    amended through the tests phase; survival must be an explicit runtime capability either way.
  - TEST-766: exactly one res per req; unknown methods coded `unknown-method` with a message naming
    the implemented surface (session.ts's default-case message currently enumerates only the four
    pty methods — extend the message when adding methods).
- **F15 frozen suites pin**: TEST-747 (the `@shared/remote/protocol` barrel exports EXACTLY F15's
  public interface — F18 must NOT extend it; new methods are `ReqFrame.method` STRINGS, which the
  envelope layer deliberately does not restrict), TEST-745 (src/shared/remote stays
  environment-pure), TEST-746 (no src/main|preload|renderer file imports shared/remote — F18
  touches none of those trees, so the guard survives unchanged).
- **The wire envelope is CLOSED** (`hello|req|res|evt|ack|window`, strict unknown-key rejection) —
  F18 adds NO frame types; attach/inventory ride `req`/`res` with new method strings, and replay
  bytes ride the EXISTING `pty:data` evt channel or the attach `res.result` (spec decides; the
  strict validator rejects `undefined` inside JSON positions — mind the F16 `lastExit` reshaping
  precedent when putting status objects in results).
- **StatusEngine exposes NO getters** (`src/main/status/status-engine.ts`: callbacks only, change-
  deduped) — inventory/attach metadata (cwd, status) must be CACHED by the agent from the
  callbacks it already receives; do not modify src/main/status (shared with the live app).
- **Dependency reality**: `@xterm/headless@5.5.0` (stable) matches the repo's `@xterm/xterm ^5.5.0`
  line; `@xterm/addon-serialize ^0.13.0` is ALREADY a dependency (renderer uses it for local
  snapshot stash) and its peer range `@xterm/xterm ^5.0.0` is satisfied. The serialize addon works
  against a headless Terminal (its documented server-side use); typings may need a cast at
  `loadAddon` (addon types reference `@xterm/xterm`). xterm's `write()` is ASYNC (queued parse) —
  a snapshot taken naively after `write()` races the parser; the replay layer must barrier on
  write-flush (write callback) before `serialize()`, and attach must order: snapshot → res →
  buffered post-attach bytes → live `pty:data` (a tiny per-attach in-flight ordering queue is NOT
  the window-manager transit buffer and must not import it).
- **The agent bundle** (`vite.agent.config.ts`, `ssr.noExternal: true`) bundles everything except
  Node builtins and `node-pty` — `@xterm/headless` + the serialize addon will be bundled into
  `out/agent/termhalla-agent.cjs`; the stdio roundtrip suite builds this SAME config on demand
  (tests never depend on a prior `npm run build`), so new deps must install cleanly under
  `npm ci` on windows-latest CI (both packages are pure JS — they do).
- **CI** (`.github/workflows/ci.yml`): `npm ci` → `npm run typecheck` → `npm test`,
  windows-latest / Node 22, no `out/` artifacts, no real node-pty loadable (Electron ABI) —
  survival/replay tests must run against the injectable fake backend / in-process session core,
  exactly like F16's suites.

## Explicit non-goals (from the roadmap)

- No window-manager transit buffer reuse (locked decision 3's exclusion — the 1024-event/10s-GC
  same-machine handoff in `src/main/window-manager-core.ts` stays untouched and unimported).
- No flow-control semantics (ack/window stay F17's; those frames remain inert here — F17 runs in a
  parallel worktree, do not touch the reserved-frame handling).
- No ssh spawning, tunnel, provisioning, daemonization, socket listeners, or supervision — F19 /
  recorded open question. F18's survival is proven at the session/runtime layer in-process and
  over single-process stdio, never via a second OS-level connection transport.
- No attach lease / exclusivity / steal semantics — F20 (it builds ON this feature's inventory +
  attach).
- No renderer/main/preload wiring, no UI, no client-side routing — F21. The running Electron app's
  behavior stays byte-identical; TEST-746 survives unchanged.
- No session GC policy for never-reattached sessions; no reboot survival (recorded open questions).
- No new frame types, no F15 barrel extension, no new agent error codes (reuse the closed five).
