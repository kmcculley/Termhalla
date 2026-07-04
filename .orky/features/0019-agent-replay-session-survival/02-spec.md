# Spec — 0019-agent-replay-session-survival

**Phase:** 2 (spec). **Inputs:** `00-intake.md` (roadmap entry F18 verbatim + locked decisions,
human-confirmed 2026-07-04), `.orky/conventions.md`, `.orky/baseline/` (adopted brownfield repo),
F15's merged artifacts (`src/shared/remote/` + frozen suite), F16's merged artifacts (`src/agent/`
+ frozen suites, `docs/features/remote-agent.md`). No `01-concept.md` — app-run mode: the concept
was fixed at roadmap time.

## Concerns

`["networking", "determinism"]`

(`networking` — this feature extends the protocol's live endpoint with the reattach surface:
request/response methods whose correctness is defined by what a DISCONNECTED-then-reconnected peer
can reconstruct, plus an exactly-once/ordering invariant between a snapshot result and subsequent
push events. `determinism` — replay correctness is specified as byte-function equality against an
independent reference terminal, and every survival vector must be a deterministic function of the
scripted input; xterm's ASYNC write queue is the one genuinely async seam and the spec pins its
observable ordering. Always-on lenses per config: security, quality, devils-advocate.)

## Scope summary

Agent-side session survival + replay (locked decision 3), building on F16's merged runtime:

1. **Sessions survive client disconnect/death.** The agent's pane ownership (PTY handles, replay
   terminals, status tracking) moves into a **session store** that outlives any one protocol
   connection. When a connection ends — clean stdin EOF, fatal framing, handshake failure, or
   outbound-write failure — a store-composed runtime DETACHES (panes keep running, output keeps
   being consumed agent-side) instead of killing panes. The default single-connection composition
   (what `main.ts` ships today) keeps F16's kill-on-end behavior byte-identical, so the running
   artifact and every F16 frozen suite are unchanged; survival is engaged by composition (the
   runtime seam F19/F21 will wire to a reattachable transport).
2. **One `@xterm/headless` terminal per PTY, agent-side.** Every pane's output feeds a headless
   terminal with **bounded scrollback** (tmux `history-limit` analog, default 2000 lines) — the
   headless terminal IS the replay history; there is no event queue.
3. **A serialize-addon snapshot on (re)attach.** A new `pty:attach` method returns the
   `@xterm/addon-serialize` snapshot (plus dims/cwd/status) so the client repaints the pane
   EXACTLY; an ordering invariant guarantees snapshot + subsequent `pty:data` events reconstruct
   the stream with no loss and no double-apply.
4. **A session inventory.** A new `pty:sessions` method lists surviving sessions (id, shell, cwd,
   dims, attached flag, last status) so a reconnecting client can identify what to reattach —
   the surface F20's lease and F21's routing build on.
