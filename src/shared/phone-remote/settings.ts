/**
 * Phone-remote settings (feature 0026, REQ-003): one additive optional `quick.json` field,
 * `phoneRemote`, coerced by `normalizeQuick` on BOTH read and write (quick.json sits outside the
 * versioned-persistence migration chain — this module and the quick-store wiring must never
 * couple to it, CONV-022).
 */

export const PHONE_REMOTE_PORT_DEFAULT = 8199

export interface PhoneRemoteSettings {
  enabled: boolean
  bind: 'localhost' | 'lan'
  port: number
  /** sha-256 (base64url) of the pairing token. Absent = never paired. The plaintext token is
   *  NEVER persisted (REQ-004) — it lives in main-process memory only, for the current session. */
  tokenHash?: string
}

const isValidPort = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535

/** Coerce an untrusted value into a well-formed `PhoneRemoteSettings`, or `undefined` (= feature
 *  off) when the value isn't even a plain object. Field-wise invalid values coerce individually
 *  to their safe default rather than discarding the whole record — a bad `port` must not also
 *  wipe a good `tokenHash`. */
export function normalizePhoneRemote(value: unknown): PhoneRemoteSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Partial<PhoneRemoteSettings>
  const out: PhoneRemoteSettings = {
    enabled: v.enabled === true,
    bind: v.bind === 'lan' ? 'lan' : 'localhost',
    port: isValidPort(v.port) ? v.port : PHONE_REMOTE_PORT_DEFAULT
  }
  if (typeof v.tokenHash === 'string') out.tokenHash = v.tokenHash
  return out
}
