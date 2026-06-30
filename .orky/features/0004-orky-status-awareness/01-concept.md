# 0004 — Orky status awareness in the pane chrome

## Phase 1 — Concept (brainstorm outcome)

**Status:** awaiting human confirmation of this concept → then `brainstorm` gate.

Tier 0 = a **read-only status mirror**. A pane whose cwd contains `.orky/` is an Orky project; the
tracker reads Orky's on-disk state and surfaces the pipeline's real phase / gate progress /
needs-you on Termhalla's existing chrome (toolbar chip + popover, pane border, tab badge). **Zero
Orky-side changes.** Later tiers (decision queue, one-click answer/resume, native OrkyPane,
notifications) are explicitly out of scope.

### Ground truth confirmed against the real repo (not assumed)

- `<cwd>/.orky/active.json` = **project-level** heartbeat: `{feature: "<path>", projectRoot, phase,
  lastTickAt, lastAction}`. Names the single currently-/last-active feature. **One `lastTickAt` per
  project** — the only live heartbeat.
- `<cwd>/.orky/features/<slug>/state.json` = `{feature, phase, gates:{<phase>:{passed,at,tokens?}},
  iterations, escalations:[{id,phase,reason,status,…}], concerns, loopbacks, attempts}`.
- `<cwd>/.orky/features/<slug>/findings.json` = `[{id,lens,severity,status,contract_violation,…}]`.
  `severity ∈ {CRITICAL,HIGH,MEDIUM,LOW}`, `status ∈ {open,resolved,deferred}`.
- **Phase order** (for `gate N/M`): `brainstorm → spec → plan → tests → implement → review →
  doc-sync → human-review` (derived from observed `gates` keys; canonicalize in the spec).
- Project autonomy here is **`full-auto`** (`config.json`) → gates pass autonomously, so a generic
  "at a gate" stop is NOT a human summons.

### Decisions (settled in brainstorm)

1. **Track scope = full roll-up of all features.** The tracker watches every `<cwd>/.orky/features/*/`
   dir (plus `active.json`), not just the active feature. *Why:* a project can have a finished
   feature still carrying an open escalation, or a non-active feature needing you — a wall-of-panes
   glance must catch any of them. **Sub-decisions (resolved below):** how the singular chip picks
   *one* feature, and that stall is active-feature-only.

2. **Orky drives the pane border + tab badge** (not a standalone chip). *Why:* matches the product
   thesis — "a wall of terminals tells you which run needs you." When a pane is an Orky run, the
   Orky-derived status maps into the existing `TerminalStatus` enum (busy/idle/needs-input + the
   `lastExit: failure` styling) and **takes precedence over the byte-derived (OSC-133) status** for
   the border (`data-status` on `.term-tile`) and the tab badge (`tab-badge.ts`). The existing ✨ AI
   chip + context-% stays — it's complementary, not replaced. The toolbar gets the *informational*
   Orky chip (`feature · phase · gate N/M · ●k open`) + detail popover on top of that.

3. **"Needs a human" = `human-review` phase OR an open escalation OR stalled.** Explicitly **NOT**
   every gate boundary (full-auto auto-passes gates; that would over-trigger). A halted gate
   *failure* surfaces via the `lastExit: failure` styling (separate visual, not folded into
   needs-human). These three conditions drive border→needs-input and the tab badge 🔔.

4. **Stall = stale heartbeat, but *finished wins*, threshold 120s.** A finished/idle run
   (`human-review` passed, or no active executing phase) reads **Done/Idle and is NEVER stalled**.
   Stall applies **only mid-execution** and **only to the active feature** (the one with the live
   `active.json.lastTickAt` — it's the sole heartbeat). `now − lastTickAt > 120s` while an executing
   phase is in flight → needs-input (stalled). Non-active features can't stall (no per-feature
   heartbeat) — they read their last-known gate state.

### Sub-decisions derived from the above (resolved, for the spec to formalize)

- **Singular chip from a roll-up.** The chip shows the **most-needs-you** feature, chosen by a *pure,
  deterministic* selector: rank features by `needsHuman` first, then by a stable order (escalation >
  stalled > human-review), then by most-recent activity, then by feature id as a final tiebreak.
  The popover lists all features with non-Idle status.
