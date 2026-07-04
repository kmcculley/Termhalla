# Intake — 0020-ssh-tunnel-provisioned-bootstrap

**Captured:** 2026-07-04
**Source:** Remote Agent v1 roadmap entry F19 (`.orky/roadmap.json` / `.orky/roadmap.md`), scaffolded
by orky-app-batch (app-run mode — the concept was fixed at roadmap time; brainstorm recorded from the
roadmap entry).

## Roadmap entry (verbatim)

- **id:** F19
- **slug:** 0020-ssh-tunnel-provisioned-bootstrap
- **title:** SSH tunnel + client-provisioned agent bootstrap
- **controls:** [] (none assigned)
- **deps:** [F16] (batch 3 — F16 / 0017-agent-runtime-skeleton is merged on this branch at
  `b8ac82e`; F17/F18 are parallel batch-3 siblings in their own worktrees and must NOT be assumed)

### Summary (verbatim)

> Transport = a stdio exec channel over the SYSTEM ssh binary — spawn the user's ssh, NEVER an SSH
> library (locked decision 1) — inheriting ~/.ssh/config, jump hosts, hardware keys, and 2FA. Seeds
> connection config from SSH favorites (host/user/port + identity-file PATH; buildSshArgs in
> src/shared/quick.ts + quick-store.ts) and introduces named agents as the connection registry (no
> secrets persisted, per baseline posture). On connect the client version-checks the remote agent
> through F15's handshake and uploads its own bundled matching agent build if absent or mismatched
> (locked decision 2 — client-provisioned, version-locked). e2e runs against a fake/local 'ssh' shim
> spawning the agent as a local child process — never a real network. Stack: TypeScript/Node.
> Already merged on main — F15 protocol layer at src/shared/remote/ and F16 agent runtime at
> src/agent/ (session.ts, pty-backend.ts + node-pty/fake backends, stdio main.ts, folded into npm
> run build/test). Build on them, do not re-derive. Unit tests via vitest in tests/, TDD per repo
> CLAUDE.md.

## Role in the app

Batch 3 of the Remote Agent v1 epic (F17 ∥ F18 ∥ F19 — three independent branches off the F16
skeleton). F19 owns the CONNECTION layer: how the client reaches a remote host (system-ssh stdio
exec channel), how it knows the agent there is the right build (F15 handshake, version-locked), and
how it makes it so when it isn't (client-provisioned upload + relaunch). F21 (client routing +
remote-workspace UX) is the consumer that wires this into `src/main`'s transport layer and the UI;
until then F19 ships NO renderer/main/preload wiring (the TEST-746 scope guard survives this feature
unchanged).

## Locked design decisions carried in (human-confirmed 2026-07-04; not to be re-opened)

1. **Transport = stdio exec channel over SYSTEM ssh** (spawn the user's `ssh` binary; never an SSH
   library) — inherits `~/.ssh/config`, jump hosts, hardware keys, 2FA. Stdio also means CI/e2e
   spawns the agent as a plain local child process over the IDENTICAL protocol path — no real ssh
   anywhere in CI (a fake/local `ssh` shim).
2. **Client-provisioned agent**: on connect the client version-checks the remote agent and uploads
   its own bundled matching build if absent/mismatched. Version-locked — the handshake is a version
   CHECK (string identity), never a compatibility matrix.
7. **Per-workspace home / named agents**: a workspace is homed local or at a *named agent*. F19
   introduces the named-agent connection registry; the per-workspace home semantics and one
   connection per workspace are F21's.
9. Agent platform v1 = **Linux only** (remote side); design POSIX-portable; no macOS/Windows-remote
   REQs or tests in v1. The CLIENT side runs where Termhalla runs (incl. Windows) — tests must pass
   on windows-latest CI.
10. The verified gate profile (`.orky/profiles/node-app.json` = `npm run build` + `npm test`) must
    keep actually building and testing everything this feature adds — folded into those npm scripts;
    the profile file itself does not change (equality-pinned by frozen TEST-757).
11. Hard invariants: renderer keeps ZERO Node/Electron imports; protocol code stays pure
    `src/shared/`; characterization tests stay green; local-only behavior unchanged when no remote
    workspace exists.

## Pre-existing structural anchors (read at scaffold time; the spec must honor them)

