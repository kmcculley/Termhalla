/**
 * The phoneRemote:* IPC registrar (feature 0026) — thin: every call delegates straight into the
 * composed `PhoneRemoteService`. Every mutating call re-broadcasts the fresh status over
 * `phoneRemote:changed` so every window's Settings UI stays current without an extra pull.
 *
 * v2 (ESC-001 loopback):
 *  - REQ-032 (FINDING-047): every handler — all write-capable, and `regenerateToken`/`pairingUrl`
 *    return the plaintext pairing token — rejects a sender that is not a currently-tracked app
 *    window BEFORE any handler logic runs (mirrors `register-orky-action.ts`/`register-registry.ts`).
 *  - REQ-003 (FINDING-032): `setPort` coerces any non-integer/out-of-range argument to
 *    `PHONE_REMOTE_PORT_DEFAULT` — port `0` (OS-assigned) is reachable ONLY via the REQ-025 e2e
 *    seam, never a production IPC call.
 *  - REQ-007/REQ-031: `phoneRemote:pairingUrl` (re-fetch, never a regenerate) and
 *    `phoneRemote:setExternalHost`.
 *  - REQ-020 (FINDING-034): an app-wide `phoneRemote:error` push, independent of any component
 *    mount, consumed at the renderer root (`App.tsx`) — not only `phoneRemote:changed`, which a
 *    Settings-mount-scoped listener alone would miss.
 */
import { ipcMain, type WebContents } from 'electron'
import { CH } from '@shared/ipc-contract'
import { PHONE_REMOTE_PORT_DEFAULT } from '@shared/phone-remote/settings'
import type { BindMode, PhoneRemoteService } from '../phone-remote/service'
import type { Send } from './types'
import type { Disposer } from './types'

const isValidPort = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= 65535

export function registerPhoneRemote(
  service: PhoneRemoteService,
  send: Send,
  isKnownWindowSender: (sender: WebContents) => boolean = () => true
): Disposer {
  const broadcast = (error?: string): void => {
    send(CH.phoneRemoteChanged, error ? { ...service.status(), error } : service.status())
    if (error) send(CH.phoneRemoteError, error)
  }

  // A STATIC placeholder for a rejected (foreign-sender) call — never derived from `service`, so
  // a rejected call touches the service surface not at all (REQ-032's own acceptance: `svc.status`
  // itself must never be called for a foreign sender, not just the mutating methods).
  const REJECTED_STATUS = {
    enabled: false, bind: 'localhost' as BindMode, port: PHONE_REMOTE_PORT_DEFAULT,
    running: false, urls: [] as string[], hasToken: false, tokenAvailableThisSession: false
  }

  /** Sender-gates a handler (REQ-032): a foreign sender never reaches `service`, not even to
   *  compute a fallback return value. */
  const gated = <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>, onRejected: R) =>
    async (e: { sender: unknown }, ...a: A): Promise<R> => {
      if (!isKnownWindowSender(e.sender as WebContents)) return onRejected
      return fn(...a)
    }

  ipcMain.handle(CH.phoneRemoteStatus, gated(() => service.status(), REJECTED_STATUS))

  ipcMain.handle(CH.phoneRemoteSetEnabled, gated(async (enabled: unknown) => {
    await service.setEnabled(enabled === true)
    broadcast()
    return service.status()
  }, REJECTED_STATUS))

  ipcMain.handle(CH.phoneRemoteSetBind, gated(async (mode: unknown) => {
    await service.setBind(mode === 'lan' ? 'lan' : ('localhost' as BindMode))
    broadcast()
    return service.status()
  }, REJECTED_STATUS))

  ipcMain.handle(CH.phoneRemoteSetPort, gated(async (port: unknown) => {
    const p = isValidPort(port) ? port : PHONE_REMOTE_PORT_DEFAULT
    await service.setPort(p)
    broadcast()
    return service.status()
  }, REJECTED_STATUS))

  ipcMain.handle(CH.phoneRemoteSetExternalHost, gated(async (host: unknown) => {
    await service.setExternalHost(typeof host === 'string' ? host : undefined)
    broadcast()
    return service.status()
  }, REJECTED_STATUS))

  ipcMain.handle(CH.phoneRemoteRegenerateToken, gated(async () => {
    const result = await service.regenerateToken()
    // FINDING-110: only the invoking window gets the new pairing URL (this return value); a
    // second window's mounted Settings would keep rendering the now-revoked QR. The broadcast
    // stays secret-free — it carries a `pairingUrlChanged` signal (never the token/URL), and
    // each window's slice re-PULLS `phoneRemote:pairingUrl` (sender-gated) on seeing it.
    send(CH.phoneRemoteChanged, { ...service.status(), pairingUrlChanged: true })
    return result
  }, { pairingUrl: '' }))

  ipcMain.handle(CH.phoneRemotePairingUrl, gated(async () => service.pairingUrl(), { unavailable: true as const }))

  return () => {
    ipcMain.removeHandler(CH.phoneRemoteStatus)
    ipcMain.removeHandler(CH.phoneRemoteSetEnabled)
    ipcMain.removeHandler(CH.phoneRemoteSetBind)
    ipcMain.removeHandler(CH.phoneRemoteSetPort)
    ipcMain.removeHandler(CH.phoneRemoteSetExternalHost)
    ipcMain.removeHandler(CH.phoneRemoteRegenerateToken)
    ipcMain.removeHandler(CH.phoneRemotePairingUrl)
  }
}
