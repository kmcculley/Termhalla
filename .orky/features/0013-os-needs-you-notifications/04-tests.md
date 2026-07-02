# 0013 — OS-level needs-you notifications — Test design (Phase 4)

**Status:** tests designed against the FROZEN `02-spec.md` (REQ-001…REQ-014, revision 2026-07-02 incl.
the D3 coordinator amendment) and `03-plan.md` (TASK-001…TASK-013; **TASK-011 — the delegated
TEST-358 frozen-guard supersession — is executed HERE**, per the 0006 TASK-013 / 0012 TASK-002
precedent and CONV-019). Every test file below is **FROZEN once the tests gate passes (ADR-009)** —
the implementer makes them pass without editing them.

TEST-NNN ids continue from the repo maximum **TEST-529** at **TEST-530**, running through **TEST-574**
(45 new ids: 43 vitest + 2 Playwright e2e). No production code (`src/`) was written by this phase —
only test files, this document, and `traceability.json`. The TEST-358 amendment (below) is the sole
edit to an existing frozen test, and it is a sanctioned CONV-019 supersession, not an implementer edit.

## Harness constraint honored (the 0009 / 0012 precedent)

`vitest.config.ts` is `environment: 'node'`, no jsdom — a React component lifecycle cannot be mounted
in the `npm test` gate, and `register.ts` pulls in Electron + the whole service graph. So:

1. **Pure logic** (the observer's diff/dedupe/throttle/copy/lifecycle) is driven directly with injected
   ambients (clock/gate/sinks) — `tests/main/orky-needs-you-notifier.test.ts`. This is the behavioral
   heart of the feature and needs no Electron.
2. **Persistence** is a real `QuickStore` round-trip on a temp dir — `tests/main/orky-needs-you-quickstore.test.ts`.
3. **The live-refresh seam** drives the REAL `registerWorkspaces` quickSave handler under a mocked
   `ipcMain` (the `register-registry-detail.test.ts` mocking style) + a mirror + a REAL notifier —
   `tests/main/orky-needs-you-mirror.test.ts` — so REQ-005's "exercise the real handler, not only the
   stub" clause is met behaviorally.
4. **Composition-root wiring, the production Notification/click sink, the scope guards, the opt-in UI,
   and the renderer focus handler** are pinned by structural source scans over greppable literals the
   implementer MUST keep — `tests/renderer/orky-notify-wiring-structure.test.ts` (the
   `app-queue-wiring.test.ts` / TEST-414 precedent).
5. **e2e against the packaged tree** (`tests/e2e/orky-notify.spec.ts`, NOT in the `npm test` gate) —
   real registry-membership vectors, a main-process Notification spy (app.evaluate patches the electron
   module's `Notification` the observer constructs through), a real notification-click handoff, and a
   real General-settings checkbox toggle.

## Chosen contract (this suite FREEZES it; the implementer conforms — ADR-009)

Pinned in the header of `tests/main/orky-needs-you-notifier.test.ts`, matching the spec's Public
interface exactly:

```ts
// src/main/orky/orky-needs-you-notifier.ts (new)
export const COALESCE_WINDOW_MS = 4000
export const DIGEST_THRESHOLD = 3
export interface NeedsYouDeps {
  now: () => number
  shouldNotify: (projectRoot: string) => boolean
  notifyOne: (n: { title: string; body: string; projectRoot: string }) => void
  notifyDigest: (n: { title: string; body: string; projectCount: number }) => void
}
export class OrkyNeedsYouNotifier {
  constructor(deps: NeedsYouDeps)
  onSnapshot(snapshot: OrkyRegistrySnapshot): void
  flush(): void
  dispose(): void
}
```

The live-refresh mirror seam (REQ-005 Wiring): `registerWorkspaces` gains an optional
`onQuickSave?: (data: QuickStore) => void` dep, invoked at the END of its existing `quickSave`
handler (an ADDITIONAL call — `quick.save(data)` is still made). The composition root sets a mutable
mirror `data.orkyNeedsYouNotifications !== false`; the injected `shouldNotify` reads it synchronously.
No new IPC channel. The digest is emitted only at window close / `flush()` / `dispose()` (never
mid-window); the opt-in gate is consulted at notification-construction time PER ITEM (a denied item is
neither shown nor counted — spec risk note #2).

## Test files

| File | TEST ids | Kind | Pins |
|---|---|---|---|
| `tests/main/orky-needs-you-notifier.test.ts` (new) | 530–555 | vitest (pure, node) | the transition diff + determinism (REQ-002), the four dedupe lifecycle vectors incl. vanished-project + status:null pruning (REQ-003), the TUMBLING-window throttle/coalesce/digest incl. distinct-project count + trailing flush (REQ-004), the opt-in gate inertness + construction-time placement (REQ-005), copy honesty (REQ-010), malformed-snapshot totality + bounded state (REQ-011), construct/observe/flush/dispose lifecycle (REQ-012), pane-less notify (REQ-001) |
| `tests/main/orky-needs-you-quickstore.test.ts` (new) | 556–559 | vitest (main) | the additive-optional `orkyNeedsYouNotifications` round-trip (REQ-005), legacy-file clean load reading ENABLED via `!== false` (REQ-005), non-boolean → undefined normalize (REQ-005), SCHEMA_VERSION unchanged =8 (REQ-008/REQ-013) |
| `tests/main/orky-needs-you-mirror.test.ts` (new) | 560–561 | vitest (electron-mocked) | the `quickSave` live-refresh hook fires with the full payload AND still persists (REQ-005); a `quickSave(false)` payload mutes the NEXT transition without restart through the REAL handler + mirror + production gate, re-enabling on `true` (REQ-005 Wiring) |
| `tests/shared/orky-notify-channel.test.ts` (new) | 562–563 | vitest (shared) | `CH.orkyNotifyFocus === 'orkyNotify:focus'`, not `registry:`-prefixed, globally unique; exactly one `orkyNotify:*` family channel; preload `onOrkyNotifyFocus` subscriber; contract names it (REQ-009) |
| `tests/renderer/orky-notify-wiring-structure.test.ts` (new) | 564–570 | vitest (structural) | composition-root observer construction + second `onSnapshot` subscription + disposer (REQ-001); production Notification/click → `orkyNotifyFocus` sink (REQ-006/REQ-007); observer module does no `.orky` fs read / no CLI / no registry mutation (REQ-001/REQ-008); GeneralSettings checkbox + quick-slice setter (REQ-005); App.tsx `onOrkyNotifyFocus` reuse/drawer handler with no action dispatch (REQ-006/REQ-007) |
| `tests/docs-feature-0013.test.ts` (new) | 571–572 | vitest (docs) | feature doc + CLAUDE.md ref + CHANGELOG [Unreleased] entry; `orkyNotify:focus` documented; no stale "no main-side notifier"/"no app-wide notification setting" phrasing (REQ-014) |
| `tests/e2e/orky-notify.spec.ts` (new) | 573–574 | Playwright (out-of-gate) | a pane-less needs-you transition fires one honest OS Notification whose click reveals the drawer (REQ-001/006/007/010); the app-wide opt-in OFF silences the next transition live (REQ-005) |
| `tests/renderer/app-queue-wiring.test.ts` (**amended**, TEST-358) | 358 | vitest (structural) | the scheduled CONV-019 supersession — see below |

## TASK-011 — the TEST-358 frozen-guard supersession (CONV-019 / REQ-013), executed at this phase

- **Guard:** `tests/renderer/app-queue-wiring.test.ts` **TEST-358** (line 54 as frozen), a directory
  scan asserting no `src/main`/`src/preload` file matches
  `/decision-?queue|DecisionQueue|queueOpen/i` (`offenders` `toEqual([])`).
- **Why F13 trips it:** the observer (`src/main/orky/orky-needs-you-notifier.ts`, REQ-001/REQ-002) MUST
  `import { buildDecisionQueue } from '@shared/decision-queue'` — the FIRST main-side consumer of the
  shared selector. BOTH the symbol `buildDecisionQueue` (matches `/DecisionQueue/i`) AND the module
  path `@shared/decision-queue` (matches `/decision-?queue/i`) hit the old regex; there is no way to
  import the required selector into `src/main` without matching.
- **Verified intent (from the frozen test's header + body):** F6's decision-queue DRAWER added NO
  main/preload wiring (renderer/shared-only, D2), so the scan protects against the F6 drawer UI /
  `DecisionQueuePanel` component / drawer-open (`queueOpen`) state leaking into main/preload — NOT
  against a legitimate main-side import of the PURE shared selector.
- **Amendment (narrow, atomic, this phase):** the offenders regex is narrowed from
  `/decision-?queue|DecisionQueue|queueOpen/i` to **`/DecisionQueuePanel|queueOpen/i`**. This STILL
  forbids the `DecisionQueuePanel` component and the `queueOpen`/`setQueueOpen` drawer-state in any
  `src/main`/`src/preload` file (the true intent), and does NOT match `buildDecisionQueue` or the
  `@shared/decision-queue` module path — so F13's observer import passes. An in-file supersession note
  naming feature 0013 + REQ-013 + TASK-011 was added. The `registryChannels` `arrayContaining` half of
  the same test (lines 47–49 as frozen) is **UNTOUCHED**.
- **Self-check baked into the amended pin (REQ-013 acceptance):** the test now asserts the narrowed
  regex `.test('<DecisionQueuePanel/>; setQueueOpen(true)') === true` and
  `.test("import { buildDecisionQueue } from '@shared/decision-queue'") === false` — the guard still
  catches a planted main-side drawer reference and passes on the observer's shared-selector import.
- **State now vs later:** the amendment is GREEN on current `main` (F13 code absent — no main/preload
  file contains `DecisionQueuePanel`/`queueOpen`; verified by grep) AND stays GREEN once the observer
  lands (the narrowed regex ignores `buildDecisionQueue`). If the OLD regex had been left in place, the
  observer's import would flip it RED — which is exactly why this supersession lands atomically with the
  suite, not at implementation.

## Frozen-guard inventory verification (REQ-013 — trips none knowingly, retires none silently)

Re-checked against the spec's stated grep patterns; F13's code + the TEST-358 amendment keep every
other frozen guard GREEN (all confirmed by the full-suite run below):

- **`registry:*` closed sets — untouched.** `orkyNotify:focus` is deliberately NOT `registry:`-prefixed,
  so `TEST-409` (`register-registry-detail.test.ts`, exact post-F9 seven) and `TEST-069`
  (`registry-ipc-contract.test.ts`, `arrayContaining` + global uniqueness) stay GREEN. TEST-562/563 pin
  this avoidance explicitly.
- **`SCHEMA_VERSION` `.toBe(8)` pins (SEVEN) — untouched.** The opt-in lives in `quick.json` (outside
  the migration chain, `toastsEnabled` pattern), so no bump. TEST-559 re-pins `=8`; the seven frozen
  value pins (TEST-001/008/020/038/087/344/375) stay GREEN.
- **QuickStore round-trip (`quick-store.test.ts` "round-trips a saved store", `toEqual`) — no edit
  needed, verified GREEN.** `orkyNeedsYouNotifications` follows `toastsEnabled` (absent ⇒ `undefined`,
  never coerced), and `toEqual` ignores an undefined property, so the fixture that omits the field still
  matches. Confirmed still green in the run below.
- **Renderer registry-mutation guards (TEST-362/363) — not tripped, not retired.** F13 is read-only on
  `.orky/` and adds no renderer registry-mutation surface.
- **No `Notification`/`osNotification` count pin exists in `tests/**`** (grep verified) — F13 introduces
  the first `Notification` construction for Orky needs-you.

## Coverage (every REQ-001…REQ-014 has ≥1 TEST — see `traceability.json`)

- REQ-001 → 530, 564, 565, 567, 573
- REQ-002 → 531, 532, 533
- REQ-003 → 534, 535, 536, 537, 579, 580
- REQ-004 → 538, 539, 540, 541, 542, 543, 544, 545, 575, 577
- REQ-005 → 546, 547, 556, 557, 558, 560, 561, 568, 569, 574, 578
- REQ-006 → 567, 570, 573, 582
- REQ-007 → 567, 570, 573, 583
- REQ-008 → 559, 565, 566
- REQ-009 → 562, 563
- REQ-010 → 548, 549, 550, 573, 581
- REQ-011 → 551, 552
- REQ-012 → 553, 554, 555, 576
- REQ-013 → 358 (supersession), 533, 559, 562, 563
- REQ-014 → 571, 572

## RED-state verification (tests gate evidence)

Full `npm test` (vitest) at design time: **1314 passed, 13 failed + 2 module-not-found file loads** —
exactly the intended F13 REDs, no unexpected regression:

- **RED, module not built (module-not-found):** `orky-needs-you-notifier.test.ts` (TEST-530…555) and
  `orky-needs-you-mirror.test.ts` (TEST-560…561) fail to import
  `src/main/orky/orky-needs-you-notifier.ts` (does not exist yet) — the whole-file RED reason, the
  repo's standard for a not-yet-created module (cf. `orky-action-dispatcher.test.ts`).
- **RED, contract absent:** TEST-562/563 (`CH.orkyNotifyFocus` undefined, no preload subscriber).
- **RED, persistence not additive yet:** TEST-556 (the round-trip drops the field). TEST-557/558/559 are
  GREEN retained-behavior fences (legacy load reads ENABLED; a non-boolean already normalizes to
  undefined; SCHEMA_VERSION already 8).
- **RED, wiring/UI literals absent:** TEST-564/565/566/567/568/569/570.
- **RED, docs absent:** TEST-571 (2) + TEST-572 (the contract does not yet document `orkyNotify:focus`).
  TEST-572's stale-claim sweep is GREEN (no offending phrasing exists today).
- **GREEN, TEST-358 amendment:** `app-queue-wiring.test.ts` all 5 tests pass — the narrowed regex holds
  with F13 code ABSENT (current main) and, by the self-check assertions, will hold with the observer's
  `buildDecisionQueue` import PRESENT.
- **e2e (573/574):** not in the `npm test` gate (Playwright, `*.spec.ts`); RED by construction (the
  observer, the `orkyNotify:focus` channel/handler, and the opt-in do not exist yet).
- **Retained GREEN:** all 1314 other tests, including every upstream frozen suite (TEST-409/069/362/363,
  the seven `SCHEMA_VERSION` `.toBe(8)` pins, the `quick-store.test.ts` round-trip).

---

## LOOPBACK — review → tests (ESC-001 / FINDING-005 work order, 2026-07-02)

The seven-lens review found blockers in the SHIPPED F13 implementation (all implement/plan-origin — the
FROZEN `02-spec.md` was correct; REQ-004's "flushed exactly at `windowOpenedAt + COALESCE_WINDOW_MS`"
MUST was already there, the impl went lazy). ESC-001 (human, delegated) resolved to loop back to tests
and pin the fixes RED before the implementer re-enters. **No spec change.** New TEST ids continue from
the repo max **TEST-574** at **TEST-575**, through **TEST-583** (9 new: 8 RED pins + 1 GREEN distinctness
fence; TEST-580 is the fence). One frozen suite is amended in place (below).

### New / amended test files (this loopback)

| File | TEST ids | Finding | Kind | RED reason (vs shipped code) |
|---|---|---|---|---|
| `tests/main/orky-needs-you-notifier.test.ts` (**amended**) | 575, 576 | FINDING-005 | vitest (pure, fake scheduler) | RED — the observer arms no timer, so the buffered digest is never flushed on the quiet-elapse path / no armed timer to clear on dispose |
| `tests/main/orky-needs-you-loopback.test.ts` (new) | 577, 578, 579, 580, 581 | 005/015/014/012 | vitest (main; structural + pure) | see per-id below |
| `tests/renderer/orky-notify-reveal-loopback.test.ts` (new) | 582, 583 | 006/010 | vitest (renderer; structural + behavioral) | RED — no shared `focusMruPaneMatch` tail; `revealQueueGroup` is a single give-up rAF |

Per-id:
- **TEST-575 (FINDING-005, REQ-004)** — burst >`DIGEST_THRESHOLD` in one window → buffered digest; advance
  the FAKE clock to `windowOpenedAt + COALESCE_WINDOW_MS` with NO further transition → `notifyDigest`
  fires EXACTLY once (the armed timer), and never re-fires. RED: shipped `openWindow` arms no timer.
- **TEST-576 (FINDING-005, REQ-012)** — a window-open arms exactly one flush timer; `dispose()` before it
  fires clears it (no leak, `timerCount()===0`) and flushes the pending digest exactly once; the cleared
  timer never double-fires. RED: no timer is armed (`timerCount()===0` where 1 is expected).
- **TEST-577 (FINDING-005, REQ-004, structural)** — `register.ts` supplies `setTimer`/`clearTimer` bound
  to the real `setTimeout`/`clearTimeout` (the production driver the shipped wiring lacked). RED: the
  notifier is constructed with `now`/`shouldNotify`/`notifyOne`/`notifyDigest` only.
- **TEST-578 (FINDING-015, REQ-005)** — mute AFTER buffering, BEFORE window close → `closeWindow`
  re-consults `shouldNotify` → NO digest. RED: shipped `closeWindow` calls `notifyDigest` unconditionally.
- **TEST-579 (FINDING-014, REQ-003, structural)** — `keyOf` must use a collision-safe separator (NUL /
  structural `JSON.stringify`), never a `.join('\n')`. RED: shipped `keyOf` joins on `'\n'`.
- **TEST-580 (FINDING-014, REQ-003, GREEN distinctness fence)** — a `\n`-bearing slug never collapses two
  features under one root into one toast. GREEN today AND after the fix: the practical collision is masked
  by the root-scoped dedupe (reason is a fixed trailing token, so a within-root newline collision is
  unreachable) — this fence encodes the requested `\n`-slug vector and guards a future flat-map regression.
- **TEST-581 (FINDING-012, REQ-010)** — a project basename / feature slug carrying Pango markup (`& < >`)
  is escaped or stripped: no raw tag, no bare non-entity ampersand survives; informative text preserved.
  RED: shipped `individualCopy` interpolates the raw slug/basename.
- **TEST-582 (FINDING-006, REQ-006, structural)** — the MRU-pick + `setActive`/`setFocusedPane`/
  `requestPaneFocus` TAIL is ONE exported helper `focusMruPaneMatch` in `pane-reveal.ts`, called by BOTH
  `focusProjectPane` AND `DecisionQueuePanel.focusProject` (imported from `./pane-reveal`); the panel keeps
  its own `selectPaneCandidates(` walk so frozen **TEST-370 is not fought**. RED: no such export; the panel
  and pane-reveal keep two hand-synced copies.
- **TEST-583 (FINDING-010, REQ-007, behavioral)** — `revealQueueGroup` retries across frames (fake `rAF` +
  a `document` whose target group appears only on the 3rd query) and scrolls the correct group once. RED:
  shipped `revealQueueGroup` schedules a single `rAF` that gives up when the group is absent (the
  closed→open mount race).

### Amendment scope — `tests/main/orky-needs-you-notifier.test.ts` (the ONE frozen suite touched)

Sanctioned CONV loopback: the notifier's `NeedsYouDeps` shape GENUINELY changes (it gains the fakeable
`setTimer`/`clearTimer` scheduler for FINDING-005), so this frozen suite is amended IN PLACE with a
supersession note in its header. Concretely: (1) the `harness()` deps object now supplies
`setTimer`/`clearTimer` (a controllable fake scheduler) and exposes `advance()`/`timerCount()`; (2) two
new timer-contract vectors are added (TEST-575/576). **EVERY pre-existing assertion (TEST-530…555, 26
tests) is byte-preserved and stays GREEN** — they drive the window boundary via a later transition /
`flush()` / `dispose()` and never fire the scheduler, so the added record-only timers do not perturb them.
The rest of the frozen F13 suites are byte-preserved (no other contract changed).

### FINDING-011 — ACCEPTED residual (NOT pinned)

FINDING-011 (LOW): a single user-attention moment on a pane running Claude on an Orky project can fire
TWO OS toasts — 0004's per-pane "X is waiting for you" AND F13's app-wide "&lt;proj&gt; needs you" — because
the two paths have independent opt-ins and no cross-coordination. Per ESC-001 this is an **accepted
residual**, documented as a candidate for a later cross-notification coordination feature. It is
deliberately left **unpinned** here (no TEST id); pinning a dedupe now would over-constrain the future
coordination design.

### RED verification (this loopback)

`npx vitest run` (full gate): **1356 passed, 8 failed** — exactly the 7 RED loopback pins
(TEST-575/576/577/578/579/581/582/583) plus none other; TEST-580 (fence) is GREEN, the 26 retained
notifier assertions are GREEN, and every other frozen suite (incl. the TEST-358 amendment and the shipped
F13 suites) stays GREEN. No unintended REDs. The 8 REDs will go GREEN once the implementer arms the
injected timer, wires real timers in `register.ts`, re-gates `closeWindow`, uses a NUL/structural key,
escapes the notification copy, extracts the shared `focusMruPaneMatch` tail, and makes `revealQueueGroup`
retry across frames.