5. **Explicitly NOT the window-manager transit buffer** (locked decision 3's exclusion): no code
   in this feature imports or reuses the same-machine 1024-event/10s-GC handoff primitive, and the
   design deliberately has NO missed-event queue — detached output lives only in the replay
   terminal + status caches.

The running Electron app's behavior stays byte-identical: nothing under `src/main/`,
`src/preload/`, or `src/renderer/` changes; F15's TEST-746 scope guard and every
`tests/characterization-*.test.ts` survive unchanged.

## Baseline note (brownfield fit)

No baseline `REQ-` in `.orky/baseline/inferred-spec.md` is superseded; no characterized behavior
changes; no `SCHEMA_VERSION` change. Shared files touched are exactly: `package.json` (one new
dependency: `@xterm/headless`, matching the repo's existing xterm 5.5 line — the serialize addon
`@xterm/addon-serialize ^0.13.0` is ALREADY a dependency, used by the renderer for local snapshot
stash, peer-satisfied by `^5.0.0`), `src/shared/remote-agent-api.ts` (additive constants/types),
and `docs/features/remote-agent.md` (additive section). `src/agent/session.ts` and
`src/agent/validate.ts` are extended in place; new modules land beside them. The window-manager
transit machinery (`src/main/window-manager*.ts`) is read by NOTHING in this feature.

Known-wart disclosure (CONV-054): F16's disclosed CwdParser OSC 7 heuristic wart carries over
unchanged — survival/inventory cwd vectors use the heuristic-free OSC `9;9` form, as F16's did.

---

## REQ-001 — Placement and isolation: additive agent modules; the running app is untouched

All new code MUST live under `src/agent/` plus the enumerated shared edits (REQ-009 vocabulary,
REQ-012 dependency/build, REQ-013 docs). No file under `src/main/`, `src/preload/`, or
`src/renderer/` may be added, removed, or modified by this feature. F16's structural invariants
extend to the new modules: no `electron`/renderer/preload imports in `src/agent/`; `src/main`
reachable only via `status/`; every `shared/remote` specifier ends with `/protocol`; `node-pty`
confinement unchanged. F15's frozen suite (TEST-745/746/747), F16's frozen suites
(tests/agent-*.test.ts), and every `tests/characterization-*.test.ts` MUST remain green with this
feature applied, WITHOUT edits to those test files.

**Acceptance:** `npm test` green includes the unmodified F15/F16 frozen suites + the CHAR suites;
`git`-level review confirms no src/main|preload|renderer diff (structurally: the existing frozen
guards TEST-746/TEST-751 re-run green, and the new structural suite of REQ-002 covers the
transit-buffer absence); the new modules pass the SAME import-isolation scan as F16's (extended
walk of `src/agent/**/*.ts`).

## REQ-002 — The anti-transit-buffer exclusion: no reuse, no missed-event queue

(a) No file under `src/agent/` may import (statically or dynamically) any module whose specifier
contains `window-manager`, and the feature MUST NOT modify `src/main/window-manager.ts` /
`src/main/window-manager-core.ts` (the 1024-event/10s-GC same-machine transit primitive is the
WRONG tool here — locked decision 3).

(b) The survival design MUST NOT buffer per-pane push EVENTS for a disconnected client anywhere
(no array/queue of `pty:data`/`pty:status`/`pty:cwd`/`pty:exit` frames awaiting a future
connection): while no client is bound, pane output is consumed by the replay terminal + status
caches and the frames are NOT constructed. The ONLY sanctioned in-flight hold is the bounded
per-attach ordering window of REQ-006(d), which exists only while an attach res is being produced
for a CONNECTED client and drains into that same connection.

**Acceptance:** a structural test walks `src/agent/**/*.ts` asserting no import specifier
contains `window-manager` (anchored per CONV-037) and that the two window-manager files are
byte-identical to their pre-feature content is left to review (shared-surface, not test-pinned —
CONV-012/CONV-022); behavioral: the REQ-011 survival round-trip asserts that after a
detached-output phase, a reconnected client receives NO `pty:data` events for bytes emitted while
detached until it attaches (the bytes are reachable ONLY via the snapshot), and the store exposes
no API returning queued frames.

## REQ-003 — The replay layer: one bounded headless terminal per pane

A new module `src/agent/replay.ts` MUST implement the per-pane replay terminal:

- `createPaneReplay({ cols, rows, scrollback })` wraps ONE `@xterm/headless` `Terminal` with the
  `@xterm/addon-serialize` addon loaded, exposing exactly: `feed(data: string)` (write pty output),
  `resize(cols, rows)`, `snapshot(): Promise<string>` (the serialize-addon output), and
  `dispose()`.
- **Bounded scrollback** (tmux `history-limit` analog): the terminal is constructed with
  `scrollback` lines of history; the exported constant `HISTORY_LIMIT_DEFAULT = 2000` (tmux's own
  default) is the default bound. The bound is a store-level option (REQ-004) for future
  configurability; roadmap open question 2 (sizing + GC policy) stays OPEN — no CLI flag, no GC in
  this feature (non-goal).
