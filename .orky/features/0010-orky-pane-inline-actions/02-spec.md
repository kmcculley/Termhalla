# 0010 — Inline actions in OrkyPane (write)

## Phase 2 — Specification

**Status:** REVISED at the spec gate (loopback) against FINDING-001..005 — REQ-002/REQ-005/REQ-009
restated to the reachable, harness-honest model; every changed pin re-verified against shipped
source 2026-07-02. Drafted from `00-intake.md` + the gate-passed `01-concept.md` (five FIXED
decisions D1–D5, unchanged). REQ-IDs are stable; never renumber.

This feature is PRIMARILY REUSE/COMPOSITION. F8 built the shared action layer
(`useOrkyEntryActions` / `OrkyEntryActions` / the pure core / the store's narrow
`launchTerminalAt`) explicitly to be mounted here; F9 reserved the `orky-pane-row-actions` slot and
already fetches the per-feature detail (escalations WITH ids) this feature binds from; F12 built
`openOrkyCapture(root)` — the pre-selected-root entry point — for exactly this caller, and shipped
it caller-less. F10 adds **zero** new IPC channels, **zero** new preload methods, **zero** new
main-process code, **zero** new dispatch/honesty logic, and **zero** direct `.orky/` writes: the
diff is the pane-side mount + target construction, one inject affordance, and the CONV-046
mode-flip fix landing in the shared component (its second real mount context — D5).

Three upstream realities were verified against shipped source (see **Verified contract**):

1. **The pane's already-held detail DOES carry the escalation id.** `OrkyPane` renders
   `f.escalations` with `esc.id` (`data-escalation-id`, `OrkyPane.tsx:201-212`) off the
   `orkyPaneDetail[paneId]` entry it already fetches — so for rows whose first open escalation
   carries a usable id, the F10 answer path binds it with ZERO display-time pulls (the F8 queue
   path needed a sourcing pull; the supplied-id path does not). Rows WITHOUT a usable id omit the
   id and follow the shared one-pull honest-refusal bind path (`orky-entry-actions-core.ts:140-162`)
   — one pull is that branch's correct, established cost. The submit-time RE-VERIFICATION pull
   (one fresh `registryDetail` per submit) is retained by design — it is F8 REQ-003's race guard,
   not a redundant round-trip, and MUST NOT be "optimized" away.
2. **`openOrkyCapture(projectRoot)` is reachable exactly as D2 assumes.** The slice holds the root
   byte-verbatim (`orky-capture-slice.ts:27-30`), App hosts the modal app-level
   (`App.tsx:209` — `<OrkyCaptureModal initialRoot={orkyCaptureRequest.root} />`), and a non-null
   `initialRoot` renders the form DIRECTLY (`OrkyCaptureModal.tsx:34-35`, `picking = initialRoot
   === null`) — no picker step. Today's only shipped callers are argument-less
   (`App.tsx:158`, `CommandPalette.tsx:74`); F10 is the designed first rooted caller.
3. **The F8 single-flight gate is genuinely cross-instance — and the gesture layer REFUSES, it
   does not fan out.** The in-flight registry is MODULE scope in the pure core
   (`orky-entry-actions-core.ts:83`), keyed on `(projectRoot, featureSlug, action)` with a NUL
   separator (`:74-78`); every mounted hook instance in the window derives `busy` from that shared
   registry (`orky-entry-actions.tsx:79`) and re-renders pending via `subscribeFlights`
   (`:64-65,75-79`, `showPending = busy || phase.status === 'pending'` `:303`) — so a pane mount
   and a queue mount of the SAME target dedupe to one dispatch and BOTH render pending. But every
   dispatch affordance is gated on that same shared `busy` (preview `disabled={busy}` `:353-355`;
   escalation submit's `refuse` includes `busy` for both the click and the Enter path
   `:374,:239-241,:244-245`; verdict buttons `disabled={props.busy}` `:274-279`), and frozen e2e
   TEST-608 PINS disabled-while-pending (`orky-queue-actions.spec.ts:211-213`) — so a second
   mount's gesture CANNOT fire mid-flight, and the rendered two-mount post-settle-via-second-
   continuation vector stays unreachable BY DESIGN. The continuation fan-out is real and pinned
   where it lives: the CORE seam (frozen TEST-615, `orky-entry-actions-loopback.test.ts:78` — any
   caller whose gesture does reach `withSingleFlight` gets the settled outcome through its own
   `.then()`, and the hook is structurally banned from a busy pre-check that bails before the
   continuation attaches; the loopback header `:6-16` itself records the rendered two-mount vector
   as unreachable in its harness). REQ-005 pins the honest rendered model: one dispatch, shared
   pending on both mounts, the initiating mount renders the settle, the non-initiating mount's
   affordances refuse during the flight and return to idle after it.

## Concerns

`security` `ux` `quality` `networking`

- `security` — write actions in the pane: every dispatch/capture-open/pane-commit is gesture-tied
  (REQ-004); the escalation id is sourced from the pane's structured detail (never free text,
  never guessed) and re-verified at submit (REQ-002); no new IPC/preload/main/CLI/`.orky`-write
  path; `orky-entry-actions.tsx` stays the ONLY renderer owner of the three F7 action bridges
  (REQ-004).
