# Changelog

All notable changes to Termhalla are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). Dates are YYYY-MM-DD.

## [Unreleased]

### Added
- **Remote node-pty prebuilt co-provisioning (Remote Agent v1, batch 6 — F22).** A released
  installer now ships a prebuilt native `node-pty` for the v1 target `linux-x64-glibc` (staged
  and release-gate-verified with a per-file sha-256 manifest, nothing native committed to the
  repo), and connecting to a matching remote **co-provisions** it onto
  `<remoteAgentDir>/node_modules/node-pty` before the agent launches — the agent's lazy
  `import('node-pty')` now resolves on a stock remote with only `node` installed, no manual setup.
  The provision decision re-verifies the on-disk native binary from ground truth every connect
  (never trusts a self-written marker alone), so a torn/corrupted install self-repairs instead of
  wedging permanently; the promote is a race-tolerant rename-first transaction (two concurrent
  connects installing the same release both succeed); a bounded, early-settling probe channel
  guards against an endless-stdout remote; and a too-old-glibc launch failure always gets an
  actionable floor hint. Strictly additive — `connectWithProvisioning` behaves byte-identically
  when the new option is absent, and `--pty=fake` is untouched. No `SCHEMA_VERSION` change, no
  persisted state, no secrets. (`docs/features/remote-node-pty-prebuilt.md`)
- **File menu — save / close / reopen a workspace as a document.** A native **File** menu
  (New · Open Workspace… · Reopen Closed Workspace… · Save · Save As… · Exit) makes a workspace a
  first-class document. **Save As…** writes a portable `.thws` file (the same versioned
  `{ schemaVersion, workspace }` envelope the internal store uses) at a location you pick;
  **Open** reads one back as a fresh workspace (new ids — the same file can be opened twice without
  collision); **Save** overwrites the bound file (a per-workspace `workspaceId→path` binding is
  persisted in `workspace-docs.json`, so Save keeps overwriting across relaunches) and always
  flushes live state to the internal record. **Reopen Closed Workspace…** lists workspaces still on
  disk but not open and brings one back with full identity, and can permanently delete one (the
  long-deferred orphan cleanup). Reopening/opening restores every pane exactly as saved — each
  terminal relaunches at its saved **cwd**, reconnects its **SSH** session, and re-runs
  `claude --resume` where a Claude session was running (the existing save-time capture:
  `applyCwds`/`applyResumeAi`); live scrollback/output is not preserved (panes relaunch fresh,
  like restart-restore). The menu only signals intent — the renderer, which owns live workspace
  state, performs each action (the `menu:open-settings` push idiom); Exit uses the native quit role
  so it inherits the before-quit flush. New `wsdoc:*` + `ws:delete` IPC; `register-workspace-doc.ts`
  joins the registrar/capability partition (`workspace-doc`, +1 `CAPABILITY_IDS` via TEST-741's
  amendment path). No `SCHEMA_VERSION` bump — the document format IS the existing workspace record.
  (`docs/features/workspace-documents.md`)
- **Remote workspaces — client routing + per-workspace home (Remote Agent v1, batch 5 — F21).**
  A workspace now has a HOME: local (unchanged, byte-identical), or a named agent (locked
  decision 7) — every pane in it runs on that agent over ONE ssh-tunneled connection
  (`RemoteWorkspaceManager`, `src/main/remote/`), spawned/provisioned via F19's bootstrap,
  version-locked to the app manifest, flow-controlled via F17 (a fresh `createClientAckPolicy`
  per (re)connection; quiet-flush timer; no window frames in v1). Remote panes get agent-sourced
  status chips over the existing `pty:*` channels (transparent routing; zero local trackers
  engaged); disconnect / F20 lease-steal shows a keep-mounted banner (Cancel while connecting —
  the F19 caller-owned-cancellation contract — Reconnect after; panes freeze, never unmount);
  unsupported domains (fs/editor, git, usage, orky, recording, …) are greyed per remote workspace
  from the capability handshake. New `remote:*` IPC family + `remote-agents.json` named-agent
  registry (config only, no secrets); "Remote workspace…" templates-menu row + palette entry →
  agent picker. `SCHEMA_VERSION` 8→9 (workspace `home`; documented-identity migration). The
  shipped v1 agent is not daemonized: a dropped transport ends its sessions — reconnect surfaces
  them as exited (inventory-driven, so daemonization lands with no client change).
  (`docs/features/remote-workspaces.md`)
