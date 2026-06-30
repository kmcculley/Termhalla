import { ipcMain } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { OrkyRegistry } from '../orky/orky-registry'
import type { Send, Disposer } from './types'

/** The `registry:*` IPC registrar (feature 0005, TASK-011). Mirrors `register-cloud.ts`/
 *  `register-usage.ts`'s `ipcMain.handle` + disposer pattern: `registry:current`/`registry:roots` are
 *  pure-read pulls, `registry:addRoot`/`registry:removeRoot` pass their raw (possibly malformed) argument
 *  straight through — `OrkyRegistry.addRoot`/`removeRoot` own ALL validation (REQ-009/REQ-016), never the
 *  registrar. `registry:status` is wired by subscribing to `registry.onSnapshot`, broadcasting the
 *  COMPLETE current aggregate to every window via `send` (its first arg is a snapshot array, not a
 *  paneId, so it is NOT pane-scoped — REQ-008/REQ-020/REQ-022).
 *
 *  The returned disposer removes all four handlers and unsubscribes `onSnapshot` but deliberately does
 *  NOT call `registry.dispose()` — the SHARED `OrkyRootEngine`/`OrkyRegistry` lifecycle is owned ONCE by
 *  the composition root (also used by `registerOrky`), never duplicated across registrars (plan risk
 *  note #3). */
export function registerRegistry(registry: OrkyRegistry, send: Send): Disposer {
  // async wrappers: registry.current()/roots() are synchronous pure reads, but the handler itself must
  // return a real Promise (not a bare value) — ipcMain.handle's own invoke marshalling auto-wraps a
  // plain return in production, but this is also exercised by directly calling the stored handler.
  ipcMain.handle(CH.registryCurrent, async () => registry.current())
  ipcMain.handle(CH.registryRoots, async () => registry.roots())
  ipcMain.handle(CH.registryAddRoot, (_e, root: unknown) => registry.addRoot(root))
  ipcMain.handle(CH.registryRemoveRoot, (_e, root: unknown) => registry.removeRoot(root))
  const unsubscribe = registry.onSnapshot((snapshot) => send(CH.registryStatus, snapshot))

  return () => {
    ipcMain.removeHandler(CH.registryCurrent)
    ipcMain.removeHandler(CH.registryRoots)
    ipcMain.removeHandler(CH.registryAddRoot)
    ipcMain.removeHandler(CH.registryRemoveRoot)
    unsubscribe()
  }
}
