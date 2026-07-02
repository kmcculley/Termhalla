# 0013 — Phase 1: Concept (brainstorm)

**Status:** human confirmed (delegated autonomous drive). Gate recorded. **One decision (D3) amended
post-gate by coordinator (delegated human authority, 2026-07-02) — see the amendment note under D3.**

## Decisions

- **D1 — A main-process observer over the F5 aggregate, not a renderer feature.** The notifier
  subscribes to the same cross-project `registry:status` aggregate F5 already computes and fires
  Electron `Notification`s on needs-you TRANSITIONS. It lives main-side because it must notify for
  projects with NO open pane (the whole point) — a renderer/pane-scoped observer can't. It adds no
  new read of `.orky/` (the aggregate is the sole source) and no new IPC beyond a click→focus
  channel.
- **D2 — "Needs you" = the established gate-based semantics, per (project, feature).** A
  notification fires when a feature ENTERS needs-human (open escalation, or autonomous gates green
  through doc-sync with human-review not yet passed — 0004's model) or stalled — and is deduped so
  a feature that stays needs-you does NOT re-notify. Transition tracking is keyed by
  (projectRoot, featureSlug, reason) so a genuine reason change (escalation → stalled) may
  re-notify but a steady state never does.
- **D3 — Respect the existing tab-badge opt-in; add no new global switch in F13.** The feature is
  gated on the SAME setting that already governs 0004's tab-badge/notification opt-in (reuse, not a
  parallel toggle). If notifications are off, the observer is inert. A per-project mute is out of
  scope (candidate for a later feature); F13 is the app-wide read-side.

  > **AMENDMENT — D3 SUPERSEDED BY COORDINATOR (delegated human authority, 2026-07-02).** The
  > original D3 premise is **false against shipped source**: there is NO app-wide tab-badge/
  > notification opt-in to reuse. The only shipped opt-in is the **per-terminal-pane**
  > `AlertConfig.osNotification`/`tabBadge` (`src/shared/alerts.ts:3-4`, `src/shared/types.ts:165-170`),
  > read per-pane in the renderer (`src/renderer/store/runtime-slice.ts:29,33`,
  > `src/renderer/components/tab-badge.ts:27,31`). It is renderer-owned (invisible to a main-side
  > observer), never carried on the aggregate (`OrkyRegistryEntry` has no `AlertConfig`), and —
  > decisively — **does not exist at all for a pane-less project**, which is exactly the case F13
  > exists to serve. "Reuse the per-pane opt-in / add no new switch" is therefore unsatisfiable
  > alongside D1 (this was the spec's prose ESC-001 flag).
  >
  > **Coordinator resolution:** introduce a SINGLE new **app-wide** opt-in setting for Orky
  > needs-you notifications (a cross-project signal has no per-pane home, so it must be app-wide,
  > not per-pane). It lives in the app-wide preferences seam (`QuickStore` / `quick.json` — the home
  > of the other app-wide toggles `recordByDefault`/`autoResumeClaude`/`copyOnSelect`/`toastsEnabled`),
  > **default ENABLED** (consistent with `DEFAULT_ALERTS.osNotification:true` — the app defaults
  > notifications on; the user gets a mute). The observer's opt-in gate (D3 "inert when off") is
  > wired to this new setting; the injected `shouldNotify` seam is retained for testability, with
  > this setting as its production source. This supersedes the original D3 clauses "reuse the SAME
  > per-pane setting" and "add no new global switch." See `02-spec.md` REQ-005 for the pinned name,
  > location, default, persistence mechanics, and settings-UI acceptance.

- **D4 — Dedupe + throttle + coalesce.** Beyond the per-key dedupe (D2): a throttle bounds
  notification RATE (a burst of transitions across many projects coalesces into a bounded number,
  e.g. a digest "3 projects need you" past a threshold rather than N toasts), and a resolved
  needs-you (human-review passed / escalation resolved) clears its dedupe key so the NEXT genuine
  transition notifies again.
- **D5 — Click-to-focus.** Clicking a notification focuses the most-recently-focused pane bound to
  that project (reusing F6's matcher discipline) or, if the project has no open pane, brings the
  app forward and opens the decision-queue drawer (F6) filtered to / scrolled to that project —
  the read-side handoff to where the human acts. No action is taken by the notification itself.

## Concerns (routing tags for review lenses)

- `ux` — notification copy, rate/dedupe feel (never spammy), click-to-focus landing, opt-in respect.
- `performance` — the observer runs on every aggregate push (every root re-read); transition
  detection must be O(diff) with bounded state, no leak of dedupe keys for vanished projects.
- `determinism` — transition detection deterministic (same push sequence → same notifications);
  dedupe-key lifecycle stable.
- `quality` — reuse 0004's notification + opt-in plumbing and F6's matcher; no forked "needs-you"
  logic (the aggregate already carries needsHuman).

## Open questions

- None blocking. The throttle threshold, digest copy, and exact click-to-focus fallback wiring are
  spec decisions. The per-project mute is explicitly deferred. (The spec's prose ESC-001 — the false
  D3 premise — was resolved by the coordinator amendment above; it is no longer open.)

## Gate

Recorded via `record --gate brainstorm` (delegated).
