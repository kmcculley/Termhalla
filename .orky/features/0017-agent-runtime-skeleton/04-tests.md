# Tests — 0017-agent-runtime-skeleton

**Phase:** 4 (tests). TEST ids continue the repo-global sequence after 0016's TEST-748.
Suites are vitest under `tests/` (the profile's `testRoots`): `agent-vocab.test.ts`,
`agent-structure.test.ts`, `agent-args-validate.test.ts`, `agent-fake-backend.test.ts`,
`agent-session.test.ts`, `agent-stdio-roundtrip.test.ts`, `docs-feature-0017.test.ts`.
Verified RED before the gate: every suite fails because `src/agent/`,
`src/shared/remote-agent-api.ts`, `vite.agent.config.ts`, the build-script chain, the tsconfig
include, and `docs/features/remote-agent.md` do not exist yet.

The suite fixes the frozen in-process API: `createAgentSession({ version, backend, homeDir,
send, diag, shutdown }) → { start(), onItem(DecodedItem), endOfInput() }`,
`createFakePtyBackend(): AgentPtyBackend`, `AgentPtyBackend.spawn({ id, cwd, cols, rows,
shellId }) → AgentPtyHandle { write, resize, kill, onData, onExit }` (handles buffer emissions
until `onData` attaches, then deliver synchronously), `parseAgentArgs(argv)`, and the four
`validate*Params` functions returning `{ ok: true, ... } | { ok: false, code: 'bad-params',
message }`. (One deliberate refinement over `03-plan.md`'s sketch: the backend spawn opts carry
`shellId` — resolution is the backend's own concern per REQ-007 — and cwd is resolved by the
session before the backend sees it.)

Scope-guard provenance (CONV-019): TEST-773's ack/window INERTNESS assertions are v1-only and
are named for retirement by **F17 (0018-windowed-flow-control)** through its own tests phase
(header note in `agent-session.test.ts`). TEST-757's gate-profile pin carries its CONV-022
amendment path in the `agent-structure.test.ts` header.

| TEST | REQ(s) | Assertion (short) |
|------|--------|-------------------|
| TEST-749 | REQ-014 | `AGENT_ERROR_CODES` exact sorted closed union; `AGENT_PTY_METHODS` = the four CH values |
| TEST-750 | REQ-014 | vocabulary module is environment-pure and CH-derived (no hand-typed channel literals) |
| TEST-751 | REQ-001 | `src/agent/` exists; no electron/renderer/preload imports; src/main only via `status/`; app trees never import the agent |
| TEST-752 | REQ-002 | all `shared/remote` specifiers end `/protocol` (≥1 exists); no 4-byte framing primitives in the agent |
| TEST-753 | REQ-004 | session references `AGENT_V1_CAPABILITIES`; no hand-typed `['pty','status']` anywhere in the tree |
| TEST-754 | REQ-008 | agent imports `main/status/`; defines no parser/scanner/engine of its own |
| TEST-755 | REQ-011 | `node-pty` referenced only in `node-pty-backend.ts`, only via lazy dynamic import |
| TEST-756 | REQ-012 | fake backend has no time/RNG/scheduling references |
| TEST-757 | REQ-015 | build script chains `electron-vite build` + `vite.agent.config`; config pins entry/outDir/artifact/external; gate profile deep-equals the locked baseline |
| TEST-758 | REQ-017 | `tsconfig.node.json` include contains `src/agent` |
| TEST-759 | REQ-011 | `parseAgentArgs`: default node-pty, `--pty=fake`, usage errors naming the offender |
| TEST-760 | REQ-009, REQ-007 | spawn param vectors: strict types/keys; `launch`/`envId` rejected by name as unsupported |
| TEST-761 | REQ-009 | write/resize/kill param vectors (positive-int dims — no clamping; bare-string kill) |
| TEST-762 | REQ-012 | fake: spawn marker burst (post-attach delivery), echo contract, unknown command, line buffering |
| TEST-763 | REQ-012 | fake: cwd OSC 9;9, pwd, size-after-resize, exit code, kill→0, byte-identical determinism, data-before-exit |
| TEST-764 | REQ-004 | hello is the FIRST frame with injected version + pinned capabilities |
| TEST-765 | REQ-005 | version-mismatch/req-first/malformed-first → single-frame output, reason diagnosed, shutdown(1) |
| TEST-766 | REQ-006 | exactly one res per req (id multiset equality); unknown-method naming; `internal` on handler throw, session survives |
| TEST-767 | REQ-007 | spawn fresh=false/adopt=true (one backend spawn), respawn-after-exit fresh, spawn-failed naming cause + no pane, empty-cwd→homeDir (pwd-observable), shellId passthrough |
| TEST-768 | REQ-007 | write reaches pty (echo), resize observable (size), kill→pty:exit; unknown-pane naming the id for all three |
| TEST-769 | REQ-008 | real-engine status: idle→busy→idle via markers, lastExit success/failure, no consecutive duplicates |
| TEST-770 | REQ-008 | pty:cwd `[id, path]` verbatim POSIX, change-only (no re-push on same cwd) |
| TEST-771 | REQ-010 | per-pane data order byte-faithful; pty:exit exactly once and last pane-scoped frame (kill + self-exit) |
| TEST-772 | REQ-009 | rejected params execute nothing: backend spy untouched, no pane residue, later ops clean |
| TEST-773 | REQ-013 | ack/window inert (F17-retired pin); hello/res/evt ignored+diagnosed; message-error recovery; fatal→shutdown(1); endOfInput kills all panes, shutdown(0) |
| TEST-774 | REQ-016, REQ-003, REQ-004 (+REQ-007/008/010 wire) | on-demand bundle via the SAME config; full round-trip via F15 client machinery; stdout decodes 100% clean; version/capabilities pinned |
| TEST-775 | REQ-005 | child vectors: version mismatch / req-before-hello → exit 1, stderr reason, single-frame stdout |
| TEST-776 | REQ-011 | `--pty=bogus` → exit 2, usage on stderr, ZERO stdout bytes |
| TEST-777 | REQ-013 | stdin-close with live pane → exit 0; garbage frame → diagnosed + recovers; oversized prefix → exit 1 |
| TEST-778 | REQ-017 | `docs/features/remote-agent.md` exists with load-bearing literals |
