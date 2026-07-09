# Pane toolbar cleanup + unified split-direction control (Orky 0002) — Review Follow-ups (deferred)

Feature `0002-pane-toolbar-split-control` shipped READY. The two **HIGH** accessibility
contract violations (FINDING-UX-001 / ESC-001 and FINDING-UX-002 / ESC-002) were
**resolved in iteration 2** — the compass now paints a visible active-direction highlight
(default `right`) independent of `:focus-visible` by adding the `split-menu` testids to the
`index.css` focus-visible/hover allow-list (REQ-010), and the kind selector was converted
from a broken `role="radiogroup"` to working `aria-pressed` toggle-buttons in a `role="group"`
with arrow keys scoped to the compass only (REQ-011). FINDING-DEV-002 and FINDING-DEV-004
were likewise resolved in-feature.

The non-blocking items below were **deferred, not fixed**, and are tracked here so they
aren't lost. Full records (claim, evidence, fix) live in
`.orky/features/0002-pane-toolbar-split-control/findings.json`.

## Deferred follow-ups

### MEDIUM

- ~~**Lost ambient recording indicator** (FINDING-DEV-001 / FINDING-UX-006,
  `PaneToolbar.tsx` + `PaneContextMenu.tsx`)~~ — **RESOLVED 2026-07-09** (quality/polish batch):
  the pane title carries a persistent `⏺ ` prefix while recording, via the unit-tested
  `paneTitle` composer in `pane-status.ts` — the same paint-only title-text mechanism as the 🔔
  needs-input bell (REQ-012: no box change). Pinned by `tests/renderer/pane-title.test.ts`.

- **Dead `dir`/`'row'` parameter — collapse to a single SplitDir4 source of truth**
  (FINDING-QUA-001 / FINDING-QOL-001, `SplitMenu.tsx:45-47` + `store.ts`,
  `store/types.ts`, `store/pane-ops.ts`, `internals.ts`). The split call chain now carries
  two parameters for one concept: the legacy `dir: MosaicDirection` and the new
  `splitDir?: SplitDir4`, where `splitDir` silently overrides `dir`
  (`const lay = splitDir ? splitDirToLayout(splitDir) : { direction: dir, position: 'after' }`).
  Every `add*` call site now hardcodes `'row'` for `dir`, so it is vestigial; the
  `SplitMenu` local even shadows the function's `dir` param. Passing a meaningful
  `dir='column'` with `splitDir='right'` would silently drop the column. Rationale: works
  correctly today; this is a maintainability footgun, not a bug. Fix: thread a single
  `splitDir?: SplitDir4` (or `{direction, position}`) through
  `addTerminal`/`addEditor`/`addExplorer`/`commitPane`/`placePane` and drop the
  always-`'row'` `MosaicDirection` arg. **Promoted to CONV-006.**

- ~~**Combined surface forces one keydown handler over two keyboard models** (FINDING-DEV-003)~~
  — **RESOLVED since** (verified 2026-07-07): arrow handling is now scoped to the compass
  group's own `onCompassKeyDown`; the container handler owns only the Tab trap (Escape moved to
  the shared MenuSurface in the 2026-07-06 audit Group C #10 pass).

- ~~**Focus not restored to the trigger on dismiss** (FINDING-UX-003)~~ — **RESOLVED since**
  (verified 2026-07-07): every dismissal (Esc, click-away, commit) routes through `close()`,
  which focuses the captured trigger before `onClose`.

- ~~**Trigger button exposes no popup semantics** (FINDING-UX-004)~~ — **RESOLVED since**
  (verified 2026-07-07): the split trigger carries `aria-haspopup="dialog"` +
  `aria-expanded` (`PaneToolbar.tsx`).

- ~~**Disabled Explorer option has no explanation** (FINDING-UX-005, `SplitMenu.tsx`)~~ —
  **RESOLVED 2026-07-09** (quality/polish batch): every disabled split-kind cause now carries a
  reason in both the accessible name and the hover `title` ("needs a folder — this pane has no
  known working directory yet"; the orky causes got titles too, keeping their pinned aria-label
  wording byte-identical).

### LOW

- ~~**Popover anchored via `document.querySelector` by testid instead of an anchor ref**
  (FINDING-SEC-001 + FINDING-QUA-005)~~ — **RESOLVED 2026-07-07** (the DOMException half, via
  the same mitigation OrkyPopover took for 0004 FINDING-SEC-005): the selector now interpolates
  `CSS.escape(paneId)`, pinned by `tests/renderer/split-menu-escape.test.ts`. The
  anchor-via-testid coupling (the RefObject alternative) remains the accepted repo-wide popover
  anchoring pattern — revisit only if it's changed for all anchored popovers at once.

