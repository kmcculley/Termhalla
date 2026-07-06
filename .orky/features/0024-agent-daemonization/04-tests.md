# Tests — 0024-agent-daemonization

**Phase:** 4 (tests). **Date:** 2026-07-06. **Revision 3** — re-derived after the ESC-002
loop-back (spec revision 3: REQ-003 amended per FINDING-022, new REQ-019 per FINDING-023/D10,
REQ-014/016/017 propagation).
**Inputs:** `02-spec.md` revision 3 (frozen), `03-plan.md` revision 3 (the chosen module APIs
below follow its task boundaries), the round-2 implementation on disk (which the revision-2
suites TEST-2400..2457 already run GREEN against — those are carried forward UNCHANGED except
where a file gains a revision-3 addendum; the NEW tests TEST-2458..2465 run RED against it,
encoding exactly the two revision-3 contract deltas).

## Posture

Every suite runs under plain `npm test` on windows-latest: no build step is assumed (the
process/fake-lane suites bundle the REAL agent artifact on demand through `vite.agent.config.ts`
— the TEST-774 pattern), no real ssh, no network, no native module (`--pty=fake`; the node-pty
case uses the committed pure-JS stub fixture). Real daemon/bridge processes are exercised
portably via the injectable `--socket` path (named pipes on win32); the TWO POSIX-only vectors
(TEST-2454, the real-socket 0600-from-birth check; TEST-2459, the real-production-bind over-long
fast-fail — new in revision 3 per FINDING-022) are `describe.skipIf(win32)`-guarded — exercised
on any POSIX runner, passes-by-skip on windows-latest — with always-on portable twins
(TEST-2411 seam ordering; TEST-2458 shared-guard unit + single-source structural). Synchronization
is on observed frames/files/pids, never bare sleeps (CONV-062).

