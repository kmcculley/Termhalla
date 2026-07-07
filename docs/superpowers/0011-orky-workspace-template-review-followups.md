# Per-project Orky workspace template (Orky F11) — Review Follow-ups (deferred)

Feature `0011-orky-workspace-template` — **the FINAL roadmap feature.** A composition-only build:
the cockpit is one gesture (palette / templates-menu built-in row / decision-queue button) that
opens a fresh workspace — an Orky pane bound to a tracked project plus a plain terminal at its
root, 50/50 row split — riding the shipped template-instantiation seam
(`workspaceFromTemplate`/`normalizeOrkyBindings`), F9's `orky` pane kind, and the shared
`OrkyRootPicker`. Zero new pane kind, zero `SCHEMA_VERSION` change (stays 8), zero new IPC
surface, zero new write path — plus ONE sanctioned exception: F11 also repairs a real SHIPPED
defect it rides through, not one it introduced. See `.orky/features/0011-orky-workspace-template/`
for the full ledger (`findings.json`, `04-tests.md`, `state.json`).

## The shipped defect F11 found and fixed for ALL templates

The devils-advocate spec-gate pass (FINDING-001, HIGH) traced the shipped `newWorkspaceFromTemplate`
(`src/renderer/store/quick-slice.ts:31-38`) end-to-end and found it never calls `reportAssignment`:
main's authoritative `windows[].workspaceIds` updates ONLY over the `winReport` IPC, and
`applyAssignment` DELETES any in-memory workspace absent from a pushed list. A menu-instantiated
workspace — cockpit or any pre-F11 saved template — was therefore **silently lost**: dropped by
the very next assignment push (reload, window promotion, move/redock) or orphaned on
quit→relaunch, with no error, no log, nothing. This predates F11 entirely; F11 just happened to be
the first feature to make template instantiation a persistent, first-class user flow, so it owned
the repair. The fix is one line in the shared seam: `SliceDeps` gains `reportAssignment: () => void`
(threaded from the existing store-root closure, kept OFF public `State`), and
`newWorkspaceFromTemplate` calls it on the success path after `scheduleAutosave()` — over the
EXISTING `winReport` channel, no new IPC/write path. Every template that has ever been saved in
this app now survives assignment pushes and relaunch, not just cockpits. REQ-002 and REQ-006 both
pin the durability round-trip (stubbed `api.winReport` sees the new wsId → `applyAssignment` echo
RETAINS the workspace) so the acceptance genuinely exercises the gapped boundary instead of a
loader-only reload check that would have masked the loss (exactly FINDING-001's original catch).

## Review timeline

1. **Brainstorm (delegated human).** D1 reuse the shipped workspace-template mechanism + an Orky
   preset generator, D2 single-gesture pick-to-cockpit via the shared `OrkyRootPicker` (+ a
   pre-selected-root path), D3 saveable/reusable/idempotent-friendly, D4 composition + wiring
   only — no new write/dispatch/IPC, D5 honor the accumulated conventions.
2. **Spec-gate devils-advocate pass, one revision (FINDING-001…004, all repaired pre-freeze).**
   - **FINDING-001 (HIGH, the standout catch)** — described above. Resolved by resolved decision 9:
     the shared-seam repair is brought IN scope; REQ-002/REQ-006/REQ-007 all encode it, with the
     durability round-trip pinned at both the store and e2e levels.
   - **FINDING-002 (MEDIUM)** — REQ-005's lifecycle acceptance re-specified the exact vehicle 0010
     FINDING-002 already proved unrunnable in this repo (no jsdom; e2e cannot spy the bundled `api`
     module). Resolved by the CONV-033-sanctioned split: frozen TEST-420's count at the slice seam,
     an anchored structural scan for no-new-fetch-trigger, and the e2e rendered half.
   - **FINDING-003 (MEDIUM)** — REQ-004's pre-selected-root path encoded only three registry
     outcomes, but the shared picker it bypasses renders FOUR (loading/failed/empty/members) — the
     FAILED state fell through to the "not tracked" copy, a false-honesty class (membership is
     UNKNOWN, not absent, when the registry failed to load). Resolved: a fourth normative branch
     surfaces the held `registryError` verbatim, distinct from both the not-tracked and loading
     copy, with a pairwise-distinctness acceptance vector.
   - **FINDING-004 (LOW)** — REQ-002's "doctored blueprint through the SAME call path" vector was
     unreachable through the declared public surface (`newOrkyWorkspace(root)` is the only entry;
     a non-string root is refused before instantiation). Resolved by dropping the unreachable
     vector in favor of the honest pair: the structural pin (only `workspaceFromTemplate` is
     called, no hand-assembly) plus the frozen TEST-461 seam pin.
3. **5-lens review of the implementation** (devils-advocate, ux, quality, +2): **6 more findings**
   (005…010), one HIGH blocker.
   - **FINDING-005 (HIGH, CONV-052)** — subsumed by FINDING-008 below (the e2e HAD been witnessed;
     the "never run" framing was superseded once the actual run surfaced the real defects).
   - **FINDING-006 / FINDING-009 (MEDIUM, duplicate catches from two lenses)** — REQ-005's frozen
     spec prose named a live-PTY e2e vehicle (reported cwd via the status-bar chain, no
     auto-typed transcript) that 0010 FINDING-017 had already determined unrunnable in this
     checkout (node-pty's native ConPTY binding not built; the winpty build script is broken here
     too — a separate human toolchain fix). The frozen TESTS correctly substituted a saved-file
     argv/layout pin, but the spec prose was never amended to match — the CONV-018 class (an
     arbitration recorded only in tests-phase notes leaves the frozen spec contradicting the
     frozen tests). **Documented as a residual, not fixed with a new pin**: 04-tests.md now
     records the substitute vehicle as the honest reading and flags the live-PTY sub-assertion as
     environment-blocked. See "Open items recorded, not fixed" below — this is the genuine
     follow-up.
   - **FINDING-007 (MEDIUM, ux, the focus catch)** — after either picker-mediated cockpit gesture
     (palette or the `tpl-orky-cockpit` row), keyboard focus stranded on `<body>`: the invoking
     chrome (palette / templates menu) unmounted in the SAME batched commit that mounted the F11
     picker, so `useOpenFocusRestore` captured `<body>` as the opener and the close-restore landed
     there — exactly the class of failure `refocusActivePane`/`requestPaneFocus` exist to prevent
     everywhere else in this codebase (every sibling creation flow ends focused and ready to
     type). The frozen spec's "nothing else may move keyboard focus, CONV-046" reads as banning
     the fix, but that inverts CONV-046 — it bans focus-on-mount only for DATA-DRIVEN remounts; an
     explicit user creation gesture is precisely CONV-046's sanctioned case. **Fixed**:
     `newOrkyWorkspace`'s success tail now calls `requestPaneFocus` on the cockpit's terminal pane
     — the ready-to-type half, and the only registered focuser on the cockpit's two panes. All
     three gesture entry points land consistently; the queue-button path (focus never leaves the
     still-mounted button) was already fine and stays untouched.
   - **FINDING-008 (HIGH, quality, the blocker)** — the frozen e2e suite was ACTUALLY run against
     the built implementation (unlike prior features, this did not wait for a devils-advocate
     lens to discover it was never run — CONV-052 was honored proactively) and came back 4
     passed / 2 failed. Both failures were TEST-AUTHORING defects, not implementation defects:
     TEST-677 counted tabs via `[data-tab-id]` while the just-picked workspace's tab was mid-inline-rename
     (rendered as a `ws-rename-<id>` INPUT with no `data-tab-id`) — the count assertion could
     never reach 2 regardless of the durability under test. TEST-678 used `hasText: 'CK'`
     (Playwright's case-insensitive SUBSTRING match), which also matched the always-rendered
     built-in row's own label "Orky project co**CK**pit…" — a strict-mode two-element violation
     that masked a real THIRD defect underneath: the post-reload orky-pane locator was unscoped
     and resolved into a non-active, hidden workspace host. **Fixed** (sanctioned test loopback):
     TEST-677 waits for the rename input to commit before counting; TEST-678 uses an exact-text
     regex instead of the substring `hasText`, plus scopes the post-reload pane lookup to
     `[data-active="true"]`. **Formally witnessed 7/7 green** against `out/` after the fix — the
     REQ-006 durability half (a menu-instantiated template surviving the `did-finish-load`
     re-push) is now actually proven, not merely claimed.
   - **FINDING-010 (LOW, quality)** — REQ-003's four-state cancel clause (loading/failed/empty/
     members) was exercised by frozen tests in only the member-list state. Fixed: three new
     regression pins (TEST-680/681/682) cover cancel from loading/failed/held-empty — deliberately
     GREEN-by-construction (every close path routes through the single
     `resolveOrkyCockpitPick(null)`), added so the acceptance clause is actually exercised rather
     than merely inherited from the shared picker's own contract.
4. **Tests+implement loopback (ESC-001, delegated human decision).** All six findings addressed
   in one pass: the two frozen e2e test-authoring fixes (FINDING-008), the `requestPaneFocus` fix
   (FINDING-007), the four-state cancel coverage (FINDING-010), and the FINDING-006/009 residual
   documented in `04-tests.md` (deliberately not chasing the native node-pty rebuild — a separate
   human toolchain task, per the ESC-001 decision).
5. **Consolidated re-verify.** `npx playwright test tests/e2e/orky-cockpit.spec.ts` — 6/6 green
   against `out/`; `tests/e2e/orky-cockpit-loopback.spec.ts` (the FINDING-007 rendered pin) — green
   after the fix. Full `npm test` — 208 files / 1447 tests, all green, including every frozen pin
   this feature relies on byte-unchanged (TEST-420, TEST-461, TEST-619, TEST-645's mechanical
   file-set inventory). All gates through review are green; the findings ledger is fully resolved.
6. **Doc-sync (this pass).** `traceability.json` verified already complete and accurate: every
   `REQ-001`…`REQ-007` maps to real `TASK-NNN` and `TEST-NNN` ids, and every referenced test id
   (`TEST-649`…`TEST-683`, plus the frozen `TEST-420`/`TEST-461`/`TEST-619` co-owned pins) was
   confirmed present as a real marker in its named file by direct grep — nothing to reconcile.
   `traceability.md` regenerated is unnecessary; the phase-3 stub already carries accurate
   REQ→TASK→file rows and doc-sync adds no new mapping the tests-phase table didn't already
   capture in `04-tests.md`'s coverage table — left as-is (the tests-phase table is the
   authoritative REQ→TEST-id record for this feature; see "Files changed" below for exactly what
   WAS touched). `docs/features/orky-workspace-template.md` (new), `docs/features/workspace-templates.md`,
   `CHANGELOG.md`'s `[Unreleased]` (a distinct `### Fixed` entry for the durability repair, plus
   the `### Added` cockpit entry), and `CLAUDE.md`'s "Where things live" table were all already
   corrected by the implement/review-fix cycle (verified accurate against shipped source and the
   frozen `tests/docs-feature-0011.test.ts`, which passes green — not re-edited). Promoted three
   general lessons to `.orky/conventions.md` as **CONV-054 through CONV-056** (see below).

