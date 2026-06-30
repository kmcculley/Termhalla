// Synthetic/golden OSC byte fixtures for feature 0014-orky-osc-heartbeat (REQ-014).
//
// REWRITTEN against the REAL, shipped wire contract — Orky ADR-026 (introducer `\x1b]`, code `9999`,
// single `;` separator, single-line compact JSON payload, BEL terminator, MAY also accept ST) — which
// supersedes this feature's earlier, now-superseded placeholder (OSC `8888`, `;`-delimited key=value
// body, see ESC-001 in `state.json`). ALL bytes below are reproduced from `orky-adr-026-osc-heartbeat.md`
// / `02-spec.md`'s "OSC marker CONTRACT" section, never re-derived.
//
// PURE byte-string builders only — this file performs NO process/network/filesystem access, and must
// never gain any (REQ-014: every 0014 test constructs its marker bytes itself; zero live-Orky
// dependency). It deliberately does NOT import anything from `src/main/status/orky-osc-parser.ts` (the
// not-yet-implemented module under test) — the contract prefix/terminator bytes below are reproduced
// independently, as a true "golden" fixture, so every phase-4 test file can build OSC marker bytes from
// the SAME source without coupling to the implementation. (The one exception is `ORKY_PHASES` from
// `@shared/orky-status` — that module is PRE-EXISTING, Electron-free, pure shared code from feature 0004,
// not part of this not-yet-implemented feature, so importing it to compute the app-loop heartbeat's
// default `gateM` does not violate the "independent of the implementation" intent.)

import { ORKY_PHASES } from '@shared/orky-status'

/** The ADR-026 contract prefix (REQ-001): introducer `\x1b]` + code `9999` + the single `;` separator.
 *  `scanOsc`'s literal prefix match on this string is what implements "split on the FIRST `;` only" —
 *  everything after it, up to the terminator, is the opaque JSON payload (the payload may itself contain
 *  `;` characters, e.g. inside a `reason` string). Reproduced here independently of the implementation. */
export const ORKY_OSC = '\x1b]9999;'

export const BEL = '\x07'
export const ST = '\x1b\\'

/** Wrap an already-formed raw payload string (JSON or deliberately-not-JSON, for malformed/edge-case
 *  fixtures) in the ORKY_OSC prefix + chosen terminator. The lowest-level builder. */
export function wrapOrkyPayload(rawPayload: string, terminator: 'BEL' | 'ST' = 'BEL'): string {
  return `${ORKY_OSC}${rawPayload}${terminator === 'BEL' ? BEL : ST}`
}

/** Build a well-formed marker from a JS value via `JSON.stringify` (ADR-026's "single-line compact JSON
 *  object" payload), BEL- or ST-terminated. The common-path builder for valid markers. */
export function buildOrkyMarker(payload: unknown, terminator: 'BEL' | 'ST' = 'BEL'): string {
  return wrapOrkyPayload(JSON.stringify(payload), terminator)
}

// ── Malformed / edge-case payload builders (REQ-005/REQ-008) ───────────────────────────────────────
/** A payload that is not valid JSON at all (REQ-008's "malformed JSON" acceptance). */
export const MALFORMED_JSON_MARKER = wrapOrkyPayload('not json')

/** A payload that IS valid JSON but not an object (array/string/number/boolean/null — REQ-008's
 *  "non-object JSON payload" acceptance). One marker per JSON primitive kind. */
export const NON_OBJECT_JSON_MARKERS: Record<string, string> = {
  array: buildOrkyMarker([1, 2, 3]),
  string: buildOrkyMarker('just a string'),
  number: buildOrkyMarker(42),
  boolean: buildOrkyMarker(true),
  null: buildOrkyMarker(null)
}

/** An empty payload (REQ-008's "empty payload" acceptance). */
export const EMPTY_PAYLOAD_MARKER = wrapOrkyPayload('')

// ── Worked examples (ADR-026 / 02-spec.md, reproduced byte-for-byte) ───────────────────────────────
/** The minimal app-loop tick — no resolvable feature, carries `action` instead (REQ-011). */
export const APP_LOOP_PAYLOAD = { v: 1, action: 'app-loop' } as const
export const APP_LOOP_MARKER = buildOrkyMarker(APP_LOOP_PAYLOAD)
/** Verbatim byte string from ADR-026 / 02-spec.md — catches drift between the hand-copied literal and
 *  the builder above (both independently reproduced from the spec). */
export const APP_LOOP_MARKER_LITERAL = '\x1b]9999;{"v":1,"action":"app-loop"}\x07'
export const APP_LOOP_HEARTBEAT = {
  feature: null, phase: null, gateN: 0, gateM: ORKY_PHASES.length, needsHuman: false, reason: null, action: 'app-loop'
}

