import { describe, it, expect } from 'vitest'
import { resolveSpawnSpec } from '../../src/main/pty/spawn-spec'
import type { ShellInfo } from '@shared/types'

const pwsh: ShellInfo = { id: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh.exe', args: [] }
const cmd: ShellInfo = { id: 'cmd', label: 'cmd', path: 'C:\\cmd.exe', args: [] }

describe('resolveSpawnSpec', () => {
  it('uses the launch override verbatim and injects nothing', () => {
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts',
      { command: 'ssh', args: ['kev@host'], title: 'box' })
    expect(spec).toEqual({ file: 'ssh', args: ['kev@host'] })
  })
  it('injects shell integration for an integrated shell', () => {
    const spec = resolveSpawnSpec(pwsh, 'C:\\scripts')
    expect(spec.file).toBe('C:\\pwsh.exe')
    expect(spec.args).toContain('-NoExit')
    expect(spec.env).toEqual({})
  })
  it('falls back to the shell args for a non-integrated shell', () => {
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts')
    expect(spec).toEqual({ file: 'C:\\cmd.exe', args: [], env: undefined })
  })
})
