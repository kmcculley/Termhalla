import { ipcMain, type BrowserWindow } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { EnvVault } from '../env-vault/env-vault'
import type { Send } from './types'

/** Encrypted env-vault handlers. The unlock failure backoff lives inside EnvVault.unlock so it
 *  can't be bypassed. `envVault` is shared with the PTY stack (spawn injects envFor). */
export function registerEnv(win: BrowserWindow, envVault: EnvVault, send: Send): void {
  const emitEnvState = (): void => send(CH.envState, { exists: envVault.exists(), unlocked: envVault.isUnlocked() })

  ipcMain.handle(CH.envUnlock, (_e, p: string) => { const ok = envVault.unlock(p); emitEnvState(); return ok })
  ipcMain.handle(CH.envCreate, (_e, p: string) => { envVault.create(p); emitEnvState() })
  ipcMain.on(CH.envLock, () => { envVault.lock(); emitEnvState() })
  ipcMain.handle(CH.envGet, () => envVault.current())
  // setGlobal/setTerminal use `handle` (invoke) so a write failure rejects to the renderer, which
  // then avoids toasting a false "added". The remove handlers stay fire-and-forget best-effort:
  // a failed remove-persist loses nothing the user typed (the var just reappears next launch), so
  // swallow it here rather than crash the `.on` listener.
  ipcMain.handle(CH.envSetGlobal, (_e, n: string, v: string) => { envVault.setGlobal(n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveGlobal, (_e, n: string) => { try { envVault.removeGlobal(n) } catch { /* best-effort */ } emitEnvState() })
  ipcMain.handle(CH.envSetTerminal, (_e, id: string, n: string, v: string) => { envVault.setTerminal(id, n, v); emitEnvState() })
  ipcMain.on(CH.envRemoveTerminal, (_e, id: string, n: string) => { try { envVault.removeTerminal(id, n) } catch { /* best-effort */ } emitEnvState() })
  // Initial state, twice-armed: main's did-finish-load (the original hook), PLUS every window's
  // win:ready signal (window-management follow-up, fixed 2026-07-09) — an UNDOCKED window used to
  // show stale vault state until the next mutation re-broadcast, because only main ever got the
  // one-time emit. `send` broadcasts to all windows and the renderer's setEnvState is idempotent,
  // so a re-emit on each ready signal is harmless everywhere and fixes the late window.
  win.webContents.on('did-finish-load', emitEnvState)
  ipcMain.on(CH.winReady, emitEnvState)
}
