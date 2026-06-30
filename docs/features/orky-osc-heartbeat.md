# Orky OSC heartbeat (stream-derived status)

A **second source** of the Orky pane chip (see [orky-status](orky-status.md)): instead of watching a
project's `.orky/` tree on disk, this feature parses a small OSC marker out of the PTY's own byte
stream. It exists for the case `orky-status.md`'s filesystem watcher cannot cover — a **bare-SSH pane**
(no local `.orky/` tree the host can see) whose remote shell happens to print this marker. The
**filesystem source always wins** when it has an opinion; the stream source is a fallback only
(`selectOrkyPaneStatus`, REQ-009).

This feature is **Termhalla-side only**. It defines and parses the marker; nothing in this repo emits
it. See "Out of scope: Orky-side emission" below.

## OSC marker CONTRACT (authoritative — copy byte-for-byte to the Orky side)

> Defined in [`src/main/status/orky-osc-parser.ts`](../../src/main/status/orky-osc-parser.ts)
> (`ORKY_OSC` the prefix constant, `decodeHeartbeat` the body grammar/decoder — not exported, reached
> only through `OrkyOscParser.push`). This is the exact interface a human must implement on the
> separate `C:/dev/Orky` CLI (see "Out of scope" below) — reproduced here byte-for-byte from
> `.orky/features/0014-orky-osc-heartbeat/02-spec.md`'s "OSC marker CONTRACT" section.

### Full sequence

```
ESC ] 8 8 8 8 ; o r k y = <body> <terminator>
```

i.e. the exact byte string:

```
\x1b]8888;orky=<body>\x07      (BEL-terminated)
\x1b]8888;orky=<body>\x1b\\    (ST-terminated — equally valid)
```

### Prefix (exact bytes)

`\x1b ] 8 8 8 8 ; o r k y =`  →  `\x1b]8888;orky=` (12 bytes).

- OSC code `8888` is outside every OSC number known to be assigned by common terminals/tools (0–119
  standard, 133 FinalTerm/shell-integration, 633 VS Code, 777 urxvt, 1337 iTerm2). It does not collide
  with this codebase's other OSC consumers: `Osc133Parser` (`\x1b]133;`) or `CwdParser`
  (`\x1b]7;` / `\x1b]9;9;`).
- The mandatory literal sub-tag `orky=` is the real namespacing guarantee: even if some unknown terminal
  reused code `8888`, its body would not begin with `orky=` and would be rejected.

### Terminator

`BEL` (`\x07`) **or** `ST` (`\x1b\\`) — whichever the emitter prefers; both are accepted (the shared
`scanOsc` scanner already handles both). The body encoding below is chosen so the body can **never**
itself contain `\x07` or `\x1b`, so the first terminator byte after the prefix unambiguously ends the
marker.

### Body grammar

The body (everything between `orky=` and the terminator) is a **compact, order-independent list of
`key=value` pairs joined by `;`**:

```
v=1;f=<slug>;k=<kind>;ph=<phase>;g=<int>;m=<int>;o=<int>;h=<0|1>;x=<0|1>;r=<reason>
```

| key  | meaning                | value grammar                                                              | required |
|------|------------------------|------------------------------------------------------------------------------|----------|
| `v`  | schema version         | the literal `1` (other versions are ignored — forward-compat)               | yes      |
| `f`  | feature slug           | `[A-Za-z0-9._-]{1,64}`                                                       | yes      |
| `k`  | kind                   | one of `busy` \| `idle` \| `needs-input` \| `done`                          | yes      |
| `ph` | live phase             | one of `OrkyPhase` (`brainstorm`…`human-review`) **or** `done`              | yes      |
| `g`  | gates passed (N)       | integer, `0 ≤ g ≤ m`                                                         | yes      |
| `m`  | total gates (M)        | integer, `1 ≤ m ≤ 32` (expected `8`; see drift caveat below)                | yes      |
| `o`  | open-blocking findings | integer, `0 ≤ o ≤ 9999`                                                      | yes      |
| `h`  | needs a human          | `0` or `1`                                                                  | yes      |
| `x`  | failed (halted gate)   | `0` or `1`                                                                  | yes      |
| `r`  | needs-you reason       | one of `escalation` \| `stalled` \| `human-review`; omit/empty = none       | no       |

- Values are the **already-derived** status fields (not a `.orky/` dump): Orky computes them on its side
  and emits a heartbeat for the **currently-driving (active) feature** only. The Termhalla parser does no
  pipeline re-derivation on untrusted bytes — it validates each field against the table above and maps
  directly.
