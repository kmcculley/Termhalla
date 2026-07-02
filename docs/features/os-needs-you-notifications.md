# OS-level needs-you notifications (feature 0013)

Termhalla raises an operating-system notification whenever an Orky-adopted project transitions **into
needs-you** — an open escalation, a stalled run, or a phase awaiting human review — so you learn a
project is waiting on a decision even when its terminal is not in front of you, and even when it has
**no open pane** in the app at all.

This is the read-side completion of the cross-project registry tier. It is strictly **read-only** on
the `.orky/` side: it observes the aggregate, constructs `Notification`s, dispatches one focus channel,
and reads/writes a single app-wide preference. It never writes an `.orky/` tree, never invokes an Orky
CLI or action, and never mutates the registry.

## The observer

The heart of the feature is a main-process **observer**, `OrkyNeedsYouNotifier`
(`src/main/orky/orky-needs-you-notifier.ts`). It is a SECOND, independent subscriber to the same
cross-project aggregate the registry broadcast already rides (`OrkyRegistry.onSnapshot`) — it adds no
new engine consumer. On every aggregate push it:

1. **Derives the needs-you set** from the shared, pure `buildDecisionQueue` selector — the SAME
   membership the decision-queue drawer renders from. It never re-implements the `needsHuman`/gate
   logic; the observer is the first main-side consumer of that shared selector.
2. **Diffs transitions.** A notification candidate is emitted only for a key that is *newly present* —
   a transition INTO needs-you — never for one already active. Detection is a pure diff and does not
   depend on the wall clock, randomness, iteration order, or snapshot array identity: replaying the
   same snapshot sequence yields the same notifications.
3. **Dedupes** by `(projectRoot, featureSlug, reason)`. A feature that stays needs-you does not
   re-notify; a reason change (e.g. escalation → stalled) is a fresh transition and clears the old
   key; a resolved feature clears its keys so a later genuine re-entry notifies again. Keys for a
   **vanished project** (absent from the snapshot, or with a `null` status) are pruned, so the dedupe
   state stays bounded across a long session.

All ambient dependencies — the clock, the opt-in gate, and the two notification sinks — are injected,
so the diff/dedupe/throttle logic is pure and unit-testable with no Electron and no real clock.
Malformed or partial snapshots never throw (they pass through the total shared selector).

## Throttle, coalesce, digest

To keep the rate from feeling spammy the observer bounds output with a single **tumbling window**
(`COALESCE_WINDOW_MS = 4000`). A window opens at the first transition emitted while no window is open
and closes exactly 4 s later; the first transition after close opens a fresh window (never a
rolling/sliding window). Within a window at most `DIGEST_THRESHOLD = 3` **individual** toasts fire (the
first three transitions, in order); every further transition is buffered and **coalesced** into at
most ONE **digest** — "N projects need you", where N is the number of distinct projects buffered that
were not already shown individually this window. A pending digest is flushed at window close, on the
observer's `flush()`, or on `dispose` — whichever comes first — so a trailing burst is never dropped.
Window close is **timer-armed**, not merely lazy: opening a window schedules a real flush at
`windowOpenedAt + COALESCE_WINDOW_MS` via an injected `setTimer`/`clearTimer` pair (production wiring
in `register.ts` supplies real `setTimeout`/`clearTimeout`; tests inject a fake clock), so a buffered
digest still fires on a quiet session with no further aggregate activity — not only when a later
transition or app-quit happens to trigger it. The opt-in gate is re-consulted per buffered root at
digest-emit time (not only at buffer time), so a mute that lands after roots were buffered but before
window close suppresses the pending digest too.

## Pane-less projects

A project with no open pane in this app (a `source:'persisted'` member carried on the aggregate) is a
first-class notification target — indeed, surfacing **pane-less** / **no open pane** projects is the
whole point of the feature. Its transition fires a notification like any other; clicking it opens the
decision-queue drawer scrolled to that project (see below), since there is no pane to focus.