- **Tab-badge roll-up.** The workspace tab lights 🔔 if **any** feature in **any** Orky pane in that
  workspace is `needsHuman` — reuse the existing `tab-badge.ts` aggregation path, contributing an
  Orky needs-input the same way a terminal needs-input does (and gated by the same
  `resolveAlerts(cfg.alerts).tabBadge` opt-in).
- **Auto-bind / teardown.** Pane cwd is already tracked (OSC 7 / OSC 9;9). On cwd entering a dir with
  `.orky/`, start the watcher; on cwd leaving it (or run finishing), the tracker emits a cleared
  status and the chip/border revert to pure byte-status. Clean teardown is a `quality` obligation.

### Pure logic (TDD targets — vitest, no Electron)

- `orkyPaneStatus(features, activeHeartbeat, now) → OrkyPaneStatus{kind,label,needsHuman,detail}` —
  the total, side-effect-free mapper (the `determinism` lens's anchor).
- `isStalled(activeFeature, lastTickAt, now, threshold)` with the finished-wins precedence.
- `openBlockingCount(findings)` = `status==='open' && (severity∈{CRITICAL,HIGH} || contract_violation)`.
- `selectChipFeature(features)` — the deterministic most-needs-you selector.
- `orkyBadgeRollup(panesStatuses)` — which workspace tabs light.

### Architecture (clone the proven UsageTracker pattern)

`src/main/orky/orky-tracker.ts` watches `<cwd>/.orky/` via chokidar (debounced; reuse the
session-identity race pattern — claim the map slot before `await`, re-check after). Emits an
`orky:status` push over IPC (new channel in `ipc-contract.ts`, types in `types.ts`, registered in a
`register-*.ts` via `safeSend`). `App.tsx` subscribes `onOrkyStatus` → `runtime-slice.ts` holds
per-pane Orky status. `chip-status.ts` (from 0003) is extended with the Orky variant, reused for the
toolbar chip and the minimized-tray chip. `PaneToolbar.tsx` renders the chip + popover (mirroring the
git/process chip). Prefer reading the files to spawning `node` per poll (`performance` lens).

### Concerns (routing tags for the review lenses)

- **`ux`** — chip/border/badge legibility across a wall of panes; not colliding with the ✨/git/process
  chips; the precedence of Orky-status over byte-status reading clearly.
- **`quality`** — clean teardown on run-finish / cwd-leaving-`.orky/`; keep-mounted + session-identity
  invariants; the roll-up not leaking watchers per feature.
- **`performance`** — chokidar watcher + debounce cost across *all* features per pane (roll-up
  amplifies this); no per-poll `node` spawns; debounce coalescing.
- **`determinism`** — `orkyPaneStatus` + `selectChipFeature` must be total, pure, tie-broken stably.
- **`doc-drift`** — new `orky:status` channel, new state types, and the feature doc kept reconciled.

### Open questions

- **[resolved]** Track scope → full roll-up of all features (Decision 1).
- **[resolved]** Orky vs byte-derived chrome → Orky drives border + badge with precedence (Decision 2).
- **[resolved]** Needs-human set → human-review ∨ open-escalation ∨ stalled; not generic gates (Decision 3).
- **[resolved]** Stall semantics → finished-wins, active-feature-only, 120s (Decision 4).
- **[resolved]** Singular chip from a roll-up → deterministic most-needs-you selector (sub-decisions).
- **[deferred → spec]** Exact canonical phase list for `gate N/M` (and whether `human-review` counts
  toward M) — formalize from Orky's gatekeeper definition during the spec.
- **[deferred → spec]** Verification mechanism for the DoD: an e2e that fixtures a synthetic `.orky/`
  tree and asserts the chip/border/badge, vs. a manual "point at a live run" check. Decide in tests.
- **[deferred → spec]** Watcher cost ceiling: whether a single watch on `<cwd>/.orky/` (recursive,
  debounced) suffices vs. per-feature watches — a `performance` design call for the plan.

**No blocking open questions remain.**
