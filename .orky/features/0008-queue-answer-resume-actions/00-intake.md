# 0008 — One-click answer-escalation + resume on queue entries (write)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json`, feature `F8`, scaffolded by the app-run orchestrator. Human
review delegated to the autonomous drive (Kevin, 2026-07-01).

### Roadmap entry (verbatim)

> **Title:** One-click answer-escalation + resume on queue entries (write)
>
> **Summary:** Wire one-click answer-an-escalation (resolve-escalation / feedback decision) and
> resume (drive) onto F6's queue entries through F7's dispatch, each gated on an explicit user
> gesture, with pending/result states and a clear disabled-feedback message.
>
> **Deps:** F6 (decision-queue drawer, done), F7 (action-dispatch substrate, done).

### Role in the app

The first WRITE capability on F6's read-only queue: it turns "what needs me" into "act on it here."
Each queue entry gains answer (resolve the open escalation via F7's resolveEscalation, or submit a
feedback decision) and resume (F7's drive) actions, each tied to an explicit gesture, surfacing F7's
established result/disabled-feedback semantics. F10 later reuses the same action layer inside the
OrkyPane, so F8's answer/resume logic should be factored to be pane-reusable.
