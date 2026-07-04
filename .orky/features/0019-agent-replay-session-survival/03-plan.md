# Plan — 0019-agent-replay-session-survival

**Phase:** 3 (plan). **Input:** `02-spec.md` (REQ-001..REQ-013), `.orky/baseline/architecture.md`,
F16's merged `src/agent/` tree. Brownfield fit: extract F16's pane ownership into a store that
outlives a connection; add the replay layer and the two reattach methods; touch NOTHING under
`src/main|preload|renderer`. Pure logic in small modules; all IO stays injected (the F16 pattern),
so the entire survival story runs in-process under vitest.

**Router note:** planner dispatched at tier low (sonnet/medium) per router; this driver environment
has no parallel agent-dispatch tool, so the producer ran driver-inline (0016/0017 precedent).

## Target layout

```
src/agent/
  replay.ts             NEW  createPaneReplay({cols,rows,scrollback}) + HISTORY_LIMIT_DEFAULT(2000)
                             — the ONLY file importing @xterm/headless + @xterm/addon-serialize
  session-store.ts      NEW  createSessionStore({backend,homeDir,scrollback?,replayFactory?})
                             — panes + replay + StatusEngine + metadata cache + subscription
                             routing + bind/unbind/destroy (the survival core)
  session.ts            EDIT per-connection over an optional external store (init.sessions);
                             dispatch gains pty:attach / pty:sessions; unknown-method message
                             names the six-method surface
  validate.ts           EDIT validateAttachParams / validateSessionsParams (same strict style)
src/shared/remote-agent-api.ts  EDIT (additive): AGENT_SESSION_METHODS, AgentSessionMethod,
                                AgentStatusPayload, AgentAttachResult, AgentSessionInfo
package.json            EDIT dependencies += "@xterm/headless": "^5.5.0"
docs/features/remote-agent.md   EDIT (additive survival/replay section)
```

Unchanged (load-bearing): `main.ts`, `args.ts`, `pty-backend.ts`, `fake-backend.ts`,
`node-pty-backend.ts`, `error-codes.ts`, `version.ts`, `vite.agent.config.ts`, `tsconfig*`,
`.orky/profiles/node-app.json`, everything under `src/shared/remote/`, `src/main/`, `src/preload/`,
`src/renderer/`. F16/F15 frozen suites and CHAR tests pass unmodified (REQ-001/REQ-005).

## Core design

### replay.ts (REQ-003, REQ-010)

