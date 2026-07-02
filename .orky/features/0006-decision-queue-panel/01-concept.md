# 0006 — Phase 1: Concept (brainstorm)

**Status:** human confirmed (delegated autonomous drive). Gate recorded.

## Decisions

- **D1 — A window-scoped collapsible drawer, NOT a pane kind.** The queue renders as a right-side
  collapsible drawer at window scope — the same interaction family as the per-project notepad
  drawer — toggled from a status-bar affordance, the Ctrl+K command palette, and a rebindable
  keybinding. It is explicitly NOT a workspace-mosaic pane kind: the queue is cross-project and
  pane-independent, so it belongs to window chrome; a first-class OrkyPane bound to ONE project is
  F9's job, a different feature. Rationale: reuse the established drawer pattern; avoid colliding
  with F9's schema-bumped pane-kind work.
- **D2 — Renderer-only feature; F5's aggregate is the sole data source.** F6 consumes the existing
  `registry:status` push (the F5 cross-project aggregate) from the renderer store. No new
  main-process service, no new IPC channel, no new reads under `.orky/` — if a datum isn't in the
  aggregate, F6 does not display it (it may motivate an F5 extension as a SEPARATE feature).
  Allowed shared/renderer additions: palette entry, keybinding registration, store selectors.
- **D3 — Queue membership = needs-a-human-now, per 0004's established semantics.** An entry is a
  (project, feature) whose status is needs-human (open escalation, or autonomous gates green
  through doc-sync with human-review not yet passed — the 0004 gate-based model) or whose active
  run is stalled (0004's stall detection). Grouped by project (display name = root basename, full
  path on hover), ranked within a project by the existing `selectChipFeature` ordering, projects
  ordered by their top entry's rank then stable by root path. Determinism: identical aggregate in →
  identical DOM order out.
- **D4 — Click-to-focus, with a bounded fallback for pane-less projects.** Clicking an entry
  focuses the most-recently-focused open pane bound to that project root (the F5 membership
  already knows pane bindings). If the project has NO open pane, the entry shows an "open terminal
  here" affordance that spawns a terminal pane at the project root (an existing Termhalla
  capability — still read-only with respect to Orky). No deep-linking into `.orky` files in F6.
- **D5 — States per the roadmap.** Loading (aggregate not yet received), empty ("nothing needs
  you" — distinct from error), and error (registry unavailable / malformed push) states are
  explicit, minimal, and theme-aware. The drawer badge (count of queue entries) mirrors the same
  number the entries list shows — one source of truth via a shared selector.

## Concerns (routing tags for review lenses)

- `ux` — the drawer must not fight the notepad drawer (both right-side collapsibles); badge/count
  semantics must match the list; keyboard accessibility for toggle + entry focus.
- `performance` — re-render cost on every `registry:status` push (pushes arrive on every root
  re-read); selectors must be memoized so an unchanged aggregate doesn't re-render the queue.
- `determinism` — stable ordering (D3) so entries don't jump between pushes.
- `quality` — reuse 0004/F5 shared mappers and selectors; no forked status logic in the panel.

## Open questions

- None blocking. Exact drawer component naming, badge placement, and the "open terminal here"
  wiring reuse are spec/plan-time decisions. F8's future action buttons only need each entry to
  have a stable identity (project root + feature slug) — D3 already guarantees that.

## Gate

Recorded via:
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" record --feature .orky/features/0006-decision-queue-panel --gate brainstorm --verdict pass --evidence "delegated-human brainstorm: D1 window-scoped drawer (not a pane kind), D2 renderer-only over F5 aggregate, D3 needs-human-now membership with deterministic ordering, D4 click-to-focus + open-terminal fallback, D5 explicit loading/empty/error states"`
