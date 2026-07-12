# Orky status awareness (Orky 0004) — Review Follow-ups (deferred)

Feature `0004-orky-status-awareness` shipped READY after a two-iteration review with a
human-approved spec loop-back (**ESC-001**) that replaced the original `state.json.phase`
detection model with the **gate-based full-roll-up** model. Every **CRITICAL / HIGH** finding and
both **contract violations** (FINDING-DA-003 popover clean-done retention, FINDING-UX-001
suppressed failure border) were **resolved in-feature**; the flagship FINDING-DA-001 (needs-human
keyed on a `state.json.phase` the real pipeline never sets) was fixed and pinned against ground
truth. See the per-finding records in
`.orky/features/0004-orky-status-awareness/findings.json`.

A third loop-back (tests→implement, iteration 2) then **fixed FINDING-DA-007** (MEDIUM — the
clean-DONE `null`-phase chip over an empty popover) at the human's election before approval:
`chipLabel`/`OrkyFeatureRow` now render `phase ?? 'done'`, and the chip is selected from the
`inPopover`-eligible set so it is always consistent with the popover (pinned by TEST-018/056/057).

The 13 non-blocking items below were **deferred, not fixed**, and are tracked here so they are not
lost. None is release-blocking; none is a contract violation.

## Deferred follow-ups

### MEDIUM

- **`findOrkyRoot` uses synchronous `statSync` on the main event loop** (FINDING-QUAL-004 /
  FINDING-PERF-004, `src/main/orky/find-orky-root.ts:13`). The bounded upward walk (up to maxDepth+1 =
  9 calls) is the one synchronous fs outlier in an otherwise `fs/promises`-only tracker; a workspace
  restore that binds many panes at once issues P × up-to-9 synchronous stat syscalls back-to-back,
  briefly blocking the loop that also routes PTY data. **Why deferred (accepted constraint):**
  `findOrkyRoot` is called before the session slot is claimed, and a frozen test (TEST-025/044)
  asserts the **synchronous return shape** (`findOrkyRoot(cwd): string | null`, not a Promise);
  converting it to async would require editing a frozen test, which is out of scope for doc-sync. The
  cost is bounded (≤9 stats per pane, local fs) and one-time per bind. **Recommended fix (when the
  test freeze lifts):** convert to `fs.promises.stat` + `await findOrkyRoot(...)`, or memoize root
  resolution per directory.

### LOW

- ~~**Ancestor-walk depth cap of 8 yields a location-dependent blank** (FINDING-DA-006,
  `src/main/orky/find-orky-root.ts`, REQ-012)~~ — **RESOLVED 2026-07-09** (quality/polish batch),
  via the raise-the-cap option: the default is `DEFAULT_ORKY_ROOT_MAX_DEPTH` = 32, documented in
  the feature doc, still finite and still stopping at the filesystem root. Pinned by
  `tests/main/find-orky-root-depth.test.ts`; the frozen 0004 suite passes explicit depths
  everywhere it cares and pins nothing about the default. (The stop-on-`.git` alternative was
  rejected: `.orky/` can legitimately sit above a nested git repo, and stopping at the first
  `.git` would blind those panes.)

- **Redundant non-active ternary in the `isStalled` call** (FINDING-QUAL-007,
  `src/shared/orky-status.ts:133`). `isStalled(isActive ? f.feature : null, f, isActive ? lastTickAt :
  null, ...)` passes dual-null for the non-active case, but `isStalled` already gates on
  `activeFeatureSlug === null` at its first line, making the `isActive ? lastTickAt : null` ternary
  redundant defensive coding. **Recommended fix:** simplify to `isStalled(isActive ? f.feature : null,
  f, lastTickAt, ...)`.

- **Orky chip truncates its most actionable tail** (FINDING-UX-004,
  `src/renderer/components/PaneToolbar.tsx:48`). The chip is `maxWidth:240` with
  `text-overflow:ellipsis` over `feature · phase · gate N/M · ●k open`; ellipsis clips the END, so on
  narrow panes the gate N/M progress and `●k open` count — the at-a-glance signal — are hidden first
  while the less-actionable slug is always kept. **Recommended fix:** middle-ellipsis the slug (or drop
  the phase word) before dropping the trailing gate/count.

