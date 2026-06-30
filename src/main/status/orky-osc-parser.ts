// Orky OSC heartbeat parser (feature 0014-orky-osc-heartbeat). A THIRD consumer of the shared
// `scanOsc` accumulate/find-prefix/locate-terminator/slice-body/trim-carryover loop, mirroring
// `Osc133Parser`/`CwdParser` (REQ-002): this file owns only the new prefix + the per-body decode,
// never a reimplementation of that scan loop (no independent BEL/ST terminator-scanning code).
//
// OSC marker CONTRACT (authoritative copy lives in 02-spec.md / docs/features/orky-osc-heartbeat.md —
// REQ-001/REQ-012). Full sequence: `\x1b]8888;orky=<body><BEL|ST>`. The 12-byte prefix `ORKY_OSC`
// below does not collide with `\x1b]133;` (Osc133Parser), `\x1b]7;`, or `\x1b]9;9;` (CwdParser).
//
// Body grammar (`;`-delimited key=value pairs, order-independent):
//   v=1;f=<slug>;k=<kind>;ph=<phase>;g=<int>;m=<int>;o=<int>;h=<0|1>;x=<0|1>;r=<reason>
// `decodeHeartbeat` is a STRICT, bounded, non-evaluating validator (REQ-004 / security): no
// `eval`/`Function`/dynamic interpretation anywhere, direct enum/range checks only, and any
// violation rejects the WHOLE marker (never a partial decode, never a silently-clamped value —
// CONV-003). `push` is total: it never throws on garbage/partial/oversized input (REQ-005).
import { scanOsc } from './osc-scanner'
import type { OrkyHeartbeat, OrkyPhase, OrkyReason } from '@shared/types'
import { ORKY_PHASES } from '@shared/orky-status'

/** Re-export of the shared `OrkyHeartbeat` wire type (declared in `@shared/types` — see that file's
 *  comment for why — so this module's documented public-interface surface still exposes it
 *  alongside `ORKY_OSC`/`OrkyOscParser`, matching 02-spec.md's "Public interface" section). */
export type { OrkyHeartbeat } from '@shared/types'

/** The 12-byte contract prefix (REQ-001) — chosen to collide with no in-repo or real-terminal OSC
 *  prefix. The mandatory `orky=` sub-tag is the real namespacing guarantee (REQ-001). */
export const ORKY_OSC = '\x1b]8888;orky='

const MAX_BODY_BYTES = 256
const MAX_PAIRS = 32

const KIND_VALUES = new Set<string>(['busy', 'idle', 'needs-input', 'done'])
const PHASE_VALUES = new Set<string>([...ORKY_PHASES, 'done'])
const REASON_VALUES = new Set<string>(['escalation', 'stalled', 'human-review'])
const FEATURE_RE = /^[A-Za-z0-9._-]{1,64}$/
const NON_NEGATIVE_INT_RE = /^\d+$/

const REQUIRED_KEYS = ['f', 'k', 'ph', 'g', 'm', 'o', 'h', 'x'] as const

/** Parse a strictly non-negative decimal integer (no sign, no fraction). `undefined`/non-matching
 *  input -> `null`, never a thrown error or a `NaN` that silently propagates. */
function parseNonNegativeInt(raw: string | undefined): number | null {
  if (raw === undefined || !NON_NEGATIVE_INT_RE.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

/** Strict, bounded, non-evaluating decode of one OSC body into an `OrkyHeartbeat`, or `null` when
 *  ANY part of the grammar is violated — the whole marker is rejected, never partially decoded
 *  (REQ-004). Direct string parsing only: no `eval`/`Function`/`JSON.parse`/dynamic interpretation. */
function decodeHeartbeat(body: string): OrkyHeartbeat | null {
  if (body.length === 0 || body.length > MAX_BODY_BYTES) return null

  const pairs = body.split(';')
  if (pairs.length > MAX_PAIRS) return null

  const fields: Record<string, string> = {}
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    if (eq === -1) return null // every pair must be key=value
    fields[pair.slice(0, eq)] = pair.slice(eq + 1)
  }

  // v: schema version. Anything other than the literal '1' (including missing) -> reject whole
  // (forward-compat is "ignore the whole marker", never "decode anyway").
  if (fields.v !== '1') return null

  for (const key of REQUIRED_KEYS) {
    if (fields[key] === undefined) return null
  }

  const f = fields.f
  if (!FEATURE_RE.test(f)) return null

  const k = fields.k
  if (!KIND_VALUES.has(k)) return null

  const ph = fields.ph
  if (!PHASE_VALUES.has(ph)) return null

  const g = parseNonNegativeInt(fields.g)
  const m = parseNonNegativeInt(fields.m)
  const o = parseNonNegativeInt(fields.o)
  if (g === null || m === null || o === null) return null
  if (m < 1 || m > 32) return null
  if (g < 0 || g > m) return null
  if (o < 0 || o > 9999) return null

  const h = fields.h
  const x = fields.x
  if (h !== '0' && h !== '1') return null
  if (x !== '0' && x !== '1') return null

  let reason: OrkyReason = null
  if (fields.r !== undefined && fields.r !== '') {
    if (!REASON_VALUES.has(fields.r)) return null
    reason = fields.r as Exclude<OrkyReason, null>
  }

  // Unknown keys (anything not in REQUIRED_KEYS ∪ {v, r}) are read-and-discarded, not rejecting
  // (forward-compat) — `fields` is never re-emitted wholesale, only the validated keys above.

  return {
    feature: f,
    kind: k as OrkyHeartbeat['kind'],
    phase: ph as OrkyPhase | 'done',
    gateN: g,
    gateM: m,
    openBlocking: o,
    needsHuman: h === '1',
    failed: x === '1',
    reason
  }
}

/** Stateful scanner: feed PTY output chunks, get validated heartbeats back. Keeps a small
 *  carry-over buffer (via `scanOsc`) so a marker split across chunks still parses (REQ-002/003).
 *  `push` never throws (REQ-005): a rejected/garbage marker's bytes are still fully consumed by
 *  `scanOsc` (it advances past the terminator regardless of whether the body decoded), so a
 *  subsequent valid marker — same chunk or a later one — still parses cleanly. */
export class OrkyOscParser {
  private buf = ''

  push(chunk: string): OrkyHeartbeat[] {
    this.buf += chunk
    const heartbeats: OrkyHeartbeat[] = []
    this.buf = scanOsc(this.buf, ORKY_OSC, body => {
      const hb = decodeHeartbeat(body)
      if (hb) heartbeats.push(hb)
    })
    return heartbeats
  }
}
