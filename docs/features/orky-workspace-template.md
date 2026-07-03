# Per-project Orky workspace template (project cockpit)

> One gesture opens a "cockpit" workspace for a tracked Orky project: an Orky pane bound to the
> project plus a plain terminal at its root, side by side.

**Status:** Shipped (feature 0011) · **Spec:** `.orky/features/0011-orky-workspace-template/02-spec.md`

## What it does

Pick a tracked Orky project and Termhalla opens a fresh **cockpit workspace**: an **Orky pane**
bound to that project on the left and a **terminal** on the right, in a 50/50 row split. The
terminal is a **plain shell at the project root** — no auto-run, no command is auto-typed, no
launch override, no injected env. The workspace is named `Orky: <project folder>`.

Three entry points, one gesture each:

- **Command palette** — `New Orky project workspace…` (`new-orky-workspace`; search terms cover
  orky/project/workspace/cockpit). Opens the shared tracked-root picker, relabelled for the
  cockpit gesture; picking a member root opens its cockpit with no further prompt.
- **Templates menu** — a built-in, never-deletable first row `Orky project cockpit…`
  (`tpl-orky-cockpit`) above the saved templates. It is chrome, not a saved template: it never
  appears in `quick.json` and the "No templates yet." copy keeps referring to saved templates.
- **Decision queue** — each project group header carries an **open cockpit** button
  (`decision-queue-open-cockpit`) that opens that project's cockpit directly (the pre-selected
  path — no picker).

Cancel/Escape in the picker creates nothing. Re-invoking the gesture for the same root opens a
**fresh** cockpit (new workspace + pane ids) and never rebinds or mutates an existing one.

## How it works

- **Pure generator** — `src/shared/orky-cockpit.ts`: `orkyCockpitTemplate({ root, shellId })`
  builds a deterministic `WorkspaceTemplate` value (exactly `{ kind:'orky', root }` +
  `{ kind:'terminal', shellId, cwd: root }`, both byte-verbatim, in a row layout with no
  `splitPercentage`); `orkyCockpitName(root)` derives the name by splitting on both separators
  (total on any string; a segmentless root falls back verbatim). No clock, randomness,
  `localeCompare`, platform read, or id generation.
- **Instantiation rides the ONE shipped seam** — `newOrkyWorkspace(root?)` (store root,
  `src/renderer/store.ts`) instantiates via `workspaceFromTemplate`, which remaps fresh pane ids
  AND applies F9's `normalizeOrkyBindings` coercion; the workspace is never hand-assembled.
  Registration matches `newWorkspace` in full: order append, `activeId`, autosave, and the
  `reportAssignment` window-arrangement report.
- **Pre-selected path** — with an argument the picker is skipped and the root is
  membership-validated against the HELD registry snapshot via `sameProjectRoot` (fold mode from
  `caseFoldFromPlatform(navigator.platform)`); a matching cockpit is built from the aggregate
  member's spelling. All four registry states are honored with pairwise-distinct refusal copy:
  not-tracked (names the root and how roots become tracked), loading (never described as
  not-tracked), and failed (surfaces the held `registryError` verbatim); a held-empty snapshot
  rides the not-tracked branch. Refusals create and report nothing.
- **Picker reuse, not a fork** — both picker-driven entries mount the shared `OrkyRootPicker`
  through an F11-owned one-shot request (`orkyCockpitPickOpen` / `resolveOrkyCockpitPick`),
  passing the existing additive `ariaLabel`/`heading` props; the F9 default-labelled request is
  untouched.
- **Saveable + reusable** — the cockpit is a real workspace: `saveTemplate` (the user's explicit
  gesture — the cockpit flow itself never writes `quick.templates`) captures it, and the normal
  templates-menu path re-instantiates it with the orky `root` and terminal `cwd` byte-preserved
  under fresh ids. In other words: save the cockpit as a template like any other workspace.

## The FINDING-001 durability repair (all templates inherit it)

The shipped `newWorkspaceFromTemplate` (`src/renderer/store/quick-slice.ts`) registered the
instantiated workspace but never reported it into main's authoritative `windows[]`, so a
menu-instantiated workspace was **silently lost**: the next pushed assignment (reload, window
promotion, move/redock) deleted it in `applyAssignment`'s drop loop, and quit→relaunch orphaned
its file. Feature 0011 repairs the shared seam: `SliceDeps` gains `reportAssignment` (threaded
from the existing store-root closure — kept OFF public `State`), and `newWorkspaceFromTemplate`
now calls it on the success path after `scheduleAutosave()`. Every template — pre-F11 saved ones
included — now **survives** assignment pushes and relaunch. No new IPC or write path: the report
rides the existing `winReport` channel; the `!tpl` fallback already reported via `newWorkspace`.

## Key files

| File | Responsibility |
|---|---|
| `src/shared/orky-cockpit.ts` | pure `ORKY_COCKPIT_TEMPLATE_ID` / `orkyCockpitTemplate` / `orkyCockpitName` |
| `src/renderer/store.ts` | `newOrkyWorkspace(root?)`, the F11 one-shot picker request, `reportAssignment` in `SliceDeps` |
| `src/renderer/store/quick-slice.ts` | the `newWorkspaceFromTemplate` reporting repair |
| `src/renderer/App.tsx` | the F11-labelled `OrkyRootPicker` mount |
| `src/shared/quick.ts`, `src/renderer/components/CommandPalette.tsx` | the `new-orky-workspace` palette entry |
| `src/renderer/components/TemplatesMenu.tsx` | the built-in `tpl-orky-cockpit` row |
| `src/renderer/components/DecisionQueuePanel.tsx` | the group-header `decision-queue-open-cockpit` button |

## Scope guard

Composition only: no new pane kind, no `SCHEMA_VERSION` change (stays 8), no new IPC/preload
surface, no new write path; the five F9 files (`orky-pane.ts`, `OrkyPane.tsx`,
`OrkyRootPicker.tsx`, `orky-pane-slice.ts`, `orky-root-detail.ts`) are byte-unchanged. The
cockpit path adds no new detail-fetch trigger — the Orky pane keeps its shipped
one-fetch-per-bind discipline.

## Testing

- **Unit:** `tests/shared/orky-cockpit.test.ts` (generator), `tests/renderer/orky-cockpit-action.test.ts`
  (real-store action + durability round-trips), `tests/renderer/quick-slice-report-assignment.test.ts`
  (the seam repair), `tests/renderer/orky-cockpit-structure.test.ts` (wiring/scope scans),
  `tests/docs-feature-0011.test.ts`.
- **e2e:** `tests/e2e/orky-cockpit.spec.ts` — the three gestures, the relabelled picker, saved-file
  shape, and the reload-survival round-trips.

## Related

- [Workspace templates](workspace-templates.md) · [Orky pane](orky-pane.md) ·
  [Decision queue](decision-queue.md) · [Quick-capture inbox](quick-capture-inbox.md)
