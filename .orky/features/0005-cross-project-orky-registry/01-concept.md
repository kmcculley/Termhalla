# 0005 — Phase 1: Concept (brainstorm)

**Status:** human confirmed. Gate recorded.

## Decisions

- **D1 — IPC/data-only in F5; no UI.** F5 is a main-process registry service + one new push IPC
  channel exposing the cross-project aggregate. No renderer component renders it yet — F6 (decision
  -queue panel) is the first consumer. Rationale: matches the roadmap's explicit split between F5
  (data/registry) and F6 (UI); avoids building a throwaway/placeholder UI that F6 would replace.
- **D2 — Open-pane roots are ephemeral; the persisted explicit list is purely manual.** A `.orky/`
  root discovered by resolving a currently-open pane's cwd (reusing `findOrkyRoot`, same as 0004)
  contributes to the aggregate only while at least one pane is bound to that root. It is never
  auto-written into the persisted list. The persisted list holds only roots added via an explicit
  IPC call (`registry:addRoot` or similar — naming decided at spec time) — there is no UI gesture
  for that yet in F5; it's exposed for a later feature (F6+) to wire a human-facing "track this
  project" action onto. Rationale: "explicit list" should mean what it says — least-surprise; a
  project a user merely opened a terminal in once should not silently become permanently tracked.
- **D3 — Reuse `OrkyPaneStatus` per root.** The aggregate generalizes 0004's existing per-root
  status shape rather than inventing a new cross-project type: conceptually
  `{ root: string, status: OrkyPaneStatus }[]`, built by calling the SAME pure mappers in
  `src/shared/orky-status.ts` once per resolved root. Rationale: zero duplication of 0004's
  mapper/threshold/stall logic; F6's ranking (`selectChipFeature`-style ordering, per CLAUDE.md) can
  operate per-root using the exact same fields it already knows from 0004.

## Concerns (routing tags for review lenses)

- `security` — root-path validation (no path traversal via a maliciously-crafted persisted entry),
  read-path resource bounds reused from `orky-tracker.ts` (MAX_FEATURE_DIRS, MAX_FILE_BYTES,
  symlink guard) must apply per-root, not just to the first root.
- `performance` — N roots × the existing per-root chokidar-watcher-and-debounced-reread cost; must
  not regress 0004's single-root cost (one watcher per resolved root, shared across panes bound to
  it — same sharing discipline now also shared across the *registry's* membership, not just panes).
- `determinism` — aggregate ordering must be stable (e.g. sorted by root path) so consumers don't
  see spurious reordering on every re-read.
- `quality` — reuse over duplication (D3); don't fork `orky-status.ts`'s mappers per-root.
- `data-provenance` — n/a (no embedded reference data).

## Open questions

- None blocking. Exact IPC channel/method names, the persisted-list storage format (new file under
  `userData`, schema-versioned per `CLAUDE.md`'s "Persistence is versioned" convention vs. extending
  an existing store), and whether the aggregate push is the full set on every change vs. a diff are
  spec-writer decisions, not brainstorm-blocking ones.

## Gate

Recorded via:
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" record --feature .orky/features/0005-cross-project-orky-registry --gate brainstorm --verdict pass --evidence "human confirmed concept via /orky:app-run AskUserQuestion round (D1 IPC-only, D2 ephemeral open-pane roots, D3 reuse OrkyPaneStatus per root)"`
