// Characterization tests pin the behavior the system had at baseline. They are a CHANGE-DETECTOR, not a
// correctness oracle: a failure means behavior CHANGED — a human adjudicates whether that is an intended
// change (update the test) or a regression (fix the code). Captured by /orky:discover; do not hand-edit.
//
// Subsystem: process-tree reconstruction (src/main/proc/proc-tree.ts) and AI-session detection
// (src/main/ai/classify-ai.ts).
import { describe, it, expect } from 'vitest'
import {
  parseCimRows, parseCimDate, cleanName, descendantsOf, pickForeground, buildProcInfo
} from '../src/main/proc/proc-tree'
import { classifyAiSession } from '../src/main/ai/classify-ai'
import type { ProcNode } from '@shared/types'

describe('CHAR-006 proc-tree: CIM row & date parsing', () => {
  it('parseCimRows accepts a single object or an array, dropping rows without finite pids', () => {
    const one = parseCimRows(JSON.stringify({ ProcessId: 5, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node x', CreationDate: null }))
    expect(one).toEqual([{ ProcessId: 5, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node x', CreationDate: null }])
    const many = parseCimRows(JSON.stringify([
      { ProcessId: 5, ParentProcessId: 1, Name: 'a' },
      { ProcessId: 'nope', ParentProcessId: 1, Name: 'b' }
    ]))
    expect(many).toHaveLength(1)
    expect(many[0].ProcessId).toBe(5)
  })
  it('parseCimRows returns [] on malformed JSON', () => {
    expect(parseCimRows('not json')).toEqual([])
    expect(parseCimRows('')).toEqual([])
  })
  it('parseCimDate reads the WMI /Date(ms)/ form and ISO strings; 0 when unknown', () => {
    expect(parseCimDate('/Date(1700000000000)/')).toBe(1700000000000)
    expect(parseCimDate('2023-01-01T00:00:00.000Z')).toBe(Date.parse('2023-01-01T00:00:00.000Z'))
    expect(parseCimDate(null)).toBe(0)
    expect(parseCimDate('garbage')).toBe(0)
  })
  it('cleanName strips a trailing .exe (case-insensitive) only', () => {
    expect(cleanName('node.exe')).toBe('node')
    expect(cleanName('Powershell.EXE')).toBe('Powershell')
    expect(cleanName('bash')).toBe('bash')
  })
})

describe('CHAR-007 proc-tree: descendant tree & foreground selection', () => {
  const rows = parseCimRows(JSON.stringify([
    { ProcessId: 100, ParentProcessId: 1, Name: 'pwsh.exe', CommandLine: 'pwsh', CreationDate: '/Date(1000)/' },
    { ProcessId: 200, ParentProcessId: 100, Name: 'node.exe', CommandLine: 'node a.js', CreationDate: '/Date(2000)/' },
    { ProcessId: 300, ParentProcessId: 100, Name: 'git.exe', CommandLine: 'git log', CreationDate: '/Date(3000)/' },
    { ProcessId: 400, ParentProcessId: 300, Name: 'less.exe', CommandLine: '', CreationDate: '/Date(3500)/' }
  ]))
  it('descendantsOf excludes the shell, emits DFS pre-order with depth, sorted by creation time', () => {
    const tree = descendantsOf(rows, 100)
    expect(tree.map(n => [n.name, n.depth])).toEqual([
      ['node', 0], ['git', 0], ['less', 1]
    ])
    // empty CommandLine falls back to the cleaned name as `command`
    expect(tree.find(n => n.name === 'less')?.command).toBe('less')
    expect(tree.find(n => n.name === 'node')?.command).toBe('node a.js')
  })
  it('pickForeground follows the most-recently-created child to the deepest leaf', () => {
    expect(pickForeground(rows, 100)?.ProcessId).toBe(400) // pwsh -> git(newest) -> less
  })
  it('buildProcInfo reports the foreground leaf name and the descendant tree', () => {
    const info = buildProcInfo(rows, 100)
    expect(info.foreground).toBe('less')
    expect(info.tree.map(n => n.name)).toEqual(['node', 'git', 'less'])
  })
  it('an idle shell with no children yields an empty foreground and tree', () => {
    expect(buildProcInfo(rows, 999)).toEqual({ foreground: '', tree: [] })
  })
})

describe('CHAR-008 classifyAiSession', () => {
  const node = (command: string, name = 'node'): ProcNode => ({ pid: 1, ppid: 0, name, command, depth: 0 })
  it('detects the claude-code CLI, a claude.cmd shim, and a bare claude program', () => {
    expect(classifyAiSession([node('node ...@anthropic-ai\\claude-code\\cli.js')])).toEqual({ tool: 'claude', label: 'Claude' })
    expect(classifyAiSession([node('cmd /c "C:\\tools\\claude.cmd"', 'cmd.exe')])).toEqual({ tool: 'claude', label: 'Claude' })
    expect(classifyAiSession([node('claude --resume', 'claude')])).toEqual({ tool: 'claude', label: 'Claude' })
  })
  it('detects codex and finds a tool anywhere in the tree', () => {
    expect(classifyAiSession([node('node @openai/codex/bin.js')])).toEqual({ tool: 'codex', label: 'Codex' })
    expect(classifyAiSession([node('pwsh', 'pwsh'), node('claude.cmd', 'claude.cmd')])?.tool).toBe('claude')
  })
  it('does NOT match a claude.md doc argument (false-positive guard) and returns null otherwise', () => {
    expect(classifyAiSession([node('vim claude.md', 'vim')])).toBeNull()
    expect(classifyAiSession([node('npm run dev'), node('node vite.js')])).toBeNull()
  })
})
