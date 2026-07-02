# 0008 — Phase 1: Concept (brainstorm)

**Status:** human confirmed (delegated autonomous drive). Gate recorded.

## Decisions

- **D1 — Actions live on F6's queue entries, dispatched EXCLUSIVELY through F7.** Each queue entry
  gains an actions region (the slot F6 reserved) with **answer** and **resume**. Every dispatch
  goes through F7's existing hardened orkyAction IPC (resolveEscalation / drive / submitWork —
  validated, allowlisted, audited, gesture-tied). No new main-process write code, no new CLI path,
  no direct `.orky/` writes. Each action fires ONLY on an explicit click/keypress.
- **D2 — "Answer" is context-driven by the entry's needs-you reason.** For an entry whose reason is
  an open escalation, answer resolves THAT escalation (F7 resolveEscalation with the human's
  decision text — a small inline input/prompt). For awaiting-human-review, answer records the
  human-review verdict via the sanctioned path (or, where feedback is enabled, a feedback decision).
  The entry already carries the (projectRoot, featureSlug) identity + the escalation id from the F6
  aggregate/F9 detail; answer never guesses a target.
- **D3 — "Resume" is F7's drive.** Resume dispatches drive for the entry's feature (the deterministic
  next action), surfacing F7's result. It's the "unblock and continue" gesture after an answer, or
  for a stalled entry.
- **D4 — Per-entry pending/result/disabled states, honest (CONV-013/034).** Each action shows a
  pending state while in flight (single-flight), then F7's result: success names what happened
  (never over-claims — "escalation resolved" / "resume dispatched", not "feature done"), failures
  surface F7's verbatim error with its honesty class (definite vs indeterminate per CONV-034), and
  the feedback-disabled outcome shows F7's distinct actionable message with NO auto-enable (ADR-027).
- **D5 — Factor the action layer for F10 reuse.** The answer/resume dispatch + state logic is a
  shared unit (hook/module) the OrkyPane (F10) will reuse verbatim, keyed on the same
  (projectRoot, featureSlug[, escalationId]) identity — F8 builds it on the queue, F10 mounts it in
  the pane. Reuse the F12 result-honesty conventions and the shared focus/dispatch helpers.

## Concerns (routing tags for review lenses)

- `security` — write actions on the queue: gesture-tying (no dispatch without an explicit gesture),
  no target smuggling around F7's validation, correct escalation-id/decision routing, no new IPC.
- `ux` — the inline answer input flow, pending/result/disabled states, keyboard operability,
  destructive-action clarity (answer/resume change real pipeline state).
- `quality` — reuse (D5 shared action layer, F7 dispatch, F12 honesty), no forked dispatch logic.
- `networking` — F7's partial-failure/indeterminate semantics surfaced correctly on each action
  (the CONV-015/034 lessons); single-flight; result mapping.

## Open questions

- None blocking. The inline-answer input shape (prompt vs expanding field), the exact awaiting-review
  answer path (record human-review vs feedback decision when enabled), and button placement are spec
  decisions bounded by F7's validated action set.

## Gate

Recorded via `record --gate brainstorm` (delegated).
