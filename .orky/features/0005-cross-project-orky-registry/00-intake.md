# 0005 — Cross-project Orky registry + multi-root aggregation

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json` / `roadmap.md`, feature `F5`, scaffolded by `/orky:app-run`
(not hand-brainstormed from a raw human idea — the roadmap entry below is the agreed starting
point; brainstorm narrowed its genuine ambiguities).

### Roadmap entry (verbatim)

> **Title:** Cross-project Orky registry + multi-root aggregation
>
> **Summary:** Track every project with an `.orky/` dir (open panes' resolved roots + a persisted
> explicit list) and roll their status up into one cross-project, pane-independent aggregate over a
> new IPC channel — generalizing 0004's single-root OrkyTracker to a set of roots.
>
> **Deps:** none (foundational — unblocks F6, F7, F9, F13).

### Role in the app

This is tier **T1** (cross-project decision queue, read half) of the Termhalla × Orky integration
roadmap (T1–T4). T0 (`0004-orky-status-awareness`, shipped v0.8.0) gave Termhalla a *single-root*,
*pane-scoped* read-only mirror of one project's `.orky/` state, rendered on that pane's own chrome.
F5 generalizes that to **N roots, pane-independent** — the data substrate every later cross-project
feature builds on:
- F6 (decision-queue panel) renders this aggregate as a queue.
- F7 (action-dispatch) uses F5's root list as its write-target allowlist.
- F9 (native OrkyPane) and F13 (OS notifications) both consume the cross-project aggregate.

F5 itself ships **no renderer UI** (see `01-concept.md` decision D1) — it is the main-process
registry + a new push IPC channel only. A human cannot yet *see* this in the app; F6 is the first
consumer.

### Tech stack (per `CLAUDE.md`)

Electron + TypeScript. Three sandboxed layers: main (`src/main/`, all privilege — fs, watchers),
renderer (`src/renderer/`, React + zustand, never touches Node), preload (`src/preload/`, the only
bridge via `contextBridge`). IPC contract: `src/shared/ipc-contract.ts` (channel names + the
`TermhallaApi` interface) → implement in a per-domain registrar under `src/main/ipc/` → consume via
`src/renderer/api.ts`. Pure logic in `src/shared/` or beside the main service, unit-tested with
vitest (`tests/`); UI/IPC integration via Playwright e2e (`tests/e2e/`, launches the real app).
TDD — failing test first.

### Existing plumbing to generalize, not duplicate (read first)

- `src/main/orky/orky-tracker.ts` — `OrkyTracker`: per-pane `watch(id, cwd)` / `unwatch(id)`,
  resolves `.orky/` root via `findOrkyRoot` (bounded upward walk), shares ONE chokidar watcher +
  debounced re-read per resolved root across every pane bound to it (REQ-027), emits a rolled-up
  `OrkyPaneStatus` per pane. Session-identity race pattern: claim the slot before the first
  `await`, re-check `sessions.get(id) !== sess` after every await.
- `src/shared/orky-status.ts` — pure mappers: `normalizeFeatureRaw`, `normalizeFindings`,
  `orkyFeatureStatus`, `orkyPaneStatus`, `parseOrkyTimestamp`, `STALL_THRESHOLD_MS`. These already
  turn `{active.json, features/*/state.json, features/*/findings.json}` into an `OrkyPaneStatus`
  for ONE root — reuse verbatim per root (brainstorm decision D3).
- `src/shared/types.ts` — `OrkyPaneStatus`, `OrkyFeatureStatus`, `OrkyPhase`.
- `src/shared/ipc-contract.ts` — existing pane-scoped channels: `orky:watch` / `orky:unwatch`
  (renderer→main) and `orky:status` (main→renderer push, pane-scoped, `null` = cleared).
- `findOrkyRoot` (`src/main/orky/find-orky-root.ts`) — bounded upward walk from a cwd to the
  nearest ancestor containing `.orky/`. F5 reuses this for resolving "open panes' resolved roots."

### Brainstorm decisions (binding — see `01-concept.md` for full rationale)

- **D1 — No UI in F5.** IPC/data-only: a new main-process registry + a new push channel. F6 is the
  first feature to render it.
- **D2 — Ephemeral open-pane roots.** A root discovered via a currently-open pane is counted in the
  aggregate only while a matching pane is open; it is NOT auto-written into the persisted explicit
  list. The persisted list holds only roots a human deliberately added (via IPC, since F5 has no
  UI — a later feature/F6 is expected to add the human-facing "add a project" gesture).
- **D3 — Reuse `OrkyPaneStatus` per root**, keyed by resolved root path, instead of inventing a new
  cross-project status shape. The aggregate is effectively `{root, status: OrkyPaneStatus}[]` (or
  equivalent), sharing 0004's mappers untouched.

### Out of scope for F5

- Any renderer UI (queue panel, settings list, badges) — F6 and later.
- Any write/action capability (answering escalations, resuming, injecting work) — F7+.
- Filesystem scanning beyond open-pane roots + the persisted explicit list (e.g. auto-discovering
  every git repo under a configured folder) — not requested by the roadmap entry.
