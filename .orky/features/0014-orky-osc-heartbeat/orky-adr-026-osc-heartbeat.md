# Orky ADR-026 — OSC heartbeat (verbatim, as supplied by the human 2026-06-30)

This is the AUTHORITATIVE wire contract Orky's own CLI now emits. It supersedes this feature's
original D1 placeholder (OSC `8888`, semicolon key=value body) entirely — see ESC-001's resolution
in `state.json` for the binding loopback decision. Treat every byte of this document as ground
truth; do not re-derive or guess the format.

## Orky OSC heartbeat — status visible over a bare PTY (ADR-026)

Heartbeat/liveness (ADR-025, `docs/watchdog.md`) make a run's progress observable by reading
`.orky/active.json` — but that requires filesystem access to the project. Over a bare SSH session
(no Termhalla UI, no local mount of the remote `.orky/`), there is nothing to read. The OSC
heartbeat closes that gap: it broadcasts the same status as a raw terminal escape sequence on the
run's own stdout, so anything watching the PTY byte stream itself — a terminal emulator, a
multiplexer, a tail-like scanner — can render status without ever touching the filesystem.

This is the wire-format contract a terminal client (e.g. Termhalla) must match byte-for-byte to
parse it. It is opt-in, additive, and one-way: Orky never reads it back, and turning it off is a
zero-behavior-change no-op (consistent with every other opt-in surface in this project — feedback,
watchdog, compliance).

### What it is not

