# 0010 — Phase 1: Concept (brainstorm)

## Decisions

- **D1 — Mount F8's shared action layer into F9's reserved actions slot; do NOT fork.** The OrkyPane
  feature-row (F9's `orky-pane-row-actions` region, reserved empty) mounts F8's `OrkyEntryActions`
  keyed on the same (projectRoot, featureSlug[, escalationId]) identity the pane already carries.
  Answer + resume come verbatim from the shared `useOrkyEntryActions`; the shared module-scope
  single-flight (fixed in F8's loopback) means the same target answered from the queue AND the pane
  dedupes to one dispatch — this is the cross-instance case F8's FINDING-009 fix exists for. No new
  dispatch code, no new IPC.
- **D2 — Inject reuses F12's quick-capture, opened PRE-TARGETED to the pane's project.** The pane
  gains an inject affordance that calls F12's `openOrkyCapture(projectRoot)` (the pre-selected-root
  entry point F12 built for exactly this) — no picker step, capture lands on the pane's project.
  This is the F10-inherited residual F12 recorded (its openOrkyCapture(root) had no shipped caller
  until now); F10 is that caller. No new capture logic.
- **D3 — Read-only-except-via-F7/F12 scope holds.** F10 adds only composition + wiring: it dispatches
  ONLY through F7's action layer (via F8's module) and F12's capture; no direct `.orky/` writes, no
  new main write code, no new IPC. Every action tied to an explicit gesture.
- **D4 — Escalation-id sourcing reuses F9's detail channel.** The pane already fetches the F9
  `registryDetail` per-feature detail (escalations with ids); F10's answer binds the escalation id
  from that already-present detail (no second round-trip the pane doesn't already make) — cleaner
  than F8's queue path which had to add the detail pull.
- **D5 — Honor F8's residuals/conventions in the pane context.** CONV-041 (pointer guard),
  CONV-042/043 (open-focus, Enter-submit), CONV-044 (disarm-on-success), CONV-046 (mode-flip
  disarm — the pane's own row-reason-flip case, the F8 FINDING-022 residual, is fixed here since
  F10 is where the shared component gains its second real mount context). The actions must work
  inside a mosaic tile (not a 340px drawer) — layout differs, behavior identical.

## Concerns (routing tags for review lenses)

- `security` — write actions in the pane: gesture-tying, no new IPC, correct id sourcing from F9 detail.
- `ux` — actions inside a tile (not a drawer): layout, keyboard, the inject affordance discoverability,
  coexistence with the queue's same actions (consistent since it's the same component).
- `quality` — reuse (D1/D2 — mount, don't fork F8/F12); the shared single-flight cross-instance case;
  CONV-046 mode-flip fix landing here.
- `networking` — F7 honesty classes surfaced in the pane; the shared single-flight across pane+queue.

## Open questions

- None blocking. The inject affordance placement, and whether F10 fixes F8's FINDING-022 mode-flip
  residual now (D5 says yes — this is its natural home) are spec decisions.

## Gate

Recorded via `record --gate brainstorm` (delegated).
