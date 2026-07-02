# 0012 — Phase 1: Concept (brainstorm)

**Status:** human confirmed (delegated autonomous drive). Gate recorded.

## Decisions

- **D1 — A global capture modal, not a pane or drawer.** Invoked from the command palette and a
  rebindable chord; a Modal-family dialog with a title/detail text area and a target-project
  picker. Fast in, fast out: capture → submit → dismissible result toast; no persistent UI.
- **D2 — Submission goes EXCLUSIVELY through F7's `submitWork` dispatch.** No new main-process
  write code, no new CLI invocation path, no direct `.orky/` writes — the renderer calls the
  existing hardened orkyAction IPC (validated, allowlisted, audited, gesture-tied). The
  feedback-disabled outcome surfaces F7's established distinct result (with its actionable
  message) — never a silent no-op, never auto-enabling anything (enabling feedback is an audited
  human decision, ADR-027).
- **D3 — Reuse the F9 substrate.** The tracked-project picker reuses `OrkyRootPicker` (or its
  shared load-state/focus hooks where the modal shape differs); CONV-020 focus discipline,
  CONV-030 target-guarded keys, CONV-023 (if a renderer absence-of-consumer guard protects the
  orkyAction surface, it is superseded per CONV-019's protocol by THIS feature as its designed
  first consumer — the spec must inventory such guards before pinning).
- **D4 — Invokable with a pre-selected project.** The capture flow accepts an optional
  pre-selected root (skipping the picker step) so F10's OrkyPane "inject" reuses it verbatim;
  entries carry the established `(projectRoot)` identity plus the free-text payload F7's
  validation already bounds.
- **D5 — Result honesty (CONV-013).** The capture result reports F7's own `dispatched`/`ok`
  semantics — a queued-but-not-yet-applied work item is presented as "captured to the inbox"
  (what it is), never as "Orky accepted/started it" (which only the orchestrator's `apply` does).

## Concerns (routing tags for review lenses)

- `security` — first renderer consumer of a WRITE surface: gesture-tying, no payload smuggling
  around F7's validation, no new IPC.
- `ux` — modal keyboard flow end-to-end; disabled-feedback and error states actionable; capture
  latency feel (audit is off the critical path per F7).
- `quality` — reuse (D3), result-shape fidelity (D5), no forked picker logic.
- `determinism` — n/a beyond stable picker ordering (already pinned upstream); tag omitted.

## Open questions

- None blocking. Chord default, modal copy, and whether detail is one field or title+detail are
  spec decisions bounded by F7's payload validation.

## Gate

Recorded via `record --gate brainstorm` (delegated).
