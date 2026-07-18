# Deferred Work

Repo-wide deferred items that don't belong to a single Orky/superpowers feature.
Per-feature deferred work lives in [`superpowers/*-review-followups.md`](superpowers/);
the *why* behind a choice lives in [`decisions.md`](decisions.md).

Each item: what, why it was deferred, and what "done" looks like.

---

## Open

### Quality-audit 2026-07-17 — deliberate remainders from the 35-finding fix batch
**Added 2026-07-18.** The whole-project quality audit's fixes landed as one batch (see the five
`Quality-audit batch 2026-07-17` CHANGELOG entries). Four remainders were left deliberately:

- **Finding 10 (b, c) — `newOrkyWorkspace` / `newRemoteWorkspace` stay in `store.ts`.** Frozen
  structural suites pin their implementations to that file (TEST-664/671 extract
  `newOrkyWorkspace`'s brace-balanced body *from `src/renderer/store.ts`*; TEST-2268 requires
  `newRemoteWorkspace` + its literals at positions inside store.ts). **Done when:** a future
  feature that owns those suites amends them through the tests phase and moves the actions into
  their slices (`quick-slice` / `remote-slice`), which SliceDeps already supports.
- **Finding 28 (partial) — palette/chord commands pinned at their call sites.**
  `capture-orky-work` (TEST-495 pins both call-site shapes), `toggle-orky-queue` (TEST-360/329),
  and the toggle-vs-open pairs (search/broadcast — genuinely different semantics) stay duplicated
  between App.tsx and CommandPalette; the other 11 commands ride the shared `dispatchCommand`
  (`store/pane-ops.ts`). **Done when:** those suites are amended (or the semantics unified) and
  the stragglers join the shared dispatcher.
- **Two more local `basenameOf` copies** outside the audit's shared-tree scope:
  `src/renderer/components/OrkyPane.tsx` (takes `unknown`) and
  `src/main/orky/orky-needs-you-notifier.ts` — candidates for `@shared/paths`' `basename` (the
  OrkyPane variant needs a type-guard wrapper). One more copy of the unref'd-timer pattern lives
  in `src/main/orky/orky-root-engine.ts` (candidate for `src/main/managed-interval.ts`).
- **Perf observation (audit out-of-scope):** `src/shared/remote/framing.ts`'s decoder re-copies
  its whole buffered array per `push` — quadratic when a large frame (e.g. an 8 MiB attach
  snapshot) arrives in small chunks. Belongs to a /review-perf pass.

### Validate the `hidden` e2e window mode across the full suite
**Added 2026-07-08.** `playwright.config.ts` now defaults to `TERMHALLA_E2E_WINDOW=hidden`, so
e2e never presents its Electron windows (see
[decisions: the e2e suite never presents its Electron windows](decisions.md)). The full-suite
run that would have validated it was cancelled partway.

Verified passing under `hidden`: `status.spec.ts` (including a `boundingBox` measurement),
`editor.spec.ts` (Monaco), `font-zoom.spec.ts`.

**The open question** is specs that read xterm's *rendered rows* rather than React state —
`cwd.spec.ts`, `ai-session.spec.ts`, `minimize-restore.spec.ts` ("output accumulates"). A
never-shown window is a background window, and xterm paints rows on `requestAnimationFrame`;
`backgroundThrottling: false` (set for this mode in `window-manager.ts`) is meant to keep rAF
alive, but that is unproven here.

**Done when:** `npm run build && npm run e2e` passes green on the default (`hidden`). Low risk to
carry: no CI workflow runs e2e, and a failure is loud rather than silent. If rAF does turn out to
be starved, fall back to `TERMHALLA_E2E_WINDOW=inactive` as the default (windows are then visible
but never focused) or add the `--disable-renderer-backgrounding` /
`--disable-background-timer-throttling` Chromium switches.

