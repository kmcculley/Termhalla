# 0011 — Per-project Orky workspace template

## Phase 2 — Specification

**Status:** REVISED 2026-07-02 at the spec gate per FINDING-001 (HIGH, template-instantiated
workspaces silently lost — F11 now owns the shipped-seam repair), FINDING-002 (lifecycle-fetch
acceptance re-vehicled per CONV-033), FINDING-003 (fourth registry state added to the pre-selected
path), FINDING-004 (doctored-blueprint vector replaced by an implementable pair). Originally
drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 reuse the shipped
workspace-template mechanism + an Orky preset generator, D2 single-gesture pick-to-cockpit via the
shared OrkyRootPicker + a pre-selected-root path, D3 saveable/reusable/idempotent-friendly, D4
composition + wiring only — no new write/dispatch/IPC, D5 honor the accumulated conventions).
The five brainstorm decisions are FIXED; this spec makes them testable and resolves the concept's
non-blocking spec-time items (split orientation/ratio, template naming, no-auto-run confirmation)
inline. This is the FINAL roadmap feature (F11) before cross-feature integration: the tier's
single-gesture "work this Orky project" entry point. REQ-IDs are stable; never renumber.

Everything below composes SHIPPED machinery: Termhalla's workspace-template mechanism
(`templateFromWorkspace`/`workspaceFromTemplate`/`saveTemplate`/`newWorkspaceFromTemplate` +
`quick.json`), F9's persisted `orky` pane kind + the shared `OrkyRootPicker`, and the terminal pane
kind's cwd path. **No new pane kind, no `SCHEMA_VERSION` change (stays 8 — F9's bump), no new IPC
surface, no new write path** — plus ONE surgical repair of a shipped seam F11's story rides
(resolved decision 9: `newWorkspaceFromTemplate` gains the missing `reportAssignment` call over the
EXISTING `winReport` channel; no new channel, dispatch, or write path).

## Concerns

`ux` `quality` `determinism` `security`

- `ux` — the single-gesture flow (pick → cockpit), the shared-picker reuse with a gesture-coherent
  relabel (the 0012 TEST-486 precedent), the generated split layout, coexistence with existing
  saved templates in the templates menu, the pre-selected-root path from the decision queue.
- `quality` — pure composition: the generator instantiates through the ONE shipped template seam
  (never a hand-assembled workspace, never a forked picker/menu); the F9 files stay byte-unchanged;
  the frozen-guard inventory is grep-documented (CONV-023) and empty of collisions; the one shipped
  defect on F11's path is fixed in-scope with its consequence pinned, never masked by a green
  loader-only acceptance (FINDING-001).
- `determinism` — same tracked root → same generated workspace STRUCTURE (layout shape, pane kinds,
  configs) modulo injected ids; no clock/random/`localeCompare`/ambient-platform read anywhere in
  the generator; case-variant pre-selected inputs converge onto the aggregate member's spelling.
- `security` — the terminal pane's cwd is ALWAYS a tracked project root (the picker yields only
  members; the pre-selected path is membership-validated via the shared fold-injected equality —
  the F8 resume-launch trust posture); no launch override, no auto-typed command, no injected env,
  no new write path. `data-provenance` is n/a — this feature embeds no factual/reference data.

## Resolved spec-time decisions (with rationale)

1. **Generator module** — `src/shared/orky-cockpit.ts` (name indicative), pure and renderer-safe
   (no DOM/Electron/node builtins/ambient platform read — the `orky-pane.ts` discipline). It builds
   a `WorkspaceTemplate` value (`types.ts:201-208`) so instantiation can ride
   `workspaceFromTemplate` unchanged — the seam that already applies F9's malformed-binding
   coercion (`workspace-model.ts:300`, CONV-026).
2. **Layout** — one row split, Orky pane left, terminal right:
   `{ direction: 'row', first: <orky leaf>, second: <terminal leaf> }`, NO `splitPercentage`
   (default 50/50 — `MosaicParent`, `types.ts:308-313`). Fixed and deterministic; the user resizes
   after open like any mosaic split.
3. **Workspace/template naming** — `orkyCockpitName(root)` = `Orky: <last non-empty path segment
   of root>` (splitting on BOTH separators, pure — never `path` module / platform read); a
   degenerate root with no segment falls back to the verbatim root string; total on any string
   input (CONV-002). Deterministic: same root → same name. Names are not unique in Termhalla
   (the `Workspace N` / template-name precedents) — duplicates are allowed and renameable.
4. **Terminal config** — `{ kind: 'terminal', shellId, cwd: root }` and NOTHING else: no `launch`
   (the SSH override, `types.ts:256`), no `resumeAi`, no `runCommands`, no `envId`. `shellId` is
   supplied by the caller from the shipped `defaultShellId` chain (`pane-ops.ts:17-19`) — exactly
   the `launchDir` recipe (`quick-slice.ts:84-90`). D4's "no auto-run" is confirmed: plain shell
   at the root.
5. **Store action** — `newOrkyWorkspace(root?: string)` at store root level (beside `newWorkspace`,
   `store.ts:274-280`, where `reportAssignment` is in scope). No root → the F11-labelled shared
   picker; root given → the pre-selected path (REQ-004). One action, one optional argument — no
   primary+override pair (CONV-006).
