# Plan — 0017-agent-runtime-skeleton

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-017), `.orky/baseline/architecture.md`.
Brownfield fit: a new `src/agent/` executable tree beside the three Electron layers; reuse
`@shared/remote/protocol` (F15, frozen), `@shared/ipc-contract` (`CH` + pty arg types),
`@shared/types` (`TerminalStatus`), and the existing `src/main/status/` stack (imported, never
forked). Pure logic in small modules; the impure shell (`main.ts`) stays thin — the repo's
standing pattern.

## Target layout

```
src/agent/
  args.ts               pure: parseAgentArgs(argv) → { ptyBackend } | { usageError }
  version.ts            AGENT_VERSION from ../../package.json (named import; rollup shakes)
  pty-backend.ts        AgentPtyBackend / AgentPtyHandle / AgentSpawnOpts interfaces (pure types)
  fake-backend.ts       deterministic scripted pseudo-shell (REQ-012 contract)
  node-pty-backend.ts   lazy dynamic import('node-pty'); POSIX shell/home resolution
  validate.ts           pure strict param validators → { ok } | { code: AgentErrorCode, message }
  session.ts            createAgentSession(init): DecodedItem in → frames out; the whole core
  main.ts               impure shell: argv, stdin→decoder→session, session→encodeFrame→stdout,
                        stderr diagnostics, exit codes 0/1/2
src/shared/remote-agent-api.ts   AGENT_ERROR_CODES / AgentErrorCode / AGENT_PTY_METHODS (pure)
vite.agent.config.ts             single-file cjs bundle → out/agent/termhalla-agent.cjs
docs/features/remote-agent.md    feature doc (REQ-017b)
```

Edits to existing files: `package.json` (`scripts.build` chains `vite build --config
vite.agent.config.ts`), `tsconfig.node.json` (`include` += `"src/agent"`; `resolveJsonModule:
true` for the version import). NOTHING under `src/main|preload|renderer` or
`src/shared/remote/` changes; `.orky/profiles/node-app.json` byte-identical.

## Core design (session.ts)

`createAgentSession({ version, capabilities, backend, homeDir, send, diag, shutdown })` — all IO
injected: `send(frame)` (main.ts encodes → stdout; an encode/write failure is fatal),
`diag(text)` (stderr), `shutdown(code)` (exit path). The session:

1. **Handshake:** on creation returns/sends the F15 `createAgentHandshake` hello FIRST. First
   inbound item: `message` → machine `onMessage`; failure or a pre-hello `message-error` item →
   `diag(reason)` + `shutdown(1)` (REQ-005). Success → established.
2. **Dispatch (established):** `req` → validate (validate.ts) → handler; every valid req answers
   exactly once, same id (REQ-006). Handlers: `pty:spawn` (adopt-if-live → `true`; else resolve
   shellId/cwd, `engine.register(id)` BEFORE `backend.spawn` — the repo's register-before-spawn
   discipline — wire handle callbacks, → `false`; backend throw → `spawn-failed`, engine
   unregistered), `pty:write`/`pty:resize`/`pty:kill` (live-pane check → `unknown-pane`).
   Unknown method → `unknown-method`. Handler throw → `internal`, session survives.
3. **Status at the source (REQ-008):** one `StatusEngine` (imported from
   `src/main/status/status-engine`) wired: `onStatus` → evt `pty:status [id, status]`, `onCwd` →
   evt `pty:cwd [id, cwd]`. Pane data: `engine.feed(id, data)` then evt `pty:data [id, data]`;
   pane exit: `engine.markExit(id, code)`, `engine.unregister(id)`, evt `pty:exit [id, code]`
   (after the final data — fake backend is synchronous; node-pty inherits its ordering), map
   pruned (CONV-011).
4. **Taxonomy (REQ-013):** post-establishment `message-error` → diag + continue; `fatal` →
   diag + kill-all + `shutdown(1)`; `hello`/`res`/`evt` inbound → diag + ignore; `ack`/`window`
   → silently ignore (F17-reserved inertness); `endOfInput()` (stdin end) → kill-all +
   `engine.dispose()` + `shutdown(0)`.

`main.ts` owns only: argv parse (exit 2 + usage on stderr), backend selection (fake vs lazy
node-pty), `process.stdin` chunks → F15 `createFrameDecoder().push` → `session.onItem(item)`,
`send` = `encodeFrame` → `process.stdout.write` (throw → diag + exit 1), stdin `end` →
`session.endOfInput()`. Nothing else writes stdout (REQ-003).

## Tasks

### TASK-001 — Shared agent vocabulary module
**Files:** `src/shared/remote-agent-api.ts`. **Deps:** none. **REQs:** REQ-014 (feeds
REQ-006/007/009 codes).
Export `AGENT_ERROR_CODES = ['bad-params', 'internal', 'spawn-failed', 'unknown-method',
'unknown-pane'] as const`, `AgentErrorCode`, `AGENT_PTY_METHODS = [CH.ptySpawn, CH.ptyWrite,
CH.ptyResize, CH.ptyKill] as const` (from `@shared/ipc-contract` — no string literals).
Environment-pure to F15's REQ-001 standard.

### TASK-002 — Backend interfaces
**Files:** `src/agent/pty-backend.ts`. **Deps:** none. **REQs:** REQ-011 (partition), REQ-001.
`AgentSpawnOpts { id, cwd, cols, rows, shell }`, `AgentPtyHandle { write(data), resize(cols,
rows), kill(), onData(cb), onExit(cb) }`, `AgentPtyBackend { spawn(opts): AgentPtyHandle }`.
Types only (pure).

