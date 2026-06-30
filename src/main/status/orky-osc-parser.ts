// Orky OSC heartbeat parser (feature 0014-orky-osc-heartbeat). A THIRD consumer of the shared
// `scanOsc` accumulate/find-prefix/locate-terminator/slice-body/trim-carryover loop, mirroring
// `Osc133Parser`/`CwdParser` (REQ-002): this file owns only the new prefix + the per-payload decode,
// never a reimplementation of that scan loop (no independent BEL/ST terminator-scanning code).
//
// OSC marker CONTRACT (authoritative — Orky ADR-026, reproduced verbatim in
// `.orky/features/0014-orky-osc-heartbeat/orky-adr-026-osc-heartbeat.md` / `02-spec.md` /
// `docs/features/orky-osc-heartbeat.md` — REQ-001/REQ-012). Full sequence:
//   ESC ] 9999 ; <payload> BEL        (BEL-terminated — what Orky actually sends)
//   ESC ] 9999 ; <payload> ESC \      (ST-terminated — accepted for robustness, not emitted)
// `ORKY_OSC` below is the introducer + code `9999` + the single `;` separator. Because `scanOsc`
// matches this literal prefix and then scans only for the terminator, the "split on the FIRST `;`
// only" rule is inherited for free — `scanOsc` never looks past the matched prefix for a second `;`,
// so the JSON payload may itself legitimately contain `;` (e.g. inside a `reason` string). Does not
// collide with `\x1b]133;` (Osc133Parser), `\x1b]7;`, or `\x1b]9;9;` (CwdParser).
//
// Payload: a single-line compact JSON object (`v`/`feature`/`phase`/`gate`/`needsHuman`/`reason`/
// `action` — see the contract doc for the full schema table). `decodeHeartbeat` is a STRICT but
// FORWARD-COMPATIBLE, non-evaluating validator (REQ-004/REQ-005/REQ-008 / security): `JSON.parse` is
// the only parse primitive, always try/catch-guarded so a syntax error never throws; an unknown or
// missing `v` and unknown extra fields are NOT rejections (REQ-005, a deliberate reversal of the
// superseded iteration's strict `v !== '1' -> reject whole` policy); `needsHuman`/`reason`/`phase`/
// `gate` are mapped VERBATIM from the payload, never re-derived (Termhalla is a thin client — Orky's
// `drive()` is the sole authority). `push` is total: it never throws on garbage/partial/oversized
// input.
import { scanOsc } from './osc-scanner'
import type { OrkyHeartbeat } from '@shared/types'
import { ORKY_PHASES } from '@shared/orky-status'

/** Re-export of the shared `OrkyHeartbeat` wire type (declared in `@shared/types` — see that file's
 *  comment for why — so this module's documented public-interface surface still exposes it
 *  alongside `ORKY_OSC`/`OrkyOscParser`, matching 02-spec.md's "Public interface" section). */
export type { OrkyHeartbeat } from '@shared/types'

/** The ADR-026 contract prefix (REQ-001): introducer `\x1b]` + code `9999` + the single `;`
 *  separator. `scanOsc`'s literal prefix match on this string is what implements "split on the
 *  FIRST `;` only" — everything after it, up to the terminator, is the opaque JSON payload. */
export const ORKY_OSC = '\x1b]9999;'

/** Maximum payload size, measured as ACTUAL UTF-8 byte length (REQ-007, FINDING-CODEX-001) — never
 *  the JS string `.length` (UTF-16 code units), and checked strictly before any `JSON.parse` call.
 *  4096 bytes is generous enough for a realistic heartbeat payload (including a long free-form
 *  `reason` string) while bounding worst-case per-marker decode work. */
export const MAX_PAYLOAD_BYTES = 4096

/** Maximum retained no-terminator carry-over buffer, measured the same byte-accurate way (REQ-006,
 *  FINDING-SEC-001). MUST exceed the longest possible LEGAL marker — `ORKY_OSC` + the largest legal
 *  payload (`MAX_PAYLOAD_BYTES`) + the longest terminator (`ST`, 2 bytes) — so no in-flight valid
 *  marker is ever dropped by the ceiling; this is layered on top of `scanOsc`'s own carry-over, which
 *  is itself unbounded when a prefix appears but no terminator ever arrives. 8192 is comfortably
 *  above `ORKY_OSC.length + MAX_PAYLOAD_BYTES + 2` (≈4105) with headroom to spare. */