- **Exclusive attach via agent-side lease (Remote Agent v1, batch 4 — F20).** `tmux attach -d`
  semantics (locked decision 5; no mirrored attach): the session store's binding IS the lease —
  exactly one connection holds an agent's session set at every instant. Binding while another
  connection is bound no longer throws (F18's single-connection guard retired through this
  feature's tests phase, exactly as its recorded CONV-019 path prescribed): the incumbent is
  displaced atomically inside the synchronous `bind()` — detached with the full F17×F18 weld
  semantics (its gate-paused backends resume into the replay terminal only; the flow gate
  resets so the winner starts a fresh window; its in-flight attach windows settle inert via the
  existing generation scoping) — then notified: the loser's connection receives
  **`lease:revoked`** (`AGENT_LEASE_REVOKED_EVT` in `src/shared/remote-agent-api.ts`, defined in
  `src/agent/session-api.ts` — the two-door pattern) as its FINAL frame and ends with exit 0;
  F21 renders the disconnected-workspace banner off that evt. The steal race is deterministic
  (newest bind wins, total arrival order, steal-back is just another attach; run-twice vectors
  pin byte-identical logs) and no agent-side byte is lost across a steal (the winner's snapshot
  ⊕ events ≡ the full stream — the F18 composition oracle re-proven over the boundary). Release
  is **holder-scoped**: a connection that never held the lease (failed handshake, pre-hello
  EOF) or was displaced cannot strip the current holder (review FINDING-001, repro-verified,
  fixed in-run with FINDING-002/003 reentrancy hardening — nothing follows the revocation evt
  even under a reentrant sink; a nested bind during the revocation callback wins as the
  newest). No new methods, error codes, frame types, or dependencies; the shipped stdio
  artifact is behavior-identical (one connection per process — F19/F21 wiring makes steals
  reachable end-to-end). Also cleared the F17×F18 weld's mandatory housekeeping: `npm run
  typecheck` red→green (pause/resume no-ops on three frozen 0019 stub handles). See
  `docs/features/remote-agent.md` § "Exclusive attach lease".
- **Agent-side replay + session survival (Remote Agent v1, batch 3 — F18).** Sessions survive
  client disconnect/death (locked decision 3), agent-side and transport-independent: pane
  ownership moved into a **session store** (`src/agent/session-store.ts`) that outlives a
  protocol connection — every connection-end path (clean EOF, fatal framing, handshake failure,
  a failed outbound send) now merely **detaches** when the session is composed over an external
  store, while the SHIPPED single-connection stdio artifact keeps F16's kill-on-end behavior
  byte-identically. Each pane feeds one **`@xterm/headless` terminal** (`src/agent/replay.ts`,
  new `@xterm/headless ^5.5.0` dependency bundled into `termhalla-agent.cjs`) with **bounded
  scrollback** (`HISTORY_LIMIT_DEFAULT = 2000`, the tmux `history-limit` analog; store-option
  override, sizing/GC recorded open). Two new pty-domain methods: **`pty:attach`** returns the
  serialize-addon snapshot + cwd/status/dims so a reconnecting client repaints the pane EXACTLY
  (write-flush-barrier correct; a hold window guarantees no `pty:data` crosses the res — bytes
  arriving mid-attach flow exactly once, after it; overlapping attaches on one pane are rejected
  deterministically), and **`pty:sessions`** lists surviving sessions (sorted, live-only,
  truthful `attached` flags) for reattach discovery — the surface F20's lease and F21's routing
  build on. Explicitly NOT the window-manager transit buffer: no missed-event queue exists; the
  headless terminal IS the history (structural guard pins the non-import). Vocabulary rides
  `src/shared/remote-agent-api.ts` (`AGENT_SESSION_METHODS`, `AgentAttachResult`,
  `AgentSessionInfo`; no new error codes, no new frame types, capabilities unchanged). Review
  hardening: exit-during-attach flushes held final bytes before `pty:exit`; a throwing res send
  can't wedge the hold window; destroyed stores reject spawns. Zero behavior change to the
  running Electron app. See `docs/features/remote-agent.md` § "Session survival + replay".
- **Windowed flow control — protocol-level backpressure (Remote Agent v1, batch 3; feature
  0018).** F15's reserved `ack`/`window` frames got their semantics on BOTH sides of the wire,
  in one pure shared module (`src/shared/remote/flow-control.ts`, exported via
  `@shared/remote/protocol`) so the endpoints can never disagree on the measure
  (`flowPayloadSize` = UTF-16 code units of the `pty:data` payload). The agent session counts
  every emitted payload per pane and `pause()`s the pty backend when unacked units exceed the
  window (default 1 MiB; `window` frames set a per-pane override — live panes only, never
  stored speculatively — or the connection-wide default), resuming at the `floor(window/2)`
  low watermark (hysteresis: no resume-at-zero deadlock against a quantized acker, no
  boundary thrash); over-acks clamp to zero with one loud stderr diagnostic, acks racing a
  pane's exit are silently tolerated, and flow frames are fire-and-forget (never answered).
  The client half (`createClientAckPolicy`) acks the full accumulation every 64 KiB with
  consumer-driven residue `flush()` — its production consumer arrives with F21. Both backends
  implement `pause()`/`resume()`: node-pty maps them onto its own socket-level flow control
  (where `cat` blocks against the kernel buffer); the deterministic fake queues while paused,
  flushes in order on resume (re-pause mid-flush honored), defers a SCRIPTED exit behind
  queued data, never defers `kill()`, and gained a `flood <chunks> <chunkBytes>` command (the
  scripted cat-a-huge-file, capped + fail-loud on bad args). Proven by an in-process and a
  real-stdio-artifact flood against a deliberately stalled consumer — bounded emission
  (≤ window + one chunk under the fake), the session keeps serving other panes, and
  policy-driven acks drain the flood byte-for-byte. The 0016/0017 scope pins this feature was
  named to retire (TEST-747's exact barrel-export list, TEST-773's inertness vector) were
  superseded through its tests phase exactly as their retirement paths prescribed.
- **SSH tunnel + client-provisioned agent bootstrap (Remote Agent v1, batch 3 — F19).** The
  epic's CONNECTION layer as a headless library in a new `src/remote-client/` tree (no
  renderer/main/preload wiring — F21 consumes it; the TEST-746 scope guard survives, and F19 adds
  its own `remote-client` scope guard with the same F21 retirement path). Transport = a **stdio
  exec channel over the SYSTEM `ssh` binary** (spawned argv-array, no shell, never an SSH library —
  inherits `~/.ssh/config`, jump hosts, hardware keys, 2FA), seeded from SSH favorites with
  option-injection guards on every field. **Named agents** become the connection registry: a pure
  `src/shared/remote-agents.ts` model (host/user/port + identity-file PATH only — no secrets, the
  `quick.json` posture) seeded via `seedNamedAgentFromConnection`, plus a path-injected atomic JSON
  store. On connect the client runs **F15's handshake** through the pinned probe
  (`test -f … && exec node … || exit 127`) and classifies failures with a pure truth table:
  exactly `absent` and `version-mismatch` are provisionable; everything else (auth/transport 255,
  framing corruption, other handshake kinds) is fatal and NEVER uploads. Provisioning streams the
  bundled `out/agent/termhalla-agent.cjs` over a second exec channel — byte-count-verified,
  atomically promoted (a truncated stream never occupies the install path), version-embedded
  filename (`termhalla-agent-<version>.cjs`, ONE canonical version for handshake + path) — then
  retries exactly once (`provision-ineffective`, never a loop). Aborts kill the children;
  a mid-upload abort reports an honest INDETERMINATE outcome. Tests (TEST-2001..TEST-2033) run
  against a **fake ssh shim** spawning the agent as a local child process — no network, no real
  ssh; the gold test provisions the REAL bundle built through `vite.agent.config.ts` and
  handshakes it. Diagnostics are CONV-001-specific with control-char-sanitized stderr excerpts.
  See `docs/features/remote-bootstrap.md` (contract notes: caller-owned cancellation, remote
  `node` on PATH, shell-rc stdout noise) and
  `docs/superpowers/0020-ssh-tunnel-provisioned-bootstrap-review-followups.md`.
- **Agent runtime skeleton — pty + status domains over stdio (Remote Agent v1, batch 2).** The
  epic's walking skeleton: a **headless Node agent** in a new `src/agent/` tree that speaks F15's
  protocol over stdio (stdout = frames ONLY, diagnostics on stderr) and implements exactly the
  **pty + status** domains. Agent-first handshake (version = the repo `package.json` version
  inlined at build time; capabilities = the pinned `['pty', 'status']`); the four methods mirror
  the local `pty:*` IPC surface with the SHARED arg types (`pty:spawn` keeps the idempotent
  adopt→`true` semantic; write/resize/kill answer `unknown-pane` on a dead id — a disclosed
  divergence from the local silent voids) under strict coded validation (`bad-params` /
  `unknown-method` / `spawn-failed` / `internal`, vocabulary shared at
  `src/shared/remote-agent-api.ts`); pushes mirror `pty:data`/`pty:exit` and run **status
  detection at the source** — each pane's byte stream feeds the EXISTING `src/main/status/`
  engine on the agent (OSC 133, needs-input, cwd), so `pty:status`/`pty:cwd` chips work
  identically for remote panes. The pty layer is an injectable backend: real `node-pty` (POSIX,
  Linux-only v1, lazily loaded strictly on `--pty=node-pty`) and a deterministic scripted fake
  (`--pty=fake`) that CI drives through the REAL artifact — `npm run build` now also emits
  `out/agent/termhalla-agent.cjs` (single-file, plain Node) via `vite.agent.config.ts`, and the
  stdio integration test bundles through that SAME config on demand, spawns the bundle under
  plain node, and round-trips the full protocol with F15's client machinery — no ssh and no real
  node-pty anywhere in CI, per the epic's locked decisions. Zero behavior change to the running
  Electron app (F15's TEST-746 scope guard survives untouched); inbound `ack`/`window` frames
  are accepted-and-inert until F17 gives them semantics. See `docs/features/remote-agent.md`.
- **Remote wire protocol core + version/capability handshake (Remote Agent v1, batch 1).** A pure
  protocol layer under `src/shared/remote/` (barrel: `@shared/remote/protocol`) with **zero
  Node/Electron imports and zero behavior change to the running app** — in v1 nothing outside the
  vitest suite consumes it (guarded by a scope test until F16/F21 land). Framing over a byte
  stream (4-byte big-endian length + UTF-8 JSON, 8 MiB cap enforced both directions, incremental
  chunking-invariant decoder with a fatal-vs-per-frame error taxonomy), the closed strict v1
  message vocabulary (`hello`/`req`/`res`/`evt` + reserved F17 `ack`/`window` shapes) with **deep
  JSON-representability validation of the any-JSON positions** (`req.params`, `res.result`,
  `evt.args` — `undefined`/functions/symbols/`BigInt`/non-finite numbers/non-plain objects/`toJSON`
  carriers (own or inherited)/cycles/array expandos are rejected with structured errors naming the
  offending path instead of failing remotely or throwing raw; wire-decoded input never pays a
  rejection), the connect handshake (agent speaks first; **EXACT-version check — a version check,
  NOT a compatibility matrix** — with capability advertisement partitioned by the per-domain IPC
  registrar names; v1 agent advertises `pty` + `status`), and monotonic request/response
  correlation with an exactly-once connection-closed drain. Stdio is the only assumed transport,
  so the identical path will run over system ssh in production and a plain child process in
  CI/e2e. See `docs/features/remote-protocol.md`.
- **Per-project Orky cockpit workspace.** One gesture opens a fresh "cockpit" workspace for a
  tracked Orky project: an Orky pane bound to the project plus a **plain terminal at the project
  root** (no auto-run — no command is auto-typed, no launch override, no injected env) in a 50/50
  row split, named `Orky: <project folder>`. Three entry points: a command-palette action
  (**New Orky project workspace…**), a built-in never-deletable first row in the templates menu
  (**Orky project cockpit…**), and an **open cockpit** button on each decision-queue project
  group header (the pre-selected path — no picker; case/slash-variant roots converge onto the
  tracked spelling, and untracked/loading/failed registry states are refused with distinct,
  actionable copy). Both picker-driven entries reuse the shared tracked-root picker, relabelled
  for the cockpit gesture. The cockpit is a real workspace — save it as a template with the
  normal explicit gesture; the cockpit flow itself never writes `quick.json`. See
  `docs/features/orky-workspace-template.md`.
- **Inline Orky actions in the native Orky pane.** Every feature row of the Orky pane now mounts
  the SAME shared actions region the decision-queue drawer uses (feature 0008's
  `OrkyEntryActions`, composed — never forked): answer an open escalation inline (the escalation
  id binds from the row's already-held `registry:detail` payload — the first open escalation,
  never free text — with zero display-time pulls, and is still re-verified against a fresh pull
  at submit), record a human-review verdict, the read-only next-action preview, and
  resume-in-terminal at the pane's root. A pane-header **inject** button (bound member panes
  only) opens the quick-capture form pre-targeted to the pane's project via
  `openOrkyCapture(root)` — the root byte-verbatim, no picker step, nothing dispatched by the
  gesture itself. The pane and queue mounts share the module-scope single-flight gate, so the
  same target dispatches at most once across both, with shared pending and shared busy refusal.
  The CONV-046 mode-flip fix lands in the shared component for both mounts: a data-driven reason
  flip (e.g. escalation → human-review) while the answer form is open now disarms the form
  (closes it and clears the typed draft) instead of swapping in a focus-stealing form — keyboard
  focus moves only on the explicit open gesture. No new IPC/preload/main surface; every
  write-capable action is gesture-tied. See `docs/features/orky-pane.md`.
- **Answer + resume actions on decision-queue entries.** Every entry in the Orky decision-queue
  drawer now carries a write-capable actions region: **answer** the entry inline (an escalation
  gets a decision-text input; a human-review entry gets a pass/fail verdict with optional
  evidence; a stalled entry offers no answer), a read-only **next-action preview** off
  `driveStatus` (never claims the pipeline advanced), and **resume-in-terminal** — one gesture
  opens a visible terminal at the entry's project root running `claude` with `/orky:resume` as its
  initial prompt (a user-owned session, never a background drive). The escalation target is
  identity-bound: sourced from the `registry:detail` channel at display time, shown beside the
  input, and re-verified against a fresh pull at submit — a changed world refuses honestly instead
  of landing the decision on a different escalation. Dispatch rides EXCLUSIVELY the existing
  `orkyAction:*` bridges (no new IPC/preload/main surface) behind a cross-instance single-flight
  gate, results are keyed on the dispatcher's own `ok`/`dispatched`/`errorKind` (with
  `cli-timeout`/`ipc-failure`/`cli-unparseable` treated as indeterminate for a mutating answer,
  and the distinct `feedback-disabled` no-write outcome), and a mid-flight drawer close detaches
  the settled outcome to a store-level toast — a failure never-suppressed, a success on the same
  suppressible kind the in-view region would have shown — so no outcome, success or failure, is
  ever silently dropped. Resume-in-terminal rides a new narrow `launchTerminalAt` store action
  (not the raw pane-commit primitive) to keep the same least-privilege shape every other
  pane-opening action follows. The action layer (`OrkyEntryTarget` /
  `useOrkyEntryActions` / `OrkyEntryActions`) is pane-agnostic for F10's OrkyPane to mount
  verbatim. See `docs/features/queue-answer-resume-actions.md`.
- **OS-level needs-you notifications.** A new main-process observer over the cross-project
  `registry:status` aggregate fires an OS notification whenever an Orky project transitions INTO
  needs-you (open escalation / stalled / awaiting human-review) — including projects with **no open
  pane**. Transitions are deduped by `(project, feature, reason)` and rate-bounded by a tumbling
  coalesce window (at most three individual toasts per window; the rest fold into one "N projects
  need you" digest). Clicking a notification brings the app forward and hands off over the single new
  `orkyNotify:focus` channel — focusing the matching pane (reusing the decision-queue matcher) or
  opening the drawer scrolled to the project. A new **app-wide opt-in** `orkyNeedsYouNotifications`
  (a General-settings toggle, **default on**) mutes them live with no restart; it stays strictly
  read-only on `.orky/` (no writes, no actions, no registry mutation). See
  `docs/features/os-needs-you-notifications.md`.
- **Quick-capture new-work inbox (global capture modal).** A new rebindable `capture-orky-work`
  command (default `Ctrl+Shift+U`) and Ctrl+K palette entry open a global, workspace-independent
  capture modal: pick a tracked Orky project (the shared root picker, relabelled for capture via
  new additive `ariaLabel`/`heading`/`z` props), type a title + optional detail, submit — the work
  item lands in `<root>/.orky/feedback/inbox/` as a `work.request` awaiting planner triage.
  Submission rides EXCLUSIVELY the existing `orkyAction:submitWork` dispatch (its first renderer
  consumer — no new IPC/preload/main surface); the request is byte-verbatim with no client-side
  caps, and results are keyed on the dispatcher's own `ok`/`dispatched`/`errorKind`: success is a
  suppressible "Captured — queued … for triage" toast, every failure renders in-modal with the
  draft preserved — the distinct `feedback-disabled` state (no enable affordance; ADR-027), an
  indeterminate `cli-timeout`/`ipc-failure` state with a duplicate-retry warning, and verbatim
  errors otherwise. A `runOrkyCli` spawn-class failure (e.g. an oversized `--json` argv element) is
  classified as a DEFINITE `cli-error`/`cli-unparseable` rather than the indeterminate
  `cli-timeout`. An always-visible hint line names the fast-capture and discard keys, and closing
  the modal mid-flight never drops a settled failure silently — it detaches to a never-suppressed
  toast carrying the same honesty class (indeterminate wording for `cli-timeout`/`ipc-failure`) as
  the in-modal region. See `docs/features/quick-capture-inbox.md`.
- **F7 dispatcher amendment: `submitWork` now rides `feedback submit` instead of `feedback emit`.**
  The dispatcher's single hard-coded submitWork invocation is now the Orky plugin's local-inbox
  injection `['submit','--app',<root>,'--json',<work item>]` (plugin v0.28.0+) — one JSON argv
  element, so the captured item is written DIRECTLY to the project's feedback inbox (the store the
  orchestrator's `apply` drains) rather than emitted as an outbox event with no shipped consumer.
  Unlike emit, submit refuses loudly when feedback is disabled (exit 1) — surfaced as the DISTINCT
  `feedback-disabled` result carrying the CLI's refusal verbatim; every other refusal/internal
  error stays a verbatim `cli-error`, an older plugin without `submit` surfaces as
  `cli-unparseable`, and `resolveEscalation` keeps its own `feedback emit` path unchanged.
- **Native Orky pane — a first-class, persisted pane kind for one project's FULL pipeline status.**
  `PaneConfig` gains `orky` (bound to one tracked project root, stored verbatim/case-preserved),
  creatable from the command palette ("New Orky pane…"), the tab bar's add-pane select, and the
  split compass — all through a shared tracked-root picker. The pane renders EVERY feature
  (including the idle/clean-done ones the popover and decision-queue omit) with per-gate records,
  findings (with the shared blocking verdict), and escalations, read over a new read-only
  `registry:detail` pull with deterministic sort-before-cap bounds, a bounded torn-write retry, and
  surfaced (never silent) unreadable markers. A new lightweight `registry:rootChanged` push (the
  bare project-root string, per completed engine re-read) keeps a displayed pane current — hidden
  panes mark themselves stale and refresh once on restore; other roots' churn re-renders nothing.
  Unbound/unreadable/error states are explicit, with a keyboard-operable re-bind flow. Strictly
  read-only; each row reserves an empty actions slot for F10. See `docs/features/orky-pane.md`.
- **Workspace schema bump: SCHEMA_VERSION v7 → v8** (the first since pane view-state in 0003), so
  the new persisted `orky` pane kind rides the migration chain: the v<8 step is a documented
  identity (a pre-v8 record cannot contain an orky pane), and an **older Termhalla build will
  refuse to load a v8 workspace file** ("newer than supported") rather than render a pane kind it
  does not know. A malformed persisted orky binding loads as unbound instead of dropping the pane.
- **Orky decision-queue drawer (the registry aggregate's first renderer UI).** A right-side,
  window-chrome drawer (a sibling of the notes drawer — not a pane kind, no `SCHEMA_VERSION` change)
  listing every feature across every tracked Orky project that **needs a human right now** — open
  escalation, stalled active run, or autonomous-gates-green awaiting human review — grouped by
  project and deterministically ordered by the same comparator the pane chip uses. Toggled from a
  new status-bar affordance (with a live count badge that stays current while the drawer is closed),
  a Ctrl+K palette entry, and a new rebindable `toggle-orky-queue` command (default `Ctrl+Shift+O`).
  Clicking an entry focuses the most-recently-focused matching pane in the window (matched
  renderer-side on the pane's cwd, the same signal the aggregate binds on); a project with no open
  pane gets an "open terminal here" fallback that spawns a terminal at the project root. Strictly
  read-only and renderer-only: it consumes feature 0005's `registry:status` push plus one
  generation-guarded `registry:current` recovery pull — no new IPC, no main/preload change, no
  `.orky/` write, nothing persisted (the drawer always starts closed). See
  `docs/features/decision-queue.md`.
- **Orky contract handshake at startup (runtime skew detection, log-only).** A fire-and-forget
  `verifyOrkyContract()` (`src/main/orky/orky-contract-handshake.ts`) now runs once from the
  composition root: it locates the installed gatekeeper cli.js (`ORKY_PLUGIN_DIR`), invokes its
  `contract` subcommand through the existing safe runner, and compares the emitted
  `contract_version`/`phases` against Termhalla's mirrored constants (`ORKY_PHASES`) — the runtime
  complement to the committed golden fixtures, so an in-place Orky upgrade with breaking schema
  changes produces one detailed `console.warn` line (both sides' values) at startup instead of
  staying invisible until something breaks. Never a behavior gate: a mismatch only warns, an absent
  or pre-`contract` Orky is tolerated with a softer "version skew undetectable" note, and the result
  is cached per located path for the process lifetime.
- **Golden Orky-contract fixtures (real producer output, committed).** `tests/fixtures/orky-contract/`
  now holds artifacts the REAL Orky producer emitted — `gatekeeper contract`'s machine-readable
  contract, a genuine `state.json`/`active.json` driven through the real gatekeeper, and a raw OSC
  heartbeat byte sequence — regenerated via `tools/generate-orky-contract-fixtures.mjs` (producer path
  overridable with `ORKY_PLUGIN_DIR`) and committed so the suite runs green without Orky present. A
  new contract test pins `ORKY_PHASES`, the OSC code/prefix and payload byte cap, and the shared-mapper
  normalization of the real artifacts against them — the test that finally catches phase-list drift
  whenever the fixtures are refreshed against a newer Orky.
- **Orky action-dispatch substrate (first write-capable IPC surface).** A new main-process
  `OrkyActionDispatcher` service exposes exactly four actions over four new `orkyAction:*` channels —
  `resolveEscalation`, `submitWork`, `recordHumanGate`, `driveStatus` — Termhalla's first
  renderer-reachable, project-**mutating** surface. Every mutation is performed by invoking one of
  Orky's OWN CLIs (`feedback emit`, `gatekeeper resolve-escalation`, `gatekeeper record`) through an
  abortable/`unref()`'d `execFile` (argument array only, never a shell); this feature never writes a
  file under any `.orky/` tree itself, never spawns an agent, and never drives the pipeline. Every
  `projectRoot` is checked against the SAME server-side `OrkyRegistry.roots()` allowlist (feature 0005)
  and every `feature` slug is confined to a single path segment with the target `featureDir` always
  built server-side. Mutating actions on the same feature directory are serialized through a
  per-`featureDir` queue so a concurrent submission can never lose another's `state.json` update, and
  every dispatcher-reached invocation — success or rejection — is recorded in a new append-only
  `orky-actions.jsonl` audit log under Electron `userData`. This feature ships **no renderer UI** — it
  is IPC/data only; F8/F10/F12 are later consumers. See `docs/features/orky-action-dispatch.md`.
- **Orky OSC heartbeat — stream-derived status for bare-SSH panes.** A second, fallback source for the
  Orky pane chip introduced by orky-status: a strict, bounded OSC marker
  (`\x1b]9999;<single-line compact JSON>\x07`, Orky's real ADR-026 contract — `{v, feature, phase, gate,
  needsHuman, reason, action}`) parsed directly out of a pane's PTY byte stream (`OrkyOscParser`, a
  third consumer of the shared `scanOsc` scanner alongside `Osc133Parser`/`CwdParser`), for panes whose
  `.orky/` tree is not filesystem-reachable from this host (e.g. a remote shell over SSH). The
  filesystem-derived status always wins when present (`selectOrkyPaneStatus`); the stream-derived
  heartbeat is used only as a fallback, mapped to the exact same `OrkyPaneStatus` chip/popover
  presentation via `orkyHeartbeatToPaneStatus` (no new presentation, no new IPC channel, no new wire
  type — it rides the existing `orky:status` push). Payload decoding is strict-but-tolerant JSON
  validation, size-capped on actual UTF-8 byte length (4096 bytes, checked before `JSON.parse`) and
  bounded on the no-terminator carry-over path (8192 bytes) — malformed/oversized/garbage input yields
  no heartbeat and never throws, never a partial decode. This feature is **Termhalla-side only**: it
  builds the Termhalla parser + renderer. The matching emission is **real and shipped** on the separate
  `C:/dev/Orky` CLI (ADR-026), opt-in via `config.heartbeat.osc` (default `false`, best-effort, never
  throws, writes nothing) — the full byte-for-byte contract lives in
  `docs/features/orky-osc-heartbeat.md`. Once a project opts in, a bare-SSH pane shows real Orky status.
  `src/main/orky/orky-tracker.ts` (the filesystem watcher) is unmodified; `SCHEMA_VERSION` is unchanged.
- **Cross-project Orky registry (IPC/data-only).** A new main-process service generalizes the per-pane
  `OrkyTracker` (feature 0004) into a **cross-project, pane-independent aggregate**: the union of every
  currently-open pane's resolved `.orky/` root (ephemeral) and a new **persisted explicit list** (manual,
  added/removed only via `registry:addRoot` / `registry:removeRoot`), deduplicated by resolved project
  root and tagged with its membership `source` (`pane` / `persisted` / `both`). Each entry reuses 0004's
  exact `OrkyPaneStatus` roll-up — no forked status type. The aggregate is pushed over a new app-global
  `registry:status` IPC channel (plus `registry:current`/`registry:roots` pulls), backed by a new
  self-versioned `orky-registry.json` persisted file (`SCHEMA_VERSION` unchanged). The per-root
  watch/read machinery is shared with the existing pane-chip path through one extracted `OrkyRootEngine`
  instance, so a root tracked by multiple panes *and* the persisted list still costs exactly one chokidar
  watcher. This feature ships **no renderer UI** — it is IPC/data only, for a later feature to consume.
- **Orky status awareness in the pane chrome.** A terminal pane whose tracked cwd sits inside an
  `.orky/` project (an Orky gated-pipeline run) now surfaces that run's live
  **status** directly in the pane chrome — a read-only mirror, derived purely from reading the
  on-disk `.orky/` JSON (`active.json`, `features/*/state.json`, `findings.json`); it never spawns a
  CLI and never writes into `.orky/`. The pane toolbar gains an **Orky chip** labelled
  `feature · phase · gate N/M · ●k open`, and clicking it opens a detail popover listing every active
  feature with its phase, gate progress, open-blocking findings, and "needs you" reason. Detection is
  **gate-based**: the live phase is `active.json.phase` for the active feature and the gate frontier
  for the rest, and "needs a human" is derived from the gates (autonomous gates through `doc-sync`
  passed while `human-review` is pending), an open escalation, or a stalled heartbeat — taking
  **precedence** over the byte-derived terminal status for the pane border and lighting the workspace
  tab's 🔔 needs-you badge (gated by the same tab-badge opt-in); a halted gate failure surfaces as a
  rendered failure accent with a non-color marker. Status is pushed over a new pane-scoped `orky:status`
  IPC channel (validated + per-window scoped) from a bounded, debounced, disposable main-process watcher
  (one watcher/read per `.orky/` root) and held as live runtime state (nothing persisted;
  `SCHEMA_VERSION` unchanged). The canonical phase list (`ORKY_PHASES`) is a hardcoded mirror of Orky's
  recorded gate keys / `DRIVER_WORK_PHASES` — see `docs/features/orky-status.md` for the data-provenance
  note.
- **Minimize / restore panes.** A pane can now be **minimized** out of the visible tiled layout
  while staying fully alive in the background (its PTY keeps running, xterm scrollback / Monaco
  models / live TUIs are preserved — kept mounted off-layout, never unmounted). Minimizing reflows
  the remaining panes to fill the freed space. Minimize from the pane toolbar button, the title-bar
  right-click menu, or the rebindable **Minimize pane** keybinding (`Ctrl+Shift+H` by default). Each
  workspace shows a per-workspace **tray** of restore chips — one chip per minimized pane, surfacing
  its live status (running/idle, **needs-input**, recording, AI session) — and clicking (or
  keyboard-activating) a chip restores the pane, split to the right. Minimizing every pane shows an
  all-minimized empty state with the tray as the restore home. Minimize and maximize are mutually
  exclusive on the same pane. Minimize and maximize view-state are now **persisted** across reload
  (`SCHEMA_VERSION` 6 → 7 with an explicit, lossless migration); only pane id references / flags are
  stored — never any pane content or secrets. Output produced *during* the minimize↔restore
  transition is buffered and replayed so nothing is dropped from scrollback; an Explorer's expanded
  folders survive a minimize/restore; a backgrounded terminal whose shell exits shows a distinct
  **exited** chip rather than reading as idle; and the tray strip never swallows clicks meant for the
  reflowed terminal beneath it.

### Changed
- **Workspace tab strip reworked into equal, scrollable "pipe" tabs.** Every workspace tab is now a
  compact, equal fixed width (`--ws-tab-w`), so tabs stay uniform and no longer resize as names or
  badges change (a name too long for the width scrolls — see below). The status badges (AI sparkle,
  needs/busy) move to a pinned
  cluster **before** the name; the name fills the rest and **scrolls horizontally** when too long
  (hidden scrollbar + vertical-wheel-to-horizontal) instead of truncating with an ellipsis. When the
  tabs overflow the bar they no longer squeeze — a hidden-scrollbar viewport holds them and **◀ / ▶
  scroll buttons** appear at the ends (disabled at the respective edge), with the active tab kept in
  view. Each tab gains a **secondary "pipe" border** — an inset box-shadow paints a channel + inner
  wall ~2–3px inside the existing border, so a double line runs all the way around; it recolors to
  the accent on hover/active. All of this is paint-only or fixed-size, so the strip keeps its
  constant single-line height (the ConPTY-repaint-oscillation guard in `tests/e2e/tab-strip.spec.ts`
  still holds). `src/renderer/components/WorkspaceTabs.tsx`, `src/renderer/index.css`.
- **Orky contract mirror re-synced to v2.** `EXPECTED_CONTRACT_VERSION`
  (`src/main/orky/orky-contract-handshake.ts`) bumps `1` → `2` — the strict (`!==`, no
  range/minimum-version tolerance) startup handshake now treats a v1 plugin as the drift case and a
  v2 plugin as clean; every other handshake invariant (log-only, never a gate, never throws, absent/
  pre-`contract` CLI tolerated, per-path caching) is unchanged. The golden fixtures under
  `tests/fixtures/orky-contract/` were regenerated in one run of
  `node tools/generate-orky-contract-fixtures.mjs`, regenerated against plugin **0.32.0** (commit
  `1c59d74`) — the producer's version and commit as read at generation time. (The concept-phase
  target was 0.30.0, a spec-time historical mention only; the two builds' `gatekeeper/` trees are
  byte-identical, so the emitted contract is the same.) The regenerated fixtures show an
  identical v2 shape (`contract_version: 2`, the unchanged 8-entry `ORKY_PHASES` list, `phase_order`
  ending `human-review`, new top-level `finding_resolution`/`producer_tiers` keys,
  `state.gate_fields.firstAt`), so every golden assertion holds against either version. `ORKY_PHASES`
  itself is untouched — v2 did not change `phases`. The provenance comments in
  `src/shared/orky-status.ts` and `docs/features/orky-status.md` now record Orky's historical
  `PHASE_ORDER` `human`→`human-review` rename as resolved as of contract v2 (the `intake`-excluded
  difference stays live); `docs/features/orky-action-dispatch.md`'s handshake description now states
  the v2 pin. `OrkyFindingDetail` gains read-only `resolution`/`resolvedBy`/`resolvedAt` fields
  (mapped in `orky-root-detail.ts#mapFinding` with the module's existing total-mapping + tz-safe
  timestamp discipline, riding the EXISTING `registry:detail` payload — no new IPC channel, no
  `SCHEMA_VERSION` bump). The native Orky pane's finding rows now show a dim `— resolution: …` affix
  on a resolved finding (status compared case-insensitively) that carries a non-empty resolution,
  with `resolvedBy` and a formatted `resolvedAt` alongside on the same row, and — whenever the affix
  renders — the row's `title` tooltip mirrors the full claim + affix so a clipped row's details stay
  reachable via hover; open findings and resolution-less (`null` or `''`) resolved findings render
  byte-identical to before. `producer_tiers` is explicitly **not** adopted (no type, no rendering, no
  new surface anywhere).
- **Pane toolbar cleanup + unified split-direction control.** The per-pane Record toggle (the ⏺
  button) was removed from the pane toolbar and moved into the pane title-bar **context menu**
  (right-click menu) as a terminal-only **Start recording / Stop recording** item that reflects the
  same recording state. The two separate split buttons (split-right ⬌ and split-down ⬍) were
  collapsed into a single **split** button that opens one combined popover: a four-direction
  **compass** offering **up**, **down**, **left**, and **right** plus a Terminal/Editor/Explorer
  kind selector. Pick a kind, then activate a direction (mouse or keyboard — the compass is fully
  arrow-key navigable with the right direction highlighted by default) to commit the split.
- **`splitPane` supports before/after insertion.** The pure layout helper now accepts a
  `position: 'before' | 'after'` argument (default **after**, byte-for-byte today's output). A
  `left`/`up` compass split inserts the new pane **before** the source (as the parent's `first`
  child); `right`/`down` inserts it **after** (`second`). The persisted `MosaicNode` shape is
  unchanged (no schema bump).
- **Settings reachable from the native Edit menu.** The **Edit ▸ Settings…** item (accelerator
  `Ctrl+,`) opens the Settings modal via the `menu:open-settings` main→renderer IPC push; the
  redundant gear button in the workspace tab bar was removed.
- **Success/info toast notifications default off.** Bottom-right success and info toasts are
  suppressed unless explicitly enabled in Settings → General; **error toasts always render** so
  failure feedback is never silenced.

### Fixed
- **`npm run package` now builds the remote-agent bundle.** The package script ran
  `electron-vite build` directly — which never invokes `vite.agent.config.ts` — so a fresh
  checkout (i.e. the release workflow) would reach electron-builder with no
  `out/agent/termhalla-agent.cjs` for the `extraResources` entry to ship: the v0.12.0 tag push
  would have failed (or shipped a stale agent locally). It now composes `npm run build`, the
  same two-step the gate profile verifies. Caught in release prep; packaging is the one chain
  the per-feature and integration gates never exercise. (2026-07-05)
- **A `pty:resize` racing a just-exited process no longer freezes the whole app.** node-pty
  (ConPTY) sets its exit state at real process exit but withholds the exit *event* for
  `FLUSH_DATA_INTERVAL` (1 s) to drain conout — so a genuine mosaic re-layout (splitting, a second
  pane committing, a drawer opening) could fire a resize for a pane whose process died moments
  earlier, and `pty.resize()` threw `Cannot resize a pty that has already exited` *uncaught inside
  the fire-and-forget `ipcMain.on` listener*. Electron's default handler raises a **modal "Error"
  dialog that blocks the main event loop forever** — a hard app freeze with an invisible dialog.
  Real-world trigger: any short-lived launch pane (an ssh typo, `claude` not on PATH) followed
  within ~2 s by any layout change. `PtyManager.resize` now drops the meaningless dead-pty resize
  (an unavoidable TOCTOU — the renderer cannot see the delayed exit). Found by TEST-609
  (`orky-queue-actions.spec.ts`) on the first full e2e run since 0008. (2026-07-04)
- **Escape from a Modal-hosted picker now restores focus to its opener (CONV-020).** Since 0009,
  `useOpenFocusRestore` captured its restore target in a passive effect — which runs *after* the
  child `Modal`'s own pull-focus-into-the-dialog effect (child-first ordering), so it recorded the
  Modal's card (an element that unmounts with the picker) instead of the real opener. On Escape the
  restore no-oped, focus collapsed to `<body>`, and Modal's collapse guard legally refocused the
  active terminal — exactly the "yanked into the terminal a microtask later" class the CONV-020
  contract forbids, on *every* `useOpenFocusRestore` surface nested in a Modal (root picker, queue
  answer forms, capture modal). The opener is now captured in `useLayoutEffect` (layout phase
  precedes all passive effects); open/close focus timing otherwise unchanged. Pinned by TEST-465.
  (2026-07-04)
- **An undocked (or redocked / minimize-restored) Claude pane's ✨ chip no longer goes
  permanently dark in its new window.** `aiSession` pushes are pane-scoped (routed to the
  *owning* window) and the tracker is sticky with set-only dedup — a quiet agent keeps
  classifying identically and never re-emits, so a window that adopts a running pane starts
  with an empty `aiSessions` map it can never fill (the aiSessions-keyed usage display went
  dark with it). The `pty:spawn` adoption branch now re-delivers the pane's sticky session
  (`AiSessionTracker.reemit`) after the snapshot replay — the push twin of the codebase's
  missed-push recovery pulls. Fresh spawns and the remote branch untouched. Surfaced by
  `undock-resume.spec.ts` line 99 — which, it turns out, had never passed (the v0.10.1
  behavior it guards was and is correct; its final chip assertion was unsatisfiable by
  design), and it now passes byte-untouched. (2026-07-05)
- **e2e suite un-rotted after its first full run since 0008** (the Orky gate profile runs
  build+vitest only, so Playwright drift accumulated invisibly): the never-green `orky-notify`
  specs were repaired via a strictly-inert main-process test seam (`TERMHALLA_E2E_NOTIFY_SPY=1`
  records needs-you toasts on a global instead of constructing OS notifications — evaluate-time
  module patching is impossible against the ESM main bundle) plus readiness/debounce-race fixes;
  `playwright.config.ts` `globalTimeout` scaled 20 → 60 min (the 20-min cap silently guillotined
  79 of the now-185 specs, repeating the documented 600 s incident). Wave 2: `orky-status`
  TEST-055's probe resolved a custom property (`--status-failure`) that has never been defined
  in the repo's history — it computed transparent since birth; the probe now mirrors the
  fallback-carried expressions the CSS actually paints with (the failure accent itself renders
  correctly). The 5 `clipboard.spec.ts` failures were adjudicated **environmental**, not
  product: the box's OS clipboard was wedged by live redirectors (Horizon / Phone Link /
  PowerToys AdvancedPaste) — `Set-Clipboard` failed from bare PowerShell with Termhalla not
  involved; re-run that file once the redirectors are quiesced. (2026-07-04/05)
- **Undocking a workspace no longer types `claude --resume` into a live Claude session.** The
  auto-resume gate keyed off the renderer-side scrollback stash to recognize "this mount re-adopts
  a still-running PTY" — but a multi-window tear-off remounts the pane in a *different* renderer,
  where that stash is empty (the snapshot rides main's transit buffer instead), so a pane stamped
  `resumeAi: 'claude'` looked like a fresh spawn and fed `claude --resume` to the live agent as a
  prompt. `pty:spawn` now resolves with main's authoritative adopted-a-live-PTY answer and the
  gate (`shouldAutoResumeClaude`) requires both signals clear. Guarded by
  `tests/e2e/undock-resume.spec.ts`.
- **Opening a dialog now moves keyboard focus into it.** A modal opened over a focused terminal
  (e.g. Settings via Ctrl+,) left focus in the xterm textarea, so typing kept going to the shell
  behind the scrim. The shared `Modal` card now takes focus on open — guarded so dialogs with
  their own `autoFocus` field (palette, broadcast, env passphrase, SSH form) keep it. Re-greens
  the frozen `focus.spec.ts` dialog test.
- **The templates menu no longer wedges the tab strip after a Settings round-trip.** The menu's
  invisible full-viewport click-catcher survived Settings opening over it, silently swallowing
  the next click on the tab strip (frozen TEST-018). The menu now dismisses when a modal opens
  over it; saving a template still keeps it open (`workspace-templates.spec.ts`).
- **No more blocking MSVC "Assertion failed" dialog from ConPTY on forced shutdown.** node-gyp
  Release builds leave raw `assert()` calls live, so node-pty's ConPTY teardown race
  (`conpty.cc` `remove_pty_baton`) could pop a modal CRT dialog — and block app exit — when the
  process was force-closed with a live PTY. The node-pty patch now also defines `NDEBUG` for the
  Windows targets, compiling the asserts out (verified: the assert string is gone from the
  rebuilt `conpty.node`).
- **A maximized pane no longer bleeds through other workspaces.** The maximize CSS punched
  `visibility: visible` through the sibling-hiding rule — but a descendant's `visible` also
  overrides the *inactive workspace host's* `visibility: hidden`, so an inactive workspace's
  maximized tile kept painting under any transparent active workspace (most visibly a brand-new
  empty one, whose +Terminal/+Editor/+Explorer buttons floated over the phantom pane). The
  punch-through is now scoped to the active host, and workspace hosts carry an opaque themed
  background as a mask. Guarded by `tests/e2e/pane-actions.spec.ts`.
- **Workspace rename can no longer have its focus stolen by the terminal.** Activating a
  workspace kicks off a pane-refocus retry loop (`requestPaneFocus`) that kept pulling keyboard
  focus into the terminal for ~20 frames; a rename opened inside that window (e.g. double-click
  on an inactive terminal-holding tab) was focus-yanked → blurred → auto-committed before you
  could type. The focus machinery now never steals from an editable chrome control (a text field
  outside any pane body) and stops retrying the moment one takes focus — pane-owned editables
  (xterm/Monaco) still refocus normally. Unit-tested (`isEditableChromeFocus`) + e2e
  (`workspace-mgmt.spec.ts`).
- **Crowded workspace tab strip keeps a constant single-line height (no more badge-driven
  resize oscillation).** When many tabs squeezed the strip, tab text wrapped to a second line
  *inside* the buttons, growing the strip; a status badge ("Waiting") appearing could then
  toggle the wrap, resizing the terminal area each time — which forced a ConPTY repaint the
  status tracker read as fresh output, flipping the badge again in a visible appear/disappear
  loop. Tabs now shrink with an ellipsis (`nowrap`, capped width) and the right-side controls
  never shrink, so a badge change can never change the strip height. Guarded by
  `tests/e2e/tab-strip.spec.ts`.
- **Status-bar buttons no longer shift when the rotating hotkey tip changes.** The tip now sits
  to the *left* of the search/notes/queue buttons (the flex spacer absorbs its width changes),
  so the buttons stay pinned to the right edge.
- **Tearing off a workspace now shows a drag ghost beyond the window edge.** The in-window DOM
  ghost is clipped at the window boundary, so an undock drag (off the window / toward another
  monitor) had no visual feedback at all. Main now shows a frameless, click-through, always-on-top
  ghost chip window that follows the screen cursor once it leaves every app window (and hides
  again inside one, where the DOM ghost takes over); it is destroyed on drop, window close, and
  quit. New fire-and-forget `win:dragGhost` channel; show/hide decision unit-tested
  (`ghostVisibleAt`), lifecycle e2e-tested (`undock.spec.ts`).
- **Template-instantiated workspaces are now durable (they survive window reloads and
  quit→relaunch).** The shipped "new workspace from template" menu path
  (`newWorkspaceFromTemplate`) registered the workspace but never reported it into main's
  authoritative window arrangement, so it was **silently lost** on the next pushed assignment
  (window reload, main-promotion, move/redock) and orphaned across quit→relaunch. The shared seam
  now calls `reportAssignment` on the success path (over the existing `winReport` channel — no
  new IPC or write path), fixing the loss for ALL templates, previously saved ones included.
- **Orky pane inline actions stay reachable in a narrow tile.** The `orky-pane-row-actions` slot
  was `flex: none` (unshrinkable at the region's max-content width), forcing the features list
  into horizontal overflow-scroll in a split tile; it is now shrinkable (`minWidth: 0`) so the
  shared region's own wrapping rows engage. The pane header now wraps too, so the **+ work**
  inject button moves to a second header line instead of being pushed off a narrow tile with no
  scroll access.
- **A mode-flip disarm no longer destroys a typed draft in silence, strands focus, or leaves a
  stale alert.** When a data-driven reason flip disarms an open answer form (both the queue and
  pane mounts), a NON-EMPTY typed draft now surfaces a draft-lost notice through the store toast
  chokepoint on the never-suppressed error kind; if the flip collapsed keyboard focus to `<body>`
  (the escalation-resolved vector unmounts the answer toggle with the form), focus re-anchors onto
  the still-mounted actions region; and a failed escalation binding can no longer resurface as a
  stale `escalation-unbound` alert beside a later re-opened verdict form of the other mode (the
  alert is escalation-mode-gated).
- **An Orky action outcome settling while its pane is hidden now surfaces as a toast.** The pane
  mount lives inside keep-mounted-hidden hosts (inactive workspace, maximized-over, minimized), so
  an answer dispatched from the pane could settle invisibly after a workspace switch — inviting a
  blind duplicate re-dispatch. OrkyPane now threads its own `hidden` prop into the shared region,
  and a hidden-at-settle outcome rides the same store toast chokepoint a detached (unmounted)
  settle already uses, while the hidden pane still records the settled state for its return.
- **Stale "read-only drawer" docs corrected.** `CLAUDE.md`'s decision-queue drawer row and
  `docs/features/decision-queue.md` no longer claim a read-only/never-invokes-CLI drawer — both
  now describe the composed write-capable `OrkyEntryActions` region the rows have mounted since
  feature 0008 (F6's own files still own no dispatch).
- **Idle Orky roll-up no longer masks the pane's real border/failure treatment.** `orkyPaneStatus([])`
  returns a non-null idle roll-up (`chipFeature: null`) whenever a project has no popover-eligible
  features, and PaneTile keyed the border precedence on the roll-up merely being **present** — so a
  terminal sitting in an idle Orky project lost its real busy/needs-input border and its
  `lastExit: 'failure'` accent while the chip correctly hid itself. The precedence now keys on the
  SAME `chipFeature` condition the chip uses (extracted as the pure `paneBorderStatus` helper); an
  idle roll-up falls through to the byte-derived status.
- **Mixed-case Orky findings count toward `●k open`.** `openBlockingCount` compared finding
  `status`/`severity` exact-case, but the producer compares case-insensitively (canonical
  `open`/`HIGH`, per `gatekeeper contract`'s `finding_normalization`). Termhalla now folds case the
  same way, so an `"Open"`/`"Critical"` finding no longer silently drops out of the chip count.
- **A stale overlapped `.orky/` re-read can no longer clobber a newer one.** Two overlapping re-reads
  of the SAME root had no ordering guard — an older, slower read (the walk covers up to 200 feature
  dirs) could resolve after a newer one and emit stale status last. `OrkyRootEngine.reread` now stamps
  a per-root, monotonically increasing generation token (claimed before the first await, re-checked
  after every await — the existing session-identity race pattern) and abandons when superseded. The
  300ms debounce timer is also `unref()`'d (mirroring `StatusEngine`) so a pending re-read never keeps
  the Electron main process alive.
- **Registry mutations persist FIRST and honor the never-throws contract.** `registry:addRoot` /
  `registry:removeRoot` mutated the in-memory persisted list **before** `store.save(...)`, so a save
  rejection (disk full / EPERM) left memory diverged from disk and propagated a rejection through the
  IPC registrar to the renderer — contradicting the documented "NEVER throws; on failure the list is
  left unchanged" contract. The next list is now saved before memory is touched; a failed save
  resolves to a structured `{ok:false, …}` result with the list unchanged in both places, and a later
  retry of the same root starts clean. The registry also **prunes** a root's cached status when it
  leaves both membership sources (`statusByRoot` previously only ever grew over a long session).
- **Restoring a minimized Claude pane no longer re-issues `claude --resume`.** Minimizing then
  restoring a terminal running Claude Code — and any other re-adoption of a still-running PTY (a
  same-window cross-workspace move or a multi-window handoff) — kept the live session running but
  *also* re-fired the auto-resume, typing `claude --resume` into the already-running agent, where it
  landed as a prompt instead of a command. Auto-resume now fires **only on a genuinely fresh shell
  spawn** (app start, or a newly opened pane restoring a persisted Claude session), never when
  re-adopting a live PTY — detected by the consumed scrollback snapshot that marks a re-adoption.
- **Windows `node-pty` rebuild is now one command (`npm run rebuild:native`).** The native terminal
  binding failed to compile in two Windows-local situations the manual `electron-rebuild` path
  didn't handle: a Microsoft Store `python.exe` alias stub that node-gyp can't use, and
  `NoDefaultCurrentDirectoryInExePath=1` (a security-hardening env var) that stops cmd.exe finding
  winpty's `GetCommitHash.bat`. A new `scripts/rebuild-native.mjs` resolves a real interpreter via
  the `py` launcher and strips the env var from the build subprocess only (OS hardening untouched),
  so the rebuild "just works". Cross-platform-safe — the Windows guards no-op elsewhere.
- **The env-vault e2e no longer race app boot.** `env-per-terminal` and `env-vars` pressed `Ctrl+,`
  immediately after the window opened — before the renderer's shortcut handler was live — so
  Settings never opened. They now wait for the workspace chrome (`workspace-tabs`) first, the same
  readiness gate the other settings specs already use.
- **`npm run typecheck` is green again.** The e2e specs' `page.evaluate` callbacks reference DOM
  globals (`document`, `window`, `HTMLElement.dataset`, …) but were type-checked under the DOM-less
  node config, producing 47 spurious errors. A dedicated `tsconfig.e2e.json` (the node config plus
  the DOM lib, scoped to `tests/e2e`) restores them while keeping main-process and `tests/main` code
  DOM-free; a few genuine `tests/main` type slips (a QuickStore cast, a mock signature) were fixed too.

## [0.14.0] - 2026-07-06

Remote node-pty prebuilt co-provisioning (Remote Agent v1, F22). A released installer now
ships a prebuilt native `node-pty` for the v1 target `linux-x64-glibc`, and connecting to a
matching remote co-provisions it onto the agent's `node_modules` before launch — so the
agent's lazy `import('node-pty')` resolves on a stock remote with only `node` installed, no
manual setup (fixing the `ERR_MODULE_NOT_FOUND` that broke remote workspaces on hosts without
node-pty, e.g. OpsHub on 0.13.0). The install self-repairs from a corrupted/torn binary
(ground-truth sha re-verify every connect, never trusting a self-written marker), the promote
is a race-tolerant rename-first transaction (concurrent installs both succeed), and integrity
is a per-file sha-256 manifest verified at the release gate and again on the remote. A new
`build-node-pty-linux` release job builds the binary on an old-glibc base; nothing native is
committed. Strictly additive — `connectWithProvisioning` is byte-identical without the option
— with no SCHEMA_VERSION bump, no persisted state, and no secrets. The detailed entry stays
under [Unreleased] above, per the same convention the 0.9.0–0.13.0 releases recorded (the
frozen doc-drift guards pin per-feature detail there).

## [0.13.0] - 2026-07-05

File menu — save, close, and reopen a workspace as a document. A native File menu
(New · Open · Reopen Closed · Save · Save As… · Exit) makes a workspace a first-class
document: Save As… writes a portable `.thws` file, Open reads one back, and Reopen
Closed Workspace… brings back (or permanently deletes) a workspace that was closed —
each pane restored at its saved cwd, SSH session, and `claude --resume`. The document
format is the existing versioned workspace record, so there is no SCHEMA_VERSION bump.
The detailed entry stays under [Unreleased] above, per the same convention the
0.9.0–0.12.0 releases recorded (the frozen doc-drift guards pin per-feature detail there).

## [0.12.0] - 2026-07-05

Remote Agent v1 — tmux-style remote sessions (Orky epic F15–F21 + the cross-feature
integration phase), plus the e2e un-rot sweep that followed it (three shipped product
bugs found and fixed once the full Playwright suite ran for the first time since 0008).
The detailed entries stay under [Unreleased] above, per the same convention the
0.9.0/0.10.0/0.10.1/0.11.0 releases recorded (the frozen doc-drift guards pin
per-feature detail there).

## [0.11.0] - 2026-07-04

Tagged release shipping the workspace tab-strip rework — equal, compact fixed-width tabs with status
badges pinned **before** the name, long names that **scroll horizontally** instead of truncating,
**◀/▶ overflow scroll buttons** when the strip is crowded (active tab kept in view), and a secondary
**"pipe" border** on every tab (accent on the active/hovered tab). Everything is paint-only or
fixed-size, so the strip keeps its constant single-line height (the ConPTY-repaint-oscillation guard).
The detailed entry stays under [Unreleased] above, per the same convention the 0.9.0/0.10.0/0.10.1
releases recorded.

## [0.10.1] - 2026-07-03

Tagged release shipping one fix: undocking a workspace no longer types `claude --resume` into a
live Claude session. The auto-resume gate's re-adoption signal (the renderer scrollback stash)
doesn't survive a cross-window handoff, so the destination pane treated the adoption as a fresh
restored spawn; `pty:spawn` now resolves with main's authoritative adopted-a-live-PTY answer and
the gate requires both signals clear. Guarded by `tests/e2e/undock-resume.spec.ts`. The detailed
entry stays under [Unreleased] above, per the same convention the 0.9.0/0.10.0 releases recorded.

## [0.10.0] - 2026-07-03

Tagged release shipping the Orky gatekeeper contract v2 re-mirror (0015) — strict
`EXPECTED_CONTRACT_VERSION` pin at 2, golden fixtures regenerated from the generation-time producer,
`phase_order` provenance reconciled, and the new resolved-finding resolution display in the Orky pane
(`resolution`/`resolvedBy`/`resolvedAt` with the non-empty guard + full-text title mirror) — plus the
seven-bugfix UI/PTY batch (workspace bleed-through, rename focus steal, tab-strip oscillation, OS drag
ghost, status-bar shift, modal focus, ConPTY assert dialog). The per-feature detail stays under
[Unreleased] above, pinned there by the frozen per-feature doc-drift guards (the same known gap the
0.9.0 release recorded).

## [0.9.0] - 2026-07-03

Tagged release shipping the Orky integration tier (F5–F14) — cross-project registry, decision-queue
drawer, action-dispatch substrate, one-click answer/resume, native OrkyPane + inline actions,
per-project cockpit workspace, quick-capture inbox, OS needs-you notifications, and OSC-heartbeat
consumption — plus the Windows `node-pty` durable rebuild and the restored green typecheck gate. The
per-feature detail stays under [Unreleased] above, pinned there by the frozen per-feature doc-drift
guards pending a dedicated changelog doc-sync pass (a known Termhalla-side gap).

## [0.8.0] - 2026-06-30

### Added
- **Orky status awareness in the pane chrome.** A terminal pane whose tracked cwd sits inside an
  `.orky/` project (an Orky gated-pipeline run) now surfaces that run's live **status** directly in
  the pane chrome — a read-only mirror, derived purely from reading the on-disk `.orky/` JSON
  (`active.json`, `features/*/state.json`, `findings.json`); it never spawns a CLI and never writes
  into `.orky/`. The pane toolbar gains an **Orky chip** labelled `feature · phase · gate N/M · ●k
  open` with a detail popover listing every active feature's phase, gate progress, open-blocking
  findings, and "needs you" reason. Detection is **gate-based**: the live phase is `active.json.phase`
  for the active feature and the gate frontier for the rest, and "needs a human" is derived from the
  gates (autonomous gates through `doc-sync` passed while `human-review` is pending), an open
  escalation, or a stalled heartbeat — taking **precedence** over the byte-derived terminal status for
  the pane border and lighting the workspace tab's 🔔 needs-you badge; a halted gate failure surfaces
  as a rendered failure accent. Status is pushed over a new pane-scoped `orky:status` IPC channel
  (validated + per-window scoped) from a bounded, debounced, disposable main-process watcher (one
  watcher/read per `.orky/` root); nothing is persisted (`SCHEMA_VERSION` unchanged). See
  `docs/features/orky-status.md`.

### Fixed
- **Restoring a minimized Claude pane no longer re-issues `claude --resume`.** Minimizing then
  restoring a terminal running Claude Code — and any other re-adoption of a still-running PTY (a
  same-window cross-workspace move or a multi-window handoff) — kept the live session running but
  *also* re-fired the auto-resume, typing `claude --resume` into the already-running agent, where it
  landed as a prompt instead of a command. Auto-resume now fires **only on a genuinely fresh shell
  spawn**, never when re-adopting a live PTY — detected by the consumed scrollback snapshot that marks
  a re-adoption.

## [0.7.0] - 2026-06-30

### Added
- **Minimize / restore panes.** A pane can now be **minimized** out of the visible tiled layout
  while staying fully alive in the background (its PTY keeps running, xterm scrollback / Monaco
  models / live TUIs are preserved — kept mounted off-layout, never unmounted). Minimizing reflows
  the remaining panes to fill the freed space. Minimize from the pane toolbar button, the title-bar
  right-click menu, or the rebindable **Minimize pane** keybinding (`Ctrl+Shift+H` by default). Each
  workspace shows a per-workspace **tray** of restore chips — one chip per minimized pane, surfacing
  its live status (running/idle, **needs-input**, recording, AI session) — and clicking (or
  keyboard-activating) a chip restores the pane, split to the right. Minimizing every pane shows an
  all-minimized empty state with the tray as the restore home. Minimize and maximize are mutually
  exclusive on the same pane. Minimize and maximize view-state are now **persisted** across reload
  (`SCHEMA_VERSION` 6 → 7 with an explicit, lossless migration); only pane id references / flags are
  stored — never any pane content or secrets. Output produced *during* the minimize↔restore
  transition is buffered and replayed so nothing is dropped from scrollback; an Explorer's expanded
  folders survive a minimize/restore; a backgrounded terminal whose shell exits shows a distinct
  **exited** chip rather than reading as idle; and the tray strip never swallows clicks meant for the
  reflowed terminal beneath it.

## [0.6.0] - 2026-06-29

### Changed
- **Pane toolbar cleanup + unified split-direction control.** The per-pane Record toggle (the ⏺
  button) was removed from the pane toolbar and moved into the pane title-bar **context menu**
  (right-click menu) as a terminal-only **Start recording / Stop recording** item that reflects the
  same recording state. The two separate split buttons (split-right ⬌ and split-down ⬍) were
  collapsed into a single **split** button that opens one combined popover: a four-direction
  **compass** offering **up**, **down**, **left**, and **right** plus a Terminal/Editor/Explorer
  kind selector. Pick a kind, then activate a direction (mouse or keyboard — the compass is fully
  arrow-key navigable with the right direction highlighted by default) to commit the split. The
  popover is portalled to `<body>` and fully keyboard- and screen-reader-accessible (roving focus,
  Enter commits, Esc dismisses, focus trapped and returned to the split button on close).
- **`splitPane` supports before/after insertion.** The pure layout helper now accepts a
  `position: 'before' | 'after'` argument (default **after**, byte-for-byte today's output). A
  `left`/`up` compass split inserts the new pane **before** the source (as the parent's `first`
  child); `right`/`down` inserts it **after** (`second`). The persisted `MosaicNode` shape is
  unchanged (no schema bump).

## [0.5.0] - 2026-06-29

### Changed
- **Settings moved to a native Edit menu.** A new top-level **Edit ▸ Settings…** menu item
  (accelerator `Ctrl+,`) opens the Settings modal at the General section, via a new
  `menu:open-settings` main→renderer IPC push. The redundant ⚙ gear button in the workspace tab
  bar was removed; Settings remains reachable from the Edit menu, the Command Palette, the pane
  context menu, and the `Ctrl+,` keybinding.
- **Success/info toast notifications now default OFF.** Bottom-right success and info toasts are
  suppressed unless explicitly enabled via Settings → General ("Show success and info toast
  notifications (errors always show)"). **Error toasts always render** regardless of the setting, so
  failure feedback (e.g. the editor "Save failed" signal) is never silenced. Existing installs (and
  any `quick.json` predating the preference) read as OFF with no migration; the `toastsEnabled`
  preference is additive (no schema bump). Suppression is gated at the single `pushToast` chokepoint,
  which branches on toast kind.

## [0.4.2] - 2026-06-22

### Fixed
- **Terminal copy no longer "sometimes" silently fails.** Two structural fragilities made copy
  intermittent, especially in a live pane (e.g. a running Claude Code session):
  - *Copy raced terminal output.* Ctrl+C only copied if `term.hasSelection()` was still true at the
    keypress, but incoming output clears the xterm selection — so in an active pane the selection was
    often gone by the time you pressed the key, and Ctrl+C fell through as a bare `^C` (copying
    nothing). New **copy-on-select** (default on) copies a selection the instant the mouse gesture
    ends, before any output can clear it; the selection is left visible and Ctrl+C still works as a
    manual copy. Toggle under Settings → General ("Copy terminal selection to clipboard on select").
  - *The write was fire-and-forget.* The Windows clipboard is a single global lock that RDP / VMware
    Horizon / PowerToys AdvancedPaste / Phone Link clipboard redirectors grab right after any change;
    Electron's `clipboard.writeText` fails silently in that window. The main-side write now verifies
    by read-back and retries with a short backoff (`writeTextReliably`), surviving the lock contention.

## [0.4.1] - 2026-06-21

### Fixed
- **cmd.exe terminals now retain their working directory across restarts.** Some workspaces never
  kept their cwd even on a plain close/reopen — those running `cmd`. Persistence was sound; the gap
  was *detection*: cmd got no shell-integration injection, so it never emitted a cwd report and there
  was nothing to save. (The v0.3.7 atomic-write/flush fix addressed a different bug — truncated files
  on auto-update restart — not this one.) cmd has no `PROMPT_COMMAND` hook, but it expands codes in
  its `PROMPT` env var every prompt, so `shellInjection` now sets `PROMPT=$E]9;9;$P$E\$P$G` to emit
  `OSC 9;9;<cwd>` (ST-terminated — cmd's `PROMPT` can produce ESC but not BEL) ahead of the normal
  `path>` prompt. `CwdParser` reads it like the script-based shells, so the cwd persists and restores.
  cmd *status* detection is unchanged (still heuristic — no OSC 133 markers added). Covered by a new
  e2e that cd's a cmd pane, relaunches, and asserts the directory is restored.

## [0.4.0] - 2026-06-21

### Added
- **Clickable terminal links + image preview.** Ctrl/Cmd+click a URL in any terminal to open it in
  the browser, or a referenced image (local path or http(s) image URL) to preview it in a lightbox.
  Detection runs on the rendered buffer, so it works under cmd/PowerShell/tmux/ssh. Local-path
  previews are disabled in SSH panes (the file is on the remote); image URLs still work there.

### Fixed
- **SSH tmux options no longer break the connection on Windows.** With a tmux session *and* any
  option enabled (mouse is on by default, so this hit almost every tmux favorite), the connection
  dropped to a bare remote shell — tmux never started and the terminal's Device-Attributes report
  (`ESC[?…c`) leaked onto the prompt as `61: command not found`. The options were appended as
  arguments to a single `tmux new \; set …` using tmux's `\;` separator, whose backslash did not
  survive Windows `ssh.exe` argv parsing, so tmux never received its separator. Each option is now a
  separate `tmux set` command joined by a bare shell `;` (which survives every quoting layer), and
  the session is `exec`'d to attach. Connections with no options were unaffected and still use the
  bare `tmux new -A -s NAME` form.

### Changed
- **"Redraw terminal" (Ctrl+Shift+L) is now aggressive enough to fix a garbled running TUI.** It
  previously only repainted xterm's own buffer plus a same-tick ±1-col resize that ConPTY could
  coalesce into a no-op, so it couldn't clear corruption living in a running program's frame (a
  half-cleared overlay, a merged Claude/tmux repaint). It now does a real cross-tick SIGWINCH nudge
  (shrink the grid 2×2, restore next tick) and sends Ctrl+L so the program re-emits a clean frame.
  As a result it may clear the screen (Ctrl+L), so it no longer preserves prior on-screen content.

## [0.3.7] - 2026-06-20

### Fixed
- **Persisted state survives an interrupted/auto-update quit.** Workspaces (incl. each terminal's
  saved cwd) and `quick.json` (SSH connections, theme, keybindings) were written with a plain
  `writeFile`, which truncates the file before writing. On quit those writes also fired
  fire-and-forget from the renderer, and the auto-update installer tore the process down mid-write —
  leaving truncated files that the loaders silently degraded to defaults on next launch (SSH
  connections wiped, some workspaces reset to their spawn directory). Two fixes: (1) **all stores now
  write atomically** (temp file + `rename`, with a retry on transient Windows `EPERM`/`EBUSY`), so an
  interrupted write can never corrupt the previous good file; (2) **quit now waits for renderers to
  flush** their workspace/quick state to disk (bounded by a 2s timeout) before the process exits.

### Added
- SSH favorites: configurable tmux options (mouse, true color, faster Esc, scrollback,
  OSC 52 clipboard) applied via `set -g` on connect. Mouse mode is on by default, fixing
  wheel-scroll inside full-screen TUIs (e.g. Claude Code) under tmux.

### Fixed
- **Ctrl+V no longer pastes twice.** The terminal's custom key handler returned `false` for Ctrl+V
  without calling `preventDefault`, so the browser still fired a native paste event that xterm's own
  listener handled too — pasting the clipboard a second time. The handler now prevents the default,
  so a paste happens exactly once.
- **Auto-update installs silently and relaunches.** The "Restart now" update flow ran the NSIS
  installer interactively — popping the full wizard (install-scope "all users / just me" question,
  install dir, "launch Termhalla?" checkbox) on every update. `quitAndInstall(true, true)` now runs
  the installer with `/S`, applying the update the same way it was already installed (per-user) with
  no prompts, then auto-launches Termhalla afterward.

## [0.3.5] - 2026-06-18

### Added
- SSH favorites can open in a named tmux session (`tmux new -A -s <name>`), attached-or-created on
  connect and reattached automatically on reconnect/restart.

## [0.3.4] - 2026-06-18

### Fixed
- **Dropdown menus are readable again.** Native `<select>` option popups (the tab bar's shell picker
  and "+ pane" menu, plus the dialog dropdowns) inherited the light chrome text on Chromium's
  default-light popup background — white-on-white. `<option>` is now themed (elevated background +
  luminance-adaptive text), so the popups are legible on light and dark themes.
- **Claude usage % no longer freezes on a stale value.** When a session's transcript is rotated or
  removed between being resolved and read, the usage tracker now clears the metric (and logs the
  read failure) instead of silently leaving the chip on its last value.
- **Previously-silent main-process failures are now diagnosable.** The Windows process-table query
  (process chips), cloud-CLI output parsing, and the encrypted env-var vault each swallowed errors
  with no log. They now emit a warning — the vault distinguishes an unreadable/permission-denied
  file from an ordinary wrong passphrase (which stays quiet) — so blank chips and failed unlocks can
  be traced.

### Changed
- **Editor drafts and the per-project notepad now flush on every window's close**, not just the main
  window's, so a floating (undocked) window that closes before main still persists its in-memory
  state. Both already wrote live on each edit; this completes the shutdown safety net.

## [0.3.3] - 2026-06-18

### Fixed
- **tmux (and other full-screen TUIs) no longer launch with a garbled first frame.** Under xterm's
  DOM renderer the initial alternate-screen draw occasionally renders garbled (a known renderer miss
  a repaint cures; subsequent frames are fine). The terminal now repaints once, after the draw
  settles, whenever it enters the alternate screen — detected from the byte stream, so it works for
  tmux over ssh (where the remote process isn't visible locally). Re-arms on each entry; no-op for
  normal shell use.

## [0.3.2] - 2026-06-18

### Fixed
- **SSH connection dialog is now typeable immediately.** Opening it from the command palette is a
  modal→modal handoff (the palette closes as the form opens); the palette's close was bouncing focus
  to the active terminal and stealing the form's autoFocus, so fields couldn't be typed into until
  the window was refocused. The terminal is now refocused only when the *last* overlay closes
  (deferred, open-modal-counted), so a dialog opened by another dialog keeps its focus.
- **Terminal resize no longer risks desyncing the grid from a remote TUI.** The post-resize
  auto-repaint now only re-renders xterm (it no longer re-runs `fit()` without a matching PTY
  resize), so xterm and a remote app (e.g. tmux over ssh) can't end up disagreeing on the size. The
  manual "Redraw terminal" command (Ctrl+Shift+L) still does a full re-fit + PTY nudge.

## [0.3.1] - 2026-06-18

### Fixed
- **Cloud status no longer gets stuck on "cloud status…" after the first run.** The `cloud:status`
  push is fire-and-forget; if it fired before the renderer subscribed (more likely when restoring a
  saved session, where the CLI probe can finish first), it was lost and the dedup guard blocked a
  re-send, leaving the chip stuck on the empty placeholder. The renderer now pulls the current
  status on mount (`cloud:current`), mirroring the existing `winReady` handshake used for
  `win:assignment`. The cloud IPC handlers are also removed on teardown.

### Changed
- **Installer filename is now version-less: `Termhalla-Setup.exe`** (was `Termhalla-Setup-<version>.exe`).
  Each release still carries its real version in `latest.yml`, so auto-update is unaffected.

## [0.3.0] - 2026-06-18

### Added
- **Split buttons offer Terminal / Editor / Explorer.** The pane split buttons no longer open a
  terminal directly — each opens a small menu to choose what the split creates, in that direction.
  Terminal and Explorer inherit the source pane's working directory.
- **Auto-resume Claude on restart.** Terminals that had Claude running when the app last closed
  re-run `claude --resume` once the restored shell is ready (in the saved cwd). On by default;
  toggle under Settings → General. A `resumeAi` marker is folded into each terminal's persisted
  config at save time (no AI session content is stored).
- **Redraw a garbled terminal.** A resize now repaints the terminal once it settles, and a new
  "Redraw terminal" command (Ctrl+Shift+L, rebindable) forces a full repaint — re-fitting xterm and
  nudging the PTY so a running TUI (e.g. Claude) redraws — for cases a resize left scrambled.
- **Ctrl/Cmd + scroll zooms the terminal font.** Holding Ctrl (or Cmd) while scrolling over a
  terminal grows/shrinks the global terminal font size (clamped 8–32), applied to every terminal
  via the existing theme path. Pure step/clamp logic is unit-tested (`font-zoom`).
- **Panes take focus automatically.** A newly created terminal/editor pane is focused so you can
  type immediately; switching workspaces focuses that workspace's pane; and closing a dialog
  returns focus to the active pane. A small per-pane focus registry retries across frames so it
  works even while a pane is still mounting or its workspace is mid-switch.

### Fixed
- **`ssh` / `aws` launches no longer fail with "File not found".** node-pty's Windows resolver
  matches a bare launch command verbatim against `Path` (no PATHEXT), so `ssh`/`aws` never matched
  `ssh.exe`/`aws.exe`. Launch commands are now resolved to a full path (PATH + PATHEXT) before
  spawning. (`resolve-bin.ts` moved to `src/main/` as a shared utility.)
- **Toast notifications no longer appear to "block typing".** The real cause was that the app did no
  programmatic focus management at all: after interacting with an overlay (which fires most toasts),
  focus was never returned to the terminal. Fixed by the focus work above. Global keyboard shortcuts
  (command palette, workspace switch, …) now also reliably pass through a focused terminal to the
  app handler instead of being swallowed by xterm.

## [0.2.1] - 2026-06-18

### Added
- **Multi-profile AWS cloud status.** The AWS chip in the status bar now covers every
  profile configured in `~/.aws/config` (`[default]` + `[profile X]` sections, capped
  at 8, `['default']` fallback when the file is missing or empty). Each profile is probed
  independently with `aws sts get-caller-identity --profile X`; login opens a terminal
  running `aws sso login --profile X`. The status-bar chip shows a `N/M` logged-in count
  when there are multiple profiles, and the popover lists each profile as its own row with
  its own state glyph and Login button. Provider list is resolved per refresh cycle so
  profile additions/removals take effect without restarting the app. `CloudStatus` gains
  `family` and `profile` fields; a new pure `groupCloudStatuses` helper collapses the flat
  status array into per-family groups for the renderer. Azure is unchanged. Pure logic
  covered by new vitest suites (`aws-profiles`, `group-cloud`); e2e updated to the grouped
  chip assertions.
- **MIT license.** The project is now MIT-licensed (`LICENSE`, `package.json` `license` field).
- **Distribution channels.** Every release now also ships a portable `Termhalla-<version>-win.zip`
  (unzip-and-run, no SmartScreen prompt) alongside the NSIS installer. winget manifests
  (`packaging/winget/`) and a Scoop manifest (`packaging/scoop/`, installs the portable zip,
  hash-verified) are provided. A `packaging/signing.md` documents the (deferred) code-signing setup
  and the auto-update ordering caveat.

### Changed
- **Release publishing hardened.** Releases are now built with `electron-builder --publish never`
  and published by a single `gh release create` step, eliminating the electron-builder
  concurrent-publisher race that created duplicate release objects for one tag. The NSIS
  `artifactName` is now space-free so the on-disk file, the uploaded asset, and `latest.yml` agree.
- **CI/Release actions** bumped to `actions/checkout@v5` + `actions/setup-node@v5` (clears the
  Node 20 deprecation).

## [0.2.0] - 2026-06-17

### Added
- **Searchable output history.** Terminal output is indexed in a local SQLite FTS5
  database (`search.db` under `userData`) as it streams. A **Search output history**
  modal (🔍 in the status bar or **Ctrl+Shift+F**) lets the user query across current
  and past sessions: results show a ranked context snippet and the working directory;
  **Reveal** focuses the source pane if it is still open, **Relaunch** opens a new
  terminal at the hit's cwd. Indexing is on by default with a per-terminal 🔇/📖 mute
  toggle (persisted as `historyMuted` in the pane config, schema 5→6). A **Clear
  history** button wipes the full index. A 50 000-segment retention cap prunes the
  oldest entries automatically. Privacy boundary: output only — keystrokes are never
  indexed; the index is local and never transmitted. Built on `better-sqlite3` (native,
  Electron-ABI, `asarUnpack`); pure logic (`segment-buffer`, `prune-policy`, `fts-query`)
  is unit-tested under vitest; `SearchService` + `Indexer` are validated by a Playwright
  e2e test.
- **Saved run commands.** Each terminal pane now has a `▷` toolbar button that
  opens a **Run commands** modal listing workspace-scoped and pane-scoped saved
  commands (label + shell command). Clicking `▷` next to a command sends it to
  the terminal as raw keystrokes + CR (via the existing `encodeBroadcast` path —
  no new IPC) and closes the modal. Commands can be added, edited, and deleted
  from the same modal. Two scopes: **pane** (this terminal only) and **workspace**
  (every terminal in the workspace); workspace commands appear first in the list.
  Both lists persist with the workspace JSON and ride into saved templates.
  Schema 4→5, additive — existing workspaces load unchanged. Pure list helpers in
  `src/shared/run-commands.ts`; store slice in
  `src/renderer/store/run-commands-slice.ts`. This is the persisted, manually-triggered
  sibling of the runtime-only scheduled-commands feature.
- **Per-project notepad.** A collapsible right-side drawer (📝 in the status bar,
  or **Ctrl+Shift+N**) provides a plain-text scratchpad scoped to the focused
  pane's project. The project key is the git repo root when available (from the
  git-status service), falling back to the pane's cwd, so every pane in the same
  repo shares one note. The drawer tracks the focused pane and stays on the last
  known project when focus moves to a non-terminal or a pane without a cwd yet.
  Notes persist in an app-global `notes.json` (`userData`) via a new `NotesStore`
  (modeled on `DraftStore`): async writes during editing, synchronous flush on
  window close, empty text prunes the key. Multi-window: note content is shared
  via main; open-state and shown-project are per-window. Pure helpers in
  `src/shared/project-key.ts`; store slice in `src/renderer/store/notes-slice.ts`;
  drawer in `src/renderer/components/NotesPanel.tsx`.
- **Git status on the pane chip.** Each terminal pane whose cwd is inside a git
  working tree now shows a compact git indicator in its toolbar: the current branch
  name plus a `●` dirty dot when there are staged, unstaged, or untracked changes.
  Detached HEAD is shown with a `⎇` glyph and the short commit sha. Clicking the
  chip opens a read-only detail popover with the upstream ref, ahead/behind counts,
  and staged/unstaged/untracked file counts. Non-repo, SSH/remote, and error panes
  degrade silently to no chip. The status is kept live by a ref-counted chokidar
  watch on `.git/HEAD`, `index`, and `refs/` (catches commits, staging, and
  checkouts) plus a command-idle re-probe (catches unstaged working-tree edits).
  Runtime-only — not persisted.

## [0.1.1] - 2026-06-17

### Added
- **GitHub Actions CI & releases.** Push/PR runs typecheck + unit tests on
  `windows-latest`; pushing a `v*` tag builds the NSIS installer and publishes it to
  GitHub Releases. The auto-updater now reads GitHub Releases (was a placeholder generic
  feed).
- **Help → Check for Updates.** A new application menu adds Help → "Check for Updates…"
  (with up-to-date / downloading / restart-now feedback) and "About Termhalla", plus a
  View submenu (reload, DevTools, zoom, fullscreen).
- **Rebindable keyboard shortcuts — Settings → Keybindings.** All app-level
  shortcuts (command palette, new terminal, maximize pane, broadcast, settings,
  next/previous workspace, close workspace) are now listed in a new
  **Settings → Keybindings** section. Click a row to capture a new chord; the
  UI rejects chords without Ctrl and warns on conflicts (with a confirm to
  proceed). Bindings are persisted to `quick.json` as a `keybindings` map
  (CommandId → chord string; `'none'` to explicitly unbind a command); only
  diffs from defaults are stored. **Ctrl+1–9** workspace-jump chords are always
  reserved and cannot be shadowed by a rebind. Individual bindings and the whole
  table can be reset to defaults from the same panel.
- **Rotating keyboard-shortcut tips in the status bar.** The bottom-right of
  the status bar now shows a rotating tip — "Press Ctrl+K to open the command
  palette", etc. — cycling through the five most useful shortcuts every 7 s.
  Tips automatically reflect the user's current bindings, including any
  custom chords set in the Keybindings panel.
- **Adaptive `--fg-on-elevated` contrast token.** Menus, modals, and the
  Settings panel are now readable on any theme. The new `--fg-on-elevated` CSS
  token is derived by `readableOn(elevatedBg)` (the same luminance-adaptive
  helper used for the alert bars), so a light-theme elevated surface gets dark
  text and a dark-theme surface keeps light text — fixing light-on-light
  dropdown menus and dark-on-dark Settings panel nav links. Recomputed at every
  theme scope that overrides `elevatedBg`.

### Added
- **Pane title-bar actions — right-click menu, maximize, and cross-workspace move.**
  Right-clicking a pane's title bar opens a context menu with four items: **Rename**
  (edits the title inline and persists it as an optional `name` on the pane config),
  **Move to workspace ▸** (lists the other workspaces the current window hosts, plus
  **New Workspace**), **Settings** (opens the unified Settings panel scoped to that
  pane), and **Close**. A **Maximize** toggle button (🗖 / 🗗) was added to every
  title bar; **Ctrl+Shift+M** toggles it from the keyboard. Maximizing fills the
  workspace with the current pane — siblings are hidden via CSS `visibility: hidden`
  so their xterm scrollback and Monaco models survive. The dedicated env (🔑),
  settings gear (⚙), and style (🎨) title-bar buttons were removed; those functions
  are now reached through the **Settings** menu item. Moving a terminal to another
  workspace preserves the live PTY (re-adopted by the idempotent `pty:spawn`) and its
  scrollback (the xterm instance is serialized into a renderer-side stash and replayed
  on remount). Moving an editor flushes its recovery draft so unsaved edits survive
  the transition. Moving to a **New Workspace** carries the source workspace's theme
  override so the pane renders identically in its new home. The context menu is
  portaled to `<body>` (like Modal) so it is never clipped by a mosaic tile's
  stacking context.
- **Windows packaging, auto-update, and an app icon.** `npm run package` builds a
  per-user NSIS installer (via electron-builder) and `npm run release` also publishes
  it; the build rebuilds `node-pty` for Electron's ABI and unpacks it from the asar so
  the native binary loads at runtime. Packaged apps check a generic HTTP update feed on
  launch (electron-updater; a no-op in dev). The app now ships a custom icon
  (`build/icon.ico`). Configure the publish `url` in `electron-builder.yml` before the
  first release. See [docs/features/packaging.md](docs/features/packaging.md).
- **Keyboard navigation + command menu (UI polish phase 3).** The command palette
  (Ctrl+K) now also runs commands — type to reveal **New terminal/editor/explorer**,
  **New workspace**, **Broadcast**, **Save all**, **Refresh cloud status** (the
  default connect/jump view is unchanged until you type). New global shortcuts:
  **Ctrl+Shift+T** new terminal, **Ctrl+Shift+W** close workspace,
  **Ctrl+Tab / Ctrl+Shift+Tab** cycle workspaces, **Ctrl+1…9** jump to a workspace.
  The workspace-tab strip is now arrow-key navigable (Left/Right, Home/End) with
  proper `tablist`/`tab` roles, and the broadcast dialog + palette results expose
  correct ARIA roles. Shortcuts use terminal-safe chords and only intercept keys
  they match, so the shell still receives everything else.
- **In-app toasts + file-explorer context menu (UI polish phase 2).** Discrete actions that
  used to succeed silently (saving a workspace template or theme preset, saving an SSH
  favorite, scheduling a command, adding an env var) now confirm with a bottom-right toast.
  Right-clicking a file or folder in the explorer opens a menu: Open, Reveal in File Explorer,
  Copy path / Copy relative path, Rename (inline), and Delete (to the Recycle Bin — recoverable,
  behind a confirm). The explorer now shows "Folder is empty" / "Couldn't read folder" instead
  of a blank pane, and the env-vault passphrase field auto-focuses.
- **Undock a workspace into its own window** — drag a workspace tab off the strip to tear it into
  a real OS window you can move onto any monitor; drag it back onto the main strip, click its
  **Dock** button, or hit the window's native ✕ to re-dock (✕ never kills the shells). The running
  PTYs keep going through the move and the terminal scrollback is preserved (each xterm is
  serialized and replayed into the new window). The multi-window arrangement — which workspaces are
  undocked and where each window sits — is restored on the next launch.
- **Terminal clipboard** — copy a mouse selection with **Ctrl+C** (falls back to `^C` interrupt
  when nothing is selected), and paste with **Ctrl+V** or **right-click** (bracketed-paste-safe,
  so multi-line pastes don't auto-run).
- **Per-terminal environment variables** — edit a single terminal's own env vars from its
  `🔑` button (layered over globals).

### Fixed
- **Editor saves no longer lose content on a failed write.** A rejected `fs:write` (disk full,
  permission, path removed) used to still mark the buffer clean and delete its recovery draft,
  silently discarding the edits. Save now commits the clean state and drops the draft only after
  the write succeeds, and shows a "Save failed" toast otherwise — the buffer stays dirty so you
  can retry. The env-vault add/create actions likewise only confirm once the write succeeds:
  `env:setGlobal`/`env:setTerminal` were promoted from fire-and-forget sends to `invoke`, and
  `EnvVault.persist()` no longer swallows write errors — so a failed vault write now surfaces a
  toast instead of a false "added"/"Vault created" (removes stay best-effort).
- **Text readability (WCAG AA).** The needs-input (orange) and busy (blue) alert bars now
  pick black-or-white title text from the bar colour's luminance instead of forcing white —
  fixing white-on-orange (2.29:1 → 7.2:1) and keeping it correct for any custom alert colour
  (a derived `--on-busy`/`--on-needs` var computed at every theme scope). The recording and
  env-error reds were brightened to clear 4.5:1, and a `--status-needs-input` typo in the
  env-error colour (a non-existent var that silently fell back) was fixed. A unit guard pins
  the default theme's text/background pairs to AA so future token edits can't regress them.
- **AI agent (Claude/Codex) working-vs-awaiting status is now accurate.** An agent runs as one long
  shell command (no command-done marker until it exits) sitting at its own TUI prompt, which the
  generic idle heuristic can't read — so it used to show **active forever**, even when idle at the
  prompt. The status now tracks the agent's own `esc to interrupt` working indicator: the terminal
  is **busy** while the agent is working (including while it's blocked-but-quiet on a long tool/`sleep`,
  and across screen repaints), **resumes** to busy when the next turn begins, and flips to
  **awaiting** (`✨⏳` + the "{agent} is waiting for you" notification) only once the agent has
  stopped showing that indicator and gone quiet. Fixes both the "always active" and the
  "idle during the sleep / idle no matter what" failure modes. Scoped to detected AI sessions;
  ordinary terminals are unaffected.
- **`MaxListenersExceededWarning` with many open terminals.** Each `TerminalPane` attached its own
  raw `ipcRenderer.on` for `pty:data`/`pty:exit`, and since every workspace stays mounted, 11+
  terminals crossed Node's default 10-listeners-per-event cap and logged a spurious leak warning.
  The preload now attaches exactly one underlying listener per push channel and fans out to its
  subscribers (detaching when the last one leaves), so listener count no longer scales with pane
  count. Also removes the per-subscriber `as never` casts.

### Changed
- **Unified Settings panel (UI polish phase 4).** Theme, environment variables, and
  terminal preferences now live in one Settings window (sidebar: General / Appearance /
  Environment / Terminal) instead of three separate surfaces. Open it from the tab-bar
  **⚙**, **Ctrl+,**, or the command palette; a pane's 🎨/🔑/⚙ open the same panel
  focused on the right section with that pane preselected. The standalone theme/env
  modals and the in-tile terminal-settings popover are gone; the global
  "record-by-default" + recordings-folder controls (previously buried in a per-pane
  popover) now live under General with the default-shell preference.
- **UI polish (phase 1) — design-token foundation (no behavior change).** Hardcoded colors and
  fonts scattered through the renderer (`#094771` palette selection, the `#5a4a00`/`#bbb` editor
  bars, eight `Consolas, monospace` literals, a spread of ad-hoc `opacity` dim-text values) now
  route through a single layer of derived `:root` tokens (`--mono`, `--sel-bg`, `--warn-bg/-fg`,
  `--shadow-pop/-modal`, `--fg-dim`, `--dim/--dimmer`) that track the active theme via `color-mix`
  — so per-app/-workspace/-pane theming restyles them automatically. Modals and in-tile popovers
  gain consistent drop-shadows and a reduced-motion-safe pop-in; long pane titles now ellipsize
  instead of shoving toolbar buttons off the bar; the file explorer gets the themed scrollbar; and
  workspace tabs show a keyboard focus ring. A guard test keeps the retired literals from creeping
  back. First of a four-phase polish/QoL pass.
