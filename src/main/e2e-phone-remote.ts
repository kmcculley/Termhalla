/**
 * The phone-remote e2e seam (feature 0026, REQ-025) — mirrors the `e2e-presentation.ts` /
 * `e2e-remote.ts` discipline: exactly ONE module under `src/main` may read
 * `TERMHALLA_E2E_PHONE_REMOTE` (a structural test enumerates every `src/main` source and fails on
 * any occurrence outside this file). Unset, empty, or malformed input degrades to `undefined` —
 * byte-identical production behavior — never a throw, never a partial/garbage value on a single
 * field (each field degrades independently).
 */

export interface PhoneRemoteE2ETiming {
  pingIntervalMs?: number
  pongTimeoutMs?: number
  stallTimeoutMs?: number
}

export interface PhoneRemoteE2EOverride {
  port?: number
  token?: string
  /** Force the service on at startup (test-only pairing bootstrap — REQ-025 v2). */
  enabled?: boolean
  /** Deterministic-timer overrides for the real-transport backpressure/keepalive integration
   *  coverage (REQ-017 v2), so those tests run fast without waiting on production cadences. */
  timing?: PhoneRemoteE2ETiming
}

const parseTiming = (v: unknown): PhoneRemoteE2ETiming | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const t = v as Record<string, unknown>
  const out: PhoneRemoteE2ETiming = {}
  if (typeof t.pingIntervalMs === 'number' && Number.isFinite(t.pingIntervalMs)) out.pingIntervalMs = t.pingIntervalMs
  if (typeof t.pongTimeoutMs === 'number' && Number.isFinite(t.pongTimeoutMs)) out.pongTimeoutMs = t.pongTimeoutMs
  if (typeof t.stallTimeoutMs === 'number' && Number.isFinite(t.stallTimeoutMs)) out.stallTimeoutMs = t.stallTimeoutMs
  return Object.keys(out).length > 0 ? out : undefined
}

export function e2ePhoneRemoteOverride(
  raw: string | undefined = process.env.TERMHALLA_E2E_PHONE_REMOTE
): PhoneRemoteE2EOverride | undefined {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const p = parsed as Record<string, unknown>
  const out: PhoneRemoteE2EOverride = {}
  if (typeof p.port === 'number' && Number.isFinite(p.port)) out.port = p.port
  if (typeof p.token === 'string') out.token = p.token
  if (typeof p.enabled === 'boolean') out.enabled = p.enabled
  const timing = parseTiming(p.timing)
  if (timing) out.timing = timing
  return out
}
