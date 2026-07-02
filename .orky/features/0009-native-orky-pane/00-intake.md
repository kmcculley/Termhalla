# 0009 — Native OrkyPane pane type (read)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json` / `roadmap.md`, feature `F9`, scaffolded by the app-run
orchestrator. Human review delegated to the autonomous drive (Kevin, 2026-07-01).

### Roadmap entry (verbatim)

> **Title:** Native OrkyPane pane type (read)
>
> **Summary:** A first-class pane KIND in the workspace/pane model (schema-bumped, persisted) that
> binds to an explicitly-chosen Orky project root and renders its full status — features, live
> phases, gate N/M, findings, escalations — reusing the orky-status mappers and F5's data rather
> than a terminal chip.
>
> **Deps:** F5 (done).

### Role in the app

Tier **T3** (native pane) of the Termhalla × Orky integration. F6's drawer answers "what needs me
across ALL projects"; the OrkyPane answers "show me EVERYTHING about THIS project" as a persistent,
tiling-layout citizen. F10 later adds inline actions (via F7's shipped dispatch) inside this pane,
and F11 builds the per-project workspace template around it — so the pane's layout must reserve
room for actions and its binding must be template-referenceable, without depending on either.