- Every legal byte above is printable ASCII in `[A-Za-z0-9._;=-]`; none is `\x07` or `\x1b`, so the body
  can never contain a terminator.
- **Total body length cap: 256 bytes** and **at most 32 pairs**. Unknown keys are ignored
  (forward-compat); a marker missing any required key, or with any value outside its grammar, or over
  the cap, is **rejected whole** (yields no status — never a partial render, never a silently-clamped
  value).

### Worked example

```
\x1b]8888;orky=v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0\x07
```

decodes to `{ feature:'auth-login', kind:'busy', phase:'implement', gateN:5, gateM:8, openBlocking:2,
needsHuman:false, failed:false, reason:null }`, which maps to an `OrkyPaneStatus` whose
`label === "auth-login · implement · 5/8 · ●2 open"` — identical to what `orky-status.md` renders for
the same feature via the filesystem path.

## Out of scope: Orky-side emission (human follow-up)

This feature does **not** change anything in the separate `C:/dev/Orky` repository (the emission side
that would make Orky's CLI print this marker). That work is an explicit, documented follow-up for a
human to implement against the contract above. **Until it exists, this feature is real and tested but
dark in production**: a bare-SSH pane running an unmodified Orky CLI shows no Orky status — same as
today — never a false one. The Termhalla code in this feature only reads/parses; it emits nothing into
any stream.

## Cross-repo drift caveat (doc-provenance)

The contract above is a **cross-repo agreement** with the separate `C:/dev/Orky` CLI. Termhalla parses
it here; a human must emit it byte-for-byte on the Orky side, and the two sides can silently drift over
time. Specifically:

- The `ph` (phase) and `r` (reason) enums **mirror** `src/shared/orky-status.ts`'s `OrkyPhase` /
  `OrkyReason` (imported, never forked — `src/main/status/orky-osc-parser.ts` imports both from
  `@shared/types` rather than redefining them) and Orky's own pipeline phase/reason concepts.
- The carried `m` (gateM) is **expected** to equal `ORKY_PHASES.length` (`8`, per the provenance caveat
  in [orky-status.md](orky-status.md#data-provenance-the-orky_phases-drift-caveat)) — a divergence is a
  coordinated two-repo data-update, never something a Termhalla test can catch.
- Every test for this feature constructs its OSC marker bytes itself (`tests/fixtures/orky-osc-fixtures.ts`)
  against THIS embedded contract; none of them exercise a live Orky process. Tests therefore verify only
  that the Termhalla code matches the contract as documented here and in `02-spec.md` — not that the real
  Orky CLI matches it.

## Architecture

| Concern | Location |
|---|---|
| OSC prefix constant, body-grammar decoder, stateful parser (3rd `scanOsc` consumer) | `src/main/status/orky-osc-parser.ts` |
| Heartbeat wire type (`OrkyHeartbeat`) | `src/shared/types.ts` |
| Heartbeat → `OrkyPaneStatus` mapper (reuses 0004's `orkyPaneStatus`), fs-vs-stream precedence | `src/shared/orky-status.ts` (`orkyHeartbeatToPaneStatus`, `selectOrkyPaneStatus`) |
| Wiring into the per-pane PTY pipeline (`onOrkyHeartbeat` callback, mirrors `CwdParser`/`onCwd`) | `src/main/status/status-engine.ts` |
| Per-pane filesystem/stream combine + emit over the existing `orky:status` channel | `src/main/orky/orky-stream-status.ts` (`OrkyStreamStatusBridge`) |
| Composition: `OrkyTracker`'s emit routed through the bridge; `StatusEngine`'s heartbeat callback routed through the bridge | `src/main/ipc/register.ts` |
| Synthetic/golden OSC byte fixtures (zero live-Orky dependency) | `tests/fixtures/orky-osc-fixtures.ts` |

`src/main/orky/orky-tracker.ts` (the filesystem watcher from `orky-status.md`) is **unmodified** by this
feature — it remains the sole authority for any pane whose `.orky/` tree is filesystem-reachable, and
this feature never duplicates its watch or starts a `.orky/` filesystem watch of its own. No new IPC
channel, no new pane-status wire type, and no `SCHEMA_VERSION` bump: the stream-derived status rides the
existing `orky:status` push channel and feature 0004's renderer presentation unchanged.
