# 0009 — Phase 1: Concept (brainstorm)

**Status:** human confirmed (delegated autonomous drive). Gate recorded.

## Decisions

- **D1 — A first-class pane KIND in the mosaic, persisted, schema-bumped.** `orky` joins the
  existing pane kinds (terminal / editor / explorer / …) as a real tile in the react-mosaic layout,
  saved and restored with workspaces. This REQUIRES a `SCHEMA_VERSION` bump with a migration (the
  project's "Persistence is versioned" convention) — the exact opposite of F6's no-schema-change
  guard, and the reason the two features are separate. Undock/redock, templates (F11), and
  window-state restore must treat it like any other pane kind.
- **D2 — Binding is an explicitly-chosen tracked root, persisted with the pane.** At creation
  (command palette entry and wherever new-pane affordances live), the user picks a project root
  from the F5 registry's tracked set; the pane persists that root. A pane whose root is no longer
  tracked (or whose `.orky/` vanished) renders an explicit unbound/placeholder state with a
  re-bind affordance — never a crash, never a silent empty. Binding survives restart verbatim
  (case-preserved root string; matching uses the established normalized-key discipline).
- **D3 — Data = the F5 aggregate for the roll-up, plus a NEW read-only per-root detail channel for
  what the aggregate deliberately omits.** The wire aggregate (`registry:status`) carries the
  chip-level roll-up; "full status — features, live phases, gate N/M, findings, escalations"
  needs per-feature gate/finding/escalation detail that main already reads (OrkyRootEngine /
  state.json / findings.json) but does not push. F9 adds ONE read-only, request/response detail
  surface (per-root, main-derived from the SAME bounded readers F5 uses — no new fs semantics, no
  writes, resource bounds preserved). This is a READ-surface extension: the renderer
  mutation-surface guard (CONV-019's replacement of TEST-070) must remain green; the new channel's
  own absence-of-consumer story does not arise (F9 IS the consumer).
- **D4 — Read-only in F9; the layout reserves an actions region for F10.** No CLI invocation, no
  writes under `.orky/`. Every feature row carries the stable `(projectRoot, featureSlug)` identity
  F6 established (and F8/F10 will reuse), and the row layout leaves an explicit affordance slot so
  F10 can add answer/resume without restructuring.
- **D5 — Reuse, don't fork.** The orky-status mappers, F6's presentation conventions (theming
  variables, a11y per CONV-020, focus-visible per CONV-007, `getState()` for handler-only state
  per CONV-021), and the registry store slice are the substrate. New presentation logic follows
  the pure-module + source-scan testability pattern (node-env vitest, no jsdom).

## Concerns (routing tags for review lenses)

- `ux` — a pane (not a drawer): tile sizing, scroll behavior for long feature lists, unbound state
  clarity, keyboard operability inside a tile, coexistence with the F6 drawer showing overlapping
  data.
- `performance` — per-root detail reads on demand (not pushed on every fs event); no unbounded
  re-render from aggregate pushes; the detail channel must not turn the bounded readers into a
  hot loop.
- `determinism` — stable ordering of features/findings/escalations in the pane; schema migration
  determinism (same pre-migration file → same post-migration state).
- `quality` — reuse (D5); migration correctness; the read-surface extension must not leak
  mutation symbols into the renderer.

## Open questions

- None blocking. Channel naming, the detail payload shape (spec pins it against what state.json /
  findings.json actually contain), pane-creation affordance placement, and the unbound-state copy
  are spec decisions. F11 only needs the pane kind + binding to be template-serializable — D1/D2
  guarantee that.

## Gate

Recorded via:
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" record --feature .orky/features/0009-native-orky-pane --gate brainstorm --verdict pass --evidence "delegated-human brainstorm: D1 first-class persisted pane kind + schema bump, D2 explicit tracked-root binding with unbound state, D3 F5 aggregate + new read-only per-root detail channel, D4 read-only with F10 actions region reserved, D5 reuse F6/orky-status substrate"`
