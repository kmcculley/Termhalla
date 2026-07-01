import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { OrkyRegistry } from '../orky/orky-registry'
import type { Send, Disposer } from './types'

/** The `registry:*` IPC registrar (feature 0005, TASK-011). Mirrors `register-cloud.ts`/
 *  `register-usage.ts`'s `ipcMain.handle` + disposer pattern: `registry:current`/`registry:roots` are
 *  pure-read pulls, `registry:addRoot`/`registry:removeRoot` pass their raw (possibly malformed) argument
 *  straight through — `OrkyRegistry.addRoot`/`removeRoot` own ALL ARGUMENT validation (REQ-009/REQ-016),
 *  never the registrar. `registry:status` is wired by subscribing to `registry.onSnapshot`, broadcasting
 *  the COMPLETE current aggregate to every window via `send` (its first arg is a snapshot array, not a
 *  paneId, so it is NOT pane-scoped — REQ-008/REQ-020/REQ-022).
 *
 *  SENDER validation (FINDING-SEC-007 / REQ-016 "follow the existing per-window sender discipline of
 *  `register-orky.ts` where applicable") lives HERE, not inside `OrkyRegistry`: every handler gates on
 *  `isKnownWindowSender(e.sender)`, mirroring `register-orky.ts`'s `onWatch`/`onUnwatch` guard. The
 *  predicate defaults to "allow everything" (`() => true`) so existing callers/tests that omit it (and
 *  the frozen `tests/main/register-registry.test.ts`, which invokes handlers with a fake `{}` event that
 *  has no real `.sender`) are unaffected; the composition root passes the REAL
 *  `wm.isKnownWindowSender` explicitly (see `register.ts`). A rejected sender never throws and never
 *  silently no-ops without telling the caller: the two pure reads (`current`/`roots`) return an empty
 *  result (`[]`) rather than leaking the real aggregate/list to an unrecognized sender, and the two
 *  mutating handlers (`addRoot`/`removeRoot`) return a `RegistryMutationResult`-shaped rejection
 *  (`{ ok:false, roots: [], error: 'unknown sender' }` — FINDING-SEC-009: deliberately `[]`, NOT
 *  `registry.roots()`, so a rejected sender is never handed the real persisted list either, consistent
 *  with the `current`/`roots` handlers' own "never leak" rule above) so the caller can distinguish a
 *  rejected sender from a validation failure inside `OrkyRegistry` itself.
 *
 *  The returned disposer removes all four handlers and unsubscribes `onSnapshot` but deliberately does
 *  NOT call `registry.dispose()` — the SHARED `OrkyRootEngine`/`OrkyRegistry` lifecycle is owned ONCE by
 *  the composition root (also used by `registerOrky`), never duplicated across registrars (plan risk
 *  note #3). */
export function registerRegistry(
  registry: OrkyRegistry,
  send: Send,
  isKnownWindowSender: (sender: WebContents) => boolean = () => true
): Disposer {
  // async wrappers: registry.current()/roots() are synchronous pure reads, but the handler itself must
  // return a real Promise (not a bare value) — ipcMain.handle's own invoke marshalling auto-wraps a
  // plain return in production, but this is also exercised by directly calling the stored handler.
  ipcMain.handle(CH.registryCurrent, async (e: IpcMainInvokeEvent) => {
    if (!isKnownWindowSender(e.sender)) return [] // unknown sender: never leak the aggregate, never throw
    return registry.current()
  })
  ipcMain.handle(CH.registryRoots, async (e: IpcMainInvokeEvent) => {
    if (!isKnownWindowSender(e.sender)) return [] // unknown sender: never leak the persisted list, never throw
    return registry.roots()
  })
  ipcMain.handle(CH.registryAddRoot, (e: IpcMainInvokeEvent, root: unknown) => {
    if (!isKnownWindowSender(e.sender)) {
      return { ok: false, roots: [], error: 'unknown sender' }
    }
    return registry.addRoot(root)
  })
  ipcMain.handle(CH.registryRemoveRoot, (e: IpcMainInvokeEvent, root: unknown) => {
    if (!isKnownWindowSender(e.sender)) {
      return { ok: false, roots: [], error: 'unknown sender' }
    }
    return registry.removeRoot(root)
  })
  const unsubscribe = registry.onSnapshot((snapshot) => send(CH.registryStatus, snapshot))

  return () => {
    ipcMain.removeHandler(CH.registryCurrent)
    ipcMain.removeHandler(CH.registryRoots)
    ipcMain.removeHandler(CH.registryAddRoot)
    ipcMain.removeHandler(CH.registryRemoveRoot)
    unsubscribe()
  }
}