- **F15 protocol layer** is merged at `src/shared/remote/` behind the ONE sanctioned barrel
  `@shared/remote/protocol`. Frozen pins that bind F19:
  - TEST-747: the barrel's runtime export surface is pinned EXACTLY (AGENT_V1_CAPABILITIES,
    CAPABILITY_IDS, DEFAULT_MAX_FRAME_BYTES, FRAME_HEADER_BYTES, ProtocolError, WIRE_PROTO,
    createAgentHandshake, createClientHandshake, createFrameDecoder, createRequestTracker,
    encodeFrame, isCapabilityId, parseWireMessage) — F19 must NOT extend it.
  - TEST-745: every module under `src/shared/remote/` must be environment-pure (no node:/electron
    imports, no Buffer/process/__dirname) — F19 adds no impure file there.
  - TEST-746 (scope guard): NO file under `src/main/`, `src/preload/`, or `src/renderer/` may
    import `shared/remote`. Its header names F21 as the retiring feature. F19's client-side
    tunnel/bootstrap code therefore lives OUTSIDE those three trees (like F16's `src/agent/`), and
    the guard SURVIVES F19 unchanged.
- **F15 handshake is already F19-aware**: `src/shared/remote/handshake.ts` header — "On ANY failure
  neither side emits a frame — the failure object is the local diagnostic (**F19 consumes
  `version-mismatch` vs the rest to decide provisioning**)". `createClientHandshake` emits NOTHING
  until the agent hello arrives; failure kinds are `version-mismatch` / `proto-mismatch` /
  `bad-hello` / `unexpected-frame` (+ framing errors). Version check is string IDENTITY.
- **F16 agent artifact is the provisioning payload**: `vite.agent.config.ts` bundles
  `src/agent/main.ts` → `out/agent/termhalla-agent.cjs`, a SINGLE-FILE plain-Node CJS artifact
  (node18 target; everything bundled except Node builtins and the lazily-loaded `node-pty`).
  `AGENT_VERSION` (`src/agent/version.ts`) is the repo `package.json` version inlined at build time —
  its own header says "the artifact is the unit of version-locking — the client provisions a
  matching build, F19". This resolves roadmap open question 3 (packaging): upload = the one `.cjs`
  file. Frozen TEST-757 pins the config literals (`src/agent/main.ts`, `out/agent`,
  `termhalla-agent.cjs`, `'node-pty'`) and the gate profile as an equality; TEST-758 pins
  `tsconfig.node.json` include CONTAINS `src/agent` (additive changes are safe).
- **F16 agent stdio contract** (`src/agent/main.ts`): the agent speaks FIRST (its hello is the first
  bytes on stdout); stdout carries frames and NOTHING else; every diagnostic goes to stderr; exit
  codes 0 clean / 1 protocol-fatal / 2 CLI usage; `--pty=node-pty|fake` selects the backend (fake is
  the CI path; node-pty loads lazily and only on selection).
- **SSH favorites seed** (`src/shared/types.ts`): `SshConnection { id, name, host, user, port?
  (default 22), identityFile? (PATH to a key — never key material), tmuxSession?, tmuxOptions? }`,
  persisted in `QuickStore.connections` by `src/main/persistence/quick-store.ts`. `buildSshArgs`
  (`src/shared/quick.ts`) builds the INTERACTIVE argv `[-t] [-p PORT] [-i IDENTITY] user@host
  [tmux …]` — port omitted when unset/22, `-i` only when set. F19 needs an EXEC-CHANNEL variant of
  this seeding (no `-t`, no tmux — stdio must stay 8-bit clean for frames) reusing the same
  favorite fields; the existing function and its callers must stay byte-identical (interactive SSH
  panes keep working).
- **No secrets persisted** (baseline posture): connection records store host/user/port +
  identity-file PATH only. The named-agent registry must follow the same posture.
- **CI reality** (`.github/workflows/ci.yml`): `npm ci` → `npm run typecheck` → `npm test` on
  windows-latest / Node 22 WITHOUT `npm run build`. F16's round-trip suite
  (`tests/agent-stdio-roundtrip.test.ts`) shows the sanctioned pattern: build the agent bundle ON
  DEMAND through the SAME `vite.agent.config.ts` (outDir → scratch dir), spawn it under plain Node,
  drive it with F15's own client machinery (`TestClient`: frame decoder + client handshake +
  request tracker). F19's fake-ssh-shim tests must be self-sufficient the same way and must never
  touch a real network or a real `ssh`.
- `tsconfig.node.json` include is currently `["src/main", "src/shared", "src/agent", "tests"]` — a
  new client-side tree must be added there (additive; TEST-758 uses toContain) so `npm run
  typecheck` covers it.

## Explicit non-goals (from the roadmap)

- No flow-control SEMANTICS (ack/window pause/resume) — F17 (parallel sibling; do not depend on it).
- No replay / `@xterm/headless` / serialize snapshots / reattach — F18 (parallel sibling).
- No attach lease / exclusivity — F20.
- No renderer/main/preload wiring, no UI, no client-side routing, no per-workspace home — F21. The
  running Electron app's behavior stays byte-identical; TEST-746 survives unchanged; no
  `SCHEMA_VERSION` bump.
- No domain ports beyond what the agent already advertises (pty + status).
- No macOS/Windows-remote REQs or tests (decision 9); the remote side is Linux-only.
- No agent process supervision / session survival across disconnect or reboot (roadmap open
  question 1 stays open — the v1 exec-channel agent lives exactly as long as its ssh connection;
  keeping sessions alive past disconnect is F18/F20 territory).
- No real ssh, no real network, anywhere in tests.
