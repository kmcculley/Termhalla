# 0013 — OS-level needs-you notifications (read)

## Phase 2 — Specification

**Status:** drafted from `00-intake.md` + the gate-passed `01-concept.md` (D1 main-process observer
over the F5 aggregate, D2 gate-based needs-you transitions per (project,feature,reason) with dedupe,
**D3 — SUPERSEDED by coordinator 2026-07-02: a single new app-wide opt-in setting** for Orky
needs-you notifications, D4 throttle+coalesce+digest, D5 click-to-focus pane or F6 drawer). The
brainstorm decisions are FIXED except D3, which the coordinator amended post-gate (delegated human
authority). This spec makes them testable and pins every upstream contract against **shipped source**
(the F9/F12 "verify before you pin" lesson). The spec's original prose flag **ESC-001** (D3's premise
— a single app-wide notification opt-in — does **not** exist in the shipped code; the opt-in is
strictly per-terminal-pane and renderer-owned, invisible to a main-process observer) has been
**RESOLVED by the coordinator amendment** (see REQ-005 and the resolved ESC-001 note). REQ-IDs are
stable; never renumber. **Spec revision 2026-07-02:** repaired against FINDING-001..004 (TEST-358
frozen-guard supersession, live opt-in refresh, digest/window model, complete `.toBe(8)` inventory).

This is the read-side completion of tier **T4**: the observer generalizes 0004's per-pane needs-you
signal to a cross-project OS notification over the F5 aggregate — including projects with **no open
pane** — and hands off to F6's decision-queue drawer on click. It is **strictly read-only** on the
`.orky/` side: it observes `registry:status`, fires `Notification`s, and adds ONE main→renderer focus
channel; it never writes `.orky/`, dispatches an action, or mutates the registry (REQ-008). It DOES
add one app-wide user preference in the app's own preferences store (`quick.json`) — the opt-in mute
(REQ-005) — which is neither an `.orky/` write nor a pipeline action.

## Concerns

`ux` `performance` `determinism` `quality`

- `ux` — notification copy is specific/actionable and honest (never a false completeness word;
  CONV-001/CONV-009 — REQ-010), the rate never feels spammy (dedupe + throttle + digest — REQ-003/
  REQ-004), click lands where the human acts (matching pane, else the F6 drawer scrolled to the
  project — REQ-006/REQ-007), and the user has a single app-wide mute, default on, that takes effect
  live without a restart (REQ-005).
- `performance` — the observer runs on EVERY aggregate push (F5 rebuilds a new snapshot array each
  re-read, so reference equality never holds — verified `OrkyRegistry.recompute()` at
  `src/main/orky/orky-registry.ts:308-313`); transition detection MUST be an O(diff) pure function
  over bounded state, and the dedupe map MUST prune keys for vanished projects (no per-session leak —
  CONV-011, REQ-003/REQ-011).
- `determinism` — transition detection is a pure diff: the same push sequence yields the same
  notifications, independent of clock/randomness (REQ-002); the throttle's individual-vs-digest
  decision and the digest count are pure functions of the injected clock timestamps and transition
  identities under a single TUMBLING window model (REQ-004); dedupe-key lifecycle is stable across
  resolved→re-notify and reason-change vectors (REQ-003).
- `quality` — reuse F6's shared `buildDecisionQueue` needs-you selector and pane matcher, and 0004's
  `Notification` construction pattern; NO forked needs-you logic (the aggregate already carries
  `needsHuman`/`reason` — REQ-002/REQ-006). `data-provenance` is **n/a**: this feature embeds no
  factual/reference data; every notified datum comes off the live aggregate.

## Resolved spec-time decisions (with rationale)

1. **Observer module + wiring seam** — a new pure-testable main class (indicative name
   `OrkyNeedsYouNotifier`, `src/main/orky/orky-needs-you-notifier.ts`) constructed at the composition
   root (`src/main/ipc/register.ts`, alongside the `registerRegistry(orkyRegistry, …)` call at
   `register.ts:101`) and subscribed to `orkyRegistry.onSnapshot` (the SAME subscription
   `register-registry.ts:82` already uses to broadcast `registry:status`). Its disposer is added to
   the existing composition-root disposer set (`register.ts` ~108-112). All ambient dependencies
   (`now`, the opt-in gate, the `Notification` sink, the focus dispatcher) are **injected** so the
   transition/dedupe/throttle logic is unit-testable with no Electron and no real clock. Names are
   suggestions; the behaviors below are the contract.
2. **Needs-you derivation is REUSED, not forked** — the observer derives its needs-you set from the
   shared, pure `buildDecisionQueue(snapshot)` (`src/shared/decision-queue.ts:71`, Electron-free /
   DOM-free / total) — the SAME selector F6 renders from — never a second membership implementation.
   Each `DecisionQueueItem` yields the dedupe identity `(projectRoot, featureSlug, reason)` off
   `item.projectRoot` / `item.featureSlug` / `item.status.reason` (REQ-002/REQ-006). This import is
   the FIRST main-side consumer of the shared selector and legitimately trips frozen TEST-358 — see
   REQ-013 for the scheduled CONV-019 supersession.