**First confirmed instance (2026-07-09): hidden-window Monaco re-render stall.** The predicted
risk materialized — for MONACO, not xterm. In `minimize-uniform.spec.ts` TEST-030's seeded
editor+explorer layout, typing into the focused Monaco editor under `hidden` updates the MODEL
(the keystrokes land — a Ctrl+S writes them to disk) but `.view-lines` never re-renders, so the
draft assertion fails deterministically. Measured on the released v0.16.1 build as well — this
was TEST-030's long-standing "flake", not a session regression — and the same probe under
`inactive` re-renders correctly. Notably `editor.spec.ts` (single-editor seed, same
click→Ctrl+Home→type idiom) passes under `hidden`, so the trigger is layout/timing-sensitive, not
a blanket Monaco rule. Disposition: TEST-030's spec now forces `TERMHALLA_E2E_WINDOW=inactive`
for its own launch (a sanctioned launch-env-only amendment, assertions untouched). If more
Monaco-typing specs start stalling under `hidden`, revisit the default per the fallback above
rather than amending specs one by one.

### QoL audit 2026-07-17 — items deliberately deferred from the batch
**Added 2026-07-17.** The five-domain polish audit (focus / confirms / modals / terminal /
editor-explorer / chrome) shipped as one batch (see CHANGELOG [Unreleased] "QoL batch
2026-07-17"). These findings were real but deliberately left out — each is a feature-sized
design, not a polish fix:

- **Git awareness in explorer/editor** (per-file M/A/U row coloring, Monaco dirty-diff gutters).
  Needs per-file working-tree status plumbed from `src/main/git/` (today it's per-pane summary
  only). Candidate Orky feature.
- **VS Code-style preview tabs** (single-click = reused italic tab, double-click pins). Changes
  the explorer's open semantics; needs a design decision first.
- **Editor tab drag-reorder.** `use-tab-drag.ts` is workspace-tab-specific; adapting it is
  mechanical but non-trivial. Middle-click close + the tab context menu shipped instead.
- **Taskbar needs-input signal** (`flashFrame`/`setOverlayIcon` when a background window's pane
  goes needs-input). Main-side; must ride the `raisesOsSurfaces()` e2e gating exactly like the
  Orky notifier or it will raise OS surfaces in test runs. The in-window title now updates
  (shipped); the taskbar half is the remainder.
- **Per-pane terminal font-size override.** Zoom is app-global (now with chords + reset); a
  per-pane override is a persisted-config design.
- **"Compare" for the external-change bar** (Monaco diff of buffer vs disk). The Reload /
  Keep-mine bar works; a diff view is a new surface.
- **Minimize-restore placement choice / tray chip reorder.** Restore always splits right
  (REQ-006); restore-all shipped, placement choice did not.
- **Per-workspace tab color/icon.** Needs a `Workspace` field + picker UI.
- **Next/prev pane cycle chord.** Directional focus (Ctrl+Alt+arrows) shipped and subsumes most
  of it; add a cycle only if directional proves insufficient in practice.

**Done when:** each either ships as its own feature (the git one is the clear next candidate) or
is consciously rejected in `decisions.md`.

### `git-status.spec.ts` is intermittently flaky
**Added 2026-07-08.** Observed once in a full run: the pane's git chip stayed on `main` and never
showed the `●` dirty marker within the 25 s timeout, after a `Set-Content extra.txt hi`. Passed on
retry, so the suite is green (`retries: 2`), but the underlying race — the git-status poll not
observing a just-written file — is real and unexplained.

**Done when:** either the poll is shown to be correctly debounced against the fs watch and the
timeout is simply tight, or the race is fixed. Do not "fix" it by raising the timeout without
first understanding which of the two it is.

---

## Known bugs recorded elsewhere

`.orky/baseline/architecture.md` records four confirmed known bugs as candidate Orky features;
**#1 (unanchored AI-detection substrings), #2 (the whitespace-strict needs-input question
catch-all), and #3 (merge-conflict count) were FIXED 2026-07-09** in the quality/polish batch
(see the baseline's own entries for the audit trail). **#4 (the cursor-home `CURSOR_HOME_RE`
catch-all) was FIXED 2026-07-09 by feature 0025-cursor-home-output-suppression** — all four are
now fixed.
Historical note: #4 had **widened** on 2026-07-08, before its own fix — because a marker-less
pane's busy rule sat behind `isPureControl`, a full-screen TUI over ssh whose frames began with
cursor-home (`top`, `vim`) read *idle* rather than flapping, the deliberate trade over an
oscillating pane at the time; see
[decisions: a marker-less pane goes busy on real output only](decisions.md). Feature 0025 kept
that busy-detection trade **verbatim** (via the dedicated `isRepaintChunk` check) while fixing
the tail-admission bug: a repaint's printable text is now admitted to the needs-input tail
without reopening the repaint-eviction scenario.
