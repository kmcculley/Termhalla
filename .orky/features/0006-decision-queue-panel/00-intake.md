# 0006 — Decision-queue panel (read)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json` / `roadmap.md`, feature `F6`, scaffolded by the app-run
orchestrator (not hand-brainstormed from a raw human idea — the roadmap entry below is the agreed
starting point; brainstorm narrowed its genuine ambiguities). Human review of this feature's
brainstorm + final gate is delegated to the autonomous drive (Kevin, 2026-07-01: "drive the rest of
the work queued up for termhalla automatically without my input").

### Roadmap entry (verbatim)

> **Title:** Decision-queue panel (read)
>
> **Summary:** A renderer panel that renders F5's cross-project aggregate as a queue of what needs
> a human now (open escalations, awaiting human-review, stalled), grouped by project and ranked by
> the existing selectChipFeature ordering, with empty/loading/error states and click-to-focus.
>
> **Deps:** F5 (done — registry + `registry:status` aggregate shipped).

### Role in the app

Tier **T1** (cross-project decision queue, UI half) of the Termhalla × Orky integration roadmap.
F5 (shipped) built the pane-independent, cross-project aggregate and pushes it over the
`registry:status` IPC channel; F6 is its **first renderer consumer** — the "what needs me now"
surface. F8 later wires one-click answer/resume actions (via F7's dispatch, also shipped) onto
these same queue entries, so F6's entry layout must leave room for actions without depending on
them.