- ~~**Popover has no Escape-to-dismiss / focus management** (FINDING-UX-005)~~ — **RESOLVED
  2026-07-07** (Escape half): OrkyPopover now renders through the shared `MenuSurface`
  (2026-07-06 quality-audit Group C #10), which owns Escape-dismiss + right-click dismiss for
  every popover. The focus-management half (focus moved into the popover, Tab containment)
  remains the pre-existing Git/Process-popover posture — revisit only if a keyboard-first flow
  needs it (SplitMenu is the in-repo precedent for a trapped popover).

- **Per-feature reads are sequential** (FINDING-PERF-003, `src/main/orky/orky-tracker.ts:104-115`).
  The reread loop awaits each feature's `state.json` then `findings.json` back-to-back, so total read
  latency grows linearly with feature count even though the reads are independent. **Recommended fix:**
  `Promise.all` over slugs (state + findings per feature in parallel), keeping the post-await
  session-identity re-check after the batch resolves.

- **No mtime gate on re-reads** (FINDING-PERF-005, `src/main/orky/orky-tracker.ts:122-131`). `readJson`
  reads each file in full on every coalesced event with no mtime gate; `findings.json` grows across a
  long pipeline (multiple reviewer lenses appending) and is fully re-read/parsed each time. The 1 MiB
  size cap (REQ-025) bounds the worst case, but unchanged files are still re-read. **Recommended fix:**
  gate re-reads on mtime so unchanged files are skipped, and/or re-read only the feature(s) whose files
  actually changed.

- **O(P²) on-bind emit amplification for a shared root** (FINDING-PERF-006,
  `src/main/orky/orky-tracker.ts:78,185`). The per-root dedup is correct, but `watch()` unconditionally
  re-reads and fans the result out to EVERY pane already bound to the root, so P panes binding in quick
  succession (a workspace restore resolving to one `.orky/`) cost 1+2+…+P = O(P²) `safeSend` pushes vs
  the prior O(P). Each push is a cheap precomputed object, so impact is bounded and one-time per bind
  burst. **Recommended fix:** on a bind where the root already has a live watcher, emit the cached last
  status to only the joining pane instead of re-reading and fanning out.

- **File-level symlink residual** (FINDING-SEC-006, `src/main/orky/orky-tracker.ts:162-170`). The
  SEC-004 fix `lstat`s and skips a symlinked `features/<slug>` **directory**, but does NOT guard a
  symlinked `state.json` / `findings.json` **file** inside a real directory — `readFile` follows it
  transparently. Impact is constrained: the 1 MiB cap still applies (stat-before-read), all data
  reaches the UI via React text-escaping (no HTML injection), and the attacker needs write access to a
  subdirectory of the user's own project. The spec (REQ-025c) explicitly permitted `lstat + skip` and
  did not mention file-level symlinks, so this is a spec-permitted residual, not a coding error.
  **Recommended fix:** extend the per-file `lstat`-skip to `state.json`/`findings.json`, or switch the
  directory guard to a `realpath`-prefix check (closes both vectors and the TOCTOU window in one call).

- ~~**`STALL_THRESHOLD_MS = 120_000` is an uncited Termhalla heuristic** (FINDING-PROV-002)~~ —
  **RESOLVED 2026-07-12, both halves.** Upstream (Orky v0.44.0, commit `9443bee`): `liveness` now
  resolves its idle threshold ITSELF (caller → `watchdog.idle_threshold_seconds` config → canonical
  default 3600 s), reports which source applied (`thresholdSource`), and the canonical default is
  published in `gatekeeper contract` under `watchdog.default_seconds` — exactly the "no canonical
  default" gap this finding named. Termhalla side (same day): the 120 s heuristic is **dropped** —
  `STALL_THRESHOLD_MS` is now the canonical `3_600_000` ms, and the new pure `resolveStallThresholdMs`
  (`src/shared/orky-status.ts`) applies Orky's own config → default resolution PER ROOT in both the
  engine re-read (`orky-root-engine.ts`; `config.json` is now a watched target file, so editing the
  threshold re-derives the verdict live) and the one-shot detail path (`orky-root-detail.ts`). A
  caller-injected `thresholdMs` still wins (the `caller` source), so every threshold-injecting test
  is untouched. Pinned by `tests/main/orky-stall-threshold.test.ts`. This supersedes 0004's REQ-003
  "default MUST be 120_000 ms" spec sentence (the frozen spec text stays as the historical record;
  this ledger is the supersession record). `findings.json` closed via `resolve-finding`.

- **Id-collision tiebreak nondeterminism for malformed features** (FINDING-DET-002,
  `src/shared/orky-status.ts:281`). `compareFeatures`'s final tiebreak is the feature id, but
  `orkyFeatureStatus` collapses a missing `feature` field to the constant slug `'(unknown)'`. Two
  DISTINCT malformed features (both `feature` missing, both `lastActivityAt === 0`) compare EQUAL on
  every key, so the comparator is not a strict total order for them; the tracker feeds features in
  filesystem-dependent `readdir` order, so the `[0]` chip winner varies across hosts from identical
  bytes (the same class FINDING-DET-001 closed, via the id-collision edge). Well-formed features have
  distinct slugs and are unaffected. **Recommended fix:** fold the on-disk directory slug (distinct
  even when `feature` is missing) into the last tiebreak, or sort `slugs` in the tracker before
  mapping.

- **Dangling reference to an uncommitted intake draft** (FINDING-DOC-003,
  `.orky/features/0004-orky-status-awareness/00-intake.md:15`). `00-intake.md` cites its intake as
  "verbatim, from `.orky/0004-intake-draft.md`", but that source is an untracked throwaway
  (`?? .orky/0004-intake-draft.md` in git status), not in the checked-in tree. Low impact — the
  verbatim content is already inlined. **Recommended fix:** remove the dangling reference or commit the
  draft.

## Promoted to conventions

None. No finding in `findings.json` carried a `propose CONV:` flag, and none of the deferred items is a
general rule binding future features (each is a one-off specific to the Orky tracker/mappers), so no new
`CONV-NNN` was appended to `.orky/conventions.md`.

## Resolved in-feature (not deferred)

- FINDING-DA-001 (CRITICAL — needs-human keyed on a `state.json.phase === 'human-review'` the real
  pipeline NEVER sets, so a run blocked on a human silently never fired) — needs-human is now
  gate-derived (autonomous gates through `doc-sync` passed AND `human-review` gate not passed); fixtures
  TEST-008/009 pin the real on-disk shape.
- FINDING-DA-002 (HIGH — live phase read from the lagging `state.json.phase`, so an actively-running
  feature reported idle and could never stall after the implement gate) — live phase is now
  `active.json.phase` for the active feature / `gateFrontier` for the rest.
- FINDING-DA-003 (HIGH, contract — popover filter `kind !== 'idle'` retained every clean-done feature
  forever) — `inPopover()` excludes clean-done; TEST-018 pins the exclusion.
- FINDING-UX-001 (HIGH, contract — the failure border lost to the idle `!important` toolbar rule and
  rendered nowhere for the canonical failed-AND-idle pane) — failure CSS made `!important`, idle rule
  excludes `.term-failure`; TEST-051 + e2e TEST-055.
- FINDING-DA-004/DA-005 (MEDIUM — heartbeat-only `lastActivityAt` broke the recency tiebreak;
  non-active features could read `busy` forever) — `lastActivityAt` sourced from `max(gates[*].at)`;
  non-active features derive kind from `gateFrontier` and are never `busy`.
- FINDING-SEC-001/002/003/004/005 (security — non-string IPC arg main-process crash; cross-window
  status disclosure; unbounded readdir/readFile DoS; symlink directory escape; unescaped CSS selector)
  — IPC arg validation + per-window sender ownership, 200-dir cap, 1 MiB stat-before-read cap,
  directory `lstat`-skip, `CSS.escape`; TEST-044/045/046/047/050/054.
- FINDING-PERF-001/002 (MEDIUM — no `.json` event filter; P watchers + P× read amplification for one
  root) — `isTargetFile()` filter; per-root watcher+read dedup fanned to panes; TEST-048/049.
- FINDING-DET-001 (MEDIUM — tz-less timestamps parsed in machine-local time, host-dependent stall) —
  `parseOrkyTimestamp` treats tz-less as UTC; TEST-042.
- FINDING-QUAL-002/003/005/006 (consistency — `unwatch` early-return guard; double-normalize in
  `isStalled`; `orkyChipStatus` exported-but-unused, now wired into the minimized tray; `reason`
  spec/type drift) — all resolved.
- FINDING-DOC-001/002 (doc-drift — `.orky/baseline/architecture.md` missing the `src/main/orky/`
  subsystem + `orky:status` channel; placeholder `github.com` links in the feature doc + CHANGELOG) —
  reconciled.
- FINDING-PROV-001 (MEDIUM, data-provenance — `ORKY_PHASES` comment collided with Orky's separate
  9-entry "Canonical phase order" `PHASE_ORDER`, risking a future re-sync corrupting `gateM`/`gateN`) —
  provenance caveat corrected in source + `docs/features/orky-status.md`; TEST-052.
</content>
</invoke>
