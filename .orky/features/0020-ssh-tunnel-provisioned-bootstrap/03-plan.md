# Plan — 0020-ssh-tunnel-provisioned-bootstrap (F19)

Derived from `02-spec.md` (REQ-001..REQ-018). Smallest plan that satisfies the spec; fits the
existing module boundaries (`src/agent/` precedent for an out-of-app tree; `@shared/remote/protocol`
as the ONE protocol import surface; `tests/` vitest layout; no new npm dependencies).

## Target layout

```
src/shared/remote-agents.ts        (pure)  named-agent model + normalize + seed-from-favorite
src/remote-client/ssh-command.ts   (pure)  argv/command builders + injection validators + constants
src/remote-client/classify.ts      (pure)  connect-failure classification (provisionable vs fatal)
src/remote-client/agents-store.ts  (impure) path-injected JSON registry store (atomic save)
src/remote-client/ssh-spawn.ts     (impure) system-ssh child spawn seam (program injectable)
src/remote-client/bootstrap.ts     (impure) connectAgent / provisionAgent / connectWithProvisioning
tsconfig.node.json                 include += "src/remote-client"
tests/fixtures/fake-ssh.mjs        (tests phase) the fake ssh shim — local emulation, no network
tests/fixtures/fake-agent-*.mjs    (tests phase) scripted hello emitters (mismatch / proto cases)
```

No file under `src/main/`, `src/preload/`, `src/renderer/` is touched. No change to
`package.json` dependencies, `.orky/profiles/node-app.json`, `SCHEMA_VERSION`, or the
`@shared/remote/protocol` barrel.

## Tasks (ordered)

### TASK-001 — Named-agent pure model
`src/shared/remote-agents.ts`: `NamedAgent` interface, `normalizeNamedAgents(raw: unknown)`
(strip unknown fields, drop invalid records, coerce/validate port, never throw),
`seedNamedAgentFromConnection(conn, id, name)` (copies exactly host/user/port/identityFile; never
tmux fields). Environment-pure (TEST-745-equivalent constraints).
Depends: —. Satisfies: REQ-003 (and the purity half of REQ-002).
Files: `src/shared/remote-agents.ts`.

### TASK-002 — Pure ssh command builders + injection validators
`src/remote-client/ssh-command.ts`: `buildSshExecArgv` (exec-channel argv, `-p`/`-i` rules, no
`-t`, no BatchMode), field validators (host/user/port/identityFile/remote-path/nonce/version safe
charsets, specific CONV-001 errors), `remoteAgentInstallPath` (versioned filename,
`DEFAULT_REMOTE_AGENT_DIR = '~/.termhalla/agent'`), `buildAgentLaunchCommand` (pinned
`test -f <path> && exec node <path> --pty=<backend> || exit 127`), `buildAgentUploadCommand`
(pinned `mkdir -p` + `cat > tmp.<nonce>` + `wc -c` size check + atomic `mv`, sentinel 93),
exported sentinel constants (`LAUNCH_ABSENT_EXIT = 127`, `UPLOAD_SIZE_MISMATCH_EXIT = 93`).
Depends: TASK-001 (seed type). Satisfies: REQ-005, REQ-006, REQ-008, REQ-009, REQ-012 (command
shape), REQ-013 (nonce validation).
Files: `src/remote-client/ssh-command.ts`.

### TASK-003 — Registry store (path-injected, atomic)
`src/remote-client/agents-store.ts`: `loadNamedAgents(filePath)` (missing/garbage → `[]`),
`saveNamedAgents(filePath, agents)` (normalize → temp file in same dir → rename). Node `fs/promises`
only.
Depends: TASK-001. Satisfies: REQ-004.
Files: `src/remote-client/agents-store.ts`.

### TASK-004 — System-ssh spawn seam
`src/remote-client/ssh-spawn.ts`: `spawnSsh({ program = 'ssh', prefixArgs = [] }, argv)` →
`child_process.spawn(program, [...prefixArgs, ...argv], { windowsHide: true, shell: false ... })`,
stdio piped. No shell, no library, injectable for tests.
Depends: TASK-002 (argv type only). Satisfies: REQ-007.
Files: `src/remote-client/ssh-spawn.ts`.

