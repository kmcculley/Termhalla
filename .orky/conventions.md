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
- **CONV-009** — A derived status label MUST NOT render a completeness word ("done"/"complete") unless
  the completeness signal it is actually derived from (e.g. gate fullness) holds — never as an
  incidental fallback for some other nullable field whose "null implies complete" assumption isn't
  enforced on that code path.
  *(from FINDING-DA-009 in 0014-orky-osc-heartbeat)*
- **CONV-010** — Every key used to identify the same filesystem path across data structures
  (a dedup/membership key, a status/cache key, a watcher/consumer id, etc.) MUST be derived from
  ONE shared `path.resolve()`-based normalizer; never mix a source-dependent raw string for one
  key with a `join()`/`dirname()`-normalized string for another, or two structures that should
  refer to the same physical directory can silently diverge.
  *(from FINDING-DA-001 in 0005-cross-project-orky-registry)*
- **CONV-011** — A per-key cache that mirrors a live membership set (a status-by-root cache,
  metrics-by-id map, etc.) MUST prune keys that leave the membership set (and clear fully on
  dispose), so it can neither grow unbounded for the life of the owning instance nor serve a
  stale value when a key later re-enters membership.
  *(from FINDING-DA-006 in 0005-cross-project-orky-registry)*
- **CONV-012** — A frozen/golden test (content-hash or structural) that pins the contract of a
  SHARED source file — one other features also legitimately modify — MUST be co-owned by (live in,
  or be updated atomically at merge by) whichever feature touches that file; parking a content-freeze
  test on a shared file inside one feature's own frozen suite has no atomic cross-feature update path
  and turns every legitimate refactor elsewhere into a false-positive loopback for an unrelated feature.
  *(from FINDING-DA-010 in 0014-orky-osc-heartbeat)*
- **CONV-013** — A result flag named for a completed effect (`dispatched`/`applied`/`resolved`)
  MUST NOT be set true for an action that was only durably QUEUED to an asynchronous transport
  whose application is deferred and conditional — distinguish "queued" from "applied" in the
  returned shape.
  *(from FINDING-DA-002 in 0007-orky-action-dispatch)*
- **CONV-014** — An abortable/`unref()`'d subprocess pattern proven safe for a READ-ONLY child
  MUST NOT be applied unchanged to a child that performs a non-atomic durable write; hard-aborting
  such a child on dispose/window-close can tear the write — let it finish (if already `unref()`'d
  and timeout-bounded) or make the write atomic before it may be aborted.
  *(from FINDING-NET-001 in 0007-orky-action-dispatch)*
- **CONV-015** — A timeout/abort result for a non-idempotent mutating operation MUST surface the
  outcome as INDETERMINATE (never a definite non-dispatch), so callers do not blindly retry a
  possibly-applied write.
  *(from FINDING-NET-002 in 0007-orky-action-dispatch)*
- **CONV-016** — An audit/attribution record for a durable mutation MUST capture a redaction-safe
  correlation identifier for the artifact it produced (a transport event id, a recorded
  timestamp/id) — not only the fact and coarse outcome of the attempt — so an audit entry can be
  reconciled against the mutated system's own state after the fact.
  *(from FINDING-ARCH-001 in 0007-orky-action-dispatch)*
- **CONV-017** — A best-effort audit/integrity log's write failures MUST be surfaced through an
  operator-observable signal (a metric/counter, a persisted log, or a one-time notification), never
  console-only, so silent loss of the audit trail is itself detectable.
  *(from FINDING-ARCH-002 in 0007-orky-action-dispatch)*
- **CONV-018** — An escalation decision that changes or disambiguates a REQ's required behavior
  MUST be propagated into the spec artifact (normative text + acceptance) in the same loopback
  that implements it; an arbitration recorded only in `state.json`/tests leaves the frozen spec
  contradicting the frozen tests.
  *(from FINDING-DA-004 in 0007-orky-action-dispatch)*

## Principles
Higher-level stances that inform specs and reviews but are too broad to gate mechanically.
- Prefer explicit, total functions over ones that depend on ambient state or throw on ordinary input.
- A requirement that cannot be made testable is not yet understood — escalate it, don't guess.