6. **Affordances** — (a) palette action `'new-orky-workspace'` ("New Orky project workspace…"),
   appended to `buildCommandItems()` (`quick.ts:134-150`) and handled in `CommandPalette.tsx`'s
   activate switch BELOW the `activeId` guard (`CommandPalette.tsx:76-81` — the `new-workspace`
   precedent; with no active workspace it no-ops exactly like `new-workspace` does); (b) a built-in
   first row in `TemplatesMenu` (testid `tpl-orky-cockpit`, label "Orky project cockpit…") — the
   "new workspace from template" home (`WorkspaceTabs.tsx:130` → `TemplatesMenu.tsx`) — always
   rendered, never deletable; the "No templates yet." copy stays and keeps referring to SAVED
   templates; (c) the pre-selected caller: a per-project "Open project cockpit" button on the
   decision-queue group header (`decision-queue-open-cockpit`, REQ-004) — the queue is the
   cross-project "needs me" surface, and jumping from it to a full cockpit is the tier's story.
7. **Picker relabel** — both F11 gestures open the SHARED `OrkyRootPicker` through its EXISTING
   additive props (`ariaLabel?`/`heading?`/`z?` — `OrkyRootPicker.tsx:27-38`, added by 0012
   REQ-003): a coherent cockpit-specific ariaLabel + heading pair (both matching
   /cockpit|workspace/i, never the F9 `/bind/i` default — the TEST-486 coherence precedent). NO
   picker file edit: the props already exist; F11 only passes them. F11 mounts its own picker
   instance driven by a one-shot request flag (the `OrkyCaptureModal` pattern, `App.tsx:209`)
   rather than widening the F9 `pickOrkyRoot` request (`store.ts:495-506`), which is
   default-labelled and shared by three creation affordances.
8. **No template auto-persist** — the cockpit gesture creates a WORKSPACE, not a `quick.json`
   template. Saving it as a reusable template is the user's explicit `saveTemplate` gesture
   (`quick-slice.ts:17-24`), which already round-trips `orky` panes (verified pins below). This is
   D3's "the template system itself is unchanged".
9. **Template-instantiation reporting repair (FINDING-001 — F11 owns the fix).** The shipped
   `newWorkspaceFromTemplate` (`src/renderer/store/quick-slice.ts:31-38`) never calls
   `reportAssignment`. Verified consequence chain: main's authoritative `windows[].workspaceIds`
   updates ONLY via the `winReport` IPC (`window-manager.ts:304` → `onReport` `:321-327`);
   `applyAssignment` (`store.ts:186-226`) DELETES any in-memory workspace absent from a pushed
   list (drop loop `:198-203`) and clears its pane runtime; assignment pushes fire on
   `did-finish-load` (`window-manager.ts:144`), `winReady` (`:308`), main-promotion after a window
   closes (`:186`), and every move/redock (`:365-366`); the quit flush (`App.tsx:92-96`) saves
   files but never reports, and the persisted arrangement omits the workspace — so a
   template-instantiated workspace is silently LOST in-session on the next push, or across
   quit→relaunch (an orphaned workspace file no window ever loads). **This shipped gap predates F11
   and affects ALL templates**, not just cockpits; F11 is the first feature that makes template
   instantiation a persistent first-class flow, so it owns the repair. **Pinned least-invasive
   wiring (fix lands in the shared seam, repairing every template path at once):**
   `reportAssignment` is a store-root closure (`store.ts:85-89`), NOT on public `State` and NOT in
   `SliceDeps` (`src/renderer/store/types.ts:215-222`; deps object `store.ts:91`). The fix: add
   `reportAssignment: () => void` to `SliceDeps` (`types.ts:215-222`), include the existing closure
   in the deps object (`store.ts:91` — it is defined at `:85`, in scope), destructure it in
   `createQuickSlice` (`quick-slice.ts:15`) and call it at the end of `newWorkspaceFromTemplate`'s
   success path (after `scheduleAutosave()`, `quick-slice.ts:36`, before the `return ws.id` at
   `:37`). The `!tpl` fallback (`:33`) needs nothing — it routes to `newWorkspace`, which already
   reports (`store.ts:278`). F11's own `newOrkyWorkspace` lives at store root and calls
   `reportAssignment()` directly (zero wiring — the `newWorkspace` precedent). Guard compatibility
   verified: NO test references `newWorkspaceFromTemplate` (repo-wide grep, zero hits); TEST-619
   (`tests/renderer/orky-entry-actions-loopback.test.ts:149-163`) pins `commitPane` PRESENT in the
   SliceDeps region and ABSENT from the State region — an additive SliceDeps member breaks neither
   clause; `reportAssignment` stays OFF public `State` (the FINDING-008 narrow-surface discipline).

## Verified contract (pinned upstream shapes — read from shipped source, re-run 2026-07-02)