- Not a gate input. Nothing about a gate verdict is derived from this signal; it is purely cosmetic.
- Not a second writer of `.orky/active.json`. `heartbeat` (ADR-025) remains the only writer of that
  file. `osc-heartbeat` only *reads* state (`active.json` + the active feature's `state.json`) and
  re-derives status via the same deterministic `drive()` the orchestrator already uses — it never
  trusts a caller-supplied status, the same "ground truth, not self-report" discipline as everywhere
  else (ADR-004), applied even to a side channel nothing depends on.
- Not a control channel. It carries no command, decision, or write capability in either direction.

### Wire format

```
ESC ] 9999 ; <payload> BEL
```

- **Introducer:** `\x1b]` (`ESC` `]`), the standard OSC introducer.
- **Code:** `9999` — a private/unassigned code, chosen to avoid the well-known ranges in common use
  (`0`–`19` title/color queries, `52` clipboard, `104` color reset, `133` shell-integration prompt
  marks, `633` VS Code's shell-integration extension, `1337` iTerm2 proprietary). If a terminal you
  target already claims `9999`, change the single `OSC_CODE` constant in
  `plugin/gatekeeper/gatekeeper.js` and update this doc and every parser in the same change — this
  is a private two-repo contract, not a registered code.
- **Separator:** a single `;` immediately after the code. A parser MUST split on only the *first*
  `;` and treat everything after it, up to the terminator, as the opaque payload — the JSON payload
  itself may legitimately contain `;` characters (e.g. inside a `reason` string).
- **Payload:** a single-line, compact JSON object (no embedded newlines — `JSON.stringify` never
  emits one). See schema below.
- **Terminator:** `\x07` (`BEL`). (Not `ST` / `ESC \` — BEL is what's emitted; a parser should accept
  BEL and MAY additionally accept `ST` for robustness against a relay that rewrites terminators, but
  Orky only ever sends BEL.)

**Safety property:** `JSON.stringify` escapes every control character below `0x20` — including
`BEL` and `ESC` — as a `\uXXXX` escape. A `reason` or other string field can never contain a raw
control byte that would prematurely terminate or corrupt the sequence; this is guaranteed by the
JSON spec, not by ad-hoc sanitization, and is covered by a dedicated test
(`plugin/gatekeeper/test/osc-heartbeat.test.js`).

### Payload schema (`v: 1`)

| Field        | Type             | Always present? | Meaning |
|--------------|------------------|------------------|---------|
| `v`          | integer          | yes              | Schema version. Bump on any breaking change to this table; a parser should ignore unknown fields and tolerate a missing/older `v` gracefully rather than fail closed. |
| `feature`    | string           | only with a resolvable feature | The feature slug (`path.basename` of its directory, e.g. `0005-cross-project-orky-registry`). |
| `phase`      | string \| null   | only with a resolvable feature | The live phase: `state.json.phase` if set, else the gate-frontier phase `drive()` computes (mirrors the detection model Termhalla's status chip, feature `0004`, already established). |
| `gate`       | string           | only with a resolvable feature | `"<passed>/<total>"` — how many of the 8 work-phase gates (`brainstorm, spec, plan, tests, implement, review, doc-sync, human-review`) have passed. |
| `needsHuman` | boolean          | only with a resolvable feature | `true` when `drive()` returns `await-human` or `escalate` for this feature — i.e. autonomous work is blocked on a human decision. |
| `reason`     | string           | only when `needsHuman` is `true` *and* `drive()` returned one | Why — e.g. `"brainstorm is a human gate"`, `"blocked by 1 open escalation(s): ESC-001 — resolve first"`, `"iteration cap reached for implement (3/3)"`. |
| `action`     | string \| null   | only when NO feature is resolvable | The last heartbeat `action` note from `active.json` (or `null`) — a minimal "something is alive" signal for an app-loop tick with no single active feature. |

A minimal example with no resolvable feature:

```json
{"v":1,"action":"app-loop"}
```

A feature awaiting human review:

```json
{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":true,"reason":"human-review is a human gate"}
```

### When it fires

The orchestrator calls it immediately after the existing `heartbeat` stamp (`/orky:run`'s per-tick
heartbeat, and `/orky:app-run`'s app-loop heartbeat), **only when `config.heartbeat.osc` is `true`**
(default `false`, zero behavior change until a project opts in):

```
node "${CLAUDE_PLUGIN_ROOT}/gatekeeper/cli.js" osc-heartbeat --project <root> [--feature <dir>] [--config <path>]
```

Best-effort: it never throws, always exits `0`, and writes nothing to disk. If `--feature` is
omitted it falls back to whatever feature `.orky/active.json` last cached (so the app-level
"app-loop" tick — which has no single active feature — still emits a minimal signal rather than
nothing).

### Out of scope here (the emitter is Orky-side; the parser is not)

This document specifies what Orky **emits**. The corresponding **parser/renderer** is THIS feature
(`0014-orky-osc-heartbeat`), extending Termhalla's existing `osc-scanner` / OSC-133
shell-integration infrastructure to also recognize OSC `9999` and render the parsed payload.

## What this means for 0014's spec (binding, per ESC-001 resolution)

- Replace the entire prior OSC contract section (prefix `8888`, key=value body) with this document's
  contract verbatim: code `9999`, JSON payload, first-`;`-only split, BEL terminator (accept BEL,
  may also accept ST).
- The parser only ever needs to *read* this payload — never re-derive `drive()` semantics itself;
  treat `needsHuman`/`reason`/`phase`/`gate` as already-computed ground truth from Orky, the same
  "ground truth, not self-report" stance this whole pipeline already follows elsewhere — Termhalla
  is a thin client, full stop.
- An unknown/missing `v` or unknown extra fields must NOT be treated as a parse failure — ignore
  unknown fields, tolerate a missing/older `v`.
- Carry forward FINDING-SEC-001 as a binding REQ: the parser's no-terminator carry-over path MUST
  enforce an explicit bounded ceiling (do not rely on `scanOsc`'s carry-over alone, which is
  unbounded when a prefix appears but no terminator ever arrives).
- Carry forward FINDING-CODEX-001 as a binding REQ: whatever size/charset cap is applied to the
  payload must be measured correctly (actual byte length, not loosely-used JS string `.length`) —
  reframe this for a JSON payload (e.g. cap on the raw payload byte length pulled from the PTY
  buffer, before `JSON.parse`, not on a derived/re-encoded string).
- Now that Orky genuinely emits this signal, consider (spec-writer's call, not mandatory) ONE
  integration-style test that actually shells out to
  `node "C:/dev/Orky/plugin/gatekeeper/cli.js" osc-heartbeat --project . --config .orky/config.json`
  and feeds its real stdout through the parser, in addition to the synthetic/golden fixtures that
  remain the primary, deterministic test mechanism.
