# 0009 — Native OrkyPane pane type (read)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 first-class persisted
pane kind + `SCHEMA_VERSION` bump, D2 explicit tracked-root binding with unbound state, D3 F5
aggregate + NEW read-only per-root detail channel, D4 read-only with a reserved F10 actions region,
D5 reuse). **Revised** against spec-gate findings FINDING-001..009 (see `findings.json`).
**Amended 2026-07-02 on the review→spec loopback (ESC-001):** FINDING-013/020/031 (REQ-010's
"displayed" redefined against the REAL keep-mounted workspace mount model + the full trigger×state
matrix), FINDING-021 (the wire carries the unique feature DIR slug), FINDING-032 (REQ-020 coercion
on EVERY instantiation path incl. templates), FINDING-027 (compass loading-vs-empty copy),
FINDING-033 (accepted cross-file staleness class documented in REQ-008), plus explicit REQ-009
gate-`at`/stall-wording acceptance and a REQ-019 theme-var-validity guard. The five brainstorm
decisions are FIXED; this spec makes them testable and **resolves** the brainstorm's non-blocking
spec-time items (channel naming, detail payload shape, pane-creation affordance placement,
unbound-state copy) inline (see "Resolved spec-time decisions"). REQ-IDs are stable; never
renumber.

This is Tier **T3** of the Termhalla × Orky integration: F6's drawer answers "what needs me across
ALL projects"; the OrkyPane answers "show me EVERYTHING about THIS project" as a persistent,
tiling-layout citizen. It ships the first `SCHEMA_VERSION` bump since v7 (0003) and the first new
IPC surfaces in the Orky read domain since F5 — **one pull** (`registry:detail`, REQ-006) plus
**one lightweight push notification** (`registry:rootChanged`, REQ-022, the detail view's currency
mechanism) — both deliberate, both migration-disciplined (baseline REQ-024). It is strictly
READ-only: no writes under any `.orky/` tree, no CLI, no `orkyAction:*` call, no registry mutation
(REQ-013).

## Concerns

`ux` `performance` `determinism` `quality`

- `ux` — a pane, not a drawer: tile sizing and scroll for long feature/finding lists (REQ-009,
  REQ-018), unbound/vanished-root clarity (REQ-011), keyboard operability inside a mosaic tile
  (REQ-018), root-picker accessibility + CONV-020 focus discipline + its own loading/error/empty
  state discipline (REQ-004, REQ-018), coexistence with the F6 drawer showing overlapping data
  (read-only, same upstream mappers — REQ-015).
- `performance` — detail is fetched on demand (bind events + the bound root's own
  `registry:rootChanged` notification while displayed — exact triggers pinned in REQ-010); no
  polling; hidden/unbound panes never fetch — where "hidden" covers EVERY keep-mounted-but-hidden
  host: the minimized host AND the inactive-workspace host (REQ-010, FINDING-013); churn on OTHER
  roots causes zero re-renders of an unaffected pane (REQ-016); the detail channel is a one-shot
  bounded read that can never turn the shared engine's readers into a hot loop (REQ-008); the
  notification is a bare root string, never a payload (REQ-022).
- `determinism` — schema-migration determinism (same pre-migration bytes → same post-migration
  state, REQ-002); detail payload is a pure function of the on-disk fixture **and the one injected
  clock instant** (REQ-007/REQ-014); the `MAX_FEATURE_DIRS` cap selects a deterministic survivor
  set (sorted-before-cap, REQ-008); per-feature identity is the UNIQUE dir slug carried on the
  wire, never the collidable `feature` field (REQ-007/REQ-012/REQ-014, FINDING-021); identical
  payload in → identical DOM order out; no `localeCompare`, no clock/randomness in any ordering
  path (REQ-014).
- `quality` — reuse of the 0004 mappers, the F5 engine read semantics, and F6's presentation
  conventions, never forked (REQ-015); one small sanctioned shared refactor (the `isBlockingFinding`
  extraction, REQ-007/REQ-013 — behavior-identical, equivalence-tested); migration correctness
  (REQ-002, REQ-020 — coercion on EVERY instantiation path, incl. templates); the read-surface
  extension leaks no mutation symbol into the renderer (REQ-013); **six** frozen point-in-time
  guards collide with D1's mandated bump and are superseded/amended on the sanctioned tests-phase
  path (REQ-003). `data-provenance` is **n/a** — this feature embeds no factual/reference data;
  every displayed datum comes off the live aggregate, the detail payload, or the already-shipped
  0004 `ORKY_PHASES` mirror (whose provenance contract lives in 0004 and is reused, not
  re-embedded).

## Resolved spec-time decisions (with rationale)

1. **Pane kind + config** — `PaneKind` gains `'orky'`; `PaneConfig` gains
   `OrkyConfig { kind: 'orky'; root: string; name?: string; theme?: Partial<Theme> }` in
   `src/shared/types.ts`. `root` is the persisted binding (the dir containing `.orky/`), stored
   VERBATIM in the aggregate's case-preserved spelling; `''` is the tolerated unbound-on-load
   degenerate value (REQ-020), never written by the creation flow. Component
   `src/renderer/components/OrkyPane.tsx`, rendered by the kind switches in `PaneTile.tsx` and
   `MinimizedPaneHost.tsx`. Names are suggestions; the testids/behaviors below are the contract.
2. **Schema version** — `SCHEMA_VERSION` 7 → **8**. The v<8 migration step is a DOCUMENTED identity
   (a pre-v8 record cannot contain an `orky` pane; nothing to rewrite) — the bump exists so an
   older build's "newer than supported" guard rejects a v8 file instead of loading a pane kind it
   cannot render (REQ-002).
