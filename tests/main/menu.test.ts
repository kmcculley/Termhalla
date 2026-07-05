import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Feature 0001 — REQ-001 / REQ-002 (unit).
 * Drives the real `installAppMenu()` but with `electron` and `./updater` mocked so we can
 * capture the template handed to `Menu.buildFromTemplate` and exercise the Settings… click
 * handler against a fake focused window — no Electron runtime needed.
 *
 * RED until TASK-003 adds the Edit ▸ Settings… submenu.
 */

const built: any[] = []
const sent: string[] = []
const fakeFocused = { webContents: { send: (ch: string) => sent.push(ch) } }

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
  BrowserWindow: { getFocusedWindow: () => fakeFocused, getAllWindows: () => [fakeFocused] },
  Menu: {
    buildFromTemplate: (tpl: any) => { built.push(tpl); return { tpl } },
    setApplicationMenu: () => {},
  },
  dialog: { showMessageBox: () => Promise.resolve({}) },
}))
vi.mock('../../src/main/updater', () => ({ checkForUpdatesInteractive: () => {} }))

import { installAppMenu } from '../../src/main/menu'

const lastTemplate = () => built.at(-1) as any[]
const labels = (tpl: any[]) => tpl.map(m => m.label)

describe('installAppMenu — Edit menu', () => {
  beforeEach(() => { built.length = 0; sent.length = 0 })

  it('TEST-001: builds a top-level Edit submenu before View and Help with one Settings… item (CmdOrCtrl+,)', () => {
    installAppMenu()
    const tpl = lastTemplate()
    expect(tpl).toBeTruthy()
    const ls = labels(tpl)

    const editIdx = ls.indexOf('Edit')
    const viewIdx = ls.indexOf('View')
    const helpIdx = ls.indexOf('Help')

    expect(editIdx).toBeGreaterThanOrEqual(0)
    expect(viewIdx).toBeGreaterThanOrEqual(0)
    expect(helpIdx).toBeGreaterThanOrEqual(0)
    // Menu order: Edit · View · Help
    expect(editIdx).toBeLessThan(viewIdx)
    expect(editIdx).toBeLessThan(helpIdx)

    const edit = tpl.find(m => m.label === 'Edit')
    const sub = (edit?.submenu ?? []) as any[]
    expect(sub).toHaveLength(1)
    expect(sub[0]?.label).toBe('Settings…')
    expect(sub[0]?.accelerator).toBe('CmdOrCtrl+,')
  })

  it('TEST-002: Settings… click sends only menu:open-settings to the focused window', () => {
    installAppMenu()
    const tpl = lastTemplate()
    const item = (tpl.find(m => m.label === 'Edit')?.submenu as any[] | undefined)?.[0]
    expect(typeof item?.click).toBe('function')
    item?.click?.()
    // Exactly one send, on exactly the open-settings channel (and no other).
    expect(sent).toEqual(['menu:open-settings'])
  })
})

describe('installAppMenu — File menu', () => {
  beforeEach(() => { built.length = 0; sent.length = 0 })

  it('builds a top-level File submenu before Edit with the document actions', () => {
    installAppMenu()
    const tpl = lastTemplate()
    const ls = labels(tpl)
    expect(ls.indexOf('File')).toBe(0)
    expect(ls.indexOf('File')).toBeLessThan(ls.indexOf('Edit'))

    const file = tpl.find(m => m.label === 'File')
    const sub = (file?.submenu ?? []) as any[]
    const itemLabels = sub.filter(s => s.label).map(s => s.label)
    expect(itemLabels).toEqual([
      'New Workspace', 'Open Workspace…', 'Reopen Closed Workspace…',
      'Save Workspace', 'Save Workspace As…', 'Exit'
    ])
    // Exit uses the native quit role so it inherits the before-quit flush machinery.
    expect(sub.find(s => s.id === 'file-exit')?.role).toBe('quit')
  })

  it('each document action sends only its own channel to the window', () => {
    installAppMenu()
    const sub = (lastTemplate().find(m => m.label === 'File')?.submenu as any[])
    const click = (id: string) => sub.find(s => s.id === id)?.click?.()

    click('file-new'); expect(sent).toEqual(['menu:file-new'])
    sent.length = 0
    click('file-open'); expect(sent).toEqual(['menu:file-open'])
    sent.length = 0
    click('file-reopen'); expect(sent).toEqual(['menu:file-reopen'])
    sent.length = 0
    click('file-save'); expect(sent).toEqual(['menu:file-save'])
    sent.length = 0
    click('file-save-as'); expect(sent).toEqual(['menu:file-save-as'])
  })
})
