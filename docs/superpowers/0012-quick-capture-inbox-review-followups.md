# Quick-capture new-work inbox (Orky 0012) — Review Follow-ups (deferred)

Feature `0012-quick-capture-inbox` — Termhalla's first RENDERER consumer of F7's `orkyAction:*`
write-capable dispatch surface — had a long cycle: a spec revised once pre-gate (FINDING-001…007,
including a cross-repo design gap that shipped an upstream Orky-plugin fix), a five-lens review
that filed 16 findings (2 blocking contract violations) against a green build, a
spec→tests→implement fix cycle re-grounding on the `submit` path, and a consolidated re-verify
that caught one fix-introduced regression (FINDING-024) closed via a final mini-loopback. All
gates through review are green; 24-finding ledger. See the per-finding records in
`.orky/features/0012-quick-capture-inbox/findings.json` and the full narrative in
`.orky/features/0012-quick-capture-inbox/04-tests.md`.

## Review timeline

1. **Spec-gate devils-advocate pass (revision 1):** filed FINDING-001…007. The standout was
   **FINDING-001 (HIGH, contract violation)** — the draft spec's decision #6/REQ-008 pinned the
   capture's ground truth on Orky's `feedback emit` command, which writes to the project's feedback
   **outbox** (plugin→control-plane direction). But the orchestrator's `apply` pulls the **inbox**
   — nothing shipped in Orky at the time bridged an emitted outbox `work.request` event into an
   applyable inbox item for file-mode projects (the default, local case). The spec's "captured —
   queued in the inbox for triage" copy was therefore untrue end-to-end for the exact case F12
   exists to serve. **This finding drove an upstream fix**: Orky's `feedback` plugin shipped
   `v0.28.0` with a new `feedback submit`/`submitItem` local-inbox-injection command specifically to
   close this gap (see "Cross-repo note" below). The spec was re-grounded on `submit` (new
   **REQ-013**, an in-place amendment to F7's `doSubmitWork`), verified by EXECUTING the full chain
   in a scratch `.orky` tree (submit → inbox JSON → `apply` → `backlog.jsonl` `status:'pending'`,
   byte-verbatim). FINDING-002 (http-mode success-shape completeness), FINDING-003 (a genuine
   self-contradiction in REQ-002's acceptance — the normative text said `orky-capture-error` renders
   only on failure, the acceptance demanded it render at open), FINDING-004 (a StrictMode
   acceptance vector the repo's harnesses cannot actually run — later corrected properly in
   revision 2 / FINDING-018), FINDING-005 (the reused `OrkyRootPicker`'s VISIBLE heading stayed
   "Bind to a tracked Orky project" while only the aria-label was relabelled for capture), and
   FINDING-006 (a stale-claim sweep scope gap) were all repaired in place.
2. **Five-lens review of the implementation** (devils-advocate, security ×2, ux ×4, quality ×3,
   codex-cross-check) against a green build: **16 findings, 2 blocking contract violations**.
   - **FINDING-020 (quality, HIGH, contract violation)** — REQ-011's frozen text claimed TEST-290
     stayed "byte-unchanged" and enumerated exactly SIX frozen-pin supersessions, but the shipped
     `orky-action-validate.test.ts` diff (assertions untouched, prose repaired per FINDING-007) was
     a real, undocumented seventh supersession the frozen spec never acknowledged — a live
     CONV-019/CONV-023 violation the review caught mechanically.
   - **FINDING-009 (security, MEDIUM→addressed as REQ-014, contract violation)** — `runOrkyCli`
     mapped EVERY non-numeric-exit `execFile` error (a genuine 15s timeout, an abort, AND a
     spawn-level failure such as an oversized command line) into one shape, `timedOut:true`, which
     renders as the INDETERMINATE `cli-timeout`. F12 is the first renderer-reachable surface that
     lets a human paste an arbitrarily large `detail` into the `--json` argv element REQ-013
     introduced — an oversized payload triggers a spawn-class OS error (the child never ran, so
     nothing could have been written), yet the shared runner reported it as "may have been
     captured," which is false and invites a duplicating retry.
   - **FINDING-012 (ux, MEDIUM)** — Enter in the title submits immediately with zero visible
     affordance; combined with `mod+Enter`/Escape being equally undiscoverable and
     toasts-off-by-default, an accidental Enter was silent end-to-end.
   - **FINDING-013 (ux, MEDIUM)** — closing the modal mid-flight (Escape/Cancel/backdrop) dropped
     the settled outcome on BOTH sides: a failure was reported nowhere, a success landed with no
     disclosure that close cannot abort an in-flight write.
   - **FINDING-018 (devils-advocate, MEDIUM)** — the FINDING-004 StrictMode-acceptance repair was
     itself unrunnable as written: no harness in the repo (`node`-env unit tests, or a
     production-bundle e2e) actually executes React's development build, so the frozen e2e header's
     claim of measuring StrictMode-wrapped counts was a false mechanism claim.
   - **FINDING-022 (quality, MEDIUM)** — REQ-004's five-clause acceptance for the D4 pre-selected-
     root path was only ~20% tested; the render/dispatch clauses require mounting the component with
     a non-null `initialRoot`, which no shipped caller exercises until F10.
   - Plus FINDING-008/010/011/014/015/016/017/019/021 (see `findings.json`); all resolved except
     the three explicitly-accepted residuals (010, 014 substance-addressed, 016, 023) inherited
     below.
3. **Spec+tests+implement fix cycle (ESC-001, revision 2).** Human-approved loopback to spec:
   REQ-011 amended to enumerate SEVEN supersessions with the repo-wide CONV-023 grep scope; NEW
   **REQ-014** pins the spawn-vs-timeout classification (`runOrkyCli` now distinguishes
   `err.syscall.startsWith('spawn')` — DEFINITE `cli-error`/`cli-unparseable` — from the genuine
   elapsed-time class — INDETERMINATE `cli-timeout`) and a renderer-scoped `ipc-failure` kind for an
   `ipcRenderer.invoke` REJECTION (never an F7-mapped literal, routed through the same indeterminate
   copy class); REQ-002 gained the always-visible `orky-capture-hint` line and textarea/error
   overflow clamps; REQ-009 pinned close-while-in-flight as a DETACHED outcome routed through a
   never-suppressed `pushToast` chokepoint (never dropped) plus failure-clearing on draft-edit/
   root-change; REQ-006/REQ-012's StrictMode acceptance was corrected to name the actual guard (the
   structural pin that `orkySubmitWork` never lives inside a `useEffect`); REQ-004's acceptance was
   honestly re-scoped (slice seam + structural pin covered now, the four render/dispatch clauses
   explicitly inherited by F10's e2e). Tests phase added TEST-507…528 (22 new ids); RED-state
   evidence: full `npm test` **1294 passed, 14 failed**, exactly the intended rev-2 reds. Implementer
   fixed all 14; re-verification closed every blocking/spec-origin finding.
4. **Consolidated re-verify + fix-introduced regression (FINDING-024).** Re-verifying FINDING-013's
   detached-toast fix, security lens found it had **contradicted REQ-009's own MUST**: the fix
   correctly routed a detached failure through a never-suppressed toast, but used UNIFORM definite
   wording ("Capture failed for…") for every kind — including `cli-timeout`/`ipc-failure`, the
   indeterminate kinds REQ-009/CONV-015 require to read as uncertain. A user closing the modal
   during a slow dispatch that then timed out would read a false "failed" and retry, creating
   exactly the duplicate CONV-015 exists to prevent. **Final mini-loopback**: the `!stillMounted`
   branch now discriminates by `fail.kind`, matching the in-modal region's own split; pinned by new
   TEST-529 (`tests/renderer/orky-capture-detached-honesty.test.ts`), with TEST-527 (the FINDING-013
   pin) staying green.
5. **Doc-sync (this pass, 2026-07-02):** added TEST-529 to REQ-009 in `traceability.json` (the only
   gap found — every other TEST-NNN reference verified present as a real marker); regenerated
   `traceability.md` in full (was a phase-3 planning stub with an empty tests column, and predated
   REQ-014 entirely); updated `docs/features/quick-capture-inbox.md` (hint line,
   `ipc-failure`/spawn-vs-timeout classification, detached-toast honesty-class parity) and
   `docs/features/orky-action-dispatch.md`'s `submitWork`/CLI-runner sections (the spawn-class vs.
   elapsed-time classification, REQ-014) to match final shipped behavior; extended the `CHANGELOG.md`
   `[Unreleased]` entry to name the same three rev-2 additions it previously omitted; promoted four
   general lessons to `.orky/conventions.md` as CONV-032…CONV-035 (see below); recorded the
   cross-repo Orky-plugin dependency this feature drove.

