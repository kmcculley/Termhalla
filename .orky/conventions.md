# Project conventions

Durable, project-wide rules every feature must honor — Orky's growing memory of what
"done right" means *here*. The **spec-writer** reads it (so specs encode these rules up
front), the **reviewer** reads it (so reviews flag violations), and **doc-sync** appends
to it when a review surfaces a lesson general enough to outlive its feature.

## How this file is maintained
- **Read** at spec time and review time. Treat each entry as a standing requirement /
  review-checklist item, not a suggestion.
- **Appended** only by doc-sync, and only when a finding reflects a *general* project rule
  (not a one-off bug). Give each a stable `CONV-NNN` id; never renumber, and don't delete —
  to retire a rule mark it `(retired: <reason>)`. The history is the point.
- Keep each entry to one crisp, checkable sentence.
- Cite the origin (`from FINDING-... in <feature>`) so the lesson is traceable.

## Conventions
- **CONV-001** — Every error surfaced to a user or caller MUST be specific and actionable
  (what failed, which input, how to fix); no bare `"invalid input"` / `"error"` strings. *(seed)*
- **CONV-002** — Every public function documents *and tests* its behavior on empty, boundary,
  and malformed input — the failure modes, not only the happy path. *(seed)*
- **CONV-003** — No silent truncation, rounding, or capping: if a limit is enforced, the spec
  states it and a test asserts it. *(seed)*
- **CONV-004** — A global notification/feedback-suppression preference MUST NOT suppress
  error/failure notifications; only informational/success notifications may be made opt-in.
  *(from FINDING-DA-001 in 0001-edit-menu-settings-toasts)*
- **CONV-005** — A native menu-item accelerator MUST be derived from (or kept in sync with) the
  user-customizable keybinding registry, never hard-coded to duplicate a rebindable command.
  *(from FINDING-UX-002 in 0001-edit-menu-settings-toasts)*
- **CONV-006** — A function MUST NOT expose two parameters that encode the same concept where one
  silently overrides the other; thread one canonical value instead of a primary+override pair.
  *(from FINDING-QOL-001 in 0002-pane-toolbar-split-control)*
- **CONV-007** — Any new chrome popover/menu portalled to `<body>` MUST carry visible paint-only
  focus and hover styling (or be added to the focus-visible/hover style allow-lists) so keyboard
  focus and hover are always visible outside the `.mosaic` subtree.
  *(from FINDING-UX-001 in 0002-pane-toolbar-split-control)*
- **CONV-008** — When retiring or changing a documented claim, `grep` the WHOLE `docs/` tree (plus
  `CLAUDE.md` and `.orky/baseline/`) for every phrasing of the old claim — never only the files a
  spec enumerated — so no stale copy is left to contradict the new behavior.
  *(from FINDING-DOC-001 in 0003-pane-minimize-restore)*
- **CONV-009** — Every key used to identify the same filesystem path across data structures
  (a dedup/membership key, a status/cache key, a watcher/consumer id, etc.) MUST be derived from
  ONE shared `path.resolve()`-based normalizer; never mix a source-dependent raw string for one
  key with a `join()`/`dirname()`-normalized string for another, or two structures that should
  refer to the same physical directory can silently diverge.
  *(from FINDING-DA-001 in 0005-cross-project-orky-registry)*
- **CONV-010** — A per-key cache that mirrors a live membership set (a status-by-root cache,
  metrics-by-id map, etc.) MUST prune keys that leave the membership set (and clear fully on
  dispose), so it can neither grow unbounded for the life of the owning instance nor serve a
  stale value when a key later re-enters membership.
  *(from FINDING-DA-006 in 0005-cross-project-orky-registry)*

## Principles
Higher-level stances that inform specs and reviews but are too broad to gate mechanically.
- Prefer explicit, total functions over ones that depend on ambient state or throw on ordinary input.
- A requirement that cannot be made testable is not yet understood — escalate it, don't guess.