- **Template mechanism:** `WorkspaceTemplate { id, name, layout, panes, theme?, runCommands? }`
  (`src/shared/types.ts:201-208`). `templateFromWorkspace` deep-copies
  (`src/shared/workspace-model.ts:283-291`); `workspaceFromTemplate` remaps fresh pane ids via
  `remapPaneIds` (opaque `cloneConfig` deep clone, `:262-279`) and — **the CONV-026 pin F11 rides —
  passes the result through `normalizeOrkyBindings` (`workspace-model.ts:298-305`, call at `:300`)**,
  the same coercion the workspace-file loader applies (`deserializeWorkspace` → `:181`; coercion
  body `:212-223`: an `orky` pane with a missing/non-string `root` → `''`, well-formed configs
  byte-untouched). F9's coercion therefore ALREADY covers the template instantiation path this
  feature uses; F11 adds no seam and must not bypass this one. Store actions: `saveTemplate`
  (trim-gated, `scheduleQuickSave`) `src/renderer/store/quick-slice.ts:17-24`; `deleteTemplate`
  `:26-29`; `newWorkspaceFromTemplate` (instantiate → append `order` → set `activeId` →
  `scheduleAutosave`) `:31-38`. Templates persist in `quick.json`, validated only as
  `Array.isArray(v.templates)` (`src/main/persistence/quick-store.ts:21`), atomically written
  (`:53-57`). UI: `TemplatesMenu.tsx:5-35` (testids `templates-menu`, `tpl-name`, `tpl-save`,
  `tpl-<id>`, `tpl-del-<id>`), mounted by `WorkspaceTabs.tsx:130` behind `templates-button`.
- **Shipped defect ON F11's path (FINDING-001 — fixed IN SCOPE, resolved decision 9):**
  `newWorkspaceFromTemplate` (`quick-slice.ts:31-38`) never calls `reportAssignment`, while
  `newWorkspace` (`store.ts:274-280`) does (`:278`). A menu-instantiated workspace never enters
  main's authoritative `windows[]`, so the next pushed assignment (reload / `winReady` /
  main-promotion / move — `window-manager.ts:144,186,308,365-366`) deletes it via `applyAssignment`
  (`store.ts:186-226`, drop at `:198-203`), and "instantiate → work → quit" relaunches WITHOUT it
  (quit flush `App.tsx:92-96` never reports). REQ-002 (F11's gesture path) and REQ-006 (the
  saved-template reuse path) both mandate the report and pin the persistence round-trip that would
  have caught the loss. The fix lives in the shared seam, so it repairs all pre-F11 templates too.
- **OrkyPane kind (F9):** `OrkyConfig { kind: 'orky'; root: string; name?; theme? }`
  (`types.ts:286-291`), in the `PaneConfig` union (`:299`); `SCHEMA_VERSION = 8` (`types.ts:453`);
  `PaneKind` incl. `'orky'` (`src/renderer/store/pane-ops.ts:3`); `addOrky` commits
  `{ kind:'orky', root }` VERBATIM (`store.ts:487-490`); `dispatchAddPane`'s orky branch takes the
  injected picker callback (`pane-ops.ts:33-52`); the shared picker request `pickOrkyRoot` /
  `resolveOrkyRootPick` (`store.ts:495-506`) with its App-level default-labelled mount
  (`App.tsx:204-208`). Template round-trip of an `orky` pane is PINNED GREEN:
  `tests/shared/orky-pane-migration.test.ts:114-117` (fresh pane id, deep-equal config) and the
  template-path coercion is PINNED by TEST-461
  (`tests/shared/orky-pane-template-coercion.test.ts:39`: non-string `root` through
  `workspaceFromTemplate` → `''`, no throw, well-formed sibling verbatim). **No upstream gap: the
  shipped template mechanism serializes and re-instantiates an OrkyPane binding correctly.**
- **Terminal cwd byte-verbatim chain:** `TerminalConfig.cwd` (`types.ts:250-263`);
  `launchDir` precedent commits `{ kind:'terminal', shellId, cwd: dir }` (`quick-slice.ts:84-90`);
  `TerminalPane` spawns with `cwd: config.cwd` verbatim
  (`src/renderer/components/TerminalPane.tsx:63-64`); main passes it through
  (`src/main/ipc/register-pty.ts:74`) into `pty.spawn`, which uses the string verbatim whenever it
  is non-empty (`src/main/pty/pty-manager.ts:19-28`, fallback-to-home only for `''` at `:21`).
  A vanished-on-disk root reaches node-pty verbatim — the same accepted exposure `launchDir`/F8's
  resume launch carries; F11 bounds it to tracked members and adds nothing to it.
- **OrkyRootPicker (shared, reused — NOT edited):** additive default-preserving props
  `ariaLabel?`/`heading?`/`z?` (`src/renderer/components/OrkyRootPicker.tsx:27-38`); four
  mutually-distinct states off the held registry snapshot (`:79-94` — loading, ERROR shown verbatim
  `:84-88`, empty, member list `:47-50` from `registrySnapshot` only — never `registryRoots()`);
  CONV-020 focus via `useOpenFocusRestore` (`:45`); Enter target-guard (`:59`); cancel commits
  nothing. Frozen pins that keep F11 honest: TEST-487 requires both F9 default literals
  byte-present + no write-surface string entering the file
  (`tests/renderer/orky-capture-structure.test.ts:143-151`); TEST-433 bans mutation/CLI literals
  across the five F9 files (`tests/renderer/orky-pane-structure.test.ts:128-140`); TEST-432 bans
  `process` reads on the F9 renderer path and requires
  `caseFoldFromPlatform(navigator.platform)` present among the callers incl. `store.ts`
  (`orky-pane-structure.test.ts:96-106`).
