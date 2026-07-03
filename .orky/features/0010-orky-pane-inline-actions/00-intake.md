# 0010 — Inline actions in OrkyPane (write)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json`, feature `F10`, scaffolded by the app-run orchestrator. Human
review delegated to the autonomous drive (Kevin, 2026-07-01).

### Roadmap entry (verbatim)

> **Title:** Inline actions in OrkyPane (write)
>
> **Summary:** Surface answer/resume (and inject via F12's quick-capture) directly inside the
> OrkyPane through F7's dispatch, so a project can be worked end-to-end from its own pane, each
> action tied to an explicit gesture.
>
> **Deps:** F9 (native OrkyPane, done), F7 (action-dispatch, done).

### Role in the app

Completes the OrkyPane as a full workspace for one project: F9 rendered its status read-only with a
reserved actions slot; F10 mounts F8's shared answer/resume action layer (`useOrkyEntryActions` /
`OrkyEntryActions` / `launchTerminalAt`) into that slot — so a pipeline feature can be answered,
resumed-in-terminal, and have new work injected (via F12's quick-capture, opened pre-targeted to the
pane's project) without leaving the pane. This is the feature F8's action layer was explicitly
factored to be reused by; F10 is primarily composition, not new dispatch logic.
