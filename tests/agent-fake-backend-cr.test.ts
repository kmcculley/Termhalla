// A real terminal sends CR ('\r') on Enter — xterm in the app does exactly that — while every
// programmatic writer in the vitest suites sends '\n'. The fake backend's line parser recognized
// only '\n', so an in-app keystroke round-trip against `--pty=fake` typed commands that never
// ran (caught by tests/e2e/remote-connected.spec.ts the first time a live keyboard drove it).
// The scripted-command contract is now "a line terminated by \n, \r, or \r\n"; these pin the
// CR shapes. The original \n shapes stay pinned by the FROZEN tests/agent-fake-backend.test.ts.
import { describe, it, expect } from 'vitest'
import { createFakePtyBackend } from '../src/agent/fake-backend'

const spawn = () =>
  createFakePtyBackend().spawn({ id: 'p1', cwd: '/home/u', cols: 80, rows: 24, shellId: 'default' })

const collect = (handle: ReturnType<typeof spawn>): string[] => {
  const out: string[] = []
  handle.onData(d => out.push(d))
  return out
}

describe('fake backend CR line termination', () => {
  it('runs a command terminated by a bare \\r (what xterm sends on Enter)', () => {
    const handle = spawn()
    const out = collect(handle)
    handle.write('echo hi\r')
    expect(out.join('')).toContain('hi\r\n')
  })

  it('treats \\r\\n as ONE terminator (no phantom empty command)', () => {
    const handle = spawn()
    const out = collect(handle)
    handle.write('echo one\r\necho two\r\n')
    const joined = out.join('')
    expect(joined).toContain('one\r\n')
    expect(joined).toContain('two\r\n')
    expect(joined).not.toContain('unknown command ""')
  })

  it('handles a terminator split across writes', () => {
    const handle = spawn()
    const out = collect(handle)
    handle.write('echo split')
    handle.write('\r')
    expect(out.join('')).toContain('split\r\n')
  })

  it('a scripted exit via \\r still exits with the code', () => {
    const handle = spawn()
    let code: number | null = null
    handle.onExit(c => { code = c })
    handle.onData(() => {})
    handle.write('exit 3\r')
    expect(code).toBe(3)
  })
})
