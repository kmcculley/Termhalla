/**
 * The phoneRemote:* IPC registrar (feature 0026) — thin: every call delegates straight into the
 * composed `PhoneRemoteService`. Every mutating call re-broadcasts the fresh status over
 * `phoneRemote:changed` (including the enable-failure `error` text, REQ-020) so every window's
 * Settings UI stays current without an extra pull.
 */
import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { BindMode, PhoneRemoteService } from '../phone-remote/service'
import type { Send } from './types'
import type { Disposer } from './types'

export function registerPhoneRemote(service: PhoneRemoteService, send: Send): Disposer {
  const broadcast = (error?: string): void => {
    send(CH.phoneRemoteChanged, error ? { ...service.status(), error } : service.status())
  }

  ipcMain.handle(CH.phoneRemoteStatus, () => service.status())

  ipcMain.handle(CH.phoneRemoteSetEnabled, async (_e, enabled: unknown) => {
    await service.setEnabled(enabled === true)
    broadcast()
    return service.status()
  })

  ipcMain.handle(CH.phoneRemoteSetBind, async (_e, mode: unknown) => {
    await service.setBind(mode === 'lan' ? 'lan' : ('localhost' as BindMode))
    broadcast()
    return service.status()
  })

  ipcMain.handle(CH.phoneRemoteSetPort, async (_e, port: unknown) => {
    const p = typeof port === 'number' && Number.isInteger(port) ? port : 0
    await service.setPort(p)
    broadcast()
    return service.status()
  })

  ipcMain.handle(CH.phoneRemoteRegenerateToken, async () => {
    const result = await service.regenerateToken()
    broadcast()
    return result
  })

  return () => {
    ipcMain.removeHandler(CH.phoneRemoteStatus)
    ipcMain.removeHandler(CH.phoneRemoteSetEnabled)
    ipcMain.removeHandler(CH.phoneRemoteSetBind)
    ipcMain.removeHandler(CH.phoneRemoteSetPort)
    ipcMain.removeHandler(CH.phoneRemoteRegenerateToken)
  }
}