- **Internal refactor — code-quality pass #3 (no behavior change).** Resolved the 2 Critical and
  9 Major findings from the third quality review. Correctness: `EditorPane.closeTab` no longer
  runs side effects (model switch + persist) *inside* a `setOrder` updater — React can
  double-invoke those under StrictMode/batching — and `EnvVault.unlock` no longer silently
  destroys stored vars when a decrypted payload is malformed (a new pure `parseVaultData`
  validates shape + a `version` field and rejects rather than coercing to empty; legacy
  version-less vaults still read). Structure: `EditorPane` shed its entire Monaco/tab/draft/save/
  untitled/theme lifecycle into `editor/use-editor-tabs.ts`, with the tab strip now in
  `EditorTabStrip.tsx`; the 178-line `register.ts` god module is split into eight per-domain
  registrars (`register-pty`/`-fs`/`-workspaces`/`-drafts`/`-cloud`/`-usage`/`-recording`/`-env`)
  composed by a thin root that aggregates disposers into one `win.on('closed')`; the env-vault
  unlock backoff moved out of the IPC layer into `EnvVault.unlock`; the `StatusTracker.tick` idle
  heuristic extracted to a pure, unit-tested `computeIdleFallback`. Resilience: `loadWorkspace`/
  `loadAppState` degrade a corrupt file to `null` instead of rejecting the IPC call. Dedup: a
  shared `@shared/paths` `basename` replaces four divergent copies, a `useResolvedPaneTheme` hook
  replaces the per-pane theme effect duplicated in `EditorPane`/`TerminalPane`, `App` uses a
  scoped `useShallow` selector, and `pushRecent` gained an equality predicate so `nextRecentDirs`
  delegates to it. Covered by the existing unit + e2e suites plus new unit tests.
