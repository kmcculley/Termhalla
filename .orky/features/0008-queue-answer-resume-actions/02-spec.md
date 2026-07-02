# 0008 — One-click answer-escalation + resume on queue entries (write)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (five FIXED decisions
D1–D5); **amended pre-gate 2026-07-02** — Q1 (resume semantics) RESOLVED by coordinator decision
(delegated human authority): resume is realized as a two-part honest design (next-action preview +
resume-in-terminal), never a headless write-drive. REQ-005 amended; REQ-014 added. **Revised
pre-gate 2026-07-02 (findings repair, FINDING-001..006):** REQ-015 added (pointer isolation of the
actions region — the click twin of CONV-030); REQ-003 identity-binds the escalation target;
REQ-007 single-flight moved to a shared cross-instance gate; REQ-009 reclassifies
`cli-unparseable` on mutating answers as indeterminate; REQ-013 corrects a false "no frozen test
pins this" claim (frozen TEST-503 DOES pin the ipc-contract consumer comment) and scopes the
CONV-008 sweep accordingly; REQ-014 states the `claude` `/orky:resume` invocation honestly (the
slash-command-as-initial-arg expansion is an external Claude Code contract, not verified from
source — degradation is a visible interactive session, never a silent failure). The coordinator's
Q1 two-part-resume decision is FIXED and unchanged. REQ-IDs are stable; never renumber.

This is the FIRST **write** capability on F6's read-only decision queue and the first renderer
consumer of F7's `resolveEscalation` / `recordHumanGate` / `driveStatus` bridges (F12 already
consumed `submitWork`). It adds **zero** new IPC channels, **zero** new preload methods, **zero**
new main-process modules, **zero** renderer-side CLI paths, and writes nothing under any `.orky/`
tree directly — every Orky mutation goes through F7's already-hardened `orkyAction:*` surface
(validated, allowlisted, audited, per-feature serialized, CLI-only). The renderer diff is chrome
plus one NEW shared action-layer module that F10's OrkyPane later mounts verbatim (D5), plus at
most a small store-level launch helper that composes the EXISTING `commitPane` terminal-spawn path
(the same primitive `launchDir`/`launchConnection` use) for REQ-014.

Two upstream realities are load-bearing and were verified against shipped source (see **Verified
contract**):

1. **The escalation id the answer needs is NOT carried by F6's queue item / the registry
   aggregate.** `DecisionQueueItem` carries `{projectRoot, featureSlug, status: OrkyFeatureStatus}`
   and `OrkyFeatureStatus` has no escalation-id field — the id lives only as free text inside
   `status.detail` and, structurally, only on the **F9 `registry:detail` channel**
   (`OrkyEscalationDetail.id`). The answer therefore MUST source the target escalation id from the
   F9 detail pull, never from the queue row — and MUST bind to that id as an IDENTITY, captured at
   display time and re-verified at dispatch time, never re-selected positionally (REQ-003). D2's
   "the entry already carries … the escalation id" is true only via the F9 detail channel, and
   requires an async pull.
2. **F7 offers NO write-capable "resume" — and by design it never will silently drive a pipeline.**
   F7's only drive action, `driveStatus`, is READ-ONLY and returns `dispatched:false` *always*
   (0007 REQ-009; `orky-action-dispatcher.ts:296-319`). Per the coordinator's Q1 resolution
   (**Resolved questions**), "resume" is TWO honest parts: (a) the read-only **next-action
   preview** off `driveStatus` (REQ-005), and (b) **resume-in-terminal** — a gesture that launches
   a REAL, visible terminal at the entry's project root running the `claude` binary with
   `/orky:resume` as its initial prompt argument, i.e. a user-initiated Claude session in the
   right project, via the shipped run-on-spawn launch path (REQ-014). Termhalla never headlessly
   drives an Orky pipeline; autonomous continuation stays in Orky's own sanctioned watchdog.

## Concerns

`security` `ux` `quality` `networking`

- `security` — write actions on the queue: every dispatch is gesture-tied (REQ-006, no dispatch
  from an effect/mount/render); the request is built only from the entry identity + the inline
  input, with no extra fields and no client-side rewrite that could smuggle around F7's validation
  (REQ-004); the escalation-id/verdict target is sourced from real data, identity-bound at display
  time and re-verified at dispatch, never guessed and never a positional re-selection (REQ-003);
  no new IPC/preload/CLI/`.orky` write path is introduced — all Orky writes go through F7's
  existing `api.orky*` bridges (REQ-001), and the only "continuation" affordance opens a visible,
  user-owned terminal (REQ-014) — never a headless drive; raw decision/evidence text is never
  logged renderer-side (F7's audit stores lengths only).
- `ux` — the inline answer flow (decision text for an escalation, with the bound target id shown
  beside the input; pass/fail verdict + optional evidence for a human-review entry), per-entry
  pending/result/disabled states, keyboard operability with CONV-030 target-guarded keys AND
  pointer isolation of the actions region so an action click never fires the row's own
  focus-project gesture (REQ-015 — the click twin of CONV-030), CONV-007 focus-visible chrome, and
  destructive-action clarity (answering changes real pipeline state; resume-in-terminal opens a
  real session) (REQ-004/REQ-008/REQ-012/REQ-014/REQ-015).
- `quality` — one shared action layer (D5, REQ-011) reused by F8 and F10; no forked dispatch or
  honesty logic; a single cross-instance single-flight gate, never a per-mount ref (REQ-007);
  result verdicts keyed ONLY on F7's own `ok`/`dispatched`/`errorKind`, never re-derived
  (REQ-008/REQ-009); the F6 pure module + slice stay read-only; the frozen-guard inventory is
  definitive and grep-documented (REQ-013). `data-provenance` is n/a — no factual data is bundled.
- `networking` — F7's partial-failure/indeterminate semantics surfaced correctly per action:
  `cli-timeout`, the renderer-synthesized `ipc-failure`, AND `cli-unparseable` are INDETERMINATE
  for a non-idempotent write (CONV-015 class — `cli-unparseable` is the honest superset: it covers
  BOTH a child that completed with unreadable stdout AND a spawn-class failure where the child never
  ran (empty stdout → `JSON.parse('')`), so the write's fate is genuinely unknown) and never read as
  a definite non-dispatch; `feedback-disabled` is the
  distinct no-write outcome; a shared single-flight gate prevents a duplicating double-dispatch
  across every mounted instance of the same target (REQ-007/REQ-009/REQ-010).

## Resolved spec-time decisions (with rationale)

1. **Answer mode is chosen from `status.reason`** (a structured `OrkyReason` field on the queue
   item, `decision-queue.ts:19` → `orky-status.ts` `OrkyFeatureStatus.reason`):
   `escalation` → `resolveEscalation` (inline decision-text input); `human-review` →
   `recordHumanGate(gate:'human-review', verdict:'pass'|'fail', evidence?)`; `stalled` → **no
   answer** (there is no escalation to resolve and no gate to record — only the next-action
   preview and resume-in-terminal are meaningful); `null` never appears (queue membership is
   `needsHuman === true`). This is exactly D2's context-driven answer, bounded by F7's validated
   action set.
2. **Resume = preview + resume-in-terminal (coordinator resolution of Q1, 2026-07-02).**
   (a) **Next-action preview** — `driveStatus` (the only drive F7 exposes, read-only) surfaced
   inline, honestly labeled ("next: run-phase spec" / "next: await-human" …), never claiming the
   pipeline advanced (REQ-005). (b) **Resume-in-terminal** — the actionable continuation: a
   gesture launches a terminal pane at the entry's `projectRoot` running the `claude` binary. The
   shipped run-on-spawn capability EXISTS and is the pinned mechanism: `TerminalConfig.launch:
   TerminalLaunch` (`types.ts:172-176`, `:256` — "when set, run this instead of a discovered
   shell") flows through `api.ptySpawn` (`TerminalPane.tsx:63-66`) → `register-pty.ts:74` →
   `PtyManager.spawn` which honors `cwd` and `launch` INDEPENDENTLY (`pty-manager.ts:19-30`; cwd
   at `:21`, launch resolved at `:22` via `resolveSpawnSpec`, `spawn-spec.ts:20-30`, PATH+PATHEXT
   resolution, run verbatim with no shell-integration injection). Precedents: `launchConnection`
   commits a launch-bearing pane (`quick-slice.ts:76-79`, ssh) and `launchCommand`
   (`store.ts:542-547`, cloud login). Note `launchDir` (`quick-slice.ts:84-90`) sets cwd only and
   `launchCommand` hardcodes `cwd:''` — so F8 composes `commitPane` (`store/types.ts:215`, the
   same primitive both use) with BOTH `cwd: projectRoot` and `launch`, per REQ-014. The argv is
   `claude` with `/orky:resume` as the initial prompt argument — `/orky:resume` is Orky's
   sanctioned human resume, documented as an IN-SESSION Claude Code slash command (Orky docs
   `setup.md:102,118`, `watchdog.md:47-48`, `design.md:649`); whether the initial-prompt arg
   auto-executes it is an EXTERNAL Claude Code contract, stated honestly in REQ-014 (the fallback
   is an interactive Claude session already at the correct project, visible in the user-owned
   pane — never a silent failure). A launch failure (claude not on PATH) is surfaced in-pane by
   the shipped path (`pty-manager.ts:31-34`) — no extra handling.
3. **Shared module, not inline dispatch** — the answer/preview/resume dispatch + per-entry state +
   F7 result-honesty mapping live in ONE new module `src/renderer/components/orky-entry-actions.tsx`
   (a hook `useOrkyEntryActions` + a presentational `OrkyEntryActions` component). `DecisionQueuePanel`
   imports and mounts it in each row; F10's OrkyPane mounts the same component keyed on the same
   identity (D5, REQ-011). The name deliberately contains neither the substring `orky-action` nor
   `orkyaction`, so frozen TEST-282/TEST-353 literals can never match it.
4. **Testid namespace `dq-action-*`** — `dq-action-answer`, `dq-action-preview` (the read-only
   next-action preview), `dq-action-resume` (resume-in-terminal), `dq-action-answer-target` (the
   bound escalation id + reason rendered beside the input, REQ-003), `dq-action-answer-input` (the
   escalation decision text), `dq-action-answer-submit`, `dq-action-verdict-pass`,
   `dq-action-verdict-fail`, `dq-action-evidence`, `dq-action-pending`, `dq-action-result`,
   `dq-action-error` (carrying `data-error-kind`). None contains `orky-action` or `orkyaction` as
   a substring (REQ-013). The existing `decision-queue-*` testids are untouched.
5. **Escalation selection at DISPLAY time mirrors the aggregate; dispatch is IDENTITY-bound.**
   When the answer UI opens, the target is the FIRST escalation with `status === 'open'` in
   state.json array order — byte-for-byte the same selection `orkyFeatureStatus` used to set
   `reason:'escalation'` (`orky-status.ts:219`), sourced from the F9 detail's `escalations` (file
   order verbatim, `orky-root-detail.ts:259`). That selection happens ONCE, at display/detail-fetch
   time; its `id` is CAPTURED, rendered beside the input (`dq-action-answer-target`), and passed
   explicitly to `resolveEscalation`. At submit time the bound id is RE-VERIFIED against a fresh
   detail pull — if it is no longer open, nothing is dispatched and an honest "escalation
   changed — re-open to answer" outcome is shown (REQ-003, per FINDING-003: first-open is
   positional, and the open set can change between display and dispatch — feedback apply, the
   watchdog, another window, the running pipeline). If the display-time escalation's `id` is
   null/empty, or the feature can't be matched, or the detail pull fails, answer is NOT dispatched
   and shows an actionable message — never a guessed id (D2, REQ-003).
6. **`feature` identity** — the F7 `feature` argument is the queue row's `featureSlug` (the
   `(projectRoot, featureSlug)` row identity, D2; `data-feature` on `decision-queue-item`). F7
   confirms it resolves to a real feature dir server-side and returns `feature-not-found` otherwise
   (`orky-action-dispatcher.ts:343-352`); on the escalation path (where a detail pull happens
   anyway) the detail feature's `slug` (the guaranteed-unique dir name, `orky-root-detail.ts:251`)
   is authoritative and used.
