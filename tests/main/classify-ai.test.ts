import { describe, it, expect } from 'vitest'
import { classifyAiSession } from '../../src/main/ai/classify-ai'
import type { ProcNode } from '@shared/types'

const node = (command: string, name = 'node'): ProcNode => ({ pid: 1, ppid: 0, name, command, depth: 0 })

describe('classifyAiSession', () => {
  it('matches a node invocation of the claude-code CLI', () => {
    const tree = [node('node C:\\Users\\k\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js')]
    expect(classifyAiSession(tree)).toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches a claude.cmd shim by name/command', () => {
    expect(classifyAiSession([node('C:\\Windows\\system32\\cmd.exe /c "C:\\tools\\claude.cmd"', 'cmd.exe')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches a bare claude program', () => {
    expect(classifyAiSession([node('claude --resume', 'claude')])).toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('matches codex', () => {
    expect(classifyAiSession([node('node /usr/lib/node_modules/@openai/codex/bin.js')]))
      .toEqual({ tool: 'codex', label: 'Codex' })
  })
  it('does NOT match a claude.md file argument (false-positive guard)', () => {
    expect(classifyAiSession([node('vim claude.md', 'vim')])).toBeNull()
    expect(classifyAiSession([node('node build.js --out claudeesque.md')])).toBeNull()
  })
  it('finds the tool anywhere in the tree', () => {
    const tree = [node('pwsh', 'pwsh'), node('claude.cmd', 'claude.cmd'), node('rg foo', 'rg')]
    expect(classifyAiSession(tree)?.tool).toBe('claude')
  })
  it('matches by process name when the command does not contain the tool', () => {
    expect(classifyAiSession([node('C:\\Windows\\system32\\cmd.exe', 'claude')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('returns null for an ordinary tree', () => {
    expect(classifyAiSession([node('npm run dev'), node('node vite.js')])).toBeNull()
  })
})
