# Queue answer + resume actions (feature 0008)

One-click **answer** and **resume** actions on every entry in the Orky decision-queue drawer — the
first write-capable consumer of the queue, riding F7's existing `orkyAction:*` dispatch surface.
Zero new IPC channels, zero new preload methods, zero main-process code: the renderer diff is
chrome plus one shared action layer.

## The shared action layer (the F10-reuse seam)

Everything lives in one pane-agnostic module pair under `src/renderer/components/`:

- **`orky-entry-actions-core.ts`** — the api-free, React-free, store-free PURE core: the
  cross-instance **single-flight** gate, the escalation identity binding + submit-time
  re-verification, the request builders, and the result-honesty classifier. The `registryDetail`
  IPC pull is **injected** as an argument (the repo's testability rule), so the core is
  unit-driven behaviorally under the node-env harness.
- **`orky-entry-actions.tsx`** — the composition point: `useOrkyEntryActions` (the hook) +
  `OrkyEntryActions` (the presentational region). This file is the ONLY renderer home of the three
  F7 bridges consumed here — `resolveEscalation`, `recordHumanGate`, `driveStatus` (F12's
  quick-capture modal owns the fourth, submitWork). Every dispatch is issued from an explicit
  user-gesture handler, never an effect: mounting the region dispatches nothing.

Both are keyed on **`OrkyEntryTarget`** `{ projectRoot, featureSlug, reason, escalationId? }` —
F8 supplies it from a queue row (no escalation id; the row never carries one), and **F10's
OrkyPane** mounts the same `OrkyEntryActions` for a detail feature row unchanged, passing the
display-time escalation id it already holds. `DecisionQueuePanel` composes the region per row and
contains no dispatch of its own.

## Answer — context-driven, identity-bound

The answer mode follows the entry's needs-you reason: `escalation` resolves THAT escalation with
inline decision text; `human-review` records a pass/fail verdict (plus optional evidence — an
empty field is omitted, never sent as `''`); `stalled` offers no answer control (there is nothing
to resolve or record — only the preview and resume-in-terminal).

The escalation target is an **identity, never a position** (REQ-003):

1. **Bound at display time** — opening the answer form pulls the F9 `registry:detail` channel,
   takes the FIRST escalation with `status === 'open'` in state.json array order (the same
   selection the aggregate used to mark the row), and captures its structural `id`. The id is
   never read out of free-text `status.detail` and never fabricated; every unbindable shape
   (failed pull, unmatched feature, slug collision, no open escalation, id-less escalation)
   refuses with a specific, actionable message.
2. **Shown before dispatch** — the bound id (and its reason) renders beside the input, so the
   user sees exactly which escalation their decision resolves.
3. **Re-verified at submit** — a FRESH detail pull confirms the bound id is still an OPEN
   escalation. If the world changed meanwhile (resolved elsewhere, a different one now open),
   nothing is dispatched and an honest "changed — re-open to answer" message renders; a bound id
   that is still open dispatches even when it is no longer positionally first (identity beats
   position).

Requests are built from exactly the entry identity + the inline input — no extra keys, no
client-side rewrite (F7's server-side validation owns the guards).

## Resume — two honest parts, never a hidden drive

- **Next-action preview** — `driveStatus` is read-only and returns `dispatched:false` always; the
  preview renders the computed next action ("next: await-human" and the like) and never claims the
  pipeline advanced.
- **Resume-in-terminal** — the actionable continuation: one gesture commits exactly ONE terminal
  pane through the existing `commitPane` spawn path with `cwd` = the entry's project root and
  `launch` = the `claude` binary with `/orky:resume` as its initial prompt argument. Termhalla's
  contract ends at spawning that argv at that cwd in a visible, user-owned pane: where the
  installed Claude Code executes the initial prompt the resume runs; where it does not, the user
  has an interactive session already at the correct project and completes it themselves — visible
  either way, never a silent failure. No F7 action rides this gesture, and a window with no
  workspace gets one created first (the F6 pane-less-fallback precedent).

## Single-flight, pending, and detached outcomes

Each `(projectRoot, featureSlug, action)` — answer and preview independently — allows at most ONE
in-flight dispatch across **every mounted instance** in the window: the gate is a module-scope
registry in the core (NUL-separated composite key, collision-proof), consulted at gesture time and
released on settle regardless of outcome or mount state. While a flight is in the air every mount
of that target renders the pending state with the corresponding control disabled. Separate OS
windows are separate processes and share no gate — cross-window duplicates rely on F7's
per-feature serialization plus honest surfacing of the second write's own result.

If the drawer closes (or the entry leaves the queue) while a dispatch is in flight, the settled
outcome detaches to the store-level toast chokepoint — a FAILURE as a never-suppressed error-kind
toast, and a SUCCESS on the same default (suppressible) toast kind the in-view region would have
shown (the F12 `OrkyCaptureModal` precedent) — both carrying the SAME honesty-class message the
core classifier computed. No outcome, success or failure, is ever silently swallowed.

## Failure honesty (per kind, per action)

Every failure renders the CLI's error **verbatim**, classified for the MUTATING answers:

- **Indeterminate** — `cli-timeout`, the renderer-synthesized `ipc-failure` (an invoke rejection is
  never mislabeled as an F7 kind), and `cli-unparseable` (the child either completed with an
  unreadable report or never ran): the write's fate is unknown — the copy admits it may have
  landed and warns a retry may duplicate.
- **Distinct no-write** — `feedback-disabled`: nothing was written; enabling the write path is an
  audited human decision made outside Termhalla (ADR-027), so no enable affordance exists.
- **Definite** — every remaining kind (`cli-error`, `orky-cli-not-found`, `invalid-args`,
  `root-not-allowed`, `feature-not-found`, `gate-not-allowed`, `unknown-sender`).

Preview failures use the same classifier, but a READ cannot duplicate a write: its indeterminate
kinds render safe-retry wording with no duplicate warning.

## Pointer isolation (the click twin of CONV-030)

The actions region stops pointer propagation at its boundary, so clicking any nested control or
inline input never fires the host row's own focus-project click gesture — while a click on the row
BODY still focuses the matching pane. Controls are native buttons with visible `:focus-visible`
styling and theme-token colors only.

## Known residual limitations (accepted, tracked)

- **Verify-to-write TOCTOU window (FINDING-021, LOW — CLOSED upstream 2026-07-12).** The
  submit-time re-verification pull (REQ-003 part 3) runs renderer-side BEFORE the dispatch enters
  F7's per-feature serialization, so it was disclosed as a race window. Since Orky v0.44.0 the
  write itself is guarded: `resolveEscalation` refuses a non-open escalation without `--force`
  (`ESCALATION_NOT_OPEN`), so an escalation resolved elsewhere in that window is no longer silently
  overwritten — the dispatch surfaces the refusal through the existing error-honesty classes. The
  renderer-side pre-verify remains as a UX courtesy (a friendlier message than the CLI refusal).
- **Mode-flip can swap the open form under the focus substrate (FINDING-022, LOW, open).** If a
  background aggregate refresh flips a queue row's `reason` (e.g. `escalation` → `human-review`)
  while its answer form is open, the row's stable key keeps the `OrkyEntryActions` instance
  mounted, silently swapping `EscalationAnswerForm` for `HumanReviewForm` under the open-focus
  substrate rather than closing the stale form. Disclosed, not fixed.