7. **F11 overlap (verified, complementary — not duplicated).** F11
   (`0011-orky-workspace-template`, `roadmap.json:69-75`) is a PERSISTED per-project workspace
   preset (OrkyPane + a project-root terminal) for "work this Orky project" as one gesture. F8's
   resume-in-terminal is the AD-HOC, entry-scoped single-gesture continuation from a queue row —
   the very gesture F11 later wraps into a saved template. F8 introduces no template/preset
   persistence; F11 will reuse the same `commitPane`+`launch` composition.

## Proposed convention (recorded for adoption at review — FINDING-001)

> **CONV-041 (proposed)** — A container-level pointer-activation (click) handler MUST be
> target-guarded, or nested interactive controls MUST stop propagation, so a nested control's
> activation never also fires the container's own gesture — the pointer twin of CONV-030.
> *(from FINDING-001 in 0008-queue-answer-resume-actions)*

## Public interface

```ts
// src/renderer/components/orky-entry-actions.tsx (names indicative) — the shared action layer (D5).

/** The stable identity an entry's actions key on — F8 supplies it from a queue row; F10 supplies it
 *  from an OrkyPane detail feature. escalationId is OPTIONAL: when the caller already has it (F10, off
 *  the registry:detail payload it renders) it is the DISPLAY-TIME bound id; when absent for an
 *  escalation entry (F8, whose queue row does not carry it) the hook sources and binds it via
 *  registryDetail at open time. Either way the bound id is re-verified at submit time (REQ-003). */
export interface OrkyEntryTarget {
  projectRoot: string          // the queue row's projectRoot, byte-verbatim (allowlisted server-side)
  featureSlug: string          // the (projectRoot, featureSlug) row identity — the F7 `feature` arg
  reason: OrkyReason           // 'escalation' | 'stalled' | 'human-review' | null — chooses answer mode
  escalationId?: string        // when known (F10): the display-time bound id; else bound at open via registryDetail
}

/** Async F7-dispatching action kinds (participate in pending/result single-flight state).
 *  resume-in-terminal is NOT one of these — it is a synchronous pane commit (REQ-014). */
export type OrkyEntryActionKind = 'answer' | 'preview'
export type OrkyEntryActionPhase =
  | { status: 'idle' }
  | { status: 'pending'; action: OrkyEntryActionKind }
  | { status: 'success'; action: OrkyEntryActionKind; message: string }        // honest, per REQ-008
  | { status: 'failure'; action: OrkyEntryActionKind; kind: string; error: string; indeterminate: boolean }

export function useOrkyEntryActions(target: OrkyEntryTarget): {
  phase: OrkyEntryActionPhase
  answerEscalation(decision: string): void   // reason==='escalation' → api.orkyResolveEscalation
  answerReview(verdict: 'pass' | 'fail', evidence?: string): void // reason==='human-review' → api.orkyRecordHumanGate
  preview(): void                             // api.orkyDriveStatus — read-only next-action preview (REQ-005)
  resumeInTerminal(): void                    // commitPane terminal at projectRoot running claude /orky:resume (REQ-014)
  busy: boolean                               // the SHARED single-flight gate over the async kinds (REQ-007)
}

// <OrkyEntryActions target={...} /> — the presentational region DecisionQueuePanel mounts inside each
// decision-queue-item row, and F10's OrkyPane mounts inside each feature row (REQ-011). The region
// isolates its pointer events from the host row's own click gesture (REQ-015).
export function OrkyEntryActions(props: { target: OrkyEntryTarget }): JSX.Element

// The renderer-scoped honesty classifier (extracted here so F8 and F10 share it — F12's equivalent
// logic is inline in OrkyCaptureModal and not reusable). For MUTATING answers, indeterminate ===
// kind is 'cli-timeout' | 'ipc-failure' | 'cli-unparseable' (REQ-009); for the read-only preview,
// indeterminate covers only the may-not-have-completed read (safe retry). An invoke REJECTION
// synthesizes { kind:'ipc-failure' } (never an F7 kind).

// The cross-instance single-flight registry (REQ-007): one shared gate per collision-proof
// composite key of (projectRoot, featureSlug, action) — a module-scope/store-level singleton every
// mounted useOrkyEntryActions instance in the window consults at gesture time (CONV-039 keying).
```

The F7 request/result shapes are consumed unchanged: `ResolveEscalationRequest`
(`types.ts:508-513`), `RecordHumanGateRequest`, `DriveStatusRequest`, `OrkyActionResult`
(`types.ts:496-506`), `OrkyActionErrorKind` (`types.ts:478-491`). No shared type is modified. The
pane-model shapes REQ-014 composes are consumed unchanged: `TerminalConfig`/`TerminalLaunch`
(`types.ts:250-263`, `:172-176`).

