// Synthetic/golden OSC byte fixtures for feature 0014-orky-osc-heartbeat (TASK-009 / REQ-010).
//
// PURE byte-string builders only — this file performs NO process/network/filesystem access, and must
// never gain any (REQ-010: every 0014 test constructs its marker bytes itself; zero live-Orky
// dependency). It deliberately does NOT import anything from `src/main/status/orky-osc-parser.ts` (the
// not-yet-implemented module under test) — the contract bytes below are reproduced independently, as a
// true "golden" fixture, so every phase-4 test file can build OSC marker bytes from the SAME source
// without coupling to the implementation.
//
// The 12-byte prefix + body grammar are copied byte-for-byte from `02-spec.md`'s "OSC marker CONTRACT"
// section (REQ-001/REQ-012).

/** The 12-byte contract prefix (REQ-001), reproduced here independently of the implementation. */
export const ORKY_OSC = '\x1b]8888;orky='
const BEL = '\x07'
const ST = '\x1b\\'

export type OrkyMarkerKey = 'v' | 'f' | 'k' | 'ph' | 'g' | 'm' | 'o' | 'h' | 'x' | 'r'
export type OrkyMarkerFields = Partial<Record<OrkyMarkerKey, string>>

/** Wrap an already-formed raw body string in the ORKY_OSC prefix + chosen terminator. The lowest-level
 *  builder — used for malformed/edge-case bodies (oversized, >32 pairs, garbage text, missing the
 *  prefix's required `orky=` sub-tag, etc.) that the typed builders below cannot express. */
export function wrapOrkyBody(body: string, terminator: 'BEL' | 'ST' = 'BEL'): string {
  return `${ORKY_OSC}${body}${terminator === 'BEL' ? BEL : ST}`
}

/** Join arbitrary key/value pairs (insertion order preserved) into a `;`-delimited body and wrap it.
 *  Unlike `buildOrkyMarker`, this is NOT restricted to the known grammar keys — it also accepts unknown
 *  keys (e.g. `z`) and lets a caller omit any "required" key, for grammar-violation fixtures (REQ-004). */
export function buildOrkyMarkerFromPairs(
  fields: Record<string, string | undefined>,
  terminator: 'BEL' | 'ST' = 'BEL'
): string {
  const body = Object.entries(fields)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${v}`)
    .join(';')
  return wrapOrkyBody(body, terminator)
}

/** Join the contract's known `key=value` pairs (insertion order preserved) into a marker, BEL- or
 *  ST-terminated. The common-path builder for well-formed markers (TASK-009's specified signature). */
export function buildOrkyMarker(fields: OrkyMarkerFields, terminator: 'BEL' | 'ST' = 'BEL'): string {
  return buildOrkyMarkerFromPairs(fields as Record<string, string | undefined>, terminator)
}

/** The spec's worked-example field set (02-spec.md "Worked example"), in the exact key order shown
 *  there. `buildOrkyMarker(WORKED_EXAMPLE_FIELDS)` MUST reproduce `WORKED_EXAMPLE_MARKER` byte-for-byte
 *  (asserted by TEST-001 in tests/main/orky-osc-parser.test.ts, which catches drift between the two). */
export const WORKED_EXAMPLE_FIELDS: OrkyMarkerFields = {
  v: '1', f: 'auth-login', k: 'busy', ph: 'implement', g: '5', m: '8', o: '2', h: '0', x: '0'
}

/** The exact worked-example marker bytes (BEL-terminated), copied byte-for-byte from 02-spec.md's
 *  "Worked example" section (REQ-001 acceptance). */
export const WORKED_EXAMPLE_MARKER =
  '\x1b]8888;orky=v=1;f=auth-login;k=busy;ph=implement;g=5;m=8;o=2;h=0;x=0\x07'

/** The decoded heartbeat the worked-example marker MUST yield (02-spec.md REQ-001 acceptance) — the
 *  exact shape of `OrkyHeartbeat` (feature/kind/phase/gateN/gateM/openBlocking/needsHuman/failed/reason). */
export const WORKED_EXAMPLE_HEARTBEAT = {
  feature: 'auth-login',
  kind: 'busy',
  phase: 'implement',
  gateN: 5,
  gateM: 8,
  openBlocking: 2,
  needsHuman: false,
  failed: false,
  reason: null
}
