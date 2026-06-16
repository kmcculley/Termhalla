import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Recorder } from '../../src/main/recording/recorder'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'rec-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('Recorder', () => {
  it('writes a header + output event and finalizes on stop', async () => {
    const base = tmp()
    const r = new Recorder()
    const file = r.start('p1', 80, 24, base)
    expect(r.isRecording('p1')).toBe(true)
    r.data('p1', 'hello\r\n')
    const path = r.stop('p1')
    expect(path).toBe(file)
    expect(r.isRecording('p1')).toBe(false)
    await wait(60)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(JSON.parse(lines[0])).toMatchObject({ version: 2, width: 80, height: 24 })
    const ev = JSON.parse(lines[1]) as [number, string, string]
    expect(ev[1]).toBe('o'); expect(ev[2]).toBe('hello\r\n')
    expect(existsSync(join(base, 'recordings'))).toBe(true)
  })
  it('stop returns null when not recording', () => {
    expect(new Recorder().stop('nope')).toBeNull()
  })
})