## The standout lessons

- **The composition-final-feature model.** F11 is the roadmap's last feature and its entire diff
  is wiring: one new pure generator module, one shared-seam repair, and five call sites into
  shipped UI. REQ-007's scope guard (no new `PaneKind`, no `SCHEMA_VERSION` bump, no new IPC, a
  byte-unchanged inventory of the five F9 files) held for the whole cycle with zero collisions —
  the frozen-guard inventory's "no collision" claim was executed, not just asserted. This is the
  same "mount, don't fork" discipline 0010's follow-ups named, applied one layer up: F11 composes
  an entire USER-FACING FEATURE (three entry points, a generated workspace, a durability fix) out
  of machinery every earlier feature already shipped, adding almost no new surface area of its
  own to review.
- **A shipped seam's known defect is the spec-writer's problem, not a deferred note.** FINDING-001
  is this feature's most consequential catch: the original spec routed REQ-006 through a shipped
  seam it correctly flagged as buggy, but let the buggy behavior stand and wrote an acceptance
  (a loader-only restart round-trip) that would pass GREEN over the unfixed defect — masking
  exactly the loss the requirement exists to prevent. The fix wasn't a new write path or IPC
  channel; it was calling an EXISTING helper (`reportAssignment`) that was already in scope at the
  call site. Promoted as CONV-054.
