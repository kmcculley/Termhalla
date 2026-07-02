# 0012 — Quick-capture new-work inbox (write)

## Phase 2 — Specification (revision 2 — review-gate loopback, ESC-001)

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 global capture modal,
D2 exclusively via F7's `submitWork` dispatch, D3 reuse the F9 substrate + guard inventory before
pinning, D4 pre-selected-root entry path for F10 reuse, D5 CONV-013 result honesty). The five
brainstorm decisions are FIXED; this spec makes them testable and resolves the brainstorm's
non-blocking spec-time items (chord default, modal copy, one-field vs title+detail) inline (see
"Resolved spec-time decisions"). REQ-IDs are stable; never renumber.

**Revision 1** repairs FINDING-001..006 (all left `open` for the gatekeeper): the capture path is
re-grounded on the Orky plugin's NEW `feedback submit` local-inbox injection command (shipped
upstream, plugin v0.28.0 — `C:/dev/Orky/plugin/feedback/feedback.js:278-299` `submitItem`,
`C:/dev/Orky/plugin/feedback/cli.js:71-88` `submit`), which closes the outbox dead-end FINDING-001
exposed. That re-grounding adds **REQ-013**: a MINIMAL, in-place amendment to F7's
`doSubmitWork` (invoke `submit`, not `emit`) with a designed CONV-019 supersession of the exact
frozen dispatcher pins it touches (inventoried below). FINDING-002 (http shapes), FINDING-003
(REQ-002 acceptance contradiction), FINDING-004 (StrictMode vectors), FINDING-005 (picker visible
heading), and FINDING-006 (CONV-008 sweep scope) are repaired in place in their REQs.

**Revision 2 (review-gate loopback — ESC-001, resolved 2026-07-02)** amends in place per the
resolved human decision: the F7 supersession inventory becomes **SEVEN** entries (prose-only entry
7: the validate-suite scope comment + TEST-290 it-title mechanism prose — FINDING-020, executing
FINDING-007's repair through the spec as CONV-019 requires) and the CONV-023 argv-pin grep is
widened repo-wide over `tests/**`; NEW **REQ-014** completes result honesty (a spawn-level failure
is a DEFINITE non-dispatch, `cli-timeout` is reserved for genuine wall-clock timeouts, and a
renderer invoke-rejection is the INDETERMINATE renderer-scoped `ipc-failure` — FINDING-009/
FINDING-019); REQ-002 gains the always-visible keyboard-hint line (Enter-in-title KEPT) and
overflow containment (FINDING-012/FINDING-017); REQ-009 pins failure-clearing on draft-edit/
root-change (FINDING-008, consolidating FINDING-015), the close-while-in-flight DETACHED-outcome
rule with never-suppressed failure reporting (FINDING-013), and per-kind RENDER vectors via the
e2e stub's `mode.json` (FINDING-014); REQ-013's validation clause adds the `projectRoot`
`rejectFlagLike` guard (FINDING-011); REQ-006/REQ-012's StrictMode acceptance mechanism is
corrected to the structural pin that actually guards the class (FINDING-018); REQ-004's acceptance
is honestly scoped — slice seam + structural pin now, four render/dispatch clauses inherited by
name by F10's e2e (FINDING-022); REQ-001 requires the in-code comment on the CommandPalette
`currentCwd` reshape (FINDING-021). FINDING-016, FINDING-010, and FINDING-023 are recorded,
rationaled residuals (see "Review residuals"). No REQ is renumbered; REQ-014 is ADDED.

This is the write half of tier **T4** and the FIRST renderer consumer of the `orkyAction:*`
write-capable dispatch surface F7 shipped consumer-less. It adds **zero** new IPC channels, zero
new preload methods, zero new main-process modules, zero renderer-side CLI invocation paths, and
zero persisted state (no `SCHEMA_VERSION` touch). The renderer half is chrome only — a global
capture modal plus the single store-level entry point (`openOrkyCapture(root?)`) that F10's
OrkyPane "inject" later calls verbatim (D4). The main-process changes are REQ-013's in-place
amendment of F7's already-hardened `submitWork` action (validated, allowlisted, audited, per-root
serialized, CLI-only writes — all unchanged except REQ-013's additive `projectRoot` guard): its
single hard-coded CLI invocation switches from the outbox-writing `feedback emit` to the
inbox-writing `feedback submit`, so a captured item lands where the orchestrator's `apply`
actually reads — plus REQ-014's in-place honesty repair of the shared CLI runner's error
classification (spawn failure ≠ timeout), which F12 is the first feature to make renderer-reachable.

## Concerns

`security` `ux` `quality`

- `security` — first consumer of a WRITE surface: every submission is gesture-tied (REQ-006), the
  request is built from exactly the modal's own state with no extra fields and no client-side
  transformation that could smuggle around or diverge from F7's validation (REQ-005, REQ-010); no
  new IPC/preload/CLI path exists to audit — the main-process diff is REQ-013's in-place
  dispatcher amendment (which keeps validation/allowlist/audit/serialization byte-equivalent apart
  from the additive `projectRoot` flag-like guard, FINDING-011, and introduces no
  request-selectable subcommand) plus REQ-014's runner error-classification repair; raw
  title/detail never logged renderer-side (F7's audit stores lengths only — REQ-005).
- `ux` — keyboard flow end-to-end (invoke → pick → type → submit → result) with a CONV-030
  target-guarded key matrix (REQ-007) and a visible hint line making the fast-capture keys
  discoverable (REQ-002, FINDING-012); disabled-feedback / error / indeterminate states specific
  and actionable, draft never lost on failure, and no outcome ever silently dropped — including a
  dispatch abandoned by closing the modal (REQ-009, FINDING-013); capture latency feel: the modal
  opens with no IPC on mount, and F7's audit is already off the dispatch critical path (REQ-012,
  Verified contract).
- `quality` — reuse of the F9 substrate (OrkyRootPicker + the shared load-state/focus hooks), never
  forked (REQ-003); result-shape fidelity keyed on F7's own `ok`/`dispatched`/`errorKind`, never
  re-derived (REQ-008/REQ-009); the frozen-guard inventory is definitive and grep-documented:
  every renderer-adjacent guard stays green byte-unchanged, and the ONLY superseded pins are the
  enumerated SEVEN (six F7 dispatcher-pin amendments + one prose-only validate-suite repair), each
  amended intent-preservingly at the tests phase per CONV-019 (REQ-011). `determinism` is n/a
  beyond the picker ordering already pinned upstream (concept). `data-provenance` is n/a — no
  factual/reference data is bundled.

## Resolved spec-time decisions (with rationale)

1. **Command + chord** — one new rebindable `CommandId`/`Shortcut`/`PaletteAction`
   `'capture-orky-work'`, COMMANDS entry
   `{ id: 'capture-orky-work', label: 'Capture Orky work item', category: 'General', defaultChord: mod+shift+u }`
   plus a `buildCommandItems()` palette entry ("Capture Orky work item…", search terms covering
   `capture orky work idea inbox`). **Why `mod+shift+u`:** every plausible mnemonic collides —
   `mod+shift+o` (queue), `mod+shift+n` (notes), `mod+shift+w` (close-workspace), `mod+shift+i` is
   Electron's `toggleDevTools` role accelerator shipped in Termhalla's own menu (`menu.ts:29`),
   `mod+shift+c` is the terminal-copy convention. `u` is unoccupied in `COMMANDS`
   (`keybindings.ts:39-53`), passes `isValidRebind`, and is not a reserved `Ctrl+1..9` digit.
   CONV-005 is n/a (no native menu item is added).
2. **Two fields: title + detail** — mirrors `SubmitWorkRequest` exactly (`types.ts:513-519`): a
   single-line **title** input (required) and a multi-line **detail** textarea (optional). No
   `phase` field (a human capture has no originating pipeline phase; the key is omitted) and no
   `feature` field (captures are project-level; the app-planner triages them — F7's optional
   feature slug stays unused by this surface). When the detail textarea is empty (zero-length) the
   `detail` key is OMITTED from the request — F7's `optionalString` would accept `''`
   (`orky-action-validate.ts:74-79`), but an empty body is absence, not content.
3. **Flow: picker → form, sequential modals** — invoked WITHOUT a pre-selected root, the capture
   flow first opens the SHARED `OrkyRootPicker` (choose the target project), then the capture form
   with the chosen root displayed; invoked WITH a pre-selected root (D4), the form opens directly.
   Sequential (never stacked) modals ride `Modal.tsx`'s existing modal→modal handoff
   (`Modal.tsx:57-76`). The form shows the target root and a "Change project" button reopening the
   same picker (cancel there returns to the form with the previous root intact). Cancelling the
   INITIAL picker abandons the capture — no form, nothing sent.
4. **OrkyRootPicker reuse is additive-only** — the picker gains OPTIONAL, default-preserving props
   (`ariaLabel?`, `heading?`, and `z?` if the stacking flow needs it) so the capture flow can
   label the dialog "Capture work for a tracked Orky project" AND retitle its visible header to
   match — the accessible name and the visible copy must never diverge (FINDING-005). Defaults
   preserve F9 byte-identically: `ariaLabel` defaults to the existing
   `"Bind Orky pane to a tracked project"` (`OrkyRootPicker.tsx:64`) and `heading` defaults to the
   existing visible header `"Bind to a tracked Orky project"` (`OrkyRootPicker.tsx:66`); every F9
   flow renders byte-identically with the props omitted. No pinned string leaves the file, no
   banned string (`orkyAction`, a clock, a mutation symbol, `localeCompare`) enters it — TEST-434
   pins testids / `registryError` / the `/track/i` empty copy / `Escape` only (verified
   `orky-pane-structure.test.ts:120-133`: neither the aria-label nor the header literal is
   pinned), so TEST-430/431/433/434 stay green byte-unchanged (REQ-003, REQ-011).
5. **Testid namespace: `orky-capture`** — `orky-capture` (the form card), `orky-capture-title`,
   `orky-capture-detail`, `orky-capture-target`, `orky-capture-change-root`, `orky-capture-submit`,
   `orky-capture-cancel`, `orky-capture-hint` (the static keyboard-hint line — revision 2,
   FINDING-012), `orky-capture-error` (carrying `data-error-kind`). Deliberately contains neither
   `orky-action` nor `orkyaction` as a substring, so frozen TEST-282's locators can never match it
   even if a future run opens the modal (REQ-011).
6. **Result copy (D5)** — success: **"Captured — queued in `<root>`'s Orky inbox for triage."**
   Ground truth for the wording (Verified contract, re-grounded per FINDING-001): via REQ-013 the
   dispatch invokes `feedback submit --kind work.request`, which writes the item DIRECTLY into
   `<root>/.orky/feedback/inbox/IN-*.json` (`feedback.js:294-298`) — the exact store the
   orchestrator's `apply` pulls and drains (`cli.js:95-110` → `applyItems`,
   `feedback.js:352-383`) into a `.orky/backlog.jsonl` `WORK-*` `status:'pending'` record awaiting
   planner triage (`feedback.js:365-368`, `:308-314`). "Queued in the inbox for triage" is now
   literally true. Still: "Captured/queued", never "accepted/started/created a feature" — capture
   ≠ accept ≠ apply ≠ triage.
7. **Component/slice placement** — new files `src/renderer/components/OrkyCaptureModal.tsx` and
   `src/renderer/store/orky-capture-slice.ts` (names indicative), hosted app-level in `App.tsx`
   beside the existing `OrkyRootPicker` host (`App.tsx:186-190`). MANDATORY placement constraint:
   the `orkySubmitWork` call — and any occurrence of the string `orkyAction` — lives ONLY in F12's
   own new files, never in any of the five F9_FILES frozen TEST-433 sweeps (REQ-011). REQ-013's
   amendment lives in-place in `src/main/orky/orky-action-dispatcher.ts` (an existing F7 file; no
   new `src/main/` file); REQ-014's runner amendment lives in-place in
   `src/main/orky/orky-cli-runner.ts`.
