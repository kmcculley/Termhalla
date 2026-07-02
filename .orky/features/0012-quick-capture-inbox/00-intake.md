# 0012 — Quick-capture new-work inbox (write)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json`, feature `F12`, scaffolded by the app-run orchestrator. Human
review delegated to the autonomous drive (Kevin, 2026-07-01).

### Roadmap entry (verbatim)

> **Title:** Quick-capture new-work inbox (write)
>
> **Summary:** A fast global entry point (command palette / shortcut) to capture new work or an
> idea from anywhere in Termhalla, pick a target project from F5's registry, and submit it as a
> new-work feedback item via F7. This is the single new-work injection surface the queue and
> OrkyPane also reuse.
>
> **Deps:** F7 (done — the hardened action-dispatch substrate).

### Role in the app

The write half of tier T4. F7 shipped `submitWork` (feedback CLI `emit --type work.request`, file
mode) behind a validated, audited, allowlisted main-process dispatcher — with NO renderer consumer
yet. F12 is that first consumer: a capture modal reachable from anywhere. F10 later re-uses this
exact surface inside the OrkyPane ("inject"), so the capture flow must be invokable with a
pre-selected project as well as with the picker.
