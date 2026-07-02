# 0013 — OS-level needs-you notifications (read)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json`, feature `F13`, scaffolded by the app-run orchestrator. Human
review delegated to the autonomous drive (Kevin, 2026-07-01).

### Roadmap entry (verbatim)

> **Title:** OS-level needs-you notifications (read)
>
> **Summary:** Extend 0004's tab-badge mechanism to fire OS-level notifications on needs-you
> transitions across ALL tracked projects (from F5) — even ones with no open pane — respecting the
> existing tab-badge opt-in, with dedupe/throttle and click-to-focus.
>
> **Deps:** F5 (done).

### Role in the app

The read-side completion of tier T4 (the OSC-heartbeat push was F14). 0004 already fires an
OS notification when a pane's own Claude session needs input; F13 generalizes "needs you" to Orky
pipeline state (open escalation / awaiting human-review / stalled) across EVERY tracked project in
the F5 registry — including projects with no open pane — so a user working elsewhere learns a
background build wants a decision. Read-only: it observes the F5 aggregate and notifies; it never
writes `.orky/` or dispatches an action (that's F8's job on the queue entries this surfaces).