`createPaneReplay({ cols, rows, scrollback })` wraps `new Terminal({ cols, rows, scrollback,
allowProposedApi: true })` from `@xterm/headless` with a `SerializeAddon` loaded (cast at
`loadAddon` — the addon's d.ts targets `@xterm/xterm`; runtime is shared).

**Write-flush barrier (the one async seam):** xterm parses `write()` asynchronously, chunk by
chunk, invoking each chunk's callback synchronously inside its parse loop after that chunk is
processed (before later chunks). Design: `feed(data)` issues `term.write(data, cb)` where `cb`
records `parsedSeq = seq` (monotonic per feed) and drains waiters; `snapshot()` captures
`targetSeq` = last issued seq and resolves `serialize.serialize()` — executed synchronously INSIDE
the callback of the target chunk — once `parsedSeq >= targetSeq` (immediately, synchronously
serialized, if already parsed). This guarantees: every byte fed BEFORE the `snapshot()` call is in
the result; no byte fed AFTER the call can be (later chunks have higher seq and are unparsed at
serialize time). No empty-string-write special-case reliance, no timers, no `Date.now` (the
determinism scan of REQ-003 stays clean — scheduling is xterm's own).

`resize` → `term.resize`; `dispose` → `term.dispose()` (idempotent guard); exported
`HISTORY_LIMIT_DEFAULT = 2000` (tmux's default `history-limit`).

### session-store.ts (REQ-004, REQ-008, REQ-002b, REQ-006 mechanics, REQ-007)

```
createSessionStore({ backend, homeDir, scrollback = HISTORY_LIMIT_DEFAULT,
                     replayFactory = createPaneReplay })
```

Pane record: `{ handle, replay, replayBroken, shellId, cwd, cols, rows, status, subscribed,
attachHold }`. One `StatusEngine` (imported from `src/main/status/status-engine`) for the store's
life: `onStatus` updates `rec.status` cache then routes; `onCwd` updates `rec.cwd` then routes.
The `lastExit`-key-dropping reshape (`statusPayload`, F16's precedent) lives here and is reused by
attach/list results (typed `AgentStatusPayload`).

- **spawn(args):** live id → `{ adopted: true }`, `subscribed = true` (F16 adopt, no replay of
  history). Fresh: `engine.register(id)` → `replayFactory(...)` (throw → unregister, rethrow) →
  `backend.spawn` (throw → replay.dispose + unregister + rethrow — session maps to
  `spawn-failed`) → wire `onExit`/`onData`, `subscribed = true`, `{ adopted: false }`.
- **onData(id, data):** liveness guard (F16 FINDING-001) → `replay.feed` (try/catch → diag once,
  `replayBroken = true`; the pane LIVES on) → `engine.feed` → route `pty:data` (held if
  `attachHold` active, else sent iff bound+subscribed; while detached NOTHING is constructed —
  REQ-002b).
- **paneExited(id, code):** prune map → `engine.markExit` (final status flows first, F16 order) →
  `engine.unregister` → `replay.dispose` → route `pty:exit` iff bound+subscribed → any in-flight
  attach for the id resolves `unknown-pane`.
- **write/resize/kill(id):** unknown id → `unknown-pane` signal to the session; resize also
  updates `rec.cols/rows` + `replay.resize` (guarded like feed).
- **attach(id):** unknown/`replayBroken` → `{ ok: false, code: unknown-pane | internal }`. Else:
  `subscribed = true`, open `attachHold` (array), `await replay.snapshot()`, RE-CHECK the pane
  still live and the record identical (the repo's session-identity race pattern — an
  exit-during-await yields `unknown-pane`, never a snapshot of a disposed terminal), then resolve
  `{ ok: true, result: { snapshot, cols, rows, cwd, status }, held }` and clear the hold — the
  SESSION sends the res frame then drains `held` as `pty:data` evts in one synchronous
  continuation (nothing interleaves between promise resumption and the sends). Overlapping
  attaches on one pane serialize on a per-pane chain; each processing span opens its own hold, so
  the repaint-exactness oracle (snapshot ⊕ post-res data ≡ stream) holds for every attach
  (degenerate self-overlap relaxes only the "quiet window" letter, never exactness — noted for
  review).
- **list():** live panes sorted by id → `AgentSessionInfo[]` (`attached` = `subscribed` of the
  BOUND connection; all false when just bound).
- **bind(sink):** throw if bound — error names the v1 single-connection bound and F20 (CONV-019
  scope guard). **unbind():** clear sink + ALL subscriptions + discard open holds (their
  connection is gone; the in-flight attach promise resolves into a dead `reply` guard — no send).
- **destroy():** idempotent; kill every pane (exactly once via the F16 exactly-once funnel),
  dispose replays + engine.

### session.ts (REQ-005, REQ-006, REQ-007, REQ-008, REQ-009)

`AgentSessionInit` gains the union: `{ backend } | { sessions }` (external store supplies the
backend). Absent `sessions` → the session creates its OWN store and `destroy()`s it on EVERY end
path — byte-compatible with F16 (TEST-773 et al. green unmodified). Present → end paths call
`store.unbind()` instead (panes survive); `shutdown(code)` taxonomy unchanged (0 clean EOF /
1 fatal). `store.bind(sink)` happens at establishment (a failed handshake never binds).

Dispatch additions: `pty:attach` (validate → `store.attach` → async res via the existing
exactly-once `reply` guard; the ONLY async handler) and `pty:sessions` (validate params === null →
sync `store.list()`). The default-case `unknown-method` message now enumerates all six methods.
Handler-throw → `internal` unchanged.

### validate.ts / remote-agent-api.ts (REQ-006 params, REQ-007 params, REQ-009)

`validateAttachParams`: object, only key `id`, non-empty string — F16 message style (offender +
expectation). `validateSessionsParams`: exactly `null`. `remote-agent-api.ts` (additive only):
`AGENT_SESSION_METHODS = ['pty:attach', 'pty:sessions'] as const` (sorted, disjoint from the
pinned four), `AgentSessionMethod`, `AgentStatusPayload`, `AgentAttachResult`, `AgentSessionInfo`
(typed against `@shared/types`' `TerminalStatus['state']` — stays environment-pure).

## Tasks

### TASK-001 — Vocabulary + result types
**Files:** `src/shared/remote-agent-api.ts`. **Deps:** none. **REQs:** REQ-009 (feeds
REQ-006/REQ-007 shapes).
Additive exports as designed; pinned `AGENT_ERROR_CODES`/`AGENT_PTY_METHODS` byte-unchanged;
purity scan stays green.

### TASK-002 — Replay layer
**Files:** `src/agent/replay.ts`. **Deps:** none. **REQs:** REQ-003 (bounded headless terminal,
barrier-correct snapshot, confinement, determinism scan), REQ-010 (fidelity substrate), REQ-002a
(no window-manager import — trivially by construction), REQ-001.
As designed (seq-callback barrier; `HISTORY_LIMIT_DEFAULT = 2000`; xterm deps confined here).

### TASK-003 — Param validators
**Files:** `src/agent/validate.ts`. **Deps:** TASK-001 (types only, if referenced). **REQs:**
REQ-006 (attach params strict), REQ-007 (sessions params strict), REQ-001.
Same discriminated-union style as the four existing validators; messages per CONV-001/CONV-002.

### TASK-004 — Session store (the survival core)
**Files:** `src/agent/session-store.ts`. **Deps:** TASK-001, TASK-002. **REQs:** REQ-004 (store
lifecycle, caches, replay feed, destroy, replay-failure containment), REQ-008 (subscription
routing; detached silence), REQ-002b (no missed-event queue; the attach hold is the only bounded
in-flight window), REQ-006a/b/d (attach result assembly, exit-during-attach race, hold ordering),
REQ-007 (sorted inventory), REQ-005 (bind/unbind + the F20-retired bind guard), REQ-010 (real
replay path), REQ-011 (the store IS the survival boundary), REQ-001.
As designed above; the StatusEngine moves here from session.ts (register-before-spawn,
markExit-before-exit-event, unregister-on-exit all preserved verbatim).

### TASK-005 — Session integration
**Files:** `src/agent/session.ts`. **Deps:** TASK-003, TASK-004. **REQs:** REQ-005 (init union;
default composition byte-compatible; external composition detaches on every end path), REQ-006 +
REQ-007 (dispatch + async attach res), REQ-008 (bind at establishment; evt routing via the store),
REQ-009 (six-method unknown-method message), REQ-011 (connection A/B over one store), REQ-002
(consumes only the barrel), REQ-001.
Refactor keeps every F16 observable contract; the internal-store path is the shipped `main.ts`
behavior (main.ts unchanged).

### TASK-006 — Dependency + build fold verification
**Files:** `package.json`. **Deps:** TASK-002 (the importer). **REQs:** REQ-012.
`dependencies["@xterm/headless"] = "^5.5.0"` (the 5.x line — NEVER 6.x; the present
`@xterm/addon-serialize ^0.13.0` peers `^5.0.0`); `npm install` to update the lockfile;
`vite.agent.config.ts` needs NO edit (`ssr.noExternal: true` bundles the new deps; `node-pty`
stays the only external) — verified by the phase-4 stdio suite building + running the artifact.

### TASK-007 — Feature doc section
**Files:** `docs/features/remote-agent.md`. **Deps:** TASK-001..006 (documents them). **REQs:**
REQ-013.
Additive "Session survival + replay (F18)" section per the REQ's content list (store/connection
split, methods, `HISTORY_LIMIT_DEFAULT`/2000/`history-limit`, anti-transit stance, open
questions, F20 retirement note). CLAUDE.md row = doc-sync.

## Order

TASK-001 → {TASK-002, TASK-003} → TASK-004 → TASK-005 → TASK-006 → TASK-007. (Phase 4 authors the
new suites against this layout: replay unit vectors, store/survival vectors, session dispatch
vectors, the NEW self-sufficient stdio suite — F16's frozen roundtrip file stays unmodified — and
the docs test `tests/docs-feature-0019.test.ts`.)

## Risks / notes

- **xterm write-callback timing** is the load-bearing subtlety: the seq-barrier design (serialize
  synchronously inside the target chunk's callback) is chosen precisely so no later-chunk parse
  can slip in front; the REQ-003/REQ-010 oracles (reference-terminal equality) catch any drift in
  xterm's contract.
- **Addon typing:** `SerializeAddon` d.ts targets `@xterm/xterm`; `loadAddon` needs one localized
  cast in `replay.ts` (comment why). Runtime is version-locked by the `^5.5.0` pin next to
  `@xterm/xterm ^5.5.0`.
- **Parallel batch 3:** F17 (flow control) also edits `session.ts` (ack/window semantics) and F19
  may touch adjacent files — keep every edit here additive/surgical (new modules, new dispatch
  cases, no reflow of existing code) so the batch merge is tractable. Conflicts are the batch
  layer's to resolve.
- **Memory:** the scrollback bound is the ONLY memory control shipped (per pane:
  rows + 2000 lines); GC of never-reattached sessions is the recorded open question — do not
  invent one.
- **Detached-exit silence** (pane exits with no client): deliberate — the pane vanishes from the
  next inventory; no queue, no synthetic event on reattach (REQ-002's stance, documented in the
  doc section).
- **`pty:spawn` adopt across connections** stays snapshot-less by design; `pty:attach` is the
  replay verb (documented; F21 routes through attach).
