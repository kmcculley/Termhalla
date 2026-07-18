/**
 * The phone-remote e2e seam (feature 0026, REQ-025) — mirrors the `e2e-presentation.ts` /
 * `e2e-remote.ts` discipline: exactly ONE module under `src/main` may read
 * `TERMHALLA_E2E_PHONE_REMOTE` (a structural test enumerates every `src/main` source and fails on
 * any occurrence outside this file). Unset, empty, or malformed input degrades to `undefined` —
 * byte-identical production behavior — never a throw, never a partial/garbage value on a single
 * field (each field degrades independently).
 */

export interface PhoneRemoteE2EOverride {
  port?: number
  token?: string
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
  return out
}
