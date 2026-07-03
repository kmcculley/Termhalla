# 0011 — Per-project Orky workspace template

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json`, feature `F11`, scaffolded by the app-run orchestrator. Human
review delegated to the autonomous drive (Kevin, 2026-07-01). This is the FINAL roadmap feature
before the cross-feature integration phase.

### Roadmap entry (verbatim)

> **Title:** Per-project Orky workspace template
>
> **Summary:** A workspace preset that sets up an OrkyPane (plus a terminal pane in the project
> root) for a chosen tracked project, so opening 'work this Orky project' is one gesture.
>
> **Deps:** F9 (native OrkyPane, done).

### Role in the app

The single-gesture "work this Orky project" entry point that ties the tier together: it composes an
OrkyPane (F9, bound to a chosen tracked project) beside a terminal pane in that project's root, as a
saved/reusable workspace — reusing Termhalla's existing workspace-template mechanism. With F8/F10's
actions in the pane and F12's inject, opening this template gives the user a complete cockpit for
one Orky project from a single gesture (command palette / registry pick). Composition only: it
wires the shipped pane kinds + template system, no new pane logic and no new dispatch.
