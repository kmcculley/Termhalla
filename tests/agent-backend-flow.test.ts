// FROZEN test suite — feature 0018-windowed-flow-control (phase 4).
// The backend half of flow control (REQ-010, REQ-011): pause/resume on AgentPtyHandle —
// deterministic queue-while-paused modeling in the fake backend (ordered flush, deferred
// exit, idempotence) — plus the `flood` scripted command and the structural pin that the
// real backend maps pause/resume onto node-pty's own methods.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyHandle } from '../src/agent/pty-backend'

const OSC_C = '\x1b]133;C\x07'
const oscD = (code: number): string => `\x1b]133;D;${code}\x07`

interface Tap { data: string[]; exits: number[] }
const tap = (h: AgentPtyHandle): Tap => {
  const t: Tap = { data: [], exits: [] }
  h.onData((d) => t.data.push(d))
  h.onExit((c) => t.exits.push(c))
  return t
}
const spawnOne = (): { handle: AgentPtyHandle } => {
  const backend = createFakePtyBackend()
  return { handle: backend.spawn({ id: 'p1', cwd: '/home/u', cols: 80, rows: 24, shellId: 'default' }) }
}

describe('TEST-788 REQ-010 fake backend pause/resume: queue while paused, ordered flush, deferred exit', () => {
  it('delivers nothing while paused; resume flushes queued output in order', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.write('echo one\n')
    expect(t.data.join('')).toContain('one\r\n')
    handle.pause()
    const before = t.data.length
    handle.write('echo two\n')
    expect(t.data.length, 'no delivery while paused').toBe(before)
    handle.resume()
    const all = t.data.join('')
    expect(all).toContain('two\r\n')
    expect(all.indexOf('one\r\n'), 'order preserved through the pause').toBeLessThan(all.indexOf('two\r\n'))
    expect(t.exits).toEqual([])
  })

  it('double pause and double resume are no-ops', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.pause()
    handle.pause() // idempotent
    handle.write('echo q\n')
    expect(t.data.join('')).not.toContain('q\r\n')
    handle.resume()
    handle.resume() // idempotent
    const snapshot = t.data.join('')
    expect(snapshot).toContain('q\r\n')
    handle.write('echo flowing\n') // delivery is back to normal (no double-flush artifacts)
    expect(t.data.join('')).toContain('flowing\r\n')
    expect(t.data.join('').indexOf('q\r\n')).toBe(snapshot.indexOf('q\r\n')) // nothing duplicated
  })

  it('an exit scripted while paused defers until resume has flushed all queued output', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.pause()
    handle.write('echo last-words\n')
    handle.write('exit 3\n')
    expect(t.exits, 'exit deferred while paused').toEqual([])
    handle.resume()
    const all = t.data.join('')
    expect(all).toContain('last-words\r\n')
    expect(all).toContain(oscD(3))
    expect(all.indexOf('last-words\r\n')).toBeLessThan(all.indexOf(oscD(3)))
    expect(t.exits, 'exit delivered after the queued data (exit-last preserved)').toEqual([3])
  })
})

describe('TEST-789 REQ-011 the flood command: deterministic cat-a-huge-file', () => {
  it('flood N B emits exactly N data emissions of exactly B units between the C marker and D;0', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    const before = t.data.length
    handle.write('flood 4 1000\n')
    const emissions = t.data.slice(before)
    const cAt = emissions.findIndex((d) => d.includes(OSC_C))
    const dAt = emissions.findIndex((d) => d.includes(oscD(0)))
    expect(cAt).toBeGreaterThanOrEqual(0)
    expect(dAt).toBeGreaterThan(cAt)
    const chunks = emissions.slice(cAt + 1, dAt)
    expect(chunks.length, 'exactly N separate chunk emissions').toBe(4)
    for (const c of chunks) expect(c.length).toBe(1000)
    expect(t.exits).toEqual([])
  })

  it('is byte-deterministic across two independent runs', () => {
    const run = (): string => {
      const { handle } = spawnOne()
      const t = tap(handle)
      handle.write('flood 3 257\n')
      return t.data.join('')
    }
    expect(run()).toBe(run())
  })

  it('malformed or oversized args produce one actionable error line + D;1 and the handle survives', () => {
    for (const bad of ['flood 0 100\n', 'flood 2 -5\n', 'flood a b\n', 'flood 2\n', 'flood 17000 1000\n']) {
      const { handle } = spawnOne()
      const t = tap(handle)
      const before = t.data.join('').length
      handle.write(bad)
      const out = t.data.join('').slice(before)
      expect(out, `args must be named in the error for ${JSON.stringify(bad)}`).toContain('flood')
      expect(out).toContain(oscD(1))
      expect(out).not.toContain(oscD(0))
      handle.write('echo alive\n') // the handle is still serviceable (CONV-001: fail loud, not dead)
      expect(t.data.join('')).toContain('alive\r\n')
      expect(t.exits).toEqual([])
    }
  })

  it('every OTHER scripted command is byte-unchanged (unknown-command contract intact)', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.write('frobnicate now\n')
    const out = t.data.join('')
    expect(out).toContain('fake: unknown command "frobnicate now"')
    expect(out).toContain(oscD(127))
  })
})

describe('TEST-790 REQ-010 structural: the interface declares pause/resume; node-pty maps them directly', () => {
  // CONV-032: the searches below are anchored to the specific declaration/mapping shapes;
  // if node-pty-backend.ts renames its `proc` local, update these regexes in the SAME change.
  it('AgentPtyHandle declares pause() and resume()', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/agent/pty-backend.ts'), 'utf8')
    expect(/pause\(\):\s*void/.test(src), 'AgentPtyHandle must declare pause(): void').toBe(true)
    expect(/resume\(\):\s*void/.test(src), 'AgentPtyHandle must declare resume(): void').toBe(true)
  })

  it('node-pty-backend widens the NodePtyProc mirror and maps handle pause/resume onto proc', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/agent/node-pty-backend.ts'), 'utf8')
    expect(/pause\(\):\s*void/.test(src), 'the NodePtyProc mirror must declare pause(): void').toBe(true)
    expect(/resume\(\):\s*void/.test(src), 'the NodePtyProc mirror must declare resume(): void').toBe(true)
    expect(/pause:\s*\(\)\s*=>\s*proc\.pause\(\)/.test(src),
      'the handle must map pause directly onto proc.pause()').toBe(true)
    expect(/resume:\s*\(\)\s*=>\s*proc\.resume\(\)/.test(src),
      'the handle must map resume directly onto proc.resume()').toBe(true)
  })
})
