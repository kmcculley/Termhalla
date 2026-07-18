import type { PhoneRemoteSettings } from './settings'

/** The IPC-facing status/control shape (feature 0026) — main's `PhoneRemoteService.status()`
 *  return value, also the `phoneRemote:changed` push payload (with `error` set only on an
 *  enable failure, REQ-020). */
export interface PhoneRemoteStatus {
  enabled: boolean
  bind: PhoneRemoteSettings['bind']
  port: number
  running: boolean
  urls: string[]
  hasToken: boolean
  tokenAvailableThisSession: boolean
  error?: string
  /** Optional phone-reachable host override for the pairing URL/QR (REQ-031). */
  externalHost?: string
  /** Present (`true`) only on the `phoneRemote:changed` broadcast fired by a token regenerate
   *  (FINDING-110): a secret-free URL-changed signal — the token/URL itself never rides a push;
   *  consumers re-PULL `phoneRemote:pairingUrl` so a second window's mounted Settings stops
   *  rendering the revoked QR. */
  pairingUrlChanged?: true
}
