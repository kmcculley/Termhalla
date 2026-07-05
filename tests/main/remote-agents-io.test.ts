// FROZEN test suite — feature 0022-client-routing-remote-workspace-ux (phase 4 / TASK-009).
// REQ-004: the named-agent registry wiring seam. The F19 store (src/remote-client/agents-store.ts)
// is already frozen-tested for atomicity/normalization; what THIS feature owns is the seam the
// registrar exposes over it.
//
// Chosen contract (freezing the plan's TASK-009 prose): `src/main/ipc/register-remote.ts` exports,
// besides the electron-coupled registrar, a pure factory
//   createRemoteAgentsIo(filePath: string): {
//     list(): Promise<NamedAgent[]>
//     save(agents: unknown): Promise<NamedAgent[]>   // normalize -> atomic write -> normalized list
//   }
// used by the registrar's remote:agentsList / remote:agentsSave handlers. `save` REJECTS when the
// disk write fails (the envSetGlobal precedent — the UI must never toast a false success), and
// both doors normalize (no secret field survives a round-trip in either direction).
//
// Runs RED today: src/main/ipc/register-remote.ts does not exist.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteAgentsIo } from '../../src/main/ipc/register-remote'

const tmp = () => mkdtempSync(join(tmpdir(), 'th-remote-agents-'))

describe('named-agent registry IO seam (REQ-004)', () => {
  it('TEST-2222 REQ-004 missing file -> [], and a save round-trips the normalized list through the injected path', async () => {
    const dir = tmp()
    try {
      const io = createRemoteAgentsIo(join(dir, 'remote-agents.json'))
      expect(await io.list()).toEqual([])
      const saved = await io.save([{ id: 'a-1', name: 'buildbox', host: 'bb.local', user: 'kevin' }])
      expect(saved).toEqual([{ id: 'a-1', name: 'buildbox', host: 'bb.local', user: 'kevin' }])
      expect(await io.list()).toEqual(saved)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('TEST-2223 REQ-004 unknown (possibly secret) fields are stripped on SAVE and on LIST (both doors normalize)', async () => {
    const dir = tmp()
    const file = join(dir, 'remote-agents.json')
    try {
      const io = createRemoteAgentsIo(file)
      const saved = await io.save([{ id: 'a-1', name: 'n', host: 'h', user: 'u', password: 'hunter2' }])
      expect(JSON.stringify(saved)).not.toContain('hunter2')
      expect(readFileSync(file, 'utf8')).not.toContain('hunter2') // nothing secret persisted
      // A hand-edited file smuggling a field is stripped on the read door too:
      writeFileSync(file, JSON.stringify([{ id: 'a-2', name: 'n2', host: 'h2', user: 'u2', token: 'ssh-secret' }]))
      const listed = await io.list()
      expect(listed).toEqual([{ id: 'a-2', name: 'n2', host: 'h2', user: 'u2' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('TEST-2224 REQ-004 malformed records are dropped and garbage JSON reads as [] (CONV-002, never a throw)', async () => {
    const dir = tmp()
    const file = join(dir, 'remote-agents.json')
    try {
      const io = createRemoteAgentsIo(file)
      writeFileSync(file, '{not json')
      expect(await io.list()).toEqual([])
      const saved = await io.save([{ id: '', name: 'x', host: 'h', user: 'u' }, 'garbage', { id: 'ok', name: 'n', host: 'h', user: 'u' }])
      expect(saved).toEqual([{ id: 'ok', name: 'n', host: 'h', user: 'u' }])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('TEST-2225 REQ-004 a failed disk write REJECTS (no false success)', async () => {
    const dir = tmp()
    try {
      // A directory occupying the target path makes the atomic rename fail deterministically.
      const asDir = join(dir, 'remote-agents.json')
      mkdirSync(asDir)
      const io = createRemoteAgentsIo(asDir)
      await expect(io.save([{ id: 'a', name: 'n', host: 'h', user: 'u' }])).rejects.toBeTruthy()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