3. **New IPC is exactly ONE main→renderer focus channel, NOT under the `registry:` prefix** —
   indicative `orkyNotify:focus` (`CH.orkyNotifyFocus`), payload = the target project-root string or
   `null` (digest click → no specific project). It is deliberately **outside** the `registry:*`
   family because that family is pinned to an exact CLOSED set of seven by frozen `TEST-409`
   (`tests/main/register-registry-detail.test.ts:66-80`); a `registry:`-prefixed addition would trip
   it. `TEST-069`'s uniqueness/`arrayContaining` check (`tests/shared/registry-ipc-contract.test.ts:
   23-35`) tolerates a unique non-`registry:` value (REQ-009/REQ-013).
4. **Notifications are constructed MAIN-side directly** — the observer already runs in main (D1), so
   it uses the shipped `Notification` pattern in place (`new Notification({title, body})` +
   `n.on('click', …)` + `n.show()`, `src/main/ipc/register-pty.ts:85-92`) rather than the
   renderer→main `app:notify` IPC. No change to `register-pty.ts`; no new notify channel.
5. **Click focus target is the main window** — on click the observer brings the main window forward
   (`wm.mainWindow().show()/focus()`, the `register-pty.ts:90` pattern) and sends `orkyNotify:focus`
   to it; that renderer reuses F6's window-local pane matcher/MRU pick to focus a matching pane, else
   opens the drawer scrolled to the project. Panes living only in a **floating** window are a known
   limitation (F6 is itself window-local, 0006 Resolved #5) — recorded as an upstream note, not fixed
   here.
6. **Throttle constants + window model** — `COALESCE_WINDOW_MS = 4000`, `DIGEST_THRESHOLD = 3` (D4's
   own "3 projects need you" example), and a single **TUMBLING** window model (a window OPENS at the
   first transition emitted while no window is open, CLOSES at `windowOpenedAt + COALESCE_WINDOW_MS`;
   the next transition after close opens a FRESH window — never a rolling/sliding window) — see
   REQ-004. Stated here and asserted by tests (CONV-003). Exposed as injected/overridable constants so
   tests drive them without real timers.
7. **App-wide opt-in setting (coordinator D3 amendment, 2026-07-02)** — the opt-in gate's production
   source is a single new app-wide boolean preference `quick.orkyNeedsYouNotifications` in the
   `QuickStore` (`quick.json`), **default ENABLED**. It lives there (not in per-pane `AlertConfig`,
   not in `AppState`) because it is a cross-project signal with no per-pane home and `QuickStore` is
   the shipped home of the app's other app-wide toggles. It does NOT bump `SCHEMA_VERSION` (verified;
   see REQ-005). Because the production gate is SYNCHRONOUS but the preference is written renderer-side
   via fire-and-forget `quickSave`, its value is kept LIVE via a main-side in-memory mirror refreshed
   from the `quickSave` payload (no restart — REQ-005 Wiring + FINDING-002). The UI surface is a
   checkbox in `GeneralSettings.tsx` (the app-wide settings panel), mirroring the
   `toasts-enabled`/`copy-on-select` controls. See REQ-005.

## Verified contract (pinned upstream shapes — read from source on 2026-07-02, not memory)

Confirmed against `src/shared/types.ts`, `src/shared/orky-registry.ts`, `src/main/orky/orky-registry.ts`,
`src/shared/decision-queue.ts`, `src/renderer/components/DecisionQueuePanel.tsx`,
`src/shared/alerts.ts`, `src/renderer/store/runtime-slice.ts`, `src/renderer/components/tab-badge.ts`,
`src/renderer/components/TerminalAlertsSettings.tsx`, `src/main/ipc/register-pty.ts`,
`src/main/ipc/register-registry.ts`, `src/main/ipc/register.ts`, `src/main/window-manager.ts`,
`src/shared/ipc-contract.ts`, `src/preload/index.ts`, and (for the D3-amendment opt-in seam)
`src/shared/app-state-model.ts`, `src/main/persistence/quick-store.ts`, `src/shared/quick.ts`,
`src/renderer/components/GeneralSettings.tsx`, `src/renderer/store/quick-slice.ts`,
`src/main/ipc/register-workspaces.ts`, `src/main/services.ts`.

- **The aggregate (the sole data source).** `OrkyRegistry.onSnapshot(cb)`
  (`src/main/orky/orky-registry.ts:59-62`) fires the COMPLETE `OrkyRegistrySnapshot` on every
  membership or per-root status change; `recompute()` rebuilds a **new array object every emit**
  (`orky-registry.ts:308-313`), so reference equality never holds across pushes (performance concern).
  `register-registry.ts:82` already subscribes this to broadcast `registry:status`; the observer adds
  a SECOND independent subscription (no new engine consumer).
- **`OrkyRegistrySnapshot = OrkyRegistryEntry[]`** (`src/shared/types.ts:97`), sorted by `root` in
  **codepoint** order (`src/shared/orky-registry.ts:47`, never `localeCompare`) — equal
  membership+status always serializes identically (feeds REQ-002 determinism).
- **`OrkyRegistryEntry`** = `{ root, source, status }` (`src/shared/types.ts:89-93`): `root` = resolved
  project-root absolute path (case-preserved `resolve()` form; the dir CONTAINING `.orky/`);
  `source: 'pane'|'persisted'|'both'`; `status: OrkyPaneStatus | null` (`null` = not yet read /
  unreadable). **No pane ids on the wire.** A `source:'persisted'` root with no open pane is a full
  member — this is the pane-less notification target (REQ-007).
- **`OrkyPaneStatus`** (`src/shared/types.ts:44-49`): `needsHuman: boolean` and
  `features: OrkyFeatureStatus[]` (all non-idle features, ranked).
- **`OrkyFeatureStatus`** (`src/shared/types.ts:29-42`): `feature` (slug), `needsHuman: boolean`
  (line 36), `reason: OrkyReason` (line 38). **`OrkyReason = 'escalation' | 'stalled' | 'human-review'
  | null`** (`src/shared/types.ts:26`). These are the ONLY fields the dedupe key reads (REQ-003).
- **Needs-you selector (REUSED).** `buildDecisionQueue(snapshot)` (`src/shared/decision-queue.ts:71-
  109`) is pure, total (null/malformed → `[]`, CONV-002), Electron/DOM-free, and yields
  `DecisionQueueItem{ projectRoot, featureSlug, status }` for exactly the `needsHuman===true` features
  with well-typed consumed fields. The observer derives keys from this (Resolved #2).
- **The `Notification` API + click focus (0004 pattern).** `register-pty.ts:85-92`:
  `Notification.isSupported()` guard, `new Notification({ title, body })`, `n.on('click', () => {
  target.show(); target.focus() })`, `n.show()`. `WindowManager.mainWindow()`
  (`src/main/window-manager.ts:195`) and `.broadcast()`/`send` (`register.ts:38-45`) are the
  window-focus + push surfaces.
- **The opt-in setting — VERIFIED. D3's "reuse a single app-wide opt-in" premise is FALSE; the
  coordinator amendment adds one (REQ-005).** The ONLY notification/tab-badge opt-in in the shipped
  code is the **per-terminal-pane** `AlertConfig` (`src/shared/types.ts:165-170`: `border? tabBadge?
  osNotification? needsInput?`), defaulted by `DEFAULT_ALERTS`/`resolveAlerts` (`src/shared/alerts.ts:
  3-9`), edited per pane in `TerminalAlertsSettings.tsx:23-24`, and read PER PANE in the renderer:
  - OS notification gate: `runtime-slice.ts:29,33` (`alerts.needsInput && alerts.osNotification &&
    unfocused`) — the AI-session / terminal-needs-input toast, **not** an Orky needs-you toast (0004
    shipped NO OS notification for `orky.needsHuman`).
  - Tab-badge gate: `tab-badge.ts:27` (`resolveAlerts(cfg.alerts).tabBadge`); an Orky `needsHuman`
    pane folds into the badge under that SAME per-pane `tabBadge` opt-in (`tab-badge.ts:31`).
  There is **NO app-wide notification setting today** (grep verified: `osNotification` appears only in
  `alerts.ts`, `types.ts`, `runtime-slice.ts`, `TerminalAlertsSettings.tsx`). The main process cannot
  see the per-pane preference (renderer-owned; `OrkyRegistryEntry` carries no `AlertConfig`; a
  pane-less project has no pane config at all). **The coordinator therefore adds a single app-wide
  opt-in (REQ-005) in `QuickStore` — verified seam below.**
- **App-wide preference seam (opt-in home; D3-amendment).** Two candidate app-wide persistence seams
  were evaluated against shipped source:
  - **`AppState` / `migrateAppState` — REJECTED.** `AppState` (`src/shared/types.ts:344-347`) holds
    ONLY `{ schemaVersion, windows }`, and `migrateAppState` (`src/shared/app-state-model.ts:6-27`)
    **reconstructs** `{ schemaVersion: SCHEMA_VERSION, windows }` (lines 13, 16-24), dropping any
    extra field — so it neither stores nor tolerates an additive preference without being amended, and
    it sits inside the `SCHEMA_VERSION` migration chain (a change there risks the many frozen
    `SCHEMA_VERSION === 8` pins — see REQ-013).
  - **`QuickStore` / `quick.json` — CHOSEN.** `QuickStore` (`src/shared/types.ts:229-246`) is the
    shipped home of the app-wide toggles `recordByDefault`/`autoResumeClaude`/`copyOnSelect`/
    `toastsEnabled` (types.ts:237-240). It is **NOT part of the `SCHEMA_VERSION` chain**: `quick.json`
    has no `schemaVersion`; `QuickStore.load()` normalizes field-by-field via `normalizeQuick`
    (`src/main/persistence/quick-store.ts:14-34,41-47`). Additive-optional booleans are a proven,
    documented pattern here — `toastsEnabled: typeof v.toastsEnabled === 'boolean' ? … : undefined`
    with the comment "Additive optional (no SCHEMA_VERSION bump)" (quick-store.ts:27-29), and
    `autoResumeClaude`/`copyOnSelect` default-to-true at quick-store.ts:25-26. Main constructs the
    store (`src/main/services.ts:66`) and serves `quickLoad`/`quickSave`
    (`src/main/ipc/register-workspaces.ts:21-22`); the renderer edits it via `quick-slice.ts` setters
    (`quick-slice.ts:92-95`) surfaced in `GeneralSettings.tsx`.
  - **Sync-gate / live-refresh mechanics (FINDING-002).** `QuickStore.load()` is **async** and
    re-reads disk each call (`quick-store.ts:41-47`); `quickSave` is served fire-and-forget and does
    NO main-side broadcast today (`register-workspaces.ts:22` — `(_e, data: QuickStore) =>
    quick.save(data)`). The production `shouldNotify` gate is SYNCHRONOUS (Public interface). The
    reconciling mechanism is pinned in REQ-005 Wiring: a main-side in-memory mirror initialized from
    `await quick.load()` and refreshed synchronously from the full `QuickStore` payload already
    flowing through the existing `quickSave` handler (no new IPC, no async hot-path read).
- **F6 reuse surface (renderer, for click-to-focus).** `DecisionQueuePanel.focusProject()`
  (`DecisionQueuePanel.tsx:79-91`) already resolves a project→MRU-matching-pane focus via the shared
  `matchPaneRootFromCandidates`/`selectPaneCandidates`/`selectMruPane`/`caseFoldFromPlatform`
  (`src/shared/decision-queue.ts:161-268`) + `setActive`/`setFocusedPane`/`requestPaneFocus`; the
  drawer is toggled via `setQueueOpen` and groups carry `data-testid="decision-queue-group-<root>"`
  (`DecisionQueuePanel.tsx:133`). F13 reuses these; it adds only a "reveal this project" entry point.

## Public interface

```ts
// src/shared/ipc-contract.ts — ONE new main->renderer channel (Resolved #3; NOT registry:*)
// CH.orkyNotifyFocus = 'orkyNotify:focus'   payload: string | null  (project root, or null for a digest)