### TASK-005 — Pure failure classification
`src/remote-client/classify.ts`: `classifyConnectOutcome({ frames|handshakeFailure, exitCode,
sawAnyFrame, stderrExcerpt })` → `'connected' | 'absent' | 'version-mismatch' | 'fatal'` with the
REQ-011 rules (127+zero frames → absent; handshake `version-mismatch` → version-mismatch; 255 /
other kinds / unexpected exit → fatal with diagnostic). Pure so the truth table is unit-testable
without processes.
Depends: —. Satisfies: REQ-011 (rules).
Files: `src/remote-client/classify.ts`.

### TASK-006 — Bootstrap orchestration
`src/remote-client/bootstrap.ts`: `connectAgent` (spawn launch argv; `createFrameDecoder` +
`createClientHandshake` + `encodeFrame` from `@shared/remote/protocol`; client silent until agent
hello; session handle `{ version, capabilities, send, onFrame, onExit, kill }`),
`provisionAgent` (spawn upload argv, stream artifact bytes from `artifactPath`, settle on exit
code; map 93/255/other to diagnostics; default crypto nonce source, injectable),
`connectWithProvisioning` (classify → provision → retry exactly once → `provision-ineffective`),
`AbortSignal` wiring (kill children, aborted outcome; mid-upload abort → indeterminate-marked
outcome per CONV-015), one canonical `version` input used for both handshake and install path
(CONV-006), never reads `package.json`.
Depends: TASK-002, TASK-004, TASK-005. Satisfies: REQ-010, REQ-011 (wiring), REQ-012 (client side),
REQ-013 (default source), REQ-014, REQ-015, REQ-016.
Files: `src/remote-client/bootstrap.ts`.

### TASK-007 — Typecheck folding
`tsconfig.node.json`: `include` gains `"src/remote-client"` (additive; frozen TEST-758 keeps
passing — it asserts `toContain('src/agent')`).
Depends: —. Satisfies: REQ-001 (folding half).
Files: `tsconfig.node.json`.

### TASK-008 — Test substrate contract (delivered at the tests phase by the test-designer)
The fake ssh shim (`tests/fixtures/fake-ssh.mjs`) and scripted fake agents
(`tests/fixtures/fake-agent-*.mjs`), per REQ-018: parse builder-produced argv, emulate the two
pinned remote-command shapes against `FAKE_SSH_HOME` with Node primitives (windows-safe), env-driven
rig switches (exit-255, stall-on-stdin), spawn the agent as a local child. Plus the gold round-trip
(REQ-017) building the real bundle through `vite.agent.config.ts` (scratch outDir, TEST-774
pattern). Listed here so the traceability matrix carries the file targets; the integrity boundary
(ADR-009) means the test-designer, not the implementer, writes these files.
Depends: TASK-002 (pinned command shapes). Satisfies: REQ-017, REQ-018 (substrate).
Files: `tests/fixtures/fake-ssh.mjs`, `tests/fixtures/` fake agents.

### TASK-009 — App-invariance verification (no code)
Run the full existing suite (characterization, F15/F16 frozen suites, `tests/shared/quick.test.ts`)
plus `npm run typecheck` and `npm run build` to prove zero behavior change to the running app and
the frozen surfaces (profile equality, barrel surface, `quick.ts` untouched). No file edits; this
task is the executable checklist for REQ-002.
Depends: TASK-001..TASK-007. Satisfies: REQ-002.
Files: — (verification only).

## Sequence

TASK-001 → TASK-002 → {TASK-003, TASK-004, TASK-005} → TASK-006 → TASK-007 → (tests phase:
TASK-008 + the unit/integration suites) → implement → TASK-009.

## Open issues

None — every REQ maps to at least one task; no under-specified REQ found.