## Cross-repo note: this feature drove an Orky-plugin change

FINDING-001's spec-gate finding (the outbox/inbox transport gap — see step 1 above) wasn't just a
spec correction: it identified that Termhalla's own capture flow had **no shipped path to work**
against a file-mode project using the plugin surface that existed at spec-draft time. The fix
landed upstream in the Orky plugin repo (`C:/dev/Orky/plugin/feedback/`) as **`feedback submit`**
(`submitItem`, `feedback.js:278-299`; CLI wiring `cli.js:71-88`) — plugin **v0.28.0** — the
sanctioned local-inbox-injection command this feature's REQ-013 now rides exclusively. The
integration between Termhalla and the Orky plugin is therefore **bidirectional**: Orky's pipeline
builds Termhalla features, and a Termhalla feature's spec-gate review found and drove a genuine
upstream plugin gap closed in the same development window. Re-verified end-to-end by executing the
real chain (`submit --json` → `inbox/IN-*.json` → `apply` → `backlog.jsonl` `status:'pending'`)
against the shipped v0.28.0 plugin in a scratch `.orky` tree, byte-verbatim.

## Current open-findings residual (non-blocking)

Of the four ship-time residuals below (each reviewed and explicitly accepted as deferred, with a
documented inheritance path), two remain open: FINDING-014 and FINDING-016. FINDING-023 was resolved
2026-07-07 and FINDING-010 2026-07-12.

