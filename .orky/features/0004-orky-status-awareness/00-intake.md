# 0004 — Orky status awareness in the pane chrome (Tier 0 MVP)

## Phase 0 — Intake

**Status:** intake captured — awaiting brainstorm (phase 1, human-led).

**Depends on:** 0003 (shipped v0.7.0) — reuses `src/shared/chip-status.ts` + the minimized-tray
status chips it introduced.

### Raw idea (verbatim)

> Orky status awareness in the pane chrome — surface a `.orky` run's phase/gate/needs-you on the
> existing toolbar chip, border states, and tab badge.

### Full intake (verbatim, from `.orky/0004-intake-draft.md`)

#### Problem
Kevin runs Orky pipelines inside Termhalla terminals. Today Termhalla detects a Claude session
(✨ chip + context-window %) and OSC-133 gives it busy/idle/needs-input — but it's *guessing from
bytes* and can't tell *why* Claude is waiting. When the reason is "an Orky pipeline hit a gate /
opened an escalation / stalled / finished," Termhalla shows only a vague "✨ waiting." Across many
panes and projects you can't tell which run needs you.

#### Capability (Tier 0 — read-only status mirror)
A pane whose cwd contains `.orky/` IS an Orky run. Surface that run's real pipeline state on
Termhalla's existing chrome — no new windows:
- **Pane-toolbar Orky chip:** `feature · phase · gate N/M · ●k open`, with a detail popover.
- **Pane border / status:** running a phase → Busy; at a gate / open escalation / stalled →
  NeedsInput; feature done → Idle; gate failed → the `lastExit: failure` styling.
- **Tab badge:** lights when any feature in that workspace needs a human.
Outcome: "a wall of terminals tells you which Orky run needs you" — Termhalla's thesis, applied to pipelines.

#### Ground truth (read-only; ZERO Orky-side changes)
Orky already writes everything on disk; the tracker only reads:
- `<cwd>/.orky/active.json` — `{feature, phase, lastTickAt, lastAction}` (heartbeat).
- `<cwd>/.orky/features/<slug>/state.json` — `{phase, gates:{phase:{passed,at}}, iterations, escalations, concerns}`.
- `<cwd>/.orky/features/<slug>/findings.json` — `[{severity, status, ...}]` → open-blocking count.
- **Stall** = `now − lastTickAt > threshold` (mirrors `gatekeeper liveness`).
- Schema-of-record: gatekeeper `liveness`/`drive` + `feedback digest`. Prefer reading the files to
  spawning `node` per poll; the CLIs just define the shapes.

#### Integration points (real files — clone the proven UsageTracker pattern)
- `src/main/usage/` (UsageTracker watches `~/.claude/projects/<cwd>/*.jsonl`)
   → NEW `src/main/orky/orky-tracker.ts` watching `<cwd>/.orky/` via chokidar (debounced; reuse the
   UsageTracker session-identity race pattern — claim slot before await, re-check after).
- `src/shared/ipc-contract.ts` — add `orky:status` push channel; types in `src/shared/types.ts`.
- `src/main/ipc/register-*.ts` — register the tracker; emit `orky:status` via `safeSend`.
- `src/renderer/App.tsx` — subscribe `onOrkyStatus` → store.
- `src/renderer/store/runtime-slice.ts` — hold per-pane Orky status.
- `src/shared/chip-status.ts` (from 0003) — extend the status model with an Orky variant; reuse for
  the toolbar chip AND the minimized-tray chip.
- `src/renderer/components/PaneToolbar.tsx` — render the Orky chip + popover (mirror the git/process chip).
- Tab badge — reuse the existing needs-input badge path.
- **Auto-bind:** pane cwd is already tracked (OSC 7 / OSC 9;9); detect `.orky/` to switch the chip on.
  No manual linking, no per-workspace config.

#### Pure logic to unit-test (vitest, TDD — matches the status-state-machine tests)
- `.orky` state → `OrkyPaneStatus` mapper: (phase, gates, findings, stale) → `{kind, label, needsHuman, detail}`.
- Stale detection (idleSeconds vs threshold).
- Open-blocking-findings count (severity ≥ threshold AND status === "open").
- Per-workspace roll-up (which feature needs a human → drives the tab badge).

#### Out of scope (later tiers — do NOT pull in)
Cross-project decision queue (T1); one-click answer/resume/inject (T2); native OrkyPane + workspace
template (T3); quick-capture inbox + OS-notification + OSC-heartbeat markers (T4). Tier 0 is read-only
status on existing chrome.

#### Definition of done
- OrkyTracker + IPC + toolbar chip + tab badge; auto-binds on a `.orky/` cwd; updates live as the
  pipeline ticks; clears cleanly when the run finishes / the pane's cwd changes.
- Unit tests green for the pure mappers; **no Orky-side changes.**
- Verified by pointing a Termhalla pane at a real Orky run (the Orky repo, or Termhalla building its
  own next feature) and watching phase / needs-you reflect reality.

#### Notes for brainstorm
- This is the dogfood loop: the first thing 0004 renders is the very status it exists to surface.
- Likely concern tags: `ux`, `quality`, `performance` (watcher/debounce cost), `doc-drift`.
- Single `/orky:run` builds on `main` (no worktree) — fine now that the tree is clean.

### Inferred concern tags (to be confirmed in the spec — NOT committed yet)

Routes reviewer lenses later; per ADR these belong in the spec phase, not intake:

- **`ux`** — new chip/border/badge states must read clearly across a wall of panes and not collide
  with the existing ✨/git/process chips.
- **`quality`** — clean teardown when a run finishes or the pane's cwd leaves `.orky/`; the
  keep-mounted / session-identity invariants.
- **`performance`** — chokidar watcher + debounce cost per Orky pane; avoid per-poll `node` spawns.
- **`determinism`** — pure `(phase, gates, findings, stale) → OrkyPaneStatus` mapper must be a
  total, side-effect-free function (the TDD target).
- **`doc-drift`** — new IPC channel + state types + feature docs must stay reconciled.