- **Membership matching + registry states:** `sameProjectRoot(a, b, { caseFold })` — pure
  fold-injected EQUALITY (`src/shared/orky-pane.ts:21-23`; fold mode from `caseFoldFromPlatform`
  in `@shared/decision-queue`, per `orky-pane.ts:5-8`). Held snapshot state: `registrySnapshot` /
  `registryError` app-level (`store.ts:128-131`; semantics documented at
  `src/renderer/store/types.ts:84-91`), shared loading derivation in `use-registry-load-state.ts`
  (loading ⇔ `snapshot === null && error === null`). The read surface has FOUR states — loading,
  FAILED (`snapshot === null && error !== null`), empty, members — and the shared picker renders
  all four distinctly; REQ-004's picker-skipping path must match that honesty (FINDING-003).
- **Decision-queue wiring point:** per-root group header `decision-queue-group-<root>` with
  `data-project-root` (`src/renderer/components/DecisionQueuePanel.tsx:132-133`); the panel already
  hosts per-item action buttons (`decision-queue-open-terminal`, `:195-197`) — the F8-established
  precedent that later features compose affordances into it.
- **Palette registration points:** `PaletteAction` union (`src/shared/quick.ts:83-87`),
  `buildCommandItems()` (`:134-150`), `CommandPalette.tsx` activate switch (`:63-87`; `activeId`
  guard at `:76`; `new-workspace` handled at `:81`).
- **Workspace registration + focus:** `newWorkspace` (`store.ts:274-280`: create → append order →
  activate → `scheduleAutosave` → `reportAssignment` at `:278`); `commitPane` (`store.ts:65-80`) is
  NOT on the cockpit path (the template seam builds both panes at once) — pane focus on cockpit
  open follows the workspace-activation default, and F11 mandates no extra focus move (CONV-046:
  the open IS an explicit gesture; nothing else may steal focus).
- **Harness reality (grounds REQ-005's vehicles):** the unit harness is `environment: 'node'` with
  no jsdom (`vitest.config.ts:9`) — it cannot mount a component; e2e cannot spy the bundled `api`
  module's `registryDetail` (the closure over the contextBridge surface is unreachable from
  page-context evaluate — the 0010 FINDING-002 determination). The exactly-one-fetch count
  discipline is already frozen at the slice seam: TEST-420
  (`tests/renderer/orky-pane-slice.test.ts:67`).

## Frozen-guard inventory (CONV-023 — exact patterns + scope, re-run 2026-07-02)

Patterns grepped repo-wide over `tests/**` (unit + e2e):

1. `workspaceFromTemplate|templateFromWorkspace|normalizeOrkyBindings` →
   `tests/shared/workspace-template.test.ts` (behavioral, open-form),
   `tests/shared/orky-pane-migration.test.ts:114-117` (orky template round-trip),
   `tests/shared/orky-pane-template-coercion.test.ts` (the CONV-026 seam pin, TEST-461 at `:39`).
   **F11 relies on all three and modifies none of the pinned behavior — all stay green untouched.**
2. `buildCommandItems|PaletteAction|templates` → `tests/quick-commands.test.ts:8`
   (`expect.arrayContaining` — OPEN-FORM), TEST-329
   (`tests/shared/keybindings-toggle-queue.test.ts:58-64`, `find`-based), TEST-501
   (`tests/shared/keybindings-capture-orky-work.test.ts:64-74`, `find`-based), plus
   `templates: []` fixture shapes in quick-store suites. **Adding one `PaletteAction` member + one
   command item breaks none (no closed-form enumeration exists).**
3. `OrkyRootPicker|pickOrkyRoot|orkyRootPickOpen` → TEST-434, TEST-486/487, TEST-433, TEST-432
   (files/lines pinned above). **All stay green because F11 leaves every F9 file byte-unchanged
   (REQ-007) and forks nothing.**
4. `0011|F11` (and a manual sweep of `retire|superseded|scope guard` hits) → **no frozen guard
   names this feature; no CONV-019 absence guard awaits retirement by F11; F11 schedules NO
   supersession.** (The 0009 REQ-003 six-guard supersession is already executed — the
   `SCHEMA_VERSION` pins now read 8; F11 makes no bump, so they are untouched.)
5. `templates-button|tpl-` over `tests/e2e/**` → `workspace-templates.spec.ts:24-34` (locator
   `[data-testid^="tpl-"]` FILTERED by `hasText`), `ui-polish.spec.ts:152-167` (`tpl-name`/
   `tpl-save`/toast), `edit-menu-settings.spec.ts:119-131`. **Additive-safe: the built-in row's
   testid `tpl-orky-cockpit` collides with no existing locator (all prefix hits are text-filtered)
   and every shipped testid stays.**
6. `decision-queue` structural suite (`tests/renderer/decision-queue-panel-structure.test.ts`) —
   no closed-form count/enumeration assertions (`toHaveLength|\.length\)\.toBe|toEqual\(\[` → zero
   hits); `toContain`-style pins only. **The group-header button is additive-safe.**
7. `reportAssignment|SliceDeps|newWorkspaceFromTemplate` (the decision-9 repair surface) →
   `newWorkspaceFromTemplate`: ZERO test hits; `SliceDeps` appears only in slice-suite comments and
   TEST-619 (`tests/renderer/orky-entry-actions-loopback.test.ts:149-163`), which requires
   `commitPane` in the SliceDeps region and NOT in the State region — **the additive
   `reportAssignment` SliceDeps member (kept off public `State`) breaks neither clause.**