### TASK-003 — Deterministic fake backend
**Files:** `src/agent/fake-backend.ts`. **Deps:** TASK-002. **REQs:** REQ-012 (contract),
REQ-007/REQ-008/REQ-010 observability (echo/cwd/pwd/size/exit commands, OSC 133 + OSC 9;9
emission), REQ-001.
Line-buffered command loop per the REQ-012 contract; no time/RNG/timers; synchronous emission
(data before exit). Emits markers via string literals of the OSC forms (emission is sanctioned;
PARSING stays in the imported status modules).

### TASK-004 — Lazy node-pty backend (POSIX)
**Files:** `src/agent/node-pty-backend.ts`. **Deps:** TASK-002. **REQs:** REQ-011 (lazy load,
POSIX-portable), REQ-007 (shell `$SHELL` else `/bin/sh`; spawn at validated cols/rows/cwd,
`name: 'xterm-256color'`), REQ-001.
`node-pty` referenced ONLY via a lazy dynamic `import('node-pty')` (or guarded `require`) inside
the factory — never a top-level static import. No Windows branches.

### TASK-005 — CLI args + version source
**Files:** `src/agent/args.ts`, `src/agent/version.ts`. **Deps:** none. **REQs:** REQ-011
(`--pty=node-pty|fake`, default node-pty; unknown flag/value → usage error), REQ-004 (version =
`package.json` version via named json import), REQ-001.
`parseAgentArgs` is pure and returns a discriminated union (no `process` access) so exit-2
behavior is unit-testable; `main.ts` maps `usageError` → stderr usage + exit 2.

### TASK-006 — Strict param validation
**Files:** `src/agent/validate.ts`. **Deps:** TASK-001. **REQs:** REQ-009 (strict; coded;
unknown-key rejection; launch/envId named as unsupported-in-v1), REQ-007 (shapes), REQ-001.
Pure validators per method returning `{ ok: true, value } | { ok: false, code: 'bad-params',
message }`; messages name key, offending value, expectation (CONV-001). `pty:kill` validates the
bare-string param.

### TASK-007 — Agent session core
**Files:** `src/agent/session.ts`. **Deps:** TASK-001..TASK-006. **REQs:** REQ-004 (hello first,
pinned identity), REQ-005 (failure taxonomy), REQ-006 (exactly-one res), REQ-007 (method
semantics incl. adopt + spawn-failed), REQ-008 (StatusEngine at the source), REQ-009 (wired
validation), REQ-010 (evt mirroring + ordering), REQ-013 (lifecycle/taxonomy), REQ-002 (consumes
only `@shared/remote/protocol`), REQ-001.
As designed above; the ENTIRE core is exercisable in-process (unit tests construct it with a
scripted backend and captured `send`/`diag`/`shutdown`).

### TASK-008 — Stdio entry shell
**Files:** `src/agent/main.ts`. **Deps:** TASK-005, TASK-007 (+TASK-003/004 selection).
**REQs:** REQ-003 (stdout frames only; stderr diagnostics), REQ-005/REQ-013 (exit codes 0/1/2
wiring), REQ-011 (backend selection), REQ-002 (decoder/encoder from the barrel), REQ-001.
Thin: argv → args.ts; stdin `data`/`end` wiring; `send` via `encodeFrame`; `process.exitCode`
handling. No logic beyond wiring.

### TASK-009 — Build/typecheck folding
**Files:** `vite.agent.config.ts`, `package.json` (scripts.build), `tsconfig.node.json`.
**Deps:** TASK-008 (entry exists). **REQs:** REQ-015 (artifact `out/agent/termhalla-agent.cjs`,
single-file cjs, `@shared` alias, `node-pty` + `node:` builtins external, version embedded via
the json import; profile untouched), REQ-016 (the SAME config file is the programmatic-build
hook the integration test reuses with an outDir override), REQ-017a (`include` += `src/agent`,
`resolveJsonModule: true`).
Config: `build.ssr`-style node target (`target: 'node18'`, cjs output, `minify: false`,
`emptyOutDir: true`, `rollupOptions.output.entryFileNames: 'termhalla-agent.cjs'`,
`external: ['node-pty']`), `resolve.alias['@shared']`.

### TASK-010 — Feature documentation
**Files:** `docs/features/remote-agent.md`. **Deps:** TASK-001..009 (documents them). **REQs:**
REQ-017b.
Sections per the REQ: location/entry/artifact, stdio contract, handshake + version lock,
methods/events/error codes, backend injection + CI rationale (ABI + Linux-only v1), lifecycle +
exit codes, F17 retirement note for ack/window inertness. (CLAUDE.md row = doc-sync.)

## Order

TASK-001 → TASK-002 → {TASK-003, TASK-004, TASK-005, TASK-006} → TASK-007 → TASK-008 → TASK-009
→ TASK-010. (Phase 4 authors the test suite against this layout; the integration test reuses
TASK-009's config file programmatically — REQ-016.)

## Risks / notes

- **Electron-ABI node-pty on dev boxes** — nothing in the CI/test path may load `node-pty`;
  TASK-004's lazy import is the load-bearing guard (REQ-011's structural pin).
- **vitest-side programmatic vite build** (REQ-016) — `import { build } from 'vite'` with
  `configFile: vite.agent.config.ts` + `build.outDir` override into a scratch dir; keeps
  `npm test` self-sufficient (CI runs no build). Integration test sets a generous per-test
  timeout; spawn via `process.execPath`.
- **StatusEngine interval** — the engine's 500 ms tick is unref'd; agent exit paths call
  `dispose()`. No agent-side timers otherwise (determinism).
- **stdout backpressure** is F17's problem (windowed flow control); v1 ignores `write()`'s
  return value by design (documented in the doc).