- ~~**FINDING-010 (security, LOW)** — `parseDisabledRefusal` discriminates on an unpinned plugin
  invariant~~ — **RESOLVED upstream 2026-07-12** (Orky v0.44.0, commit `9443bee`): `gatekeeper
  contract` gained an ADDITIVE `feedback.submit` block that pins exactly the shapes this finding
  named — the ok/refusal envelopes, the exit codes, and the discriminator itself
  (`disabled_discriminator`: "mode 'noop' appears ONLY on the feedback-disabled refusal; validation
  refusals carry the configured mode") — with Orky-side tests (`feedback.test.js` /
  `hardening.test.js`) enforcing it, so a future plugin release reusing `mode:'noop'` differently
  now fails loudly AT THE AUTHORITY instead of silently misclassifying here. `contract_version`
  stays 2, so Termhalla's hard-failing handshake pin (TEST-691) is untouched; the invariant is now
  a published contract field rather than an observed behavior, which is what the golden-fixture
  wish was for. `findings.json` closed via `resolve-finding`.
- **FINDING-014 (ux, LOW)** — substantively addressed: the per-errorKind RENDER vectors this finding
  originally flagged as missing now exist end-to-end in `tests/e2e/orky-capture.spec.ts` (TEST-525
  generic cli-error + http-refusal, TEST-526 cli-timeout indeterminate copy, TEST-527 close-mid-
  flight). Left OPEN per the coordinator's re-verify note — the coordinator judged this a status-
  bookkeeping call, not a remaining gap; doc-sync does not re-litigate it.
