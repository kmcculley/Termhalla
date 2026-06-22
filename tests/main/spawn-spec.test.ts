import { describe, it, expect, vi } from 'vitest'
import { resolveSpawnSpec } from '../../src/main/pty/spawn-spec'
import type { ShellInfo } from '@shared/types'

const pwsh: ShellInfo = { id: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh.exe', args: [] }
const cmd: ShellInfo = { id: 'cmd', label: 'cmd', path: 'C:\\cmd.exe', args: [] }

describe('resolveSpawnSpec', () => {
  it('resolves a relative launch command to its absolute path on PATH', () => {
    // node-pty's Windows resolver matches the bare name verbatim (no PATHEXT), so it can't
    // find ssh.exe from "ssh". Resolve it to a full path here so node-pty spawns it directly.
    const resolve = vi.fn().mockReturnValue('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts',
      { command: 'ssh', args: ['kev@host'], title: 'box' }, resolve)
    expect(resolve).toHaveBeenCalledWith('ssh')
    expect(spec).toEqual({ file: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe', args: ['kev@host'] })
  })

  it('keeps the bare command when the resolver cannot find it (CLI not installed)', () => {
    // Falling back to the bare name lets node-pty surface its "File not found" error, which now
    // genuinely means "not on PATH" rather than "wrong extension".
    const resolve = vi.fn().mockReturnValue(null)
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts',
      { command: 'aws', args: ['sso', 'login'], title: 'aws' }, resolve)
    expect(spec).toEqual({ file: 'aws', args: ['sso', 'login'] })
  })

  it('uses an absolute launch command verbatim without resolving', () => {
    const resolve = vi.fn()
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts',
      { command: 'C:\\tools\\ssh.exe', args: ['kev@host'], title: 'box' }, resolve)
    expect(resolve).not.toHaveBeenCalled()
    expect(spec).toEqual({ file: 'C:\\tools\\ssh.exe', args: ['kev@host'] })
  })

  it('injects shell integration for an integrated shell', () => {
    const spec = resolveSpawnSpec(pwsh, 'C:\\scripts')
    expect(spec.file).toBe('C:\\pwsh.exe')
    expect(spec.args).toContain('-NoExit')
    expect(spec.env).toEqual({})
  })

  it('injects a cwd-reporting PROMPT env for cmd (keeping its own args)', () => {
    const spec = resolveSpawnSpec(cmd, 'C:\\scripts')
    expect(spec.file).toBe('C:\\cmd.exe')
    expect(spec.args).toEqual([])
    expect(spec.env?.PROMPT).toContain(']9;9;')
  })

  it('falls back to the shell args with no env for a non-integrated shell', () => {
    const other: ShellInfo = { id: 'fish', label: 'fish', path: 'C:\\fish.exe', args: ['-l'] }
    const spec = resolveSpawnSpec(other, 'C:\\scripts')
    expect(spec).toEqual({ file: 'C:\\fish.exe', args: ['-l'], env: undefined })
  })
})