## Public interface

```ts
// src/shared/orky-cockpit.ts — NEW, pure, renderer-safe (no DOM/Electron/node/platform read).
// Names indicative; the behaviors/testids below are the contract.
export const ORKY_COCKPIT_TEMPLATE_ID: string   // fixed sentinel id for the ephemeral blueprint
/** Deterministic cockpit blueprint: same args -> deep-equal result. */
export function orkyCockpitTemplate(o: { root: string; shellId: string }): WorkspaceTemplate
// layout: { direction: 'row', first: <orky leaf>, second: <terminal leaf> } — no splitPercentage
// panes:  { kind: 'orky', root: o.root }  and  { kind: 'terminal', shellId: o.shellId, cwd: o.root }
//         (both root/cwd BYTE-VERBATIM; the terminal config carries NO other key)
export function orkyCockpitName(root: string): string   // 'Orky: <last path segment>' — total, pure

// src/renderer/store.ts — store-root action (beside newWorkspace).
// No arg: open the F11-labelled shared picker; cancel resolves null, creates nothing.
// With arg: skip the picker; fold-equality membership validation against the held snapshot;
// refusal (non-member / loading / failed registry) resolves null after a state-specific toast.
newOrkyWorkspace(root?: string): Promise<string | null>   // resolves the new wsId, or null

// src/shared/quick.ts
type PaletteAction = ... | 'new-orky-workspace'

// src/renderer/store/types.ts — INTERNAL wiring only (decision 9), not public State:
// SliceDeps gains reportAssignment: () => void (threaded from the store-root closure, store.ts:85-89).
```

Key testids: `tpl-orky-cockpit` (TemplatesMenu built-in row), `decision-queue-open-cockpit`
(queue group-header affordance, carries `data-project-root`), plus the UNCHANGED shared-picker
testids (`orky-root-picker*`) and F9 pane testids (`orky-pane` with `data-root`).

---

## Requirements

