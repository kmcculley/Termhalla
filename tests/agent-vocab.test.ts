// FROZEN test suite — feature 0017-agent-runtime-skeleton (phase 4).
// REQ-014: the shared agent vocabulary module src/shared/remote-agent-api.ts.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CH } from '@shared/ipc-contract'
import { AGENT_ERROR_CODES, AGENT_PTY_METHODS, type AgentErrorCode } from '@shared/remote-agent-api'

const root = process.cwd()

describe('TEST-749 REQ-014 the closed agent vocabulary constants', () => {
  it('AGENT_ERROR_CODES is exactly the sorted, duplicate-free closed code union', () => {
    expect([...AGENT_ERROR_CODES]).toEqual(['bad-params', 'internal', 'spawn-failed', 'unknown-method', 'unknown-pane'])
    expect([...AGENT_ERROR_CODES]).toEqual([...AGENT_ERROR_CODES].slice().sort())
    expect(new Set(AGENT_ERROR_CODES).size).toBe(AGENT_ERROR_CODES.length)
    const sample: AgentErrorCode = 'unknown-pane'
    expect(AGENT_ERROR_CODES.includes(sample)).toBe(true)
  })

  it('AGENT_PTY_METHODS is exactly the four CH pty method channel values', () => {
    expect([...AGENT_PTY_METHODS]).toEqual(['pty:spawn', 'pty:write', 'pty:resize', 'pty:kill'])
    expect([...AGENT_PTY_METHODS]).toEqual([CH.ptySpawn, CH.ptyWrite, CH.ptyResize, CH.ptyKill])
  })
})

describe('TEST-750 REQ-014 the module is pure and CH-derived at the source level', () => {
  it('is environment-pure (F15 REQ-001 standard) and derives methods from CH, not string literals', () => {
    const src = readFileSync(resolve(root, 'src/shared/remote-agent-api.ts'), 'utf8')
    const forbidden: Array<[RegExp, string]> = [
      [/from\s+['"]node:/, 'a node: builtin import'],
      [/from\s+['"]electron/, 'an electron import'],
      [/\brequire\s*\(/, 'a require() call'],
      [/\bBuffer\b/, 'the Node Buffer global'],
      [/\bprocess\./, 'the Node process global'],
      [/\b__dirname\b/, '__dirname']
    ]
    for (const [re, what] of forbidden) {
      expect(re.test(src), `remote-agent-api.ts references ${what} — must be pure (REQ-014)`).toBe(false)
    }
    // Methods must reference the CH constants, never re-typed channel strings.
    for (const member of ['CH.ptySpawn', 'CH.ptyWrite', 'CH.ptyResize', 'CH.ptyKill']) {
      expect(src.includes(member), `remote-agent-api.ts must derive methods from ${member}`).toBe(true)
    }
    expect(/['"]pty:(spawn|write|resize|kill)['"]/.test(src),
      'remote-agent-api.ts must not hand-type pty channel string literals (REQ-014)').toBe(false)
  })
})