8. **Draft lifetime** — the draft (title/detail/chosen root) lives only while the modal is open:
   preserved across an in-modal failure (REQ-009), DISCARDED on close/cancel, fresh on reopen (D1
   "fast in, fast out; no persistent UI"). This includes closing while a dispatch is in flight —
   the draft loss there is ACCEPTED AND PINNED (ESC-001/FINDING-013: close cannot abort the
   non-idempotent write; the detached outcome still reports per REQ-009). Re-invoking the command
   while the modal is open is a no-op (never a draft-destroying reset) (REQ-006).

## Upstream fit + frozen-guard inventory (definitive — CONV-019/022/023)

**Grep patterns and scope used** (CONV-023; run 2026-07-02, repo-wide over `tests/**` including
`tests/e2e/**`): `orkyAction|orkySubmitWork|submitWork` (13 files, every hit classified below);
`orky-action|orkyaction` (the TEST-282 locator literals); `COMMANDS` (keybinding-table pins);
`RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(` (the live
renderer sweep's own pattern, `registry-no-renderer-ui.test.ts:40`); the argv-pin pattern
`work\.request|--payload|--type` and `args\)\.toEqual\(\['emit'`. **Revision 2 (FINDING-020,
executing FINDING-007's scope repair):** revision 1 ran the argv-pin pattern over `tests/main/**`
only — an under-scoped sweep that violated CONV-023's repo-wide rule and missed test prose in
`tests/shared/`. The pattern was re-run REPO-WIDE over `tests/**` and its universe fully
classified: the only stale-mechanism prose it found is `tests/shared/orky-action-validate.test.ts`
(the `:38-44` scope comment + TEST-290's it-title, `:324`) — now supersession entry 7 below; every
other `--payload`/`--type` hit is either a legitimate pin of resolveEscalation's still-live emit
path (`orky-action-dispatcher.test.ts:39,:180`; `orky-action-dispatcher-submit.test.ts:251-259`),
a mechanism-agnostic runner byte-preservation vector (`orky-cli-runner.test.ts:70-73`), or a
banned-argv assertion (`orky-action-dispatcher-submit.test.ts:118-126,:131-138`). No
`SCHEMA_VERSION`/`toBe(7|8)` sweep is needed — F12 persists nothing and touches no persisted shape.

**Result (revision 2): NO renderer-adjacent frozen guard is superseded; the ONLY superseded pins
are the SEVEN enumerated in the "F7 frozen-pin supersession inventory" below** (six F7
dispatcher-pin amendments REQ-013 touches + one prose-only repair in the validate suite), each
amended intent-preservingly at the tests phase (CONV-019, `conventions.md:91-95` — F12 IS the
designed retiring/first-consumer feature for the submitWork dispatch path). The renderer-side
inventory yields four binding constraints (all normative in REQ-011):

1. **TEST-282** (`tests/e2e/orky-action-dispatch.spec.ts:48-59`, 0007 REQ-017 — "no element carries
   an orky-action-scoped test id" at fresh launch). NOT a collision: it pins 0007's OWN
   ships-no-UI DoD against a fresh launch, where F12's modal is closed; and F12's testid namespace
   (decision #5) contains neither locator substring, so the guard cannot match F12 chrome even
   open. It MUST stay green byte-unchanged. *Flagged upstream gap:* its header names no retiring
   feature (CONV-019 postdates the habit but predates 0007's tests) — F12 records here that it
   deliberately does NOT retire it; the guard's invariant ("0007 itself shipped no UI") stays true
   forever.
2. **TEST-433** (`tests/renderer/orky-pane-structure.test.ts:105-117`, F9 REQ-013) bans the literal
   `orkyAction` (plus mutation symbols, `child_process`, `orkyWatch`) in the five F9_FILES
   (`orky-pane-structure.test.ts:19-25`: `orky-pane.ts`, `OrkyPane.tsx`, `OrkyRootPicker.tsx`,
   `orky-pane-slice.ts`, `orky-root-detail.ts`). Binding placement constraint (decision #7): F12's
   dispatch code lives only in new F12 files; `OrkyRootPicker.tsx` may gain only strings that match
   none of TEST-433's banned set. The guard stays green byte-unchanged. Its eventual supersession
   belongs to **F10** (the pane's "inject" action IS an orkyAction consumer inside an F9 file),
   not F12.
3. **TEST-434** (`orky-pane-structure.test.ts:120-133`) pins OrkyRootPicker's testids, verbatim
   `registryError`, actionable `/track/i` empty copy, `Escape`, and `not.toContain('registryRoots(')`
   — additive-only default-preserving props (decision #4, now including `heading?`) keep every
   `toContain` satisfied; neither the aria-label nor the visible-header literal is pinned
   (verified), so the `heading` prop needs no supersession.
4. **TEST-362/363** (`tests/shared/registry-no-renderer-ui.test.ts:40-70`) sweep ALL of
   `src/renderer/` live — F12's new files are automatically in scope and MUST NOT reference the
   registry mutation surface. Untouched, stays green. Its designated retiring feature is the
   track-project gesture (its own header), not F12.

**Additive-safe, verified open-form (no collision):** TEST-196..203
(`tests/shared/orky-action-ipc-contract.test.ts` — structural greps of 0007's own additions only,
CONV-012-compliant; F12 edits at most a stale comment in `ipc-contract.ts`, outside every asserted
pattern); TEST-281 (`orky-action-dispatch.spec.ts:25-46` — preload round-trip via `driveStatus`
against an untracked root; REQ-013 never touches preload/registrar/driveStatus — unaffected);
TEST-325..329 (`keybindings-toggle-queue.test.ts` — `COMMANDS.find`/iterate, open-form; TEST-326's
belt-and-braces loop over ALL defaults means F12's new chord must be conflict-free or that F6 guard
goes red, hence REQ-001's conflict acceptance; TEST-329 reads `item!.label` off the un-narrowed
`PaletteItem` union — the `label?` field on dir items must stay declared, per `quick.ts:90-97`'s
own note); `tests/keybindings.test.ts` + `tests/shared/minimize-keybinding.test.ts` +
`tests/characterization-shared.test.ts:30` (symbolic/iterating, open-form);
`tests/quick-commands.test.ts:8` (`arrayContaining`, open-form); TEST-274
(`register-orky-action.test.ts:91` — registrar delegates the channel to a MOCKED
`dispatcher.submitWork(req, senderId)`; blind to the CLI invocation, unaffected); TEST-290
(`orky-action-validate.test.ts:324` — validator-only: title/detail/phase may start with `--`;
its ASSERTIONS stay green byte-unchanged — REQ-013's validation diff touches only `projectRoot`,
a different field, FINDING-011 — but its it-title and the suite's `:38-44` scope comment stated
the emit-era `--payload` mechanism as the acceptance rationale, a stale claim of the CONV-008
class: that PROSE is supersession entry 7 below, per FINDING-020/FINDING-007);
`orky-action-result.test.ts` + `orky-action-result-codex-001-regression.test.ts` (the shared total
mapper — REQ-013 keeps `orky-action-result.ts` BYTE-UNCHANGED, so its whole frozen suite stays
green); `orky-action-audit.test.ts` (action-name/shape pins only; the audit path is unchanged);
`orky-action-queue.test.ts` (queue mechanics, subcommand-blind); `docs-feature-0007.test.ts`
(pins only the lowercase literal `submitwork` at `:26` — the CONV-008 doc updates below are safe);
plus F6/F9/0014 structural suites whose orkyAction mentions are their own scope-guard bans
(classified under items 2-4 above or asserting files F12 never touches).

### F7 frozen-pin supersession inventory (REQ-013 — CONV-019, tests-phase, intent-preserving)

Every frozen pin the `emit → submit` dispatch-path change touches — six assertion-level dispatcher
amendments plus one prose-only repair (entry 7) — verified by reading the tests. Each amendment is
made AT THE TESTS PHASE in the same change as REQ-013, never silently during implementation, and
each preserves its guard's original intent:

| Pin | Location | Why it breaks / goes stale | Intent-preserving amendment |
|---|---|---|---|
| TEST-237 | `tests/main/orky-action-dispatcher.test.ts:210-216` | fixture keys `fakeRunCli({ emit })` (the harness dispatches on `args[0]`, `:77-89`) and models an http-mode emit success `{ok:true,mode:'http',sent:true}` — the dispatcher now invokes `submit`, and http is a refusal | enabled fixture becomes a `submit` handler returning the file-mode receipt `{ok:true,mode:'file',id:'IN-…',kind:'work.request',path:'inbox/…'}`; still asserts `{ok:true, path:'feedback', feedback:'enabled', dispatched:true}` |
| TEST-238 | `orky-action-dispatcher.test.ts:218-226` | disabled fixture models emit's exit-0 `{ok:true,mode:'noop'}` and pins `calls == ['emit']` | disabled fixture becomes submit's REAL refusal: exit **1** + `{ok:false,mode:'noop',error:'feedback is disabled — …'}` (`feedback.js:280-282`, `cli.js:88`); still asserts the DISTINCT `{ok:false, feedback:'disabled', dispatched:false, errorKind:'feedback-disabled'}`, non-empty error, `calls == ['submit']`, gatekeeper NEVER called |
| TEST-293 | `orky-action-dispatcher.test.ts:675-697` | serialization fixture throws on `args[0] !== 'emit'` | identical divergent-spelling serialization assertions keyed on `'submit'` with the file-mode receipt; the queue-key intent (normalizeProjectRoot fallback key) untouched |
| TEST-298 | `tests/main/orky-action-dispatcher-codex-001-regression.test.ts:96-104` | internal-error vector modeled as emit exit 0 + `{ok:false,mode:'noop',error:'disk full'}` on an `emit` handler | re-expressed on the submit path: a genuine internal error (e.g. exit 2 + `{error:'disk full'}` — cli.js's outer catch shape `cli.js:153-156`) maps to `cli-error` carrying "disk full" verbatim and is NEVER `feedback-disabled` — the misdiagnosis guard's intent survives byte-for-byte |
| TEST-300 | `orky-action-dispatcher-codex-001-regression.test.ts:120-126` | the "genuine no-op" `{ok:true,mode:'noop'}` shape no longer exists on the submit path | the genuine DISABLED shape is now exit 1 + `{ok:false,mode:'noop',error}` → still the distinct `feedback-disabled` non-dispatch outcome, `calls == ['submit']` |
| TEST-267 | `orky-action-dispatcher.test.ts:724-734` | stays literally green (`'submit'` is in neither the forbidden nor required set) — but its invariant "ONLY the four hard-coded subcommands" becomes silently false | MUST be amended deliberately, not passed accidentally: `'submit'` joins the REQUIRED hard-coded literals (five, none request-selectable); the forbidden set (incl. `enable-feedback`/`disable-feedback`) is unchanged. `'emit'` stays required — `doResolveEscalation` still uses it (`orky-action-dispatcher.ts:161`) |
| header argv map | `orky-action-dispatcher.test.ts:37` (comment) | documents `submitWork: ['emit','--app',…,'--type','work.request',…]` | comment updated to the `submit --json` argv (not an assertion; updated for CONV-008 honesty) |
| **TEST-290 prose + suite scope comment** *(entry 7 — prose-only, FINDING-020/FINDING-007)* | `tests/shared/orky-action-validate.test.ts:38-44` (the suite's scope comment) + `:324` (TEST-290's it-title) | both stated the emit-era `--payload` element as the RATIONALE for accepting `--`-prefixed title/detail/phase — after REQ-013 those fields travel in submit's `--json` element, making the frozen prose a false mechanism claim (the CONV-008 class); revision 1's `tests/main/**`-scoped grep missed it | prose-only repair: both name the `--json` item element for submitWork (resolveEscalation legitimately keeps `--payload`); ASSERTIONS BYTE-UNTOUCHED — TEST-290 stays green and the `--`-acceptance safety property carries over identically |

**Verified NOT superseded** (each re-checked against the new path): TEST-239
(`orky-action-dispatcher.test.ts:228-237` — invalid-args before ANY CLI call; asserts
`calls.length === 0`, its inert `emit` handler key is never invoked), TEST-252 (`:381-390` —
missing feedback CLI → `orky-cli-not-found`, subcommand-independent), TEST-268, TEST-291/292/294
(record/resolve paths untouched), TEST-297/299 (resolveEscalation's emit path is UNCHANGED —
REQ-013 amends only `doSubmitWork`).

**Stale-claim retirement (CONV-008, `conventions.md:37`):** `ipc-contract.ts:178-179` ("no
renderer UI consumes these yet (D1/REQ-017)") becomes false when F12 ships. F12 MUST update that
comment (e.g. "first renderer consumer: the 0012 quick-capture modal; submitWork only") and sweep
`docs/**`, `CLAUDE.md`, and `.orky/baseline/**` for every other phrasing of the **orkyAction**
no-consumer claim, updating each — never only the one enumerated file. **Scope (FINDING-006):**
the sweep targets the orkyAction/write-capable claim class ONLY. The registry-mutation claim at
`.orky/baseline/architecture.md:117-118` ("the mutation surface (`registry:addRoot`/`removeRoot`)
still has no renderer consumer") matches the naive pattern but stays TRUE after F12 (F12 never
touches the mutation surface — REQ-003/TEST-362): it is explicitly ALLOWLISTED and MUST remain
byte-unchanged. REQ-013 additionally makes the emit-flow description of submitWork stale: F12 MUST
update `docs/features/orky-action-dispatch.md` (and the dispatcher's own header comment,
`orky-action-dispatcher.ts:17-35`) wherever they state that submitWork rides `feedback emit` /
writes a `work.request` EVENT to the outbox — the frozen docs test pins only the lowercase literal
`submitwork` (`tests/docs-feature-0007.test.ts:26`), so these edits touch no frozen assertion. No
frozen test pins the ipc-contract comment text (TEST-198 asserts only the CH-block lines and the
absence of `onOrkyAction`).

**Upstream inconsistencies flagged (not F12's to fix, but F12 must not mask them):**

- **F7 imposes NO length bounds on `title`/`detail`** (`validateSubmitWorkRequest`,
  `orky-action-validate.ts:115-142` — `requireNonEmptyString`/`optionalString` only; `submitItem`
  likewise checks only a non-blank title, `feedback.js:287-288`). The item travels as ONE JSON
  argv element (REQ-013), so a pathologically large detail fails at spawn/OS level (Windows's
  CreateProcess command-line limit is ~32,767 characters). **Correction (revision 2 —
  FINDING-009):** revision 1 claimed that failure "surfaces through F7's own total mapping as
  `cli-error`/`cli-unparseable` — honestly, not silently"; that claim was FALSE against the
  shipped runner, whose catch-all maps EVERY non-numeric-exit execFile error — spawn failures
  included — to `{exitCode:null, timedOut:true}` (`orky-cli-runner.ts:34-35`), i.e. the
  INDETERMINATE `cli-timeout`. REQ-014 pins the repair (spawn failure → DEFINITE), making the
  honesty claim true. Per CONV-003 and D2, F12 still adds NO client-side cap and NO truncation
  (REQ-010); a length bound, if ever wanted, belongs in F7's validator as its own tested change.
- `optionalString` accepts `detail: ''` — F12 omits the key instead (decision #2).
- TEST-282 names no retiring feature (item 1 above).
- ~~file-mode outbox `work.request` events have no shipped consumer~~ — **RESOLVED upstream**
  (FINDING-001's root cause): plugin v0.28.0 ships `feedback submit`/`submitItem`
  (`feedback.js:262-299`, `cli.js:71-88`), the sanctioned local-client inbox injection path.
  REQ-013 adopts it. Residual upstream cosmetics: the CLI usage line (`cli.js:150`) omits
  `submit`/`apply`/`backlog`/`project`; and the http spool (`feedback.js:156-174`) still has no
  shipped retry — irrelevant to F12 since `submit` REFUSES http mode outright rather than
  spooling (FINDING-002).
- An OLDER plugin (< v0.28.0) has no `submit` subcommand: `cli.js` prints usage to stderr and
  exits 2 with EMPTY stdout → F7 maps it to `cli-unparseable` ("produced unexpected output
  (0 bytes)") — an honest, non-silent failure. Pinned as a REQ-013 vector; the docs update above
  records the plugin-version floor.
- The `mode:'noop'` disabled-refusal discrimination (REQ-013) is a cross-repo shape coupling with
  no shared schema or contract test (FINDING-010) — a recorded residual, see "Review residuals".

## Verified contract (pinned upstream shapes — read from source, not memory)

Confirmed against shipped source (revision 2 re-verified 2026-07-02, both repos). If a datum is
not listed here, F12 does not rely on it.

- **The write surface F12 consumes (the ONLY one):** preload `orkySubmitWork(req)`
  (`src/preload/index.ts:85`) → channel `CH.orkyActionSubmitWork = 'orkyAction:submitWork'`
  (`ipc-contract.ts:63`; `TermhallaApi` method at `:181`) → registrar handler gated on
  `isKnownWindowSender` BEFORE the dispatcher (`register-orky-action.ts:38-41`; unknown sender gets
  the literal `REJECTED_SENDER` `{ok:false, dispatched:false, errorKind:'unknown-sender'}`,
  `:10-16`) → `OrkyActionDispatcher.submitWork` (`orky-action-dispatcher.ts:108-112`, core
  `doSubmitWork` `:177-224`, amended per REQ-013). **The preload bridge already exists — F12 adds
  no preload/registrar/IPC code and no absence-of-preload guard blocks it** (TEST-281 proved the
  round-trip at 0007's DoD).
- **Server-side layering F12 must NOT re-implement (unchanged by REQ-013 apart from the additive
  FINDING-011 guard):** validation first (`orky-action-validate.ts:115-142` — object shape,
  `projectRoot` non-empty string — and, per REQ-013 revision 2, not `--`-prefixed — optional
  `feature` slug-confined `:26-37`, `title` REQUIRED non-empty `:128-129`, `detail`/`phase`
  optional strings `:131-135`; every rejection carries its own field-specific message, CONV-001;
  NO length bounds — see flag above); then the registry-roots allowlist
  (`orky-action-dispatcher.ts:182-183`, membership via the shared `normalizeProjectRoot` key
  `:288-293` — a non-member root gets `root-not-allowed` with "project `<root>` is not a tracked
  Orky project; add it via the registry first"); then feedback-CLI location (`:192-193`,
  `orky-cli-not-found` + actionable `describeMissingCli` text); then per-root serialization
  (`queue.run(normalizeProjectRoot(queueKey))`, `:195-196`); then the single hard-coded
  invocation — per REQ-013 now
  `submit --app <root> --json <JSON{kind:'work.request',title[,detail][,phase][,feature]}>`
  (the item is ONE `JSON.stringify`'d argv element consumed via `cli.js:76`'s `--json` branch;
  title/detail never travel as raw argv, preserved byte-for-byte by the runner —
  `orky-cli-runner.test.ts:70-73` — which is why they need no `--`-prefix rejection, unlike
  `feature`).
- **The `feedback submit` CLI universe (plugin v0.28.0 — the COMPLETE result-shape enumeration,
  FINDING-002):** `cli.js:71-88` builds the item (or takes `--json` verbatim), calls
  `submitItem` (`feedback.js:278-299`), prints its result, and exits `r.ok ? 0 : 1` (`cli.js:88`).
  Unlike `emit` (best-effort, ALWAYS exit 0, `cli.js:22`/`:54-70`), `submit` is **NOT
  best-effort** — a refusal is loud (`feedback.js:271-277`):
  - **file-mode success (the ONLY success shape):** exit 0 +
    `{ok:true, mode:'file', id:'IN-…', kind:'work.request', path:'inbox/IN-….json'}`
    (`feedback.js:294-298`) — the item is durably in `<root>/.orky/feedback/inbox/`, in exactly
    the shape `applyItems` consumes. There is no sent/spooled ambiguity: the sent/spooled
    universe belongs to `emit` and is GONE from this feature's success keying.
  - **disabled refusal:** exit 1 + `{ok:false, mode:'noop', error:'feedback is disabled — the
    write path requires enable-feedback (an audited decision, ADR-027)'}` (`feedback.js:280-282`).
  - **http-mode refusal:** exit 1 + `{ok:false, mode:'http', error:'submit writes the LOCAL file
    inbox; this app uses the http control plane — submit via its inbox API instead'}`
    (`feedback.js:283-285`) — an http-configured project (`feedback.js:48-53` infers `http` when
    `endpoint` is set) is a REFUSAL, never a silent spool.
  - **validation refusal:** exit 1 + `{ok:false, mode:'file', error:'work.request requires a
    non-empty title'}` (`feedback.js:287-288`) or unsupported-kind (`:291-292`).
  - **internal error:** exit 2 + `{error: <message>}` (the outer catch, `cli.js:153-156`).
  - **older plugin (no `submit`):** usage to stderr, empty stdout, exit 2.
- **How F7's total mapper handles those shapes (`mapCliRunToResult`, BYTE-UNCHANGED — the pin
  REQ-013's discrimination rests on):** timeout → `cli-timeout` (`orky-action-result.ts:29-35`);
  unparseable/empty stdout → `cli-unparseable` (`:38-56`); feedback + exit 0 + `parsed.ok===false`
  → `cli-error` with the CLI's `error` VERBATIM (`:68-75`, the ESC-006 choke point); feedback +
  exit 0 + ok → `{ok:true, data:parsed}` (`:76`); **feedback + NONZERO exit + parseable stdout →
  `{ok:false, errorKind:'cli-error', error: parsed.error verbatim}` (`:78-83`)** — i.e. EVERY
  submit refusal (disabled, http, validation) and the exit-2 internal error arrive at the
  dispatcher as a mapped `cli-error` carrying the CLI's own message. The DISTINCT
  `feedback-disabled` outcome therefore requires REQ-013's dispatcher-level discrimination of the
  one refusal shape `exitCode === 1 && parsed.ok === false && parsed.mode === 'noop'` —
  `submitItem` returns `mode:'noop'` for the disabled refusal and ONLY for it (`feedback.js:281`
  vs `:284` http, `:288`/`:292` file).
- **The runner's error classification (REQ-014's subject — read from source):** `runOrkyCli`
  (`orky-cli-runner.ts:16-40`) resolves `{exitCode: e.code, timedOut: false}` for a numeric-exit
  CLI error (`:30-33`) but maps EVERY other execFile error — a genuine wall-clock timeout, an
  abort, AND a spawn-level failure whose errno `code` is a STRING (ENAMETOOLONG/EINVAL/E2BIG
  class: the child never executed) — to the single shape `{exitCode:null, stdout:'',
  timedOut:true}` (`:34-35`), which the byte-unchanged mapper turns into the INDETERMINATE
  `cli-timeout`. A spawn failure cannot have written anything; REQ-014 pins the honest split.
- **Result shapes (the honesty vectors REQ-008/REQ-009 key on)** — `OrkyActionResult`
  (`types.ts:495-505`), `errorKind` union (`:477-490`), `OrkyFeedbackState` (`:474`):
  - **captured**: `{ok:true, path:'feedback', feedback:'enabled', dispatched:true, data, exitCode}`
    — `data` is the submit receipt (file-mode success above).
  - **feedback-disabled**: `{ok:false, path:'feedback', feedback:'disabled', dispatched:false,
    errorKind:'feedback-disabled', error, exitCode}` — a DISTINCT non-dispatch, never a silent
    no-op (0007 D2; ADR-027 makes enabling an audited human decision); per REQ-013 the `error`
    carries the submit CLI's own refusal verbatim.
  - **cli-error**: every other refusal/internal error, message verbatim (incl. the http-mode
    refusal directing to the control plane, and the ESC-006 class — never misdiagnosed as
    disabled). Per REQ-014 this is also the DEFINITE surface of a spawn-level failure.
  - **cli-timeout**: `{ok:false, errorKind:'cli-timeout', exitCode:null, error:'the feedback
    command timed out after 15s'}` (`orky-action-result.ts:29-35`, `DEFAULT_CLI_TIMEOUT_MS` `:14`)
    — for this non-idempotent write, CONV-015 pins it as INDETERMINATE (the child is `unref()`'d
    and may still complete the write). Per REQ-014 this kind is RESERVED for the genuine
    elapsed-time class — never a spawn failure.
- **Audit (already handled, off the critical path, unchanged):** every invocation reaching the
  dispatcher gets one append-only audit record — `title`/`detail` captured as
  `titleLength`/`detailLength` ONLY, never raw text (`orky-action-dispatcher.ts:66-80`,
  `:333-356`); an audit failure never alters the returned result. F12 adds no logging of its own.
- **What a captured item IS (grounds the D5 copy — re-grounded, FINDING-001):** `submit` writes
  `{id:'IN-…', ts, by:'local-client', kind:'work.request', title[, detail]}` into
  `<root>/.orky/feedback/inbox/IN-*.json` (`feedback.js:294-298`) — the store `pull` reads
  (`feedback.js:132-146`) and the orchestrator's `apply` drains (`cli.js:95-110`): `applyItems`
  (`feedback.js:352-383`) turns each un-journaled `work.request` into a `.orky/backlog.jsonl`
  record `{id:'WORK-…', at, status:'pending', title, detail, priority:'normal', by}`
  (`:365-368` → `backlogAdd` `:308-314`), journaled idempotently, awaiting planner triage.
  Capture ≠ accept ≠ apply ≠ triage — but "queued in the inbox for triage" is now the literal
  truth.
- **StrictMode reality (amended — FINDING-004/FINDING-018):** the shipped renderer tree is wrapped
  in `<StrictMode>` (`src/renderer/main.tsx:6-7`), whose dev-build mount→unmount→remount
  double-invokes effects — this project has already shipped that failure class (0009 FINDING-036).
  BUT no test harness runs React's development build: the npm-test harness is
  `environment:'node'` with no DOM (it cannot mount a React component at all), and the e2e drives
  the PRODUCTION bundle under `out/`, where StrictMode's double invocation is compiled out/inert.
  A StrictMode-active runtime vector therefore does not exist in this repo; the class is guarded
  STRUCTURALLY — the event-handler call-site pin of REQ-006 — and no test may claim otherwise
  (FINDING-018).
- **Renderer substrate reused (D3):** `Modal` family — portal-to-body card, backdrop click closes,
  `Z` layers, and the collapsed-focus-only microtask refocus that already coexists with CONV-020
  restores (`Modal.tsx:55-91`, FINDING-026 note `:57-65`); `OrkyRootPicker` — props
  `{onSelect, onCancel}` (`OrkyRootPicker.tsx:27-29`), four mutually-distinct states, CONV-030
  target-guarded listbox keys (`:42-57`), `z={Z.palette}` (`:60`), aria-label `:64`, visible
  header `:66`, hosted app-level behind `orkyRootPickOpen`/`resolveOrkyRootPick`
  (`App.tsx:36-38, 186-190`); `useOpenFocusRestore` (`use-open-focus-restore.ts:16-34` — open half
  focuses the target, close half restores ONLY on collapsed focus); `useRegistryLoadState`
  (`use-registry-load-state.ts:21-28`). The picker flow costs no new snapshot subscription and no
  IPC on open.
- **Invocation substrate:** `PaletteAction` union + `buildCommandItems()`
  (`quick.ts:83-87, 134-149`); CommandPalette's activate switch with the
  chrome-before-activeId-guard precedent (`CommandPalette.tsx:57-77`; `toggle-orky-queue` handled
  at `:64` BEFORE the `if (!activeId) return` guard — the capture action follows it);
  `COMMANDS`/`DEFAULT_BINDINGS`/`matchShortcut`/`isValidRebind`
  (`keybindings.ts:39-53, 90-122, 138-144`); App's window keydown dispatch switch
  (`App.tsx:101-146`; the chrome precedent `case 'toggle-orky-queue'` at `:140` needs no
  `activeId`). `menu.ts:29` ships `{ role: 'toggleDevTools' }` (default accelerator
  Ctrl+Shift+I) — the reason decision #1 avoids `mod+shift+i`.
- **Toast chokepoint (CONV-004 already enforced):** `pushToast(text, kind='success')` — success/info
  render only when `quick.toastsEnabled === true`; `error`-kind ALWAYS enqueues — the
  `kind !== 'error'` early-return at `toasts-slice.ts:20` is the pinned never-suppressed mechanism
  (`toasts-slice.ts:11-27`). F12's success confirmation is a suppressible success toast; F12's
  failures render IN-MODAL (never toast-only), so no failure signal can be suppressed — and per
  REQ-009's close-while-in-flight rule (FINDING-013), this chokepoint is ALSO how a DETACHED
  outcome reports after the modal is gone, precisely because it needs no live component.
- **Established status tokens (CONV-029):** failure text/border uses `--status-failure` with
  standard fallback `#c62828`; no `--status-fail` variable exists (0009 REQ-019 pin). Every other
  surface token used must be from the defined set (`--panel`, `--fg`, `--fg-dim`, `--border`,
  `--elevated`, `--sel-bg`) with its standard fallback.

## Public interface

```ts
// src/shared/quick.ts (REQ-001)
type PaletteAction = ... | 'capture-orky-work'

// src/shared/keybindings.ts (REQ-001)
type CommandId = ... | 'capture-orky-work'
type Shortcut = ... | { type: 'capture-orky-work' }
// COMMANDS gains: { id: 'capture-orky-work', label: 'Capture Orky work item',
//                   category: 'General', defaultChord: { mod: true, shift: true, key: 'u' } }

// src/renderer/store/orky-capture-slice.ts (names indicative; REQ-002/REQ-004/REQ-006)
orkyCaptureRequest: { root: string | null } | null  // null = closed; root = D4 pre-selected entry
openOrkyCapture(root?: string): void   // no root -> picker-first flow; root -> form directly.
                                       // Re-invoking while open is a NO-OP (draft preserved).
                                       // F10's OrkyPane "inject" calls THIS with its bound root.
closeOrkyCapture(): void               // discards the draft

// src/renderer/components/OrkyCaptureModal.tsx — new component, hosted app-level in App.tsx.
// The ONLY renderer call site of api.orkySubmitWork( — request built as:
//   { projectRoot: <chosen root, byte-verbatim>, title: <verbatim>, ...(detail non-empty ? { detail } : {}) }
// No phase, no feature, no other key. The call is issued SYNCHRONOUSLY from the submit gesture
// handler — never from a useEffect (REQ-006, FINDING-004/FINDING-018: the structural pin IS the
// StrictMode guard). An invoke-REJECTION (IPC transport failure) synthesizes the renderer-scoped
// kind 'ipc-failure' and renders the INDETERMINATE copy class — never a definite non-capture and
// never an F7 kind (REQ-014, FINDING-019). A dispatch whose modal was closed mid-flight DETACHES:
// its settled outcome routes to pushToast (failures error-kind, never suppressed) (REQ-009,
// FINDING-013).

// src/renderer/components/OrkyRootPicker.tsx — ADDITIVE, default-preserving props only (REQ-003):
export function OrkyRootPicker(props: {
  onSelect: (root: string) => void
  onCancel: () => void
  ariaLabel?: string   // default: "Bind Orky pane to a tracked project" (byte-identical F9 rendering)
  heading?: string     // default: "Bind to a tracked Orky project" — the visible header MUST be
                       // configurable in the same change as the accessible name (FINDING-005)
  z?: number           // default: Z.palette (unchanged)
})

// src/main/orky/orky-action-dispatcher.ts — REQ-013's in-place amendment (no new file/module):
// doSubmitWork's single hard-coded invocation becomes
//   ['submit', '--app', projectRoot, '--json', JSON.stringify(item)]   // item: {kind:'work.request', title, ...}
// with the disabled refusal (exit 1 + {ok:false, mode:'noop'}) surfaced as the DISTINCT
// feedback-disabled result. mapCliRunToResult stays byte-unchanged.

// src/shared/orky-action-validate.ts — REQ-013's additive hardening (FINDING-011): projectRoot
// joins the rejectFlagLike-guarded set in ALL FOUR validators (after its requireNonEmptyString
// extraction at :93/:118/:147/:182); message per the guard's standard field-specific template.

// src/main/orky/orky-cli-runner.ts — REQ-014's in-place amendment (signature/return type
// unchanged): timedOut:true is RESERVED for the genuine elapsed-time class (execFile timeout kill
// / abort); a spawn-class execFile error (string errno code — the child never ran) resolves
// timedOut:false and surfaces through the byte-unchanged mapper as a DEFINITE failure.
```

Key testids (the DOM contract tests pin): `orky-capture` (the form card), `orky-capture-title`,
`orky-capture-detail`, `orky-capture-target` (displays the chosen root verbatim),
`orky-capture-change-root`, `orky-capture-submit`, `orky-capture-cancel`, `orky-capture-hint`
(the static keyboard-hint line, REQ-002/FINDING-012), `orky-capture-error` (the in-modal result
region for every `ok:false` — F7-mapped kinds plus the renderer-synthesized `ipc-failure`,
REQ-014 — carrying `data-error-kind={errorKind}`; FAILURE-ONLY — absent in the freshly-opened
form, REQ-002/REQ-009). None contains the substring `orky-action` or `orkyaction` (REQ-011). The
picker keeps its own `orky-root-picker*` testids untouched.

---

## Requirements

### REQ-001 — Global invocation: palette entry + rebindable chord, workspace-independent (D1) — `ux`
The feature MUST add ONE rebindable command `'capture-orky-work'` (COMMANDS entry per the Public
interface; default chord `mod+shift+u` — rationale in decision #1) and ONE command-palette entry in
`buildCommandItems()`. Both MUST invoke `openOrkyCapture()` (no argument — the picker-first flow),
and both MUST work with NO active workspace: the palette handles the action BEFORE its
`if (!activeId) return` guard (the `toggle-orky-queue` precedent, `CommandPalette.tsx:62-66`), and
App's keydown switch gains a `case 'capture-orky-work'` that reads no `activeId` (the `:140`
precedent). The default chord MUST be conflict-free against every existing default (or F6's frozen
TEST-326 belt-and-braces loop goes red) and MUST honor rebinds and the explicit `'none'` unbind
through the existing `resolveBindings` registry — no second keybinding path.
**Locator-collision documentation (revision 2 — FINDING-021):** frozen TEST-495 locates the
palette's activation guard via an UNANCHORED whole-file scan —
`palette.indexOf('if (!activeId) return')` (`tests/renderer/orky-capture-structure.test.ts:285`) —
which forced the pre-existing `currentCwd` useMemo to be reshaped
(`CommandPalette.tsx:35-40`: `const ws = activeId ? workspaces[activeId] : undefined` instead of
the idiomatic early return) purely so the scan finds the REAL activation guard first. That reshape
MUST carry a one-line in-code comment at the useMemo naming TEST-495 /
`orky-capture-structure.test.ts:285` and the `indexOf` collision, so a future revert to the
early-return cannot silently break a frozen test in another file. (The locator fragility itself is
recorded as proposed convention #6.)
**Acceptance:** `COMMANDS.find(id === 'capture-orky-work')` exists with the pinned default chord
and a capture-naming label; `findConflict(DEFAULT_BINDINGS, chord, id) === null`;
`isValidRebind(chord) === true`; `chordKey` of every OTHER default differs; `matchShortcut(Ctrl+Shift+U)`
returns `{type:'capture-orky-work'}` under defaults, follows a rebind, and returns null after
`'none'`; `buildCommandItems()` contains the action with a /capture/i label; palette activation
with `activeId === null` still opens the flow (source-order/structural assertion per the F6
precedent); a source scan confirms the `currentCwd` useMemo carries a comment matching
/TEST-495|orky-capture-structure/ adjacent to the reshaped expression (FINDING-021); the full
existing keybinding suites (TEST-325..329, `tests/keybindings.test.ts`) pass unchanged.

### REQ-002 — The capture modal: Modal-family dialog with title + detail + target (D1) — `ux`
The capture form MUST be a `Modal`-family, body-portalled dialog (`role="dialog"`,
`aria-modal="true"`, an accessible name naming Orky work capture) containing exactly: a labelled
single-line title input (`orky-capture-title`, autofocused via the shared focus hook — REQ-007), a
labelled multi-line detail textarea (`orky-capture-detail`, optional), the target-project display
(`orky-capture-target`, showing the chosen root string verbatim) with a `orky-capture-change-root`
button, a submit button (`orky-capture-submit`), a cancel button (`orky-capture-cancel`), a
static, ALWAYS-VISIBLE keyboard-hint line (`orky-capture-hint` — revision 2, FINDING-012) of the
**"Enter captures · Ctrl+Enter captures from anywhere · Esc cancels"** class (mod-appropriate
wording) so the Enter-in-title fast-capture semantics (KEPT deliberately — one-keystroke capture
is the feature's soul, ESC-001) and the discard key are discoverable before the first accidental
submit, and the in-modal result region (`orky-capture-error`), which MUST render ONLY on a failure
(REQ-009) and MUST be ABSENT in a failure-free form (freshly opened, typing, in-flight, or after
success). The submit control MUST be disabled (`aria-disabled`/`disabled`) while the title is
empty or whitespace-only and while a submission is in flight (REQ-006). As body-portalled chrome
it MUST carry visible `:focus-visible` and hover styling (CONV-007 — the established allow-list
path), and every color MUST come from a defined theme token with its standard fallback (CONV-029;
failure styling via `--status-failure`/`#c62828`, never a novel `var()` name).
**Overflow containment (revision 2 — FINDING-017):** the form's content MUST stay inside the
card's `80vh` cap (`OrkyCaptureModal.tsx:169`): the detail textarea's user resize MUST be bounded
(a CSS max-height — the shipped `resize:'vertical'` at `:184` is unbounded) and the error region
MUST be scroll-contained (`overflowY:'auto'` with a bounded height — the shipped pre-wrap region
at `:197-201` grows without limit under a long verbatim CLI message), matching the picker's own
listbox containment pattern, so no drag or oversized error can push the Capture/Cancel row off the
card. Backdrop click and the cancel button close without submitting (REQ-006).
**Acceptance (amended — FINDING-003/FINDING-012/FINDING-017):** the EIGHT non-error testids
(`orky-capture`, `orky-capture-title`, `orky-capture-detail`, `orky-capture-target`,
`orky-capture-change-root`, `orky-capture-submit`, `orky-capture-cancel`, `orky-capture-hint`)
render in the freshly-opened form state, and `orky-capture-error` is ABSENT there;
`orky-capture-hint`'s text matches /captur/i, names both Enter and the mod+Enter chord, and
matches /esc/i (the discoverability pin); `orky-capture-error` renders only under a mocked
`ok:false` result (cross-reference REQ-009's per-kind vectors) and disappears again if a
subsequent retry succeeds; the dialog carries `role="dialog"`, `aria-modal`, and an aria-label
matching /capture/i; both fields are label-associated; submit is disabled for `''` and `'   '`
titles and enabled for a non-whitespace title; a source scan finds no hex color outside a
standard-fallback `var()` and no undefined variable name, finds a max-height bound on the detail
textarea's style, and finds `overflowY` containment with a bounded height on the error region
(FINDING-017); the focus-visible allow-list covers the new chrome; backdrop click closes with
zero `orkySubmitWork` calls (spy).

### REQ-003 — Target selection reuses the F9 picker substrate, never forked (D3) — `quality` `ux`
The target-project step MUST be the existing `OrkyRootPicker` component — the same file F9 ships —
opened by the capture flow (picker-first when no root was pre-selected; and from
`orky-capture-change-root`, returning to the form with the previous root intact on cancel).
Changes to `OrkyRootPicker.tsx` MUST be additive and default-preserving ONLY — the optional
`ariaLabel`/`heading`/`z` props of decision #4: omitting the new props renders byte-identical DOM
for every existing F9 call site, and no string matching TEST-433's banned set or breaking
TEST-434's pinned literals may enter the file. **The capture flow MUST pass BOTH a
capture-specific `ariaLabel` AND a capture-consistent visible `heading` (FINDING-005)** — the
screen-reader name and the visible header MUST describe the same action (capture, not pane
binding); the default heading (`"Bind to a tracked Orky project"`, `OrkyRootPicker.tsx:66`) stays
the F9 rendering. The capture flow inherits — and MUST NOT reimplement — the picker's four
mutually-distinct states (loading / verbatim error / actionable empty / list), its CONV-030
target-guarded key handling, and its `useRegistryLoadState`/`useOpenFocusRestore` substrate. F12
MUST NOT add a second registry snapshot subscription, MUST NOT call `registryCurrent()` anew, and
MUST NOT reference the registry mutation surface (TEST-362's live sweep covers F12's files
automatically). Cancelling the INITIAL picker MUST abandon the capture entirely (no form, no
dispatch, no state left behind).
**Acceptance:** the capture flow's picker step renders `orky-root-picker` (the SAME testid —
component identity, not a copy); a structural test asserts `OrkyCaptureModal.tsx` imports
`OrkyRootPicker` and contains no member-root list rendering of its own; with the props omitted the
picker's rendered output is unchanged (F9's TEST-428..435 and the e2e picker flows pass
byte-unchanged); in the capture flow the picker's VISIBLE header shows the capture-specific
heading (matching /capture/i, not /bind/i) AND its `aria-label` matches /capture/i — asserted
together so name/heading coherence is a tested property; capture's picker shows
loading/error/empty per the shared derivation on the same vectors REQ-004 of 0009 pinned;
initial-picker cancel leaves `orkyCaptureRequest` closed and dispatches nothing; changing the
project from the form and cancelling preserves the prior root; grep confirms no
`registryRoots(`/`registryAddRoot(`/`registryRemoveRoot(`/`RegistryMutationResult` in any F12
file.

### REQ-004 — The pre-selected-root entry path (D4 — F10's verbatim reuse) — `quality` `ux`
`openOrkyCapture(root)` with a root argument MUST skip the picker step and open the form directly
with `orky-capture-target` showing that root byte-verbatim; submission then sends EXACTLY that
string as `projectRoot` (no re-casing, re-slashing, resolving, or normalizing — server-side
membership matching is F7's job, `orky-action-dispatcher.ts:288-293`). The pre-selected path MUST
NOT pre-validate membership client-side (no re-implementation): a stale/untracked root surfaces as
F7's own verbatim `root-not-allowed` rejection through REQ-009's error region. The
"Change project" affordance MUST remain available on this path. This store-level entry point is
the ONE surface F10's OrkyPane "inject" later calls — no capture logic may live where only the
palette/chord path can reach it.
**Acceptance (amended — FINDING-022, honestly scoped):** *Verified NOW (this feature's suites):*
(a) a slice-level test covers `openOrkyCapture()` vs `openOrkyCapture(root)` state (the D4 seam —
the TEST-481/482 class); (b) a structural source-scan pin (the repo's established node-env
pattern) asserts `OrkyCaptureModal` honors a non-null `initialRoot` by skipping the picker:
`picking` initializes from `initialRoot === null` and `OrkyRootPicker` is rendered only under
`picking` (`OrkyCaptureModal.tsx:35`, `:100-108`); (c) re-invocation-while-open is covered in
REQ-006. *Explicitly INHERITED BY F10's e2e (named deferral):* the four render/dispatch clauses —
(1) `openOrkyCapture('C:\\Mixed\\Case Root')` opens the form (never the picker) showing that exact
string; (2) the dispatched request's `projectRoot` is byte-equal to it (spy/argv-log); (3) an
untracked pre-selected root submits, receives the `root-not-allowed` result, and renders its
verbatim error with the draft preserved; (4) the change-root button still opens the picker — are
NOT executable by any shipped harness today (no shipped caller passes a root until F10's OrkyPane
"inject" gesture; the unit harness is node-env and cannot mount; the e2e cannot reach the
`initialRoot != null` branch without a test-only backdoor). They are recorded here as acceptance
debt that **F10's spec MUST inherit as e2e vectors in the same change that ships the first real
`openOrkyCapture(root)` caller** — the tests phase records the inheritance in its traceability,
never presenting (1)-(4) as covered by F12.

### REQ-005 — Submission EXCLUSIVELY through F7's `submitWork`; zero new write machinery (D2) — `security` `quality`
The ONLY dispatch call in this feature's RENDERER MUST be `api.orkySubmitWork(req)` — F12 MUST NOT
add any IPC channel, preload method, main-process module, renderer-side
`child_process`/CLI invocation, or any write under any `.orky/` tree; MUST NOT call
`orkyResolveEscalation`, `orkyRecordHumanGate`, or `orkyDriveStatus`; and MUST NOT log, persist,
or transmit the raw title/detail anywhere else (F7's audit records lengths only — Verified
contract). The main-process diff permitted to this feature is REQ-013's in-place amendment of
`doSubmitWork` inside the existing `src/main/orky/orky-action-dispatcher.ts` (plus the additive
`orky-action-validate.ts` guard, FINDING-011), REQ-014's in-place amendment of
`src/main/orky/orky-cli-runner.ts`, and their test/doc supersessions per REQ-011/REQ-013. The
request MUST be exactly `{ projectRoot, title }` plus `detail` iff the textarea is non-empty —
title and detail sent VERBATIM as typed (no trim, no rewrite, no added fields; no `phase`, no
`feature`) — so the renderer can neither smuggle values around F7's validation nor diverge from
what the user saw.
**Acceptance:** repo grep proves the diff adds no `CH.*` constant, no `ipcMain.handle`, no preload
change (beyond the REQ-011 comment edit in `ipc-contract.ts`), and no new file under `src/main/`
(the only `src/main/` changes are the REQ-013 amendment to `orky-action-dispatcher.ts` and the
REQ-014 amendment to `orky-cli-runner.ts`, both diff-scoped); grep over F12's renderer files finds
exactly one `orkySubmitWork(` call site and zero references to the other three action methods,
`child_process`, `execFile`, or `fsWrite`; a dispatch spy receives `{projectRoot, title}` with
`detail` absent for an empty textarea, present-and-verbatim (including leading/trailing whitespace
and newlines) otherwise, and `Object.keys(req)` never exceeds `['projectRoot','title','detail']`;
no F12 file contains `console.log` of the title/detail values (structural assertion).

### REQ-006 — Gesture-tying and single-flight: no submission without an explicit user action — `security`
A `orkySubmitWork` call MUST be triggered ONLY by an explicit submit gesture: activating the submit
button, Enter in the title input, or `mod+Enter` inside the form (REQ-007's matrix) — each while
the form is valid and idle. **The `api.orkySubmitWork` call MUST be issued synchronously from the
gesture's event handler — never from a `useEffect` (or any effect) keyed on a submit-requested
flag (FINDING-004): an effect-issued dispatch double-fires under StrictMode's remount and breaks
the gesture↔dispatch bijection structurally.** There MUST be NO dispatch on modal open/mount,
close/cancel/Escape, backdrop click, unmount, window blur, field change, or timer — and closing
the modal while a dispatch is in flight MUST NOT issue another. Submission MUST be single-flight:
from gesture until the result settles, the submit affordances are disabled and any further submit
gesture is a no-op (one gesture = at most one work item; F7's per-root queue serializes but does
not dedupe). Re-invoking `openOrkyCapture` while the modal is open MUST be a no-op that preserves
the draft and in-flight state. Event handlers MUST read store state via `getState()` at event time
when it does not affect rendered output (CONV-021).
**Acceptance (amended — FINDING-004, mechanism corrected per FINDING-018):** with a dispatch spy —
mount/unmount/open/close/Escape/backdrop/blur vectors each produce zero calls; a double-activation
of submit (two clicks, click+Enter, Enter+mod+Enter) before the mocked result settles produces
exactly ONE call; the submit gesture on a valid idle form produces exactly one call; re-invoking
the command (chord and palette) while open leaves the typed draft and any in-flight state intact;
the lifecycle vectors run through the REAL component mount/unmount (CONV-031, REQ-012).
**StrictMode class (the corrected mechanism — FINDING-018):** two pinned facts — (i) NO harness in
this repo can run a StrictMode-ACTIVE vector: the unit harness is `environment:'node'` (cannot
mount a React component), and the e2e drives the production bundle under `out/`, where StrictMode's
double mount/effect invocation is compiled out/inert; (ii) the guard for the class is therefore
STRUCTURAL — a pin that the `orkySubmitWork(` call site in `OrkyCaptureModal.tsx` sits inside an
event handler and that no `useEffect` body/callee in F12's files references `orkySubmitWork` (the
TEST-489 class) — backed by the production-e2e zero/one dispatch counts, which measure the real
shipped lifecycle but NOT StrictMode semantics. No test, header, or phase doc may claim a
StrictMode measurement: the e2e header's contrary sentence (`orky-capture.spec.ts:3-6`) and
04-tests.md's StrictMode note are corrected at the tests phase as a documented, prose-only CONV-008
repair (this REQ is the sanctioning amendment). The one StrictMode-active tree (`npm run dev`) is
guarded by the structural pin alone — recorded, not implied otherwise.

### REQ-007 — Keyboard matrix: CONV-030 target guards + CONV-020 focus discipline — `ux`
The capture form MUST implement exactly this key matrix, with any container-level handler
TARGET-GUARDED so a focused native control's own activation is never suppressed or redirected
(CONV-030):

| Key | Focus location | Behavior |
|---|---|---|
| `Escape` | anywhere in the form | close, discard draft, zero dispatch |
| `Enter` | title input | submit iff valid + idle, else nothing |
| `Enter` | detail textarea | newline ONLY — never submits |
| `Enter` / `Space` | any focused button (submit/cancel/change-root) | THAT button's native activation — never redirected to a default |
| `mod+Enter` | anywhere in the form | submit iff valid + idle |
| `Tab` / `Shift+Tab` | — | native order: title → detail → change-root → submit → cancel |

The Enter-in-title fast-capture row is KEPT (ESC-001/FINDING-012) — its discoverability repair is
REQ-002's always-visible hint line, not a semantics change. Focus follows CONV-020 via the SHARED
`useOpenFocusRestore` hook (never a hand copy): on open, focus moves into the form (the title
input); on close, focus returns to the pre-open element ONLY if focus collapsed out of the removed
dialog (the hook's rule) — coexisting with `Modal.tsx`'s collapsed-focus microtask refocus exactly
as the picker already does. In the picker→form handoff, the form's open half takes focus (a
modal→modal handoff, `Modal.tsx:57-65`); closing the whole flow restores to the original opener.
(Tab CONTAINMENT at the dialog boundary is a known, shared Modal-seam gap — FINDING-016 — recorded
as an accepted residual with a convention proposal, not repaired per-dialog here; see "Review
residuals".)
**Acceptance:** each matrix row is asserted (e2e or DOM-level): Enter in the textarea inserts a
newline and produces zero dispatch calls; Enter on the focused CANCEL button cancels (never
submits) and Enter on the focused change-root button opens the picker (never submits) — the two
CONV-030 vectors; `mod+Enter` from the textarea submits once; Escape from every focusable position
closes with zero dispatch; keyboard-only end-to-end (chord → picker arrows/Enter → type → Tab →
Enter on submit) succeeds; a structural test pins the `useOpenFocusRestore` import and the absence
of a duplicated restore implementation; the close-restore fires only on collapsed focus (the
picker's existing test pattern).

### REQ-008 — Result honesty: "captured", keyed on F7's own semantics (D5, CONV-013) — `quality` `ux`
The success state MUST be presented iff the returned result has `ok === true && dispatched === true`
(with REQ-013 in place, F7 sets these together with `feedback:'enabled'` exactly and only for the
file-mode submit receipt — the SINGLE success shape; the emit-era sent/spooled ambiguity is gone
from this universe, FINDING-002), keyed ONLY on the result's own `ok`/`dispatched`/`errorKind`
fields — never re-derived from `exitCode`, `data`, or any re-parse of CLI output, and never
re-implementing `mapCliRunToResult`. Success copy MUST present the item as captured/queued to the
project's Orky inbox for later triage (decision #6 wording — literally true via the submit path:
the item is durably in `<root>/.orky/feedback/inbox/`, the exact store the orchestrator's `apply`
drains into the backlog for planner triage) and MUST NOT claim Orky accepted/started/created work
(only `apply` + planner triage do that). On success the modal closes and confirmation goes through
the established `pushToast` chokepoint as a SUCCESS-kind toast (suppressible by the toasts
preference — CONV-004 governs; failures never ride a suppressible path, REQ-009).
**Acceptance:** a mocked `{ok:true, path:'feedback', feedback:'enabled', dispatched:true,
data:{ok:true, mode:'file', id:'IN-abc123', kind:'work.request', path:'inbox/IN-abc123.json'}}`
result closes the modal and pushes one success toast whose text matches /captured|queued/i and
names the root, and does NOT match /accept|start|creat/i; the success branch condition in source
references `ok`/`dispatched` (structural pin) and no F12 renderer file imports `mapCliRunToResult`
or reads `data.mode`/`data.sent`/`data.spooled`/`exitCode` for branching; with `toastsEnabled`
false the modal still closes (capture happened; only the informational toast is suppressed) and no
error is shown.

### REQ-009 — Failure surfacing: distinct, verbatim, actionable, draft-preserving — `ux` `security`
Every `ok:false` result MUST render in-modal (`orky-capture-error`, `data-error-kind={errorKind}`),
keep the modal open with the typed title/detail and chosen root INTACT, re-enable submit for an
explicit retry (except as pinned below), and surface F7's `error` string VERBATIM (CONV-001 —
F7's messages carry the CLI's own text where one exists; F12 may prepend context but never
replaces or rewords them). Pinned per-kind behavior:
- **`feedback-disabled`** — a distinct state (not generic failure styling), produced by REQ-013's
  discrimination of the submit CLI's disabled refusal, surfacing the CLI's own message verbatim
  ("feedback is disabled — the write path requires enable-feedback (an audited decision,
  ADR-027)", `feedback.js:281`). It MUST NOT be presented as success or silently swallowed, and
  the modal MUST NOT offer any enable/auto-enable affordance — enabling feedback is an audited
  human decision outside Termhalla (ADR-027, D2).
- **`cli-error`** — verbatim error. Pinned vectors within this kind (FINDING-002):
  - the **http-mode refusal** — an http-configured project gets the CLI's own redirect verbatim
    ("submit writes the LOCAL file inbox; this app uses the http control plane — submit via its
    inbox API instead", `feedback.js:284`): a loud refusal directing the user to the control
    plane, with NO silent spool and NO ambiguity about whether anything was recorded (nothing
    was). It MUST NOT be presented as "feedback disabled" (`data-error-kind="cli-error"`).
  - a **genuine internal error** (the ESC-006 class — e.g. exit 2 `{error}` or exit 0
    `{ok:false,…}`) arrives already mapped upstream; F12 MUST NOT inspect `data.mode` and MUST
    NOT present any `cli-error` as "feedback disabled".
  - a **spawn-level failure** (REQ-014 — e.g. an oversized command line): a DEFINITE non-dispatch
    (the child never ran, nothing was written) rendered with the definite failure copy — never
    the indeterminate class.
- **`cli-timeout`** — INDETERMINATE (CONV-015): copy MUST state the item may or may not have been
  captured (the timed-out child can still complete its write) and warn that retrying may create a
  duplicate; it MUST NOT be presented as a definite non-capture, and the retry affordance carries
  that warning. Per REQ-014 this kind is RESERVED for genuine wall-clock timeouts/aborts — a
  spawn failure never arrives here.
- **`ipc-failure`** *(renderer-synthesized — REQ-014, FINDING-019)* — the `api.orkySubmitWork`
  invoke-REJECTION (an IPC transport failure; F7's dispatcher is total and never throws): at that
  moment the dispatch fate is UNKNOWN (the request may have reached the dispatcher and completed
  the write), so it MUST render as INDETERMINATE — the same copy class as `cli-timeout` (may or
  may not have been captured; retrying may create a duplicate) plus the rejection text — and MUST
  NOT reuse any F7 `errorKind` literal (a synthesized verdict must never be byte-identical to an
  F7-mapped one).
- **`invalid-args`, `root-not-allowed`, `feature-not-found`, `orky-cli-not-found`,
  `cli-unparseable`, `unknown-sender`** — verbatim error text, generic failure treatment, retry
  allowed. (`cli-unparseable` is also the honest surface of a pre-v0.28.0 Orky plugin with no
  `submit` subcommand — see REQ-013.)
**Failure lifetime (revision 2 — FINDING-008, consolidating FINDING-015):** the rendered failure
describes exactly the LAST SUBMITTED request. Mutating the title or detail after a failure, or
selecting a DIFFERENT root (via "Change project"), MUST clear the failure state — the error
region disappears, because its subject no longer exists (the shipped gap: failure was cleared
only inside `submitCapture`, `OrkyCaptureModal.tsx:70`, never in `handlePickSelect`, `:55`).
Re-picking the SAME root MAY leave it rendered. Draft preservation (title/detail/root intact on
failure) and unedited retry are unaffected.
**Close-while-in-flight (revision 2 — FINDING-013):** closing the modal while a dispatch is in
flight (Escape, Cancel, backdrop) is PERMITTED and discards the draft — accepted and pinned
(decision #8: close cannot abort the non-idempotent write, and holding the close affordances
hostage for the up-to-15s window is worse). The in-flight completion then DETACHES from the
component: when it settles, its outcome MUST still be reported through the store-level `pushToast`
chokepoint (which needs no live component) — a FAILURE outcome (any `ok:false`, including a
synthesized `ipc-failure`) as an `error`-kind toast naming the lost capture (e.g. its title) with
the kind's own honesty class (indeterminate wording for `cli-timeout`/`ipc-failure`, definite
otherwise), and a SUCCESS outcome as the normal suppressible success toast. Failure outcomes are
NEVER suppressed — `error`-kind toasts always enqueue regardless of `toastsEnabled` (the pinned
chokepoint mechanism, `toasts-slice.ts:20`). The previously pinned silent drop (`aliveRef` early
return, `OrkyCaptureModal.tsx:81`) is retired: "detached" means no component state update, never a
swallowed outcome. (Convention proposal recorded — #4.)
Failures MUST NOT ride the suppressible toast path (in-modal rendering satisfies CONV-004's
"failure signals are never suppressed" by construction; any additional failure toast must be
`error`-kind).
**Acceptance (amended — FINDING-008/013/014):** one vector per errorKind above asserts: modal
stays open, title + detail + root byte-preserved, `data-error-kind` correct, the rendered text
CONTAINS the result's `error` string byte-verbatim. **Render-vector mechanism (FINDING-014):** the
distinct-kind pins are RENDER vectors, not source greps alone, driven end-to-end through the e2e
stub's `mode.json` (`orky-capture.spec.ts:48-70` — the stub already answers per `mode.json` and
supports `delayMs`), extended with the needed behaviors: (a) a generic `cli-error` render (e.g. an
exit-2 `{error}` mode) asserting verbatim text + kind attribute + draft byte-preserved; (b) the
http-refusal mode (exit 1 + `{ok:false, mode:'http', error:<redirect>}`) rendering as
`data-error-kind="cli-error"` — DISTINCT from the feedback-disabled state — and mentioning the
control plane; (c) `cli-timeout` via `delayMs` greater than the 15s timeout, asserting the
indeterminate copy + duplicate warning end-to-end; (d) the close-mid-flight vector (FINDING-013):
Escape during a slow in-flight dispatch, asserting exactly ONE argv-log entry, no second dispatch,
and the detached outcome's toast (on a failing mode: an `error`-kind toast enqueued even with
`toastsEnabled` false; on the success mode: the success toast). Kinds no real-CLI stub can produce
(`unknown-sender`, `invalid-args`, `root-not-allowed`, `feature-not-found`, `orky-cli-not-found`,
`ipc-failure`) keep mocked/structural vectors at the seams that can reach them, sharing the
generic `cli-error` render vector's coverage of the uniform rendering branch. Further:
failure → edit-title clears the error region; failure → pick-a-DIFFERENT-root clears it;
failure → unedited retry is still allowed (FINDING-008); one vector's mocked `cli-error` carries
the http-refusal message verbatim (branch-distinctness at the unit seam); the feedback-disabled
state renders distinct copy/affordance and a source scan finds no `config.json` write, no `enable`
action, and no feedback-config mutation anywhere in F12; the cli-timeout and ipc-failure states'
copy matches /may (or may not )?have been|not (be )?certain/i-class indeterminate wording and a
duplicate warning, and does not match /was not captured|failed to capture|did not go through/i-
class definite wording; with `toastsEnabled !== true` every failure vector still renders its
in-modal state.

### REQ-010 — Payload bounds mirror F7: no client-side re-validation, no silent limits (CONV-003) — `security` `quality`
The modal MUST NOT impose any length cap, truncation, character filtering, or content rewriting on
title or detail, and MUST NOT re-implement any part of `validateSubmitWorkRequest` — the ONLY
client-side gate is the submit-enablement rule (non-whitespace title, REQ-002), a UX affordance
whose bypass is harmless because F7 revalidates server-side. Boundary inputs flow through verbatim
and their server verdicts surface verbatim: a 1-character title, a title/detail with leading `--`
(safe — the item travels as ONE JSON argv element via `--json`, preserved byte-for-byte by the
runner; Verified contract, `orky-cli-runner.test.ts:70-73`), multi-line and non-ASCII/emoji
content, and a very large detail (neither F7 nor `submitItem` has a length bound — the flagged
upstream note; an OS-level spawn failure surfaces as a DEFINITE `cli-error`/`cli-unparseable` per
REQ-014, never as an F12 truncation and never as the indeterminate `cli-timeout`).
**Acceptance:** dispatch-spy vectors confirm byte-verbatim pass-through for: 1-char title,
`'--json'`-prefixed and `'--payload'`-prefixed titles, 10 000-line detail, emoji/CJK content, CRLF
newlines; no F12 source contains `slice(`/`substring(`/`maxLength` applied to the title/detail
VALUES (structural assertion, with the `maxLength` ATTRIBUTE absent from both field elements —
REQ-002's FINDING-017 max-height is CSS overflow containment, not a length cap); a mocked
`invalid-args` result (e.g. simulating a hand-called bypass) renders its field-specific message
verbatim per REQ-009.

### REQ-011 — Frozen-guard compatibility + stale-claim retirement: renderer guards untouched, dispatcher pins superseded by design — `quality`
Per the definitive inventory (grep patterns and classification above): F12 MUST keep TEST-282,
TEST-433, TEST-434, TEST-362/363, TEST-196..203, TEST-274, TEST-281, TEST-290 (its ASSERTIONS —
its prose is supersession entry 7), TEST-325..329, the whole `orky-action-result*` shared-mapper
suites, the audit/queue suites, and the open-form keybinding/palette suites passing with
assertions BYTE-UNCHANGED. The ONLY frozen pins F12 supersedes are the **SEVEN** enumerated in the
"F7 frozen-pin supersession inventory" (TEST-237, TEST-238, TEST-293, TEST-298, TEST-300, TEST-267
— plus the `:37` header comment — and entry 7, the prose-only repair of the
`orky-action-validate.test.ts:38-44` scope comment + TEST-290's it-title at `:324`, whose
assertions stay byte-untouched; FINDING-020, executing FINDING-007), each amended at the TESTS
PHASE in the same change as REQ-013, each preserving its guard's documented intent, per CONV-019
(`conventions.md:91-95`) — F12 is the designed first consumer of the submitWork dispatch path, so
this supersession is the recorded CONV-019 retirement, never a silent implementation-time edit,
and this spec's enumeration is the single source the tests phase executes (a tests-phase repair
that is not reflected here is a contract violation — the FINDING-020 lesson; proposed convention
#7).
Binding renderer consequences: (a) every F12 testid avoids the substrings `orky-action` and
`orkyaction` (decision #5); (b) the string `orkyAction` (any casing that matches TEST-433's
literal) appears in NO F9_FILE — the dispatch call lives only in F12's new files;
(c) `OrkyRootPicker.tsx` changes are additive-only per REQ-003; (d) no F12 renderer file matches
`RENDERER_MUTATION_PATTERN`. Additionally (CONV-008): F12 MUST update the now-false
"no renderer UI consumes these yet" comment at `ipc-contract.ts:178-179` to name this feature as
the first (submitWork-only) consumer, MUST update the submitWork emit-flow descriptions in
`docs/features/orky-action-dispatch.md` and the dispatcher header comment (REQ-013 makes them
stale), and MUST sweep `docs/**`, `CLAUDE.md`, and `.orky/baseline/**` for every other phrasing of
the **orkyAction** no-consumer claim, updating each — never only the one enumerated file.
**Scope guard (FINDING-006):** the sweep and its acceptance grep target the orkyAction claim class
only; the registry-mutation no-consumer claim at `.orky/baseline/architecture.md:117-118`
(`registry:addRoot`/`removeRoot`) remains TRUE after F12 and MUST remain byte-unchanged — it is an
explicit allowlist entry, never a forced falsifying edit.
**Acceptance (amended — FINDING-020):** the full frozen suite runs green at F12's implementation
gate with zero modifications to any `tests/**` file owned by 0006/0007/0009/0014 EXCEPT the seven
enumerated supersessions (diff-scoped assertion listing exactly those pins, and verifying entry
7's diff touches ONLY the `:38-44` comment block and the TEST-290 it-title string — zero assertion
lines); the CONV-023 argv-pin grep (`work\.request|--payload|--type`) is run REPO-WIDE over
`tests/**` (never a sweep of already-known files) and its full hit universe is classified as in
"Grep patterns and scope used" — any unclassified hit fails the gate; repo-wide grep at the
tests-phase gate: `orky-action|orkyaction` matches no F12 testid literal, `orkyAction` matches no
F9_FILE, and `rg "no renderer UI consumes|no renderer consumer"` over `src/**`, `docs/**`,
`CLAUDE.md`, `.orky/baseline/**` finds ONLY (i) updated phrasings naming F12 as the orkyAction
first consumer and (ii) the byte-unchanged, still-true registry-mutation line at
`.orky/baseline/architecture.md:117-118` (asserted present and unmodified); `04-tests.md` records
this REQ's supersession inventory verbatim so the tests phase executes exactly it — nothing more
(CONV-019's protocol satisfied by DOCUMENTED, enumerated supersession).

### REQ-012 — Lifecycle hygiene: no IPC on mount, nothing left behind, tested through the real lifecycle (CONV-031) — `quality` `ux`
Opening the capture flow MUST perform zero IPC (the picker renders from the already-held registry
snapshot; the form is pure local state) — capture latency is bounded by render alone. Closing (any
path: cancel, Escape, backdrop, success) MUST discard the draft and reset the slice to closed so a
reopen starts fresh; unmounting mid-flight MUST NOT dispatch, retry, or strand a pending update
onto an unmounted component — **the settled result of an abandoned in-flight call updates NO
component state, but its OUTCOME is never dropped: it routes through the store-level toast
chokepoint per REQ-009's close-while-in-flight rule (revision 2 — FINDING-013; this supersedes
revision 1's "dropped without error" wording).** The capture modal is app-level chrome portalled
to `<body>` and keys on NO pane-visibility gate — CONV-028 is n/a and this REQ records why: it is
not hosted in (and never interacts with) any keep-mounted pane host, and it adds no per-pane
runtime state for CONV-011 to prune. These lifecycle boundaries MUST be tested through the REAL
component mount/unmount (CONV-031) — a slice-level spy alone cannot see mount-effect fetches or
unmount dispatches. The StrictMode remount class is guarded structurally per REQ-006 (FINDING-018:
no harness runs React's development build — the unit harness cannot mount, the e2e is a production
bundle with StrictMode inert; recorded, never claimed otherwise).
**Acceptance (amended — FINDING-004/013/018):** mounting the open flow with IPC spies shows zero
`invoke`-class calls (registryCurrent/registryDetail/orkySubmitWork all at 0); open → type →
close → reopen yields empty fields and the picker-first step; unmount during a pending mocked
dispatch settles without a React act/update warning, without a second call, and without any state
update on the unmounted component, AND delivers the settled outcome to `pushToast` — a failing
mocked result yields one `error`-kind toast (asserted enqueued even with `toastsEnabled` false,
the `toasts-slice.ts:20` pin) and a succeeding one yields the suppressible success toast
(FINDING-013); all of the above exercised via real component mount/unmount, not only slice
functions; the StrictMode class is covered by REQ-006's structural pin — no StrictMode-active
vector exists in any shipped harness, and no artifact claims one (FINDING-018); a structural check
confirms the F12 slice holds no per-pane keyed map.

### REQ-013 — Upstream dispatcher amendment: `doSubmitWork` rides `feedback submit` (the local-inbox path), minimally — `security` `quality`
*(new in revision 1 — the FINDING-001 repair.)* F7's `doSubmitWork`
(`orky-action-dispatcher.ts:177-224`) MUST be amended IN PLACE so that its single hard-coded CLI
invocation is the plugin's local-inbox injection command instead of the outbox-writing emit:
`['submit', '--app', projectRoot, '--json', JSON.stringify(item)]`, where `item` is built from the
ALREADY-VALIDATED request as `{kind:'work.request', title, ...(detail !== undefined ? {detail} :
{}), ...(phase !== undefined ? {phase} : {}), ...(feature !== undefined ? {feature} : {})}` — one
JSON argv element (the `--json` branch, `cli.js:76`), so no free-text field ever travels as raw
argv (the TEST-290/REQ-010 safety property, preserved). Everything else in the layering MUST stay
byte-equivalent — root allowlist, optional feature-dir resolution, CLI location,
`normalizeProjectRoot` queue keying, `runWithAbort`/timeout, and the audit record (lengths only) —
with ONE additive exception pinned below. `mapCliRunToResult` (`orky-action-result.ts`) MUST stay
BYTE-UNCHANGED — its frozen suites remain green untouched.
**Validation hardening (revision 2 — FINDING-011):** `projectRoot` joins the `rejectFlagLike`-
guarded set. Today the guard covers every free-text field that travels as its OWN raw argv element
— `feature` (`orky-action-validate.ts:34-35`), `escalationId` (`:101-102`), `decision`
(`:106-107`), `evidence` (`:164-167`) — while `projectRoot` flows from `requireNonEmptyString`
straight into the raw `'--app', projectRoot` argv position (`orky-action-dispatcher.ts:161`,
`:215`) with no structural check: its safety rests on the UNENFORCED invariant that registry roots
are `path.resolve()`d (an OS-absolute path can never start with `--`) — an invariant F12 is the
first renderer-reachable feature to depend on, and which the D4 pre-selected path (REQ-004/F10)
will lean on harder. `orky-action-validate.ts` MUST gain `rejectFlagLike('projectRoot', …)`
immediately after the `projectRoot` extraction in ALL FOUR validators (`:93`, `:118`, `:147`,
`:182`), with the guard's standard field-specific message ("projectRoot must not start with '--'
(reserved for CLI flags)", CONV-001). Defense-in-depth: no legitimate caller changes behavior, and
no frozen validate vector uses a flag-like root (grep-verified — `projectRoot: '--…'` occurs
nowhere in `tests/**`), so the frozen suite stays green byte-unchanged.
Result mapping (grounded in the Verified contract's shape enumeration):
- **success** — exit 0 receipt `{ok:true, mode:'file', id:'IN-…', …}` maps through the existing
  ok-path to `{ok:true, path:'feedback', feedback:'enabled', dispatched:true, data, exitCode}`.
  The emit-era `data.mode !== 'noop'` probe is superseded by the submit semantics (a disabled
  channel can no longer masquerade as an exit-0 no-op — it refuses).
- **disabled refusal (the DISTINCT outcome, kept distinct)** — `mapCliRunToResult` maps EVERY
  feedback nonzero-exit + parseable `{ok:false}` stdout to generic `cli-error` with the CLI's
  `error` verbatim (`orky-action-result.ts:78-83` — pinned fact), so the dispatcher itself MUST
  discriminate the ONE disabled shape — `run.exitCode === 1` with parsed stdout
  `{ok:false, mode:'noop'}` (`mode:'noop'` is returned by `submitItem` for the disabled refusal
  and only for it, `feedback.js:280-282`) — and return
  `{ok:false, path:'feedback', feedback:'disabled', dispatched:false,
  errorKind:'feedback-disabled', error, exitCode}` whose `error` CONTAINS the CLI's refusal
  verbatim ("feedback is disabled — the write path requires enable-feedback (an audited decision,
  ADR-027)"); it MAY prepend the existing root-naming context. The disabled outcome thus stays a
  DISTINCT non-dispatch per 0007 D2 / REQ-009 — never collapsed into generic `cli-error`. (The
  cross-repo fragility of the `mode:'noop'` coupling is FINDING-010 — a recorded residual.)
- **every other failure** — surfaced exactly as mapped: the http refusal (exit 1, `mode:'http'`)
  and validation refusals (exit 1, `mode:'file'`) stay `cli-error` with the CLI's message
  verbatim; exit-2 internal errors stay `cli-error`; garbage/empty stdout stays `cli-unparseable`
  (also the honest verdict for a pre-v0.28.0 plugin lacking `submit`); a genuine timeout stays
  `cli-timeout`, and a spawn-level failure is DEFINITE per REQ-014 (never `cli-timeout`). A
  genuine internal error MUST NEVER be misdiagnosed as `feedback-disabled`
  (the FINDING-CODEX-001 invariant, re-expressed on the submit path).
No new subcommand may be request-selectable (0007 REQ-016 intent): `'submit'` joins the hard-coded
literal set, and the frozen-pin supersessions are exactly the seven enumerated in REQ-011's
inventory.
**Acceptance:** dispatcher unit vectors with a fake `runCli` — (1) enabled: the invocation argv is
exactly `['submit','--app',root,'--json',<json>]` with the JSON parsing to the pinned item shape
(title/detail byte-verbatim inside it, no extra keys beyond the validated optionals) and the
exit-0 receipt yields `{ok:true, path:'feedback', feedback:'enabled', dispatched:true}`; (2)
disabled: exit 1 + `{ok:false,mode:'noop',error}` yields the DISTINCT feedback-disabled result
whose error contains the CLI refusal verbatim, with NO gatekeeper call; (3) http refusal: exit 1 +
`{ok:false,mode:'http',error}` yields `cli-error` (NOT feedback-disabled) carrying the redirect
message verbatim; (4) internal error: exit 2 + `{error:'disk full'}` yields `cli-error` carrying
"disk full", never feedback-disabled; (5) old plugin: exit 2 + empty stdout yields
`cli-unparseable`; (6) a `'--json'`-prefixed title round-trips byte-verbatim inside the JSON
element; (7) the divergent-spelling serialization vector (TEST-293's intent) passes keyed on
`submit`; (8) resolveEscalation still invokes `emit` (its path untouched — TEST-297/299 stay green
byte-unchanged); (9) source grep: the `mapCliRunToResult` diff is EMPTY and the
`orky-action-validate.ts` diff is confined to the four `projectRoot` `rejectFlagLike` guards
(FINDING-011), `'submit'` appears as a hard-coded literal, and no request field reaches the
subcommand position; (10) the audit record for a submit invocation still carries
`titleLength`/`detailLength` only; (11) each of the four validators rejects
`{projectRoot: '--evil', …}` with the field-specific flag-like message BEFORE any CLI call
(dispatcher spy at zero calls), the new message is pairwise-distinct from every existing rejection
message (the CONV-001 matrix), and the whole frozen validate suite (TEST-283..290 et al.) passes
byte-unchanged.

### REQ-014 — Result-honesty completion: spawn failures are DEFINITE, `cli-timeout` means timeout, invoke-rejections are INDETERMINATE — `security` `quality` `ux`
*(new in revision 2 — the FINDING-009/FINDING-019 repair, per ESC-001.)* F12 is the first feature
that lets a human drive an arbitrarily large payload into the shared CLI runner (REQ-010 forbids
client caps; the item is ONE `--json` argv element), which makes two latent misclassifications
newly reachable. Both MUST be repaired so every rendered verdict is true:
- **Runner: spawn failure ≠ timeout (FINDING-009).** `runOrkyCli`
  (`orky-cli-runner.ts:16-40`) maps every non-numeric-exit execFile error — a genuine wall-clock
  timeout, an abort, AND a spawn-level failure (a string errno `code` such as
  ENAMETOOLONG/EINVAL/E2BIG — e.g. exceeding Windows's ~32,767-character command-line limit, the
  exact class an unbounded detail triggers) — to the single shape `{exitCode:null, stdout:'',
  timedOut:true}` (`:34-35`), which the byte-unchanged mapper renders as the INDETERMINATE
  `cli-timeout`. A spawn failure never executed the child, so NOTHING can have been written:
  presenting it as indeterminate is a false claim. `runOrkyCli` MUST be amended IN PLACE
  (signature and return type unchanged; `mapCliRunToResult` stays BYTE-UNCHANGED per REQ-013) so
  that `timedOut: true` is RESERVED for the genuine elapsed-time class (execFile's timeout kill
  and abort — the killed/abort error shapes), while a spawn-class error (a string errno `code` —
  the child never ran) resolves with `timedOut: false` and surfaces through the unchanged total
  mapping as a DEFINITE failure — `cli-error` preferred (SHOULD carry text identifying the spawn
  error code), `cli-unparseable` acceptable — and NEVER `cli-timeout`. The renderer then renders
  the existing definite failure copy for it (REQ-009), truthfully.
- **Renderer: invoke-rejection is indeterminate (FINDING-019).** The catch around
  `api.orkySubmitWork` (`OrkyCaptureModal.tsx:76-79`) currently fabricates
  `{errorKind:'cli-error', error:String(err)}` and renders the DEFINITE "Capture did not go
  through." copy (`:228`). At the moment `ipcRenderer.invoke` rejects (a renderer↔main transport
  failure — F7's dispatcher is total and never throws), the dispatch fate is UNKNOWN: the request
  may have reached the dispatcher and completed the write. The catch MUST synthesize the
  renderer-scoped kind **`'ipc-failure'`** (never any F7 `errorKind` literal, so a synthesized
  verdict is never byte-identical to an F7-mapped one — preserving REQ-008's keyed-only-on-the-
  result discipline) and REQ-009 renders it with the INDETERMINATE copy class (may or may not have
  been captured; retrying may create a duplicate) plus the rejection text.
**Acceptance:** (1) a REAL (non-mocked) runner boundary test drives an oversized argv element
(e.g. a multi-megabyte `--json` item, exceeding the Windows command-line limit) through the actual
`runOrkyCli`/execFile path and asserts the resolved run has `timedOut === false`, and that the
dispatcher-mapped result's `errorKind` is `cli-error` or `cli-unparseable` — NEVER `cli-timeout`
(this replaces the false coverage of mocked-only TEST-471 for the runner's classification, which
proved JSON serialization, not OS behavior); (2) a genuine-timeout vector (a sleeping child +
a small `timeoutMs`) still resolves `timedOut === true` → `cli-timeout`, and an abort vector keeps
its current handling — the elapsed-time class is unchanged; (3) a numeric-exit CLI error keeps
`{exitCode: <code>, timedOut: false}` (`:30-33` behavior byte-preserved); (4) renderer: a mocked
`api.orkySubmitWork` REJECTION renders `orky-capture-error` with `data-error-kind="ipc-failure"`,
indeterminate wording per REQ-009's copy-class pattern plus a duplicate warning and the rejection
text, and NOT the definite /did not go through|was not captured/i copy; (5) a structural pin: the
catch block in `OrkyCaptureModal.tsx` assigns no F7 `errorKind` literal (`cli-error` et al. absent
from the catch); (6) the runner's diff is confined to the error-classification branch —
`runOrkyCli`'s exported signature, the numeric-exit branch, `unref()`, and the never-reject
contract are byte-preserved, and the runner's existing frozen suite (`orky-cli-runner.test.ts`)
passes with assertions byte-unchanged.

## Open questions

None. The brainstorm's spec-time items (chord, copy, field shape) are resolved in decisions #1-#8;
FINDING-001's transport gap is resolved by the upstream `feedback submit` path (plugin v0.28.0)
plus REQ-013 — no escalation needed; revision 2's amendments are all decided by the resolved
ESC-001 (no new ambiguity introduced): FINDING-016's focus containment is a recorded residual with
a convention proposal (a Modal-seam change touching 20 consumer dialogs, not an open question),
and the remaining upstream items (F7's missing length bounds, `detail:''` acceptance, TEST-282's
unnamed retirement, the `cli.js:150` usage-line omission, the retired http-spool concern, the
FINDING-010 shape coupling) are flagged for the reviewer in "Upstream fit" and handled without
guessing — none blocks a testable spec.

## Review residuals (accepted and recorded — ESC-001)

Findings from the five-lens review that ride WITHOUT an F12 repair, each with its rationale (none
is silently dropped; none is resolved by this spec):

1. **FINDING-016 (Tab containment at the Modal seam)** — the capture dialog declares
   `aria-modal="true"` but the shared `Modal` substrate provides no focus containment
   (`Modal.tsx:83-90`): Tab past the last control walks focus into the backdropped app.
   **Deferred:** the correct fix is at the Modal seam (per-dialog copies are forks), and that seam
   is shared by **20** consumer dialogs (grep-verified) with frozen focus-behavior pins riding it
   (the collapsed-focus microtask refocus, `Modal.tsx:66-76`, 0009 FINDING-026; the picker/palette
   focus suites) — not a cheap, F12-scoped change. Mitigation noted: Escape is handled at the form
   root (`OrkyCaptureModal.tsx:157`) and works while focus remains inside the dialog. Convention
   proposal recorded (#8) so the seam repair is a designed future change.
2. **FINDING-010 (cross-repo `mode:'noop'` shape coupling)** — REQ-013's disabled-refusal
   discrimination rests on the shipped plugin's shape with no shared schema/contract test across
   the repo boundary. Rides per ESC-001 as a candidate for a future golden-fixture suite pinning
   the `submitItem` refusal shapes; the coupling is documented in REQ-013 and the dispatcher-doc
   updates (REQ-011).
3. **FINDING-023 (tracked `NUL` file at the repo root)** — pre-existing Windows-reserved-name debt
   (introduced by 0009's commit), breaks Windows checkout/stash. Outside F12's scope; to be
   removed in a separate repo-hygiene commit per ESC-001.

## Proposed conventions (for doc-sync consideration)

1. (from the TEST-282 ruling) A frozen launch-scoped absence guard ("no X renders at fresh start")
   that a later feature's UI could only trip by testid-substring collision should have its
   namespace boundary documented by the first feature that ships adjacent UI, so "not superseded —
   namespace-avoided" is a recorded decision rather than an accident.
2. (from FINDING-004) A count/single-flight discipline on a component that ships inside a
   StrictMode-wrapped tree MUST include a StrictMode (double mount/effect invocation) vector, not
   only a plain real-lifecycle mount — and the dispatch such a discipline guards MUST be pinned to
   an event handler, never an effect. *(Refined by #5: the vector is only claimable in a harness
   that actually runs React's development build; absent one, the event-handler structural pin IS
   the guard and must be recorded as such.)*
3. (from FINDING-005) When a reused dialog gains a flow-specific accessible name, its visible
   heading MUST be configurable in the same change (defaults preserved) so the screen-reader name
   and the visible copy can never diverge.
4. (from FINDING-013) When a surface owning a non-idempotent in-flight write is dismissed, the
   settled outcome MUST still be reported through a component-independent user-facing signal
   (`error`-kind for failures — never suppressible) — never dropped silently.
5. (from FINDING-018) A StrictMode/dev-only-behavior acceptance vector MUST name a harness that
   actually runs React's development build — a production-build e2e does not exercise StrictMode
   semantics and must never be cited as doing so.
6. (from FINDING-021) A frozen structural test that locates a code site via a whole-file
   `.indexOf()` string search MUST anchor the search (a scoped substring, a preceding/following
   marker, or a bounded regex) rather than a bare literal that can collide with unrelated
   occurrences elsewhere in the same file — and any source reshaped to dodge such a locator MUST
   carry an in-code comment naming the test, so a revert cannot silently break it.
7. (from FINDING-020, subsuming FINDING-007's proposal) A frozen-pin supersession performed at the
   tests phase under CONV-019 — including a prose-only one — MUST be reflected back into the spec
   document's own enumeration in the same change (a tests-phase artifact is not a substitute for
   correcting the spec's MUST-level claim), and a CONV-008 stale-claim sweep triggered by changing
   a mechanism MUST include test files' descriptions/comments (`tests/**`, repo-wide), not only
   src/docs/baseline — a frozen test whose prose states the old mechanism is a stale doc like any
   other.
8. (from FINDING-016) A dialog rendered with `aria-modal="true"` MUST contain Tab focus within the
   dialog (via the shared Modal substrate, never per-dialog copies), so the accessibility claim
   and the keyboard reality agree.