- ~~**Split button still shows the `⬌` glyph** (FINDING-QOL-002, `PaneToolbar.tsx`)~~ —
  **RESOLVED 2026-07-09** (quality/polish batch): the trigger now renders `✛` (four-way),
  paint-only per REQ-012.

- ~~**Magic anchor offset `r.right - 168`** (FINDING-QOL-003)~~ — **RESOLVED since**
  (verified 2026-07-07): the anchor math derives from the named, documented `EST_W`/`EST_H`
  estimate constants (with the clamp/flip logic sharing them), not a bare literal.

- **`splitDirToLayout` has no `default` branch** (FINDING-QOL-004, `workspace-model.ts:53-61`).
  An out-of-type value (untyped IPC/persisted/test input) makes the bare `switch` return
  `undefined`, and the caller's `lay.direction`/`lay.position` access then throws a cryptic
  "Cannot read properties of undefined" naming no value (CONV-001). Fix: add a `default`
  that throws naming the bad value, or an `assertNever` exhaustiveness check.

- ~~**`dirRefs` typed as `Record<string, …>`** (FINDING-QUA-002)~~ — **RESOLVED since**
  (verified 2026-07-07): typed `Partial<Record<SplitDir4, HTMLButtonElement | null>>`.

- ~~**Roving tabindex only half-implemented** (FINDING-QUA-003 / FINDING-UX-007)~~ —
  **RESOLVED since** (verified 2026-07-07): `tabIndex` follows the tracked `active` direction
  (`tabIndex={d === active ? 0 : -1}`), so Tab-away-then-back re-enters at the last active
  direction.

- **Explorer-without-cwd commit silently closes** (FINDING-QUA-004, `SplitMenu.tsx:44-49`).
  When `kind='explorer'` and cwd is falsy, `commit()` closes the popover without splitting —
  an undefended invariant (the option should already be disabled, but the commit path does
  not assert it). Fix: guard/assert the invariant.

- **Popover not focus-trapped, no dialog role/label** (FINDING-UX-008, `SplitMenu.tsx:78-101`).
  **PARTIALLY RESOLVED since** (verified 2026-07-07): Tab is now trapped inside the popover
  (the container `onKeyDown` wraps first↔last). Still open: no `role="dialog"`/`aria-label` on
  the surface. Fix (remainder): add the dialog role + accessible name.

- **Weak selected-kind indicator** (FINDING-UX-009, `SplitMenu.tsx:68-75`). The visual
  selected-state of the kind buttons is subtle for a control whose goal is "modern and
  sleek." Fix: strengthen the selected paint state (paint-only per REQ-012).

- **`up/down ⇒ column` not pinned by an observable e2e assertion** (FINDING-DEV-005,
  `04-tests.md` / REQ-007). REQ-007's "up/down ⇒ a vertical/stacked split" is covered by the
  pure `splitDirToLayout` unit (TEST-005) and the before/after DOM-order test (TEST-012) but
  not by an end-to-end assertion that a `down` split actually stacks the tiles vertically.
  Fix (next test pass, tests currently frozen): add an e2e asserting the column geometry.

- **`docs-feature-NNNN` CHANGELOG guards are coupled to `[Unreleased]`** (release hygiene, not a
  feature finding — surfaced while cutting v0.6.0). `tests/docs-feature-0001.test.ts` and
  `tests/docs-feature-0002.test.ts` grep only the `## [Unreleased]` block, so a normal
  Keep-a-Changelog release (moving bullets into a dated section) empties that block and turns the
  guards RED — it broke v0.5.0. Current workaround (see `docs/decisions.md`, 2026-06-29): keep each
  feature's bullets in `[Unreleased]` *and* its version section. Fix: rewrite both guards to search
  the whole CHANGELOG (or the feature's own version section), then released bullets can leave
  `[Unreleased]` normally and the redundancy goes away.

## Promoted to conventions

- **CONV-006** — from FINDING-QOL-001 (dead `dir`/`splitDir` dual param): a function MUST NOT
  expose two parameters that encode the same concept where one silently overrides the other.
- **CONV-007** — from FINDING-UX-001 (portalled popover excluded from the focus/hover
  allow-list): any new chrome popover/menu portalled to `<body>` must carry visible
  paint-only focus and hover styling (or be added to the `index.css` focus-visible/hover
  allow-lists).

## Resolved in-feature (not deferred)

- FINDING-UX-001 / ESC-001 (no visible compass highlight, REQ-010) — fixed in iteration 2:
  tracked active direction painted via an accent background+ring independent of
  `:focus-visible`; `split-menu` added to the `index.css` allow-lists.
- FINDING-UX-002 / ESC-002 (broken `role="radiogroup"` kind selector, REQ-011) — fixed in
  iteration 2: converted to `aria-pressed` toggle-buttons in a `role="group"`, one roving
  tab stop, arrow keys scoped to the compass.
- FINDING-DEV-002, FINDING-DEV-004 — resolved in-feature (see findings.json).
