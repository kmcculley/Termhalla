# 0013 — OS-level needs-you notifications — Plan (Phase 3)

**Status:** plan drafted from the FROZEN `02-spec.md` (REQ-001…REQ-014, 14 REQs, revision 2026-07-02
incl. the D3 coordinator amendment). TASK-IDs below are stable — never renumber. TASK numbering
restarts at TASK-001 per feature (repo convention).

## The core shape

Two layers, deliberately separated for testability (the spec's own DoD split):

1. **Pure logic** (`src/main/orky/orky-needs-you-notifier.ts`) — the transition diff (off the shared
   `buildDecisionQueue` selector), the `(projectRoot, featureSlug, reason)` dedupe map with full
   lifecycle incl. vanished-project pruning, and the tumbling-window throttle/coalesce/digest — all
   driven by injected ambients (`now`, `shouldNotify`, `notifyOne`, `notifyDigest`). Zero Electron,
   zero real clock, zero disk I/O — directly unit-testable in the existing node-env vitest harness.
2. **Electron wiring** — composition-root construction + `onSnapshot` subscription + disposer
   registration; the production `Notification` sink + click → main-window-forward + `orkyNotify:focus`
   dispatch (0004's `register-pty.ts:85-92` pattern); the app-wide opt-in's persistence (`QuickStore`),
   live-refresh mirror (off the existing `quickSave` handler), and `GeneralSettings.tsx` checkbox; the
   renderer's `orkyNotify:focus` handler reusing F6's matcher/MRU-pick or the drawer-reveal fallback.

This mirrors 0006's pure/impure split (there: `decision-queue.ts` vs. renderer wiring) and 0007's
injected-ambients pattern (`OrkyActionDispatcher`).

## Architecture fit — reuses, does not reinvent

- `buildDecisionQueue(snapshot)` (`src/shared/decision-queue.ts:71-109`) — the SAME needs-you selector
  F6 renders from; the observer never re-derives `needsHuman`/gate/escalation logic (REQ-002).
- `orkyRegistry.onSnapshot` (`src/main/orky/orky-registry.ts:59-62`) — a SECOND independent
  subscription alongside `register-registry.ts:82`'s broadcast subscription; no new engine consumer
  (REQ-001).
- The composition root's disposer-array pattern (`src/main/ipc/register.ts:95-114`) — the notifier's
  `dispose()` is added as one more entry, mirroring `orkyActionDispatcher`'s own single-owner
  disposal at `register.ts:113`.
- 0004's `Notification` construction pattern (`register-pty.ts:85-92`: `isSupported()` guard, `new
  Notification({title, body})`, `.on('click', …)`, `.show()`) — reused verbatim for both individual
  and digest notifications; the click handler reuses the `wm.mainWindow().show()/focus()` +
  `.broadcast()`/`send` pattern already at that call site.
- The `toastsEnabled` additive-optional `QuickStore` field pattern (`quick-store.ts:27-29`,
  `types.ts:240`, `quick-slice.ts:95`, `GeneralSettings.tsx:16-17,42-43`) — `orkyNeedsYouNotifications`
  is a structural sibling, not a new pattern (REQ-005).
- F6's `DecisionQueuePanel.focusProject()` matcher/MRU-pick + `setQueueOpen`/group `data-testid`
  (`DecisionQueuePanel.tsx:79-91,133`) — reused for click-to-focus / drawer-reveal, never forked
  (REQ-006/REQ-007).

## No `.orky/`-tree write; no registry mutation; no `SCHEMA_VERSION` bump (REQ-008)

This plan touches `src/main/orky/` (new), `src/main/ipc/register.ts`, `src/main/ipc/
register-workspaces.ts`, `src/main/services.ts`, `src/shared/ipc-contract.ts`, `src/shared/types.ts`,
`src/main/persistence/quick-store.ts`, `src/preload/index.ts`, `src/renderer/store/quick-slice.ts`,
`src/renderer/store/types.ts`, `src/renderer/components/GeneralSettings.tsx`, `src/renderer/App.tsx`
(or wherever the existing `on…` push subscriptions live), `src/renderer/components/
DecisionQueuePanel.tsx` (small addition, reusing its own `focusProject`). It adds exactly ONE new IPC
channel (`orkyNotify:focus`), no `.orky/` write, no `registry:*` mutation, no CLI/`orkyAction:*` call,
no `SCHEMA_VERSION` bump.

## Target file / module layout

| Area | File(s) | New? |
|---|---|---|
| Pure observer: diff/dedupe/throttle/digest + copy formatting | `src/main/orky/orky-needs-you-notifier.ts` | new |
| New IPC channel constant | `src/shared/ipc-contract.ts` (`CH.orkyNotifyFocus`) | edit |
| `QuickStore` interface + normalize | `src/shared/types.ts`, `src/main/persistence/quick-store.ts` | edit |
| Composition root: construct/wire/dispose observer, mirror + `onQuickSave` hook | `src/main/ipc/register.ts`, `src/main/services.ts` | edit |
| `quickSave` handler live-refresh hook | `src/main/ipc/register-workspaces.ts` | edit |
| Preload subscriber for `orkyNotify:focus` | `src/preload/index.ts` | edit |
| Quick-slice setter for the opt-in | `src/renderer/store/quick-slice.ts`, `src/renderer/store/types.ts` | edit |
| Settings UI checkbox | `src/renderer/components/GeneralSettings.tsx` | edit |
| Renderer `orkyNotify:focus` handler (reuses F6 matcher / drawer reveal) | `src/renderer/App.tsx` (subscription wiring), `src/renderer/components/DecisionQueuePanel.tsx` (`focusProject`/reveal export or call site) | edit |
| Frozen-guard supersession (TEST-358) | `tests/renderer/app-queue-wiring.test.ts` | **owned by the test-designer at phase 4 — see TASK-011** |
| Docs / changelog | `docs/features/os-needs-you-notifications.md` (new), `CLAUDE.md`, `CHANGELOG.md`, wherever the IPC contract is documented, stale-phrasing grep of `docs/`/`.orky/baseline/` | new/edit |

## Determinism / injection contract

- The observer's public surface (`onSnapshot`, `flush`, `dispose`) takes NO ambient reads: `now`,
  `shouldNotify`, `notifyOne`, `notifyDigest` are 100% constructor-injected (`NeedsYouDeps`), so
  TASK-001…TASK-004 are exercisable with a stub clock/gate/sink and zero Electron.
  the tumbling-window state (`windowOpenedAt`, buffered-but-not-yet-individual transitions, the dedupe
  map) is entirely private/internal — no persistence, no `Date.now()` call inside the pure module.
- The dedupe key is always `(item.projectRoot, item.featureSlug, item.status.reason)` off
  `DecisionQueueItem` — one derivation site (TASK-002), never duplicated in TASK-003/004.
- The opt-in gate is consulted exactly at notification-construction time (`shouldNotify(projectRoot)`),
  never baked into the diff/dedupe/throttle path itself — so REQ-005's "gate reads happen only through
  the injected function" acceptance holds by construction (TASK-004's placement, not TASK-002/003's).

---

## Tasks

### TASK-001 — Transition diff (pure)
**Satisfies:** REQ-001 (partial — pure half), REQ-002, REQ-011 · **Files:**
  `src/main/orky/orky-needs-you-notifier.ts` (new)
**Depends on:** — · **Order:** 1 · **Constraints:** pure; total over malformed input (no throw); no
  `Date.now()`/randomness/array-identity dependence
- Internal `diffTransitions(previousKeys: Set<string>, snapshot: OrkyRegistrySnapshot):
  { candidates: DecisionQueueItem[]; currentKeys: Map<string, DecisionQueueItem> }` — derives the
  current needs-you key set via `buildDecisionQueue(snapshot)` (the FIRST main-side import of the
  shared selector — see TASK-011/REQ-013), keys by `(projectRoot, featureSlug, reason)`; a candidate
  is any current key NOT in `previousKeys` (newly-present transition, REQ-002).
- Malformed/non-array/`null` snapshot → `buildDecisionQueue`'s own totality yields `[]` → no
  candidates, no throw (REQ-011); no re-derivation of `needsHuman`/gate/escalation logic anywhere in
  this file (code-assertable via "imports `buildDecisionQueue`, never reimplements" review).
- No iteration-order dependence beyond the snapshot's own already-sorted (`root` codepoint) order.

### TASK-002 — Dedupe map with full lifecycle (pure)
**Satisfies:** REQ-003, REQ-011 · **Files:** `src/main/orky/orky-needs-you-notifier.ts`
**Depends on:** TASK-001 · **Order:** 2 · **Constraints:** pure; bounded (no unbounded growth); the
  SOLE key-derivation site (reused from TASK-001, not duplicated)
- Internal dedupe state: `Map<projectRoot, Set<dedupeKey>>` (root-scoped, so vanished-project pruning
  is an O(1) `delete(root)` rather than a full-map scan — CONV-011/REQ-003).
- On each `onSnapshot` call: for every root present in the NEW snapshot with `status !== null`, diff
  its OWN key set against the map's stored set for that root (steady-state no-op; reason-change clears
  the old key and adds the new one — both are "this root's key set changed" cases); for every root
  ABSENT from the new snapshot, or present with `status === null`, delete that root's entry entirely
  (vanished-project pruning, REQ-003 vector d).
- Resolved→re-notify falls out of the same mechanism: a feature leaving needs-you removes its key from
  the root's set (steady-state diff), so a LATER re-entry has no stale key blocking it.
- No second ad-hoc key derivation — reuses `(projectRoot, featureSlug, reason)` from TASK-001 verbatim.

### TASK-003 — Tumbling-window throttle/coalesce/digest (pure)
**Satisfies:** REQ-004 · **Files:** `src/main/orky/orky-needs-you-notifier.ts`
**Depends on:** TASK-002 · **Order:** 3 · **Constraints:** pure function of injected `now()` +
  transition identities; stated constants (`COALESCE_WINDOW_MS = 4000`, `DIGEST_THRESHOLD = 3`)
  exposed as overridable for tests (CONV-003)
- Internal window state: `windowOpenedAt: number | null`, `individualCountThisWindow: number`,
  `bufferedThisWindow: Set<projectRoot>` (distinct-project tracking, not per-key, per REQ-004's digest
  count rule), plus the buffered items themselves for the eventual digest call.
- For each candidate (in order) at timestamp `now()`: if no window open, OPEN one at `now()`; if
  `now() >= windowOpenedAt + COALESCE_WINDOW_MS`, CLOSE the old window (flush any pending digest — see
  below) and OPEN a fresh one at `now()`. Within the (possibly just-opened) window: if
  `individualCountThisWindow < DIGEST_THRESHOLD`, emit as an INDIVIDUAL candidate and increment the
  counter; else add its `projectRoot` to `bufferedThisWindow` (digest bucket) UNLESS that root was
  already shown individually this window (REQ-004's "never re-counted" rule).
- Window-close flush (checked lazily on the next `onSnapshot`/`flush`/`dispose` call whose `now()` has
  crossed the boundary, OR eagerly via an internal boundary check — implementer's choice, but MUST be
  exact-once): if `bufferedThisWindow.size > 0`, emit exactly one digest naming that size, then clear
  window state; if empty, emit nothing.
- `flush()` (public): if a window is open with a non-empty buffer, emit its digest immediately and
  clear window state (used by REQ-004's dispose-time flush, TASK-004).
- All decisions are pure functions of `now()` + the candidate stream — no wall-clock read anywhere in
  this file.

### TASK-004 — `OrkyNeedsYouNotifier` class: injected sinks, opt-in gate, lifecycle
**Satisfies:** REQ-001 (remaining), REQ-005 (gate consultation only — pure half), REQ-010, REQ-012 ·
  **Files:** `src/main/orky/orky-needs-you-notifier.ts`
**Depends on:** TASK-001, TASK-002, TASK-003 · **Order:** 4 · **Constraints:** `NeedsYouDeps` fully
  injected (`now`, `shouldNotify`, `notifyOne`, `notifyDigest`); idempotent post-dispose
- Public class per the spec's `Public interface`: `constructor(deps: NeedsYouDeps)`,
  `onSnapshot(snapshot)`, `flush()`, `dispose()`.
- `onSnapshot`: runs TASK-001's diff → TASK-002's dedupe filter → TASK-003's throttle, producing
  individual candidates and/or a digest call; for EACH individual candidate, consult
  `deps.shouldNotify(item.projectRoot)` before calling `deps.notifyOne(...)` (inert when it returns
  `false` — REQ-005's pure-layer half); a digest is gated by... **note:** digest is app-wide (no single
  `projectRoot`), so `shouldNotify` is consulted per-item at buffering time (an item denied by the gate
  is neither shown individually nor added to the digest count) — record this precisely in the module's
  own doc comment so TASK-011's test-designer pins the exact gate placement.
- Notification copy (REQ-010): individual = project basename (`basename(item.projectRoot)`) + reason
  phrase (`escalation`→"open escalation", `stalled`→"stalled", `human-review`→"awaiting human review",
  `null`/missing→"needs a decision") + feature slug; digest = "N projects need you" / "need a decision"
  phrasing naming the count from TASK-003. No completeness word ("done"/"complete"), no literal
  `"null"` string, no claim of action taken (CONV-009/CONV-034).
- `dispose()`: unsubscribes (the outer subscription handle is owned by TASK-005's wiring, but this
  class's OWN internal state — dedupe map, window state — is fully cleared here); calls `flush()`
  first if a digest is pending (REQ-004's dispose-time flush, REQ-012); marks itself disposed so any
  LATER `onSnapshot`/`flush` call is a no-op (no notification, no throw) — REQ-012's idempotency.

### TASK-005 — `QuickStore` opt-in field + persistence
**Satisfies:** REQ-005 (persistence half), REQ-008, REQ-013 · **Files:** `src/shared/types.ts`,
  `src/main/persistence/quick-store.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** additive-optional; NO `SCHEMA_VERSION` change; the
  `toastsEnabled` normalize pattern exactly
- `types.ts`: add `orkyNeedsYouNotifications?: boolean` to the `QuickStore` interface (alongside
  `toastsEnabled` at line 240), with a doc comment "default ENABLED — absent ⇒ !== false ⇒ on".
- `quick-store.ts`'s `normalizeQuick`: add `orkyNeedsYouNotifications: typeof
  v.orkyNeedsYouNotifications === 'boolean' ? v.orkyNeedsYouNotifications : undefined` (the exact
  `toastsEnabled` line-27-29 pattern — absent stays absent, never coerced, so the existing
  `quick-store.test.ts` round-trip fixture needs no edit — REQ-013's noted pattern-verified point).
- No `SCHEMA_VERSION` touch anywhere (`quick.json` is outside that chain — verified in spec).

### TASK-006 — New IPC channel + preload subscriber
**Satisfies:** REQ-009 · **Files:** `src/shared/ipc-contract.ts`, `src/preload/index.ts`
**Depends on:** — · **Order:** 1 · **Constraints:** unique value; NOT `registry:`-prefixed; exactly
  ONE new `CH.*` constant and ONE new preload `on…` subscriber
- `ipc-contract.ts`: add `orkyNotifyFocus: 'orkyNotify:focus'` to `CH` (payload documented as
  `string | null`).
- `preload/index.ts`: add exactly one new bridged subscriber, e.g. `onOrkyNotifyFocus: (cb: (root:
  string | null) => void) => ipcRenderer.on(CH.orkyNotifyFocus, (_e, root) => cb(root))`, mirroring the
  shape of the existing `onRegistryStatus`/`onCloudStatus` subscribers. No other new channel, no
  change to `app:notify`.

### TASK-007 — Composition root: construct, wire, dispose the observer; production `Notification`/click sink
**Satisfies:** REQ-001, REQ-006, REQ-007, REQ-008, REQ-012 · **Files:** `src/main/ipc/register.ts`
**Depends on:** TASK-004, TASK-006, TASK-009 · **Order:** 5 · **Constraints:** SECOND independent
  `onSnapshot` subscription (no new engine consumer); disposer added to the existing array; no
  `.orky/` read anywhere in this wiring
- Construct `new OrkyNeedsYouNotifier({ now: () => Date.now(), shouldNotify: <TASK-009's mirror
  reader>, notifyOne, notifyDigest })` at the composition root, alongside the existing
  `registerRegistry(orkyRegistry, …)` call (`register.ts:101`).
- `notifyOne`/`notifyDigest` (the production sinks, defined here, NOT inside the pure module):
  `Notification.isSupported()` guard → `new Notification({ title, body })` → `.on('click', () => {
  wm.mainWindow()?.show(); wm.mainWindow()?.focus(); send(wm.mainWindow(), CH.orkyNotifyFocus,
  projectRootOrNull) })` → `.show()` — the exact `register-pty.ts:85-92` pattern, `projectRootOrNull`
  = the item's `projectRoot` for an individual toast, `null` for a digest.
- Subscribe: `const unsubscribe = orkyRegistry.onSnapshot(snapshot =>
  notifier.onSnapshot(snapshot))`; add `() => { unsubscribe(); notifier.dispose() }` to the existing
  `disposers` array (`register.ts:95-114`), mirroring the `orkyActionDispatcher` single-owner
  disposal style at line 113.
- No `readFile`/`readdir`/`fs`/`.orky` reference anywhere in this addition (REQ-001/REQ-008
  scope-guard, verified at TASK-010).

### TASK-008 — `quickSave` live-refresh hook + main-side opt-in mirror
**Satisfies:** REQ-005 (wiring/live-refresh half) · **Files:** `src/main/ipc/register-workspaces.ts`,
  `src/main/services.ts` (or `register.ts`, wherever the mirror variable is most naturally owned)
**Depends on:** TASK-005 · **Order:** 2 · **Constraints:** no new IPC channel; synchronous mirror read;
  no async re-read on the notify hot path
- Composition root holds ONE mutable boolean `needsYouNotificationsMirror`, initialized from `(await
  quick.load()).orkyNeedsYouNotifications !== false` before the first `onSnapshot` subscription is
  wired (so the observer's `shouldNotify` closure is correct from app start).
- `registerWorkspaces` gains an optional dep, e.g. `onQuickSave?: (data: QuickStore) => void`, invoked
  at the END of the existing `ipcMain.handle(CH.quickSave, (_e, data) => { quick.save(data); … })`
  handler (adding the hook call, not replacing the existing `quick.save(data)` line) — the composition
  root supplies `onQuickSave: (data) => { needsYouNotificationsMirror = data.orkyNeedsYouNotifications
  !== false }`. This adds NO new channel (reuses the existing `quickSave` payload already flowing
  through `register-workspaces.ts:22`).
- The observer's injected `shouldNotify: (root) => needsYouNotificationsMirror` closes over this
  mutable variable and reads it synchronously — no `await quick.load()` on the notify path.

### TASK-009 — Quick-slice setter + `GeneralSettings.tsx` checkbox
**Satisfies:** REQ-005 (UI half) · **Files:** `src/renderer/store/quick-slice.ts`,
  `src/renderer/store/types.ts`, `src/renderer/components/GeneralSettings.tsx`
**Depends on:** TASK-005 · **Order:** 2 · **Constraints:** mirrors `setToastsEnabled` exactly incl.
  `scheduleQuickSave()` call; checkbox uses the `!== false` idiom, not a raw boolean
- `quick-slice.ts`: add `setOrkyNeedsYouNotifications: (on) => { set(s => ({ quick: { ...s.quick,
  orkyNeedsYouNotifications: on } })); scheduleQuickSave() }` (the `setToastsEnabled` line-95 pattern
  verbatim) and add it to the slice's type-union Pick list (line 10) and `State`
  (`store/types.ts:132`-adjacent).
- `GeneralSettings.tsx`: add `const orkyNeedsYouNotifications = useStore(s =>
  s.quick.orkyNeedsYouNotifications)` + `const setOrkyNeedsYouNotifications = useStore(s =>
  s.setOrkyNeedsYouNotifications)`, and a checkbox `data-testid="orky-needs-you-notifications"`,
  `checked={orkyNeedsYouNotifications !== false}` (default-on idiom, matching lines 16-17/42-43's
  `toastsEnabled` block but with the DEFAULT-ENABLED comparison), `onChange` calling the new setter.

### TASK-010 — Renderer `orkyNotify:focus` handler: click-to-focus / drawer-reveal
**Satisfies:** REQ-006, REQ-007 · **Files:** `src/renderer/App.tsx` (subscription wiring),
  `src/renderer/components/DecisionQueuePanel.tsx` (expose/reuse `focusProject`-equivalent + a
  drawer-open-and-scroll entry point)
**Depends on:** TASK-006 · **Order:** 3 · **Constraints:** reuses F6's shared matcher/MRU pick and
  `setQueueOpen`/group scroll verbatim — no forked matching logic; dispatches nothing beyond the one
  channel's already-received payload (no registry/action/CLI call)
- In the app's existing push-subscription block (alongside `onRegistryStatus`/`onCloudStatus`), add
  `onOrkyNotifyFocus(root => { if (root === null) { openQueueDrawer(); return } if
  (!focusProjectIfMatched(root)) { openQueueAndScrollTo(root) } })` — `focusProjectIfMatched` reuses
  F6's `matchPaneRootFromCandidates`/`selectPaneCandidates`/`selectMruPane`/`caseFoldFromPlatform` +
  `setActive`/`setFocusedPane`/`requestPaneFocus` (the SAME code path `DecisionQueuePanel.focusProject`
  already calls — export/factor it for reuse rather than duplicating, per REQ-006's "reuses the shared
  matcher rather than a fork" acceptance).
- `openQueueAndScrollTo(root)`: `setQueueOpen(true)` then scroll the `data-testid="decision-queue-group-
  <root>"` element into view (REQ-007) — pane-less and no-match cases share this one path.
- Digest (`root === null`): `setQueueOpen(true)` only, no scroll target (REQ-007).
- No registry/action/CLI dispatch anywhere in this handler (REQ-006 grep acceptance).

### TASK-011 — TEST-358 supersession boundary (delegated to the test-designer, phase 4)
**Satisfies:** REQ-013 · **Files:** `tests/renderer/app-queue-wiring.test.ts`
**Depends on:** — · **Order:** N/A — **explicitly NOT an implementation-phase task.**
- Exists ONLY to give REQ-013 a traceability anchor at the plan level; not implemented during the
  build phase, and no implementer should touch the frozen `TEST-358` file.
- **Owner and timing:** the test-designer, at phase 4 (`04-tests.md`), in the SAME change that
  introduces this feature's own test suite — never during implementation (spec's normative
  requirement, REQ-013).
- **Required outcome (recorded so the gatekeeper can check it lands):** `04-tests.md` records a
  supersession note naming `TEST-358`, its line-54 offenders regex, and this REQ-013; the replacement
  narrows the regex from `/decision-?queue|DecisionQueue|queueOpen/i` to `/DecisionQueuePanel|
  queueOpen/i` — still forbidding the F6 drawer component/`queueOpen` state from leaking into
  `src/main`/`src/preload`, while permitting TASK-001's legitimate `buildDecisionQueue`/
  `@shared/decision-queue` import into `src/main/orky/orky-needs-you-notifier.ts`.
- If TASK-001…TASK-010's diff lands before this retirement, the OLD `TEST-358` will fail (by design —
  it still greps for `DecisionQueue`/`decision-queue` tokens and the observer's import trips it) until
  the test-designer's phase-4 change retires it in the same commit as the new suite. Expected
  sequencing, not a plan defect.

### TASK-012 — Scope-guard verification pass (read-only, no `.orky/` write, bounded state)
**Satisfies:** REQ-008 · **Files:** (verification only — reviews TASK-001…TASK-010's diff)
**Depends on:** TASK-004, TASK-007, TASK-008, TASK-010 · **Order:** 6 · **Constraints:** structural/grep
  verification, not a new test file (phase 4's job)
- Confirm: no `child_process`/CLI/`orkyAction`/`registryAddRoot`/`registryRemoveRoot`/`.orky` write in
  the feature's new/edited files; `SCHEMA_VERSION` unchanged; no new persisted FILE (opt-in lives in
  existing `quick.json`); no observer/dedupe/throttle state persisted anywhere; no `readFile`/`readdir`/
  `fs` read of any `.orky` path in `orky-needs-you-notifier.ts` or its wiring; no whole-file
  content-freeze test proposed for any shared multi-owner file this feature touches (`ipc-contract.ts`,
  `preload/index.ts`, `register.ts`, `register-workspaces.ts`, `types.ts`, `quick-store.ts`,
  `quick-slice.ts`, `GeneralSettings.tsx` — CONV-012; pin the feature's OWN additions structurally,
  not the shared file wholesale).
- Review-only; produces no shipped file, only a pass/fail confirmation feeding the implementation gate.

### TASK-013 — Documentation reconciliation
**Satisfies:** REQ-014 · **Files:** `docs/features/os-needs-you-notifications.md` (new), `CLAUDE.md`,
  `CHANGELOG.md`, wherever the IPC contract is documented, `.orky/baseline/` (if present)
**Depends on:** TASK-001…TASK-010 (all functional tasks) · **Order:** last · **Constraints:** grep
  `docs/` + `CLAUDE.md` + `.orky/baseline/` for stale phrasing (CONV-008)
- New `docs/features/os-needs-you-notifications.md`: document the main-process observer, the
  transition-diff/dedupe/throttle/digest model (tumbling window, constants), the pane-less notification
  case, the app-wide opt-in (default enabled, live-refresh mechanics, no restart needed), click-to-focus
  / drawer-reveal, and the strictly-read-only scope guard.
- Link the doc from the CLAUDE.md "Where things live" table.
- `CHANGELOG.md [Unreleased]`: record the OS needs-you notifications and the new app-wide opt-in.
- Document `orkyNotify:focus` wherever the IPC contract/channel list is documented.
- Reconcile any doc/comment claiming "the registry aggregate has no main-side notifier" or "there is no
  app-wide notification setting" (grep the whole `docs/` tree + `.orky/baseline/`, not just one known
  line — CONV-008).

---

## Sequencing summary

```
TASK-001 (transition diff, pure)
  └─ TASK-002 (dedupe lifecycle, pure)      [needs 001]
        └─ TASK-003 (throttle/digest, pure) [needs 002]
              └─ TASK-004 (notifier class: gate + sinks + lifecycle) [needs 001,002,003]
                    └─ TASK-007 (composition root wiring + Notification/click sink) [needs 004, 006, 009]
TASK-005 (QuickStore field)                 [independent]
  ├─ TASK-008 (quickSave hook + mirror)      [needs 005]
  └─ TASK-009 (quick-slice setter + UI)      [needs 005]
TASK-006 (IPC channel + preload subscriber)  [independent]
  ├─ TASK-007 (needs 006)
  └─ TASK-010 (renderer focus handler)       [needs 006]
TASK-012 (scope-guard verification)          [needs 004, 007, 008, 010]
TASK-011 (TEST-358 supersession)             [phase 4, test-designer — not sequenced with the above]
TASK-013 (docs)                              [after all functional tasks]
```

Note: TASK-007 also depends on TASK-009's opt-in mirror being wired at the composition root
(`shouldNotify` reads `needsYouNotificationsMirror`, owned by TASK-008) — sequenced as
TASK-004 → TASK-008 → TASK-007 in practice; the diagram above groups by primary data flow.

## Complexity flags

- **REQ-005** (app-wide opt-in: persistence + live-refresh + gate + UI) spans 4 tasks (TASK-005,
  TASK-008, TASK-009, TASK-004's gate-consultation placement) — inherent to the coordinator's D3
  amendment introducing a genuinely new cross-cutting seam (persistence, main-side mirror, renderer
  setter, UI) rather than reusing an existing one; each half is independently testable (persistence
  round-trip, live-refresh via the real `quickSave` handler, renderer setter/UI) per the spec's own
  DoD split.
- **REQ-001** (main-process observer, no `.orky/` read, pane-less notify) spans TASK-001 (diff logic)
  and TASK-007 (wiring) — the pure/impure split is deliberate (Testability constraint), not
  fragmentation.
- **REQ-013** (TEST-358 supersession) is a single delegated boundary task (TASK-011), mirroring 0006's
  TASK-013 precedent for TEST-070 — kept out of the implementation sequence entirely.

## Risk notes

1. **TASK-011 is a boundary marker, not deliverable code.** Do not let an implementer "helpfully" edit
   the frozen `tests/renderer/app-queue-wiring.test.ts` during TASK-001…TASK-010 — REQ-013 is explicit
   that the narrowed-regex supersession lands atomically at phase 4, in the test-designer's own change.
2. **`shouldNotify` gate placement inside TASK-004's per-item loop (not TASK-003's throttle) is
   load-bearing.** If a future implementer moves the gate check earlier (e.g., filtering candidates
   before the throttle even sees them), the throttle's window/digest-count arithmetic changes meaning
   (a denied item would neither consume nor free a throttle slot in the alternate ordering) — TASK-004's
   description pins the gate at notification-construction time specifically to avoid this ambiguity;
   the test-designer should assert the exact placement.
3. **The `quickSave` hook (TASK-008) is additive to the existing handler, not a replacement.** The
   existing `ipcMain.handle(CH.quickSave, (_e, data) => quick.save(data))` line in
   `register-workspaces.ts:22` must keep calling `quick.save(data)`; the new `onQuickSave` hook is an
   ADDITIONAL call in the same handler body, not a swap — a careless refactor could accidentally drop
   the persistence call while adding the mirror-refresh call.
4. **TASK-010's `focusProjectIfMatched` reuse requires factoring, not copying, F6's
   `DecisionQueuePanel.focusProject` internals.** If that logic is presently a private closure inside
   `DecisionQueuePanel.tsx`, TASK-010 may need a small refactor (export the matcher call, or a shared
   helper) to avoid a REQ-006-violating fork — implementer's judgment on the minimal factoring, but a
   duplicate implementation is out of bounds.

## Open issues (under-specified REQs)

None. Every REQ-001…REQ-014 maps to ≥1 TASK (see `traceability.md` / `traceability.json`). REQ-013
maps to TASK-011, a deliberately delegated, non-implementation task boundary — not an uncovered
requirement. The spec is frozen at 14 REQs (revision 2026-07-02).
