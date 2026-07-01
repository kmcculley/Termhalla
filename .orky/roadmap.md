# Termhalla — Orky integration roadmap (T1–T4)

This roadmap decomposes tiers **T1–T4** of the Orky × Termhalla integration. **T0** (the read-only
status mirror) already shipped as feature `0004-orky-status-awareness` (Termhalla v0.8.0) and is **not**
a roadmap node — every new feature below builds *on* its plumbing rather than re-deriving it.

Hard constraints that shaped the cut (load-bearing):
- Termhalla is a **thin client over Orky's stable contract** (`.orky/` files + the CLIs + the feedback
  spool). No Orky pipeline logic is duplicated here.
- Termhalla **never decides a gate** — write features submit human verdicts/decisions/work; the
  Gatekeeper re-derives from ground truth (ADR-004).
- Every action traces to an **explicit user gesture**; no autonomous stall-recovery driving Claude from
  Termhalla.
- Transport is **filesystem-first**.

## Features

| id | slug | title | deps |
|----|------|-------|------|
| F5 | 0005-cross-project-orky-registry | Cross-project Orky registry + multi-root aggregation | — |
| F6 | 0006-decision-queue-panel | Decision-queue panel (read) | F5 |
| F7 | 0007-orky-action-dispatch | Orky action-dispatch substrate (first write capability) | F5 |
| F8 | 0008-queue-answer-resume-actions | One-click answer-escalation + resume on queue entries (write) | F6, F7 |
| F9 | 0009-native-orky-pane | Native OrkyPane pane type (read) | F5 |
| F10 | 0010-orky-pane-inline-actions | Inline actions in OrkyPane (write) | F9, F7 |
| F11 | 0011-orky-workspace-template | Per-project Orky workspace template | F9 |
| F12 | 0012-quick-capture-inbox | Quick-capture new-work inbox (write) | F7 |
| F13 | 0013-os-needs-you-notifications | OS-level needs-you notifications (read) | F5 |
| F14 | 0014-orky-osc-heartbeat | Orky OSC heartbeat parse + render (read) | — |

### Tier → feature mapping
- **T1 (cross-project decision queue, read):** F5 (data/registry/aggregation) + F6 (queue UI).
- **T2 (one-click answer/resume/inject, write):** F7 (dispatch substrate) + F8 (answer/resume on queue).
  *Inject-new-work is delivered by F12* (single injection surface; see note below).
- **T3 (native pane + workspace template):** F9 (read pane) + F10 (inline actions) + F11 (template).
- **T4 (quick-capture + notifications + heartbeat):** F12 (quick-capture/inject) + F13 (OS
  notifications) + F14 (OSC heartbeat).

## Dependency graph

```
F5 ──┬─> F6 ──┐
     │        ├─> F8
     ├─> F7 ──┤
     │        ├─> F12
     │        └─> F10
     ├─> F9 ──┬─> F10
     │        └─> F11
     └─> F13
F14  (independent — extends 0004 directly)
```

All edges point from a prerequisite to a dependent; the graph is acyclic. F14 has no roadmap
dependency (it extends 0004's OSC scanner infra directly).

## Build order

A valid topological order: **F5 → F7 → F6 → F9 → F13 → F8 → F12 → F10 → F11**, with **F14** insertable
anywhere (independent). Foundations first: F5 (cross-project read aggregation) and F7 (the write
substrate) unblock everything; the action and pane features layer on top.

## Brownfield seams (DAG cannot encode these)

These are real dependencies on **already-built 0004 code**, which is not a roadmap node and so cannot
appear in any `deps`. The integration phase must exercise them:
- F5 generalizes 0004's `src/main/orky/orky-tracker.ts` (per-root watcher, fanned to panes) and reuses
  `find-orky-root.ts` and the pure `src/shared/orky-status.ts` mappers (`orkyFeatureStatus`,
  `selectChipFeature`, gate/needs-human logic).
- F6/F8/F9/F13 reuse 0004's `orky:status` push pattern, the renderer `runtime-slice` store, the
  `tab-badge.ts` aggregation, and the `chip-status.ts` model.
- F14 extends 0004's `src/main/status/osc-scanner.ts` / `osc133-parser.ts`.

## Integration phase

Declared (≥2 features interact, and they interact heavily). The cross-feature tests must prove the full
**read → decide → act** loop against a synthetic multi-project `.orky/` fixture, the read/write
boundary, and the feedback-disabled fallback. See `roadmap.json` → `integration.summary` for the
specific seams and end-to-end flows.

## Compliance

None — `.orky/compliance/framework.json` does not exist, so no controls are assigned and no compliance
phase is declared.

## Deferred

Intentionally out of scope for T1–T4 v1; record, don't silently cut:

- **Flipping `feedback.enabled` automatically.** Termhalla's `.orky/config.json` currently has
  `feedback.enabled: false`. F7/F8/F10/F12 are specified to **detect and surface** the disabled state
  (and may offer to flip it on an explicit gesture), but auto-enabling Orky's control plane without the
  user's say-so is deferred — it is a security/consent decision, not a default.
- **`http`-mode feedback transport.** All write features target the **`file`-mode** inbox/outbox
  (filesystem-first constraint). The control plane's `http` mode is out of scope.
- **Autonomous stall-recovery / driving Claude from Termhalla.** Explicitly excluded by the TOS
  posture; stall-recovery stays in Orky's sanctioned cron watchdog. F8/F10 only *submit* a resume
  (`drive`) on an explicit click; they never loop autonomously.
- **The OSC-heartbeat emitter.** F14 covers only the Termhalla-side **parse + render**. Whether the
  heartbeat markers are emitted by an Orky-side hook (the likely home, given the thin-client posture)
  or synthesized by Termhalla is an open question (below); the emitter itself is not scoped here.
- **Editing `.orky/` artifacts in place** (specs, plans) from the OrkyPane. F9/F10 are status + sanctioned
  actions only; rich artifact editing is a later tier.

## Open questions (need human judgment before approval)

1. **Inject-new-work placement.** The tier brief lists "inject new work" under **T2**, but T4's
   "quick-capture" is the same capability from a global surface. To avoid two injection mechanisms, this
   plan delivers **one** new-work submission feature (**F12**) that the queue (F8) and OrkyPane (F10)
   reuse, rather than building inject twice. Confirm this consolidation, or split inject back into T2.
2. **~~OSC-heartbeat ownership (F14).~~ RESOLVED (2026-06-30).** The emitter is Orky-side: a new
   deterministic `gatekeeper osc-heartbeat` CLI (ADR-026, Orky v0.24.0) broadcasts `ESC ] 9999 ; <JSON>
   BEL` on the run's own stdout, opt-in via `config.heartbeat.osc`. Wire format + payload schema:
   Orky repo's `docs/osc-heartbeat.md`. F14 stays scoped to the Termhalla-side parser/renderer only — it
   never spawns or synthesizes the emitter.
3. **F7 → F5 coupling.** F7's writable-project **allowlist** is sourced from F5's registry (so writes
   only ever target a project the user already tracks). This makes the entire write capability depend on
   the cross-project read layer. That matches the T2-after-T1 tier ladder, but confirm you want write
   gated on the registry rather than on an independently user-selected root.
