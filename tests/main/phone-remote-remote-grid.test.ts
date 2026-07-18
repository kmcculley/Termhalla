// FROZEN test suite — feature 0026-phone-web-remote (phase 4, v2 loopback — FINDING-040).
// REQ-008/REQ-013 (v2 amendment): remote-workspace panes get GRID PARITY with local panes
// THROUGH THE REAL PTY REGISTRAR ROUTING — the v1 review found register-pty.ts's remote
// branches early-returned before `deps.onSpawn`/`deps.onResize`, so remote panes minted
// hard-coded 80x24 mirrors and never produced a `grid` push no matter how the desktop
// resized them (rejected).
//
// This suite drives the REAL `registerPty` (src/main/ipc/register-pty.ts) with the heavy
// runtime collaborators mocked (electron ipcMain capture — the orky-ipc-validation pattern —
// plus PtyManager/StatusEngine/ProcessTracker/AiSessionTracker, none of which participate in
// the remote branches under test). The `remote` router fake mirrors
// RemoteWorkspaceManager's isAdoptable/owns/spawn/resize surface.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (...a: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => { handlers[ch] = fn },
    on: (ch: string, fn: (...a: unknown[]) => void) => { handlers[ch] = fn },
    removeHandler: vi.fn(),
    removeListener: vi.fn(),
    removeAllListeners: vi.fn()
  },
  Notification: class { static isSupported(): boolean { return false } },
  BrowserWindow: { fromWebContents: () => null, fromId: () => null, getAllWindows: () => [] }
}))
vi.mock('../../src/main/pty/pty-manager', () => ({
  PtyManager: class {
    has(): boolean { return false }
    spawn(): void {}
    write(): void {}
    resize(): void {}
    kill(): void {}
    pidOf(): number | null { return null }
    sizeOf(): undefined { return undefined }
  }
}))
vi.mock('../../src/main/status/status-engine', () => ({
  StatusEngine: class { setAiActive(): void {} }
}))
vi.mock('../../src/main/proc/process-tracker', () => ({
  ProcessTracker: class { register(): void {} unregister(): void {} setBusy(): void {} }
}))
vi.mock('../../src/main/ai/ai-session-tracker', () => ({
  AiSessionTracker: class { reemit(): void {} unregister(): void {} onProcs(): void {} commandDone(): void {} }
}))

import { CH } from '@shared/ipc-contract'
import { registerPty } from '../../src/main/ipc/register-pty'

const evt = { sender: { id: 'w1' } }

interface Ctx {
  onSpawn: ReturnType<typeof vi.fn>
  onResize: ReturnType<typeof vi.fn>
  remote: {
    isAdoptable: ReturnType<typeof vi.fn>
    owns: ReturnType<typeof vi.fn>
    spawn: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    kill: ReturnType<typeof vi.fn>
  }
}

const mkCtx = (opts: { adoptable?: boolean; owns?: boolean }): Ctx => {
  for (const k of Object.keys(handlers)) delete handlers[k]
  const onSpawn = vi.fn()
  const onResize = vi.fn()
  const remote = {
    isAdoptable: vi.fn(() => opts.adoptable === true),
    owns: vi.fn(() => opts.owns === true),
    spawn: vi.fn(() => true),
    resize: vi.fn(),
    write: vi.fn(),
    kill: vi.fn()
  }
  registerPty(
    { isDestroyed: () => false, id: 1 } as never,
    {
      shells: [{ id: 'sh', label: 'sh', program: 'sh', args: [] }] as never,
      recorder: { data: () => {}, stop: () => {}, resize: () => {} } as never,
      envVault: { envFor: () => undefined } as never,
      scriptDir: '.',
      send: () => {},
      indexer: { setCwd: () => {}, data: () => {}, remove: () => {} } as never,
      remote: remote as never,
      onSpawn,
      onResize
    }
  )
  return { onSpawn, onResize, remote }
}

describe('TEST-2699 REQ-008 remote spawn/adopt paths feed the mirror grid source with the REAL grid', () => {
  it('a fresh remote spawn invokes deps.onSpawn with the spawn-args grid (never a hard-coded default)', async () => {
    const ctx = mkCtx({ adoptable: false })
    await handlers[CH.ptySpawn](evt, { id: 'r1', remote: { agent: 'a' }, shellId: 'sh', cwd: '.', cols: 137, rows: 41 })
    expect(ctx.remote.spawn).toHaveBeenCalled()
    expect(ctx.onSpawn, 'the remote spawn branch must invoke onSpawn with the real grid').toHaveBeenCalledWith('r1', 137, 41)
    expect(ctx.onSpawn).not.toHaveBeenCalledWith('r1', 80, 24)
  })

  it('a remote ADOPT (remount) still surfaces the remounting grid through the observational seam', async () => {
    const ctx = mkCtx({ adoptable: true })
    await handlers[CH.ptySpawn](evt, { id: 'r1', remote: { agent: 'a' }, shellId: 'sh', cwd: '.', cols: 90, rows: 33 })
    // the adopt path reconciles via remote.resize — the phone-remote seam must see the same grid
    // (either hook is acceptable; the grid values are not)
    const seen = [...ctx.onSpawn.mock.calls, ...ctx.onResize.mock.calls]
    expect(seen.some((c) => c[0] === 'r1' && c[1] === 90 && c[2] === 33),
      'the adopted remote pane grid must reach onSpawn/onResize').toBe(true)
  })
})

describe('TEST-2700 REQ-013 the remote-owned resize path has grid-push parity with local panes', () => {
  it('ptyResize on a remote-owned pane invokes deps.onResize with the requested cols/rows', () => {
    const ctx = mkCtx({ owns: true })
    handlers[CH.ptyResize](evt, { id: 'r1', cols: 150, rows: 50 })
    expect(ctx.remote.resize).toHaveBeenCalledWith('r1', 150, 50)
    expect(ctx.onResize, 'the remote resize branch must not early-return before onResize (FINDING-040)').toHaveBeenCalledWith('r1', 150, 50)
  })

  it('the local resize path keeps its existing onResize behavior (parity, not replacement)', () => {
    const ctx = mkCtx({ owns: false })
    handlers[CH.ptyResize](evt, { id: 'l1', cols: 100, rows: 30 })
    expect(ctx.onResize).toHaveBeenCalledWith('l1', 100, 30)
    expect(ctx.remote.resize).not.toHaveBeenCalled()
  })
})
