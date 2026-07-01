import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { CH } from '@shared/ipc-contract'
import type { OrkyActionResult } from '@shared/types'
import type { OrkyActionDispatcher } from '../orky/orky-action-dispatcher'
import type { Disposer } from './types'

/** The exact literal rejection shape for a sender the composition root does not recognize (REQ-003).
 *  Returned WITHOUT ever invoking the dispatcher — so no CLI runs and no audit line results from this
 *  path (the audit log lives only inside the dispatcher; see REQ-013's corrected scope, ESC-001). */
const REJECTED_SENDER: OrkyActionResult = {
  ok: false,
  path: null,
  dispatched: false,
  errorKind: 'unknown-sender',
  error: 'rejected: sender is not a known app window'
}

/**
 * The `orkyAction:*` IPC registrar (feature 0007, TASK-010) — mirrors `register-registry.ts`'s
 * `ipcMain.handle` + sender-validation + disposer pattern. Every handler gates on
 * `isKnownWindowSender(e.sender)` BEFORE ever calling into the dispatcher (REQ-003); the predicate
 * defaults to allow-all (`() => true`) so tests/callers that omit it are unaffected, and the
 * composition root passes the REAL `wm.isKnownWindowSender`. This registrar subscribes NO push event
 * (REQ-001: this feature ships zero main -> renderer channels).
 */
export function registerOrkyAction(
  dispatcher: OrkyActionDispatcher,
  isKnownWindowSender: (sender: WebContents) => boolean = () => true
): Disposer {
  // async wrappers: the handler must always return a REAL Promise (not a bare value on the
  // unknown-sender branch) — ipcMain.handle's own invoke marshalling auto-wraps a plain return in
  // production, but this registrar is also exercised by directly calling the stored handler (mirrors
  // register-registry.ts's own note on this).
  ipcMain.handle(CH.orkyActionResolveEscalation, async (e: IpcMainInvokeEvent, req: unknown) => {
    if (!isKnownWindowSender(e.sender)) return REJECTED_SENDER
    return dispatcher.resolveEscalation(req, e.sender.id)
  })
  ipcMain.handle(CH.orkyActionSubmitWork, async (e: IpcMainInvokeEvent, req: unknown) => {
    if (!isKnownWindowSender(e.sender)) return REJECTED_SENDER
    return dispatcher.submitWork(req, e.sender.id)
  })
  ipcMain.handle(CH.orkyActionRecordHumanGate, async (e: IpcMainInvokeEvent, req: unknown) => {
    if (!isKnownWindowSender(e.sender)) return REJECTED_SENDER
    return dispatcher.recordHumanGate(req, e.sender.id)
  })
  ipcMain.handle(CH.orkyActionDriveStatus, async (e: IpcMainInvokeEvent, req: unknown) => {
    if (!isKnownWindowSender(e.sender)) return REJECTED_SENDER
    return dispatcher.driveStatus(req, e.sender.id)
  })

  return () => {
    ipcMain.removeHandler(CH.orkyActionResolveEscalation)
    ipcMain.removeHandler(CH.orkyActionSubmitWork)
    ipcMain.removeHandler(CH.orkyActionRecordHumanGate)
    ipcMain.removeHandler(CH.orkyActionDriveStatus)
  }
}