- **The e2e being runnable here after all.** Unlike 0010 (where a devils-advocate lens had to
  discover the frozen e2e had never been run), this cycle ran it proactively and found it was
  ALREADY 4/6 green — the failures were two test-authoring defects (a rename-state tab-count race
  and a substring `hasText` collision) hiding behind a suite that had simply never been executed
  end-to-end before review. Once fixed, the suite needed no live pty at all: the REQ-006
  durability claim rests entirely on the SAVED workspace file's argv/layout (per 0010
  FINDING-017's harness-honesty precedent), not a live terminal transcript. Both locator/pin
  lessons promoted as CONV-055 (focus) and CONV-056 (hasText substring ambiguity).
- **The focus-into-terminal choice.** REQ-005's frozen "nothing else may move keyboard focus"
  clause, read literally, banned the FINDING-007 fix — but CONV-046 (which that clause cites) only
  bans focus-on-mount for DATA-DRIVEN remounts, not an explicit creation gesture. The fix lands
  focus in the cockpit's TERMINAL pane specifically (the ready-to-type half of the two-pane
  cockpit, and the only pane with a registered focuser) rather than the Orky pane — consistent
  with the cockpit's own framing ("work this Orky project": you open a shell at the root and start
  typing).

## Open items recorded, not fixed (genuine follow-ups — not F11 findings)

