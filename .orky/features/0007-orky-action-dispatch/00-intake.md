# 0007 — Orky action-dispatch substrate (first write capability)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete (autopilot; see `01-concept.md`).

**Source:** `.orky/roadmap.json` / `roadmap.md`, feature `F7`, scaffolded by `/orky:app-run`
(autopilot mode — the human authorized the AI orchestrator to resolve non-blocking design
ambiguities directly rather than pausing for each one, reserving human check-ins for genuinely
blocking/irreversible decisions).

### Roadmap entry (verbatim)

> **Title:** Orky action-dispatch substrate (first write capability)
>
> **Summary:** A privileged main-process layer that invokes Orky's feedback CLI (emit/pull/ack,
> file mode) and Gatekeeper CLI (record/resolve-escalation/drive) safely — request/response IPC,
> project-root allowlist (from F5), the feedback.enabled precondition, arg validation, exit-code/JSON
> result mapping, audit. Never decides a gate; only submits human verdicts/decisions/work.
>
> **Deps:** F5 (project-root allowlist source).

### Role in the app

Tier **T2** (first write capability). Every read feature so far (0004, F5, F14) is strictly
read-only. F7 is the FIRST feature that lets Termhalla write anything into an Orky-adopted
project — but only ever a **human verdict, decision, or work item**, submitted through Orky's own
existing CLIs (never a direct file write under `.orky/`, never a gate decision computed by
Termhalla itself — ADR-004). F6 (already shipped, read-only queue) and F9/F10 (native pane)
consume F7's dispatch capability for their own write actions (F8's one-click answer/resume, F10's
inline pane actions, F12's quick-capture).

### Existing plumbing to build on (read first)

- `src/main/orky/orky-registry.ts` — `OrkyRegistry.roots()` returns the current persisted +
  pane-derived root list (F5). F7's **project-root allowlist** (the roadmap's own words) is this
  list: an IPC-submitted action is only ever executed against a root Termhalla itself already
  knows about, never an arbitrary caller-supplied path.
- The Gatekeeper CLI surface (`node "C:/dev/Orky/plugin/gatekeeper/cli.js" --help`): `record`,
  `resolve-escalation`, `drive`, `can-advance`, `liveness` are candidates; `loopback`, `escalate`,
  `check`, `record-implementer`, `enable-feedback`/`disable-feedback` are **pipeline-internal** —
  NOT exposed to a GUI button (see brainstorm decision D2).
- The Feedback CLI surface (`node "C:/dev/Orky/plugin/feedback/cli.js" --help`): `emit`, `pull`,
  `ack`, `digest`, `residual`, `status`. `emit` is how a human decision/work-item enters the async
  control plane (ADR-022) for a live `/orky:run`/`/orky:app-run` session to pick up on its next
  `feedback apply` tick — Termhalla does NOT itself drive the pipeline (see D1).
- `.orky/config.json`'s `feedback.enabled` flag — the precondition the roadmap calls out. When
  `false` for a project, `feedback emit` is a documented no-op (per `run.md`); F7 must not present
  it as if it worked, and must fall back to (or clearly gate on) the direct
  `gatekeeper resolve-escalation` path where that's the documented fallback.

### Brainstorm decisions (binding — see `01-concept.md`)

- **D1 — F7 never drives the pipeline.** It only submits human input through Orky's existing CLIs
  (`feedback emit`, `gatekeeper resolve-escalation`, `gatekeeper record` for the two human gates
  only). It never spawns a Claude/Orky agent, never calls `loopback`/`escalate`/`check`/
  `record-implementer`. This is the load-bearing interpretation of "never decides a gate; only
  submits human verdicts/decisions/work" — actually driving phases is Orky-pipeline logic, which
  the roadmap's hard constraints forbid duplicating here.
- **D2 — Exposed action surface (v1):** `resolveEscalation` (→ `feedback emit` type=decision when
  `feedback.enabled`, else `gatekeeper resolve-escalation` direct), `submitWork` (→ `feedback emit`
  type=work.request — the substrate F12 will build its quick-capture UI on), `recordHumanGate` (→
  `gatekeeper record`, gate name restricted to `brainstorm`/`human-review` only — enforced
  server-side, not just by UI omission), and a read-only `driveStatus` (→ `gatekeeper drive`, for
  a caller to know what a feature needs before submitting anything). Everything else stays
  CLI-only.
- **D3 — Root allowlist enforcement.** Every action's `projectRoot` argument is checked against
  `OrkyRegistry.roots()` (F5) server-side (main process), rejecting any root Termhalla hasn't
  itself discovered — never trust a renderer-supplied path.

### Out of scope for F7

- Any renderer UI (buttons, forms) — this is the IPC substrate only; F8/F10/F12 build the actual
  human-facing gestures on top of it.
- Driving/resuming a pipeline (spawning agents, running phases) — explicitly out of scope, D1.
- `loopback`, `escalate`, `check`, `record-implementer`, `enable-feedback`/`disable-feedback` — CLI
  operations that stay CLI-only (pipeline-internal / one-time project setup, not a repeated human
  gesture from a GUI).