### REQ-001 — A pure, deterministic cockpit generator (D1) — `determinism` `quality`
`orkyCockpitTemplate({ root, shellId })` MUST return a `WorkspaceTemplate` containing EXACTLY two
panes — an Orky pane `{ kind: 'orky', root }` with `root` byte-verbatim, and a terminal pane
`{ kind: 'terminal', shellId, cwd: root }` with `cwd` byte-verbatim and NO other config key (no
`launch`, `resumeAi`, `runCommands`, `envId`, `name`, `alerts`) — in the layout
`{ direction: 'row', first: <orky leaf>, second: <terminal leaf> }` with no `splitPercentage`, and
`name = orkyCockpitName(root)`. The module MUST be a pure function of its arguments: no clock, no
randomness, no `localeCompare`, no `process`/`navigator` read, no id generation (ids are the
template-instantiation seam's job). `orkyCockpitName` MUST be total (CONV-002): any string input
yields a string, a segmentless root falls back to the verbatim root.
**Acceptance:** two calls with identical args return deep-equal values; vectors cover a mixed-case
Windows root, a POSIX root, a UNC root, and a trailing-separator root — in each, BOTH the orky
`root` and the terminal `cwd` are byte-equal to the input; the layout is a row parent whose `first`
leaf maps to the orky pane and `second` to the terminal; `Object.keys` of the terminal config is
exactly `['kind','shellId','cwd']` (order-insensitive); a source grep of the module finds no
`Date.now|Math.random|localeCompare|process[.[]|navigator` hit; `orkyCockpitName('C:\\dev\\Proj\\')
=== 'Orky: Proj'`, `orkyCockpitName('/a/b') === 'Orky: b'`, and a separator-only input does not
throw.

### REQ-002 — Instantiation rides the shipped template seam; the new workspace is REPORTED and survives assignment pushes (D1, CONV-026, FINDING-001) — `quality` `determinism`
Opening a cockpit MUST instantiate the generator's blueprint through `workspaceFromTemplate`
(`workspace-model.ts:298-305`) — the ONE seam that remaps fresh pane ids AND applies F9's
`normalizeOrkyBindings` coercion (`:300`) — and MUST NOT hand-assemble the workspace
(`createWorkspace`/`addFirstPane`/`splitPane`) or clone/normalize pane configs with its own logic.
Registration MUST match `newWorkspace` (`store.ts:274-280`) IN FULL: the new workspace is appended
to `order`, becomes `activeId`, is autosaved (`scheduleAutosave`), **and the window arrangement is
reported into main's authoritative `windows[]` on the success path (`reportAssignment`,
`store.ts:85-89` — directly in scope at store root, where `newOrkyWorkspace` lives)**. Without the
report, the workspace is DELETED by the next pushed assignment (`applyAssignment`,
`store.ts:186-226`, drop at `:198-203`; push sites `window-manager.ts:144,186,308,365-366`) and
lost on quit→relaunch — the FINDING-001 loss class; the report is load-bearing, not cosmetic.
`workspace-model.ts` and `src/shared/types.ts` MUST NOT be modified; `SCHEMA_VERSION` stays 8.
(The renderer-store wiring file `src/renderer/store/types.ts` changes ONLY per decision 9.)
**Acceptance:** structural — the action's call path contains `workspaceFromTemplate` and no
`addFirstPane`/`splitPane`/`createWorkspace` call, and `reportAssignment` is invoked on the success
path (never on refusal/cancel paths); coercion — the instantiation path is proven coerced by the
PAIR (FINDING-004): the structural pin above (the only instantiation call is the coerced seam —
no hand-assembly, no local clone/normalize) PLUS frozen TEST-461
(`tests/shared/orky-pane-template-coercion.test.ts:39`) required byte-unchanged (the seam itself:
non-string `root` → `''`, no throw); registration — after a cockpit open, `order` ends with the new
wsId, `activeId` equals it, and an autosave was scheduled; two cockpit opens produce disjoint pane
id sets; **persistence round-trip (the vector that would have caught FINDING-001):** store-level —
after `newOrkyWorkspace` succeeds, the stubbed `api.winReport` was called with `workspaceIds`
INCLUDING the new wsId, and driving `applyAssignment` with that reported arrangement (main's echo)
RETAINS the workspace (present in `workspaces`, `order` unchanged); e2e — open a cockpit, reload
the window (the `did-finish-load` re-push, `window-manager.ts:144`), and the cockpit workspace tab
SURVIVES with both panes; `git diff` shows `workspace-model.ts`/`src/shared/types.ts` untouched and
`SCHEMA_VERSION = 8` byte-unchanged.

### REQ-003 — Single-gesture picker flow: palette + templates-menu entries, shared picker relabelled (D2) — `ux` `quality`
The cockpit MUST be openable from (a) a command-palette action `'new-orky-workspace'` ("New Orky
project workspace…", search terms covering orky/project/workspace/cockpit) appended to
`buildCommandItems()` and handled in `CommandPalette.tsx`'s activate switch below the `activeId`
guard (the `new-workspace` precedent — no active workspace ⇒ the same silent no-op
`new-workspace` has), and (b) a built-in, non-deletable first row in `TemplatesMenu`
(`tpl-orky-cockpit`, "Orky project cockpit…"), rendered in every templates state (the
"No templates yet." saved-templates copy is unchanged and may co-render). Both gestures MUST open
the SHARED `OrkyRootPicker` — imported component identity, never a fork, mounted by F11 via its own
one-shot request (the `OrkyCaptureModal` pattern) — passing a coherent cockpit-specific
`ariaLabel` + `heading` pair through the EXISTING additive props (both matching
/cockpit|workspace/i, neither matching /bind/i; the F9 defaults and 0012's capture relabel stay
untouched). Selecting a member root MUST open that root's cockpit with NO further prompt (one
gesture: pick → cockpit). Cancel/Escape/backdrop in ANY picker state MUST create nothing: no
workspace, no panes, no template, `quick.templates` unchanged. The picker's four boundary states,
keyboard operation, CONV-020 focus contract, and CONV-007 focus-visible styling are INHERITED from
the shared component — F11 adds no state fork. The TemplatesMenu row and palette entry are
keyboard-activatable and follow CONV-041/CONV-030 (their activation never co-fires a container
gesture; the menu closes on pick exactly as the shipped template rows do).
**Acceptance:** palette-filtering "orky" surfaces the entry; activating it opens
`orky-root-picker` whose rendered heading and `aria-label` BOTH differ from the F9 defaults and
match /cockpit|workspace/i; the same holds via `tpl-orky-cockpit`; from a held 2-member snapshot,
selecting a root yields an ACTIVE workspace containing exactly two tiles — an `orky-pane` with
`data-root` byte-equal to the member root and a terminal; Escape/cancel from each of the four
picker states leaves the workspace count, every existing workspace, and `quick.templates`
deep-equal; keyboard-only end-to-end succeeds through BOTH affordances; the shipped e2e template
suites (`workspace-templates.spec.ts`, the ui-polish template toast) pass unchanged; grep confirms
`OrkyRootPicker.tsx` is byte-unchanged (component reuse, not fork).

### REQ-004 — The pre-selected-root path: picker skipped, membership-validated, four registry states honored, queue-wired (D2, FINDING-003) — `security` `ux` `determinism`
`newOrkyWorkspace(root)` with an argument MUST NOT open the picker. It MUST validate `root` against
the HELD registry snapshot's member roots via `sameProjectRoot` fold-injected EQUALITY (fold mode
derived once via `caseFoldFromPlatform(navigator.platform)` at the composition layer; no `process`
read on the renderer path — the TEST-432 discipline). On a match, the cockpit MUST be built from
the AGGREGATE MEMBER's spelling (not the caller's variant), so the orky binding and terminal cwd
are byte-equal to the tracked spelling and case/slash-variant callers converge deterministically.
The action MUST distinguish ALL FOUR registry states the shared picker already renders
(`OrkyRootPicker.tsx:79-94`) — its refusals are total over them:
1. **Members held, no match** — create nothing (no workspace, no pane, no template) and surface a
   specific, actionable toast naming the offending root and how roots become tracked (CONV-001).
2. **Loading** (`registrySnapshot === null && registryError === null`) — refuse with loading-honest
   copy (the F9 loading-vs-empty discipline — a loading system is never described as not-tracked).
