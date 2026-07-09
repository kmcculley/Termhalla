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

  // Baseline KNOWN BUG #1 (fixed 2026-07-09): claude-code / @anthropic-ai/claude / @openai/codex
  // were plain substrings, so a command line merely CONTAINING them — a directory named
  // claude-codebase, my-claude-code-notes — classified as a live session and lit the ✨ chip.
  it('does NOT match a directory that merely contains claude-code as a substring', () => {
    expect(classifyAiSession([node('cd C:\\dev\\claude-codebase', 'cmd.exe')])).toBeNull()
    expect(classifyAiSession([node('rg foo C:\\notes\\my-claude-code-notes', 'rg')])).toBeNull()
    expect(classifyAiSession([node('git -C /home/k/claude-codegen status', 'git')])).toBeNull()
  })
  it('does NOT match scoped-package lookalikes with a suffixed word', () => {
    expect(classifyAiSession([node('node @anthropic-ai/claudette/cli.js')])).toBeNull()
    expect(classifyAiSession([node('node @openai/codexify/bin.js')])).toBeNull()
  })
  it('still matches genuine claude-code segments in every real shape', () => {
    expect(classifyAiSession([node('npx claude-code')])).toEqual({ tool: 'claude', label: 'Claude' })
    expect(classifyAiSession([node('C:\\npm\\claude-code.cmd', 'claude-code.cmd')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
    expect(classifyAiSession([node('node /usr/lib/node_modules/claude-code/dist/cli.js')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
    expect(classifyAiSession([node('node .../@anthropic-ai/claude/cli.js')]))
      .toEqual({ tool: 'claude', label: 'Claude' })
  })
})
