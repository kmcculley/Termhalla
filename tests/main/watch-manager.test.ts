import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WatchManager } from '../../src/main/fs/watch-manager'
import type { FsChange } from '@shared/types'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termh-w-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred()) { clearInterval(iv); resolve() }
      else if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout')) }
    }, 25)
  })
}

describe('WatchManager', () => {
  it('emits an add event when a file appears in a watched dir', async () => {
    const events: FsChange[] = []
    const wm = new WatchManager((_id, c) => events.push(c))
    wm.watch('w1', dir)
    await new Promise(r => setTimeout(r, 300))
    writeFileSync(join(dir, 'new.txt'), 'hi')
    await waitFor(() => events.some(e => e.event === 'add' && e.path.endsWith('new.txt')))
    wm.closeAll()
    expect(events.some(e => e.event === 'add')).toBe(true)
  })

  it('stops emitting after unwatch', async () => {
    const events: FsChange[] = []
    const wm = new WatchManager((_id, c) => events.push(c))
    wm.watch('w1', dir)
    await new Promise(r => setTimeout(r, 300))
    wm.unwatch('w1')
    writeFileSync(join(dir, 'x.txt'), 'hi')
    await new Promise(r => setTimeout(r, 400))
    expect(events.length).toBe(0)
    wm.closeAll()
  })
})