3. **FAILED registry** (`registrySnapshot === null && registryError !== null`) — refuse, create
   nothing, resolve null, with copy that NAMES the registry failure and surfaces the held
   `registryError` verbatim (CONV-001) — NEVER the not-tracked copy (membership is UNKNOWN because
   the registry failed to load, not absent) and never the loading copy.
4. **Held empty snapshot** — the no-match branch (1) applies (its copy already says how roots
   become tracked).
All three refusal copies (not-tracked / loading / failed) MUST be pairwise distinct. ONE shipped
caller is wired: the decision-queue group header gains an "Open project cockpit" button
(`decision-queue-open-cockpit`, `data-project-root`, an accessible name) calling
`newOrkyWorkspace(g.projectRoot)`; its activation MUST be target-guarded / propagation-stopped so
no container gesture co-fires and Enter on the focused button activates only it
(CONV-030/CONV-041), with visible focus styling (CONV-007).
**Acceptance:** with a held member `C:\dev\Proj` and `caseFold: true`, calling with `c:/dev/proj/`
opens a cockpit whose orky `data-root` and terminal `cwd` are byte-equal to `C:\dev\Proj`; with
`caseFold: false` the case-variant is refused; equality-not-prefix vectors (`C:\dev\Proj` vs
`C:\dev\ProjX` and vs `C:\dev\Proj\sub`) are refused; a non-member call mutates NOTHING (workspace
map, order, templates deep-equal) and resolves null after a toast naming the root; with
`registrySnapshot === null && registryError === 'boom'`, the call creates nothing, resolves null,
and its toast CONTAINS the held error text and does NOT match the not-tracked copy (a tracked-on
-disk root refused in this state is never told it "is not tracked"); the three refusal copies
(not-tracked, loading, failed) are asserted pairwise distinct; clicking
`decision-queue-open-cockpit` opens the cockpit with NO picker and fires no queue-item/container
handler; keyboard activation of the button works and its `:focus-visible` styling is covered by
the allow-list assertion.

### REQ-005 — The opened cockpit is a plain composition of the shipped pane contracts: terminal at root, no auto-run; no new fetch trigger (D4, FINDING-002) — `security` `determinism` `quality`
The cockpit's terminal MUST reach its PTY with `cwd` equal to the project root byte-verbatim
through the EXISTING chain (`config.cwd` → `api.ptySpawn` → `pty.spawn` — pinned above), using the
user's default shell (`defaultShellId` chain), with NO `launch` override, NO auto-typed input after
spawn, and NO injected env. The cockpit's OrkyPane MUST behave exactly per F9's shipped fetch
discipline — one detail fetch per bind — and the cockpit path MUST add NO new fetch trigger.
**Vehicle honesty (CONV-033):** the node-env unit harness cannot mount a component
(`vitest.config.ts:9`) and e2e cannot spy the bundled `api.registryDetail` closure (the 0010
FINDING-002 determination), so the discipline is pinned as the CONV-033-sanctioned split — the
count at the seam where it is real, a structural pin on the property that makes an extra-fetch
class impossible, and the rendered half at e2e — never a "real-lifecycle fetch spy" no harness can
run. Opening the cockpit moves activation to the new workspace as the shipped registration path
does; NOTHING else may move keyboard focus (CONV-046 — the open is the explicit gesture; no
additional focus-on-mount surface is introduced).
**Acceptance:** e2e — a cockpit opened for a real fixture root shows a terminal whose reported cwd
equals the root (the status-bar/cwd chain) and whose transcript contains no auto-typed command
after the prompt; e2e rendered half — the cockpit's `orky-pane` RENDERS its detail for the fixture
root (the mount → bound → displayed lifecycle observed through its rendered output, not a spy);
count half — frozen TEST-420 (`tests/renderer/orky-pane-slice.test.ts:67`, exactly one request per
bind at the slice seam) is cited and required byte-unchanged; structural half — anchored scans
(CONV-032) of the F11-new module and the `newOrkyWorkspace` action body find NO
`fetchOrkyDetail`/`registryDetail`/`notifyOrkyRootChanged` reference, and the F11 diff adds no new
call site of any of the three anywhere (the property that makes an extra-fetch class impossible);
structural — the generator output and the cockpit call path contain no `launch`, `resumeAi`,
`encodeBroadcast`, or PTY-write call; any NEW zero/count assertion F11 adds is scoped per CONV-051
(filtered to the action under test, never raw stub emptiness); any narrow-layout assertion over the
cockpit's tiles asserts clipping against the TILE's own bounding box, never `window.innerWidth`
(CONV-047).