- **FINDING-016 (ux, LOW)** — the capture dialog declares `aria-modal="true"` but the SHARED `Modal`
  substrate provides no Tab-focus containment (F12 is the third keyboard-first Orky surface on this
  seam, after F9's picker). Deferred as a shared-Modal-seam fix, not F12-scoped; the proposed
  convention (CONV-035, below) makes the gap explicit and future-consuming dialogs are on notice not
  to re-discover it independently.
- ~~**FINDING-023 (quality, LOW)** — a tracked `NUL` file at the repo root~~ — **RESOLVED**
  (verified 2026-07-07: `NUL` is no longer tracked nor present on disk). Original record: a
  Windows-reserved device name that Win32 file APIs intercept, breaking `git stash`/`checkout`
  on Windows; was recorded as a separate repo-hygiene follow-up (`git rm NUL` + a path-component
  CI guard) outside this feature's scope.

## Promoted to conventions

Four general lessons from this feature's `propose CONV:` findings were promoted to
`.orky/conventions.md` as **CONV-032 through CONV-035** (continuing from 0009's CONV-031, the
current max before this feature):

- **CONV-032** (from FINDING-021) — a frozen structural test locating a code site via an unanchored
  whole-file string search must anchor the search, and a reshape done purely to dodge such a
  collision must carry an in-code comment naming the test.
- **CONV-033** (from FINDING-018) — a StrictMode acceptance vector must name a harness that
  actually runs React's development build; a production-build e2e never exercises StrictMode and
  must not be cited as doing so.
- **CONV-034** (from FINDING-013, refined by FINDING-024) — a dismissed non-idempotent in-flight
  write's outcome must still be reported through a component-independent signal, AND that detached
  report must carry the same honesty class (indeterminate vs. definite) as the in-flight path would
  have.
- **CONV-035** (from FINDING-016) — a dialog declaring `aria-modal="true"` must contain Tab focus
  within the dialog via the shared modal substrate, never a per-dialog copy.

One item from the parent task's candidate list was evaluated and NOT promoted as a new convention:
**"every-instantiation-path coercion"** is already covered by the existing **CONV-026** (from
0009-native-orky-pane, "a load-time coercion guarantee must cover EVERY deserialization/
instantiation path of the persisted shape") — no F12 finding proposed a narrower or conflicting
version of this rule, so no duplicate entry was added.

Three other `propose CONV:` lines appear in this feature's findings (FINDING-005 — reused-dialog
visible-heading configurability; FINDING-007 — CONV-008 sweep scope must include `tests/**` prose;
FINDING-020 — a tests-phase CONV-019 supersession must be reflected back into the spec's own
enumeration in the same change) but were **not** in this doc-sync pass's promotion list and were
left unpromoted; each remains a resolved, in-feature-scoped `findings.json` entry, not lost —
revisit if a future feature's review surfaces the same lesson independently.

## Resolved in-feature (not deferred)

FINDING-001…007 (spec gate, all 7 — including the cross-repo outbox/inbox re-grounding),
FINDING-003 (REQ-002's self-contradictory acceptance), FINDING-005 (picker visible-heading
configurability), FINDING-008/015 (stale failure region on draft-edit/root-change, consolidated),
FINDING-009 (spawn-vs-timeout classification, REQ-014), FINDING-011 (`projectRoot` `rejectFlagLike`
guard), FINDING-012 (the discoverability hint line), FINDING-013 (detached-outcome reporting — see
FINDING-024 for its honesty-class refinement), FINDING-017 (textarea/error overflow containment),
FINDING-018 (the StrictMode acceptance-mechanism correction), FINDING-019 (the invoke-rejection
catch's `ipc-failure` kind), FINDING-020 (REQ-011's seven-supersession enumeration),
FINDING-021 (the CommandPalette locator-collision in-code comment), FINDING-022 (REQ-004's honest
acceptance scoping), FINDING-024 (the detached-toast honesty-class regression, final mini-loopback)
— see `findings.json` for each `resolution` field and exact fix evidence.