---

## Requirements

### REQ-001 — Answer + resume actions on each queue entry, Orky writes EXCLUSIVELY through F7 (D1) — `security` `quality`
Each `decision-queue-item` row MUST gain an actions region containing an **answer** control (when
applicable per REQ-002), a **next-action preview** control, and a **resume-in-terminal** control,
and EVERY Orky-write/read dispatch MUST go through F7's existing preload bridges —
`api.orkyResolveEscalation` / `api.orkyRecordHumanGate` / `api.orkyDriveStatus`
(`preload/index.ts:84,86,87`). F8 MUST NOT add any new IPC channel, preload method, main-process
module, or renderer-side CLI/`child_process`/`execFile` path, and MUST NOT write any `.orky/` file
directly. The dispatch code MUST live only in the new `orky-entry-actions` module — never in the F6
pure module (`src/shared/decision-queue.ts`) or the registry slice
(`src/renderer/store/registry-slice.ts`), which stay read-only/pure. (REQ-014's terminal launch is
a pane commit through the existing `pty:spawn` path — not an Orky write and not a new channel.)
**Acceptance:** a source scan of `orky-entry-actions.tsx` finds `api.orkyResolveEscalation`,
`api.orkyRecordHumanGate`, and `api.orkyDriveStatus` and finds no `child_process`/`execFile`/raw
`.orky` write/`registryAddRoot`/`registryRemoveRoot`; `decision-queue.ts` and `registry-slice.ts`
contain none of the four `api.orky*` bridge names and no CLI/mutation literal; no new `CH.*`
constant, preload method, or `src/main/**` file is added by this feature.

### REQ-002 — Answer is context-driven by the entry's needs-you reason (D2) — `ux`
The answer control's mode MUST be selected from the row's `status.reason`
(`decision-queue.ts:19`): for `reason === 'escalation'` answer MUST resolve THAT escalation via
`api.orkyResolveEscalation`; for `reason === 'human-review'` answer MUST record the human-review
verdict via `api.orkyRecordHumanGate` (`gate:'human-review'`); for `reason === 'stalled'` NO answer
control is offered (there is no escalation or gate to act on) — only the preview and
resume-in-terminal. The answer control MUST NOT invent a mode for a reason it does not handle.
**Acceptance:** with a mocked row `reason:'escalation'`, activating answer routes to
`orkyResolveEscalation` (spy) and never to `orkyRecordHumanGate`/`orkyDriveStatus`; with
`reason:'human-review'`, answer routes to `orkyRecordHumanGate` with `gate:'human-review'` and never
elsewhere; with `reason:'stalled'`, the `dq-action-answer` control is absent while
`dq-action-preview` and `dq-action-resume` are present.