- `ux` — the same actions inside a mosaic TILE, not a 340px drawer: layout wraps and stays
  operable (REQ-007); the inject affordance is discoverable, honestly labeled, and only offered on
  a bound pane (REQ-003); CONV-041/042/043/044 hold in the pane mount and CONV-046 (the mode-flip
  focus theft) is fixed for BOTH mounts (REQ-006/REQ-007); consistency with the queue comes free —
  it is the same component.
- `quality` — reuse, don't fork (REQ-001/REQ-003): no duplicated dispatch, honesty, or capture
  logic; the frozen-guard supersessions are inventoried, grep-documented, and scheduled per
  CONV-019/CONV-012 (REQ-009). `data-provenance` is n/a — no factual data is bundled.
- `networking` — F7's honesty classes surface in the pane verbatim through the shared classifier
  (nothing re-derived — REQ-001); the cross-instance single-flight plus the shared busy refusal
  prevent a duplicating double-dispatch across pane+queue mounts of one target (REQ-005).

## Resolved spec-time decisions (with rationale)

1. **Every feature row mounts the region (D1, uniform composition).** The pane renders ALL
   features (unlike the queue, which holds only needs-you rows). `OrkyEntryActions` is mounted for
   EVERY feature row, and the shared component's own mode routing decides what shows:
   `answerModeFor(reason)` yields no answer control for `reason null/'stalled'`
   (`orky-entry-actions-core.ts:64-68`), while the read-only preview and resume-in-terminal are
   meaningful on any feature. No pane-side re-derivation of "actionable" is introduced.
2. **Target construction mirrors the aggregate byte-for-byte.** The mounted target is
   `{ projectRoot: root, featureSlug: f.slug, reason: f.status.reason, escalationId? }` — the
   pane's own row identity (`OrkyPane.tsx:141-146`: render key, `data-project-root`,
   `data-feature` all key on the unique dir `f.slug`, F9 REQ-012). `escalationId` is supplied iff
   the row's FIRST escalation with `status === 'open'` (payload array order — the same selection
   `orky-status.ts:219` used to mark the row `reason:'escalation'`, and the same rule the shared
   bind path applies, `orky-entry-actions-core.ts:155-162`) carries a non-empty string `id`;
   otherwise `escalationId` is OMITTED and the shared bind path produces its honest refusal (one
   pull, the established F8 behavior — never a fabricated id).
3. **Inject is PANE-scoped, not row-scoped.** Capture targets a PROJECT (F12's request shape is
   `{root}`), so the inject affordance lives once in the pane header (testid `orky-pane-inject`,
   the `orky-pane-*` namespace — no `orky-action`/`orkyaction` substring, frozen TEST-282 safe),
   not per feature row. It calls `openOrkyCapture(root)` with the pane's bound root byte-verbatim.
4. **The CONV-046 fix lands in the SHARED component and closes F8's FINDING-022.** Mechanism
   verified: `answerOpen` survives a data-driven `target.reason` flip, so the mode-keyed form swap
   (`orky-entry-actions.tsx:370-384`) remounts a `useOpenFocusRestore` form
   (`use-open-focus-restore.ts:20-33` focuses on mount) and steals focus with no gesture. The fix
   is the FINDING-022-prescribed mode-keyed disarm: a reason flip while the form is open CLOSES the
   form (and clears the typed decision/evidence), mirroring the FINDING-020 disarm-on-success
   effect — focus then only ever moves on the explicit toggle gesture. Both mounts (queue + pane)
   get the fix; F8's open FINDING-022 is recorded fixed-by-F10.
5. **Accepted display asymmetry:** a supplied `escalationId` binds AS-IS with
   `escalationReason: null` (`orky-entry-actions-core.ts:137-139`, behaviorally frozen by
   TEST-588), so the pane's `dq-action-answer-target` shows the id without the reason text the F8
   queue path shows. Accepted: the pane row itself already renders the escalation's reason
   directly below (`OrkyPane.tsx:201-212`); changing the frozen core signature for cosmetic parity
   is not worth it.