- **Internal refactor — code-quality pass #2 (no behavior change).** Resolved the Critical and
  Major findings from the second quality review. Renderer: `WorkspaceView` was a god component
  doing layout + six modal states + toolbar + popovers for every pane; it is split into
  `PaneTile` (owns its own menu state and subscribes only to *its* pane's slices), `PaneToolbar`,
  `ProcessPopover`, and `CwdMenu`. The 600-line zustand store is decomposed into cohesive slice
  modules (`store/theme-slice`, `runtime-slice`, `quick-slice`, `schedule-slice`, plus
  `internals`/`types`) composed by a thin root; the seven copy-pasted "open a pane" actions now
  share a `commitPane` helper and the drift-prone per-pane cleanup (status/cwd/procs/ai/usage/
  recording) goes through one `clearPaneRuntime` + `teardownPanes` path (fixing inconsistent
  workspace-close teardown). `WorkspaceTabs` now uses scoped `useShallow` selectors with derived
  badge strings (no longer re-renders on every line of terminal output); `App` collapses eight
  identical IPC-subscription effects into one; the floating popover surfaces share a `SURFACE`
  style from `Modal`. Main: the duplicated OSC scan loop in `osc133-parser`/`cwd-parser` is
  extracted to `scanOsc`; `register.ts` consolidates per-service teardown into one
  `win.on('closed')` and drops the `tracker!`/`ai!` non-null assertions. Contract: named
  `RecState`/`EnvVaultState`/`AiTool` types replace anonymous callback shapes, and the
  `draftsSet`/`draftsDelete` API names match their channels. Covered by the existing unit + e2e
  suites.
- **Internal refactor — code-quality pass (no behavior change).** Resolved the three Major
  findings from the quality review: (1) the seven copy-pasted "open a pane" branches in the
  renderer store now route through a single `placePane`/`firstTarget` helper; (2) the five-plus
  hand-rolled modal overlays (broadcast, schedule, env, theme, command palette, SSH form) now
  share one `<Modal>` component with a centralized `Z` stacking scale, replacing the ad-hoc
  z-index/backdrop literals; (3) `EditorPane` shed its draft-persistence and external-file-watch
  concerns into dedicated `useEditorDrafts`/`useExternalFileWatch` hooks plus a shared `editor/tabs`
  module. Covered by the existing editor, dialog, theme, and workspace e2e suites.
- **UI polish pass — cohesive dark chrome.** The react-mosaic window toolbars are now dark when
  idle (instead of the default light blueprint bar), and buttons, selects, and inputs across the
  tab bar, pane toolbars, status bar, and every dialog/popover share a themed look with
  hover/active feedback and an accent keyboard-focus ring. The active workspace tab gets an accent
  highlight. All scoped to chrome surfaces, so the terminal, Monaco, and their own widgets are
  untouched.
- **Theming is now scoped** — a Scope selector in the `🎨` editor themes the **app**, a
  **workspace**, or an individual **pane** (terminal/editor/explorer), layered nearest-wins.
  The window-background color is now visible (app root + mosaic gutters), and the color picker
  no longer lags (live preview writes the CSS var directly; Monaco re-theme is debounced).
- **Broadcast dialog** — **Shift+Enter** now sends; added quick-key buttons (Esc, Ctrl+C/D/Z/L,
  Tab, Enter, ↑/↓) that send the control sequence to all terminals.
- **Workspace rename** — the existing name is selected on focus, so you can type to replace it.

### Fixed
- **Scheduled-command dialog** was clipped by adjacent terminals — it now portals to `<body>`
  and covers the full window (react-mosaic tiles created a transform containing block).
- **Claude usage metrics** showed a stuck `0%` and the wrong context window.
  The transcript watcher now watches the project *directory* and re-resolves the
  newest transcript on every change (fixes binding to stale/empty session stubs),
  and the 1M context window is detected from the Claude settings model alias
  (`opus[1m]`) since the `[1m]` flag is never written to transcripts — plus an
  auto-bump to 1M when observed context exceeds 200k.
- **Switching workspace tabs blanked every pane** — terminals lost scrollback,
  the editor lost unsaved text, and a live Claude TUI froze until its next write.
  Inactive workspaces now stay mounted (hidden via `visibility`, not unmounted),
  preserving all pane state across switches.

### Added
- **Environment variable manager** — a `🔑` button opens an encrypted-local vault for env vars
  injected into terminals on spawn (global vars for every shell, plus per-terminal overrides).
  Values are stored only as an AES-256-GCM blob (scrypt-derived key) at `userData/env-vault.json`;
  decrypted values and the passphrase live in main-process memory only while unlocked, and
  workspace JSON stores only an `envId`, never values.
- **Terminal session recording** — a `⏺` button records a terminal's output to a replayable
  asciinema `.cast` file (in `userData/recordings/`); a per-terminal-settings toggle auto-records
  every new terminal.
- **Customizable UI theming** — a `🎨` editor to customize colors (window, toolbars, menus,
  borders, text, accent, busy/needs-input alerts, terminal), fonts, and sizes throughout the
  app, applied live via CSS variables and themed xterm/Monaco. Save named **presets**; the
  active theme and presets persist in `quick.json`.
- **Scheduled terminal commands** — schedule command(s) to a terminal after a delay,
  once it becomes idle, or recurring with a jitter window (the `⏱` tile button), sent as
  a command or raw keystrokes.
- **Workspace layout templates** — save a workspace's pane layout as a named template
  (the `▾` button) and create new workspaces from it; templates persist in `quick.json`.
- **Workspace tab management** — right-click a workspace tab for Rename / Save / Close,
  name a new workspace inline the moment you create it, and drag tabs to reorder them.
- **Broadcast input** — send a command to every terminal in the active workspace at
  once (the `⇉` button or `Ctrl+Shift+Enter`), as raw keystrokes or a bracketed paste.
- **Editor scratch buffer** — every editor pane now has a persistent **Untitled**
  scratch tab: type into an empty editor and the text survives a restart. **Ctrl+S**
  (or "Save As…") turns the scratch into a real file.
- **Editor hot-exit** — unsaved editor buffers now persist across an app restart
  (or crash) and are restored exactly on reopen. If a drafted file also changed on
  disk while the app was closed, the existing "Changed on disk" bar appears
  (Reload / Keep mine). Drafts are stored separately (`editor-drafts.json`), so
  workspace files stay small.
- Project documentation: `README.md`, `CLAUDE.md`, `docs/architecture.md`,
  `docs/decisions.md`, this changelog, and a doc per feature under `docs/features/`.

## [0.1.0] — in development

The initial feature set, built as a sequence of spec→plan→implement sub-projects
(see `docs/superpowers/` and `docs/features/`).

### Added — core (Phases 1–3)
- **Tiled terminal workspaces** (2026-06-13): multiple real Windows shells with a
  shell picker, react-mosaic split/resize/rearrange, named workspace tabs,
  save/restore with debounced auto-save, and window-state memory.
- **Terminal status & alert engine** (2026-06-14): OSC 133 shell integration
  (PowerShell + bash; cmd heuristics) driving busy/idle/needs-input; pane status
  borders, 🔔 tab badges, OS notifications, and per-terminal alert settings.
- **Monaco editor + live file explorer** (2026-06-14): editor panes with per-file
  tabs, dirty tracking, Ctrl+S, and undo-preserving external-change reload; a lazy,
  chokidar-watched file-tree explorer that opens files into the editor.

### Added — awareness (roadmap A–F)
- **A · CWD awareness** (2026-06-14): live per-terminal working directory via
  OSC 9;9 / OSC 7; "Open Explorer here" / "Reveal in File Explorer"; restored on
  reload; split-inherit.
- **B · SSH & favorites** (2026-06-14): Ctrl+K command palette, saved SSH
  connections (no secrets stored), recent/favorite directories, launch-override
  terminals. App-global `quick.json`.
- **C · Child-process tracking** (2026-06-14): foreground process on a chip and a
  descendant process-tree popover, via busy-gated `Get-CimInstance` polling. Works
  for all shells including cmd and SSH.
- **D · Cloud CLI status** (2026-06-14): a global bottom status bar showing AWS
  (`sts get-caller-identity`) and Azure (`az account show`) login state, with a
  detail popover and a "Log in" action.
- **E · AI session awareness** (2026-06-14): detects Claude Code / Codex sessions
  from the process tree; `✨ Claude` pane chip + workspace-tab indicator; a
  "waiting for you" notification on busy→quiet.
- **F · Claude usage metrics** (2026-06-15): live context-window % on the chip and
  a token breakdown (input/output/cache) in the popover, parsed from the session's
  Claude transcript. Claude-only; pluggable for Codex later.

### Notes
- No secrets are persisted (SSH stores host/user/port + key path only; cloud status
  stores nothing; usage reads transcripts read-only).
- Windows-first; the awareness features target Windows (ConPTY, CIM, PowerShell).
