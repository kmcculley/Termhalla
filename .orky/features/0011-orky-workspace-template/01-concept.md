# 0011 — Phase 1: Concept (brainstorm)

## Decisions

- **D1 — Reuse Termhalla's existing workspace-template mechanism; add an Orky preset generator.**
  Termhalla already saves/spawns workspace layout templates. F11 adds a generator: given a chosen
  tracked project root, it produces a workspace with (a) an OrkyPane (F9 kind) bound to that root
  and (b) a terminal pane whose cwd is that root, in a split layout. No new pane kinds, no new
  persistence schema beyond what F9's pane kind already added (SCHEMA_VERSION stays as F9 left it).
- **D2 — Single-gesture entry: pick a tracked project → open its cockpit.** A command-palette entry
  (and wherever "new workspace from template" affordances live) lets the user pick a tracked project
  from the F5 registry (reuse F9's OrkyRootPicker) and opens the generated workspace in one gesture.
  A pre-selected root (from F10's pane, the queue, or a notification click) skips the picker.
- **D3 — The generated layout is a saveable, reusable template, not a one-off.** The result is a
  real workspace the user can save, rename, and re-open like any other (reuse the shipped
  save/template path); re-opening for the same project is idempotent-friendly (opens a fresh
  cockpit; does not duplicate-bind). The Orky-ness is entirely in the composed pane kinds — the
  template system itself is unchanged.
- **D4 — Composition + wiring only; no new write/dispatch/IPC.** F11 mounts existing kinds
  (OrkyPane, terminal) via the existing commitPane/newWorkspace/template path; it dispatches nothing
  through F7 itself (the actions live in the OrkyPane via F8/F10). Read-only wrt Orky; the terminal
  pane's cwd is the project root (reuse launchDir/commitPane cwd, byte-verbatim), no auto-run.
- **D5 — Honor the accumulated conventions.** CONV-020 focus, CONV-041 pointer, CONV-007
  focus-visible for any new affordance; the OrkyRootPicker reuse follows F9/F10's additive-prop
  discipline; determinism of the generated layout (same project → same layout structure).

## Concerns (routing tags for review lenses)

- `ux` — the single-gesture flow (pick → cockpit), the picker reuse, the generated split layout
  usability, coexistence with existing workspace templates, the pre-selected-root path.
- `quality` — reuse (D1/D2/D4 — compose the shipped template + pane systems, no fork); the generator
  cleanliness; determinism of the layout.
- `determinism` — same project → same generated workspace structure; no clock/random in the layout.
- `security` — the terminal pane cwd = project root (validated/trusted like the F8 resume launch);
  no new write path.

## Open questions

- None blocking. The exact split ratio/orientation, template naming, and whether the terminal
  auto-runs anything (D4 says no — plain shell at the root) are spec decisions bounded by the
  shipped template mechanism.

## Gate

Recorded via `record --gate brainstorm` (delegated).