6. **No compliance framework** exists (`.orky/compliance/` absent — no controls to encode).
   `.orky/baseline/` DOES exist (committed 2026-06-29), but its read-only phrasings
   (`architecture.md:31,87,91,119,135`) describe MAIN-PROCESS/IPC read surfaces F10 does not
   falsify (F10's write is renderer-side via F7/F12), so it is in the CONV-008 sweep scope below
   but yields no mandatory correction (FINDING-006).

## Public interface

F10 exposes no new module-level API. Its composed surface is:

```tsx
// OrkyPane.tsx — inside each feature row's reserved slot (F9 REQ-012):
<span data-testid="orky-pane-row-actions">
  <OrkyEntryActions target={{
    projectRoot: root,            // the pane's bound root, byte-verbatim
    featureSlug: f.slug,          // the UNIQUE dir slug (the pane's row identity)
    reason: f.status.reason,      // the payload's carried OrkyReason
    // supplied iff the first status==='open' escalation carries a non-empty id:
    ...(openEscalationId ? { escalationId: openEscalationId } : {})
  }} />
</span>

// OrkyPane.tsx — pane header, bound-member panes only:
<button data-testid="orky-pane-inject" ...>  // onClick → useStore.getState().openOrkyCapture(root)
```

All consumed shapes are unchanged: `OrkyEntryTarget` (`orky-entry-actions-core.ts:29-34`),
`OrkyFeatureDetail`/`OrkyEscalationDetail` (F9's detail payload), the capture slice's
`openOrkyCapture(root?: string)` (`store/types.ts:117`).

---

## Requirements

### REQ-001 — Mount F8's shared action layer in F9's reserved slot, keyed on the pane's own row identity; do NOT fork (D1) — `quality` `security` `networking`
`OrkyPane` MUST render `OrkyEntryActions` (imported from `./orky-entry-actions`) inside the
reserved `orky-pane-row-actions` slot of EVERY feature row, with the target constructed exactly
per resolved decision #2 (`projectRoot` = the pane's bound `root` byte-verbatim, `featureSlug` =
the payload's unique dir `f.slug`, `reason` = the carried `f.status.reason`). F10 MUST NOT fork,
wrap-with-dispatch, or re-implement any answer/preview/resume/honesty logic: `OrkyPane.tsx` (and
every other F9/F10 file) MUST contain no `api.orky*` action-bridge call of its own —
`orky-entry-actions.tsx` remains the single renderer owner of
`orkyResolveEscalation`/`orkyRecordHumanGate`/`orkyDriveStatus` (frozen TEST-607's
one-owner sweep MUST still pass). The shared component's own mode routing decides per-row
affordances: a row whose `reason` is `null` or `'stalled'` offers no answer control but keeps the
read-only preview and resume-in-terminal.
**Acceptance:** a source scan of `OrkyPane.tsx` finds the `OrkyEntryActions` import from
`'./orky-entry-actions'` and a mount site inside the element carrying
`data-testid="orky-pane-row-actions"`, with `f.slug` and `.status.reason` in the target expression
and no `api.orky` reference anywhere in the file; frozen TEST-607
(`orky-entry-actions-structure.test.ts:136-165`) passes byte-unchanged (still exactly one renderer
owner per bridge); rendered (e2e, the 0009 two-feature fixture): the `esc-feature` row's slot
contains `dq-action-answer`, `dq-action-preview`, and `dq-action-resume`, while the `done-feature`
row's slot contains `dq-action-preview` and `dq-action-resume` but NO `dq-action-answer`;
activating the escalation row's answer→submit flow dispatches `orkyResolveEscalation` with
`projectRoot` = the pane's root and `feature` = the row's dir slug; activating
`dq-action-resume` commits exactly one terminal pane at the pane's root via `launchTerminalAt`
(the F8 REQ-014 contract, unchanged).

### REQ-002 — The escalation id binds from the pane's ALREADY-HELD detail: supplied-id rows make zero display-time pulls; the submit-time verification pull is retained (D4) — `security` `networking`
For a row whose `reason === 'escalation'`, the mounted target's `escalationId` MUST be the `id` of
the FIRST escalation with `status === 'open'` in the held payload's array order, supplied iff that
id is a non-empty string — sourced from the pane's existing `orkyPaneDetail[paneId]` entry (the F9
detail the pane already fetched), NEVER from a new fetch, NEVER from `status.detail` free text,
and NEVER fabricated; `OrkyPane.tsx` itself MUST make no `registryDetail` call of its own. For
rows that SUPPLY an `escalationId`, the answer path MUST make ZERO display-time `registryDetail`
pulls (the supplied id binds as-is) and EXACTLY ONE `registryDetail` pull per submit — the shared
submit-time re-verification (F8 REQ-003), which MUST NOT be bypassed, pre-checked around, or
removed: a changed world still refuses honestly and the CLI is never invoked with a stale or
substituted id. Rows whose first open escalation carries NO usable id MUST omit `escalationId` and
follow the established F8 path unmodified: one display-time bind pull ending in the shared honest
refusal, no dispatch — F10 MUST NOT add a pane-side pre-check around that branch to save its pull.
**Acceptance:** split per CONV-033 into the count half at the core seam and the rendered halves at
e2e. *Count half (already frozen — MUST pass byte-unchanged):* TEST-588
(`orky-entry-actions-core.test.ts:191` — a supplied `escalationId`, the F10-shaped target, binds
AS-IS with ZERO pulls; the structural id beats any id named in `status.detail` free text) and
TEST-591 (`:274` — the F10-style target makes exactly ONE pull, the submit-time verification only;
the omitted-id style makes two: bind + verify). *Structural half (node harness):* a source scan of
`OrkyPane.tsx` finds no `registryDetail` reference and finds the target's `escalationId` expression
sourced from the held detail entry's escalations. *Rendered halves (e2e, the pane mount):* opening
the answer form on an escalation row renders `dq-action-answer-target` whose id text EQUALS the
row's own first-open `data-escalation-id`; submitting after the fixture's state.json is rewritten
so the bound id is no longer open (the TEST-612 fixture-rewrite technique,
`orky-queue-actions.spec.ts:367`, applied to the pane mount) renders the /changed|re-?open/i
refusal with an EMPTY CLI stub log (zero dispatch); with a fixture whose first open escalation has
`id: null`, the shared bind path's honest refusal message renders and the CLI stub log stays empty;
a fixture whose `status.detail` free text names a DIFFERENT id shows `dq-action-answer-target`
carrying the structural id, not the free-text one.

### REQ-003 — Inject reuses F12's capture, opened PRE-TARGETED to the pane's project: no picker, no new capture logic (D2) — `ux` `security`
The pane header MUST gain an inject affordance (`orky-pane-inject`, a native button) rendered ONLY
while the pane is bound to a tracked member root (the unbound state offers no inject). Activating
it MUST call the store's `openOrkyCapture(root)` with the pane's bound root BYTE-VERBATIM (no
re-casing/re-slashing/normalizing — membership validation stays the dispatcher's job) and MUST do
nothing else: no picker step is shown (the capture form opens directly, pre-targeted), no draft is
seeded, no `api.*` call is made by the gesture itself, and F10 adds no capture/submit logic of its
own — `OrkyCaptureModal` remains the sole owner of the capture flow and `orkySubmitWork`. The
affordance's label/tooltip MUST say it captures/injects work FOR this project and MUST NOT claim
anything was submitted or written by the gesture. Re-invoking while capture is already open is the
slice's reference-stable no-op (shipped behavior, `orky-capture-slice.ts:28` — F10 MUST NOT add a
client-side workaround around it).
**Acceptance:** a source scan of `OrkyPane.tsx` finds `openOrkyCapture(` called inside an event
handler (never a `useEffect` body) with the pane's `root`; rendered (e2e): clicking
`orky-pane-inject` on a bound pane shows the capture FORM (title input focused per F12's own
contract) with the pane's project pre-selected and NO picker step (`orky-root-picker` absent);
typing a title and submitting dispatches `orkySubmitWork` with `projectRoot` strictly equal to the
pane's root; the unbound pane state renders no `orky-pane-inject`; the control's accessible
name/tooltip matches /capture|inject|work/i and NOT /submitted|saved|written/i; the testid
contains neither `orky-action` nor `orkyaction` (frozen TEST-282 stays green).

### REQ-004 — Scope: read-only-except-via-F7/F12; every action tied to an explicit gesture (D3) — `security`
F10 MUST add only composition and wiring. It MUST NOT add any new IPC channel, preload method,
`src/main/**` code, renderer-side CLI/`child_process`/`execFile` path, or direct `.orky/` write;
the `orkyAction:*` channel set stays exactly 0007's four. Every write-capable action reachable
from the pane MUST route through the existing surfaces only: F7's bridges via the shared
`orky-entry-actions` module, the capture via F12's `openOrkyCapture`/`OrkyCaptureModal`, and the
resume via the store's `launchTerminalAt`. Every dispatch, capture-open, and pane-commit MUST be
called ONLY from an explicit user-gesture handler — never from a `useEffect` body, mount effect,
or render (the CONV-033-class structural guard): merely mounting the pane (or expanding a row)
dispatches nothing, opens nothing, and commits no pane.
**Acceptance:** a source scan of every F10-touched renderer file finds no
`child_process`/`execFile`/`ipcRenderer`/new `CH.*` constant/preload addition/`src/main/**`
change; `OrkyPane.tsx` contains no `orkyAction`, `orkySubmitWork`, or registry-mutation literal
(frozen TEST-433's literal bans and TEST-494's F9-file sweep,
`orky-capture-structure.test.ts:266-270`, pass — see REQ-009 for the intent supersession);
`(read('src/shared/ipc-contract.ts').match(/'orkyAction:\w+'/g)).length === 4` still holds; no
`useEffect` span in `OrkyPane.tsx` references `api.orky`, `openOrkyCapture(`, `launchTerminalAt(`,
or `commitPane` (the TEST-599 technique applied to the pane); mounting the pane with the
two-feature fixture issues zero `api.orky*` calls and zero pane commits until a gesture fires.

### REQ-005 — Cross-instance protection across a PANE mount + a QUEUE mount of the same target: one dispatch, shared pending, shared refusal — and the core-seam continuation guarantee stays intact (D1) — `networking` `quality`
With the decision-queue drawer AND an OrkyPane both mounting actions for the SAME
`(projectRoot, featureSlug)` in one window, at most ONE dispatch per `(target, action)` may be in
flight. The protection has two layers, and F10 MUST preserve both without weakening either:
**(a) The core-seam guarantee (frozen).** The shared module-scope registry dedups — an existing
flight is returned AS-IS — and any caller whose gesture DOES reach `withSingleFlight` receives the
settled outcome through its own `.then()` continuation (frozen TEST-615's pin, including its
structural ban on a `busy`/`isInFlight` pre-check that bails before the continuation attaches).
F10 MUST NOT defeat this: no pane-side busy pre-check ahead of the shared gate, no separate
registry, no per-pane key salt.
**(b) The rendered model (what a user of two mounts actually experiences).** While a flight
started from one mount is in the air, BOTH mounts MUST render the shared pending state
(`dq-action-pending` — the shared `busy` derivation via `subscribeFlights`), and the
NON-INITIATING mount's dispatch affordances MUST refuse/disable on that same shared `busy` (the
existing gates frozen TEST-608 pins) — so a second gesture cannot start a second dispatch. After
settle, the INITIATING mount renders the settled outcome via its own continuation; the
non-initiating mount — whose phase never left idle because its gesture never fired — MUST return
to idle with its controls re-enabled: never a phantom result, never a stuck pending, never a
second dispatch. (The rendered "second mount's continuation renders the settle" vector is
UNREACHABLE by design — the busy gates refuse the gesture that would create the continuation —
and this spec deliberately does not claim it; the continuation guarantee is pinned where it is
real, the core seam.)
Distinct targets stay independent. Cross-WINDOW dedupe is explicitly not claimed (separate
processes — F8 REQ-007's honesty note carries over unchanged).
**Acceptance:** (e2e, the two-mount vector) with the queue drawer open and a pane bound to the
same project, and a slow-CLI stub flight started by a gesture on the QUEUE mount: (1) during the
flight, `dq-action-pending` is visible in BOTH regions; (2) during the flight, the PANE region's
`dq-action-preview` is disabled and its answer submit refuses (disabled) — the shared-busy
refusal; (3) after settle, the CLI stub argv log has length EXACTLY 1; (4) after settle, the queue
region renders `dq-action-result` (or `dq-action-error`) while the pane region renders NEITHER
`dq-action-result` NOR `dq-action-error` and its controls are re-enabled (idle, not stuck
pending). Frozen TEST-585/TEST-615 (the core-seam dedupe + continuation-fan-out pins,
`orky-entry-actions-core.test.ts:126`, `orky-entry-actions-loopback.test.ts:78`) pass
byte-unchanged; frozen TEST-608 (`orky-queue-actions.spec.ts:211-213`, disabled-while-pending)
passes byte-unchanged.

### REQ-006 — CONV-046: a data-driven reason flip DISARMS the open answer form instead of swapping the focus substrate under the user (D5 — fixes F8 FINDING-022 in the shared component) — `ux` `quality`
In `OrkyEntryActions`, when `target.reason` changes while the answer form is open (e.g. a
background refresh flips `escalation` → `human-review` because the escalation resolved elsewhere),
the form MUST CLOSE (`answerOpen` reset) and the typed decision/evidence MUST clear — the
mode-keyed twin of the FINDING-020 disarm-on-success effect — so the mode-keyed form swap
(`EscalationAnswerForm` ⇄ `HumanReviewForm`, each carrying the focus-on-mount
`useOpenFocusRestore`) can never remount a focus-stealing surface without a gesture: keyboard
focus moves ONLY on the explicit toggle/open gesture (CONV-046), and an open form is never
silently re-purposed from decision-entry to verdict-entry. The fix lives in the SHARED component
(both the F8 queue mount and the F10 pane mount get it), MUST keep every F8 frozen pin green (the
disarm effect references no `api.orky*`/`commitPane` — TEST-599; no new testid — TEST-598), and F8's
open FINDING-022 MUST be recorded as fixed by F10 (per CONV-012 co-ownership, any F8 suite
amendment this edit forces happens atomically at F10's tests phase — none is expected).
**Acceptance:** with the answer form open on an `escalation` target and the target's `reason` prop
then flipped to `'human-review'` (no gesture): the form region unmounts (neither
`dq-action-answer-input` nor `dq-action-evidence` is rendered), the previously typed decision text
is cleared (re-opening shows an empty input and a fresh binding), and `document.activeElement` is
NOT moved into any form field by the flip — asserted through the real component lifecycle
(CONV-031/CONV-033: the structural half pins a mode-keyed disarm effect whose body contains no
dispatch; the focus claim rides the e2e half, never a production-build StrictMode claim); the flip
vector passes identically under the queue mount and the pane mount; the whole frozen
`orky-entry-actions-structure` / `-core` / `-loopback` suites pass (byte-unchanged unless a pin is
superseded per REQ-009).

### REQ-007 — Tile-context UX: the F8 interaction conventions hold inside a mosaic tile (D5) — `ux`
The mounted actions region MUST satisfy, in the PANE context: **CONV-041** — activating any
control or input inside the region never fires a host gesture (in the pane: never toggles the
row's disclosure, never scrolls/steals focus via a container handler; the shared region's
`stopPropagation` boundary provides this — F10 MUST NOT strip it and MUST NOT add an unguarded
row-level pointer handler); **CONV-042** — the explicit answer-open gesture moves focus into the
form's first field (shipped via `useOpenFocusRestore`; REQ-006 guarantees no OTHER path mounts
it); **CONV-043** — Enter in the single decision input submits under the same refusal gates as the
submit control; **CONV-044** — a succeeded answer disarms (form closed, payload cleared).
Layout: the region MUST remain fully visible and operable inside a mosaic tile — controls and the
opened inline form may WRAP within the row (the tile is not the 340px drawer; no fixed-width or
drawer-specific assumption may be introduced), the row's existing content
(`data-feature` identity, status text, disclosure toggle) stays intact, and every focusable F10
surface carries visible `:focus-visible` styling per CONV-007 (the existing
`orky-pane`-scoped rule or an added one — never `outline: none`).
**Acceptance:** (e2e, pane mount) clicking `dq-action-answer` then typing into
`dq-action-answer-input` never changes the row's `aria-expanded` disclosure state and focus stays
in the input; the answer-open gesture lands focus in the decision input; Enter in a non-empty
decision input dispatches once, Enter in an empty/whitespace input dispatches nothing; after a
mocked success the form is closed and re-opening shows an empty input; at a narrow tile width the
`dq-action-*` controls remain visible and clickable (no clipped/unreachable control); a source
scan finds no fixed pixel width added to the region/slot by F10 and an
`orky-pane`-covering `:focus-visible` block (TEST-438's rule) still passes with the inject button
covered.

### REQ-008 — The pane's read contract survives: F9 row identity, states, and displayed-escalation agreement (fit-the-existing-system) — `quality` `ux`
Mounting the actions MUST NOT reflow or re-key the F9 contract: rows/React keys/disclosure/`data-feature`
still key on the unique dir slug; the `orky-pane-row-actions` testid literal survives (now
populated); all five pane state testids, the header accents, gates/findings/escalations rendering,
and the refresh-trigger discipline (T1/T2/T3 — F10 adds NO new fetch trigger and no clock/poll)
are unchanged. The answer target shown in `dq-action-answer-target` MUST agree with the row's own
displayed escalation: the bound id equals the `data-escalation-id` of the row's first
`status === 'open'` escalation — the user answers the escalation they can read in the same row.
**Acceptance:** frozen TEST-428/TEST-429/TEST-430/TEST-453/TEST-454 (`orky-pane-structure`,
`orky-pane-display-contract`) pass byte-unchanged; e2e TEST-442's slot/count/identity assertions
(`orky-pane.spec.ts:87-92`) pass byte-unchanged; no new `Date.now()`/`new Date(`/`setInterval`
appears in `OrkyPane.tsx`/`orky-pane-slice.ts`; the e2e escalation fixture shows
`dq-action-answer-target` containing the same id as the expanded row's first open
`data-escalation-id`.

### REQ-009 — Frozen-guard supersession: deliberate, atomic, at the tests phase (CONV-019/CONV-012/CONV-023) — `quality`
Inventory performed with ripgrep pattern
`orky-pane-row-actions|OrkyEntryActions|openOrkyCapture|orky-entry-actions|F10`
(case-insensitive) over `tests/**` — the F9/F10 surface literals per CONV-037's keying rule (the
earlier draft's bare `read-?only` alternation keyed on prose, not the guard surface, and is
dropped; the read-only-CLAIM sweep moved to the doc-pins bullet below). The pattern hits exactly
**14 files** (re-verified 2026-07-02); every hit file was read in full (CONV-023). Dispositions —
every one of the 14 is named here:
- **TEST-433 (`tests/renderer/orky-pane-structure.test.ts:104-118`) — the F9 "read-only scope
  guard" — INTENT SUPERSEDED by F10; literals stay green.** Verified: neither `OrkyEntryActions`,
  `orky-entry-actions`, nor `openOrkyCapture` contains any banned substring (`orkyAction`,
  `child_process`, `execFile`, `registry*`, `orkyWatch`; the bans are case-sensitive literals), so
  every assertion passes byte-unchanged — but the describe's read-only INTENT over `OrkyPane.tsx`
  no longer holds once F10 composes write-capable actions. Per CONV-019 (and the named handoff in
  `orky-capture-structure.test.ts:264-265`: "its eventual supersession belongs to F10, not F12"),
  F10 MUST amend TEST-433's header/describe in the SAME change at the tests phase — the F8
  TEST-353 precedent: re-expressed so `OrkyPane.tsx` may compose the shared action region and the
  rooted capture opener while still containing no raw CLI/mutation/dispatch call of its OWN, with
  a note naming F10. (Also hosts TEST-429 — next bullet.)
- **TEST-494's F9-file sweep (`tests/renderer/orky-capture-structure.test.ts:266-270`) — stays
  green byte-unchanged** (bans only `orkyAction`/`orkySubmitWork` in F9 files; F10 adds
  `openOrkyCapture`, which is neither). MUST still pass after F10.
- **TEST-429 (`orky-pane-structure.test.ts:46-59`) + e2e TEST-442 (`orky-pane.spec.ts:90-91`) —
  presence pins, stay green** (the slot literal and per-row count survive population). The
  "reserved, F9-EMPTY" comments MAY be updated to name F10 in the tests-phase change; no assertion
  changes.
- **The F8 shared-component suites (`orky-entry-actions-structure/-core/-loopback`) — co-owned per
  CONV-012.** The REQ-006 edit is expected to keep them byte-green (TEST-598: no new testid;
  TEST-599: the disarm effect dispatches nothing; TEST-601: no `from './OrkyPane'` import may be
  added — prose naming the host stays legal). TEST-602 pins the QUEUE mount supplies NO
  `escalationId` — the pane mount lives in a different file and does not trip it. TEST-585/588/591
  and TEST-615 are the core-seam pins REQ-002/REQ-005 now cite as their count/continuation halves —
  byte-unchanged is a REQUIREMENT, not just an expectation. Any pin the REQ-006 fix DOES trip is
  amended atomically in the same tests-phase change with a header naming F10.
- **The F8 e2e suite (`tests/e2e/orky-queue-actions.spec.ts`) — co-owned per CONV-012; hits are
  prose (`:5,:40`).** Contains frozen TEST-608 (`:211-213`, disabled-while-pending) and TEST-612
  (`:367`, the fixture-rewrite race vector) — both now load-bearing for REQ-005/REQ-002 and MUST
  pass byte-unchanged.
- **Pattern-noise / not-tripped hits (verified by full read; all green byte-unchanged):**
  `tests/renderer/decision-queue-panel-structure.test.ts` (TEST-353 `:148-159` — explicitly
  PERMITS composing the `OrkyEntryActions` region; it is the amendment precedent this REQ cites,
  not a guard F10 trips); `tests/shared/keybindings-capture-orky-work.test.ts` (TEST-501 `:64-76`
  pins the palette's argument-less `openOrkyCapture()` caller — F10 ADDS a second, rooted caller
  and removes nothing); `tests/shared/orky-action-validate-projectroot-flaglike.test.ts` (`:9`,
  prose naming F10); `tests/renderer/orky-pane-display-contract.test.ts` (`:56`, prose naming
  F10's contract; its pins are REQ-008's, dispositioned there).
- **Doc pins + the CONV-008 sweep (extended — the read-only claims F10 falsifies):** TEST-503
  (`tests/docs-feature-0012.test.ts`, incl. `:45` `openorkycapture` and the repo-wide "no renderer
  UI consumes" sweep) and `docs-feature-0008.test.ts:63-80` (the ipc-contract consumer comment
  must keep matching `/F10/` and never regress to /consumer-?less until F8\/F10/i) — F10's
  doc/comment updates (naming F10 as the shipped second consumer / rooted-capture caller) MUST
  keep BOTH suites green. The CONV-008 doc-sync sweep runs TWO stated patterns: (1) the stale
  future-tense pattern (`F10 will|future call`, case-insensitive) over `docs/**`, `CLAUDE.md`, and
  source comments; (2) the read-only-CLAIM pattern `read.?only|no action affordance|no mutation
  call` (rg -i) over `docs/**`, `CLAUDE.md`, `.orky/baseline/`, and every F10-touched source
  file's header/comments (the baseline's hits describe main-process read surfaces — noise, per
  FINDING-006/decision #6). Under pattern (2), every hit that describes the
  OrkyPane/Orky write surface MUST be corrected; hits about unrelated surfaces (e.g. editor
  read-only mode, historical superpowers plans) and STILL-TRUE claims (the preview button's own
  "read-only preview" title) are dispositioned as noise. Two corrections are MANDATORY, named now:
  `docs/features/orky-pane.md:8-9` ("Strictly READ-only: no `.orky/` write, no CLI, no
  `orkyAction:*` call, no registry mutation") — rewritten to the true post-F10 scope (the pane
  composes the shared F8 action layer and the F12 rooted capture opener; it owns no
  dispatch/capture/CLI/mutation logic of its own), retiring any future-tense F10 phrasing in the
  same file; and the `OrkyPane.tsx:13-14` header ("Strictly READ-only (REQ-013): no action
  affordance, no mutation call") — re-expressed to the TEST-433-amended scope. Verified 2026-07-02:
  NO test pins either text (`docs-feature-0009.test.ts` and `docs-feature-0012.test.ts` contain no
  `read.?only`/`no action affordance`/`no mutation call` match), so both corrections are pin-free;
  TEST-503 and docs-feature-0008 stay green through them.
- **No absence-of-consumer FROZEN GUARD exists for `openOrkyCapture(root)`** (verified: the
  "future call" mentions at `docs-feature-0012.test.ts:45` and `orky-capture-slice.test.ts:45,77`
  are comments/fixture calls, not absence assertions; `orky-capture-slice.test.ts` is hit-file
  #14, dispositioned by this bullet) — nothing to retire there.
**Acceptance:** after F10's tests phase, one change contains BOTH the new/amended tests and the
TEST-433 header amendment (naming F10); the suites enumerated above pass — byte-unchanged except
exactly the amendments this REQ schedules; a `tests/**` grep with the STATED (narrowed) pattern
yields exactly the 14 files dispositioned above and no other (a new hit file is a new, un-
dispositioned guard — stop and disposition it); the doc-sync change states both CONV-008 patterns
and leaves no un-dispositioned pattern-(2) hit that describes the pane's write surface — in
particular `docs/features/orky-pane.md` and the `OrkyPane.tsx` header no longer claim strict
read-only; no frozen guard is edited during the implement phase.

## Verified contract (pinned upstream shapes — read from source, not memory)

Confirmed against shipped source (2026-07-02, re-verified at spec revision). If a datum is not
listed here, F10 does not rely on it.

- **The shared action layer (F8):** `useOrkyEntryActions(target)`
  (`src/renderer/components/orky-entry-actions.tsx:57`) and `OrkyEntryActions({ target })`
  (`:295`) over `OrkyEntryTarget { projectRoot, featureSlug, reason, escalationId? }`
  (`orky-entry-actions-core.ts:29-34`). The region stops pointer propagation at its boundary
  (`orky-entry-actions.tsx:339-340` — CONV-041 for free in any host). A supplied `escalationId`
  binds AS-IS with zero pulls (`orky-entry-actions-core.ts:137-139`); an OMITTED id makes one
  display-time bind pull and refuses honestly on a missing/unusable id (`:140-162`, the no-id
  refusal `:159-161`); submit re-verifies against ONE fresh `registryDetail` pull (`:169-192`);
  feature matching accepts the dir `slug` (`:123-126`). Disarm-on-success effect
  `orky-entry-actions.tsx:319-325`; the FINDING-022 mechanism REQ-006 fixes: `answerOpen` state
  `:297`, mode-keyed form mounts `:370-384`, focus-on-mount substrate
  `use-open-focus-restore.ts:20-33`; F8 FINDING-022 recorded open at
  `.orky/features/0008-queue-answer-resume-actions/findings.json:297-308`.
- **The cross-instance single-flight is genuinely shared — and gesture-layer refusal is the
  rendered protection:** module-scope `flights` map (`orky-entry-actions-core.ts:83`), `flightKey`
  NUL-separated (`:74-78`, CONV-039), `withSingleFlight` returns an existing flight as-is and
  releases on settle (`:106-116`); the hook derives `busy` from the shared registry
  (`orky-entry-actions.tsx:79`) and re-renders via `subscribeFlights` (`:64-65`);
  `showPending = busy || phase.status === 'pending'` (`:303`) — so BOTH mounts of one target
  render pending during a flight. Every dispatch affordance refuses on that shared `busy`:
  preview `disabled={busy}` (`:353-355`), escalation submit `disabled={refuse}` with `refuse`
  including `busy` (`:244-245,:374`) on the click AND Enter paths (`:239-241`), verdict buttons
  `disabled={props.busy}` (`:274-279`). Frozen e2e TEST-608 pins disabled-while-pending
  (`tests/e2e/orky-queue-actions.spec.ts:211-213`); frozen TEST-612 pins the changed-world submit
  refusal via fixture rewrite (`:367`); frozen TEST-585 pins one-flight-per-key
  (`orky-entry-actions-core.test.ts:126`); frozen TEST-588/TEST-591 pin the supplied-id
  zero-pull / one-verify-pull counts (`:191,:274`); frozen TEST-615 pins the core-seam
  continuation fan-out + the no-pre-check structural ban
  (`orky-entry-actions-loopback.test.ts:78`; header `:6-16` records the rendered two-mount vector
  as unreachable in its harness).
- **Resume:** the store's narrow `launchTerminalAt(cwd, launch)` (`src/renderer/store.ts:555-561`;
  kind/shell/placement fixed internally, workspace-less fallback via `newWorkspace`), called
  gesture-time from the hook (`orky-entry-actions.tsx:183-189`).
- **The pane (F9):** reserved slot `data-testid="orky-pane-row-actions"`
  (`src/renderer/components/OrkyPane.tsx:167`, a trailing span in every feature row); row identity
  keys on the unique dir slug (`:139-146` — key, `data-project-root={root}`,
  `data-feature={f.slug}`); the held detail is `orkyPaneDetail[paneId]` (`:55`), root-guarded
  before render (`:85-93`); per-feature escalations WITH ids are already in that payload
  (`:201-212`, `data-escalation-id={esc.id ?? ''}`, `esc.status`, `esc.reason`) — the D4 claim
  holds: NO second display-time pull is needed; the carried `f.status.reason` is the row's
  `OrkyReason` (`:158`). Refresh triggers T1/T2/T3 (`:75-83`) — F10 adds none. The file header's
  "Strictly READ-only (REQ-013): no action affordance, no mutation call" claim (`:13-14`) and
  `docs/features/orky-pane.md:8-9`'s "Strictly READ-only" claim are FALSIFIED by F10 and are
  scheduled for correction in REQ-009's CONV-008 sweep (verified pin-free).
- **The capture entry point (F12):** `openOrkyCapture(root?)` no-ops while open and stores the
  root byte-verbatim (`src/renderer/store/orky-capture-slice.ts:27-30`); App hosts the modal
  app-level (`src/renderer/App.tsx:209`); a non-null `initialRoot` skips the picker
  (`src/renderer/components/OrkyCaptureModal.tsx:34-35`); today's only callers are argument-less
  (`App.tsx:158`, `CommandPalette.tsx:74`) — the rooted path is shipped, tested
  (`orky-capture-slice.test.ts:45`), and caller-less exactly as F12 recorded; F10 is its designed
  first caller.
- **First-open selection parity:** the aggregate marks `reason:'escalation'` from the first
  `status === 'open'` escalation (`orky-status.ts:219`, per the 0008 verified contract), the same
  rule the shared bind path applies (`orky-entry-actions-core.ts:155-162`) — decision #2 mirrors
  it byte-for-byte on the pane side.

## Open questions

None. (The inject placement and the FINDING-022 fix ownership were the concept's two deferred
spec decisions — resolved as decisions #3 and #4.)