### REQ-006 — Saveable, reusable, DURABLE; the shared template-instantiation seam is repaired; the cockpit flow never writes templates (D3, FINDING-001) — `ux` `quality` `determinism`
The generated cockpit MUST be a real workspace: saving it via the shipped `saveTemplate` produces a
`quick.json` template that — re-instantiated through the shipped TemplatesMenu path — reproduces a
cockpit with the SAME structure (orky `root` and terminal `cwd` byte-preserved, fresh ids; already
guaranteed by the pinned deep-copy + coercion seams, exercised here end-to-end) **and that
re-instantiated workspace MUST be DURABLE: it survives the next pushed assignment and a
quit→relaunch.** The shipped menu path (`newWorkspaceFromTemplate`, `quick-slice.ts:31-38`) never
reports the new workspace into main's `windows[]`, so today it is silently DELETED by the next
push and lost on relaunch (FINDING-001 — the consequence chain is pinned in the Verified contract).
F11 MUST repair the shared seam per resolved decision 9: `SliceDeps` gains `reportAssignment`
(`src/renderer/store/types.ts:215-222`; deps object `store.ts:91`; call after `scheduleAutosave()`
on the success path, `quick-slice.ts:36`) — fixing the loss for ALL templates, pre-F11 saved ones
included, over the EXISTING `winReport` channel (no new IPC/write path; the `!tpl` fallback at
`:33` already reports via `newWorkspace`, `store.ts:278`). Re-invoking the cockpit gesture for the
same root MUST open a FRESH workspace (new workspace id, new pane ids) and MUST NOT rebind, mutate,
or close any existing cockpit or pane ("idempotent-friendly": fresh cockpit, never a duplicate-bind
of an existing one). The cockpit flow itself MUST NOT write `quick.templates` or schedule a
quick-save — templates change only through the user's explicit save/delete gestures (no silent
persistence, CONV-003's no-silent-effects spirit).
**Acceptance:** open cockpit for root R → `saveTemplate('X')` → instantiate `X` from the menu →
two workspaces each holding an orky pane (root R) + terminal (cwd R) with disjoint pane ids;
**durability round-trip through the previously-gapped boundary (the vector that would have caught
the loss):** store-level — after the MENU instantiation, the stubbed `api.winReport` was called
with `workspaceIds` including the new wsId, and driving `applyAssignment` with that reported
arrangement retains BOTH workspaces; e2e — after menu re-instantiation, reload the window (the
`did-finish-load` re-push, `window-manager.ts:144`): the re-instantiated workspace SURVIVES (a
loader-only "the file reloads when asked" check is NOT sufficient and is not this criterion — the
arrangement half is the durability claim); invoking the cockpit gesture twice for R yields two
distinct workspace ids and the first workspace is deep-equal before/after the second open;
`quick.templates` is deep-equal across any number of cockpit opens/cancels; structural — the
F11-NEW flow code (the generator module, the `newOrkyWorkspace` action body, the F11 UI wiring)
contains no `scheduleQuickSave` call, and the `quick-slice.ts` diff touches ONLY
`newWorkspaceFromTemplate` (the destructure + the one `reportAssignment()` call — no quick-save
added anywhere); restart round-trip: a saved v8 workspace file holding the cockpit reloads both
panes with bindings intact (the shipped loader path, exercised not re-pinned — the structure half,
complementing the arrangement half above).

### REQ-007 — Composition-only scope guard: no new kind, schema, IPC, or write path; one sanctioned seam repair (D4) — `quality` `security`
The feature's diff MUST add NO `PaneKind`/`PaneConfig` member, NO `SCHEMA_VERSION` change (stays
8), NO `CH.*` channel / preload method / `ipcMain` registration, and NO write surface: no F11 file
may reference `orkyAction`, `registryAddRoot`, `registryRemoveRoot`, `registryRoots(`,
`RegistryMutationResult`, `child_process`, `execFile`, `orkyWatch`, or `orkyUnwatch` (the TEST-433
ban list applied to F11's own file set). The ONLY shipped-behavior change permitted beyond pure
composition is the decision-9 reporting repair (REQ-006): `SliceDeps.reportAssignment` +
`newWorkspaceFromTemplate`'s success-path call — over the EXISTING `winReport` channel, with
`reportAssignment` kept OFF the public `State` surface (the FINDING-008/TEST-619 discipline). The
five F9 files (`src/shared/orky-pane.ts`, `OrkyPane.tsx`, `OrkyRootPicker.tsx`,
`orky-pane-slice.ts`, `src/main/orky/orky-root-detail.ts`) MUST remain byte-unchanged. Any
absence/scope-guard test F11 freezes MUST key on F11-specific surfaces (`orkyCockpitTemplate`,
`newOrkyWorkspace`, `new-orky-workspace`, `tpl-orky-cockpit`, `decision-queue-open-cockpit`) per
CONV-037, and — F11 being the final roadmap feature — MUST NOT assert the absence of an unnamed
future consumer (CONV-019: no unretirable guard is created; the inventory above confirms none
awaits F11 either).
**Acceptance:** greps over the diff/src — `src/shared/ipc-contract.ts` and `src/preload/**`
untouched; `SCHEMA_VERSION = 8` and `pane-ops.ts:3`'s `PaneKind` literal byte-unchanged; the
banned-string sweep over the F11 file set (now including `quick-slice.ts` and
`src/renderer/store/types.ts`) finds zero hits; the `State` interface region of
`src/renderer/store/types.ts` contains no `reportAssignment` (it lives only in `SliceDeps` — and
frozen TEST-619 stays green); `git diff --name-only` excludes all five F9 files; every new frozen
guard's regex contains an F11-specific symbol; the FULL existing frozen suite runs green at the
implementation gate (the inventory's no-collision claim, executed).

## Open questions

None blocking. (The concept's spec-time items — split orientation/ratio, naming, no-auto-run —
are resolved in "Resolved spec-time decisions" 2/3/4; FINDING-001..004 are repaired above, with
the decision-9 wiring pinned to shipped file:line.)