## Click-to-focus / drawer reveal

Clicking an individual notification brings the app forward (main-window `show()`/`focus()`) and sends
`orkyNotify:focus` — the single new IPC channel this feature adds — with the project root. The renderer
reuses the decision-queue drawer's shared pane matcher + most-recently-used pick to focus the matching
pane in this window, via one exported helper (`focusMruPaneMatch` in `pane-reveal.ts`) that both
`DecisionQueuePanel.focusProject` and the notification's `focusProjectPane` call — a single source of
truth for the MRU-select + focus-dispatch tail, never a forked copy; if no pane matches, it opens the
drawer (`setQueueOpen(true)`) scrolled to the project's group, retrying the scroll across a few frames
so the reveal is robust to the drawer's closed→open conditional mount. A **digest** click sends
`orkyNotify:focus` with a `null` payload — it just opens the drawer, with no specific project. The
notification takes no pipeline action (no answer/resume — that is the action dispatcher's job).

The channel is deliberately outside the frozen `registry:*` family (it is not a registry read/write).

## The app-wide opt-in (default on, live-refreshed)

Notifications are governed by a single app-wide preference, `orkyNeedsYouNotifications`, stored in
`quick.json` on the `QuickStore` — an additive-optional boolean following the `toastsEnabled` pattern
(absent stays absent; it bumps no `SCHEMA_VERSION`). It is **default enabled**: the effective state is
read via the shipped `!== false` idiom, so a legacy file with the field absent reads as on. A checkbox
in General settings (`data-testid="orky-needs-you-notifications"`) toggles it; this **opt-in** is the
app-wide **mute** for needs-you notifications.

Notification copy interpolates the project basename and feature slug (both on-disk-derived directory
names); both are entity-escaped (`&`/`<`/`>`) before being embedded, so a crafted directory or feature
slug name cannot inject Linux/Pango markup or corrupt the rendered notification body.

The observer's `shouldNotify` gate is synchronous, but the preference is written renderer-side via
fire-and-forget `quickSave`. To keep it correct without a **restart**, the composition root holds one
in-memory mirror initialized from disk at startup and refreshed **live** from the full `QuickStore`
payload flowing through the existing `quickSave` handler (via an `onQuickSave` hook — no new IPC, no
async re-read on the notify hot path). A toggle takes effect on the next transition after the save
lands. The gate is consulted at notification-construction time, per item: a denied item is neither
shown individually nor counted in the digest.

## Strictly read-only scope

The feature's only side effects are constructing `Notification`s, dispatching `orkyNotify:focus`, and
reading/writing the `orkyNeedsYouNotifications` preference in the existing `quick.json`. It performs no
`.orky/` filesystem read (the aggregate is the sole source), writes/creates/deletes nothing under any
`.orky/` tree, invokes no CLI or Orky action, calls no registry mutation surface, adds no pane kind,
and bumps no `SCHEMA_VERSION`. No observer/dedupe/throttle state is ever persisted.

## Where the code lives

| Piece | File |
|---|---|
| Pure observer (diff / dedupe / throttle / digest / copy) | `src/main/orky/orky-needs-you-notifier.ts` |
| Composition-root wiring, production `Notification`/click sink, opt-in mirror | `src/main/ipc/register.ts` |
| `quickSave` live-refresh hook | `src/main/ipc/register-workspaces.ts` |
| The `orkyNotify:focus` channel + preload subscriber | `src/shared/ipc-contract.ts`, `src/preload/index.ts` |
| `orkyNeedsYouNotifications` preference + normalize | `src/shared/types.ts`, `src/main/persistence/quick-store.ts` |
| Settings checkbox + quick-slice setter | `src/renderer/components/GeneralSettings.tsx`, `src/renderer/store/quick-slice.ts` |
| Renderer click-to-focus / drawer-reveal handler | `src/renderer/App.tsx`, `src/renderer/components/pane-reveal.ts` |
