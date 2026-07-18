import type { TermhallaApi } from '@shared/ipc-contract'

declare global {
  interface Window { termhalla: TermhallaApi }
}
// Every channel — including the phoneRemote:* status/settings/pairing surface and the app-wide
// phoneRemote:error push (REQ-020) — is exposed here exactly like every other domain:
// `api.phoneRemoteStatus()`, `api.onPhoneRemoteError(cb)`, etc.
export const api: TermhallaApi = window.termhalla