3. **Read-domain channel naming** — `CH.registryDetail = 'registry:detail'` (renderer→main
   `ipcMain.handle` pull, preload `registryDetail(root: string)`) and
   `CH.registryRootChanged = 'registry:rootChanged'` (main→renderer APP-GLOBAL broadcast event,
   preload `onRegistryRootChanged(cb)` via the existing `pushChannel` helper —
   `preload/index.ts:77`'s `onRegistryStatus` is the template). Both live in the `registry:*` read
   domain (grep-visibly separate from `orkyAction:*`), both are registered/subscribed in the
   EXISTING `register-registry.ts` registrar and torn down by its disposer. Neither name matches
   the narrowed renderer mutation-surface guard's case-sensitive pattern
   (`RegistryMutationResult|registryRoots\s*\(|registryAddRoot\s*\(|registryRemoveRoot\s*\(` —
   verified against `tests/shared/registry-no-renderer-ui.test.ts:40`; `registryDetail(` and
   `onRegistryRootChanged(` match none of the four alternates), so TEST-362/363 stay green
   untouched.
4. **Creation affordances** — three, matching the existing kinds' full affordance set (editor/
   explorer each have palette + `add-pane` select + split-compass): (a) command-palette action
   `'new-orky'` ("New Orky pane…") appended to `buildCommandItems()` in `src/shared/quick.ts` and
   dispatched by `CommandPalette.tsx`'s action switch; (b) an `<option value="orky">Orky</option>`
   in `WorkspaceTabs.tsx`'s existing `add-pane` select — both routed through the centralized
   `dispatchAddPane` (`pane-ops.ts`), which gains an `'orky'` branch taking an injected, api-free
   root-picker callback (the exact pattern the explorer branch uses with `openFolder`; CONV-006 —
   one callback, no primary+override pair); and (c) an `'orky'` kind option in `SplitMenu.tsx`'s
   kind group (the split compass — its Terminal/Editor/Explorer selector at
   `SplitMenu.tsx:145-150` is a real per-kind creation surface the draft spec wrongly omitted;
   FINDING-008). The compass's `orky` kind follows the explorer/cwd disabled precedent
   (`SplitMenu.tsx:120`): disabled when the held snapshot has no member — with **TWO distinct
   explanatory accessible names (FINDING-027)**: while the snapshot has NOT settled
   (`registrySnapshot === null && registryError === null` — the slice's derived-loading rule) the
   name says the tracked projects are still LOADING (the "tracked projects loading…" class of
   copy, mirroring the picker's own loading state), and ONLY a genuinely-held `[]` snapshot gets
   the "no tracked Orky project yet — open a terminal in a project containing `.orky/` to track
   one" copy. Folding the two states into one name mis-describes a loading system as empty — the
   exact loading-vs-empty discipline decision #5/FINDING-009 pins for the picker, applied to this
   smaller surface (the shipped draft folded them at `SplitMenu.tsx:39` and rendered one name at
   `:133-135`). With `orky` selected, activating a direction closes the compass and opens the SAME
   root picker; selection commits the directional split, cancel commits nothing. NO new rebindable
   `CommandId` (editor/explorer have none either).
5. **Root picker** — a chrome popover/modal (`OrkyRootPicker`, testid `orky-root-picker`) listing
   the member roots of the renderer's held registry snapshot (the READ surface F6 already
   subscribes app-level — `App.tsx:61`; F9 adds no second snapshot subscription and never calls
   `registryRoots()`, which is persisted-only AND mutation-guard-forbidden). The picker has FOUR
   mutually-distinct states (FINDING-009): **loading** while `registrySnapshot === null &&
   registryError === null` (the slice's derived-loading rule, `registry-slice.ts:51`), **error**
   surfacing the held `registryError` text verbatim when one is held with no snapshot,
   **empty** (`orky-root-picker-empty`, actionable copy) ONLY for a genuinely-held `[]` snapshot,
   and the member list. Cancel commits no pane. The same picker serves the unbound state's re-bind
   affordance (REQ-011) and the compass flow (decision #4c).
6. **Unbound-state copy** — names the persisted root and the concrete ways forward:
   *"This Orky pane is bound to `<root>`, which is not currently tracked. Open a terminal in that
   project to track it again, or bind this pane to another tracked project."* (specific +
   actionable, CONV-001). The renderer cannot offer "track it now": `registry:addRoot` is the
   forbidden mutation surface and the track-project gesture is still unowned (Open questions).
7. **Change-notification design (FINDING-003)** — a detail view keyed on the LOSSY aggregate entry
   goes stale for exactly the data classes it adds (findings edits that preserve
   `openBlockingCount`; ANY change to an `idle`/clean-`done` feature, which `inPopover` excludes
   from `status.features` — `orky-status.ts:309-314`; both then suppressed by the slice's
   deep-equal short-circuit, `registry-slice.ts:77-87`). The engine already emits on EVERY
   completed re-read with no main-side delta gating (`orky-root-engine.ts:169-171`, called at
   `:188` and `:233`; dedup exists ONLY renderer-side), so main carries a per-root change
   NOTIFICATION on every completed re-read: `registry:rootChanged`, payload = the project-root
   string only (REQ-022). The REJECTED alternative — an emission-counter field on the aggregate
   entry — would make every re-read a value change, defeating `registry-slice.ts:77-87`'s
   deep-equal short-circuit and re-notifying every registry subscriber app-wide on every re-read
   (destroying F5's zero-notification steady state and F9's own REQ-016). A separate event keeps
   the aggregate byte-stable and verifies cleanest against `register-registry.ts`'s existing
   one-line push pattern (`:61`).

## Baseline fit (brownfield — `.orky/baseline/` present)

- **Baseline REQ-024 (versioned persistence) is honored by USING it**: this is the designed path —
  a new persisted pane kind rides a `SCHEMA_VERSION` bump with an explicit migration entry in
  `workspace-model.ts`'s `migrate()` chain (the v6→v7 step at `workspace-model.ts:193` is the
  shipped precedent). No baseline REQ is superseded; no characterization test is edited.
- **F5's read surface is extended, not changed**: `registry:status`/`registry:current` semantics
  are untouched; ONE new read-only pull (`registry:detail`) and ONE new push notification
  (`registry:rootChanged`) join the same registrar with the same sender/disposer discipline
  (`register-registry.ts:41-70`). Both are in-scope main-side work — D3 already opened the
  main-side read surface; the notification is the detail view's currency mechanism (decision #7).
  The narrowed scope guard TEST-362/363 (`tests/shared/registry-no-renderer-ui.test.ts`) keeps
  passing byte-unchanged — the mutation surface stays renderer-forbidden and neither new symbol
  matches its pattern (decision #3).
- **SIX frozen point-in-time guards collide with D1** (definitive inventory in the Verified
  contract, assembled by repo-wide value-literal grep after the draft's five-item list missed one —
  FINDING-001): TEST-344, TEST-001, TEST-020, TEST-087, TEST-038, **TEST-008**. Their
  supersession/amendment is normative and scheduled — **REQ-003**: amended at F9's tests phase, by
  the test-designer, in the same change that introduces F9's suite, never silently during
  implementation (CONV-019's protocol, applied to the point-in-time-constant variant of the same
  trap).
- **F6/0004/0005 shared modules are consumed, never forked**: `orky-status.ts` mappers +
  `compareOrkyFeatures`, the registry slice's snapshot state, `caseFoldFromPlatform` and the
  fold-injection discipline (the FINDING-003 lesson of F6), `commitPane`/`dispatchAddPane`,
  `clearPaneRuntime` (CONV-011 pruning). One sanctioned, minimal shared refactor is scheduled
  (FINDING-002): `openBlockingCount`'s inline per-entry predicate (`orky-status.ts:134-143`) is
  extracted as an exported `isBlockingFinding(f)` that `openBlockingCount` delegates to —
  behavior-identical, equivalence-tested (REQ-007/REQ-013/REQ-015).

**Proposed conventions (for doc-sync promotion):**

1. (from the REQ-003 collision) A frozen test asserting the CURRENT VALUE of a shared,
   legitimately-evolving global (a schema-version constant, a closed type-union shape) as a proxy
   for "my feature didn't change it" MUST instead pin an invariant scoped to its own feature (or
   name the sanctioned amendment path in its header), so a later feature's legitimate change
   doesn't false-positive six unrelated frozen suites at once.
2. (from FINDING-001) A spec claim of an exhaustive enumeration of colliding frozen tests ("full
   list", "grep verified") MUST state the exact grep pattern and scope used, and the pattern MUST
   target the pinned literal value (e.g. `toBe\(7\)`) repo-wide — never a sweep of already-known
   files.
3. (from FINDING-003) A detail view whose refresh triggers key on changes to a LOSSY summary/
   roll-up MUST have an independent currency mechanism (or an explicit staleness contract) for the
   data the summary omits — a summary-keyed trigger can only refresh what the summary can see.
4. (from FINDING-006) An enforced cap/truncation over a filesystem enumeration MUST be applied to
   a deterministically-ordered list, never to raw `readdir` order, so which items survive the cap
   is a pure function of the on-disk state.
5. (from FINDING-032) A load-time coercion that guarantees "downstream code never sees X" MUST be
   applied at EVERY deserialization/instantiation path of that persisted shape — workspace files,
   workspace TEMPLATES (`quick.json`), imports/duplications — or the guarantee must explicitly
   name the paths it covers; a single-seam coercion over a multi-path persisted shape is a latent
   crash on the uncovered path.

## Verified contract (pinned upstream shapes — read from source, not memory)

Confirmed against shipped source on 2026-07-02 (re-verified during the FINDING-001..009 revision
and again during the ESC-001 loopback amendment). If a datum is not listed here, F9 does not
display it.

- **Persistence chain:** `SCHEMA_VERSION = 7` (`src/shared/types.ts:378`); serialize embeds it
  (`workspace-model.ts:166-168`); `deserializeWorkspace` → `migrate(ws, version)`
  (`workspace-model.ts:170-195`) rejects `version > SCHEMA_VERSION` with the "newer than
  supported" error (`:186-188`) and applies the v<7 view-state step (`:193`); `normalizeViewState`
  (`:202-216`) tolerates malformed view-state, never throws. App-state migration
  (`app-state-model.ts:9-13`) rejects only `schemaVersion > SCHEMA_VERSION` — a v7 `app-state.json`
  loads under v8 unchanged. Corrupt workspace files degrade to `null`, never a renderer wedge
  (`src/main/persistence/store.ts:22-37`). **A SECOND persisted instantiation path exists
  (FINDING-032):** workspace templates persist in `quick.json`, whose loader validates templates
  ONLY as `Array.isArray(v.templates)` (`quick-store.ts:21` — no per-template shape validation),
  and `workspaceFromTemplate`/`remapPaneIds` clone pane configs opaquely with no normalization
  (`workspace-model.ts:255-297`) — so a load-normalization seam in `deserializeWorkspace` alone
  does NOT cover template instantiation (REQ-020 covers both).
- **Pane-kind machinery is otherwise kind-generic:** `PaneConfig = TerminalConfig | EditorConfig |
  ExplorerConfig` (`types.ts:227`); `PaneKind` (`src/renderer/store/pane-ops.ts:3`);
  `dispatchAddPane` (`pane-ops.ts:30-45`, explorer branch prompts via injected `openFolder`);
  `commitPane` (`store.ts:62-77` — places, autosaves, `requestPaneFocus`); render switches
  `PaneTile.tsx:144-148` and `MinimizedPaneHost.tsx:40-46`. **TWO keep-mounted-but-hidden hosts
  exist — the corrected mount model (FINDING-013):** (a) the MINIMIZED host keeps a pane mounted
  but hidden — `visibility: hidden`, `aria-hidden`, `pointer-events: none`
  (`MinimizedPaneHost.tsx:35-39`) — and passes `hidden` into `OrkyPane` (`:46`); (b) the
  INACTIVE-WORKSPACE host — `App.tsx` keeps EVERY workspace mounted and hides the inactive ones
  the SAME way (`visibility: hidden` + `aria-hidden` + `pointer-events: none`,
  `App.tsx:155-172`; the comment at `:155-159` pins that switching tabs must NOT unmount panes —
  it would dispose xterm scrollback and Monaco models), while `PaneTile.tsx:148` mounts `OrkyPane`
  with NO `hidden` prop. Minimize/restore is a cross-HOST REMOUNT ("before the source unmounts,
  and this mount re-adopts" — `MinimizedPaneHost.tsx:23-26`); a workspace switch flips visibility
  on the SAME mounted instance with no remount. REQ-010's displayed/hidden boundary keys on the
  EFFECTIVE visibility across BOTH hosts, never on one named hiding surface. Per-pane theme via
  `themeCssVarsPartial(pane.config.theme)` (`PaneTile.tsx:134-135`).
  `movePane`/undock/redock, minimize/restore, `templateFromWorkspace`/`workspaceFromTemplate`
  (`workspace-model.ts:148-157, 255-297`) treat configs as opaque deep-cloned data — no
  kind switch exists on any of those paths (verified), so an `orky` pane needs NO change there
  (but see the FINDING-032 template-coercion pin above — opaque cloning also means NO validation).
- **Creation affordances (all three existing surfaces):** palette `PaletteAction`/
  `buildCommandItems` (`quick.ts:83-87, 134-148`); `CommandPalette.tsx:67-69` action switch;
  `WorkspaceTabs.tsx:91-99` `add-pane` select; `addPaneOfKind` (`store.ts:434`); AND the split
  compass — `SplitMenu.tsx`'s `Kind = 'terminal' | 'editor' | 'explorer'` (`:7`), kind buttons
  `split-kind-<k>-<paneId>` with `aria-pressed` (`:117-127`), rendered in the "Split kind" group
  (`:145-150`), explorer disabled without a cwd (`:120`), IMMEDIATE commit on direction activation
  (`:69-74`), close restores focus to the split trigger (`:67`). The compass e2e suite is
  OPEN-FORM about the kind set (verified: `tests/e2e/split-compass.spec.ts:104-106` visibility,
  `:117-119` selected-state, `:139-140` disabled precedent, `:241-262` per-kind aria loop — no
  exact-count or closed-set assertion anywhere), so adding a fourth kind button breaks none of it.
- **Aggregate read surface (F9's roll-up source):** `OrkyRegistryEntry = { root, source, status }`
  (`types.ts:89-94`; the index signature `[key: string]: unknown` at `:93` is type-only — erased
  at runtime, but F9's per-entry deep-equality must not assume a closed key set). Snapshot sorted
  by `root` codepoint, never `localeCompare` (`src/shared/orky-registry.ts:47`). `root` is the
  case-preserved `resolve()` spelling (`src/main/orky/orky-registry.ts`, `resolveCanonical`
  `:205-214` — and `statusByRoot`'s key always agrees with the membership key, `:199-204`);
  comparison folding is `normalizeProjectRoot`'s job ONLY (`validate-root.ts:24-27` — a
  MAIN-process module reading `process.platform`; the renderer must inject fold mode, F6's
  FINDING-003 trap). App-level subscription + generation-guarded recovery pull already exist
  (`App.tsx:61, 87-90`; `registry-slice.ts:68-101`); the store holds `registrySnapshot`,
  `registryError`, `snapshotGeneration`; **loading is DERIVED, never stored:
  `registrySnapshot === null && registryError === null`** (`registry-slice.ts:51` — the rule the
  picker's loading state keys on, FINDING-009); a value-identical push keeps the existing state
  reference (zero notifications on the steady-state path, `registry-slice.ts:77-87`).
- **Emission model (the FINDING-003 pins):** the engine emits `onStatus(orkyDir, status)` on
  EVERY completed re-read, with NO delta gating main-side (`orky-root-engine.ts:169-171`; emitted
  at `:233` for a computed roll-up and at `:188` as `null` for a vanished `orkyDir`); watcher
  events for the three target `.json` files debounce at 300 ms (`:79`, `:108-117, :159-167`) with
  `awaitWriteFinish` 150 ms stability (`:111`). `OrkyRegistry` recomputes + re-emits the full
  snapshot to `onSnapshot` listeners on every engine emit (`src/main/orky/orky-registry.ts:42-45`,
  `:239-244`); `register-registry.ts:61` broadcasts every one (`registry.onSnapshot(snapshot =>
  send(CH.registryStatus, snapshot))`). Value-dedup therefore lives ONLY in the renderer slice —
  so a `registry:rootChanged` send wired the same way (REQ-022) fires per completed re-read with
  no engine change at all.
- **The aggregate DELIBERATELY omits what the pane must show** (why the detail channel exists):
  `OrkyPaneStatus.features` is the POPOVER-ELIGIBLE set — `inPopover`
  (`src/shared/orky-status.ts:309-314`) excludes `idle` and clean-`done` features, and the entries
  are `OrkyFeatureStatus` roll-ups only: no per-gate records, no findings entries, no escalation
  entries. Per-feature detail is read main-side (`orky-root-engine.ts:190-233`) and dropped at the
  mapper. Corollary (FINDING-003): aggregate-entry deep-equality is NOT a valid currency signal
  for the detail data — REQ-010 keys on REQ-022's notification instead.
- **Engine read semantics the detail channel must mirror (and the two pinned divergences):** bounds
  `MAX_FEATURE_DIRS = 200` / `MAX_FILE_BYTES = 1 MiB`, warned, never silent
  (`orky-root-engine.ts:14-15, 200-203, 239-257`); the engine applies the cap to the RAW `readdir`
  order — `slice` before any sort (`:196-203`) — a nondeterministic survivor set the DETAIL path
  MUST NOT copy (REQ-008 sorts before capping; the engine's own cap is a flagged upstream F5 note,
  not changed here — FINDING-006); symlinked feature dirs skipped (`:211-213`); absent `orkyDir` →
  the "unreadable" signal (`:186-188`); unreadable/oversized `state.json` skips that feature
  SILENTLY in the engine (`:215-217`) — the detail path instead surfaces it (REQ-008's
  `skippedFeatures`, FINDING-004); `active.json` supplies the active slug/live phase/heartbeat
  (`:266-286`); mappers `normalizeFeatureRaw`/`normalizeFindings`/`orkyFeatureStatus`/
  `parseOrkyTimestamp` (`orky-status.ts:86-101, 74-82, 182-270`); `openBlockingCount` is an INLINE
  loop (no exported per-entry predicate today): `BLOCKING_SEVERITY = {'CRITICAL','HIGH'}` (`:128`),
  per-entry rule = `isObject(f)` ∧ `String(f.status).toLowerCase() === 'open'` ∧
  (`BLOCKING_SEVERITY.has(String(f.severity).toUpperCase())` ∨ `f.contract_violation === true`)
  (`orky-status.ts:134-143`) — the exact body REQ-007/REQ-013 schedule extracting as
  `isBlockingFinding` (FINDING-002); `isStalled` takes an INJECTED `now` and compares
  `now - lastTickAt > threshold` (`:163-176`) — so identical bytes under two clocks can legally
  yield busy vs stalled, and a stall crossing produces NO fs event (the clock-scoping facts behind
  REQ-007/REQ-009's arbitration, FINDING-005); `compareOrkyFeatures` is the exported
  single-definition comparator (`:283-289`); `ORKY_PHASES` (8 entries, `gateM === 8`) at `:30-32`.
- **Producer write atomicity (the FINDING-004 pin):** Orky's gatekeeper writes `state.json` (and
  `active.json`) NON-atomically — `writeJson` is a plain `writeFileSync`
  (`C:/dev/Orky/plugin/gatekeeper/gatekeeper.js:54-57`); only `findings.json` gets a temp+rename
  atomic writer (`:319-323`). The engine's watcher path is shielded by `awaitWriteFinish` (150 ms)
  + the 300 ms debounce; the one-shot detail read has NO such shield and its triggers correlate
  with write activity — hence REQ-008's bounded-retry + never-silently-shorter discipline, and the
  documented cross-FILE skew class REQ-008 accepts (FINDING-033).
- **Real on-disk shapes the payload is pinned against** (read from THIS repo's own
  `.orky/features/0006-decision-queue-panel/`): `state.json` = `{ feature, phase,
  gates: { <phase>: { passed: boolean, at: ISO-8601, evidence?: string, external?: boolean,
  tokens?: [{token, pass, evidence}] } }, iterations, escalations: [{ id, phase, reason, kind,
  finding?, status, at, decision?, resolvedAt? }], concerns, attempts?, implementer?,
  totalFailures?, loopbacks? }`; `findings.json` = an array of `{ lens, claim, severity, gate,
  fix, location, phase_of_origin, verified_by, id, status, contract_violation?: boolean,
  resolvedAt?, resolution? }` — `contract_violation` verified present in the real 0006 ledger
  (`findings.json:110, 276, 291, 306`; it is the blocking predicate's OR-branch input —
  FINDING-007) — every field optional/omittable in older or hand-edited ledgers (the mappers
  already tolerate that; the payload normalization in REQ-007 must too). **`state.json`'s
  `feature` field is NOT a unique key (FINDING-021):** it is producer-written free text with a
  `'(unknown)'` mapper fallback — a copied feature dir (same `feature` value) or two malformed
  `state.json` files collide on it; the feature DIR name from the walk is unique by construction
  and is what the payload carries as `slug` (REQ-007).
- **IPC registration pattern:** `ipcMain.handle` + disposer + `isKnownWindowSender` gate, unknown
  sender never throws and never leaks real data (`register-registry.ts:33-70`); push events are
  one-line `onXxx` subscriptions broadcast via `send` and unsubscribed in the disposer (`:61`,
  `:68`); preload exposes one bridged method per channel (`preload/index.ts:74-81` for the
  orky/registry family; `pushChannel` at `:77` is the push template); channel constants +
  `TermhallaApi` in `ipc-contract.ts` (`:49-53, 152-163`).
- **Established status-color tokens (the REQ-019/FINDING-025 pins):** the failure token is
  `--status-failure` with standard fallback `#c62828` (`index.css:59` term-failure toolbar,
  `:64-66` failed-chip outline); the needs token is `--status-needs`, theme-mapped via
  `src/shared/theme.ts`'s var map (`theme.ts:38, 62` — `statusNeedsInput` ↔ `--status-needs`)
  with standard fallback `#ff8f00` (`index.css:11, 50`; `Toasts.tsx:8`). NO `--status-fail`
  variable is defined anywhere (theme map or CSS) — a `var(--status-fail, #hex)` is a dead
  variable rendering its novel fallback unconditionally, unreachable by any theme override.
- **Frozen collisions — the DEFINITIVE inventory (FINDING-001).** Assembled by value-literal grep,
  repo-wide over `tests/**` INCLUDING `tests/e2e/**`, patterns: `SCHEMA_VERSION` (all uses),
  `toBe\(7\)` (the pinned literal), `PaneConfig =|TerminalConfig \| EditorConfig|PaneKind`
  (closed-union pins), and kind-enumeration sweeps (`add-pane`, `buildCommandItems`,
  `split-kind-`, `'terminal'.*'editor'.*'explorer'`). Every hit classified:
  - **Colliding literal `SCHEMA_VERSION` pins — SIX (all amended by REQ-003):**
    1. TEST-344 `tests/renderer/decision-queue-panel-structure.test.ts:27`
       (`expect(SCHEMA_VERSION).toBe(7)`) **plus** the closed `PaneConfig` union regex at `:26`
       (F6 REQ-001/REQ-017);
    2. TEST-001 `tests/shared/minimize-persistence.test.ts:25` (0003 REQ-009);
    3. TEST-020 `tests/shared/orky-status.test.ts:405` (0004 REQ-018);
    4. TEST-087 `tests/main/orky-registry-store.test.ts:107` (F5 REQ-013);
    5. TEST-038 `tests/main/orky-osc-structural.test.ts:177` (0014 REQ-017);
    6. **TEST-008 `tests/main/quick-store-toasts.test.ts:42`** (it-block `:41-43`; header `:12-13`
       "pins the current SCHEMA_VERSION constant value") (0001 REQ-007) — the guard the draft's
       five-item list missed.
  - **Symbolic comparisons — SAFE, no amendment:** `tests/shared/app-state-model.test.ts:12,18,31`,
    `tests/shared/split-direction.test.ts:62`, `tests/shared/workspace-model.test.ts:51`,
    `tests/main/store.test.ts:34,67` (all compare against the imported constant).
  - **`toBe(7)` false positives — UNRELATED, excluded:** `tests/renderer/pane-focus-seq.test.ts:30`
    (a focus-sequence counter) and `tests/shared/orky-status.test.ts:99`
    (`ORKY_AUTONOMOUS_PHASES.length` — stays 7).
  - **Closed-union regex pins:** ONLY TEST-344's `:26` (already counted above).
  - **Kind-enumeration sweeps — all OPEN-FORM, no collision:** `tests/quick-commands.test.ts:8`
    (`arrayContaining`), `tests/e2e/split-compass.spec.ts:104-106, 117-119, 139-140, 253-259`
    (per-kind existence/state, no exact count), `tests/e2e/select-contrast.spec.ts:25` (styles the
    `add-pane` select only), `tests/e2e/minimize-uniform.spec.ts:2` (comment only). No frozen test
    enumerates the `add-pane` select's options or `PaneKind`'s members in closed form.
- **Runtime-state pruning seam:** `clearPaneRuntime` (`src/renderer/store/internals.ts:52`) is the
  single place per-pane runtime maps are dropped on close/move (routed from `closePane`,
  `store.ts:436-449`, and the move-away path per F6 FINDING-017) — F9's per-pane detail state
  joins it (CONV-011).

## Public interface

```ts
// src/shared/types.ts — persisted config (REQ-001) + detail wire types (REQ-007).
export interface OrkyConfig {
  kind: 'orky'
  root: string                   // persisted binding, verbatim case-preserved aggregate spelling ('' = unbound-on-load)
  name?: string
  theme?: Partial<Theme>
}
export type PaneConfig = TerminalConfig | EditorConfig | ExplorerConfig | OrkyConfig
export const SCHEMA_VERSION = 8

/** One canonical gate's recorded outcome (null fields = not recorded). */
export interface OrkyGateDetail {
  phase: OrkyPhase               // one of ORKY_PHASES, emitted in canonical order
  passed: boolean | null         // gates[phase].passed === true/false; null = no entry yet
  at: number | null              // parseOrkyTimestamp(gates[phase].at) — epoch ms, tz-safe
  evidence: string | null        // gates[phase].evidence when a string
  external: boolean              // gates[phase].external === true (human-recorded)
}
export interface OrkyFindingDetail {
  id: string | null              // f.id when a non-empty string
  lens: string | null
  severity: string | null        // verbatim (producer-normalized; display uppercases nothing)
  status: string | null          // verbatim ('open' / 'resolved' / …)
  gate: string | null
  claim: string                  // verbatim; '' when absent/mistyped (never rendered mistyped)
  blocking: boolean              // the SHARED isBlockingFinding(f) — open ∧ (CRITICAL/HIGH ∨ contract_violation)
}
export interface OrkyEscalationDetail {
  id: string | null
  phase: string | null
  status: string | null          // 'open' / 'resolved', verbatim
  reason: string                 // '' when absent
  kind: string | null
  at: number | null              // parseOrkyTimestamp(e.at)
  decision: string | null
  resolvedAt: number | null
}
export interface OrkyFeatureDetail {
  slug: string                   // the feature DIR name from the sorted walk — UNIQUE by construction
                                 // (FINDING-021: status.feature is state.json's `feature` field with the
                                 // '(unknown)' fallback and can collide; slug is the per-feature KEY for
                                 // React rows, disclosure state, and data-feature — REQ-007/REQ-012)
  status: OrkyFeatureStatus      // the SAME orkyFeatureStatus mapper output the aggregate uses
  gates: OrkyGateDetail[]        // exactly ORKY_PHASES.length entries, canonical order
  findings: OrkyFindingDetail[]  // findings.json array order, verbatim
  findingsUnreadable: boolean    // findings.json EXISTS but stayed unreadable/oversized after the bounded retry (REQ-008)
  escalations: OrkyEscalationDetail[] // state.json array order, verbatim
}
export type OrkyRootDetailResult =
  | { ok: true; root: string; activeFeature: string | null;
      computedAt: number;                 // the ONE injected clock instant every status/stall datum in this payload used (REQ-007/REQ-009)
      features: OrkyFeatureDetail[];      // sorted by status.feature codepoint, slug codepoint tiebreak (payload-canonical, TOTAL — REQ-014)
      skippedFeatures: string[];          // slugs whose state.json EXISTS but stayed unreadable/oversized after the bounded retry — never silently dropped (REQ-008)
      featuresCapped: boolean }           // true iff the MAX_FEATURE_DIRS cap truncated the SORTED walk (CONV-003)
  | { ok: false; root: string; error: string;                      // specific + actionable (CONV-001)
      errorKind: 'root-not-tracked' | 'orky-missing' | 'unknown-sender' }

// src/shared/orky-status.ts (REQ-007/REQ-013 — the sanctioned shared refactor, FINDING-002):
// extracted VERBATIM from openBlockingCount's loop body (orky-status.ts:134-143), behavior-identical
// (same isObject guard, case-insensitive status/severity, contract_violation OR-branch);
// openBlockingCount delegates to it. Equivalence-tested (REQ-015).
export function isBlockingFinding(f: unknown): boolean

// src/shared/ipc-contract.ts + src/preload/index.ts (REQ-006 / REQ-022)
// CH.registryDetail = 'registry:detail'            // renderer -> main pull (read-only; F9 is the consumer)
// CH.registryRootChanged = 'registry:rootChanged'  // main -> renderer event (APP-GLOBAL broadcast; payload = project root string ONLY)
registryDetail(root: string): Promise<OrkyRootDetailResult>
onRegistryRootChanged(cb: (root: string) => void): () => void

// src/shared/decision-queue.ts OR a sibling pure shared module (REQ-005) — fold-injected equality,
// the same foldPath semantics matchPaneRoot uses (equality, not containment); never reads `process`.
export function sameProjectRoot(a: string, b: string, opts: { caseFold: boolean }): boolean

// src/shared/quick.ts (REQ-004)
type PaletteAction = ... | 'new-orky'

// src/renderer/store (names indicative; REQ-010/REQ-016/REQ-017/REQ-022)
orkyPaneDetail: Record<string, {           // paneId -> detail runtime state; pruned by clearPaneRuntime
  root: string                             // the root the last fetch targeted
  detail: OrkyRootDetailResult | null      // null until the first settle
  error: string | null                     // a failed refresh's specific text; held detail keeps rendering (REQ-011)
  inFlight: boolean
  pendingRefetch: boolean                  // at most ONE coalesced follow-up (this IS the renderer-side coalescing);
                                           // obeys the hidden/unbound gate at SETTLE time (REQ-010, FINDING-031)
  stale: boolean                           // a rootChanged notification arrived while the pane was hidden (REQ-010 T3)
  hidden: boolean                          // EFFECTIVE visibility: minimized host OR inactive-workspace host (REQ-010, FINDING-013)
}>
fetchOrkyDetail(paneId: string, root: string): void   // issue-time generation/identity guarded
notifyOrkyRootChanged(root: string): void             // App-level onRegistryRootChanged routes here (REQ-022)
setOrkyPaneHidden(paneId: string, hidden: boolean): void // BOTH hidden hosts drive it (REQ-010 T3 owns the restore fetch)
rebindOrkyPane(wsId: string, paneId: string, root: string): void  // updatePaneConfig + fresh fetch (exactly ONE — REQ-010)
```

Key testids (the DOM contract tests pin): `orky-pane` (the pane body, carrying `data-root`),
`orky-pane-unbound`, `orky-pane-unreadable`, `orky-pane-error`, `orky-pane-loading`,
`orky-pane-rebind`, `orky-root-picker` (+ `orky-root-picker-loading`, `orky-root-picker-error`,
`orky-root-picker-empty` — four mutually-distinct picker states, FINDING-009),
`split-kind-orky-<paneId>` (the compass kind button, FINDING-008), `orky-pane-feature` rows with
`data-project-root` + `data-feature` (`data-feature` = the payload's `slug`, the unique dir name —
FINDING-021), `orky-pane-feature-unreadable` (a skipped-slug row, carrying `data-feature` —
FINDING-004), `orky-pane-row-actions` (the reserved, F9-empty actions slot), `orky-pane-gates`,
`orky-pane-finding` rows (with `data-finding-id`), `orky-pane-escalation` rows (with
`data-escalation-id`).

---

## Requirements

### REQ-001 — `orky` is a first-class, persisted mosaic pane kind (D1) — `ux` `quality`
The workspace model MUST gain the pane kind `'orky'`: `OrkyConfig` joins the `PaneConfig` union,
`PaneKind` gains `'orky'`, `PaneTile` and `MinimizedPaneHost` render `OrkyPane` for it, and the
pane participates in every kind-generic pane operation — split/close, drag-rearrange,
minimize/restore, maximize, cross-workspace move, undock/redock, and workspace templates — through
the EXISTING kind-agnostic machinery (no new per-kind branch on any of those paths). The pane is
saved and restored with its workspace exactly like the three existing kinds; per-pane theme
overrides apply via the existing `themeCssVarsPartial` path.
**Acceptance:** a committed `orky` pane renders inside a `.mosaic` tile (testid `orky-pane` present
under `tile-<paneId>`); serialize → deserialize of a workspace containing it round-trips the
config byte-identically; minimize hides and restore re-shows it with binding intact;
`templateFromWorkspace` → `workspaceFromTemplate` reproduces an `orky` pane bound to the same root
under a fresh pane id; moving it to another workspace (and undocking that workspace) preserves
`config.root`; a per-pane `theme` override changes its rendered CSS variables.

### REQ-002 — `SCHEMA_VERSION` 7 → 8 with a deterministic, explicit migration (D1) — `determinism` `quality`
`SCHEMA_VERSION` MUST become 8, and `migrate()` in `workspace-model.ts` MUST gain an explicit
v<8 step that is a DOCUMENTED identity (a pre-v8 record cannot contain an `orky` pane, so no field
is rewritten — the bump exists so pre-v8 builds reject v8 files via the existing
"newer than supported" guard instead of loading a kind they cannot render). Migration MUST be
deterministic and idempotent: the same pre-migration bytes always produce the same post-migration
workspace value, and re-serializing a migrated workspace then deserializing again is a fixpoint.
Existing migration behavior (v<7 view-state init, dangling-ref pruning, malformed-view-state
tolerance, future-version rejection) MUST be byte-for-byte preserved. `app-state.json` needs no
content change (its migration keys only on the version bound — Verified contract).
**Acceptance (migration determinism vectors):** `SCHEMA_VERSION === 8`; a v6 fixture and a v7
fixture (terminal/editor/explorer panes) each deserialize with all panes preserved and (for v6)
empty view-state — twice, yielding deep-equal results both times; a v8 fixture containing an
`orky` pane round-trips serialize→deserialize byte-identically;
`deserialize(serialize(deserialize(x)))` deep-equals `deserialize(x)` for all fixtures; a
`schemaVersion: 9` fixture throws the existing "newer than supported" error; a saved v7
`app-state.json` still loads.

### REQ-003 — Supersede/amend the SIX colliding frozen point-in-time guards, at the tests phase, never silently — `quality`
Six frozen tests pin `SCHEMA_VERSION === 7` (one of them additionally pins the closed three-member
`PaneConfig` union) as a proxy for "my feature didn't change the persisted model": TEST-344 (F6
REQ-001/REQ-017), TEST-001 (0003 REQ-009), TEST-020 (0004 REQ-018), TEST-087 (F5 REQ-013),
TEST-038 (0014 REQ-017), and **TEST-008 (0001 REQ-007,
`tests/main/quick-store-toasts.test.ts:41-43`)** — the definitive, grep-pattern-documented
inventory is in the Verified contract (FINDING-001; the draft's five-item list was incomplete).
D1's mandated bump makes all six RED, so they are hereby **superseded in their point-in-time
form**. The amendment MUST happen at F9's TESTS phase, performed by the test-designer in the SAME
change that introduces F9's suite — never silently edited during implementation (CONV-019's
protocol) — and MUST preserve each guard's still-true intent: (a) TEST-344's union pin is
re-expressed as "no decision-queue pane kind exists and `PaneConfig` still contains the three
original members" (open-form), and its `SCHEMA_VERSION === 7` equality is dropped or re-pinned at
8 with a supersession note naming this REQ; (b) the five bare `toBe(7)` pins (TEST-001, TEST-020,
TEST-087, TEST-038, TEST-008) are re-pinned to the current constant (8) with a supersession note
in each, since their original invariant ("my feature persisted nothing new") is historical fact
their remaining assertions still capture. `04-tests.md` MUST record the supersession naming every
amended TEST id, its owning feature/REQ, and this REQ.
**Acceptance:** after F9's tests phase lands, the six tests PASS with `SCHEMA_VERSION === 8` and
the extended union; each amended file carries a supersession note naming F9 REQ-003; TEST-344's
amended form still FAILS on an injected `decision-queue` pane kind or removal of an original union
member; the amendments land in the same change as F9's suite (no implementation-phase edit of a
frozen test); a repo-wide `toBe\(7\)` grep over `tests/**` at the tests-phase gate finds no
remaining `SCHEMA_VERSION` value pin (only the two documented unrelated hits — Verified contract);
the full frozen-suite run is green at F9's implementation gate.

### REQ-004 — Creation affordances + tracked-root picker (D2) — `ux`
An `orky` pane MUST be creatable from (a) a command-palette action `'new-orky'` ("New Orky
pane…"), (b) the workspace tab bar's existing `add-pane` select (a fourth option) — both routed
through the centralized `dispatchAddPane` with an injected, api-free root-picker callback
(mirroring the explorer/`openFolder` pattern; CONV-006 — one callback, no primary+override pair) —
and (c) the split compass: `SplitMenu`'s kind group gains an `'orky'` kind button
(`split-kind-orky-<paneId>`, `aria-pressed` parity with the existing three — FINDING-008),
disabled when the held snapshot has no member (the explorer/cwd disabled precedent,
`SplitMenu.tsx:120`) — with an explanatory accessible name that MUST distinguish the two disabled
causes (FINDING-027, decision #4c): while the snapshot has NOT settled (`registrySnapshot === null
&& registryError === null`, the slice's derived-loading rule) the name is the LOADING wording
("tracked projects loading…" class — mirroring the picker's loading state), and ONLY a
genuinely-held `[]` snapshot gets the genuinely-empty wording ("no tracked Orky project yet — open
a terminal in a project containing `.orky/` to track one"); a user with tracked projects is never
told none exist during the startup window. With `orky` selected, activating a direction closes the
compass and opens the SAME picker, selection commits an `orky` pane split in that direction
relative to the source pane, and cancel commits nothing.
The picker MUST list exactly the member roots of the renderer's currently-held registry snapshot
(any `source` — pane, persisted, or both), reading ONLY the F5 read surface already subscribed
app-level (no new snapshot subscription, no `registryRoots()`, no mutation call). The picker's
boundary states are mutually distinct (FINDING-009): while no snapshot has settled
(`registrySnapshot === null && registryError === null` — the slice's derived-loading rule,
`registry-slice.ts:51`) it shows a **loading** state (`orky-root-picker-loading`), never the empty
copy; while `registryError` is held with no snapshot it shows an **error** state
(`orky-root-picker-error`) surfacing the slice's specific error text verbatim (CONV-001); a
genuinely-held `[]` snapshot shows the explicit, actionable **empty** state
(`orky-root-picker-empty` — how roots become tracked, not a bare empty list). Cancel/Escape MUST
commit no pane in every state. Choosing a root MUST commit an `orky` pane whose `config.root` is
that entry's `root` string VERBATIM. The picker is keyboard-operable: opened via the palette or
compass it receives focus (CONV-020's open half), arrow/Enter select, Escape cancels, and on close
focus is restored ONLY if it is still inside the picker (CONV-020's close half); as body-portalled
chrome it carries visible focus/hover styling (CONV-007).
**Acceptance:** each of the THREE affordances opens `orky-root-picker`; with a held snapshot of 3
members the picker lists exactly those 3 roots; selecting one commits a pane with `config.root`
byte-equal to the entry's `root`; via the compass, selecting a root commits the split in the
activated direction adjacent to the source pane, and cancelling after direction activation leaves
the pane set unchanged; with a null snapshot and no error the picker (and the compass kind button)
shows loading/disabled — NOT the empty copy — and the compass button's accessible name is the
LOADING wording; with `[]` held the compass button's accessible name is the genuinely-empty
wording, and the two names DIFFER (asserted against both states — FINDING-027); with a held
`registryError` and no snapshot the picker surfaces that exact error text; with `[]` held,
`orky-root-picker-empty` renders actionable copy; the three picker boundary testids are mutually
exclusive; Escape/cancel leaves the workspace's pane set unchanged in every state; keyboard-only
creation succeeds end-to-end through each affordance; a `:focus-visible`/allow-list assertion
covers the picker and the new compass button; the existing split-compass e2e suite passes
unchanged (open-form — Verified contract); grep confirms no `registryRoots(`/`registryAddRoot(` in
any F9 renderer file (TEST-362 stays green).

### REQ-005 — Binding persisted verbatim; membership matched via normalized equality (D2) — `determinism` `quality`
The persisted `config.root` MUST be stored and round-tripped VERBATIM (case-preserved, exactly the
aggregate entry's spelling — never re-cased, re-slashed, or re-resolved on save/load). Matching
the binding to an aggregate entry — and to a `registry:rootChanged` notification's root (REQ-010)
— MUST use a pure shared fold-injected equality (`sameProjectRoot(a, b, { caseFold })` — the same
slash-fold-always / case-fold-iff semantics as `normalizeProjectRoot` and F6's `foldPath`, as
EQUALITY, not containment), with the fold mode derived once via
`caseFoldFromPlatform(navigator.platform)` and INJECTED — the module MUST NOT read `process`
(undefined in the contextIsolated renderer main world though defined under vitest — F6's
FINDING-003 trap). Binding never contributes registry membership: the pane registers no watcher,
no `orkyWatch`, no engine consumer (a bound root's membership comes from terminals and the
persisted list exactly as today; a root that loses both sources renders REQ-011's unbound state).
**Acceptance:** restart round-trips a mixed-case root byte-identically; an aggregate entry whose
spelling differs from the binding only by case (with `caseFold: true`) or slash style still
matches, and does NOT match with `caseFold: false` on the case-divergent vector;
`C:\dev\Termhalla` does not match `C:\dev\TermhallaX` (equality, not prefix); host-independent
`path.win32`/`path.posix` vectors cover trailing separators, mixed separators, and a UNC root; a
code assertion confirms no `process` reference in the module or its renderer call path; grep
confirms the F9 renderer/component code calls no `orkyWatch` and the main-side detail handler adds
no engine consumer (REQ-008).

### REQ-006 — The read-only per-root detail channel: `registry:detail` (D3) — `quality`
The feature MUST add exactly TWO IPC surfaces, both in the `registry:*` read domain: this pull and
REQ-022's push notification — no other new channel, and no preload/main change beyond these two
surfaces plus the shared types. This REQ pins the pull: `CH.registryDetail = 'registry:detail'`, a
renderer→main `ipcMain.handle` request/response pull registered in the existing
`register-registry.ts` registrar (registered and disposed with its disposer), bridged by preload
method `registryDetail(root)`. The handler MUST (a) gate on `isKnownWindowSender` — an unknown
sender receives `{ ok:false, errorKind:'unknown-sender', ... }` and never the real payload, never
a throw; (b) accept ONLY a `root` that is a current aggregate MEMBER (normalized-key comparison
against the registry's membership — pane, persisted, or both) — any other value, including a
non-string, gets `{ ok:false, errorKind:'root-not-tracked' }` with a specific error naming the
input (CONV-001), so the channel can never be used to read arbitrary filesystem paths; (c) never
throw and never reject for any input (CONV-002).
**Acceptance:** the diff adds exactly two `CH.*` constants (`registryDetail`,
`registryRootChanged`); a fake-sender invoke returns the structured unknown-sender rejection with
no fs read performed (spy); `registryDetail('C:\\not-tracked')` and `registryDetail(42 as never)`
return `ok:false` `root-not-tracked` with an error naming the value; a member root returns
`ok:true`; the registrar's disposer removes the handler; grep confirms no `webContents`/broadcast
send for the `registry:detail` channel (it is pull-only; the push is REQ-022's separate channel).

### REQ-007 — Detail payload pinned field-by-field against the real on-disk shapes (D3) — `determinism` `quality`
The `ok:true` payload MUST be exactly the Public-interface shape, derived from the SAME mapper
pipeline the aggregate uses, plus the detail layers the aggregate drops — pinned against the real
`state.json`/`findings.json` shapes in the Verified contract: **each `features[i]` carries
`slug` — the feature's DIR name from the sorted walk, verbatim — the payload's UNIQUE per-feature
key (FINDING-021: `status.feature` comes from `state.json`'s `feature` field with the
`'(unknown)'` fallback and is NOT unique — a copied feature dir or two malformed `state.json`
collapse onto one value; the dir name is unique by construction, and REQ-009/REQ-012 key rows,
disclosure state, and `data-feature` on it)**; `features[i].status` is the UNMODIFIED
`orkyFeatureStatus(...)` output (same active-slug / live-phase / heartbeat / stall inputs the
engine's `reread` computes — including `active.json` handling); `gates` has exactly one entry per
`ORKY_PHASES` member in canonical order, mapping `passed` verbatim (`null` when unrecorded), `at`
through `parseOrkyTimestamp` (tz-safe epoch ms, `null` when absent/unparseable), `evidence`
string-or-null, `external === true` only on an explicit `true`; `findings` maps the array verbatim
in FILE ORDER with `blocking` computed by the SHARED `isBlockingFinding(f)` export — the predicate
extracted behavior-identically from `openBlockingCount`'s loop body (`orky-status.ts:134-143`),
which delegates to it (the sanctioned shared refactor, FINDING-002; REQ-013/REQ-015) — i.e. open ∧
(CRITICAL/HIGH ∨ `contract_violation === true`), case-insensitive status/severity; `escalations`
maps `state.json.escalations` verbatim in FILE ORDER with `at`/`resolvedAt` through
`parseOrkyTimestamp`. `activeFeature` is the `active.json` slug (basename rule, engine parity) or
`null`. `computedAt` is the ONE injected clock instant used for EVERY time-derived datum in the
payload (stall flags, "stalled Xm" wording) — a payload is internally clock-consistent by
construction (FINDING-005). Every field MUST be total over malformed input: a missing/mistyped
source field maps to its pinned null/''/false default, never a throw, and never a mistyped value
passed through to be rendered (the F6 FINDING-021 lesson). The payload MUST be a pure function of
(the on-disk bytes, the injected clock). **No-contradiction claim, correctly scoped
(FINDING-005/FINDING-006):** for the same bytes AND the same injected clock, over fixtures with ≤
`MAX_FEATURE_DIRS` feature dirs, `features[i].status` deep-equals what the aggregate computes — in
production the aggregate's entry was clocked at the last fs-event-driven re-read, so
time-sensitive divergence (a stall-threshold crossing, which produces NO fs event) is expected and
is arbitrated by REQ-009 (the detail payload wins for everything the pane displays); the
aggregate's fs-event-gated stall blindness is recorded as an upstream F5 note (Open questions).
**Acceptance:** a fixture `.orky/` tree built from THIS repo's real 0006 `state.json`/
`findings.json` bytes yields a payload asserted field-by-field (gate with `tokens`+no evidence,
human gate with `evidence`+`external:true`, unrecorded gate → `passed:null`, a resolved escalation
with `decision`/`resolvedAt`, findings with and without `resolution`); every `features[i].slug`
byte-equals its fixture dir name; a duplicate-`feature`-field fixture (TWO dirs whose `state.json`
share one `feature` value) yields TWO entries with distinct `slug`s (FINDING-021);
blocking-predicate vectors: a `blocking:true` open-HIGH, a `blocking:false` resolved-HIGH, **a
`blocking:true` open-MEDIUM with `contract_violation: true` (the OR-branch), and a
`blocking:false` RESOLVED `contract_violation: true`** (FINDING-007); tz-less ISO `at` values
parse identically under two TZ environments; malformed vectors (object `severity`, numeric
`claim`, non-array `escalations`, garbage `gates`) yield defaults with no throw; two reads of the
same fixture WITH the same injected clock are deep-equal and carry that clock as `computedAt`; the
feature's `status` deep-equals the aggregate's entry for the same fixture bytes UNDER the same
injected clock (fixture ≤ 200 features); a code assertion confirms the assembler imports
`isBlockingFinding` and contains no local status/severity/`contract_violation` predicate.

### REQ-008 — Detail read: engine-parity bounds, deterministic cap, torn-write stability, one-shot (D3) — `performance` `determinism` `quality`
The detail read MUST reuse the engine's read semantics and resource bounds — the SAME
`MAX_FEATURE_DIRS` (200) and `MAX_FILE_BYTES` (1 MiB) constants (warned, never silent — CONV-003)
and the SAME symlinked-feature-dir skip — with THREE pinned, deliberate divergences:
**(a) Deterministic survivor set (FINDING-006):** the slug list from `readdir` is sorted by
codepoint BEFORE the `MAX_FEATURE_DIRS` cap is applied, so WHICH 200 features survive is a pure
function of the on-disk state (the engine's own cap slices raw enumeration order,
`orky-root-engine.ts:196-203` — accepted as a flagged upstream F5 note, NOT changed by this
feature); `featuresCapped: true` is still surfaced on truncation.
**(b) Torn-read stability (FINDING-004):** the producer writes `state.json` non-atomically
(Verified contract) and the one-shot read has no watcher-style `awaitWriteFinish` shield, so: when
a target file EXISTS but fails `JSON.parse`, the read retries THAT file exactly once after a fixed
short delay (150 ms — the watcher's own stability threshold, `orky-root-engine.ts:111`); if it
still fails, the failure is SURFACED, never silently dropped: a `state.json` that stays
unreadable/unparseable/oversized puts its slug in `skippedFeatures` (rendered per REQ-009/REQ-011
as an explicit per-feature unreadable row); a `findings.json` that stays unreadable/oversized
yields `findings: []` + `findingsUnreadable: true` on that feature with gates/escalations intact;
an unparseable `active.json` yields `activeFeature: null` (absent-equivalent, engine parity).
Absent files retry nothing (absence is a legitimate state — engine parity); oversized files retry
nothing (deterministic skip, with the engine's warn). An `ok:true` payload is never silently
shorter than the tree: every feature dir whose `state.json` exists appears in `features` OR
`skippedFeatures`.
**(c) Unreadable is surfaced, not swallowed** — the engine's silent per-feature skip
(`orky-root-engine.ts:215-217`) is replaced by the markers above on THIS path only; the engine is
untouched.
**Accepted staleness class — cross-FILE read skew (FINDING-033; documented and accepted, not
fixed):** an `ok:true` payload is coherent per-FILE, not per-feature-ACROSS-files. `state.json`
and `findings.json` are read sequentially with independent bounded retries, and the producer
writes them from separate commands (`state.json` via plain `writeFileSync`, `findings.json` via
temp+rename — Verified contract), so within ONE payload a feature's `status`/`gates`/`escalations`
and its `findings` can straddle a producer write (e.g. a gate recorded in `state.json` whose
paired ledger write lands after that feature's `findings.json` read). This is ACCEPTED because it
is bounded and self-healing by construction: each producer write fires the watcher → 300 ms
debounce → completed engine re-read → REQ-022 `rootChanged` notification → a DISPLAYED pane
refetches (a hidden pane marks `stale` and heals on display), so a skewed payload survives at most
one notification cycle (~450 ms) while displayed. No cross-file transaction/arbitration mechanism
is added; REQ-021's feature doc MUST record this property and its healing mechanism alongside the
retry/skipped-feature semantics.
It MUST be a ONE-SHOT read: no chokidar watcher, no engine consumer registration, no timer/poll
left behind (the bounded retry's single short delay within one request is not a recurring timer),
and no write of any kind. A missing `orkyDir` returns `ok:false` `errorKind:'orky-missing'` with
an error naming the path; a present-but-empty tree returns `ok:true` with `features: []` (the
engine's unreadable-vs-empty distinction, REQ-018 parity). Concurrent requests are safe (stateless
handler); the renderer's own trigger discipline (REQ-010) bounds request frequency.
**Acceptance:** a fixture with 201 feature dirs returns the FIRST 200 slugs in codepoint order as
the survivor set regardless of shuffled enumeration order (injected/mocked `readdir`), with
`featuresCapped: true` and the warn fired; a torn `state.json` (truncated JSON prefix) that is
repaired before the retry delay elapses yields the full feature (retry succeeded); one that stays
torn yields `ok:true` with the slug in `skippedFeatures` and siblings intact — never a
silently-shorter `features`; a torn `findings.json` yields `findingsUnreadable: true` with
gates/escalations populated; an oversized `state.json` puts the slug in `skippedFeatures` with no
retry; a symlinked feature dir is skipped with siblings intact; after a detail call the engine's
consumer/watcher count is unchanged (spy/`getConsumers` assertion) and the fixture `.orky/` tree
is byte-identical; a deleted `orkyDir` returns `orky-missing` naming the path; an empty `.orky/`
returns `ok:true, features: [], skippedFeatures: []`.

### REQ-009 — Bound rendering: the FULL project status, one snapshot, one clock (D3/D5) — `ux` `determinism`
A bound pane whose root is a member MUST render: a header with the project name (basename), the
full root (hover `title`), the entry's `source` provenance, and the project roll-up signals
(needs-human/failed accents, stall wording); and a feature section listing EVERY feature from the
detail payload — including `idle` and clean-`done` features the aggregate's popover set excludes
(pinned: `inPopover` drops them; the pane must not) — each row showing, from carried fields only:
the slug, live `phase` (a `null` phase renders the established `?? 'done'` convention, never the
literal "null"), `gateN/gateM`, the `reason` when `needsHuman`, `openBlocking` when > 0, and
`detail` verbatim (ellipsized text carries a `title`, the F6 FINDING-014 lesson).
**Single source + single clock (FINDING-004/FINDING-005 arbitration):** once a detail payload is
held, the header's roll-up signals MUST derive from THAT payload's carried statuses — the same
fetched snapshot, computed at the same `computedAt` instant, that the rows render — never from the
aggregate entry's (older, differently-clocked) `status`; the aggregate entry supplies ONLY
membership, `source` provenance, and the unbound transition. When detail and aggregate disagree
(torn-write recovery, stall-threshold crossing), the detail payload — the newer read — wins for
everything the pane displays; the renderer never re-derives stall/elapsed with its own clock
(fields render verbatim, REQ-015), so header and rows cannot split-brain by construction. Before
the first settle the header shows name/root/source plus the explicit `orky-pane-loading` state
(distinct from unbound/unreadable/error); roll-up accents appear from the settled payload.
Each feature MUST expand (or otherwise expose) its per-gate records (all 8, canonical order,
pass/fail/unrecorded + `at` + `external` marker), its findings (id, severity, status, `blocking`
mark, claim verbatim), and its escalations (id, status, reason, decision when resolved). A skipped
slug (`skippedFeatures`, REQ-008) MUST render as an explicit per-feature unreadable row
(`orky-pane-feature-unreadable`, carrying `data-feature`) — never vanish; `findingsUnreadable`
MUST render an explicit findings-unreadable note in that feature's findings section. Long content
scrolls WITHIN the tile (the mosaic layout never overflows).
**Acceptance:** a fixture with a needs-human, a busy, an idle, and a clean-done feature renders
FOUR `orky-pane-feature` rows (the aggregate's `status.features` for the same fixture carries
fewer — asserted, pinning the aggregate-omission claim); a null-phase feature's row contains no
"null"; gate/finding/escalation content maps 1:1 from the payload (code assertion: fields
rendered, not recomputed); **the gates display set is EXHAUSTIVE per gate (the FINDING-024 class —
each MUST-listed datum has its own vector): an expanded feature's gate records expose, for every
RECORDED gate, its `at` (rendered/formatted from the carried `OrkyGateDetail.at` epoch — via
main-side assembly or a sanctioned pure formatter, NEVER a renderer clock derivation — and exposed
in the gate's text or `title`) alongside pass/fail/unrecorded state and the `external` marker —
asserted for a passed gate WITH `at`, a failed gate WITH `at`, and an unrecorded gate (no `at`,
no invented text); with a comparator-top feature whose carried `reason` is `stalled`, the HEADER
renders the payload's carried stall wording (`reason`/`detail` verbatim) — asserted DISTINCT from
the same fixture with an awaiting-human-review reason (the two headers must not be
indistinguishable)**; with an injected STALE aggregate entry saying `busy` and a fresh detail
payload whose carried statuses say stalled/needs-human, BOTH the header accents and the rows
render the detail's signals (no header/body split); a payload with a `skippedFeatures` slug
renders the unreadable row for it alongside intact siblings; a `findingsUnreadable` feature
renders the note with its gates/escalations intact; a source-scan confirms no `Date.now()`/clock
read in the pane's status-rendering paths; the rows live in a scrollable container inside the
tile; loading shows before the first settle and never after it.

### REQ-010 — Refresh triggers pinned exactly: bind events + own-root change notification (FINDING-003; displayed model corrected per FINDING-013/020/031) — `performance` `determinism`
The pane MUST fetch detail on exactly these triggers and no others:
**(T1) bind events** — pane mount with a bound member root (a GENUINE fresh mount: no surviving
`orkyPaneDetail` entry for the pane — new pane, undock/redock re-creation in another window's
store); re-bind (REQ-011); or the bound root RE-ENTERING aggregate membership after an unbound
spell (which MUST resume bound rendering automatically, no manual re-bind; membership transitions
remain snapshot-derived).
**(T2) own-root change notification** — a `registry:rootChanged` push (REQ-022) whose root
`sameProjectRoot`-matches the pane's binding (REQ-005), while the pane is DISPLAYED and its root
is a member.
**Displayed — defined against the REAL mount model (FINDING-013, amended for FINDING-035).** A
pane is **displayed iff its tile is in its window's ACTIVE workspace's visible mosaic, it is not
minimized, AND no OTHER pane is maximized over it.** The shipped renderer has THREE
keep-mounted-but-hidden hosts and the boundary MUST cover ALL of them: (a) the minimized host
(`MinimizedPaneHost.tsx:35-46` — `visibility: hidden` + `aria-hidden` +
`pointer-events: none`; it passes `hidden` into `OrkyPane`), (b) the INACTIVE-workspace host —
`App.tsx` keeps EVERY workspace mounted and hides the inactive ones the same way
(`App.tsx:155-172`; a workspace switch does NOT unmount panes — the draft's "remount on workspace
switch" premise was FALSE), while `PaneTile.tsx:148` mounts `OrkyPane` with no `hidden` prop, and
(c) the MAXIMIZED-OVER host — when a sibling pane is maximized, `.ws-max` hides every other tile
with the same `visibility: hidden` pattern (`index.css:282-283`) without unmounting it; a
maximized-over pane is NOT displayed (acceptance: with a bound OrkyPane maximized-over in the
active workspace, N own-root notifications sustain 0 fetches + `stale`; un-maximizing fetches
exactly once iff stale — same vectors as workspace activation). The
pane's effective hidden state MUST therefore thread workspace activity in (e.g.
`PaneTile`/`WorkspaceView` passes `hidden={workspace not active}` exactly as the minimized host
passes `hidden`): a pane in a BACKGROUND workspace is NOT displayed and behaves exactly like a
minimized one — notifications suppress into `stale`, never a fetch, no matter how busy the bound
root is.
**(T3) hidden→displayed transition with suppressed staleness** — a hidden pane (EITHER hidden
host) receiving a T2 notification fetches nothing and instead marks itself `stale`; on becoming
displayed again a stale pane fetches exactly once, and a NON-stale pane fetches ZERO times (the
held detail renders as-is, no loading flash). **Grounded in remount reality (FINDING-020):**
minimize→restore is a cross-HOST REMOUNT (`MinimizedPaneHost.tsx:23-26` — "before the source
unmounts, and this mount re-adopts"; restore mounts a FRESH `OrkyPane` instance under `PaneTile`),
whereas workspace activation flips the SAME mounted instance's effective visibility with NO
remount — and the fetch counts MUST hold identically across both mechanics. The T3 path ALONE
owns the hidden→displayed fetch decision: the mount/bind effect MUST NOT treat a restore-remount
as a fresh T1 bind (the surviving `orkyPaneDetail` entry identifies it at mount time — entry
present, binding `sameProjectRoot`-matching, `hidden: true` — consult it via `getState()` at
event time, CONV-021), and re-bind issues exactly ONE fetch (never a redundant mount-effect or
coalesced duplicate on top of `rebindOrkyPane`'s own).
**Trigger × state transition matrix (pinned — fetch counts are exact):**

| Pane state when the trigger lands | Own-root notification (T2) | Becomes displayed (restore remount OR workspace activation) | Re-bind (T1; reachable only while displayed) |
|---|---|---|---|
| Displayed, idle | fetch exactly once | — | fetch exactly once |
| Displayed, fetch in-flight | exactly ONE coalesced follow-up | — | coalesce; latest root wins; still one follow-up total |
| Hidden (minimized OR background workspace) | ZERO fetches; entry marks `stale` | `stale` → exactly ONE fetch; not `stale` → ZERO fetches (held detail renders) | n/a (hidden panes are not interactable) |
| Unbound / non-member | ZERO fetches | ZERO fetches (unbound state renders) | the re-bind IS the bind event: exactly one fetch |

**Non-triggers (pinned):** aggregate snapshot pushes NEVER fetch — not for own-entry value
changes, not for other roots, not for value-identical pushes (an own-entry change may re-render
the header's membership/source per REQ-016, but the fetch keys on notifications only — the entry
is lossy exactly along the detail dimensions, decision #7); notifications for OTHER roots;
notifications while unbound or hidden (hidden sets `stale`); membership LOSS (→ the unbound state,
not a fetch); workspace switches and restores with no suppressed staleness (ZERO fetches — the
matrix above). There MUST be no polling and no timer: notification frequency is upstream-bounded
by the engine's own 300 ms debounce (`orky-root-engine.ts:79, :159-167`), and the renderer's
coalescing IS the in-flight discipline below — no renderer-side timer exists.
**Concurrency:** at most one in-flight fetch per pane; a trigger arriving mid-flight schedules
exactly ONE coalesced follow-up (latest root wins); a settling response is DISCARDED unless it
matches the pane's current binding and fetch generation (issue-time guard — the F6 REQ-003
arbitration pattern; no IPC-ordering assumption may be load-bearing — notification-vs-snapshot
arrival order is explicitly not relied upon). **The coalesced follow-up re-checks the
displayed/bound gate at SETTLE time (FINDING-031):** a `pendingRefetch` settling into an entry
that became HIDDEN mid-flight MUST convert to `stale: true` and issue nothing (the T3 restore
fetch then covers it); one settling into an entry that became unbound (`root === ''`) or whose
binding no longer matches MUST be dropped outright — a hidden or unbound pane never fetches, not
even via a follow-up queued while it was still displayed.
**Acceptance:** with a pane bound to root A (fetch spy): mount fetches once; an own-root
notification while displayed fetches once; three rapid A-notifications during one in-flight fetch
produce exactly one follow-up fetch; a notification for root B fetches zero times; a pushed
snapshot changing only root B's entry fetches zero times; a snapshot push changing A's entry
WITHOUT a notification fetches zero times (single-trigger discipline — header may re-render); a
deep-equal-but-`!==` push fetches zero times; **background-workspace vectors (FINDING-013): an
A-notification while the pane's workspace is INACTIVE fetches zero times and marks the entry
`stale`; N ≥ 3 rapid own-root notifications against a background-workspace pane sustain ZERO
fetches; activating that workspace then fetches exactly once; activating a background workspace
whose pane received NO notification fetches zero times**; **restore vectors driven through the
REAL component lifecycle (FINDING-020 — unmount from the minimized host, fresh mount under the
tile host, with a `registryDetail` call-count spy; the slice seam alone is insufficient): a
minimized pane receiving an A-notification fetches zero times, then restore fetches EXACTLY once
(one IPC call total — never a T1+T3 double or a coalesced second); restore with NO suppressed
notification fetches ZERO times and the held detail renders with no loading flash; a re-bind
issues EXACTLY one fetch (call-count spy — never a redundant follow-up)**; **mid-flight
transition vectors (FINDING-031): a pane hidden (minimized or workspace-deactivated) while a
fetch is in-flight with a queued follow-up settles WITHOUT issuing the follow-up and carries
`stale: true`; a pane whose binding is unbound/non-matching at settle time issues no follow-up**;
a response settling after the pane re-bound to root C is discarded (DOM shows C's loading/detail,
never A's); removing A from membership fetches zero times and shows unbound; re-adding A fetches
once and resumes bound rendering; grep confirms no `setInterval`/recurring timer in the feature's
renderer code.

### REQ-011 — Explicit unbound / unreadable / error states, re-bind affordance (D2) — `ux`
Three non-crash, mutually-distinct degraded states MUST exist. **Unbound** (`orky-pane-unbound`):
the bound root is not a member of the held snapshot (or `config.root` is `''`) — renders the
resolved spec-time copy naming the persisted root verbatim, plus a native-button re-bind
affordance (`orky-pane-rebind`) opening the SAME picker as creation (REQ-004, including its
loading/error/empty state discipline); re-binding updates `config.root` (persisted via the
existing `updatePaneConfig`/autosave path) and fetches fresh. **Unreadable**
(`orky-pane-unreadable`): the root IS a member but its detail fetch returned `orky-missing` (or
the entry's `status` is `null` with a failed fetch) — copy names the root and that `.orky/` is
missing/unreadable, distinct from unbound (the root is still tracked). **Error**
(`orky-pane-error`): a fetch failed for any other reason — the SPECIFIC error text (CONV-001),
while any membership-derived header data keeps rendering; a later successful fetch clears it.
(Per-FEATURE unreadability inside an `ok:true` payload is NOT this pane-level state — it renders
REQ-009's `orky-pane-feature-unreadable` row / findings-unreadable note with the rest of the pane
healthy.) No state may throw, render a silent empty, or be worded as healthy when it is not (and
vice versa). While a valid detail is held, a FAILED refresh keeps rendering the stale-but-valid
detail (with the error surfaced inline), never blanks it.
**Acceptance:** a state-matrix test drives all states and asserts the four testids
(`-loading`/`-unbound`/`-unreadable`/`-error`) are mutually exclusive; unbound copy contains the
persisted root byte-verbatim; the re-bind button is a real `button`, keyboard-activatable, and
re-binding to a listed root updates `config.root` (asserted in the serialized workspace) and
renders bound content; deleting the fixture's `.orky/` dir (root still persisted-tracked) yields
`orky-pane-unreadable` naming the root (driven end-to-end by the deletion's own `rootChanged`
notification, REQ-022); a refresh failure after a good detail keeps the feature rows rendered with
the error visible; no state transition throws.

### REQ-012 — Per-row stable identity + reserved actions region (D4, for F10) — `quality` `ux`
Every feature row MUST expose the stable identity `data-project-root` (the entry's `root`,
verbatim) + `data-feature` (the payload's `slug` — the feature DIR name, verbatim, UNIQUE by
construction; never `status.feature`, which can collide — FINDING-021) — the SAME
`(projectRoot, featureSlug)` identity F6 established and F7's request shapes take — and MUST
contain an explicitly reserved, F9-EMPTY trailing actions slot (`orky-pane-row-actions`)
sized/positioned so F10 can inject answer/resume/record-gate affordances without restructuring row
layout, identity, or ordering. The React render key of each feature row AND its disclosure
(expanded/collapsed) state MUST also key on the `slug` (a duplicate-`feature`-field payload must
never produce duplicate React keys, a shared disclosure entry, or duplicate row identities —
FINDING-021). Escalation rows MUST additionally carry `data-escalation-id` (F7's
`resolveEscalation` takes `(projectRoot, feature, escalationId)`). F9 itself renders NO action
affordance and calls NO `orkyAction:*` method.
**Acceptance:** each rendered row carries both data attributes byte-matching the fixture
(`data-feature` = the dir slug); a duplicate-`feature`-field fixture (two dirs, one shared
`feature` value) renders TWO rows with DISTINCT `data-feature` values and INDEPENDENT disclosure
state (toggling one leaves the other collapsed); each row contains the empty
`orky-pane-row-actions` element; escalation rows carry `data-escalation-id` matching the payload;
grep confirms no `orkyAction` reference in any F9 file; injecting a mock button into the actions
slot (test-only) changes no row order and no identity attribute.

### REQ-013 — Read-only scope guard (D4) — `quality`
This feature MUST NOT: write/create/delete any file under any `.orky/` tree (renderer OR main
side); invoke any CLI or `child_process`; call any `orkyAction:*` method; reference the registry
mutation surface in the renderer (`registryRoots(`/`registryAddRoot(`/`registryRemoveRoot(`/
`RegistryMutationResult` — TEST-362 must keep passing byte-unchanged); register any engine
consumer or watcher (REQ-008 — the `rootChanged` notification rides `OrkyRegistry`'s EXISTING
engine subscription, `orky-registry.ts:42-45`, adding no consumer); or add any absence-of-consumer
freeze test (none is needed — F9 is itself the `registry:detail` consumer, so CONV-019's naming
rule has no new guard to bind; state this in `04-tests.md` rather than freezing a vacuous guard).
Persisted state is exactly the `OrkyConfig` inside the existing workspace files — no new persisted
file, nothing else persisted. Shared multi-owner files touched (`types.ts`, `workspace-model.ts`,
`quick.ts`, `pane-ops.ts`, `PaneTile.tsx`, `SplitMenu.tsx`, `register-registry.ts`,
`ipc-contract.ts`, preload, store composition, **and `src/shared/orky-status.ts`** — the
`isBlockingFinding` extraction, REQ-007: behavior-identical, `openBlockingCount` delegates to it,
guarded by REQ-015's equivalence vectors, never a semantic change) MUST NOT gain a whole-file
content-freeze test (CONV-012) — pin F9's OWN additions structurally.
**Acceptance:** an integration run (create, bind, browse, re-bind, refresh, close) leaves the
fixtured `.orky/` tree byte-identical; grep confirms no `child_process`/`execFile`/`orkyAction`/
mutation-surface symbol in F9's files; `tests/shared/registry-no-renderer-ui.test.ts` passes
unmodified; the existing `orky-status` behavior suite passes unmodified after the extraction (plus
REQ-015's equivalence vectors); the only persisted-format change is the `PaneConfig` union +
`SCHEMA_VERSION` (REQ-002); no new content-freeze test lands on a shared file.

### REQ-014 — Ordering determinism: payload-canonical + comparator display order — `determinism`
Payload order — and, per REQ-008(a), the cap's SURVIVOR SET — MUST be deterministic and
independent of `readdir`/fs enumeration order: `features` sorted by `status.feature` codepoint
(never `localeCompare`) with the carried `slug` codepoint as the tiebreak — a TOTAL, unique order
even under duplicate `feature` fields (FINDING-021; equivalent to a stable sort over the
slug-sorted walk); the `MAX_FEATURE_DIRS` cap applied only AFTER the walk's slug sort; `gates` in
`ORKY_PHASES` order; `findings`/`escalations` in file (array) order verbatim. DISPLAY order of
feature rows MUST be the shared exported `compareOrkyFeatures` (single definition, never copied —
needs-human first, reason rank, newer activity, slug codepoint), applied to the payload's carried
`status` values. Identical payload in → identical DOM order out: two deep-equal payloads render
byte-identical row orders; no ordering path uses locale comparison, `Date.now()`,
`Math.random()`, or Map-iteration order beyond the sorted inputs.
**Acceptance:** 100 shuffled-input rebuilds of the payload-assembly seam produce one `features`
order (and, over a >cap fixture, one survivor set); a duplicate-`feature`-field fixture produces
ONE deterministic order across shuffled rebuilds (the slug tiebreak); a payload with an escalation
feature, a stalled feature, a human-review feature, an idle and a done feature renders rows in
comparator order (asserting the shared import — code assertion: one definition, no local
comparator); rendering two deep-equal payload objects yields identical
`(data-project-root, data-feature)` sequences; grep confirms no `localeCompare` in the feature's
ordering paths.

### REQ-015 — Reuse, don't fork: mappers, conventions, presentation substrate (D5) — `quality`
The pane MUST consume `@shared/orky-status`'s mappers, `compareOrkyFeatures`, and (via the
main-side assembler) `isBlockingFinding`, plus F6's fold-injection utilities and the existing
store/pane machinery — never a re-implementation. What is forbidden is **RE-DERIVING** status
semantics, never referencing a shared export (FINDING-002): the RENDERER (the component and F9's
renderer presentation modules) MUST NOT recompute gate math, needs-human/stall/escalation state,
or the blocking predicate — fields render verbatim; the main-side payload ASSEMBLER is the
sanctioned mapper-pipeline caller and MUST import the shared pipeline
(`orkyFeatureStatus`/`normalizeFeatureRaw`/`normalizeFindings`/`parseOrkyTimestamp`/
`isBlockingFinding`) rather than fork it. No completeness word ("done"/"complete") may render
except from the carried signals (`phase ?? 'done'` on a null LIVE phase, `kind === 'done'`,
`gates[i].passed` — CONV-009); new presentation logic follows the pure-module + source-scan
testability pattern (node-env vitest; pure modules import no DOM/Electron/`../api`/node builtins
and read no ambient platform state); store state read only inside event handlers is read via
`getState()` at event time (CONV-021 — e.g. the picker's selection handler, the re-bind handler).
The `isBlockingFinding` extraction MUST be behavior-identical, proven by equivalence:
`openBlockingCount(v) === v.filter(isBlockingFinding).length` over a generated vector set
(mixed-case status/severity, `contract_violation` with open/resolved status, non-object entries,
missing fields).
**Acceptance:** code assertions — the COMPONENT and F9's RENDERER presentation modules contain no
`gateFrontier`/`isStalled`/`openBlockingCount`/`isBlockingFinding`/`ORKY_AUTONOMOUS_PHASES`/
`inPopover`/`orkyFeatureStatus(` reference and no local predicate re-deriving any of them (the
main-side assembler is explicitly exempt from this scan — it is REQUIRED to import the pipeline,
asserted in REQ-007); `compareOrkyFeatures` is imported, not redefined; the pure modules contain
no `from 'node:`/`electron`/`../api`/`process` reads; a null-phase and a complete-feature fixture
render no un-carried completeness word; the equivalence property above passes over the generated
vectors; a `getState()` (not hook-subscription) read is asserted on the handler-only paths.

### REQ-016 — Render isolation: cross-root churn re-renders nothing (performance) — `performance`
A mounted pane MUST subscribe to the aggregate NARROWLY: its rendered output derives from (a) its
own entry's value (membership/source), (b) its own detail state, both behind equality-guarded
selectors — so an applied snapshot that changes only OTHER roots' entries causes ZERO re-renders
of this pane, a value-identical push causes zero store notifications at all (already guaranteed
upstream — Verified contract — and MUST NOT be defeated by a new subscription that dodges the
slice), and a `rootChanged` notification for another root causes zero re-renders and zero fetches
of this pane (REQ-022's fan-out MUST be per-root targeted, not a broadcast re-render). Derived
per-pane selectors MUST be memoized so an unchanged input re-derives nothing; a genuinely changed
own-entry or detail MUST re-render promptly (no over-memoization). Detail payload
normalization/derivation runs at most once per settled fetch.
**Acceptance:** with a render-count probe on a pane bound to root A: a push changing only root B's
entry → 0 re-renders; a deep-equal push → 0; a B-root notification → 0 re-renders and 0 fetches; a
push changing A's entry → exactly one re-render pass reflecting the change (no fetch, REQ-010); an
A-root notification → one fetch, then exactly one re-render on settle; a settled fetch triggers
one derivation (spy); mounting a second pane bound to root B does not re-render the A pane on
B-only churn.

### REQ-017 — Full pane-lifecycle citizenship + runtime-state hygiene (D1) — `quality` `ux`
Undock/redock, cross-workspace move, minimize/restore, maximize, window-state restore, and
duplicate bindings (two panes on the same root — each independently correct) MUST all work via the
existing kind-generic paths, and every per-pane runtime entry F9 adds (`orkyPaneDetail`, any
fetch/staleness bookkeeping) MUST be pruned through the SAME `clearPaneRuntime` seam that drops
the other per-pane maps — on pane close, workspace close, AND the move-away/redock path (CONV-011;
the F6 FINDING-017 lesson) — so no entry outlives its pane and a reused pane id inherits nothing
stale. A restored (from minimize) or re-adopted (moved) pane MUST show current data (REQ-010's
T1 mount/bind and T3 stale-restore triggers cover it — with REQ-010's remount-grounded fetch
counts: zero when not stale, exactly one when stale).
**Acceptance:** closing a pane removes its `orkyPaneDetail` key (asserted gone); moving a pane to
another workspace/window prunes the source store's entry; two panes bound to the same root render
independently and closing one leaves the other intact (an own-root notification fetches for BOTH
displayed panes, coalesced per pane); minimize → change fixture → restore shows the updated data
(the change's notification marks the hidden pane stale; restore fetches exactly once — REQ-010
T3); a full undock/redock e2e keeps binding and content.

### REQ-018 — Accessibility + keyboard operability inside a tile — `ux`
The pane body MUST be a labeled region (`role`/`aria-label` naming the bound project) reachable by
keyboard; its scroll container MUST be keyboard-scrollable (focusable, arrow/PageUp/PageDown);
expandable sections (gates/findings/escalations) MUST be native-button or otherwise
keyboard-activatable disclosures with `aria-expanded`; the re-bind and picker affordances are real
`button`s; NO `role="button"` container may wrap other controls (Children-Presentational — the F6
FINDING-008 lesson), and any row-level key handling MUST target-guard so nested controls' keys are
never swallowed. Focus indicators MUST be visible for every focusable F9 surface (inside the
mosaic subtree via its existing styles or explicit rules; body-portalled picker chrome via the
CONV-007 allow-lists — never `outline: none`). The picker's CONV-020 focus contract is REQ-004's;
the compass kind button inherits SplitMenu's existing roving/trap discipline (REQ-004).
FINDING-023's deferred close-time-focus pinning test is explicitly NOT inherited here: F9 does not
touch `DecisionQueuePanel` or its focus behavior; that residual remains F8's, per the 0006
follow-ups doc.
**Acceptance:** keyboard-only navigation reaches the pane, scrolls the list, expands a feature's
gates/findings, and activates re-bind; disclosures expose `aria-expanded` in sync; a source-scan
asserts no `role="button"` in F9 components and target-guarded key handlers; a
`:focus-visible` style assertion covers the pane's focusable rows/buttons and the picker; the
region's accessible name contains the project name.

### REQ-019 — Theme-aware presentation — `ux`
All pane and picker surfaces MUST style via the existing theme CSS variables (the
`var(--panel)`/`var(--fg)`/`var(--fg-dim)`/`var(--border)` family with their standard fallbacks,
plus the established status colors for needs-human/failed accents) so app, workspace, AND per-pane
theme overrides apply (the per-pane override arrives via `PaneTile`'s `themeCssVarsPartial` —
the pane must not defeat it with hard-coded colors on parameterized surfaces). **Every CSS custom
property the feature references MUST be DEFINED** — by the theme system's var map
(`src/shared/theme.ts`) or an `index.css` rule — **and MUST carry that token's established
fallback**: a `var()` naming an undefined variable, or a defined variable with a novel fallback
literal, is a hard-coded color no theme override can reach (the FINDING-025 class — the
established failure token is `--status-failure`/`#c62828`, `index.css:59,65`; `--status-needs`'
standard fallback is `#ff8f00`, `index.css:11,50`/`Toasts.tsx:8`; NO `--status-fail` variable
exists anywhere).
**Acceptance:** changing `--panel` on an ancestor changes the pane's rendered background; a
per-pane `config.theme` override is reflected inside the pane body; a source-scan (the TEST-350
pattern) confirms raw hex literals appear only as `var(--x, #hex)` fallbacks; **a theme-var
VALIDITY scan (the generalizable FINDING-025 guard) asserts every `var(--x…)` name referenced in
F9's components is defined in `theme.ts`'s var map or `index.css`, and every status-token
fallback byte-matches the token's established fallback** — a dead variable name or a novel
fallback fails the scan.

### REQ-020 — Load tolerance for a malformed persisted `orky` config — on EVERY instantiation path — `quality`
Instantiating an `orky` pane whose persisted `root` is missing/non-string MUST NOT throw and MUST
NOT drop the pane: it loads with `root` coerced to `''` and renders REQ-011's unbound state
(re-bind is the recovery path) — and this coercion MUST hold on **EVERY instantiation path of the
persisted shape (FINDING-032)**: (a) workspace-file load (`deserializeWorkspace` — the
`normalizeViewState` precedent), (b) the migration chain (a migrated pre-v8 record can gain no
`orky` pane, but the seam must sit where migrated output also passes through it), AND (c)
**template instantiation** — templates persist in `quick.json`, whose loader validates templates
only as `Array.isArray(v.templates)` (`quick-store.ts:21` — no per-template shape check), and
`workspaceFromTemplate`/`remapPaneIds` clone configs opaquely (`workspace-model.ts:255-297`), so a
hand-edited template is exactly the hostile input this REQ exists for and MUST pass the same
coercion at instantiation. Downstream code never sees a non-string binding on ANY path; as belt
and braces the component SHOULD itself be total over its config (a non-string `root` renders
unbound, never a throw — e.g. `basenameOf` must not call string methods unguarded). Well-formed
sibling panes are unaffected (CONV-002). *(FINDING-032's proposed convention is recorded as
Proposed convention #5 above for doc-sync promotion.)*
**Acceptance:** a v8 workspace fixture with `{ kind:'orky', root: 42 }` and one with the field
absent both deserialize without throwing, keep the pane, and render `orky-pane-unbound`; **a
`quick.json` template containing `{ kind:'orky', root: 42 }` (and one with `root` absent)
instantiates via `workspaceFromTemplate` into a workspace whose pane renders `orky-pane-unbound`
with NO throw (the template-path vector, FINDING-032)**; a fixture mixing one malformed and one
well-formed `orky` pane keeps both, the well-formed one bound; the existing bad-shape rejection
(non-object `panes` etc.) is unchanged.

### REQ-021 — Documentation reconciled — `quality`
A feature doc MUST be added under `docs/features/` (e.g. `orky-pane.md`, covering the pane kind,
the binding model, the unbound states, the `registry:detail` contract incl. its bounds/retry/
skipped-feature semantics AND the accepted cross-file read-skew class + its notification-driven
healing (REQ-008/FINDING-033), AND the `registry:rootChanged` notification and its role as the
detail view's currency mechanism) and linked from the CLAUDE.md "Where things live" table;
`CHANGELOG.md [Unreleased]` MUST record the new pane kind AND the schema bump (v7 → v8, with the
older-build implication); and every stale claim MUST be reconciled by grepping the WHOLE `docs/`
tree plus `CLAUDE.md` and `.orky/baseline/` (CONV-008) — at minimum: any claim that the pane kinds
are exactly terminal/editor/explorer, any claim that `SCHEMA_VERSION` is 7 or "was last bumped by
0003", and `ipc-contract.ts`/baseline notes on the registry channel family (which must now name
`registry:detail` + `registry:rootChanged` and their F9 consumer).
**Acceptance:** the feature doc exists and is referenced; `CHANGELOG.md [Unreleased]` names the
pane kind and the v8 bump; a repo-wide grep finds no remaining "three pane kinds"/"SCHEMA_VERSION
is 7" claim outside historical feature artifacts; the doc-sync gate passes.

### REQ-022 — Per-root change notification: `registry:rootChanged` (D3, FINDING-003) — `performance` `quality`
Main MUST emit a lightweight per-root change notification on EVERY completed engine re-read of a
root — regardless of whether the roll-up value changed — as `CH.registryRootChanged =
'registry:rootChanged'`, an APP-GLOBAL main→renderer broadcast whose payload is the project-root
string ONLY (never a status/snapshot — the aggregate remains the single status wire shape).
Wiring (pinned, decision #7): `OrkyRegistry` gains `onRootChanged(cb): unsubscribe`, fired from
its EXISTING `engine.onStatus` subscription (`orky-registry.ts:42-45`) with `dirname(orkyDir)` —
the same case-preserved project-root spelling the snapshot/`statusByRoot` key on (`:199-204`) —
and `register-registry.ts` subscribes it to `send(CH.registryRootChanged, root)` exactly as `:61`
does for `registryStatus`, unsubscribed in the same disposer. The engine's `null`-status emit for
a vanished `orkyDir` (`orky-root-engine.ts:188`) MUST also notify — it is how a displayed pane
learns to re-fetch into REQ-011's unreadable state. NO engine change is needed or permitted: the
engine already emits every completed re-read with no delta gating (Verified contract). Preload
bridges `onRegistryRootChanged(cb)` via the existing `pushChannel` helper (`preload/index.ts:77`
pattern); `App.tsx`'s subscription block (`App.tsx:44-75`) routes it into ONE store action
(`notifyOrkyRootChanged`), whose fan-out is per-root targeted (REQ-016). The notification MUST NOT
alter `registry:status` semantics or the slice's steady-state zero-notification behavior in any
way.
**Acceptance:** with a fixture root under an engine consumer, a `findings.json` edit that leaves
the roll-up entry value-identical (e.g. editing a MEDIUM finding's claim) yields exactly one
`registry:rootChanged` send (post-debounce) carrying the project root — and, end-to-end, a
displayed bound pane re-fetches and renders the edit (the FINDING-003 staleness classes: a
roll-up-invisible findings edit AND a gate change on an idle/clean-done feature are both covered
by vectors); deleting `orkyDir` yields a notification; the payload is a bare string; the
registrar's disposer unsubscribes (no send after dispose); the existing registry-slice/
`registry:status` test suites pass unmodified; the constant lives in `CH` and the method is typed
in `TermhallaApi`.

---

## Definition of Done — verification approach

- **Pure logic (vitest, node env, no jsdom, no `process` reads in modules under test):** migration
  determinism/idempotence vectors + future-version rejection + malformed-config coercion on BOTH
  persisted instantiation paths (workspace load AND `workspaceFromTemplate` — REQ-002/REQ-020);
  `sameProjectRoot` host-independent `path.win32`/`path.posix` vectors, both fold modes (REQ-005);
  payload assembly field-by-field against the real-bytes fixture (incl. the carried `slug` and the
  duplicate-`feature`-field vector), malformed tolerance, tz-safety, the `contract_violation`
  OR-branch vectors, clock-scoped aggregate equivalence, shuffle-stability incl. the
  sorted-survivor-set and slug-tiebreak properties (REQ-007/REQ-008/REQ-014); the
  `isBlockingFinding`/`openBlockingCount` equivalence property (REQ-015); `dispatchAddPane`
  `'orky'` branch with an injected picker (REQ-004).
- **Main-process tests:** `registry:detail` handler — sender gate, member-only validation,
  engine-parity bounds/caps/symlink/missing-dir vectors, sort-before-cap, torn-write retry +
  `skippedFeatures`/`findingsUnreadable` vectors, no-watcher/no-write assertions, disposer
  (REQ-006/REQ-008/REQ-013); `registry:rootChanged` emission — per-completed-re-read (incl.
  value-identical roll-up and the null-status emit), bare-string payload, disposer unsubscription
  (REQ-022).
- **Component/store tests (jsdom or the repo's source-scan pattern, per 0006 precedent — PLUS
  component-lifecycle fetch-count tests through the REAL host transitions, REQ-010/FINDING-020):**
  state matrix (loading/unbound/unreadable/error + per-feature unreadable rendering,
  REQ-009/REQ-011), refresh-trigger spy vectors incl. notification-keyed fetching, hidden/stale
  suppression across BOTH hidden hosts (minimized AND background workspace), remount-grounded
  restore/re-bind fetch counts with a `registryDetail` call-count spy, mid-flight hidden/unbound
  follow-up conversion, coalescing + stale-settle discard (REQ-010), render-isolation probes incl.
  other-root notifications (REQ-016), header-from-detail arbitration + no-renderer-clock scan +
  the per-gate `at`/header-stall-wording display vectors (REQ-009), row identity keyed on `slug` +
  reserved actions slot + escalation ids + the duplicate-`feature` disclosure vector (REQ-012),
  verbatim-field/no-re-derive source scans scoped to renderer modules (REQ-015), picker
  loading/error/empty state vectors + the compass loading-vs-empty accessible-name vector
  (REQ-004), a11y structure scans (REQ-018), theme-variable VALIDITY scan (REQ-019),
  `clearPaneRuntime` pruning (REQ-017).
- **e2e (Playwright-for-Electron, against `out/`):** create via palette + add-pane select + split
  compass with the picker (REQ-004), bind → full-status render on a real fixture (REQ-009), a live
  fixture edit → notification → pane refresh (REQ-010/REQ-022), a background-workspace pane
  staying fetch-silent through fixture churn then refreshing once on activation (REQ-010),
  restart round-trip of the binding (REQ-005), unbound → re-bind flow (REQ-011),
  minimize/restore + undock/redock (REQ-001/REQ-017), `.orky/` byte-identical invariant (REQ-013)
  — all in the packaged renderer where `process` is undefined in the main world (REQ-005's trap
  guard).
- **Frozen-suite supersession (tests-phase deliverable):** the SIX REQ-003 amendments +
  supersession notes land with F9's suite; TEST-362/363 pass byte-unchanged; `04-tests.md` records
  the amendments (naming TEST-344, TEST-001, TEST-020, TEST-087, TEST-038, TEST-008) and the
  no-new-absence-guard note (REQ-013).

## Forward compatibility (F10 / F11)

**F10 (inline actions)** attaches answer/resume/record-gate affordances — via F7's shipped
`orkyAction:*` dispatch — directly onto this pane's rows. The contract F9 owes it: the stable
per-row identity `data-project-root` + `data-feature` (exactly F7's `(projectRoot, feature)`
request pair; `data-feature` is the UNIQUE dir slug, REQ-012/FINDING-021), `data-escalation-id` on
escalation rows (for `resolveEscalation`), and the reserved per-row actions slot
(`orky-pane-row-actions`) that accepts trailing affordances without reflowing identity or ordering
(REQ-012). F9 renders no action and depends on nothing from F7. F10 will add new interactive
surfaces and MUST then own its focus-contract tests (the F8-side FINDING-023 precedent applies to
whichever feature next touches these rows' interactivity). F10 also inherits a ready-made
post-action currency path: its writes land on disk, the engine re-reads, and REQ-022's
notification refreshes the pane — no F10-side refresh plumbing needed.
**F11 (per-project workspace template)** needs only that the pane kind + binding are
template-serializable: `templateFromWorkspace`/`workspaceFromTemplate` deep-clone `PaneConfig`
kind-agnostically (Verified contract), so an `orky` pane in a template re-instantiates bound to
the same `config.root` under a fresh pane id (REQ-001's acceptance pins it; REQ-020's
template-path coercion keeps a hand-edited template from crashing it). No further F9 surface is
required; F11 must not depend on the picker.

## Open questions

None blocking. Five upstream notes recorded for the coordinator (flagged, not fixed here):

1. **`status: null` on an aggregate entry is ambiguous** between "not yet read" and "`.orky/`
   missing/unreadable" (the engine emits `null` for both; F5 REQ-006/REQ-018). F9 disambiguates
   via the detail fetch result (`orky-missing` vs a successful read), but the aggregate alone
   cannot; if a future feature needs the distinction push-side, that is an F5 extension.
2. **The "track this project" gesture is still unowned** (carried forward from F6's Open
   questions). F9's unbound state can re-bind only to CURRENTLY tracked roots and cannot offer
   "track this root" — the renderer mutation surface remains forbidden (TEST-362) and the gesture
   remains unassigned (plausibly F13 Settings). The unbound copy is worded accordingly.
3. **A pane-source-only root is inherently unstable as a binding target:** it leaves the aggregate
   when its last contributing terminal closes, flipping any OrkyPane bound to it into the unbound
   state (by design, per D2 — the pane itself contributes no membership, REQ-005). If this proves
   noisy in practice, the durable fix is persisting the root (the unowned gesture above), not
   pane-side membership — recorded so the roadmap doesn't rediscover it.
4. **The ENGINE's `MAX_FEATURE_DIRS` cap slices raw `readdir` order** (`orky-root-engine.ts:196-203`
   — slice before any sort), so for a >200-feature tree the AGGREGATE's surviving subset is
   enumeration-order-dependent (FINDING-006). F9's detail path fixes this for itself (REQ-008
   sorts before capping) and scopes its aggregate-equivalence acceptance to ≤200-feature fixtures;
   aligning the engine (sort-before-cap) is a flagged F5 fix, deliberately NOT bundled into this
   feature's diff.
5. **The aggregate is stall-blind between fs events** (FINDING-005): `isStalled` compares an
   injected `now` against the last heartbeat (`orky-status.ts:163-176`), but the entry's status is
   only recomputed on fs-event-driven re-reads — and a stall by definition produces no fs event,
   so an entry can report `busy` indefinitely across a stall-threshold crossing. F9 sidesteps it
   pane-side (REQ-009: the detail payload's own clock wins), and F6's queue inherits the same
   blindness; a periodic-revalidation tick in the engine is a flagged F5 note.
