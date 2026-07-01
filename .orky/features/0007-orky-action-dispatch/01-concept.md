# 0007 — Phase 1: Concept (brainstorm, autopilot)

**Status:** resolved by the AI orchestrator under the human's standing autopilot directive
("proceed with the rest on autopilot, use your recommendations at junctions" — 2026-07-01). No
genuinely blocking/irreversible ambiguity was found (see below for why), so no AskUserQuestion
round was used for this feature; decisions are grounded in explicit, already-established
repo-level constraints (`roadmap.md`'s hard constraints, `CLAUDE.md`, `run.md`'s ADR-004/ADR-022)
rather than a coin-flip.

## Decisions

- **D1 — F7 never drives the pipeline; it only submits human input through Orky's own CLIs.**
  Rationale: `roadmap.md`'s hard constraints are explicit and non-negotiable — "Termhalla is a thin
  client over Orky's stable contract... No Orky pipeline logic is duplicated here" and "Termhalla
  never decides a gate... the Gatekeeper re-derives from ground truth (ADR-004)." Spawning/driving
  phases would BE Orky pipeline logic, which is forbidden. The control-plane design already
  documented in `run.md` (ADR-022) exists precisely so a write action can be submitted
  asynchronously (`feedback emit`) and picked up by a SEPARATE, already-running `/orky:run` or
  `/orky:app-run` session's next `feedback apply` tick — Termhalla is the dashboard/submission
  surface, not the executor.
- **D2 — Exposed action surface for v1:** `resolveEscalation`, `submitWork`, `recordHumanGate`
  (gate name restricted server-side to `brainstorm`/`human-review`), `driveStatus` (read-only).
  Rationale: these four map 1:1 onto the roadmap's own phrase "submits human verdicts, decisions,
  or work" — a verdict is a human gate record, a decision is an escalation resolution, work is a
  new-work submission. Every other CLI command is either read-only (already covered by F5/F6) or
  pipeline-internal (`loopback`/`escalate`/`check`/`record-implementer` are called BY a running
  pipeline's own orchestrator loop, not BY a human clicking a button; `enable-feedback`/
  `disable-feedback` are one-time per-project configuration, arguably a Settings-panel concern for
  a later feature, not this dispatch substrate).
- **D3 — Server-side root allowlist**, enforced against F5's `OrkyRegistry.roots()`, never a
  renderer-trusted path. Rationale: this is the FIRST write-capable IPC surface in the app; every
  existing write-capable registrar (`register-registry.ts`'s `addRoot`/`removeRoot`,
  `register-env.ts`, etc.) already gates on `isKnownWindowSender`; this is the analogous
  root-scoped guard for an action that also names a target project.
- **`feedback.enabled` precondition:** each action's IPC result MUST distinguish "not enabled for
  this project" from "enabled but failed" (CONV-001 — specific, actionable errors), since a
  feedback-disabled project's `resolveEscalation` silently falls back to the direct
  `gatekeeper resolve-escalation` CLI path (per `run.md`'s own documented fallback) rather than
  failing outright — the caller needs to know WHICH path was actually taken for the audit trail to
  make sense later (F8's UI will want to show this).

## Concerns (routing tags)

- `security` — this is Termhalla's first write-capable, project-mutating IPC surface reachable
  from the renderer; sender validation (`isKnownWindowSender`), root allowlist (D3), and arg
  validation (CONV-001-style errors, no path traversal via a crafted `projectRoot`/`featureDir`)
  are all first-class concerns, not afterthoughts.
- `networking` — CLI subprocess invocation (execFile-style, per the existing cloud-probe pattern in
  `src/main/cloud/`) needs the same abortable/`unref()`'d discipline CLAUDE.md's gotchas document
  for long-lived children, plus a timeout (a hung `gatekeeper`/`feedback` CLI call must not hang the
  IPC round-trip or the Electron main process).
- `quality` — reuse the existing `execFile` + audit patterns already established (cloud probes,
  `register-registry.ts`'s IPC error shape) rather than inventing a new dispatch mechanism.
- `enterprise-arch` — audit: every action this substrate performs should be attributable (which
  window/action/project/args/result), since it's the first place Termhalla mutates a third-party
  project's state.

## Open questions

None blocking. Exact IPC channel names, the audit log's storage location/schema, and whether
`driveStatus` reuses F5's existing `OrkyPaneStatus`/registry types or needs a thinner read shape
are spec-writer decisions.

## Gate

Recorded via:
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" record --feature .orky/features/0007-orky-action-dispatch --gate brainstorm --verdict pass --evidence "Resolved by the AI orchestrator under the human's standing autopilot directive (2026-07-01): no blocking ambiguity found, design grounded in roadmap.md's explicit hard constraints (thin-client, ADR-004, ADR-022 control-plane) rather than a coin-flip. See 01-concept.md D1-D3."`