/** A feature awaiting human review (ADR-026 / 02-spec.md's other worked example). */
export const AWAITING_HUMAN_PAYLOAD = {
  v: 1,
  feature: '0004-orky-status-awareness',
  phase: 'human-review',
  gate: '7/8',
  needsHuman: true,
  reason: 'human-review is a human gate'
} as const
export const AWAITING_HUMAN_MARKER = buildOrkyMarker(AWAITING_HUMAN_PAYLOAD)
/** Verbatim byte string from ADR-026 / 02-spec.md. */
export const AWAITING_HUMAN_MARKER_LITERAL =
  '\x1b]9999;{"v":1,"feature":"0004-orky-status-awareness","phase":"human-review","gate":"7/8","needsHuman":true,"reason":"human-review is a human gate"}\x07'
export const AWAITING_HUMAN_HEARTBEAT = {
  feature: '0004-orky-status-awareness', phase: 'human-review', gateN: 7, gateM: 8,
  needsHuman: true, reason: 'human-review is a human gate', action: null
}

/** A plain busy heartbeat — REQ-009's acceptance worked example. */
export const BUSY_PAYLOAD = {
  v: 1, feature: 'auth-login', phase: 'implement', gate: '5/8', needsHuman: false
} as const
export const BUSY_MARKER = buildOrkyMarker(BUSY_PAYLOAD)
export const BUSY_HEARTBEAT = {
  feature: 'auth-login', phase: 'implement', gateN: 5, gateM: 8, needsHuman: false, reason: null, action: null
}

/** A busy heartbeat whose `phase` is `null` but whose gates are NOT all passed (`gateN < gateM`) — the
 *  FINDING-DA-004 regression guard (spec iteration 3 / ESC-002): `phase` being `null` must NOT, by
 *  itself, trigger `kind === 'done'`. Only gate fullness (`gateN >= gateM`) may do that. This is the
 *  inverse edge of `DONE_PAYLOAD`/`DONE_HEARTBEAT` below — same `phase: null`, but incomplete gates — and
 *  pins the half of the old (corrected) buggy rule (`phase == null && gateN >= gateM`) that this fixture
 *  alone can catch: a regression back to reading `phase` in the `kind` derivation at all. */
export const BUSY_PHASE_NULL_PAYLOAD = {
  v: 1, feature: 'auth-login', phase: null, gate: '5/8', needsHuman: false
} as const
export const BUSY_PHASE_NULL_MARKER = buildOrkyMarker(BUSY_PHASE_NULL_PAYLOAD)
export const BUSY_PHASE_NULL_HEARTBEAT = {
  feature: 'auth-login', phase: null, gateN: 5, gateM: 8, needsHuman: false, reason: null, action: null
}

/** The complete-feature PRIMARY acceptance example (REQ-009, spec iteration 3 / ESC-002): the REAL
 *  Orky emitter's actual shape for a genuinely finished feature — `phase: "doc-sync"`, never `null`
 *  (`gatekeeper.js:904`'s `state.phase || d.phase || null`; `human-review` is a separate external gate
 *  never written into `state.json.phase`). Done-detection is purely gate-based
 *  (`gateN >= gateM`) and MUST NOT key off `phase` — this fixture is the one that catches a regression
 *  back to the prior iteration's wrong `phase == null AND gateN >= gateM` rule (FINDING-DA-004), since
 *  that rule can never fire against this real-emitter shape. */
export const DONE_DOC_SYNC_PAYLOAD = {
  v: 1, feature: 'auth-login', phase: 'doc-sync', gate: '8/8', needsHuman: false
} as const
export const DONE_DOC_SYNC_MARKER = buildOrkyMarker(DONE_DOC_SYNC_PAYLOAD)
export const DONE_DOC_SYNC_HEARTBEAT = {
  feature: 'auth-login', phase: 'doc-sync', gateN: 8, gateM: 8, needsHuman: false, reason: null, action: null
}

/** A complete (all gates passed) heartbeat with `phase: null` — REQ-009's PHASE-INDEPENDENCE companion
 *  example (no longer the sole "done" case — see `DONE_DOC_SYNC_HEARTBEAT` above for the PRIMARY,
 *  real-emitter-shaped example). Proves the gate-based done-rule fires identically regardless of
 *  `phase`'s value: this heartbeat and `DONE_DOC_SYNC_HEARTBEAT` differ ONLY in `phase` and MUST map to
 *  the identical `kind === 'done'` clean roll-up. */
export const DONE_PAYLOAD = {
  v: 1, feature: 'auth-login', phase: null, gate: '8/8', needsHuman: false
} as const
export const DONE_MARKER = buildOrkyMarker(DONE_PAYLOAD)
export const DONE_HEARTBEAT = {
  feature: 'auth-login', phase: null, gateN: 8, gateM: 8, needsHuman: false, reason: null, action: null
}