// src/shared/types.ts — QuickStore gains ONE additive-optional app-wide preference (Resolved #7 / REQ-005)
// interface QuickStore { …; orkyNeedsYouNotifications?: boolean }   // default ENABLED (absent ⇒ !== false ⇒ on)

// src/main/orky/orky-needs-you-notifier.ts (new; pure logic, injected ambients — REQ-001/REQ-012)
interface NeedsYouDeps {
  now: () => number                                   // injected clock (throttle) — REQ-004
  shouldNotify: (projectRoot: string) => boolean      // opt-in gate — REQ-005; production source = a main-side
                                                      //   in-memory MIRROR of quick.orkyNeedsYouNotifications (!== false),
                                                      //   refreshed live from the quickSave payload — no restart
  notifyOne: (n: { title: string; body: string; projectRoot: string }) => void  // individual toast
  notifyDigest: (n: { title: string; body: string; projectCount: number }) => void  // digest
}
class OrkyNeedsYouNotifier {
  onSnapshot(snapshot: OrkyRegistrySnapshot): void    // the diff+dedupe+throttle entry point
  flush(): void                                       // emit any pending coalesced digest (window close / dispose)
  dispose(): void                                     // unsubscribe + clear all dedupe/throttle state (REQ-012)
}
```

The observer emits at most `DIGEST_THRESHOLD` individual toasts plus at most ONE digest per TUMBLING
`COALESCE_WINDOW_MS` window (REQ-004). The click sink (main) brings the main window forward and sends
`CH.orkyNotifyFocus`; the receiving renderer focuses a matching pane or opens the drawer scrolled to
the project (REQ-006/REQ-007).

---

## Requirements

### REQ-001 — Main-process observer over the F5 aggregate; notifies pane-less projects (D1) — `quality` `performance`
The feature MUST be a main-process observer subscribed to `OrkyRegistry.onSnapshot` (a SECOND
subscription alongside `register-registry.ts:82`, adding no new engine consumer), constructed at the
composition root and disposed with the existing disposer set. It MUST NOT be a renderer/pane-scoped
observer, MUST perform NO additional read of any `.orky/` tree (the aggregate is the sole source),
and MUST fire notifications for member projects that have **no open pane** (`source:'persisted'`,
status carried by the aggregate) — the whole point of the feature.
**Acceptance:** the diff adds a main-side observer wired at `register.ts` and subscribed to
`orkyRegistry.onSnapshot`; a code assertion confirms no `readFile`/`readdir`/`fs` read of any
`.orky` path and no new `OrkyRootEngine` consumer in the feature's code; a snapshot whose only
needs-you entry is a `source:'persisted'` root with `status` present and no open pane fires exactly
one notification (REQ-007's fixture reused).

### REQ-002 — Deterministic transition detection: same push sequence → same notifications (D2) — `determinism`
Transition detection MUST be a pure diff between the previous and current needs-you key sets derived
from each snapshot via the shared `buildDecisionQueue` selector (Resolved #2) — never re-deriving
gates/escalations/stalls. A notification candidate is emitted only for a key that is **newly present**
(a transition INTO needs-you), never for a key already active. Detection MUST NOT depend on
`Date.now()`, randomness, iteration order, or snapshot array identity: replaying the identical
sequence of snapshots (regardless of the new-array-per-emit identity) MUST produce the identical
ordered sequence of notification candidates.
**Acceptance:** feeding a fixed snapshot sequence twice (fresh observer each time, same injected
clock) yields byte-identical candidate streams; a value-identical re-push of the current snapshot
(deep-equal, `!==`) produces zero new candidates; a code assertion confirms the observer imports
`buildDecisionQueue` and does not re-implement `needsHuman`/gate logic. (This import is the first
main-side consumer of the shared selector; see REQ-013 for the TEST-358 supersession that keeps it
green.)

### REQ-003 — Dedupe by (projectRoot, featureSlug, reason) with full lifecycle (D2/D4) — `determinism` `performance`
The observer MUST dedupe candidates by the key `(projectRoot, featureSlug, reason)` so a feature that
STAYS needs-you does NOT re-notify. It MUST honor these lifecycle vectors:
- **Steady state** — a key still present across pushes → no re-notify.
- **Reason change** (`escalation`→`stalled`, etc.) — the new `(…,reason)` key is a new transition →
  re-notify, and the old key MUST be cleared (its reason no longer holds).
- **Resolved → re-notify** — when a feature leaves the needs-you set (`needsHuman:false`, escalation
  resolved / human-review passed, or the feature disappears), ALL its dedupe keys MUST be cleared, so
  a LATER genuine re-entry notifies again.
- **Vanished-project pruning** — when a project root leaves aggregate membership (absent from the
  snapshot) OR its `status` becomes `null`, EVERY dedupe key for that root MUST be pruned (CONV-011),
  so the map can neither grow unbounded over a long session nor serve a stale value if the root later
  re-enters. Key derivation MUST use the aggregate's own `root` string (already the canonical
  resolved key, CONV-010) — no second ad-hoc key.
**Acceptance:** a fixture drives each vector: (a) two identical pushes with an active key → one
notification total; (b) a push flipping a key's `reason` → a second notification and the old key
absent from the dedupe set; (c) resolve→absent→re-enter → two notifications; (d) a root present then
absent, then re-entering needs-you → its keys are gone after the absent push (assert set membership)
and it re-notifies on re-entry; a status→`null` push prunes the root's keys.

### REQ-004 — Throttle + coalesce + digest, deterministic on the injected clock (D4) — `performance` `ux` `determinism`
Beyond per-key dedupe, the observer MUST bound notification RATE using a single **TUMBLING** window
model keyed on the injected `now()`. The window OPENS at the first needs-you transition emitted while
no window is open and stays open for exactly `COALESCE_WINDOW_MS` (=4000ms); a transition whose
`now()` is `< windowOpenedAt + COALESCE_WINDOW_MS` belongs to that window; the first transition after
the window closes opens a NEW window (never a rolling/sliding window). Within a window the observer
MUST emit at most `DIGEST_THRESHOLD` (=3) **individual** toasts (the first three transitions, in
order); every FURTHER transition in the same window MUST be buffered (NOT emitted as an individual
toast) and coalesced into exactly ONE digest notification. The digest MUST name
**N = the number of DISTINCT `projectRoot`s among the buffered (coalesced) transitions that were NOT
already surfaced as an individual toast in this window** ("N projects need you") — a project already
shown individually in the window is never re-counted in the digest. A pending digest MUST be flushed
exactly at `windowOpenedAt + COALESCE_WINDOW_MS` (window close) and on `dispose`, whichever comes
first, so a trailing burst is never silently dropped (CONV-034 outcome-honesty); if the buffer is
empty at window close, NO digest is emitted. The window and threshold are stated constants and MUST be
asserted (CONV-003); the per-window cap is `DIGEST_THRESHOLD` individual toasts + ≤1 digest. The
individual-vs-buffer decision and the digest count MUST be pure functions of the transition
timestamps and identities.
**Acceptance:** with injected timestamps, 3 transitions (3 distinct projects) inside one window → 3
individual toasts, 0 digests; 6 transitions (6 distinct projects) inside one window → 3 individual
toasts + exactly 1 digest naming **count 3** (the three projects NOT shown individually — never 6); a
buffered transition for a project already shown as an individual toast in the same window does NOT
increment the digest count; transitions spaced beyond `COALESCE_WINDOW_MS` (each opening a fresh
window) each get their own individual toast; a single trailing buffered transition is flushed as a
digest at window close (`windowOpenedAt + COALESCE_WINDOW_MS`) and, if still pending, on `dispose`
(flushed exactly once, never doubled); feeding the same timestamped sequence twice (fresh observer,
same injected clock) yields identical outputs.

### REQ-005 — App-wide opt-in mute (default ENABLED); live-refreshed; observer inert when off (D3, coordinator-amended 2026-07-02) — `ux` `quality`
The observer MUST consult an injected opt-in gate `shouldNotify(projectRoot)` before constructing ANY
notification (individual or digest) and MUST be fully inert (construct no `Notification`) when the
gate denies. The gate's **production source** MUST be a single new **app-wide** boolean preference —
the coordinator amendment to D3 (whose original "reuse the per-pane opt-in / add no new switch"
premise is false against shipped source; there is no app-wide opt-in to reuse, and a pane-less
project has no per-pane opt-in at all). The setting is pinned as follows:
- **Name / type / location:** `orkyNeedsYouNotifications?: boolean` on the `QuickStore` interface
  (`src/shared/types.ts:229-242`, added alongside `toastsEnabled` at line 240), persisted in
  `quick.json`. NOT on per-pane `AlertConfig` (a cross-project signal has no per-pane home) and NOT
  on `AppState` (see the rejected-seam analysis in Verified contract).
- **Default:** **ENABLED.** Absent ⇒ treated as on. Follow the `toastsEnabled` normalize pattern
  (`normalizeQuick`, `src/main/persistence/quick-store.ts:29`): pass through only when strictly
  boolean, else leave absent (`undefined`); the ENABLED default is expressed by the consumer/UI as
  `orkyNeedsYouNotifications !== false` (the shipped idiom for the other default-on toggles —
  `GeneralSettings.tsx:32,37`). Rationale: consistent with `DEFAULT_ALERTS.osNotification:true`
  (`src/shared/alerts.ts:4`) — the app defaults notifications on; the user gets a mute.
- **Persistence / migration mechanics — NO `SCHEMA_VERSION` bump (verified).** `quick.json` is NOT
  part of the `SCHEMA_VERSION` migration chain (no `schemaVersion` field; normalized field-by-field
  by `normalizeQuick`, quick-store.ts:14-34). The field is additive-optional with a safe default — the
  exact proven pattern of `toastsEnabled` (quick-store.ts:27-29, "Additive optional (no SCHEMA_VERSION
  bump)") and `autoResumeClaude`/`copyOnSelect`. A legacy `quick.json` without the field loads clean
  (no throw, no migration) and reads as ENABLED. `SCHEMA_VERSION` stays 8 (REQ-008/REQ-013).
- **Wiring + LIVE REFRESH (FINDING-002 pin).** Main constructs `QuickStore` (`services.ts:66`) and
  serves `quickLoad`/`quickSave` (`register-workspaces.ts:21-22`). The production `shouldNotify` is
  SYNCHRONOUS (returns `boolean`), but `QuickStore.load()` is ASYNC and re-reads disk each call
  (`quick-store.ts:41-47`), and `quickSave` is fire-and-forget with NO main-side broadcast today
  (`register-workspaces.ts:22`) — so a value cached only at startup would go stale until restart. The
  pinned mechanism (least-invasive that shipped patterns support): the composition root holds ONE
  mutable in-memory mirror boolean, initialized from `await quick.load()` at startup
  (`quick.orkyNeedsYouNotifications !== false`), and REFRESHED synchronously from the FULL `QuickStore`
  payload already flowing through the existing `quickSave` handler — that handler receives
  `data: QuickStore` (`register-workspaces.ts:22`), so a small `onQuickSave(data)` hook added there
  (a new optional dep on `registerWorkspaces`, supplied by the composition root) sets the mirror to
  `data.orkyNeedsYouNotifications !== false`. The injected `shouldNotify` closes over the mirror and
  reads it synchronously. This adds NO new IPC channel (REQ-009 — it reuses the existing `quickSave`
  payload), does NO async re-read on the hot notify path, and needs NO polling; a toggle takes effect
  on the NEXT snapshot transition after the save IPC lands — no restart. The injected seam is RETAINED
  so the observer's transition/dedupe/throttle logic stays unit-testable with a stub. The gate is
  app-wide (it ignores `projectRoot`) — a per-project mute remains deferred (D3 note).
- **Settings UI:** a checkbox in `GeneralSettings.tsx` (the app-wide settings panel,
  `data-testid="settings-general"`), consistent with the `toasts-enabled`/`copy-on-select` controls
  (indicative `data-testid="orky-needs-you-notifications"`, `checked={orkyNeedsYouNotifications !==
  false}`), wired to a new `quick-slice.ts` setter (indicative `setOrkyNeedsYouNotifications`,
  mirroring `setToastsEnabled` at `quick-slice.ts:95` and its type-union entry at `quick-slice.ts:10`).
  NOT in `TerminalAlertsSettings.tsx` (that is the per-pane surface).
**Acceptance:**
- With `shouldNotify` stubbed to `false`, a needs-you transition constructs NO `Notification` (spy
  asserts zero); with it `true`, the transition notifies; the observer reads opt-in ONLY through the
  injected gate (code assertion — no direct `alerts`/settings read baked into the diff logic).
- `QuickStore.save`/`load` round-trips `orkyNeedsYouNotifications: false` and `true`; a legacy
  `quick.json` lacking the field loads without throw and the production gate reads ENABLED
  (`!== false` ⇒ true) — mirroring `tests/main/quick-store-toasts.test.ts` TEST-006/TEST-007.
- **Live refresh (no restart):** starting ENABLED, a needs-you transition notifies; then a `quickSave`
  payload carrying `orkyNeedsYouNotifications:false` updates the main-side mirror via the `quickSave`
  hook, and the NEXT snapshot transition constructs NO `Notification` — without any restart or reload;
  flipping the payload back to `true` re-enables the following transition. Asserted at the
  composition/main-integration seam exercising the REAL `quickSave` handler + mirror + production
  `shouldNotify`, not only the injected stub.
- `SCHEMA_VERSION` is unchanged (=8) by this feature (assert), and no new persisted FILE is added
  (the field lives in the existing `quick.json`).
- `GeneralSettings.tsx` renders the opt-in checkbox and toggling it drives the `quick-slice` setter
  (renderer test), matching the shipped toggle conventions.

### REQ-006 — Click-to-focus a matching pane (D5) — `ux`
Clicking an individual notification MUST bring the app forward (main window `show()/focus()`, the
`register-pty.ts:90` pattern) and send `CH.orkyNotifyFocus` with the item's `projectRoot`; the
receiving renderer MUST focus the most-recently-focused open pane in that window matching the project,
REUSING F6's shared matcher + MRU pick (`matchPaneRootFromCandidates`/`selectPaneCandidates`/
`selectMruPane`, `DecisionQueuePanel.focusProject` semantics — `setActive`+`setFocusedPane`+
`requestPaneFocus`). The notification itself MUST take NO action on the pipeline (no answer/resume —
that is F8's job). Cross-window matching is out of scope (F6 window-local limitation — upstream note).
**Acceptance:** with a pane whose live cwd is under the project root open in the (main) window,
clicking the notification focuses that pane and activates its workspace (via the F6 reveal path);
the click dispatches only `CH.orkyNotifyFocus` and performs no registry/action/CLI call (grep
assertion); a code assertion confirms the renderer path reuses the shared matcher rather than a fork.

### REQ-007 — Pane-less project: notification IS fired; click opens the drawer (D5) — `ux`
A project with NO open pane in this app MUST still be notified on a needs-you transition (REQ-001).
Clicking its notification MUST bring the app forward and, when the receiving renderer finds no
matching pane, open the decision-queue drawer (`setQueueOpen(true)`) scrolled to that project's group
(`data-testid="decision-queue-group-<root>"`) — the read-side handoff to where the human acts. The
digest notification's click MUST bring the app forward and open the drawer (no specific project;
`orkyNotify:focus` payload `null`). No pane focus and no drawer action beyond opening/scrolling.
**Acceptance:** a `source:'persisted'` needs-you entry with no open pane fires a notification;
clicking it (renderer finds no match) opens the drawer and scrolls the target group into view
(assert `setQueueOpen(true)` + a scroll/`scrollIntoView` on the group element); a digest click opens
the drawer with no project scroll; no `.orky` write / action dispatch occurs on either path.

### REQ-008 — Strictly read-only scope guard (D1) — `quality`
The feature MUST NOT: write/create/delete any file under any `.orky/` tree; invoke any Orky CLI or
`orkyAction:*` method; call `registry:addRoot`/`registry:removeRoot` or any registry mutation surface;
add a pane kind or bump `SCHEMA_VERSION`; or persist any observer/dedupe/throttle state. Its only side
effects are constructing `Notification`s, dispatching the one `orkyNotify:focus` channel, and — as a
user preference, not observer state and not an `.orky/` write — reading/writing the app-wide
`orkyNeedsYouNotifications` opt-in in the existing `quick.json` (REQ-005). Shared multi-owner files it
touches (`ipc-contract.ts`, `preload/index.ts`, `register.ts`, `register-workspaces.ts`, `types.ts`,
`quick-store.ts`, `quick-slice.ts`, `GeneralSettings.tsx`) MUST NOT gain a whole-file content-freeze
test (CONV-012) — pin the feature's OWN additions structurally.
**Acceptance:** grep confirms no `child_process`/CLI/`orkyAction`/`registryAddRoot`/`registryRemoveRoot`/
`.orky` write in the feature's code; a fixtured `.orky/` tree is byte-identical after an observe+notify+
click session; `SCHEMA_VERSION` unchanged (=8); no new persisted FILE (the opt-in lives in the existing
`quick.json`); no observer/dedupe/throttle state is persisted; no content-freeze test added on a shared
file.

### REQ-009 — Exactly one new IPC channel, outside the `registry:*` family — `quality`
The feature MUST add exactly ONE new channel — the main→renderer `orkyNotify:focus` (payload
`string | null`) — and NO other IPC (it reuses the existing `quickLoad`/`quickSave` handlers for the
opt-in, including the live-refresh mirror hook on `quickSave` which adds NO channel; no new pull, no
new push, no change to `app:notify`). The channel name MUST NOT start with `registry:` (it is not a
registry read/write and the `registry:*` family is a frozen closed set — REQ-013). The channel value
MUST be unique across `CH`.
**Acceptance:** `CH.orkyNotifyFocus === 'orkyNotify:focus'`; `Object.values(CH)` has no duplicate;
the new value does not start with `registry:`; the preload exposes exactly one new `on…` subscriber
for it; grep confirms no other new `CH.*` constant (the opt-in and its live-refresh add no channel —
they reuse `CH.quickLoad`/`CH.quickSave`).

### REQ-010 — Notification copy: specific, actionable, and honest (CONV-001/CONV-009) — `ux`
Every notification's title/body MUST be specific and actionable: an individual toast MUST name the
project (basename of the root) and the reason (open escalation / stalled / awaiting human-review) and
the feature; a digest MUST state the count and that N projects need a decision. No notification may
render a completeness word ("done"/"complete") — needs-you items are never done, and no label
fallback may imply completion (CONV-009). A `null` reason MUST NOT be rendered as the literal
"null", and the copy MUST NOT claim an action was taken (read-only — CONV-034 honesty class).
**Acceptance:** an individual toast for an `escalation` feature contains the project basename, the
feature slug, and "escalation" wording, and no bare `"error"`/"null"/"done" text; a digest for 4
projects reads as a count summary; a snapshot with a needs-you feature whose reason is somehow absent
still produces non-"null" copy (falls back to a generic "needs a decision" phrasing).

### REQ-011 — Total tolerance over malformed snapshots; bounded state — `quality` `performance`
A malformed or partial snapshot (non-array, garbage entries, entries with `status:null` or mistyped
features) MUST NOT throw and MUST NOT crash the main process: it is passed through the shared
`buildDecisionQueue` total selector, so a garbage entry contributes no candidate while well-formed
siblings still notify (CONV-002). The dedupe/throttle state MUST stay bounded across arbitrary push
sequences (vanished-project pruning per REQ-003; no unbounded window accumulation).
**Acceptance:** feeding `null`, `[]`, a non-array, and a snapshot with one garbage entry among valid
ones throws nowhere and yields candidates only for the valid needs-you entries; after a long
open/close churn (roots entering and leaving membership), the dedupe map size is bounded by current
membership (assert no growth for departed roots).

### REQ-012 — Lifecycle: subscribe on construct, clean teardown on dispose (CONV-031) — `quality`
The observer MUST unsubscribe from `onSnapshot` and clear ALL dedupe/throttle state (pending digest
flushed per REQ-004, timers cleared) on `dispose`, and MUST be idempotent/safe if a snapshot or flush
arrives after dispose (no notification, no throw). The subscribe/observe/flush/dispose boundary MUST
be exercised through the observer's real lifecycle, not only a slice-level seam (CONV-031).
**Acceptance:** after `dispose`, a further `onSnapshot` call constructs no notification and does not
throw; a pending coalesced digest is flushed exactly once on `dispose` (not dropped, not doubled);
no timer remains armed after `dispose` (fake-timer assertion); the disposer is registered in the
composition root's disposer set.

### REQ-013 — Frozen-guard inventory: trips none knowingly, retires none silently, states the grep (CONV-019/CONV-023) — `quality`
The feature MUST NOT silently trip or retire any shipped frozen guard. Where a shipped guard's REGEX
false-trips a legitimate change, the amendment MUST be a scheduled, atomic CONV-019 supersession at
the tests phase that preserves the guard's ACTUAL intent — never an implementation-time edit.
Inventory (grep patterns used, repo-wide over `tests/**`: `Notification`, `registry:`,
`Object.values\(CH`, `SCHEMA_VERSION`, `EMPTY_QUICK`/`normalizeQuick`,
`decision-?queue|DecisionQueue|buildDecisionQueue`, absence-of-consumer / scope-guard phrasings):
- **`tests/renderer/app-queue-wiring.test.ts` TEST-358 (line 54) — F13 TRIPS it as written;
  scheduled CONV-019 supersession at F13's TESTS phase.** TEST-358 scans EVERY `src/main` +
  `src/preload` file and asserts none matches `/decision-?queue|DecisionQueue|queueOpen/i`
  (`offenders` `toEqual([])`, lines 50-55). F13's observer (REQ-001/REQ-002,
  `src/main/orky/orky-needs-you-notifier.ts`) MUST `import { buildDecisionQueue } from
  '@shared/decision-queue'` — and BOTH the symbol `buildDecisionQueue` (matches `/DecisionQueue/i`)
  AND the module path `@shared/decision-queue` (matches `/decision-?queue/i`) hit the offenders
  regex, so the scan flags the observer file. There is no way to import the required shared selector
  into `src/main` without matching. **TEST-358's ACTUAL intent (verified by reading it: header
  lines 1-8 + the body, lines 40-56):** F6 the decision-queue **drawer** added NO main/preload
  wiring — it is renderer/shared-only (D2) — so the scan protects against the F6 **drawer UI /
  `DecisionQueuePanel` component / drawer-open (`queueOpen`) state** leaking into main/preload, NOT
  against a legitimate main-side import of the pure shared selector. **Supersession scope (narrow,
  atomic, at F13's tests phase — verify against the frozen text before editing):** narrow the
  offenders regex from `/decision-?queue|DecisionQueue|queueOpen/i` to the RENDERER-only F6 drawer
  surface it was actually protecting — `/DecisionQueuePanel|queueOpen/i`. This STILL forbids the
  `DecisionQueuePanel` component and the `queueOpen`/`setQueueOpen` drawer-state wiring in any
  `src/main`/`src/preload` file (the true intent), and does NOT match `buildDecisionQueue` or the
  `@shared/decision-queue` module path — so F13's observer import passes. Add the narrowed guard
  alongside F13's structural tests; the `registryChannels` `arrayContaining` half of the same test
  (lines 47-49) is untouched. This is the ONLY main/preload directory-scan the shared-selector import
  trips: a re-grep of `tests/**` for `buildDecisionQueue`/decision-queue tokens found
  `tests/renderer/statusbar-queue-toggle.test.ts:38` (`not.toContain('buildDecisionQueue')`) and
  `tests/shared/orky-pane-same-root.test.ts:61` (reuse of `caseFoldFromPlatform`), but both scan a
  RENDERER/SHARED source file, not `src/main`/`src/preload`, so F13 does not trip them.
  *(Recommended standing convention, to be raised with the coordinator: a directory-scoped
  absence/scope-guard source scan MUST key its regex on the feature-specific surface — component /
  handler / state names — never on a shared module name or import path, so a later feature that
  legitimately imports that shared module into the scanned directory cannot false-trip the guard.)*
- `tests/main/register-registry-detail.test.ts` **TEST-409** (lines 66-80) pins the `registry:*`
  family as EXACTLY seven via a CLOSED sorted `toEqual`. F13's new channel is `orkyNotify:focus`
  (NOT `registry:`), so TEST-409 stays green — this is WHY Resolved #3 avoids the prefix.
- `tests/shared/registry-ipc-contract.test.ts` **TEST-069** (23-35) is `arrayContaining` +
  global uniqueness; a unique non-`registry:` value passes.
- `tests/shared/registry-no-renderer-ui.test.ts` **TEST-362/363** forbid only the renderer registry
  **mutation** surface. F13 is read-only on `.orky/` and main-side (adds no `RegistryMutationResult`/
  `registryRoots(`/`registryAddRoot(`/`registryRemoveRoot(` in the renderer), so it does NOT trip
  this guard and — being NOT the sanctioned "track this project" mutation consumer — does NOT retire
  it either (that guard's designated retiring feature remains the future track-project gesture).
- **`SCHEMA_VERSION` pins — NO bump; all stay green.** The opt-in (REQ-005) lives in `quick.json`,
  which is OUTSIDE the `SCHEMA_VERSION` chain (verified: no `schemaVersion` field; field-by-field
  `normalizeQuick`), so `SCHEMA_VERSION` stays 8 and every frozen `.toBe(8)` value pin remains green
  with F13 present. The COMPLETE set of `expect(SCHEMA_VERSION).toBe(8)` pins is **SEVEN** (re-grepped
  `tests/**` for `SCHEMA_VERSION`, then filtered to `.toBe(8)` value pins — FINDING-004 added TEST-001,
  previously omitted):
  - TEST-001 (`tests/shared/minimize-persistence.test.ts:30`)
  - TEST-008 (`tests/main/quick-store-toasts.test.ts:45`)
  - TEST-020 (`tests/shared/orky-status.test.ts:408`)
  - TEST-038 (`tests/main/orky-osc-structural.test.ts:180`)
  - TEST-087 (`tests/main/orky-registry-store.test.ts:110`)
  - TEST-344 (`tests/renderer/decision-queue-panel-structure.test.ts:33`)
  - TEST-375 (`tests/shared/orky-pane-migration.test.ts:41`)
  The other `tests/**` `SCHEMA_VERSION` hits — `app-state-model.test.ts`, `split-direction.test.ts`,
  `workspace-model.test.ts`, `store.test.ts`, and `orky-pane-migration.test.ts:84` — use it as a
  VARIABLE (`schemaVersion: SCHEMA_VERSION` / `.toBe(SCHEMA_VERSION)`), not a `.toBe(8)` literal value
  pin, so they are not part of this frozen-value set (and are unaffected by F13). TEST-384's residual
  sweep (`tests/shared/orky-pane-migration.test.ts:135`) is unaffected — F13 adds no new literal
  `SCHEMA_VERSION` value pin. **No new frozen-guard inventory entry is required for a bump because
  there is no bump.**
- **QuickStore round-trip test — no edit required (Pattern verified).** `tests/main/quick-store.test.ts`
  `round-trips a saved store` (lines 18-34) uses `toEqual(data)`. Because `orkyNeedsYouNotifications`
  follows the `toastsEnabled` normalize pattern (absent ⇒ `undefined`, NOT coerced-to-true like
  `autoResumeClaude`/`copyOnSelect`), a fixture that omits the field still `toEqual`s the loaded
  object (absent stays absent) — so this test does NOT need editing. New tests for the opt-in are
  additive (mirroring TEST-006/007). This normalize choice was made deliberately to avoid disturbing
  that green test while still delivering the ENABLED default via the consumer's `!== false` idiom.
- No frozen `Notification`-count or `osNotification` pin exists (grep verified — `Notification` in
  tests: none; `osNotification` in tests: only `tests/shared/alerts.test.ts`, which tests
  `resolveAlerts`/`effectiveStatus` and is untouched).
**Acceptance:** the full frozen suite is green with F13's code present AND its scheduled TEST-358
supersession applied at the tests phase (the narrowed regex still fails on a planted
`DecisionQueuePanel`/`queueOpen` reference in a `src/main` file, and passes on the observer's
`buildDecisionQueue` import); a code review confirms no OTHER frozen test file is edited by the
implementer, and TEST-358's amendment is landed atomically with F13's tests (not at implementation);
the spec's stated grep patterns reproduce this inventory including TEST-001 and TEST-358.

### REQ-014 — Documentation reconciled — `quality`
A feature doc MUST be added under `docs/features/` and linked from the CLAUDE.md "Where things live"
table; `CHANGELOG.md [Unreleased]` MUST record the OS needs-you notifications (including the new
app-wide opt-in, default on); the new `orkyNotify:focus` channel MUST appear wherever the IPC contract
is documented; and any doc claim that the registry aggregate has no main-side notifier — or that there
is no app-wide notification setting — MUST be reconciled (grep `docs/` + `CLAUDE.md` +
`.orky/baseline/` for stale phrasings, CONV-008).
**Acceptance:** the feature doc exists and is referenced; `CHANGELOG.md [Unreleased]` mentions the
notifications and the opt-in; no stale doc/comment denies a needs-you notifier or an app-wide opt-in;
the doc-sync gate passes.

---

## Definition of Done — verification approach

- **Pure logic (vitest, no Electron, injected clock/gate/sinks):** transition diff determinism
  (REQ-002), the four dedupe lifecycle vectors incl. vanished-project pruning (REQ-003),
  throttle/coalesce/digest under the TUMBLING window with injected timestamps incl. the distinct-
  project digest count and trailing flush (REQ-004), opt-in gate inertness (REQ-005), malformed-
  snapshot totality + bounded state (REQ-011), lifecycle/dispose incl. pending-digest flush (REQ-012),
  copy honesty (REQ-010).
- **Persistence (vitest, main):** `QuickStore` round-trips `orkyNeedsYouNotifications` true/false and
  a legacy file (field absent) loads clean and reads ENABLED via `!== false`; `SCHEMA_VERSION`
  unchanged (REQ-005/REQ-008/REQ-013).
- **Main integration (electron mocked):** observer wired to `onSnapshot`, main-window bring-forward
  + `orkyNotify:focus` dispatch on click, disposer registration, read-only scope grep, production
  `shouldNotify` reads the live main-side mirror, and a `quickSave(false)` payload mutes the NEXT
  transition without restart (REQ-001/005/006/007/008).
- **Renderer (jsdom):** the `orkyNotify:focus` handler focuses a matching pane via the reused F6
  matcher, else opens+scrolls the drawer; digest click opens the drawer (REQ-006/007); the
  `GeneralSettings.tsx` opt-in checkbox renders and toggling drives the `quick-slice` setter (REQ-005).
- **Contract + guards:** channel name/uniqueness/non-`registry:` (REQ-009), full frozen suite green
  incl. TEST-409/069/362-363, all seven `SCHEMA_VERSION` `.toBe(8)` pins, and the TEST-358 narrowed
  supersession landed atomically at the tests phase (REQ-013).

## Resolved escalations

**ESC-001 — RESOLVED by coordinator (delegated human authority, 2026-07-02).** The original prose
flag: D3 fixed the notifier to reuse "the existing tab-badge/notification opt-in" and forbade a new
global switch, but no app-wide opt-in exists in shipped source — the only opt-in is the per-terminal
`AlertConfig.osNotification`/`tabBadge` (`alerts.ts:3-4`, `types.ts:165-170`), renderer-owned
(`runtime-slice.ts:29,33`, `tab-badge.ts:27,31`), absent from the aggregate, and nonexistent for
pane-less projects — so D1 + D3 + "no new switch" were jointly unsatisfiable.
**Resolution:** D3 is amended (see `01-concept.md` D3 amendment note) to introduce a SINGLE new
**app-wide** opt-in `quick.orkyNeedsYouNotifications` (`QuickStore`/`quick.json`), **default ENABLED**,
no `SCHEMA_VERSION` bump, surfaced in `GeneralSettings.tsx`, wired to the observer's `shouldNotify`
gate (live-refreshed via the `quickSave` payload — REQ-005) — the injected seam remains for tests,
this setting is its production source. Pinned in REQ-005. No open questions remain blocking.

## Upstream notes (flagged, not fixed here)

1. **Roadmap wording overstates 0004.** F13's intake says "0004 already fires an OS notification when
   a pane's own Claude session needs input"; the shipped notification (`runtime-slice.ts:26-35`) fires
   for an AI-session busy→quiet flip and terminal `needs-input`, but **0004 shipped no OS notification
   for Orky `needsHuman`** — only the tab-badge fold (`tab-badge.ts:31`). F13 is the first OS
   notification for Orky needs-you. No action needed beyond this note.
2. **Cross-window click focus.** The click reveal is main-window scoped (F6 is window-local, 0006
   Resolved #5): a needs-you project whose only matching pane lives in a floating window will fall to
   the drawer-open path rather than focusing that floating pane. Exact cross-window focus would need
   an F5/F6 extension (pane ids on the aggregate, or a windowed focus broadcast) — a separate feature.
3. **Live opt-in propagation to main — PINNED (was flagged; now REQ-005 Wiring + FINDING-002).**
   `quickSave` (`register-workspaces.ts:22`) is fire-and-forget with no main-side broadcast today, so
   the production `shouldNotify` reads a main-side in-memory MIRROR refreshed synchronously from the
   full `QuickStore` payload on each `quickSave` (initialized from `quick.load()` at startup). No new
   IPC, no async hot-path read; a toggle takes effect on the next snapshot transition after the save
   lands. This is now a pinned contract element (REQ-005), no longer an open implementation detail.