- **Write-flush correctness:** xterm parses `write()` input ASYNCHRONOUSLY; `snapshot()` MUST
  resolve only after every byte passed to `feed()` BEFORE the `snapshot()` call has been parsed
  (write-callback barrier), so the resolved snapshot reflects all such bytes. Bytes fed AFTER the
  `snapshot()` call MUST NOT appear in that snapshot's result.
- `resize` keeps the terminal's dims equal to the pane's pty dims; `dispose()` frees the terminal
  (a disposed replay is never serialized).
- **Dependency confinement:** the import specifiers `@xterm/headless` and `@xterm/addon-serialize`
  MUST appear in `src/agent/replay.ts` and in NO other `src/agent/` file (the injectable-seam
  discipline of F16's node-pty confinement); `replay.ts`'s own source MUST be
  deterministic-scannable (no `Date.now`/`new Date`/`Math.random`/`setTimeout`/`setInterval` —
  the write-callback barrier is xterm's own scheduling, not ours).

**Acceptance:** unit vectors on `createPaneReplay`: feed a scripted byte sequence, `snapshot()`
resolves to the serialize output of an INDEPENDENTLY constructed headless terminal fed the same
bytes (REQ-010's fidelity oracle); feed MORE lines than `scrollback` + rows → the snapshot
contains the newest content and NOT the oldest evicted line, and the terminal's buffer length
never exceeds `rows + scrollback`; interleave `feed`/`snapshot` → post-call bytes excluded;
resize then feed → reference terminal at the new dims agrees; structural: the two xterm import
specifiers appear only in `replay.ts`, `HISTORY_LIMIT_DEFAULT` equals 2000 and is exported, and
the determinism scan of `replay.ts` passes.

## REQ-004 — The session store: pane ownership that outlives a connection

A new module `src/agent/session-store.ts` MUST own everything a surviving session needs,
extracted from F16's per-connection session:

- `createSessionStore({ backend, homeDir, scrollback?, replayFactory? })` owns: the pane map
  (id → pty handle + replay + metadata), ONE `StatusEngine` (imported from `src/main/status/`,
  exactly as F16 — register-before-spawn, unregister-on-exit, markExit-before-exit-event), and
  per-pane cached metadata: `shellId`, resolved `cwd` (spawn-resolved per F16 REQ-007, then
  updated from the engine's cwd callbacks), current `cols`/`rows` (updated on resize), the last
  engine-emitted `TerminalStatus`, and the attach/subscription state of REQ-008.
- Every pane byte is fed to BOTH the status engine and the pane's replay terminal for the pane's
  entire life, INDEPENDENT of whether a client is bound (this is the survival substance).
- `scrollback` defaults to `HISTORY_LIMIT_DEFAULT`; `replayFactory` defaults to
  `createPaneReplay` and is injectable so unit tests can substitute a deterministic fake replay
  (the real headless path stays covered by REQ-003/REQ-010/REQ-012 vectors).
- Pane exit (self-exit or kill) prunes the pane, disposes its replay, unregisters status — whether
  or not a client is bound. A pruned id is fresh-spawnable again (F16 semantics preserved).
- `destroy()` — the ONLY whole-store teardown — kills every live pane, disposes every replay and
  the engine, and is idempotent. Detach (REQ-005) MUST NOT call it.
- A replay `feed`/`resize` failure MUST NOT tear down the pane or the session: it is diagnosed
  (bounded, CONV-001) and the pane's replay is marked broken — a subsequent attach on that pane
  yields `ok: false`, code `internal` (never a silently-wrong snapshot — CONV-003/CONV-013).

**Acceptance:** in-process vectors with a spy backend: spawn two panes through a store-composed
session, emit output, detach (REQ-005), emit MORE output through the still-live handles — zero
`kill()` calls, both panes still live, replay snapshots (taken via a later attach) include the
post-detach bytes, cached cwd/status reflect post-detach OSC output; exit-while-detached prunes
(a later inventory omits the pane; its id fresh-spawns); `destroy()` kills all panes exactly once
(idempotent on repeat); a throwing fake `replayFactory` feed → pane stays writable/live, attach
on it returns `internal`, other panes' attach still works.

## REQ-005 — Connection lifecycle: default composition unchanged; store composition detaches

`createAgentSession(init)` MUST accept an OPTIONAL external store (`init.sessions?`):

- **Absent (F16's composition, what `main.ts` ships):** observable behavior is BYTE-COMPATIBLE
  with F16 — `endOfInput()` kills every live pane and shuts down with exit 0; fatal framing kills
  panes and exits 1; the session internally creates (and destroys) its own store. Every F16
  frozen agent suite passes UNMODIFIED — including TEST-773's "end of input kills every live pane
  and exits 0". `main.ts`, `args.ts`, and the CLI surface are NOT modified by this feature (the
  reattachable-transport wiring is F19/F21's; a persist flag added here would be dead weight —
  disclosed boundary).
- **Present (the survival composition):** the session is one CONNECTION over a longer-lived
  store. EVERY connection-end path — clean `endOfInput`, fatal framing item, handshake failure,
  outbound encode/write failure (`shutdown` however reached) — MUST detach: clear the
  connection's subscriptions (REQ-008), stop routing events to its `send`, call `shutdown` with
  the same exit code taxonomy as F16, and leave every pane RUNNING with replay + status
  continuing. The store MUST support a subsequent `createAgentSession({ ..., sessions: store })`
  connection performing a FRESH handshake and full method dispatch (sequential connections;
  concurrent binding is F20's lease — binding while another connection is bound MUST throw a
  named error, a scope guard F20 retires through its own tests phase, CONV-019).

**Acceptance:** the F16 frozen suites green unmodified (default path); store-composed vectors:
each end path (clean EOF; fatal decode item; version-mismatch handshake failure; a `send` that
throws) → zero backend `kill()` calls, `shutdown` called with the F16-taxonomy code, and a SECOND
session over the same store handshakes and answers `pty:sessions`; binding a third session while
the second is live throws an error naming the single-connection v1 bound and F20; after
`destroy()` a new session's `pty:sessions` result is `[]`.

## REQ-006 — `pty:attach`: the snapshot-bearing (re)attach method

A new method `pty:attach` (method string defined per REQ-009):

- **Params (strict, REQ-009 stance):** exactly `{ id }`, `id` a non-empty string; unknown keys,
  wrong types, or a non-object → `bad-params` naming the offender (CONV-001/CONV-002); nothing
  executes on rejection.
- **(a) Result:** for a live pane, `ok: true` with
  `{ snapshot: string, cols: number, rows: number, cwd: string, status: {...} }` — `snapshot` is
  the replay terminal's serialize output current as of the request (REQ-003 barrier), `cols`/
  `rows`/`cwd` the store's current metadata, and `status` the cached last `TerminalStatus`
  re-shaped exactly like F16's push payload (the `lastExit` key DROPPED when undefined — F15's
  strict validator rejects `undefined` in JSON positions; same precedent, same reason).
- **(b) Unknown id** (never spawned, exited, or pruned) → `ok: false`, `unknown-pane`, message
  naming the id. A pane that exits AFTER the req arrives but BEFORE the res is sent → the same
  `unknown-pane` failure (never a snapshot of a disposed terminal, never an unhandled rejection).
- **(c) Subscription + idempotence:** a successful attach subscribes the connection to the pane's
  events (REQ-008). Re-attaching an already-subscribed pane is legal and returns a fresh snapshot
  (the client's repaint affordance).
- **(d) Exactly-once ordering invariant (the repaint-exactness contract):** NO `pty:data` event
  for the pane is delivered to the connection between the attach req's dispatch and its res
  frame; bytes that arrive agent-side inside that window are delivered — exactly once, in order —
  as `pty:data` events AFTER the res. Formally: writing the returned `snapshot` into a fresh
  headless terminal (same dims/scrollback) and then applying, in order, every subsequent
  `pty:data` payload for that pane yields the SAME serialized state as a reference terminal fed
  the pane's entire agent-side byte stream. No byte is lost, duplicated, or reordered across the
  attach boundary. This in-flight hold is per-attach, bounded by the res, and is NOT a
  disconnected-client event queue (REQ-002).

**Acceptance:** vectors (store-composed, spy backend, real replay): attach a live pane →
result shape exact, snapshot equals the reference-terminal oracle, `status` has no `lastExit` key
pre-exit and carries it post-`D;<code>`; attach `'nope'` → `unknown-pane` naming `nope`; attach
with params `{ id: '' }` / `{ id: 'a', extra: 1 }` / `null` → `bad-params` naming the offense;
re-attach → second snapshot reflects bytes since the first; the ordering invariant: emit bytes,
send attach, emit MORE bytes before awaiting the res → no data event precedes the res, the
res+events replay-composition equals the full-stream reference serialization; exit-during-attach
(fake replay factory with a test-controlled snapshot barrier) → `unknown-pane`, exactly one res,
no unhandled rejection; pane exited before attach → `unknown-pane`.

## REQ-007 — `pty:sessions`: the survival inventory

A new method `pty:sessions` (method string per REQ-009):

- **Params (strict):** exactly `null` (the no-argument form; F15 requires the `params` key) —
  any other value → `bad-params` saying params must be null.
- **Result:** `ok: true` with an array, sorted ascending by `id` (deterministic wire order,
  CONV-002's boundary honesty: map iteration order is not a contract), of one entry per LIVE
  pane: `{ id: string, shellId: string, cwd: string, cols: number, rows: number,
  attached: boolean, status: {...} }` — `shellId` as requested at spawn, `cwd` the store's
  current resolved value, `cols`/`rows` current, `attached` = THIS connection's subscription
  state (REQ-008), `status` the cached last `TerminalStatus` re-shaped per REQ-006(a). Exited
  panes never appear; no panes → `[]` (empty array, never an error — CONV-002).

**Acceptance:** vectors: empty store → `[]`; two panes spawned, one attached → entries sorted by
id, the attached one `attached: true`, the other `false`; across connections: connection A spawns
`b` then `a`, detaches; connection B's `pty:sessions` → both entries sorted `a`,`b`, BOTH
`attached: false` (subscriptions died with A), cwd/status reflecting detached-phase output; after
`exit 7` in one pane it vanishes from the next inventory; params `{}` or `1` → `bad-params`.

## REQ-008 — Subscription routing: events flow only to a bound, subscribed connection

Per-pane push routing over the store:

- A connection is subscribed to a pane iff it (fresh-)spawned it, ADOPTED it via `pty:spawn` on a
  live id (F16's `ok(true)` semantic — kept, and documented as NOT replaying history; `pty:attach`
  is the snapshot-bearing verb), or attached it via `pty:attach` — during THIS connection's life.
- `pty:data`, `pty:status`, `pty:cwd`, and `pty:exit` for a pane are sent ONLY to the currently
  bound connection and ONLY if it is subscribed to that pane (modulo REQ-006(d)'s attach window).
  While detached (no bound connection) NO frames are constructed (REQ-002).
- Detach clears ALL subscriptions; a new connection starts with none (its inventory is the
  discovery path). F16's single-connection default composition preserves its observable behavior:
  the connection spawns every pane it knows, so routing is unchanged there.
- `pty:exit` of a subscribed pane keeps F16's exactly-once, exit-last contract (final status with
  `lastExit` flows BEFORE the exit event).

**Acceptance:** store-composed vectors: connection B (post-detach) receives ZERO events for
surviving panes before attach/adopt; after attaching pane `a` only, output on panes `a` and `b` →
B receives `pty:data`/`pty:status` for `a` only; B adopts `b` via `pty:spawn` (result `true`,
backend spawn count unchanged) → subsequent `b` output flows, and NO historical bytes are
replayed by the adopt; a subscribed pane's `exit` → status-with-lastExit precedes `pty:exit`,
exactly one exit event, F16's TEST-771-style ordering; unsubscribed pane exits → no exit frame,
next inventory omits it.

## REQ-009 — Vocabulary: additive constants in `remote-agent-api.ts`; closed sets stay closed

`src/shared/remote-agent-api.ts` MUST gain, WITHOUT modifying the pinned `AGENT_ERROR_CODES` or
`AGENT_PTY_METHODS` values (frozen TEST-749 stays green unmodified):

- `AGENT_SESSION_METHODS = ['pty:attach', 'pty:sessions'] as const` (sorted, duplicate-free;
  hand-typed literals are correct here — there are no local `CH` channels for remote-only verbs,
  and TEST-750's anti-literal regex covers only the four local pty methods) and its
  `AgentSessionMethod` type.
- The result TYPES the client (F21) will branch on: `AgentAttachResult`
  (`{ snapshot, cols, rows, cwd, status: AgentStatusPayload }`) and `AgentSessionInfo`
  (`{ id, shellId, cwd, cols, rows, attached, status: AgentStatusPayload }`), where
  `AgentStatusPayload` is the wire re-shape of `TerminalStatus` (the `lastExit`-key-dropped
  form) — types only; no runtime validation surface is added for results (version-locked peers).
- NO new error codes: every error this feature emits is a member of the EXISTING closed five
  (`bad-params`, `internal`, `unknown-method`, `unknown-pane` are the ones used; the set is not
  extended).
- The module stays environment-pure (TEST-750's scan green unmodified).
- `session.ts`'s `unknown-method` message MUST now name the full implemented surface (the four
  pty methods AND the two session methods) — TEST-766's "message contains the received method"
  contract is unchanged.

**Acceptance:** a test pins `AGENT_SESSION_METHODS` deep-equal `['pty:attach', 'pty:sessions']`,
sorted/unique, and disjoint from `AGENT_PTY_METHODS`; the frozen agent-vocab suite passes
unmodified; type-level: `AgentAttachResult`/`AgentSessionInfo` exported (compile-time usage in
the new suites); wire vectors assert every `error.code` emitted by the new methods is a member of
the unmodified `AGENT_ERROR_CODES`; an unknown-method res message names `pty:attach` and
`pty:sessions` alongside the four pty methods.

## REQ-010 — Snapshot fidelity: the pane repaints EXACTLY (the tmux-parity proof)

The serialize snapshot MUST be a faithful function of the pane's byte stream: for any scripted
byte sequence fed through the REAL replay path (store + `createPaneReplay`), `snapshot()` equals
the `@xterm/addon-serialize` output of an independent reference `@xterm/headless` terminal with
the same `cols`/`rows`/`scrollback` fed the same bytes — including:

- multi-line output with CR/LF discipline (the fake shell's `\r\n` convention),
- SGR color/attribute state (a vector with ANSI color output),
- cursor position at a prompt,
- scrollback overflow (older-than-bound lines evicted identically),
- post-`resize` state (reference terminal resized at the same point in the stream).

This fidelity, composed with REQ-006(d)'s ordering invariant, is the feature's definition of
"the pane repaints exactly" — the same oracle the roadmap's batch-6 integration phase re-proves
end-to-end over the stdio loopback.

**Acceptance:** a table of scripted sequences (plain lines; ANSI-colored line; a sequence
exceeding the scrollback bound; a mid-stream resize; OSC 133-marked command cycles from the fake
shell contract) each asserting snapshot === reference-serialization; plus the composition oracle
from REQ-006(d) (snapshot + post-res events ≡ full stream) run on at least the
overflow and colored vectors.

## REQ-011 — The survival round-trip: disconnect → output continues → reattach → exact repaint

The feature's centerpiece acceptance, fully in-process and deterministic (locked decision 1's CI
stance — no ssh, no real pty, no second OS transport; the store IS the survival boundary):

Connection A (store-composed, spy/scripted backend, REAL replay): handshake, spawn pane(s),
drive output. A ends — EACH end-path variant of REQ-005 in at least one vector. Agent-side
output CONTINUES through the still-live handles (the test drives the scripted backend). Then
connection B over the SAME store: fresh handshake (agent hello first, F16 REQ-004 semantics
unchanged), `pty:sessions` → the surviving panes with post-detach cwd/status metadata,
`pty:attach` → a snapshot whose reference-oracle equality INCLUDES the pre-detach AND
post-detach bytes, then live `pty:data` flows for subsequent output, exactly-once per
REQ-006(d). `pty:write`/`pty:resize`/`pty:kill` from B on an attached pane work (the pane is
fully owned, not read-only); B killing a pane prunes it store-wide.

**Acceptance:** the vector(s) above; determinism: the same scripted survival session run twice
yields identical res/evt payload sequences; the F16 stdio suite's clean-shutdown vector still
passes unmodified (default composition kills panes — survival never leaks into the shipped
single-connection artifact behavior).

## REQ-012 — Build/test/typecheck folding: the artifact gains replay; the profile is untouched

- `package.json` `dependencies` MUST gain `@xterm/headless` pinned to the repo's xterm 5.5 line
  (`^5.5.0` — NOT the 6.x line; `@xterm/addon-serialize ^0.13.0`, already present, peers with
  `^5.0.0`). No other dependency changes; `npm ci` on windows-latest CI must keep working (both
  packages are pure JS).
- The agent artifact keeps building through the UNMODIFIED `vite.agent.config.ts`
  (`ssr.noExternal: true` already bundles the new deps into `out/agent/termhalla-agent.cjs`;
  `node-pty` stays the only external). The gate profile `.orky/profiles/node-app.json` stays
  byte-identical (frozen TEST-757 green unmodified — locked decision 10).
- The stdio integration suite MUST be extended (a NEW self-sufficient suite file, keeping F16's
  frozen roundtrip file unmodified): build the artifact on demand through the same config
  (outDir overridden), spawn under plain Node `--pty=fake`, and round-trip WITHIN one
  connection: spawn → scripted output → `pty:attach` → res snapshot matches the
  reference-terminal oracle (proving `@xterm/headless` + serialize addon work inside the bundled
  cjs artifact under plain Node) → `pty:sessions` lists the pane `attached: true` → a second,
  never-attached pane listed `attached: false` (spawned via a second... NOTE: within one
  connection spawn subscribes; the unattached-entry vector instead asserts `attached` reflects
  subscription truthfully — acceptable form: assert the spawned pane's entry is `attached: true`
  and after its `exit` the inventory drops it) → `unknown-method` behavior for a bogus method
  unchanged. Clean shutdown per F16 (stdin end kills panes — the shipped composition).
- `npm run typecheck` continues to cover the new modules via the existing `src/agent` include
  (tsconfig files unmodified; frozen TEST-758 green).

**Acceptance:** structural pins (CONV-022 member-assertions): `package.json` `dependencies`
contains `@xterm/headless` with a `^5.` range and retains `@xterm/addon-serialize`;
`vite.agent.config.ts` byte-content still passes F16's frozen TEST-757 literal pins (file
unmodified); the new stdio suite exists under `tests/`, imports `vite` + `@shared/remote/protocol`
client machinery, passes with `out/` absent; `npm test` (bare) green; `npm run build` emits the
artifact (gate `build` token).

## REQ-013 — Documentation

`docs/features/remote-agent.md` MUST gain a session-survival/replay section documenting: the
store/connection split (survival by composition; the shipped single-connection stdio behavior
unchanged; F19/F21 wire the reattachable transport); `pty:attach` (params, result shape incl. the
`lastExit`-key rule, `unknown-pane` cases, the ordering invariant) and `pty:sessions` (params
null, entry shape, sorted-by-id, live-panes-only); the bounded scrollback default
(`HISTORY_LIMIT_DEFAULT` 2000, tmux `history-limit` analog) and that sizing/GC is a recorded open
question (no GC in v1); the explicit anti-transit-buffer stance (no missed-event queue; the
headless terminal is the history); reboot survival not promised (supervision open question); and
the F20 retirement note for the single-connection bind guard (CONV-019). The CLAUDE.md "Where
things live" row update is doc-sync's edit and deliberately NOT test-pinned (CONV-012/CONV-022).

**Acceptance:** a docs test (`tests/docs-feature-0019.test.ts`) asserts the file exists and
contains the load-bearing literals: `pty:attach`, `pty:sessions`, `HISTORY_LIMIT_DEFAULT`,
`2000`, `history-limit`, `transit`, `F20`, and `snapshot` — existence + key claims only,
doc-sync latitude retained.

---

## Public interface

Additions to the agent's process/wire contract (F16's surface otherwise unchanged):

- **Methods** (strings in `AGENT_SESSION_METHODS`, capability domain `pty`, advertised
  capabilities UNCHANGED):
  - `pty:attach({ id }) → { snapshot, cols, rows, cwd, status }` — serialize snapshot +
    current metadata; `unknown-pane` when not live; ordering invariant REQ-006(d).
  - `pty:sessions(null) → AgentSessionInfo[]` — sorted by id, live panes only.
- **Shared vocabulary** (`src/shared/remote-agent-api.ts`): `AGENT_SESSION_METHODS`,
  `AgentSessionMethod`, `AgentAttachResult`, `AgentSessionInfo`, `AgentStatusPayload`.
- **Agent library surface** (in-repo composition seam for F19/F20/F21; not a public npm API):
  `src/agent/session-store.ts` — `createSessionStore({ backend, homeDir, scrollback?,
  replayFactory? })` with `destroy()`; `createAgentSession(init)` gains optional
  `sessions` (external store) — one bound connection at a time (the F20-retired guard).
  `src/agent/replay.ts` — `createPaneReplay`, `HISTORY_LIMIT_DEFAULT`.
- **Executable behavior:** `out/agent/termhalla-agent.cjs` unchanged in flags and lifecycle
  (single connection; stdin end kills panes, exit 0) — survival is engaged by composition, not
  by the v1 CLI.

## Non-goals (explicit)

- **No window-manager transit buffer reuse** and no disconnected-client event queue (REQ-002).
- **No flow-control semantics** — `ack`/`window` stay inert exactly as F16 left them (F17, in a
  parallel worktree, owns retiring that pin; this feature does not touch the reserved-frame
  handling).
- **No ssh, tunnel, daemonization, socket listener, supervision, or CLI persist flag** — F19 /
  recorded open question 1. Reboot survival is NOT promised.
- **No attach lease, steal, or concurrent connections** — F20 (the bind guard names it).
- **No client routing, renderer/main/preload wiring, or UI** — F21; TEST-746 survives unchanged.
- **No scrollback GC policy** for never-reattached sessions (open question 2 — recorded, not
  resolved; the bound itself is the only memory control this feature ships).
- **No new frame types, no F15 barrel extension, no new agent error codes, no capability
  changes** (the pty domain already covers the new methods).
- **No SCHEMA_VERSION change, no `.orky/` interaction, no gate-profile edit.**

## Open questions

None requiring escalation. Two spec-level derivations are documented rather than re-opened:
(1) `HISTORY_LIMIT_DEFAULT = 2000` adopts tmux's own default as the bounded-scrollback analog the
roadmap names, with the store option (not a CLI flag) as the override seam — sizing policy stays
the recorded open question; (2) survival-by-composition (the shipped stdio artifact keeps F16's
single-connection lifecycle; the store seam is the deliverable F19/F21 wire to a reattachable
transport) — this is the roadmap's own boundary: F18 is agent-SIDE machinery, F19 owns transport,
and the batch-6 integration phase proves the composed end-to-end story.
