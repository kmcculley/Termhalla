# 0014 — Orky OSC heartbeat parse + render (read)

## Phase 0 — Intake

**Status:** intake captured — brainstorm complete, see `01-concept.md`.

**Source:** `.orky/roadmap.json` / `roadmap.md`, feature `F14`, scaffolded by `/orky:app-run`.

### Roadmap entry (verbatim)

> **Title:** Orky OSC heartbeat parse + render (read)
>
> **Summary:** Parse Orky status/heartbeat OSC markers out of the PTY byte stream (extending the
> existing osc-scanner / osc133 infra) so an Orky run's status is visible over a bare SSH/remote
> pane where the `.orky/` tree is not filesystem-reachable, rendered through the same orky-status
> presentation as 0004.
>
> **Deps:** none (independent — extends 0004's OSC infra directly, not the F5 registry).

### Role in the app

Tier **T4**. 0004 and F5/F9 all require *filesystem* access to `.orky/` (chokidar watching local
files). Over a bare SSH pane, Termhalla only ever sees the remote PTY's byte stream — there is no
local `.orky/` to read. F14 gives that case a status signal too, by parsing a deliberate OSC marker
out of the stream instead of reading files, and rendering it through the same presentation layer
0004 already built (`OrkyPaneStatus` → toolbar chip / border / tab badge).

### Tech stack

Same as F5 (see its `00-intake.md`). The relevant existing infra:
- `src/main/status/osc-scanner.ts` — `scanOsc(buf, prefix, onBody)`: generic OSC body scanner
  (accumulate / find-prefix / locate-terminator / slice-body / carry-over-partial), already shared
  by `Osc133Parser` (shell-integration, prefix `\x1b]133;`) and `CwdParser` (prefix `\x1b]7;` /
  `\x1b]9;9;`, per CLAUDE.md's cwd-awareness doc).
- `src/main/status/osc133-parser.ts`, `cwd-parser.ts` — the two existing consumers of `scanOsc`;
  F14's new parser is structurally a third (new prefix, new body grammar).
- `src/shared/orky-status.ts` / `OrkyPaneStatus` — 0004's presentation-layer status shape and
  mappers; F14 must render through this SAME type (not invent a parallel one), per the roadmap
  summary's "rendered through the same orky-status presentation as 0004."

### Brainstorm decision (binding — see `01-concept.md`) — SCOPE-CRITICAL

Confirmed by grepping `C:/dev/Orky/plugin`: **Orky's CLI today emits no OSC escape sequence at
all.** "Parse" alone has nothing real to consume yet over a genuine remote SSH pane.

**D1 — Termhalla-side only, this run.** F14 builds:
1. A documented OSC marker **contract** (prefix, body grammar/encoding) in `02-spec.md` — this is
   the part the Orky side must match byte-for-byte.
2. The Termhalla parser (extends `osc-scanner.ts`) + renderer (maps the parsed marker to
   `OrkyPaneStatus`, reusing 0004's presentation) — tested against **synthetic/golden OSC byte
   fixtures** the test suite constructs itself, with zero dependency on a live Orky process.

The matching **emission** change — making Orky's own CLI (heartbeat/`drive` loop, in the *separate*
`C:/dev/Orky` repo) actually print this marker to stdout when running inside a PTY — is **explicitly
out of scope for this Termhalla feature pipeline** (different repo, different Orky gate profile,
not something `/orky:app-run` here can build or gate). The human (Kevin) confirmed he will implement
it separately against the contract this feature defines. **Doc-sync must surface the exact contract
prominently** (format + the file/line it's defined at) so that follow-up is actionable.

Until the Orky-side emission exists, this feature is real and tested but **dark in production** —
a bare SSH pane running an unmodified Orky CLI shows no status (same as today), not a false one.

### Out of scope for F14

- Any change to `C:/dev/Orky` (the emission side) — tracked as a follow-up for the human, not built
  here.
- Anything beyond a bare-SSH/no-filesystem-access scenario — local panes keep using 0004's
  filesystem-watching `OrkyTracker` unchanged; F14 must not regress or duplicate that path for
  panes where `.orky/` IS filesystem-reachable.