export const MAX_PENDING_BYTES = 8192

/** Parse Orky's `"<N>/<M>"` gate fraction. A missing/malformed value defaults to `gateN=0`,
 *  `gateM=ORKY_PHASES.length` rather than rejecting the whole heartbeat (REQ-008's "sparse by
 *  design" stance — `gate` is only ever absent for an app-loop tick, never a sign of corruption). */
function parseGateFraction(raw: unknown): { n: number; m: number } {
  const fallback = { n: 0, m: ORKY_PHASES.length }
  if (typeof raw !== 'string') return fallback
  const m = /^(\d+)\/(\d+)$/.exec(raw)
  if (!m) return fallback
  const n = Number(m[1])
  const total = Number(m[2])
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(total)) return fallback
  return { n, m: total }
}

/** Strict-but-tolerant, non-evaluating decode of one OSC payload into an `OrkyHeartbeat`, or `null`
 *  when the payload is over-cap, empty, malformed JSON, or non-object JSON (REQ-007/REQ-008). The
 *  byte-length cap (REQ-007) is checked FIRST, before `JSON.parse` ever runs. `JSON.parse` is the
 *  ONLY parse primitive — no `eval`/`Function`/dynamic interpretation anywhere (REQ-004). An
 *  unknown/missing `v` and unknown extra fields are NOT rejections (REQ-005); `needsHuman`/`reason`/
 *  `phase`/`gate` map verbatim from the payload (REQ-004 — never "corrected" against Termhalla's own
 *  gate logic). */
function decodeHeartbeat(payload: string): OrkyHeartbeat | null {
  // REQ-007: measured as ACTUAL UTF-8 byte length, before JSON.parse. Also covers the "empty
  // payload" rejection (REQ-008) — a 0-byte payload fails this same guard.
  const byteLen = Buffer.byteLength(payload, 'utf8')
  if (byteLen === 0 || byteLen > MAX_PAYLOAD_BYTES) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return null // malformed JSON -> no heartbeat, never throw (REQ-008)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null // non-object JSON (REQ-008)

  const o = parsed as Record<string, unknown>
  const { n: gateN, m: gateM } = parseGateFraction(o.gate)

  return {
    feature: typeof o.feature === 'string' ? o.feature : null,
    phase: typeof o.phase === 'string' ? o.phase : null,
    gateN,
    gateM,
    needsHuman: o.needsHuman === true,
    reason: typeof o.reason === 'string' ? o.reason : null,
    action: typeof o.action === 'string' ? o.action : null
  }
}

/** Stateful scanner: feed PTY output chunks, get validated heartbeats back. Keeps a BOUNDED
 *  carry-over buffer (`MAX_PENDING_BYTES`, REQ-006) so a marker split across chunks still parses
 *  without unbounded growth — `scanOsc`'s own carry-over alone is unbounded when a prefix appears but
 *  no terminator ever arrives, so this is an explicit ceiling layered on top of it, not a change to
 *  `scanOsc` itself (which stays shared with `Osc133Parser`/`CwdParser`). `push` never throws
 *  (REQ-008): a rejected/garbage marker's bytes are still fully consumed by `scanOsc` (it advances
 *  past the terminator regardless of whether the payload decoded), so a subsequent valid marker —
 *  same chunk or a later one — still parses cleanly. */
export class OrkyOscParser {
  private buf = ''

  push(chunk: string): OrkyHeartbeat[] {
    this.buf += chunk
    const heartbeats: OrkyHeartbeat[] = []
    this.buf = scanOsc(this.buf, ORKY_OSC, payload => {
      const hb = decodeHeartbeat(payload)
      if (hb) heartbeats.push(hb)
    })
    // REQ-006: explicit bounded ceiling on the no-terminator carry-over path, separate from
    // `scanOsc`'s own (unbounded) carry-over. Never clips a *valid* in-flight marker — only a
    // stream that has already exceeded the longest possible legal marker length (CONV-003).
    if (Buffer.byteLength(this.buf, 'utf8') > MAX_PENDING_BYTES) this.buf = ''
    return heartbeats
  }
}