### REQ-003 — The escalation target is IDENTITY-BOUND: sourced from the F9 detail channel at display time, shown to the user, re-verified at dispatch — never guessed, never positionally re-selected (D2) — `security`
*(Amended per FINDING-003: display-time first-open selection and dispatch are separated by an
unbounded window in which the open-escalation set can change; a positional dispatch-time selection
could land the human's decision on a DIFFERENT escalation than the one they read.)*
For an escalation answer:
1. **Bind at display time.** When the answer UI opens without a supplied `target.escalationId`, the
   module MUST pull `registryDetail(projectRoot)` (the F9 `registry:detail` channel), locate the
   feature (match the detail feature whose `slug` or `status.feature` equals the row
   `featureSlug`), take the FIRST escalation with `status === 'open'` (state.json array order — the
   same selection `orky-status.ts:219` used to mark the row `reason:'escalation'`), and CAPTURE its
   `OrkyEscalationDetail.id` as the bound target. When `target.escalationId` IS supplied (F10), it
   is the bound target as-is.
2. **Show the bound target.** The bound escalation's id (and its reason, when fetched) MUST be
   rendered beside the input (`dq-action-answer-target`) BEFORE dispatch, so the user sees exactly
   which escalation their decision text will resolve.
3. **Dispatch the bound id explicitly, verified.** Submit MUST pass the bound id — never a fresh
   positional pick — to `orkyResolveEscalation`, and MUST first RE-VERIFY it against a fresh
   `registryDetail` pull: if the bound id is no longer present as an OPEN escalation on the matched
   feature (resolved meanwhile, feature unmatched, or the verification pull fails), the answer MUST
   NOT be dispatched and MUST show an honest, actionable "the open escalation for this feature
   changed — re-open to answer" class message — never a silent wrong-target write. A bound id that
   is still open MUST be dispatched even if it is no longer positionally first (identity beats
   position).
It MUST NOT read an id out of the free-text `status.detail`, and MUST NOT fabricate or default an
id. If the display-time pull fails (`ok:false`), the feature cannot be uniquely matched, no open
escalation is found, or the open escalation's `id` is null/empty, the answer MUST NOT be
dispatched and MUST show an actionable message naming the reason (no CLI call is made).
**Acceptance:** with a mocked `registryDetail` returning a feature with an open escalation `ESC-007`
at both open and submit time, answering renders `dq-action-answer-target` containing `ESC-007`
before dispatch and dispatches `orkyResolveEscalation` with `escalationId:'ESC-007'` and the row's
`feature`/`projectRoot`; **race vector:** with the open-time pull returning `ESC-007` first-open
and the submit-time pull returning `ESC-007` resolved (a different escalation `ESC-009` now open),
`orkyResolveEscalation` is never called (spy count 0) and `dq-action-error` renders a message
matching /changed|re-?open/i; **identity-beats-position vector:** with the submit-time pull showing
`ESC-007` still open but no longer first, the dispatch still carries `escalationId:'ESC-007'`; with
`registryDetail` returning `ok:false`, no open escalation, an id-less open escalation, or two
features colliding on the slug, `orkyResolveEscalation` is never called and `dq-action-error`
renders a specific message; the id never originates from `status.detail` (a fixture whose detail
text names a different id proves the structural source wins).

### REQ-004 — Inline answer input, request built with no smuggling (D2) — `ux` `security`
The escalation answer MUST collect the decision text through an inline input (`dq-action-answer-input`)
and dispatch `orkyResolveEscalation({ projectRoot, feature, escalationId, decision })` with `decision`
byte-verbatim as typed; a decision that is empty or whitespace-only MUST NOT dispatch (the submit
control is disabled). The human-review answer MUST collect a `pass`/`fail` verdict (`dq-action-verdict-pass`
/`dq-action-verdict-fail`) and an optional evidence input (`dq-action-evidence`), dispatching
`orkyRecordHumanGate({ projectRoot, feature, gate:'human-review', verdict, ...(evidence non-empty ? { evidence } : {}) })`.
Each request MUST be built from EXACTLY the entry identity + the inline input — no extra keys, no
client-side transformation (no trimming into `--`-guards, no re-encoding) that could diverge from or
smuggle around F7's server-side validation (`orky-action-validate.ts`). An empty evidence field means
absence: the key is omitted (not sent as `''`).
**Acceptance:** the escalation submit is disabled for `''`/`'   '` decisions and enabled for
non-whitespace; the dispatched request object has exactly the keys
`{projectRoot, feature, escalationId, decision}` (no others), `decision` equal to the typed value
byte-for-byte; the human-review request has exactly `{projectRoot, feature, gate, verdict}` (plus
`evidence` only when non-empty), `gate === 'human-review'`, `verdict ∈ {pass,fail}`; a `--`-prefixed
decision/evidence is passed through unchanged (F7's validator owns the flag-like guard, not F8).

### REQ-005 — Resume is TWO honest parts: read-only next-action preview + resume-in-terminal; never a headless drive (D3 as amended, CONV-013) — `networking` `quality` `security`
*(Amended 2026-07-02 per the coordinator's Q1 resolution — supersedes the draft's "resume = honest
preview only" framing; the actionable continuation is REQ-014's terminal launch.)*
The actions region MUST realize "resume" as two parts:
1. **Next-action preview** (`dq-action-preview`): dispatch `api.orkyDriveStatus({ projectRoot,
   feature })` and surface its result inline, read-only. Because `driveStatus` is READ-ONLY and
   returns `dispatched:false` always (0007 REQ-009; `orky-action-dispatcher.ts:296-319`), the
   preview result MUST describe the computed next action (from `result.data`, e.g.
   "next: run-phase spec" / "next: await-human") and MUST NOT contain any word claiming the
   pipeline was mutated — no "resumed"/"advanced"/"dispatched"/"continued"/"unblocked". Failures
   follow REQ-009.
2. **Resume-in-terminal** (`dq-action-resume`): the actionable continuation — a gesture that
   launches a visible terminal at the entry's project root running the `claude` binary with the
   Orky resume as its initial prompt, per REQ-014. This is a user-initiated Claude session, never
   a headless drive.
F8 MUST NOT introduce any code path that advances an Orky pipeline without an interactive terminal
the user owns (TOS posture: every action traces to an explicit user gesture; autonomous
continuation belongs to Orky's own sanctioned watchdog, not Termhalla).
**Acceptance:** on a mocked `driveStatus` result `{ok:true, dispatched:false, data:{next:'await-human'}}`,
the preview result region renders next-action text and matches NONE of
`/resumed|advanced|dispatched|continued|unblock/i`; the preview request object is exactly
`{projectRoot, feature}`; a source scan of `orky-entry-actions.tsx` (and its helper, if any) finds
no F7 write-action invocation for resume (`orkyResolveEscalation`/`orkyRecordHumanGate`/
`orkySubmitWork` are never called from the preview or resume paths) and no drive-write CLI literal;
activating `dq-action-resume` triggers the REQ-014 pane commit and zero `api.orky*` calls.

### REQ-006 — Every dispatch is tied to an explicit gesture, never an effect (CONV-033-class) — `security`
`orkyResolveEscalation`/`orkyRecordHumanGate`/`orkyDriveStatus` — and the REQ-014 terminal-launch
pane commit — MUST be called ONLY from an explicit user-gesture handler (a click, or a
target-guarded Enter/Space on the control or the inline-input submit) — never from a `useEffect`
body, a mount effect, or render. This is the structural guard against StrictMode double-invocation
(no dev-build test harness exists in this repo, per the F12 Verified contract) and against any
auto-dispatch or auto-launched terminal.
**Acceptance:** a source scan of `orky-entry-actions.tsx` finds each `api.orky*` call and the
launch/commit call inside an event-handler function and finds NONE inside a `useEffect(...)`
callback body (structural pin); merely mounting `OrkyEntryActions` (or the panel) issues zero
`api.orky*` calls and commits zero panes (spy count 0 until a gesture fires).

### REQ-007 — Single-flight per TARGET+action, shared across every mounted instance (CONV-013/CONV-039/networking) — `networking`
*(Amended per FINDING-004: a per-hook-instance ref cannot deliver the promise — the same entry
mounts twice by design: the decision-queue drawer AND F10's OrkyPane mount `OrkyEntryActions` for
the same identity in the same window.)*
Each `(target, async action)` — answer and preview, keyed by `(projectRoot, featureSlug, action)` —
MUST allow at most one in-flight dispatch ACROSS ALL mounted instances of that target in the
window: the gate MUST live at a shared seam (a module-scope/store-level in-flight registry the
hook consults, never a per-instance ref or state-in-closure), checked at gesture/event time so two
gestures landing before a re-render — or on two different mounts of the same entry — cannot both
dispatch. The composite key MUST use a separator or structural encoding that cannot occur inside a
path or slug (CONV-039). Answer and preview are independently gated; while a dispatch is in flight
EVERY mounted instance of that target renders the pending state (`dq-action-pending`) with the
corresponding control disabled. Distinct targets are independent. Resume-in-terminal is synchronous
(a pane commit) and is covered by REQ-014's exactly-one-pane-per-gesture rule instead.
**Cross-window honesty:** separate OS windows are separate renderer processes and share no store;
this gate does not (and cannot) dedupe across windows — cross-window duplicates rely on F7's
per-feature serialization plus REQ-009's honest surfacing of the second write's own result. The
spec claims no guarantee the mechanism cannot deliver.
**Acceptance:** firing the answer gesture twice synchronously on ONE instance (before the first
promise settles) yields exactly ONE `orkyResolveEscalation` call; **two-instance vector:** with TWO
`useOrkyEntryActions` instances mounted for the SAME target (an F8-style and an F10-style mount),
firing the answer gesture on each before the first settles yields exactly ONE dispatch (spy count
1) and BOTH instances report `busy`/render `dq-action-pending`; two different targets dispatch
independently; while a dispatch is pending the corresponding control is `disabled`/`aria-disabled`.

### REQ-008 — Per-entry pending/result states, honest (D4, CONV-013) — `ux` `quality`
Each async action MUST show a pending state while in flight, then a result keyed ONLY on F7's
returned `ok`/`dispatched`/`errorKind` (never re-derived from the transport). A SUCCESS message
MUST name only what actually happened and MUST NOT over-claim: escalation answer success →
"escalation answered / decision submitted" class (never "feature done/complete"); human-review answer
success → "human-review verdict recorded" class; preview success per REQ-005 (next-action text,
no mutation claim). Success for a mutating answer requires `ok === true && dispatched === true`; a
`dispatched:false` answer result is never rendered as a durable success.
**Acceptance:** a mocked `orkyResolveEscalation` `{ok:true, dispatched:true}` renders success text
matching /answered|submitted|recorded/i and NOT /done|complete/i; a mocked `{ok:true, dispatched:false}`
answer result does NOT render durable-success wording; `dq-action-result` renders only after a settled
result and is absent while idle/pending.

### REQ-009 — Failure honesty classes: verbatim, definite vs indeterminate, feedback-disabled distinct (D4, CONV-001/015/034) — `networking` `ux`
*(Amended per FINDING-006/FINDING-007: `cli-unparseable` on a MUTATING answer joins the indeterminate
class — `mapCliRunToResult` folds into `cli-unparseable` (`orky-action-result.ts:42-56`, reached only
past the timeout branch, even at exit 0) BOTH a completed child with unreadable stdout AND a
spawn-class failure whose child never ran (empty stdout → `JSON.parse('')`, per
`orky-cli-runner.ts:52-56,63-67`); the kind therefore mixes completed-unreadable with never-executed,
so the durable write's fate is genuinely UNKNOWN — not a proof the child finished. Branding it
definite is the same false certainty CONV-015 bans for timeouts and invites the duplicating retry. This aligns with the F12 precedent's
CONV-034 gap-fix: the honesty class follows what is actually known, per kind, per action.)*
Every `ok:false` result MUST render its F7 `error` VERBATIM (CONV-001) in `dq-action-error` carrying
`data-error-kind={errorKind}`, classified by honesty **for the mutating answers**:
- **INDETERMINATE** — `cli-timeout`, the renderer-synthesized `ipc-failure`, AND `cli-unparseable`
  (the child either completed with an unreadable report OR never ran — the write's fate is unknown): wording
  MUST be the indeterminate class ("may or may not have …; retrying may duplicate"), never a
  definite non-dispatch.
- **DISTINCT no-write** — `feedback-disabled` ("nothing was written; enabling the write path is an
  audited human decision made outside Termhalla, ADR-027") with NO auto-enable affordance.
- **DEFINITE** — every remaining kind (`cli-error`, `orky-cli-not-found`, `invalid-args`,
  `root-not-allowed`, `feature-not-found`, `gate-not-allowed`, `unknown-sender`).
An invoke REJECTION MUST synthesize `{ errorKind:'ipc-failure' }` (renderer-scoped, indeterminate) —
never mislabeled as an F7 kind and never a definite non-dispatch. Preview (`driveStatus`) failures
use the same classifier, but because `driveStatus` is read-only its indeterminate kinds (including
`cli-unparseable` and `cli-timeout`) MUST NOT warn about duplicate writes — they state the read may
not have completed and retrying is safe.
**Acceptance:** mocked ANSWER results of each kind (`feedback-disabled`, `cli-timeout`,
`cli-unparseable`, `cli-error`, `orky-cli-not-found`, `invalid-args`, `root-not-allowed`) render
`dq-action-error` with the matching `data-error-kind` and the CLI's error text verbatim;
`cli-timeout`, `cli-unparseable`, and a thrown-invoke `ipc-failure` on an answer render
indeterminate copy (matching /uncertain|may still|may have|duplicate/i) and NOT definite
non-dispatch copy; a `cli-timeout` or `cli-unparseable` PREVIEW failure renders indeterminate copy
WITHOUT duplicate-warning wording (safe-retry class); `feedback-disabled` renders the distinct
no-write message with no enable button; a rejected `api.orkyResolveEscalation` promise yields
`data-error-kind="ipc-failure"`, never an F7 kind.

### REQ-010 — Detached outcome never silently dropped (CONV-034) — `networking`
If the row/drawer unmounts (drawer closed, or the entry leaves the queue on the next aggregate
refresh) while an async dispatch is in flight, the settled outcome MUST NOT update the removed
component but MUST still be reported through the store-level toast chokepoint (`pushToast`) — a
FAILURE as a never-suppressed `error`-kind toast (`toasts-slice.ts:20`), carrying the SAME honesty
class the in-flight path would have (indeterminate wording for
`cli-timeout`/`ipc-failure`/`cli-unparseable` answers; distinct feedback-disabled wording). No
outcome is ever silently swallowed. The shared single-flight gate (REQ-007) MUST be released on
settle regardless of mount state.
**Acceptance:** with the component unmounted after dispatch but before settle, a mocked
`cli-timeout`/`ipc-failure`/`cli-unparseable` answer result routes an `error`-kind toast with
indeterminate wording; a `cli-error` result routes an `error`-kind toast with definite wording; the
store's success path is suppressible while the error path is not (the `kind !== 'error'`
early-return is the pinned mechanism); no state update is attempted against the removed component;
after settle the shared gate accepts a new dispatch for that target.

### REQ-011 — Shared, F10-reusable action layer (D5) — `quality`
The answer/preview/resume dispatch + per-entry state + honesty classifier + the shared single-flight
gate MUST be a single shared unit (`useOrkyEntryActions` + `OrkyEntryActions`) keyed on
`OrkyEntryTarget` (`projectRoot, featureSlug[, escalationId]`), with no dependency on the queue
drawer's DOM — so F10's OrkyPane can mount `OrkyEntryActions` for a detail feature row unchanged
(passing the display-time escalation id it already has, so no OPEN-time sourcing pull is needed
there; the submit-time verification pull of REQ-003 applies identically on both paths). The
dispatch/honesty/launch logic MUST NOT be forked into `DecisionQueuePanel` or duplicated from F12's
inline `OrkyCaptureModal` logic.
**Acceptance:** `DecisionQueuePanel.tsx` imports and renders `OrkyEntryActions` and contains no
`api.orky*` call of its own; the module's exported hook/component accept the `OrkyEntryTarget`
interface (structural pin); a unit test drives `useOrkyEntryActions` with both an F8-style target
(no id → display-time sourcing pull + submit-time verification pull) and an F10-style target (id
supplied → NO display-time sourcing pull; exactly ONE `registryDetail` call, the submit-time
verification).

### REQ-012 — Keyboard operability + themed, accessible chrome (D4) — `ux`
The actions region MUST be fully keyboard-operable: controls are native focusable elements; any
container-level Enter/Space handling MUST target-guard so a nested control's own activation is never
suppressed or redirected (CONV-030); pointer activation is isolated per REQ-015. As chrome inside
the decision-queue drawer it MUST carry visible `:focus-visible` styling via the established
allow-list (CONV-007) and use only defined theme tokens with their standard fallback (CONV-029;
failure styling via `--status-failure`/`#c62828`, never a novel `var()` name — note frozen TEST-350
scans the PANEL source for raw hex outside `var()` fallbacks, so any styling F8 adds inside
`DecisionQueuePanel.tsx` is bound by it byte-unchanged). The action controls MUST NOT strip the
row's existing accessibility (no presentational role added to the row).
**Acceptance:** Enter on the focused answer/preview/resume button activates THAT button (not a
redirected default); a source scan finds the new chrome covered by a `:focus-visible` rule that sets
`outline` and is never `outline: none`; no raw hex color appears outside a standard-fallback `var()`
and no undefined variable name is referenced; the row keeps its `decision-queue-item`/
`data-project-root`/`data-feature` contract (F6 TEST-346 stays green).

### REQ-013 — Frozen-guard supersession + no-substring discipline (CONV-019/023/037) — `quality`
*(Amended per FINDING-002: the draft falsely claimed no frozen test pins the ipc-contract consumer
comment — frozen TEST-503 pins exactly that region. Corrected below; the CONV-008 sweep is scoped
to keep TEST-503 green byte-unchanged.)*
F8 is the designed first consumer of the queue-write path, so its frozen scope guards MUST be
handled deliberately at the tests phase, never silently during implementation:
- **TEST-353** (`tests/renderer/decision-queue-panel-structure.test.ts:138-157`) bans
  `orkyAction`/`child_process`/`execFile`/registry-mutation literals in F6's three files. Its bans on
  `src/shared/decision-queue.ts` and `src/renderer/store/registry-slice.ts` MUST stay green
  byte-unchanged (those files remain pure/read-only — F8's dispatch lives in the new module). Its
  read-only intent over `DecisionQueuePanel.tsx` is SUPERSEDED by F8 (the panel now composes the
  write-capable `OrkyEntryActions`): even though the mount literally trips none of its banned
  substrings (verified — `OrkyEntryActions`/`orky-entry-actions` contain no banned literal), the
  guard MUST be amended atomically at the tests phase per CONV-019, re-expressed so the panel may
  mount the F8 action component while still containing no raw CLI/`child_process`/registry-mutation
  call of its own (the `api.orky*` dispatch stays in `orky-entry-actions.tsx`). TEST-353's header
  names no retiring feature (a pre-CONV-019 gap); F8 records itself as the retiring consumer.
- **The F6 launch-path pin stays green:** the panel-structure suite's positive match
  `/launchDir|commitPane/` (`decision-queue-panel-structure.test.ts:114-115`, the F6 pane-less
  fallback pin) remains satisfied — REQ-014's launch composes `commitPane`, the very pattern the
  pin expects; no change to that assertion is needed or permitted.
- **TEST-282** (`tests/e2e/orky-action-dispatch.spec.ts:48-56`) asserts no element carries an
  `orky-action`/`orkyaction` testid. F8's `dq-action-*` testids and the `orky-entry-actions` module
  name contain neither substring, so this guard stays green byte-unchanged (and it MUST).
- **CONV-008 stale-claim — PINNED by frozen TEST-503 (`tests/docs-feature-0012.test.ts:69-107`).**
  The ipc-contract consumer comment (`ipc-contract.ts:183-185`) contains 0012's pinned
  first-consumer statement AND the now-stale clause "the other three actions remain consumer-less
  until F8/F10". TEST-503 (`:69-75`) requires that file to keep NOT containing "no renderer UI
  consumes these yet", to keep matching `/0012|quick-capture/i` and `/first .*consumer/i`, and to
  keep containing `submitWork` (case-insensitive); its repo sweep (`:92-107`) additionally bans any
  `no renderer UI consumes|no renderer consumer` phrasing across `src/**`, `docs/**`, `CLAUDE.md`,
  and `.orky/baseline/**` except the ONE allowlisted registry-mutation line in
  `.orky/baseline/architecture.md`, which MUST stay byte-unchanged (`:87-90`). F8's edit is
  therefore ADDITIVE: leave 0012's first-consumer sentence intact (it stays the pinned
  `first .*consumer` + `submitWork` + `0012` match) and replace ONLY the trailing stale
  "consumer-less until F8/F10" clause with F8's own consumer note naming
  `resolveEscalation`/`recordHumanGate`/`driveStatus` (and F10 as the next reuse). The `docs/**`/
  `CLAUDE.md`/`.orky/baseline/**` sweep for other phrasings of the no-consumer claim MUST NOT
  introduce or reword anything matching the TEST-503 sweep regex and MUST NOT touch the allowlisted
  baseline line.
**Acceptance:** after F8, `decision-queue.ts` and `registry-slice.ts` still pass every TEST-353 ban
unchanged; the TEST-353 `DecisionQueuePanel.tsx` clause is amended (in the same change) to permit the
`OrkyEntryActions` composition while still banning raw CLI/mutation calls, with a header naming F8;
TEST-282 passes byte-unchanged; the `/launchDir|commitPane/` pin at
`decision-queue-panel-structure.test.ts:114-115` passes byte-unchanged; **the whole TEST-502/TEST-503
suite (`tests/docs-feature-0012.test.ts`) passes byte-unchanged after the ipc-contract edit** (the
first-consumer sentence still matches `/first .*consumer/i`, still names 0012/quick-capture and
submitWork, no swept file matches `no renderer UI consumes|no renderer consumer` outside the
allowlisted baseline line, and that line is byte-identical); a repo-wide grep for `dq-action` shows
no `orky-action`/`orkyaction` substring; the ipc-contract consumer comment names F8 as the consumer
of the three remaining actions.

### REQ-014 — Resume-in-terminal: one gesture launches ONE visible terminal at the project root running `claude` with the Orky resume as its initial prompt, via the shipped run-on-spawn path — `security` `ux`
*(Added 2026-07-02 with the amended REQ-005 — the actionable half of resume. Amended per
FINDING-005 (coordinator decision): the pinned behavior claims exactly what is verified — the argv
and cwd — and states the slash-command expansion honestly as an external contract with a visible,
user-completable fallback, never a guaranteed auto-run.)*
Activating `dq-action-resume` MUST commit exactly ONE terminal pane through the EXISTING
`commitPane` spawn path (`store/types.ts:215` — the same primitive `launchDir`
`quick-slice.ts:84-90` and `launchConnection` `quick-slice.ts:69-82` use), with:
- `kind: 'terminal'`, `shellId: defaultShellId(...)` (`pane-ops.ts:17`),
- `cwd` = the entry's `projectRoot`, byte-verbatim,
- `launch` = `{ command: 'claude', args: ['/orky:resume'], title: <a title naming the Orky resume
  and the feature, e.g. "Orky resume — <featureSlug>"> }`,
- NO `envId` and no other capability-bearing field.
**Pinned realized behavior (honest, two-level):** Termhalla's contract ends at spawning that argv
at that cwd in a visible, user-owned pane — an interactive `claude` session IN the correct project.
`/orky:resume` is Orky's sanctioned human resume, documented as an IN-SESSION Claude Code slash
command (Orky docs `setup.md:102,118`, `watchdog.md:47-48`, `design.md:649`); passing it as the
initial prompt argument relies on the installed Claude Code's slash-command-as-initial-arg
behavior — an EXTERNAL contract neither repo's source can verify (the repo's only shipped `claude`
invocation, `TerminalPane.tsx:88`, types the real CLI flag `claude --resume` into a live shell — a
different capability F8 does not touch). Where the installed CLI auto-executes it, the resume runs;
where it does not, the user HAS a Claude session already at the right project root with the command
text visible, and completes the resume themselves — the outcome is visible in the user-owned pane
either way, never a silent headless failure. The control's label/tooltip MUST say it opens a
terminal/Claude session and MUST NOT claim the pipeline advanced or that the resume auto-ran.
When the window has no active workspace, one MUST be created first (mirroring the F6 pane-less
fallback, `DecisionQueuePanel.tsx:90-93`). The launch mechanism is the shipped run-on-spawn path
and ONLY it: `TerminalConfig.launch` (`types.ts:256`) → `api.ptySpawn` (`TerminalPane.tsx:63-66`) →
`register-pty.ts:74` → `pty-manager.ts:19-30` (cwd honored at `:21`; launch resolved at `:22` by
`resolveSpawnSpec`, `spawn-spec.ts:20-30`, run verbatim instead of a shell). F8 MUST NOT add any
new IPC/preload/main-process code for this, MUST NOT dispatch any F7 action from this gesture, and
MUST NOT add bespoke launch-failure handling — a missing `claude` binary is surfaced in-pane by the
shipped path (`pty-manager.ts:31-34`).
Each gesture commits exactly one pane; no dedupe against existing panes is performed (parity with
`launchDir`; the F6 focus-first behavior for existing matching panes is untouched and separate).
**Acceptance:** with a mocked store, one `dq-action-resume` activation commits exactly ONE pane
whose config has `kind:'terminal'`, `cwd` strictly equal to the row's `projectRoot`,
`launch.command === 'claude'`, `launch.args` deep-equal `['/orky:resume']`, `launch.title` matching
/orky resume/i, and no `envId` key; the gesture issues ZERO `api.orky*` calls (spy count 0); two
sequential gestures commit two panes but one gesture never commits two; with `activeId === null`, a
workspace is created and then the pane committed; the control's accessible name/tooltip matches
/terminal|claude|session/i and matches NONE of /resumed|advanced|dispatched|auto-?run/i (no copy
claims an executed or guaranteed resume); a source scan confirms no new
`CH.*`/preload/`src/main/**` addition and no `child_process`/`execFile` in the module.

### REQ-015 — Pointer isolation: activating an action control never fires the row's own click gesture (the click twin of CONV-030; proposed CONV-041) — `ux` `quality`
*(Added per FINDING-001: the F6 hasPane row carries an UNGUARDED `onClick={() => focusProject(...)}`
(`DecisionQueuePanel.tsx:164`) — only its `onKeyDown` target-guards (`:165-168`). Without pointer
isolation, every click on a `dq-action-*` control or the inline inputs bubbles to the row and fires
`focusProject` → `focusMruPaneMatch` → `setActive`+`setFocusedPane` (`DecisionQueuePanel.tsx:82-85`,
`pane-reveal.ts:43-49`), moving keyboard focus into an xterm pane (possibly switching the active
workspace) and stealing focus from the just-opened answer input — on exactly the rows that have a
matching pane.)*
A click (or any pointer activation) on ANY element inside the actions region — the
`dq-action-answer`/`dq-action-preview`/`dq-action-resume` controls, the inline inputs
(`dq-action-answer-input`, `dq-action-evidence`), the verdict/submit buttons, and the
result/error chrome — MUST NOT trigger the host row's own click gesture: zero
`focusProject`/`setActive`/`setFocusedPane` dispatches, no workspace switch, no focus move out of
the actions region. Realization is either `stopPropagation` at the actions-region boundary (inside
`OrkyEntryActions`, so every host gets the guard for free) or a target-guard on the row's `onClick`
that ignores events originating inside the actions slot — symmetric with the row's existing
`onKeyDown` target-guard. The row's OWN activation surface MUST keep working: a click on the row
body (outside the actions region) still focuses the matching pane (F6 REQ-009 behavior, pinned by
frozen e2e TEST-366 — the guard must never make the row inert).
**Acceptance (behavioral, not only a spy):** in a rendered hasPane row, clicking
`dq-action-answer` and then clicking + typing into `dq-action-answer-input` issues ZERO
`setActive`/`setFocusedPane` dispatches (spies at the store seam remain 0) AND focus remains inside
the actions region (the input keeps focus and receives the typed text — asserted on the real
rendered tree, e2e or equivalent, not a unit spy alone); clicking `dq-action-resume` commits its
pane (REQ-014) without ALSO focusing the row's matched pane; clicking the row BODY still triggers
exactly one focus-project dispatch (the guard does not swallow the row's own gesture; frozen
TEST-366 `tests/e2e/decision-queue.spec.ts:99-115` stays green); a structural pin finds either the
actions-region `stopPropagation` boundary or a target-guarded row `onClick`.

## Verified contract (pinned upstream shapes — read from source, not memory)

Confirmed against shipped source (2026-07-02, re-verified at the findings repair). If a datum is
not listed here, F8 does not rely on it.

- **Write bridges F8 consumes (all already exist — F8 adds no preload/IPC/main code):**
  `api.orkyResolveEscalation` (`preload/index.ts:84` → `CH.orkyActionResolveEscalation` →
  `register-orky-action.ts:34-37` → `dispatcher.resolveEscalation`),
  `api.orkyRecordHumanGate` (`preload/index.ts:86` → `register-orky-action.ts:42-45`),
  `api.orkyDriveStatus` (`preload/index.ts:87` → `register-orky-action.ts:46-49`). Each handler
  gates on `isKnownWindowSender` BEFORE the dispatcher; an unknown sender gets the literal
  `{ok:false, dispatched:false, errorKind:'unknown-sender'}` (`register-orky-action.ts:10-16`).
- **Read bridge for the escalation-id source:** `api.registryDetail(root)`
  (`preload/index.ts:82` / store `registryDetail` `store.ts:168`) → `OrkyRootDetailResult`
  (`types.ts:156-163`); `OrkyFeatureDetail` (`types.ts:144-154`) carries the unique dir `slug`,
  `status`, and `escalations: OrkyEscalationDetail[]` (state.json order verbatim); each
  `OrkyEscalationDetail` (`types.ts:133-142`) has `id: string | null`, `status`, `reason`, etc.,
  built by `mapEscalation` (`orky-root-detail.ts:141-153`, `id = nonEmptyStrOrNull`).
- **The escalation id is NOT on the aggregate:** `DecisionQueueItem = {projectRoot, featureSlug,
  status: OrkyFeatureStatus}` (`decision-queue.ts:16-20`); `OrkyFeatureStatus`
  (`orky-status.ts:268-280`) has `{feature, kind, phase, gateN, gateM, openBlocking, needsHuman,
  failed, reason, lastActivityAt, detail}` — no escalation id. The id appears only as free text in
  `detail` (`orky-status.ts:250-252`). The aggregate's escalation selection is the FIRST
  `status === 'open'` escalation (`orky-status.ts:219`) — the DISPLAY-time selection REQ-003/
  decision #5 mirror (dispatch is identity-bound, not positional).
- **The unguarded row click REQ-015 isolates against:** the hasPane row's
  `onClick={() => focusProject(it.projectRoot)}` (`DecisionQueuePanel.tsx:164`) has NO
  target-guard — only its `onKeyDown` guards (`:165-168`); `focusProject` (`:82-85`) routes through
  `focusMruPaneMatch` (`pane-reveal.ts:43-49`), which dispatches `setActive` + `setFocusedPane`.
- **resolveEscalation contract:** `resolveEscalation(req)` validates
  `{projectRoot, feature, escalationId, decision}` all required non-empty, `projectRoot`/`feature`/
  `escalationId`/`decision` each `rejectFlagLike`-guarded (`orky-action-validate.ts:90-118`); tries
  `feedback emit --type decision --payload {escalationId, decision}` first — feedback enabled →
  `{ok:true, path:'feedback', feedback:'enabled', dispatched:true}`; if disabled (`mode:'noop'`)
  falls back to `gatekeeper resolve-escalation --id <escalationId> --decision <decision>` →
  `{ok:true, path:'gatekeeper', feedback:'disabled', dispatched:true}`
  (`orky-action-dispatcher.ts:144-184`). Failures map to the standard kinds.
- **recordHumanGate contract:** validates `{projectRoot, feature, gate, verdict:'pass'|'fail',
  evidence?}` (`orky-action-validate.ts:154-192`); `gate` restricted server-side to
  `{brainstorm, human-review}` → `gate-not-allowed` otherwise (`orky-action-dispatcher.ts:262-294`);
  success → `{ok:true, path:'gatekeeper', dispatched:true}`.
- **driveStatus contract (the preview):** READ-ONLY; invokes `gatekeeper drive --feature <featureDir>`,
  bypasses the serialization queue, and returns `{ok:true, path:'gatekeeper', dispatched:false,
  data:<drive next-action obj>}` ALWAYS — never mutates `.orky/` (0007 REQ-009;
  `orky-action-dispatcher.ts:296-319`).
- **`cli-unparseable` semantics (REQ-009's indeterminate reclassification):** `mapCliRunToResult`
  returns `errorKind:'cli-unparseable'` for ANY completed child whose stdout is not the expected
  JSON object (`orky-action-result.ts:38-56`) — the branch is reached only PAST the timeout branch
  (`:30-36`), including at exit 0, so the child ran to completion and a durable write may have
  landed; only its report is unreadable. (The `orky-cli-runner.ts:24` comment calling it "definite"
  describes transport-level certainty that the CHILD finished — not certainty about the write.)
- **Terminal-launch capability (REQ-014 — the shipped run-on-spawn path, verified end-to-end):**
  `TerminalLaunch = {command, args, title}` (`types.ts:172-176`); `TerminalConfig.launch?:
  TerminalLaunch` — "when set, run this instead of a discovered shell" (`types.ts:250-263`, `:256`).
  Renderer: `commitPane(wsId, cfg, target, dir)` (`store/types.ts:215`) commits the pane;
  `TerminalPane` passes `cwd` AND `launch` to `api.ptySpawn` (`TerminalPane.tsx:63-66`). Main:
  `register-pty.ts:74` forwards both to `PtyManager.spawn` (`pty-manager.ts:19-30`), which honors
  `cwd` (`:21`, home-dir fallback only when empty) and resolves `launch` via `resolveSpawnSpec`
  (`:22`; `spawn-spec.ts:20-30` — PATH+PATHEXT resolution, run VERBATIM with no shell-integration
  injection); a bad launch command is surfaced in-pane, never a crash (`pty-manager.ts:31-34`), and
  process end prints `[process exited]` (`TerminalPane.tsx:93`). Shipped store actions each cover
  only HALF: `launchDir(dir)` sets cwd with no launch (`quick-slice.ts:84-90`); `launchCommand(launch)`
  sets launch with `cwd:''` (`store.ts:542-547`); `launchConnection` is the launch-bearing precedent
  (`quick-slice.ts:69-82`, ssh at `:76-79`) — hence REQ-014 composes `commitPane` with both, which
  the pane model and PTY path fully support. Helpers: `defaultShellId` (`pane-ops.ts:17`),
  `firstTarget` (`pane-ops.ts:23`). Workspace-less fallback precedent: `openTerminalAt`
  (`DecisionQueuePanel.tsx:90-93`, F6 REQ-010).
- **The Orky resume command (external contract, stated honestly — FINDING-005):** `/orky:resume` is
  Orky's sanctioned human resume, documented as an IN-SESSION Claude Code slash command — "All
  commands are typed in a Claude Code session" (Orky `docs/setup.md:102`; the command itself at
  `setup.md:118`); the watchdog runs it INSIDE its own scheduled Claude session
  (`docs/watchdog.md:47-48`; session-survival design, `docs/design.md:649`). **Neither repo's
  source demonstrates `claude` executing a slash command passed as argv** — whether the initial
  prompt arg auto-expands is the installed Claude Code CLI's own contract, external to both repos.
  Termhalla's only shipped `claude` invocation is `api.ptyWrite({..., data: 'claude --resume\r'})`
  (`TerminalPane.tsx:88`) — a REAL CLI flag typed into an already-running shell (Claude session
  restore, gated on `resumeAi`/`quick.autoResumeClaude`), a DIFFERENT capability F8 does NOT touch
  or repurpose, and not an argv-expansion precedent. REQ-014 therefore pins the argv + cwd + the
  two-level honest outcome (auto-run where supported; otherwise a visible interactive session at
  the correct project the user completes) and forbids copy claiming a guaranteed auto-run.
- **Result + errorKind shapes:** `OrkyActionResult` (`types.ts:496-506`, `dispatched` doc:
  "false for driveStatus reads and for a feedback-disabled submitWork"), `OrkyActionErrorKind`
  (`types.ts:478-491`, `cli-unparseable` at `:491`). `'ipc-failure'` is NOT in that union — it is
  renderer-synthesized (F12 precedent, `OrkyCaptureModal.tsx:97`), so F8's failure kind field is a
  widened string.
- **Honesty precedent to match (not a reusable module — F8 must extract its own shared classifier):**
  `OrkyCaptureModal.tsx:126-130` (`indeterminate = kind==='cli-timeout' || kind==='ipc-failure'` —
  F8 EXTENDS this set with `cli-unparseable` for mutating answers per REQ-009/FINDING-006; F12's
  narrower inline set is its own shipped scope, not amended by F8),
  `:236-273` (feedback-disabled distinct / indeterminate / definite in-modal branches), `:115-131`
  (detached-outcome toast with honesty-class-preserving wording). Toast chokepoint: `pushToast`
  with `error` kind never suppressed (`toasts-slice.ts:20`).
- **Focus substrate to reuse:** `useOpenFocusRestore` (`use-open-focus-restore.ts`) for the inline
  answer input, as F12 does (`OrkyCaptureModal.tsx:191`); the queue drawer's own focus management is
  F6's (`DecisionQueuePanel.tsx:36-37`) and is untouched.
- **F6 row identity F8 attaches to:** `decision-queue-item` with `data-project-root={it.projectRoot}`
  + `data-feature={it.featureSlug}` (`DecisionQueuePanel.tsx:161-162,177-178`); `it.status.reason`
  drives the answer mode. TEST-346 pins `decision-queue-item`/`data-project-root`/`data-feature`;
  TEST-347 bans re-derivation symbols in the panel + pure module (F8's new module is neither).
- **F10 reuse target:** `OrkyPane.tsx` is "Strictly READ-only (REQ-013): no action" today
  (`OrkyPane.tsx:13`); it renders detail feature rows off `registry:detail` (with the escalation ids
  already in hand) — the exact seam F8's `OrkyEntryActions` is factored to be mounted into.
- **F11 relationship:** `0011-orky-workspace-template` (`roadmap.json:69-75`) is a saved per-project
  workspace preset (OrkyPane + project-root terminal). Complementary to REQ-014 (see Resolved
  decision #7): F8 = ad-hoc entry-scoped continuation gesture; F11 = the persisted template that
  later wraps it.

## Frozen-guard inventory (grep-documented — CONV-019/023)

Grep scope: `tests/**` repo-wide. Patterns: `orkyAction|orkyaction` (TEST-282 e2e locators +
TEST-353 bans), `decision-queue-item|data-feature|decision-queue-panel` (F6 structural pins),
`orkyResolveEscalation|orkyRecordHumanGate|orkyDriveStatus|resolveEscalation|driveStatus`
(F7 consumer surface), `registryDetail|registry:detail` (F9 detail consumers),
`launchDir|launchCommand|launchConnection|resolveSpawnSpec|TerminalLaunch` (REQ-014 launch path),
**and — widened per FINDING-002 —** `first .*consumer|no renderer UI consumes|no renderer consumer|consumer`
over `tests/docs-feature-*.test.ts` (frozen DOC-claim pins, which key on prose literals the other
patterns can never surface).

- **Superseded by F8 (amend atomically at tests phase, intent-preserving):** TEST-353's
  `DecisionQueuePanel.tsx` read-only clause (`decision-queue-panel-structure.test.ts:138-157`) — see
  REQ-013. Its `decision-queue.ts` and `registry-slice.ts` bans STAY green byte-unchanged.
- **Verified TOLERANT of F8's panel additions (FINDING-001 check, per-pin):** TEST-344..352 pin
  testids/aria/theme/selector call-sites the actions region does not touch; none matches the row's
  `onClick` literal, so BOTH REQ-015 realizations (an actions-region `stopPropagation` boundary in
  `orky-entry-actions.tsx`, or a target-guarded row `onClick` in `DecisionQueuePanel.tsx`) leave
  them green byte-unchanged. Two constraints bind the addition: TEST-350's raw-hex scan covers any
  styling F8 adds INSIDE the panel source (REQ-012), and **frozen e2e TEST-366**
  (`tests/e2e/decision-queue.spec.ts:99-115`) drives `item.click()` — Playwright clicks the
  element's CENTER point — so the tests phase MUST confirm the actions region does not capture the
  row's center-point click (REQ-015 keeps the row-body click focusing the pane); if F8's layout
  shifts the row center into the guarded actions slot, TEST-366 needs a CONV-019 amendment (click
  the body element explicitly) in the same change — never a silent breakage.
- **Must stay green byte-unchanged (verified NOT collisions):** TEST-282
  (`orky-action-dispatch.spec.ts:48-56`, `orky-action`/`orkyaction` testid absence — F8's `dq-action-*`
  namespace and `orky-entry-actions` module name match neither substring; and the drawer is closed at
  fresh launch); TEST-344..352 (`decision-queue-panel-structure.test.ts` — panel testid, state
  testids, `decision-queue-item`/`data-project-root`/`data-feature` identity (TEST-346), carried-field
  rendering + re-derivation bans on the panel/pure module (TEST-347), the F6 pane-less-fallback
  positive pin `/launchDir|commitPane/` (`:114-115` — REQ-014's `commitPane` composition keeps it
  satisfied), a11y + focus-visible + theme + fallback + fold-mode pins — all additive-safe per the
  tolerance check above); TEST-366 (`decision-queue.spec.ts:99-115`, row click-to-focus — see the
  tolerance note); TEST-281 (`orky-action-dispatch.spec.ts:25-46` — preload round-trip; F8 adds no
  preload/registrar code); **TEST-502/TEST-503 (`tests/docs-feature-0012.test.ts` — the frozen
  0012 doc-drift guard: `:69-75` pins the ipc-contract consumer comment's first-consumer/0012/
  submitWork content, `:87-90` pins the allowlisted baseline line byte-unchanged, `:92-107`
  repo-sweeps the no-consumer claim class; F8's additive comment edit per REQ-013 keeps every
  assertion green byte-unchanged)**; the whole F7 dispatcher/validate/result/audit/queue suites (F8
  changes no `src/main/**` or `src/shared/orky-action-*` file); the F9 `registry:detail` suites (F8
  only READS that channel); the spawn-spec suite (`tests/main/spawn-spec.test.ts` — F8 changes no
  `src/main/pty/**` file; REQ-014 only rides the existing behavior it pins).
- **CONV-008 stale-claim — pinned by frozen TEST-503 (correction of the draft's "no frozen test
  pins it"):** `ipc-contract.ts:183-185` consumer comment — additive update per REQ-013 (keep 0012's
  first-consumer sentence; replace only the stale "consumer-less until F8/F10" clause), plus the
  `docs/**`/`CLAUDE.md`/`.orky/baseline/**` sweep scoped to never match the TEST-503 sweep regex and
  never touch the allowlisted baseline line.

## Upstream inconsistencies flagged (not F8's to fix, but F8 must not mask them)

- **The escalation id is unreachable from the F6 aggregate / queue row** — it lives only on the F9
  `registry:detail` channel (and as free text in `status.detail`). F8 works around this with a
  `registryDetail` pull (REQ-003), but this is a real aggregate gap: any consumer wanting to act on an
  escalation from the queue must make a second async round-trip — and, because the open set can
  change between display and dispatch, a submit-time verification pull as well (FINDING-003). A
  future improvement would be to carry a structured `escalationId` (or the open-escalation ids) on
  `OrkyFeatureStatus`/the aggregate so the queue row is self-sufficient. Recorded as a
  future-improvement note, not a blocker.
- **`featureSlug` (aggregate) = `state.json.feature` free text, not guaranteed the dir name**
  (`decision-queue.ts:90` vs the F9 detail's separate unique `slug`, `orky-root-detail.ts:251`). In
  practice Orky writes `feature` = dir slug (verified in this repo's own `state.json`:
  `"feature": "0008-queue-answer-resume-actions"`), and F7 validates the dir server-side
  (`feature-not-found` otherwise), so F8 uses `featureSlug` as the identity and treats a mismatch as
  an honest F7 failure. Recorded as a future-improvement note, not a blocker.
- **The F6 hasPane row's unguarded `onClick` (`DecisionQueuePanel.tsx:164`)** is a latent F6 gap the
  moment ANY nested interactive child exists — F6 shipped none, so it was harmless there. F8 is the
  first feature to nest controls in the row and isolates them (REQ-015, proposed CONV-041); the
  underlying asymmetry (guarded `onKeyDown`, unguarded `onClick`) is recorded for the convention
  sweep rather than silently papered over.
- ~~F7 has no write-capable "resume."~~ **No longer an inconsistency — it is the intended design.**
  See Resolved questions Q1: F7 deliberately never drives a pipeline headlessly; "resume" is
  realized honestly as preview + resume-in-terminal (REQ-005/REQ-014).

## Resolved questions

- **Q1 (resume semantics) — RESOLVED by coordinator decision (delegated human authority,
  2026-07-02). FIXED — unchanged by the findings repair.** The draft asked whether the read-only
  `driveStatus` preview could honestly be "resume," or whether a new write-capable F7 drive action
  was expected. **Resolution: neither a silent downgrade nor a new headless write-drive.**
  Rationale (TOS posture): Termhalla must never silently drive an Orky pipeline — every action
  traces to an explicit user gesture, and autonomous continuation stays in Orky's own sanctioned
  watchdog. "Resume" is therefore two honest parts:
  (1) the **next-action preview** — `driveStatus`'s computed next action shown inline, read-only,
  honestly labeled, never claiming the pipeline advanced (REQ-005); (2) **resume-in-terminal** —
  the actionable continuation: a gesture that launches a real, visible terminal at the entry's
  project root running the `claude` binary with `/orky:resume` as its initial prompt, via the
  shipped run-on-spawn launch path — a user-initiated Claude session, never a headless drive; no
  new F7 action, no new main write code (REQ-014). The run-on-spawn MECHANISM was verified to
  EXIST in shipped source (pins in Verified contract); per FINDING-005 the slash-command
  auto-expansion is an external Claude Code contract stated honestly in REQ-014 — where it holds
  the resume auto-runs, and where it does not the user completes it in the session Termhalla
  opened at the correct project (visible either way, never silent).

## Open questions

- None blocking.
