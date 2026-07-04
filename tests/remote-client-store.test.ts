// FROZEN test suite — feature 0020-ssh-tunnel-provisioned-bootstrap (phase 4).
// The path-injected named-agent registry store (REQ-004): normalized on read AND write, atomic
// save, never a throw on missing/garbage input. F19 binds no persistence location — the path is
// the caller's (F21 wires it under Electron userData).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNamedAgents, saveNamedAgents } from '../src/remote-client/agents-store'

let dir = ''
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'termhalla-agents-store-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const file = () => join(dir, 'remote-agents.json')

describe('TEST-2019 REQ-004 registry store behavior', () => {
  it('missing file → [] (never a throw)', async () => {
    await expect(loadNamedAgents(file())).resolves.toEqual([])
  })

  it('garbage JSON → [] (never a throw)', async () => {
    writeFileSync(file(), '{nope')
    await expect(loadNamedAgents(file())).resolves.toEqual([])
  })

  it('round-trip preserves valid records and strips injected unknown/secret fields', async () => {
    await saveNamedAgents(file(), [
      { id: 'a', name: 'n', host: 'h', user: 'u', port: 2222, password: 'hunter2' } as never
    ])
    const loaded = await loadNamedAgents(file())
    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({ id: 'a', name: 'n', host: 'h', user: 'u', port: 2222 })
    expect(readFileSync(file(), 'utf8')).not.toContain('hunter2')
  })

  it('save is atomic: the final file parses and no temp file survives', async () => {
    await saveNamedAgents(file(), [{ id: 'a', name: 'n', host: 'h', user: 'u' }])
    const names = readdirSync(dir)
    expect(names).toEqual(['remote-agents.json'])
    expect(() => JSON.parse(readFileSync(file(), 'utf8'))).not.toThrow()
  })

  it('save over an existing file replaces its content fully', async () => {
    await saveNamedAgents(file(), [{ id: 'old', name: 'o', host: 'h', user: 'u' }])
    await saveNamedAgents(file(), [{ id: 'new', name: 'n', host: 'h2', user: 'u2' }])
    const loaded = await loadNamedAgents(file())
    expect(loaded.map((a) => a.id)).toEqual(['new'])
  })
})