- **CONV-018 spec-prose amendment (REQ-005, live-PTY vehicle wording).** REQ-005's frozen
  acceptance still literally names a live-terminal-cwd/transcript vehicle that 0010 FINDING-017
  already proved unrunnable in this checkout, and that FINDING-006/FINDING-009 re-confirmed for
  F11's own harness. `04-tests.md` records the honest substitute (saved-file argv/layout pins +
  structural no-launch/no-pty-write bans + the e2e rendered half) as a documented residual, per
  the ESC-001 decision NOT to chase the node-pty/winpty native rebuild. The spec itself is
  **frozen** and this doc-sync pass does not touch it (out of scope per the work order); the
  genuine follow-up is a future maintenance pass that amends REQ-005's acceptance prose to name
  the sanctioned substitute directly in the spec (the CONV-018 propagation this same REQ already
  received once, for its OTHER half — the registryDetail-spy vehicle, FINDING-002) so the frozen
  spec and the frozen tests stop disagreeing about what green means.
- ~~**The standing NUL-file backlog (CONV-050).**~~ **RESOLVED — verified 2026-07-07: `NUL` is
  no longer tracked (`git ls-files NUL` empty) nor present on disk.** Original record follows.
  A Windows-reserved device name (`NUL`) has been
  tracked at repo root since feature 0009, independently re-noticed by 0008, 0009, 0010, and now
  0011 — four consecutive features. It sits outside any single feature's diff scope and never gets
  swept up by a normal fix cycle. **This is the LAST roadmap feature — recommended action: remove
  it with `git rm --cached NUL` as a deliberate, named hygiene step in the FINAL commit** (not a
  silent rider inside a feature-content commit). Left for the human committing this feature's
  work, per the work order.

## Promoted to conventions

Three general lessons from this feature's `propose CONV:` findings promoted to
`.orky/conventions.md` as **CONV-054 through CONV-056** (continuing from 0010's CONV-053, the
current max before this feature):

- **CONV-054** (from FINDING-001) — a spec that routes a requirement through a shipped seam with a
  KNOWN defect must either fix the seam in-scope or state the defect's user-visible consequence in
  that requirement's own normative text and acceptance — never write an acceptance whose green
  result masks the known failure.
- **CONV-055** (from FINDING-007) — a creation gesture that closes a picker/modal into a surface it
  just created must land keyboard focus in the created surface (or a named target), never on
  `<body>` via a focus-restore whose captured opener unmounted together with the invoking chrome.
- **CONV-056** (from FINDING-008) — an e2e locator that must resolve exactly ONE element must not
  rely on a string `hasText` filter (case-insensitive substring matching) that can spuriously match
  inside a sibling row's own label — use an exact-text regex or a unique testid.

FINDING-006/FINDING-009's implicit proposal (a frozen spec whose named acceptance vehicle is
already known-unrunnable must name the sanctioned substitute in the spec itself) was NOT promoted
as a new convention — it is already covered by the existing **CONV-018** (an arbitration that
changes a REQ's required behavior/vehicle must propagate into the spec artifact in the same
loopback, not live only in tests-phase notes); both findings explicitly identify themselves as
instances of the CONV-018 class rather than a new rule.
