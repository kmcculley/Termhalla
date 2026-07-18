// NEW unit suite — sender validation on the write-capable fs:* surface (2026-07 quality audit,
// finding 15). Every write-capable IPC registrar since FINDING-SEC-002 gates on
// `isKnownWindowSender` (register-registry.ts / register-orky-action.ts / register-remote.ts);
// register-fs.ts gated nothing, so any foreign/destroyed sender could write/rename/trash/mkdir.
//
// Mirrors tests/main/register-registry.test.ts's mocking style: `electron` is mocked
// (`ipcMain.handle` capture) and the fs helpers module is mocked so no real disk write can occur;
// the REAL `registerFs` is driven by calling the stored handlers directly. A refused sender gets a
// REJECTED invoke (the register-remote.ts agentsSave precedent — fs handlers have no structured
// result shape to smuggle an error through). The predicate defaults to allow-all so existing
// callers/tests that omit it are unaffected; the composition root passes the real
// `wm.isKnownWindowSender` (see register.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    on: () => {},
    removeHandler: () => {},
    removeListener: () => {}
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(async () => ''), trashItem: vi.fn(async () => {}), showItemInFolder: vi.fn() },
  BrowserWindow: { fromWebContents: () => null }
}))

vi.mock('../../src/main/fs/files', () => ({
  readTextFile: vi.fn(async () => ({ kind: 'ok', content: 'file text', tooLarge: false })),
  writeTextFile: vi.fn(async () => 1),
  readDirectory: vi.fn(async () => []),
  statPath: vi.fn(async () => ({ size: 0, mtimeMs: 0, isDir: false })),
  renamePath: vi.fn(async () => {}),
  makeDirectory: vi.fn(async () => {})
}))

vi.mock('../../src/main/fs/watch-manager', () => ({
  WatchManager: class {
    watch(): void {}
    unwatch(): void {}
    closeAll(): void {}
  }
}))

import { shell } from 'electron'
import { CH } from '@shared/ipc-contract'
import { registerFs } from '../../src/main/ipc/register-fs'
import { readTextFile, writeTextFile, renamePath, makeDirectory } from '../../src/main/fs/files'

const win = {} as never
const sendNoop = (): void => {}
const event = { sender: { id: 1 } }

describe('registerFs — sender validation on the write-capable handlers', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k]
    vi.clearAllMocks()
  })

  it('a refused sender gets a REJECTED invoke on fs:write/fs:rename/fs:trash/fs:mkdir, and the fs op never runs', async () => {
    registerFs(win, sendNoop, () => false)
    await expect(handlers[CH.fsWrite](event, 'C:/p/x.txt', 'hi')).rejects.toThrow(/unknown sender/)
    await expect(handlers[CH.fsRename](event, 'C:/p/a.txt', 'C:/p/b.txt')).rejects.toThrow(/unknown sender/)
    await expect(handlers[CH.fsTrash](event, 'C:/p/x.txt')).rejects.toThrow(/unknown sender/)
    await expect(handlers[CH.fsMkdir](event, 'C:/p/dir')).rejects.toThrow(/unknown sender/)
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(renamePath).not.toHaveBeenCalled()
    expect(shell.trashItem).not.toHaveBeenCalled()
    expect(makeDirectory).not.toHaveBeenCalled()
  })

  it('a known sender delegates each write handler to the real fs op', async () => {
    registerFs(win, sendNoop, () => true)
    await handlers[CH.fsWrite](event, 'C:/p/x.txt', 'hi')
    await handlers[CH.fsRename](event, 'C:/p/a.txt', 'C:/p/b.txt')
    await handlers[CH.fsTrash](event, 'C:/p/x.txt')
    await handlers[CH.fsMkdir](event, 'C:/p/dir')
    expect(writeTextFile).toHaveBeenCalledWith('C:/p/x.txt', 'hi')
    expect(renamePath).toHaveBeenCalledWith('C:/p/a.txt', 'C:/p/b.txt')
    expect(shell.trashItem).toHaveBeenCalledWith('C:/p/x.txt')
    expect(makeDirectory).toHaveBeenCalledWith('C:/p/dir')
  })

  it('the predicate defaults to allow-all when omitted (existing callers/tests unaffected)', async () => {
    registerFs(win, sendNoop) // no predicate passed
    await handlers[CH.fsWrite](event, 'C:/p/x.txt', 'hi')
    expect(writeTextFile).toHaveBeenCalledWith('C:/p/x.txt', 'hi')
  })

  it('a refused sender can still READ (only the write surface is gated — reads are unchanged by this fix)', async () => {
    registerFs(win, sendNoop, () => false)
    await expect(handlers[CH.fsRead](event, 'C:/p/x.txt')).resolves.toEqual({ kind: 'ok', content: 'file text', tooLarge: false })
    expect(readTextFile).toHaveBeenCalledWith('C:/p/x.txt')
  })
})
