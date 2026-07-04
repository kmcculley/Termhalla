# Tests — 0019-agent-replay-session-survival

**Phase:** 4 (tests). **Input:** `02-spec.md` (frozen), `03-plan.md`. All suites are vitest under
`tests/` (the profile's `testRoots`), authored RED against the planned layout — nothing under
`src/agent/replay.ts` / `src/agent/session-store.ts` exists yet, `session.ts` lacks the methods,
and `@xterm/headless` is not yet installed (TASK-006). Test ids are feature-scoped
(`TEST-19xx` for feature 0019) so the parallel batch-3 features (F17/F19) cannot collide with
this range.

## Oracle conventions

- **Reference-terminal oracle (REQ-003/REQ-010/REQ-011):** an independently constructed
  `@xterm/headless` `Terminal({ cols, rows, scrollback, allowProposedApi: true })` +
  `SerializeAddon`, fed the same bytes via awaited `write(chunk, cb)` — the replay terminal MUST
  be constructed with exactly these options for the equality oracle to be meaningful (documented
  here so the implementation keeps option parity).
- **Composition oracle (REQ-006d/REQ-010/REQ-011):** `serialize(fresh ← snapshot ⊕ post-res
  pty:data payloads) === serialize(fresh ← entire pane byte stream)`.
- **Determinism normalization (REQ-011):** `TerminalStatus.since` rides `Date.now()` through the
  reused engine (F16 accepted that default); run-twice equality compares frame sequences with
  `status.since` normalized to 0. Nothing else is normalized.
- **In-process settling:** xterm parses asynchronously; vectors poll with a bounded `until()`
  helper (no assertions on time — determinism of CONTENT, not of scheduling).

## Suites

| File | Tests | REQs |
|------|-------|------|
| `tests/agent-replay.test.ts` | TEST-1901, TEST-1902 | REQ-003, REQ-010 |
| `tests/agent-session-store.test.ts` | TEST-1903, TEST-1904, TEST-1905 | REQ-004, REQ-008, REQ-005, REQ-002(b) |
| `tests/agent-attach-sessions.test.ts` | TEST-1906, TEST-1907, TEST-1908 | REQ-006, REQ-007, REQ-009 |
| `tests/agent-survival.test.ts` | TEST-1909 | REQ-011 (+ REQ-002b behavioral) |
| `tests/agent-replay-structure.test.ts` | TEST-1910 | REQ-002(a), REQ-003 (confinement/determinism/constant), REQ-012 (dep pin), REQ-001 |
| `tests/agent-stdio-attach.test.ts` | TEST-1911 | REQ-012 (artifact round-trip; re-proves REQ-006/007 over the wire) |
| `tests/docs-feature-0019.test.ts` | TEST-1912 | REQ-013 |

- TEST-1901 — replay unit: barrier correctness (pre-call bytes in, post-call bytes out), bounded
  scrollback eviction, resize parity, `HISTORY_LIMIT_DEFAULT === 2000`, idempotent dispose.
- TEST-1902 — fidelity table: plain CRLF, ANSI SGR, scrollback overflow, mid-stream resize,
  OSC 133 command cycle — each `snapshot === reference`; composition oracle on the overflow and
  ANSI vectors.
- TEST-1903 — store survival: detach kills nothing; post-detach output lands in replay + caches;
  exit-while-detached prunes + id respawnable; `destroy()` idempotent, kills exactly once;
  replay-failure containment (throwing factory → pane lives, attach `internal`, others fine).
- TEST-1904 — subscription routing: zero events pre-attach for a reconnected client; per-pane
  routing; adopt (`pty:spawn` on live id) = `true`, no respawn, NO history replay; subscribed
  exit ordering (status-with-lastExit before `pty:exit`, exactly once); unsubscribed exit silent
  + pruned.
- TEST-1905 — lifecycle: store-composed end paths (clean EOF / fatal decode / handshake
  version-mismatch / a throwing `send`) each: zero kills, F16 exit-code taxonomy, store
  re-bindable; the single-connection bind guard throws naming F20 (CONV-019 retirement note in
  the test header); `destroy()` → next connection's inventory `[]`. (Default-composition
  compatibility is guarded by F16's own frozen suites remaining green unmodified — REQ-001/005.)
- TEST-1906 — `pty:attach`: strict params table; result shape (snapshot/cols/rows/cwd/status;
  `lastExit` key absent pre-exit, present post-exit); reference equality; re-attach freshness;
  the ordering invariant (no `pty:data` between req dispatch and res; held bytes after res;
  composition oracle); exit-during-attach → `unknown-pane`, exactly one res; attach on exited /
  unknown id → `unknown-pane` naming the id.
- TEST-1907 — `pty:sessions`: strict null params; sorted-by-id entries with
  shellId/cwd/cols/rows/attached/status; cross-connection `attached:false` after detach;
  detached-phase cwd/status reflected; exited pane omitted; empty `[]`.
- TEST-1908 — vocabulary: `AGENT_SESSION_METHODS` pinned `['pty:attach','pty:sessions']`,
  sorted/unique/disjoint from the four pinned pty methods (whose own frozen pin stays
  unmodified); unknown-method message names all six methods; every emitted `error.code` ∈ the
  unmodified `AGENT_ERROR_CODES`; result types importable.
- TEST-1909 — survival round-trip: A spawns/drives, ends (clean and fatal variants); output
  continues detached; B handshakes fresh (hello-first unchanged), lists, attaches (snapshot
  covers pre+post-detach bytes via reference oracle), receives live data exactly-once
  (composition oracle), writes/resizes/kills; run-twice determinism (normalized `since`).
- TEST-1910 — structural: no `window-manager` import specifier under `src/agent/**` (CONV-037
  anchored); `@xterm/headless`/`@xterm/addon-serialize` specifiers confined to exactly
  `replay.ts` (anti-vacuity: exactly one importer, and the file exists); determinism scan of
  `replay.ts`; `package.json` dep pin `@xterm/headless` `^5.` + `@xterm/addon-serialize`
  retained.
- TEST-1911 — stdio artifact round-trip (new self-sufficient suite; F16's frozen roundtrip file
  untouched): build via the SAME `vite.agent.config.ts` (outDir override), spawn plain Node
  `--pty=fake`; spawn → echo → `pty:attach` (result shape + reference-oracle equality — proves
  the bundled headless+serialize work under plain Node) → `pty:sessions` (`attached: true`,
  dims) → `exit 0` → inventory empty → unknown-method message names the session methods → clean
  shutdown exit 0 (shipped composition unchanged).
- TEST-1912 — docs literals: `pty:attach`, `pty:sessions`, `HISTORY_LIMIT_DEFAULT`, `2000`,
  `history-limit`, `transit`, `F20`, `snapshot`.

## RED expectation (gate `tests-red`)

`npm test` fails now: the five new agent suites error on unresolved `../src/agent/replay` /
`../src/agent/session-store` / missing `@xterm/headless`, the stdio suite gets `unknown-method`
for `pty:attach`, and the docs test misses every literal. Every pre-existing suite (F15/F16
frozen, CHAR) stays green — the implement gate flips the new ones without touching them.
