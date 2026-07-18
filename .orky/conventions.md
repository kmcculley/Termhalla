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
- **CONV-019** — A frozen scope-guard test asserting the ABSENCE of a future consumer ("no X
  consumes Y yet") MUST name the feature expected to retire it, and that consumer feature's spec
  MUST retire/supersede the guard atomically in the same change, at the tests phase, never
  silently during implementation.
  *(from FINDING-001 in 0006-decision-queue-panel)*
- **CONV-020** — A non-modal drawer/panel opened via a keyboard command (chord or palette entry)
  MUST move focus into the opened surface on open, and on close MUST restore focus to its toggle
  ONLY IF focus is still inside the panel at close time — never unconditionally, and never
  yanking focus from a surface the user (or the panel's own gesture) intentionally focused while
  the panel stayed open.
  *(from FINDING-010 / FINDING-023 in 0006-decision-queue-panel)*
- **CONV-021** — Store state that a component reads ONLY inside an event handler (never to affect
  rendered output) MUST be read via `getState()` at event time, never subscribed with a render
  hook.
  *(from FINDING-012 in 0006-decision-queue-panel)*
- **CONV-022** — A frozen test asserting the CURRENT VALUE of a shared, legitimately-evolving
  global (a schema-version constant, a closed type-union shape) as a proxy for "my feature didn't
  change it" MUST instead pin an invariant scoped to its own feature (or name the sanctioned
  amendment path in its header), so a later feature's legitimate change doesn't false-positive
  several unrelated frozen suites at once.
  *(from the REQ-003 six-guard collision in 0009-native-orky-pane)*
- **CONV-023** — A spec claim of an exhaustive enumeration of colliding frozen tests ("full list",
  "grep verified") MUST state the exact grep pattern and scope used, and the pattern MUST target
  the pinned literal value repo-wide — never a sweep of already-known files.
  *(from FINDING-001 in 0009-native-orky-pane)*
- **CONV-024** — A detail/summary view whose refresh triggers key on changes to a LOSSY roll-up
  MUST have an independent currency mechanism (or an explicit staleness contract) for the data the
  roll-up omits — a summary-keyed trigger can only refresh what the summary can see.
  *(from FINDING-003 in 0009-native-orky-pane)*
- **CONV-025** — An enforced cap/truncation over a filesystem (or other unordered) enumeration MUST
  be applied to a deterministically-ordered list, never to raw enumeration order, so which items
  survive the cap is a pure function of the underlying state.
  *(from FINDING-006 in 0009-native-orky-pane)*
- **CONV-026** — A load-time coercion that guarantees "downstream code never sees X" MUST be
  applied at EVERY deserialization/instantiation path of that persisted shape (the primary loader,
  templates, imports/duplications), or the guarantee must explicitly name the paths it covers.
  *(from FINDING-032 in 0009-native-orky-pane)*
- **CONV-027** — An on-disk test fixture MUST NOT rely on case-only-distinct paths (they collapse
  to one file on a case-insensitive filesystem); any case-sensitivity property must be exercised
  through a pure in-memory seam instead.
  *(from the FINDING-010 loopback in 0009-native-orky-pane)*
- **CONV-028** — A keep-mounted-but-hidden host added anywhere in the renderer (minimized,
  inactive-workspace, maximize-over, or any future overlay host) MUST thread its hiding into every
  pane-kind runtime gate that keys on effective visibility, and that gate's tests MUST enumerate
  every such host — not only the ones that existed when the gate was written.
  *(from FINDING-013 / FINDING-035 in 0009-native-orky-pane)*
- **CONV-029** — A component consuming a theme/status CSS variable MUST reference a variable name
  actually defined by the theme system or a `:root` rule, using that token's standard fallback — a
  `var()` with an undefined name plus a novel fallback literal is a hard-coded color a
  hex-in-fallback source scan cannot catch.
  *(from FINDING-025 in 0009-native-orky-pane)*
- **CONV-030** — A container-level key handler that intercepts activation keys (Enter/Space) MUST
  target-guard so a nested native control's own activation is never suppressed or redirected —
  Enter on a focused button must activate that button.
  *(from FINDING-023 in 0009-native-orky-pane)*
- **CONV-031** — A pinned trigger/count discipline whose boundary is a component lifecycle
  transition (mount/unmount, hidden→displayed) MUST be tested through the real component
  lifecycle, not only through the store/slice seam beneath it — a slice-level spy cannot see
  fetches a component's own mount effects add.
  *(from FINDING-020 in 0009-native-orky-pane)*
- **CONV-032** — A frozen structural test that locates a code site via a whole-file `.indexOf()` (or
  other unanchored) string search MUST anchor the search — a scoped substring, a preceding/following
  marker, or a bounded regex — rather than a bare literal that can collide with unrelated
  occurrences elsewhere in the same file; if an unrelated edit is reshaped purely to dodge such a
  collision, the reshaped site MUST carry an in-code comment naming the test and the collision so a
  future revert doesn't silently reintroduce it.
  *(from FINDING-021 in 0012-quick-capture-inbox)*
- **CONV-033** — An acceptance vector claiming to exercise React StrictMode's dev-only double
  mount/effect invocation MUST name a harness that actually runs React's DEVELOPMENT build; a
  production-build e2e (or a `node`-env unit harness that cannot mount a component at all) never
  exercises StrictMode semantics and must not be cited as doing so — the sanctioned substitute is a
  structural pin on the property that makes the double-invocation class impossible (e.g. the
  mutating call site living in an event handler, never inside a `useEffect` body).
  *(from FINDING-018 in 0012-quick-capture-inbox)*
- **CONV-034** — When a surface owning a non-idempotent in-flight write is dismissed before the
  write settles, the outcome MUST still be reported through a component-independent, never-silently
  -dropped signal (e.g. a store-level toast chokepoint) — and that detached report MUST carry the
  SAME honesty class as the in-flight/rendered path would have (indeterminate wording for an
  indeterminate outcome such as a timeout or a transport failure whose write may still land; a
  uniform "definite failure" message for every kind is itself a false claim that invites a
  duplicating retry).
  *(from FINDING-013 and its FINDING-024 refinement in 0012-quick-capture-inbox)*
- **CONV-035** — A dialog rendered with `aria-modal="true"` MUST contain Tab focus within the
  dialog (via the shared modal substrate, never a per-dialog copy), so the accessibility claim and
  the keyboard reality agree; where containment isn't yet implemented at the shared seam, the gap
  MUST be tracked as a named, shared-seam finding rather than re-discovered independently by each
  consuming dialog.
  *(from FINDING-016 in 0012-quick-capture-inbox)*
- **CONV-036** — A coalescing/debounce buffer (or any window/rate-limit mechanism) whose spec
  promises a flush at a wall-clock deadline MUST be driven by an actually-scheduled timer (armed at
  window/period open, cleared on close/dispose), never only lazily re-checked on the next inbound
  event — a pure lazy-on-next-event module strands its pending output whenever the input stream goes
  quiet, exactly the case the mechanism exists to guarantee against. Where the pure module itself
  stays timer-free for testability, its composition root MUST inject the real scheduler.
  *(from FINDING-005 in 0013-os-needs-you-notifications, independently confirmed by five review
  lenses and originally proposed by FINDING-008/FINDING-013)*
- **CONV-037** — A directory-scoped absence/scope-guard source scan (a frozen test asserting "no
  file under X imports/mentions Y yet") MUST key its regex on the feature-specific SURFACE
  (component name, handler, exported symbol unique to the guarded feature) — never on a shared
  module name or import path — so a later feature that legitimately imports that shared module into
  the scanned directory does not false-trip the guard.
  *(from FINDING-001 in 0013-os-needs-you-notifications)*
- **CONV-038** — Two independent notification/alert paths that can both fire for the same underlying
  user-attention event MUST have a stated coexistence or dedupe policy (accept the duplication
  explicitly, or suppress one path when the other already surfaced the moment) — a single moment
  emitting duplicate, uncoordinated OS-level toasts is a defect even when each path is individually
  correct.
  *(from FINDING-011 in 0013-os-needs-you-notifications)*
- **CONV-039** — A composite dedup/identity key built by joining filesystem- or user-derived string
  fields MUST use a separator (or structural encoding, e.g. `JSON.stringify` of the tuple) that
  provably cannot occur inside any field — never a printable or whitespace character an OS permits
  inside a path or name — so two distinct tuples can never collide into the same key.
  *(from FINDING-014 in 0013-os-needs-you-notifications)*
- **CONV-040** — A paired arm/cancel (or acquire/release) lifecycle dependency injected into a class
  or module MUST be a single all-or-nothing unit (one object, or a both-or-neither constructor
  check) — never two independently-optional fields — so a half-supplied pair that would leak or
  misfire the underlying resource cannot type-check.
  *(from FINDING-016 in 0013-os-needs-you-notifications)*
- **CONV-041** — A container-level pointer-activation (click) handler MUST be target-guarded, or
  nested interactive controls MUST stop propagation, so a nested control's activation never also
  fires the container's own gesture — the pointer twin of CONV-030.
  *(from FINDING-001 in 0008-queue-answer-resume-actions)*
- **CONV-042** — An inline form region revealed by an explicit open gesture MUST move keyboard focus
  into its first interactive field on open — the inline-form twin of CONV-020's drawer open-focus
  rule.
  *(from FINDING-016 in 0008-queue-answer-resume-actions)*
- **CONV-043** — A single-line inline text input paired with exactly ONE submit control MUST
  dispatch that submit on Enter (respecting the submit's disabled conditions), never requiring
  pointer or Tab traversal to complete the flow.
  *(from FINDING-017 in 0008-queue-answer-resume-actions)*
- **CONV-044** — After a non-idempotent submit succeeds, the submitting affordance MUST be disarmed
  (input cleared, form closed, or submit disabled) until the user re-arms it — a still-armed form
  holding the same payload is a duplicate-write invite.
  *(from FINDING-020 in 0008-queue-answer-resume-actions)*
- **CONV-045** — A client-side pre-write verification guarding a write that has no server-side
  compare-and-set MUST either be enforced inside the write's own serialized critical section or the
  spec MUST explicitly disclose the residual verify-to-write race window.
  *(from FINDING-021 in 0008-queue-answer-resume-actions)*
- **CONV-046** — A focus-on-mount substrate may only be mounted by an explicit user open gesture — a
  data-driven remount or surface swap MUST NOT move keyboard focus.
  *(from FINDING-022 in 0008-queue-answer-resume-actions)*
- **CONV-047** — A narrow-layout acceptance for a control region inside a user-resizable tile MUST
  assert clipping against the TILE's own bounding box at a genuinely narrow tile width — never
  against `window.innerWidth` — because Playwright's visibility/boundingBox checks ignore ancestor
  overflow clipping and will pass even when a control is clipped by its tile.
  *(from FINDING-007 in 0010-orky-pane-inline-actions)*
- **CONV-048** — A data-driven disarm/close that discards user-typed input MUST surface a
  user-visible notice through a never-silently-dropped signal (the toast chokepoint, never a new
  silent-drop path) and MUST NOT strand keyboard focus on `<body>`.
  *(from FINDING-009 in 0010-orky-pane-inline-actions)*
- **CONV-049** — A findings-ledger status/resolution edit MUST stamp its timestamp fields from the
  real clock at edit time — never a hand-typed or estimated instant — so the audit trail records no
  event that never happened.
  *(from FINDING-013 in 0010-orky-pane-inline-actions)*
- **CONV-050** — No tracked path may use a Windows-reserved device name (`NUL`, `CON`, `PRN`, `AUX`,
  `COM1`-`COM9`, `LPT1`-`LPT9`) — treat such a path as a scope/hygiene check failure, since Windows
  cannot stat it and every Windows worktree sees it as a phantom deletion.
  *(from FINDING-014 in 0010-orky-pane-inline-actions)*
- **CONV-051** — An assertion that a shared stub/spy saw ZERO invocations MUST be scoped to the
  actions under test (e.g. filter out unconditional startup/handshake traffic to the same stub)
  rather than asserting raw emptiness, so a new legitimate startup side-effect cannot silently
  contaminate every frozen zero-invocation pin that shares the stub.
  *(from FINDING-016 in 0010-orky-pane-inline-actions)*
- **CONV-052** — A frozen acceptance suite that no gate command executes (e.g. e2e outside the unit
  test gate) MUST be run green at least once against the built implementation before its feature's
  review gate may close — RED state must never be attributed to "missing UI" without ever having
  been witnessed passing against real code.
  *(from FINDING-016 in 0010-orky-pane-inline-actions)*
- **CONV-053** — An outcome-delivery path that uses component mount-aliveness as its user-visibility
  proxy MUST be re-audited whenever that component becomes mountable inside a keep-mounted-hidden
  host (the CONV-028 class): an outcome settling while the owning surface is effectively hidden
  MUST be reported like a detached outcome (e.g. through the same never-silently-dropped toast
  chokepoint), never rendered only into the invisible surface.
  *(from FINDING-018 in 0010-orky-pane-inline-actions)*
- **CONV-054** — A spec that routes a requirement through a shipped seam with a KNOWN defect MUST
  either fix the seam in-scope or state the defect's user-visible consequence in that requirement's
  own normative text and acceptance — never write an acceptance whose green result masks the known
  failure (e.g. a loader-only round-trip that never exercises the gapped boundary).
  *(from FINDING-001 in 0011-orky-workspace-template)*
- **CONV-055** — A creation gesture that closes a picker/modal into a surface it just created MUST
  land keyboard focus in the created surface (or a named target), never on `<body>` via a
  focus-restore whose captured opener unmounted together with the invoking chrome in the same
  batched commit.
  *(from FINDING-007 in 0011-orky-workspace-template)*
- **CONV-056** — An e2e locator that must resolve exactly ONE element MUST NOT rely on a string
  `hasText` filter (case-insensitive substring matching), which can spuriously match inside a
  sibling row's own label — use an exact-text regex or a unique testid instead.
  *(from FINDING-008 in 0011-orky-workspace-template)*
- **CONV-057** — A single-line row styled to truncate (`nowrap`/`overflow:hidden`/ellipsis) MUST
  mirror every field it renders inline into a non-clipped surface (e.g. the row's `title`/tooltip)
  whenever those fields render, and its test MUST NOT rely on DOM-containment assertions
  (`toContainText`/`textContent`) alone to prove the data is observable — those ignore CSS clipping
  and can pass on a technicality the sighted user never sees.
  *(from FINDING-001 and its FINDING-011 devils-advocate confirmation in
  0015-orky-contract-v2-refresh)*
- **CONV-058** — A spec/test pinning the provenance of an external producer's regenerated or
  bundled artifact MUST pin the producer's observable output contract (a version/shape field the
  producer itself reports) and record the producer's actual release/commit as a fact read at
  generation time — never a version literal fixed at spec-authoring time — so drift between spec
  freeze and the regeneration run cannot leave a stale or false version pinned as "the" provenance.
  *(from FINDING-004/FINDING-008/FINDING-010 in 0015-orky-contract-v2-refresh)*
- **CONV-059** — A tests-phase RED verification MUST enumerate the failing test files and assert
  the set is exactly the feature's own new + superseded suites; a PRE-EXISTING suite newly failing
  at the red gate is a collision to resolve before the freeze, never noise — grep-based collision
  enumeration cannot see assembled/self-match-proof needles (e.g. `'toBe(' + '7)'`), but the red
  run itself always can.
  *(from FINDING-005 in 0018-windowed-flow-control)*
- **CONV-060** — A spec consequence written as a MUST-hold guarantee about concurrency,
  idempotency, or atomicity (e.g. "two racing writers both succeed", "a reader never observes a
  torn state") MUST carry its own acceptance vector at the tests phase that actually interleaves
  the race — never prose-only. A guarantee stated but not exercised by an interleaved test passed
  every gate while being false in practice.
  *(from FINDING-013 in 0023-remote-node-pty-prebuilt)*
- **CONV-061** — A skip/idempotency decision that trusts a self-written integrity marker (a file
  the same system wrote at a prior install/commit time) MUST re-verify the artifact(s) it guards
  from ground truth (re-hash/re-read the actual bytes) before trusting the marker's claim, and that
  re-verification MUST cover every file the guarded operation depends on — not one representative
  file. A marker-only check is blind to the guarded artifact being torn, corrupted, or hand-damaged
  after the marker was written, producing a permanent, unrecoverable wedge with no self-repair path.
  *(from FINDING-020 and its FINDING-027 completeness amendment in 0023-remote-node-pty-prebuilt)*
- **CONV-062** — A test that must act mid-async-operation (abort/kill/mutate while a channel or
  operation is open) MUST synchronize on an observed signal — a ledger line, a state file, or an
  awaited event — never a fixed wall-clock timer racing process spawn or channel setup. A bare
  `setTimeout` before an abort/mutation is inherently a race against machine load and spawn
  latency, and passes in CI only by a timing margin nobody has verified.
  *(from FINDING-025 in 0023-remote-node-pty-prebuilt)*
- **CONV-063** — When a filesystem directory listing (`readdir`/`readdirSync`) feeds a wire
  payload, a hash input, or a reproducible build artifact, the listing MUST be sorted by name
  before use — directory enumeration order is unspecified and platform/filesystem-dependent, and
  relying on it silently makes the payload's bytes (and any hash over them) non-reproducible across
  hosts and runs.
  *(from FINDING-008 in 0023-remote-node-pty-prebuilt)*
- **CONV-064** — A feature that consolidates previously-per-connection server state behind one
  shared process MUST specify and test how concurrent independent clients coexist (exclusivity
  granularity / blast radius) — collapsing N processes into one without deciding whether unrelated
  concurrent clients share a lease, a store, or anything else is a silent regression of prior
  concurrent-use workflows, not a design decision made explicit.
  *(from FINDING-013 in 0024-agent-daemonization)*
- **CONV-065** — A persistence/survival feature MUST analyze its interaction with the app's own
  auto-updater: close → update → reopen is the default client lifecycle, and a survival design
  that is only validated against a same-version reconnect can turn the single most common client
  transition into its own worst-case (a version-drift lockout on the very path the feature exists
  to serve).
  *(from FINDING-014 in 0024-agent-daemonization)*
- **CONV-066** — A size-capped diagnostics/ring log for a long-lived process MUST append
  incrementally and rotate at the cap, never rewrite the whole capped buffer to disk on every
  line — a bound on log GROWTH is not a bound on log-append IO cost, and full-buffer-rewrite-per-line
  turns a bounded-size log into an unbounded write-amplification / disk-thrash vector for the
  exact long-lived process the cap was meant to protect.
  *(from FINDING-020 in 0024-agent-daemonization)*
- **CONV-067** — A headless long-lived daemon/service MUST preserve the previous generation's
  diagnostics across a restart (never truncate the only crash trace in place — a truncate-at-start
  policy destroys forensic evidence exactly when a reconnect-triggered respawn is the moment
  someone goes looking for it) and MUST log its own lifecycle transitions (start/ready/exit-reason),
  not only error diagnostics — a log that is empty on the healthy path cannot confirm the process
  ever ran or why it exited.
  *(from FINDING-021 in 0024-agent-daemonization)*
- **CONV-068** — A validation guard whose contract is a MUST on a real operation (bind/write/spawn)
  MUST live on the production code path, not only in a pure seam the tests exercise — a seam-only
  guard is green in CI and dead in production, silently swallowing exactly the raw platform error
  (EINVAL/ENAMETOOLONG/etc.) the guard was written to name.
  *(from FINDING-022 in 0024-agent-daemonization)*
- **CONV-069** — A survival/persistence feature that detaches-and-forgets on a teardown gesture
  MUST test that gesture with a LIVE underlying session (not only a pre-killed/empty one) and MUST
  disclose whether that live session is ever automatically reaped — an idle-reap gated on the
  session already having ended does not bound accumulation for the surviving-session case the
  feature exists to create.
  *(from FINDING-027 in 0024-agent-daemonization)*
- **CONV-070** — A survival/persistence feature that leaves server-side processes running after
  the client's default going-away gesture MUST provide, or explicitly defer with disclosure, a way
  to enumerate and reap those processes from the client — a persistent process the user cannot see
  or stop from the app is an operability orphan, not a feature benefit.
  *(from FINDING-030 in 0024-agent-daemonization)*
- **CONV-071** — Any long-lived `net.Server`/listener (a process meant to outlive individual
  connections) MUST retain a process-surviving `'error'` handler for its whole serving lifetime —
  never leave the listener with only its bind-time error handler, removed and never re-attached,
  so an accept-time error (EMFILE/etc.) cannot crash a process whose entire purpose is outliving
  any one connection.
  *(from FINDING-031 in 0024-agent-daemonization)*

- **CONV-072** — A loopback that amends a frozen test (comment or assertion) or extends a frozen
  REQ's file scope MUST update, in that SAME loopback, every phase artifact that records the frozen
  state as unmodified/enumerated (the tests-phase artifact's test descriptions and byte-unchanged
  claims, `traceability.json` AND its human-readable mirror) — a loopback that edits only the
  frozen files themselves leaves the phase record describing a suite that no longer exists.
  *(from FINDING-019 in 0025-cursor-home-output-suppression)*

- **CONV-073** — A listener wired onto a third-party library's event emitter MUST be verified
  against that library's documented event set AND pinned by a test that observes the event actually
  firing through the real dependency, not a fake — a listener on a never-emitted event name is a
  silent, permanently-dead no-op that only a real-transport test can catch.
  *(from FINDING-015/FINDING-030 in 0026-phone-web-remote)*
- **CONV-074** — A new user-facing surface (settings section, panel, or component) MUST be pinned
  by a test exercising its REAL mount/navigation path (render or e2e) — never only a source-scan of
  the isolated component file, which an unmounted component still satisfies.
  *(from FINDING-024 in 0026-phone-web-remote)*
- **CONV-075** — A loopback fix for a blocking review finding MUST land at least one regression
  test traversing the fixed code path in the SAME round (amend, don't hold, the freeze) — a fix
  arbitrated only by re-review with the frozen suite unchanged is unpinned and can silently regress
  in the very next round. *(from FINDING-077/092/104/105/118 in 0026-phone-web-remote — this
  recurred across four consecutive fix rounds in one feature.)*
- **CONV-076** — Every writer of one persisted file MUST share a single serialized write queue; an
  unserialized read-modify-write against a file another code path also writes is a finding even
  when each individual write is atomic — atomicity of one write does not prevent a lost update
  between concurrent writers. *(from FINDING-116 in 0026-phone-web-remote)*
- **CONV-077** — An auth design that stores its credential in client-side storage or state readable
  only by the served app MUST verify the credential is presentable on EVERY entry path (cold start,
  reload, installed-app/PWA relaunch) — never only on the first navigation.
  *(from FINDING-025 in 0026-phone-web-remote)*
- **CONV-078** — A status/error field added specifically so a late subscriber can observe an
  earlier failure MUST have a pinned consumer that renders it in the exact state the failure
  produces — a carrier with no reachable renderer is not actually surfacing anything.
  *(from FINDING-071 in 0026-phone-web-remote)*
- **CONV-079** — A full-screen detail view reached by selecting one row from a list of similar
  items MUST display the selected item's identity in its own chrome — never rely on the user's
  memory of which row was tapped. *(from FINDING-102 in 0026-phone-web-remote)*

## Principles
Higher-level stances that inform specs and reviews but are too broad to gate mechanically.
- Prefer explicit, total functions over ones that depend on ambient state or throw on ordinary input.
- A requirement that cannot be made testable is not yet understood — escalate it, don't guess.