**Sanctioned frozen-fixture amendments (CONV-012, REQ-016):** `tests/fixtures/fake-ssh.mjs` was
amended through the REVISION-2 tests phase (ws-keyed persistent daemon substrate, `daemon-attach`/
`daemon-spawn` ledger kinds with the token — see the revision-2 record below) and needs NO further
amendment in revision 3: the close-tab scenarios reuse the existing persistent per-`wsToken`
daemon rig, exactly as `03-plan.md` anticipated. **TEST-2283** (`tests/renderer/
remote-ux-structure.test.ts`, owned by F21/0022 — the `closeWorkspace` source-order pin) is NOT
amended: the chosen `closeWorkspace` contract below keeps its literal
`teardownPanes(` → `disconnectRemote(` → `pruneRemoteStates(` order satisfiable (the local branch's
per-pane kill closure textually precedes the remote branch's detach), so the collision survey's
green-unamended path holds; its no-ghost INTENT is re-pinned semantically by TEST-2462/TEST-2463.
No other frozen suite is amended in revision 3.

**Old-version / drift substrates (REQ-012, unchanged from revision 2):**
`tests/integration-daemon-survival.test.ts` builds TWO additional genuinely-real agent bundles
through the same vite pipeline: (a) the AUTO-UPDATE substrate — only `src/agent/version.ts`
transformed (older app version, SAME proto); (b) the PROTO-DRIFT substrate — `version.ts` plus the
ONE `WIRE_PROTO = 1` literal in `src/shared/remote/handshake.ts` transformed to `2`. Never a
canned fake for the persistent daemon. **Consequence the implementer must honor:**
`DAEMON_PROTO_COMPAT` MUST be *derived from* `WIRE_PROTO` (e.g. `[WIRE_PROTO]`), never an
independent numeric literal.

## Chosen contracts frozen by these tests (implementer builds to these)

Revision-2 contracts (all already implemented, carried forward unchanged):

- `src/agent/args.ts`: ok-shape gains `mode?: 'daemon' | 'attach'`, `wsToken?: string`,
  `socketPath?: string`, `idleTimeoutMs?: number` (all absent/undefined for legacy argv —
  TEST-759 stays green). `--ws` validated against `^[A-Za-z0-9_-]{1,64}$` (usage error names the
  offending token); `--daemon`/`--attach` REQUIRE a scope (`--ws` or `--socket`) — neither
  present is a usage error naming both scope flags.
- `src/agent/daemon-constants.ts`: `DAEMON_IDLE_TIMEOUT_DEFAULT_MS` (300000),
  `DAEMON_SPAWN_WAIT_MS` (10000), `BRIDGE_DAEMON_UNREACHABLE_EXIT` (96),
  `DAEMON_LOG_MAX_BYTES` (1048576), `DAEMON_METADATA_FORMAT_VERSION` (1),
  `BRIDGE_STATUS_PREFIX` ('TERMHALLA_BRIDGE_V1 '), and the wsToken-parameterized name functions
  `socketFileName(ws)` → `agent-<ws>.sock`, `metadataFileName(ws)` → `daemon-<ws>.json`,
  `logFileName(ws)` → `daemon-<ws>.log`.
- `src/agent/daemon-guard.ts`: `buildDaemonMetadata`/`validateDaemonMetadata` over the SIX-key
  frozen shape `{formatVersion, pid, version, proto, backend, startedAt}` (`proto` a number);
  `decideDaemonReach({ connectable, metadataPid, pidAlive })` → `attach | reclaim | wait`.
- `src/agent/daemon-lifecycle.ts`: `createDaemonLifecycle({ scheduler, onShutdown(reason:
  'idle'|'signal'), idleTimeoutMs?, signals? })` with `start/onConnectionEstablished/
  onConnectionEnded/onPaneSpawned/onPaneExited/dispose` — an established-connection COUNT
  (FINDING-008), named for protocol establishment/end, never lease bind (FINDING-012).
- `src/agent/spawn-daemon.ts`: `buildDaemonSpawnSpec({ artifactPath, ptyBackend, logFd,
  wsToken?, socketPath?, idleTimeoutMs? })` → `{ command, args, options: { detached: true,
  stdio: ['ignore', logFd, logFd] } }` (FINDING-011); `--ws` forwarded when given.
- `src/agent/daemon-server.ts`: `bootstrapDaemonEndpoint` (POSIX seam order EXACTLY
  `umask(0o077) → listen → umask(prior) → writeFile(metadata, 0600)` — FINDING-005),
  `createDaemonCore` (relaxed daemon-flow handshake per connection; `ended` for EVERY end path of
  an ESTABLISHED connection, never for a failed handshake), `createDaemonLogSink` (truncate at
  construction, ring-capped — FINDING-010/015); `--ws` names metadata/log, `--socket` overrides
  only the ENDPOINT path.
- `src/shared/remote/daemon-handshake.ts` (re-exported from the barrel, additive):
  `createDaemonAgentHandshake`/`createDaemonClientHandshake` — establish on
  `proto ∈ DAEMON_PROTO_COMPAT` with `version` advisory; failure `'proto-mismatch'` naming both
  protos AND both app versions; `DAEMON_PROTO_COMPAT` = exactly `[WIRE_PROTO]`, DERIVED from it.
- `src/remote-client/ssh-command.ts`: `buildDaemonAgentLaunchCommand(installPath, ptyBackend,
  wsToken)` → `test -f P && exec node P --attach --pty=B --ws=T || exit 127`.
- `src/remote-client/ws-token.ts`: `deriveWsToken(workspaceId)` — conforming id as-is;
  non-conforming maps deterministically; distinct ids ⇒ distinct tokens.
- `src/remote-client/bridge-status.ts`: `parseBridgeStatus(stderrText)` → 4-field status | null;
  parse input is the RAW newline-preserving stderr (FINDING-017).
- `src/remote-client/classify.ts`: `classifyDaemonConnectOutcome` adding the
  `daemon-protocol-drift` row (spawned:true falls through to the F19 provisionable row).
- `src/remote-client/bootstrap.ts`: `BootstrapOptions.daemon?: { workspaceId: string }` (absent
  ⇒ pre-0024 byte-identical); `src/main` wiring passes `daemon: { workspaceId }`.
- Bridge: exactly one status line before piping; ZERO file removals (FINDING-016); 96
  diagnostics name socket + pid + ws-keyed log + the FINDING-018 manual escape hatch.

**New contracts frozen in revision 3:**

- `src/agent/daemon-guard.ts` additionally exports **`checkSocketPathLength(socketPath: string,
  platform: NodeJS.Platform): { message: string } | null`** — the ONE over-long-AF_UNIX-path
  guard (FINDING-022): `null` on win32 (named pipes exempt — the exemption lives IN the guard)
  and for in-limit POSIX paths; otherwise the named path-and-limit error, byte-measured
  (`Buffer.byteLength`, FINDING-007), never a raw EINVAL/ENAMETOOLONG. `bootstrapDaemonEndpoint`
  CALLS it (its rejection message is byte-identical to the guard's — TEST-2458 pins this), and
  the PRODUCTION `claimSocket`/`listenOnce` bind sequence calls it FIRST, before any
  claim/reclaim attempt: a violation exits the daemon nonzero with the named error on its
  diagnostic sink (stderr when run directly — TEST-2459), never iterating the claim loop, never
  a silent exit 0. Structurally: no `AF_UNIX_PATH_MAX = <n>` definition and no
  `Buffer.byteLength(socketPath…)` comparison outside `daemon-guard.ts`; ≥ 2 call expressions of
  `checkSocketPathLength(` in `daemon-server.ts` (seam + production).
- `src/renderer/store/pane-ops.ts` (the established api-free module — the pure core must not
  import `renderer/api`) exports **`routeWorkspaceTeardown(input: { isRemote: boolean;
  paneIds: string[] }, fns: { kill: (paneId: string) => void; detach: () => void }): void`** —
  remote ⇒ ZERO kill calls + exactly ONE detach (even pane-less); local ⇒ one kill per pane, in
  order, never a detach (pane-less local ⇒ nothing). `store.ts`'s `closeWorkspace` consumes it
  (structural pins: `routeWorkspaceTeardown(`, `forget: true`, and `clearPaneRuntime(` all appear
  after the `closeWorkspace: (` anchor; `closePane` keeps `teardownPanes([paneId])` — corollary
  b), written so TEST-2283's literal order stays satisfiable.
- **`remote:disconnect` gains ONE additive optional `{ forget?: boolean }` param** end-to-end
  (REQ-014's amended confinement — no new channel): `TermhallaApi.remoteDisconnect(workspaceId,
  opts?)` (the declaration carries `forget`), preload passes the second arg through,
  `register-remote` VALIDATES it (an object with an optional boolean `forget`; junk shapes are
  treated as absent and never forge a truthy forget manager-side — the disconnect itself still
  runs), `remote-slice`'s `disconnectRemote(workspaceId, opts?)` threads it unchanged (no-opts
  call sites byte-identical).
- **`RemoteWorkspaceManager.disconnectWorkspace(workspaceId, opts?: { forget?: boolean })`** —
  no opts: byte-identical (an entry with tracked panes survives — the banner's state);
  `{ forget: true }`: the wire tears down through the SAME teardownWire semantics, NO `pty:kill`
  frame is ever sent for the workspace's panes, and the entry is REMOVED from `currentStates()`
  even with panes still tracked (detach-then-forget; the daemon + PTYs are a separate process,
  untouched — its idle timeout reaps it once empty).

## Test map

Revision-2 rows (carried forward; all currently green against the round-2 implementation):

| TEST | File | Covers | Assertion |
|---|---|---|---|
| TEST-2400 | tests/agent-daemon-args.test.ts | REQ-001 | Legacy argv parses byte-identically to F16 (`toEqual` pins; no defined new fields) |
| TEST-2401 | tests/agent-daemon-args.test.ts | REQ-001 | `--daemon`/`--attach` (each with a scope), `--ws=`, `--socket=`, `--idle-timeout-ms=` parse; pipe paths verbatim; 1/64-char token boundaries |
| TEST-2402 | tests/agent-daemon-args.test.ts | REQ-001 | Mode conflict, bad idle values, empty `--socket=`, unknown flags → exit-2 usage naming the offender |
| TEST-2443 | tests/agent-daemon-args.test.ts | REQ-001 | Missing scope → exit-2 naming `--ws`/`--socket`; out-of-charset/empty/65-char `--ws` → exit-2 naming the token |
| TEST-2403 | tests/agent-daemon-contract.test.ts | REQ-003/004/006/009/010/011 | The Definitions constants' exported values (incl. `DAEMON_LOG_MAX_BYTES`); 96 distinct from every reserved exit |
| TEST-2444 | tests/agent-daemon-contract.test.ts | REQ-003, REQ-009, REQ-018 | wsToken-parameterized `agent-<ws>.sock`/`daemon-<ws>.json`/`daemon-<ws>.log`; version-stable; distinct tokens ⇒ distinct names |
| TEST-2404 | tests/agent-daemon-contract.test.ts | REQ-003 | Metadata build/validate: exactly `{formatVersion,pid,version,proto,backend,startedAt}`, v1 frozen, extras/missing/mistyped rejected without throwing |
| TEST-2405 | tests/agent-daemon-contract.test.ts | REQ-004, REQ-011 | Spawn spec: detached, stdio `['ignore', logFd, logFd]` (FINDING-011), `--ws`/`--socket`/`--idle-timeout-ms` forwarding, never `--attach` |
| TEST-2445 | tests/agent-daemon-contract.test.ts | REQ-004 | Log sink: truncate-at-start AND in-generation byte cap with the latest diagnostic surviving (FINDING-010/015) |
| TEST-2406 | tests/agent-daemon-lifecycle.test.ts | REQ-006 | Really-scheduled arm at empty start; default = the named constant; override honored |
| TEST-2407 | tests/agent-daemon-lifecycle.test.ts | REQ-006 | Arm/cancel transitions: establishment/spawn cancel; last-end-empty and last-exit-disconnected re-arm |
| TEST-2446 | tests/agent-daemon-lifecycle.test.ts | REQ-006 | FINDING-008: 2 established, one ends → NOT armed; second ends → armed; steal-displacement never reaches 0 |
| TEST-2408 | tests/agent-daemon-lifecycle.test.ts | REQ-006 | Shutdown exactly once ('idle'); injected SIGTERM seam runs the SAME path once ('signal'); dispose cancels |
| TEST-2409 | tests/agent-daemon-guard.test.ts | REQ-007 | Reach decision table: connectable→attach; refused+dead/absent→reclaim; refused+live→wait |
| TEST-2410 | tests/agent-daemon-guard.test.ts | REQ-005, REQ-007 | Property over all observations: a live recorded pid is NEVER reclaimed; a listener is never disturbed (CONV-045) |
| TEST-2411 | tests/agent-daemon-guard.test.ts | REQ-003 | FINDING-005 seam order EXACTLY umask(0o077) → listen → umask(prior) → write(metadata,0600); exact key set incl. proto |
| TEST-2412 | tests/agent-daemon-guard.test.ts | REQ-003 | FINDING-007 BYTE-measured AF_UNIX limit: ASCII + multibyte (≤107 units, >107 bytes) both hit the named error, never EINVAL; win32 pipes exempt |
| TEST-2413 | tests/agent-daemon-core.test.ts | REQ-002 | In-process transport pairs: abrupt end detaches only; detached output feeds replay; B lists + attaches; F18 composition oracle byte-exact across the connection boundary |
| TEST-2414 | tests/agent-daemon-core.test.ts | REQ-002 | frame-too-large kills the CONNECTION: concurrent connection keeps serving, daemon keeps accepting, pane unkilled |
| TEST-2415 | tests/agent-daemon-core.test.ts | REQ-002 | Handshake failure on one connection leaves the daemon serving others (CONV-002) |
| TEST-2447 | tests/agent-daemon-core.test.ts | REQ-012, REQ-002 | Daemon-side range establishment: different app version establishes and is served; out-of-range proto → connection ended, daemon serves on |
| TEST-2448 | tests/agent-daemon-core.test.ts | REQ-006 | Hook counts: established per completed handshake; ended for displacement AND clean EOF; failed handshake never counted (FINDING-008/012) |
| TEST-2416 | tests/agent-daemon-core.test.ts | REQ-008 | Steal: `lease:revoked` is the loser's FINAL frame; winner's snapshot⊕tail recovers bytes the loser never received; steal-back works |
| TEST-2449 | tests/agent-daemon-core.test.ts | REQ-018 | Two cores side by side: independent stores/inventories, same pane ids coexist, no cross-workspace revocation, destroy isolation |
| TEST-2451 | tests/remote-daemon-handshake.test.ts | REQ-012, REQ-014 | Relaxed-machine truth table: same-proto/different-version establishes both ways; out-of-range → 'proto-mismatch' naming both protos+versions; `DAEMON_PROTO_COMPAT` = [WIRE_PROTO]; exact-version machine still rejects (additive) |
| TEST-2417 | tests/remote-client-daemon.test.ts | REQ-009 | Exact daemon-flow command pins WITH `--ws`; path/backend/token rejections; F19 builder byte-identical |
| TEST-2450 | tests/remote-client-daemon.test.ts | REQ-013, REQ-018 | deriveWsToken: conforming as-is; non-conforming maps deterministically into the charset; repeat-stable; distinct ids ⇒ distinct tokens |
| TEST-2418 | tests/remote-client-daemon.test.ts | REQ-009 | `parseBridgeStatus` 4-field shape incl. daemonProto; embedded-in-noise (FINDING-017); malformed/3-field ⇒ null, never throws |
| TEST-2419 | tests/remote-client-daemon.test.ts | REQ-012 | (proto-mismatch, spawned:false) → daemon-protocol-drift naming both proto/version pairs, `daemon-<ws>.json`, idle-out AND manual-pid recovery, sessions-run-on wording; version-mismatch is NOT drift |
| TEST-2420 | tests/remote-client-daemon.test.ts | REQ-012 | (proto-mismatch, spawned:true) → F19 provisionable row; (status unreadable) → drift with "unknown" wording, no throw |
| TEST-2421 | tests/remote-client-daemon.test.ts | REQ-010 | Zero-frame exit-96 → fatal carrying the stderr excerpt; 127 stays absent; 2 stays fatal |
| TEST-2422 | tests/agent-daemon-process.test.ts | REQ-010, REQ-009 | REAL bridge vs scripted listener: byte-exact transparency both directions at odd chunk splits; stdin-EOF and socket-EOF each exit 0; exactly one 4-field status line (spawned:false, all nulls) |
| TEST-2423 | tests/agent-daemon-process.test.ts | REQ-011, REQ-004, REQ-002, REQ-003, REQ-006 | Fresh dir: spawn-then-attach reaches hello; ws-keyed metadata (with proto=WIRE_PROTO) + payload-free ws-keyed log beside the artifact; bridge exits 0 while daemon lives; reattach (spawned:false, backend-mismatch names both); pane kill + disconnect → observed idle self-exit removing the ws-keyed files |
| TEST-2424 | tests/agent-daemon-process.test.ts | REQ-005 | CONV-060 interleaved vector: two concurrent REAL `--daemon` starts on one ws socket → one listener, loser exits 0 without unlinking, BOTH clients complete handshakes |
| TEST-2452 | tests/agent-daemon-process.test.ts | REQ-005 | Reclaim-under-concurrency (FINDING-006): dead-pid remnants + stale socket + two overlapping bootstraps → exactly one listener, loser 0, both handshakes complete |
| TEST-2453 | tests/agent-daemon-process.test.ts | REQ-005 | Ownership-checked cleanup (FINDING-006c): superseded metadata (live foreign pid) survives the daemon's idle-exit byte-untouched; posix socket path not unlinked; successor unharmed |
| TEST-2454 | tests/agent-daemon-process.test.ts | REQ-003 | POSIX-only (skipIf win32): the REAL ws-derived AF_UNIX socket stats 0600 at first observable existence and still accepts (FINDING-005) |
| TEST-2425 | tests/agent-daemon-process.test.ts | REQ-007, REQ-004 | (a) dead-pid remnants reclaimed via the daemon's claim → fresh spawn, prior-generation log truncated; (b) live-pid + never-accepting → exit 96 naming socket + pid + ws-keyed log + the FINDING-018 manual escape hatch (terminate/remove), NOTHING removed |
| TEST-2426 | tests/agent-daemon-process.test.ts | REQ-011 | Daemon with `--pty=node-pty` + `--ws` resolves the 0023 stub from `<agentDir>/node_modules/node-pty` and serves a pane |
| TEST-2427 | tests/integration-daemon-survival.test.ts | REQ-013, REQ-016 | Option ABSENT ⇒ the pre-0024 pinned ledger byte-identically through the AMENDED shim (zero daemon kinds) |
| TEST-2428 | tests/integration-daemon-survival.test.ts | REQ-013, REQ-011, REQ-009 | Opt-in with { workspaceId }: `daemon-attach(127) → upload → daemon-attach` with exactly one ws-attributed `daemon-spawn`; second connect spawns nothing (CONV-051-scoped filters) |
| TEST-2429 | tests/integration-daemon-survival.test.ts | REQ-015 | The headline: close-shape teardown → SAME daemon pid survives at the ws-keyed endpoint → inventory lists the pane → snapshot⊕data byte-exact vs the independent reference |
| TEST-2430 | tests/integration-daemon-survival.test.ts | REQ-015 | F17×F18 weld: pane paused by a stalled client resumes on unbind; the reattach snapshot contains the flushed backlog; fresh flow window serves the reconnect |
| TEST-2431 | tests/integration-daemon-survival.test.ts | REQ-008 | Fake-lane steal over two real bridges: loser's final frame `lease:revoked` + channel exit 0; winner byte-lossless; daemon pid unchanged; steal-back |
| TEST-2432 | tests/integration-daemon-survival.test.ts | REQ-012, REQ-016 | The AUTO-UPDATE rig (D4′ headline): old-APP-version SAME-proto REAL persistent daemon + newer client ⇒ ESTABLISH, same pid, sessions survive the byte-exact F18 oracle, zero uploads, zero respawns |
| TEST-2455 | tests/integration-daemon-survival.test.ts | REQ-012, REQ-016 | The PROTO-drift rig: honest non-destructive fatal naming both pairs FROM the status line despite a preceding diagnostic (FINDING-017) + `daemon-<ws>.json` + idle wording; zero uploads/kills; a proto-compatible raw client attaches (F18 oracle); idle-out → the new version spawns and reaches hello |
| TEST-2433 | tests/integration-daemon-survival.test.ts | REQ-005, REQ-016 | Concurrent first-connects to ONE workspace: both complete, one live recorded daemon, the bound client is served |
| TEST-2434 | tests/integration-daemon-survival.test.ts | REQ-007, REQ-016 | Stale-remnant rig (dead pid + ws-keyed socket file): reclaim with exactly one daemon-spawn, connect completes |
| TEST-2435 | tests/integration-daemon-survival.test.ts | REQ-007, REQ-016 | Never-accepting rig: fatal naming socket path + pid + the manual escape hatch; metadata untouched; live process unharmed |
| TEST-2436 | tests/integration-daemon-survival.test.ts | REQ-013 | Abort inside the spawn-wait: determinate `aborted`, no indeterminate flag, settles well under the deadline |
| TEST-2456 | tests/integration-daemon-survival.test.ts | REQ-018, REQ-016 | Same-host coexistence: two tokens ⇒ two daemons/pids/sockets; interleaved traffic with independent byte-exact oracles; no cross-workspace `lease:revoked`; A idles out on its own timeout while B keeps serving |
| TEST-2437 | tests/agent-daemon-structure.test.ts | REQ-014 | Feature files (incl. ws-token.ts, daemon-handshake.ts) exist; none references SCHEMA_VERSION/userData/ipcMain/contextBridge; SCHEMA_VERSION pinned at 9 |
| TEST-2438 | tests/agent-daemon-structure.test.ts | REQ-003, REQ-014 | No network module beyond node:net in the feature files; no numeric-port listen/connect (path endpoints only) |
| TEST-2457 | tests/agent-daemon-structure.test.ts | REQ-007 | FINDING-016: `src/agent/bridge.ts` carries ZERO unlink/rm surface — the daemon's serialized claim owns all reclaim |
| TEST-2439 | tests/agent-daemon-structure.test.ts | REQ-014 | renderer/preload reference no feature symbol (incl. DAEMON_PROTO_COMPAT/daemon-protocol-drift/deriveWsToken); src/remote-client never imports the agent tree |
| TEST-2440 | tests/agent-daemon-structure.test.ts | REQ-013, REQ-018 | The main-side wiring passes `daemon: { workspaceId … }` — per-workspace, never a bare boolean (the TEST-2355 pattern) |
| TEST-2441 | tests/docs-feature-0024.test.ts | REQ-017 | No living surface (CLAUDE.md, docs/ sans superpowers, .orky/baseline/, src/main/remote/) matches any retired-claim phrasing |
| TEST-2442 | tests/docs-feature-0024.test.ts | REQ-017 | remote-agent.md documents the ws-keyed on-disk contract; remote-workspaces.md keeps `daemon` (TEST-2278), tells the survival story, AND states the per-workspace model; the protocol barrel carries the proto-bump rule; the update-survival consequence is recorded; CLAUDE.md mentions the daemon |

**New rows (revision 3 — the RED set):**

| TEST | File | Covers | Assertion |
|---|---|---|---|
| TEST-2458 | tests/agent-daemon-guard.test.ts | REQ-003 | FINDING-022: `checkSocketPathLength` is the ONE shared guard — byte-measured named error (ASCII + multibyte), win32-exempt IN the guard; the seam's rejection message is byte-identical to the guard's; structural single source (no `AF_UNIX_PATH_MAX =`/re-derived byte comparison outside daemon-guard; ≥2 call sites in daemon-server) |
| TEST-2459 | tests/agent-daemon-process.test.ts | REQ-003 | POSIX-only (skipIf win32): a REAL `--daemon` with an over-long `--socket` on the PRODUCTION bind path exits nonzero PROMPTLY (well under `DAEMON_SPAWN_WAIT_MS`, no claim-loop retries) with the named path-and-limit error on stderr — never EINVAL/ENAMETOOLONG, never a silent 0 (FINDING-022) |
| TEST-2460 | tests/renderer/close-workspace-detach.test.ts | REQ-019 | The pure api-free routing core `routeWorkspaceTeardown`: remote ⇒ ZERO kills + exactly one detach (even pane-less); local ⇒ one kill per pane in order + no detach (corollary a); pane-less local ⇒ nothing |
| TEST-2461 | tests/renderer/close-workspace-detach.test.ts | REQ-019, REQ-014 | Wiring pins: `closeWorkspace` consumes the core with `{ forget: true }` and still clears pane runtime (corollary c); `closePane` keeps `teardownPanes([paneId])` (corollary b); remote-slice threads opts unchanged (no-opts byte-identical); ipc-contract + preload carry ONE additive optional param on the EXISTING channel |
| TEST-2462 | tests/main/remote-manager-forget.test.ts | REQ-019, REQ-014 | Manager vector (canned transport): no-opts disconnect keeps a tracked-panes entry (byte-identical); `{ forget: true }` ends the wire (teardownWire), sends NO `pty:kill`, and removes the entry from `currentStates()` (no ghost); register-remote validates the optional second IPC arg (junk never forges a forget; non-string workspaceId still dropped) |
| TEST-2463 | tests/integration-daemon-survival.test.ts | REQ-019, REQ-015 | Fake-lane end-to-end through the REAL manager over the REAL daemon: close-tab-shaped teardown ⇒ zero `pty:kill` frames + no ghost state + daemon pid survives; reconnect with the same wsToken adopts the pane from inventory and the F18 snapshot⊕data oracle passes byte-exactly (corollary d) |
| TEST-2464 | tests/integration-daemon-survival.test.ts | REQ-019, REQ-006 | The no-reopen tail: an individual pane close sends EXACTLY one `pty:kill` (corollary b — deliberate kill unchanged); after the tab close the empty daemon idle-reaps (ws-keyed metadata gone + pid dead — observed signals, never a bare sleep, CONV-062); no ghost in `currentStates()` |
| TEST-2465 | tests/docs-feature-0024.test.ts | REQ-017 | remote-workspaces.md tells the THREE-GESTURE survival story (D10): quit-app + banner disconnect + close-tab all DETACH; an individual pane close remains a deliberate kill; an unreopened workspace's daemon idle-reaps |

Coverage: every REQ-001..019 is covered by at least one TEST (see `traceability.json`); the
revision-3 deltas map REQ-003(FINDING-022) → TEST-2458/2459 and REQ-019 → TEST-2460..2464
(unit → manager → end-to-end, per the spec's acceptance ladder), with REQ-017's new (c) clause →
TEST-2465. REQ-016's shim rigs are each exercised by at least one scenario (unchanged from
revision 2): stale remnants (TEST-2434), never-accepting (TEST-2435), auto-update daemon
(TEST-2432), proto-drift daemon (TEST-2455), concurrent first-connects (TEST-2433), two distinct
workspaces (TEST-2456), plus the byte-identical legacy ledger (TEST-2427).

## Red gate (CONV-059) — the failing set at this phase (revision 3)

The revision-2 suites are GREEN against the round-2 implementation on disk (they were
implemented and reviewed in round 2); revision 3's failing set is exactly the NEW tests, verified
red by running `npm test`-equivalent vitest invocations on 2026-07-06:

- `tests/agent-daemon-guard.test.ts` — RED (TEST-2458 ×3: `checkSocketPathLength` does not
  exist; the seam's message is not the shared guard's; the limit constant still lives in
  daemon-server).
- `tests/renderer/close-workspace-detach.test.ts` (new file) — RED (TEST-2460 ×3 + TEST-2461 ×3:
  `routeWorkspaceTeardown` does not exist; closeWorkspace still kills remote panes; no additive
  opts anywhere).
- `tests/main/remote-manager-forget.test.ts` (new file) — RED (TEST-2462 ×2: `{ forget: true }`
  is ignored so the tracked-panes entry ghosts; register-remote drops the second arg. The
  no-opts vector legitimately passes — it pins unchanged behavior).
- `tests/integration-daemon-survival.test.ts` — RED (TEST-2463: the close-tab shape leaves a
  ghost `currentStates()` entry — exactly the FINDING-023 gap. TEST-2464 legitimately passes
  today: it pins the corollary-b kill + REQ-006 idle-reap composition, frozen so the REQ-019
  routing cannot regress them).
- `tests/docs-feature-0024.test.ts` — RED (TEST-2465: no living doc states the three-gesture
  story yet).
- `tests/agent-daemon-process.test.ts` — RED **on POSIX runners** (TEST-2459: the production
  bind path currently swallows EINVAL into the 200-attempt claim loop and exits 0 — the test
  times its promptness and fails on 'looping'); on windows-latest it passes-by-skip
  (`describe.skipIf(win32)`, the sanctioned REQ-016 posture; its always-on portable twin is
  TEST-2458, red everywhere).

No frozen suite outside this feature is amended in revision 3: TEST-2283's literal source order
stays satisfiable under the chosen `closeWorkspace` contract (enumerated per the collision
survey — if the implementer finds it unsatisfiable after all, the amendment must loop back
through THIS phase, CONV-012); `tests/fixtures/fake-ssh.mjs` keeps its revision-2 shape
(TEST-2006 network-module scan re-verified green there). TEST-759's `toEqual` pins survive
unchanged (no new `AgentArgs` fields in revision 3).
