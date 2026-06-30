# 0014 — Phase 1: Concept (brainstorm)

**Status:** human confirmed. Gate recorded.

## Decisions

- **D1 — Scope to Termhalla-side only this run** (see `00-intake.md` for the full rationale).
  `02-spec.md` MUST define the OSC marker contract (prefix + body grammar) as a first-class,
  clearly-labeled artifact — it is the interface the human will implement on the Orky side
  afterward, separately, in `C:/dev/Orky`. Pick an OSC number/prefix that does not collide with
  what's already in use in this codebase: `\x1b]133;` (shell-integration/Osc133Parser) and
  `\x1b]7;` / `\x1b]9;9;` (cwd-parser). Prefer a private-use numeric OSC code (e.g. in the
  unassigned/private range) with a literal sub-tag (e.g. `orky=`) so it's unambiguous to a human
  reading raw terminal bytes, and namespaced enough to never collide with a real terminal app.
  Body should be small (a heartbeat marker, not a dump of `.orky/` state) — e.g. enough to derive
  the same `OrkyPaneStatus` fields 0004 already renders (phase, gate N/M, needs-human, open-finding
  count), base64/JSON-encoded or a compact delimited format — spec-writer's call, but it must be
  parseable with the existing `scanOsc` accumulate/carry-over contract (i.e. body must not itself
  contain the terminator bytes BEL/ST).
- Tests must NOT depend on a live Orky CLI process — golden/synthetic OSC byte sequences only
  (consistent with how `osc133-parser`/`cwd-parser` are unit-tested today).
- Render path reuses 0004's `OrkyPaneStatus` → chip/border/badge presentation unchanged; F14 only
  adds a second SOURCE of `OrkyPaneStatus` (parsed-from-stream) alongside 0004's existing source
  (filesystem watch), not a second presentation.

## Concerns (routing tags)

- `doc-provenance`/`doc-drift` — doc-sync MUST flag the cross-repo dependency loudly; this is the
  single highest-risk drift point in the whole roadmap (a feature whose "done" still requires
  external action by the human to be real over SSH).
- `security` — the OSC body is attacker-influenceable in principle (anything writing to the PTY can
  inject bytes); parser must be a strict, bounded grammar (size cap, no unbounded buffering beyond
  what `scanOsc` already carries), never `eval`/dynamically interpret the body.
- `determinism` — `scanOsc`'s carry-over-partial-sequence behavior across chunk boundaries must be
  preserved exactly (reuse the function, don't reimplement its loop).
- `quality` — reuse `scanOsc`/`OrkyPaneStatus`, don't fork.

## Open questions

- None blocking for THIS feature. The exact OSC prefix/body format is a spec-writer decision (see
  D1 guidance above) — not a brainstorm-blocking ambiguity, since either choice is internally
  consistent; it just needs to be documented precisely enough for the human to mirror it.

## Gate

Recorded via:
`node "C:/dev/Orky/plugin/gatekeeper/cli.js" record --feature .orky/features/0014-orky-osc-heartbeat --gate brainstorm --verdict pass --evidence "human confirmed concept via /orky:app-run AskUserQuestion round (D1: Termhalla-side only this run; OSC emission on the Orky CLI side confirmed as a separate follow-up the human will implement against this feature's documented contract)"`
