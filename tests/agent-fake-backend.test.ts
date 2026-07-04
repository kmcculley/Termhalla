// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// REQ-012: the deterministic fake pty backend — the CI substance behind --pty=fake.
// The scripted contract: OSC 133 markers (BEL-terminated), no tty echo, synchronous
// deterministic emission, data always before exit.
import { describe, it, expect } from 'vitest'
import { createFakePtyBackend } from '../src/agent/fake-backend'
import type { AgentPtyHandle } from '../src/agent/pty-backend'

const OSC_A = '\x1b]133;A\x07'
const OSC_C = '\x1b]133;C\x07'
const oscD = (code: number): string => `\x1b]133;D;${code}\x07`
const osc99 = (path: string): string => `\x1b]9;9;${path}\x07`

interface Tap { data: string[]; exits: number[] }

const tap = (h: AgentPtyHandle): Tap => {
  const t: Tap = { data: [], exits: [] }
  h.onData((d) => t.data.push(d))
  h.onExit((c) => t.exits.push(c))
  return t
}

const spawnOne = (opts?: Partial<{ id: string; cwd: string; cols: number; rows: number; shellId: string }>) => {
  const backend = createFakePtyBackend()
  const handle = backend.spawn({ id: 'p1', cwd: '/home/u', cols: 80, rows: 24, shellId: 'default', ...opts })
  return { backend, handle }
}

describe('TEST-762 REQ-012 spawn burst, echo, and the unknown-command contract', () => {
  it('emits the OSC 133 prompt marker on spawn even when onData attaches after spawn', () => {
    const { handle } = spawnOne()
    const t = tap(handle) // attached AFTER spawn — the initial burst must still be delivered
    const all = t.data.join('')
    expect(all).toContain(OSC_A)
    expect(t.exits).toEqual([])
  })

  it('echo emits busy marker, the text, D;0 and a fresh prompt marker — no tty echo of the input', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    const before = t.data.join('').length
    handle.write('echo hi there\n')
    const out = t.data.join('').slice(before)
    const cAt = out.indexOf(OSC_C)
    const textAt = out.indexOf('hi there\r\n')
    const dAt = out.indexOf(oscD(0))
    const aAt = out.indexOf(OSC_A)
    expect(cAt, 'busy marker first').toBeGreaterThanOrEqual(0)
    expect(textAt, 'then the echoed text').toBeGreaterThan(cAt)
    expect(dAt, 'then D;0').toBeGreaterThan(textAt)
    expect(aAt, 'then the prompt marker').toBeGreaterThan(dAt)
    expect(out).not.toContain('echo hi there\n') // the typed line itself is not echoed back
  })

  it('an unknown command reports it verbatim and finishes D;127', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.write('frobnicate now\n')
    const out = t.data.join('')
    expect(out).toContain('fake: unknown command "frobnicate now"')
    expect(out).toContain(oscD(127))
  })

  it('buffers partial lines until the newline arrives', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    const before = t.data.join('')
    handle.write('echo sp')
    expect(t.data.join('')).toBe(before) // nothing runs before the newline
    handle.write('lit\n')
    expect(t.data.join('')).toContain('split\r\n')
  })
})

describe('TEST-763 REQ-012 cwd/pwd/size/exit/kill and determinism', () => {
  it('cwd emits the OSC 9;9 sequence verbatim; pwd reports the spawn cwd', () => {
    const { handle } = spawnOne({ cwd: '/home/kevin/dev' })
    const t = tap(handle)
    handle.write('cwd /tmp/elsewhere\n')
    expect(t.data.join('')).toContain(osc99('/tmp/elsewhere'))
    handle.write('pwd\n')
    expect(t.data.join('')).toContain('/home/kevin/dev\r\n')
  })

  it('size reports the current dimensions and observes resize', () => {
    const { handle } = spawnOne({ cols: 80, rows: 24 })
    const t = tap(handle)
    handle.write('size\n')
    expect(t.data.join('')).toContain('size=80x24\r\n')
    handle.resize(120, 40)
    handle.write('size\n')
    expect(t.data.join('')).toContain('size=120x40\r\n')
  })

  it('exit <code> emits D;<code> then exits with that code, data strictly before exit', () => {
    const { handle } = spawnOne()
    const seen: Array<['data', string] | ['exit', number]> = []
    handle.onData((d) => seen.push(['data', d]))
    handle.onExit((c) => seen.push(['exit', c]))
    handle.write('exit 7\n')
    const exitIdx = seen.findIndex(([k]) => k === 'exit')
    expect(exitIdx).toBeGreaterThan(0)
    expect(seen[exitIdx]).toEqual(['exit', 7])
    expect(seen.slice(exitIdx + 1)).toEqual([]) // nothing after exit
    expect(seen.slice(0, exitIdx).map(([, v]) => v).join('')).toContain(oscD(7))
  })

  it('kill() exits with code 0', () => {
    const { handle } = spawnOne()
    const t = tap(handle)
    handle.kill()
    expect(t.exits).toEqual([0])
  })

  it('the same scripted session twice yields byte-identical output (determinism)', () => {
    const run = (): string => {
      const { handle } = spawnOne({ cwd: '/home/x', cols: 100, rows: 30 })
      const t = tap(handle)
      handle.write('echo a\n')
      handle.resize(90, 25)
      handle.write('size\n')
      handle.write('cwd /srv\n')
      handle.write('exit 3\n')
      return t.data.join('') + `|exits=${t.exits.join(',')}`
    }
    expect(run()).toBe(run())
  })
})
