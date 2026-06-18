import { describe, it, expect, vi, afterEach } from 'vitest'

// Control the child_process.execFile callback per-test without spawning a real PowerShell.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }))

import { queryProcesses } from '../../src/main/proc/cim-query'

afterEach(() => { vi.restoreAllMocks(); execFileMock.mockReset() })

describe('queryProcesses', () => {
  it('resolves [], logs a diagnostic, and includes stderr when the query fails', async () => {
    execFileMock.mockImplementation((_f: string, _a: string[], _o: object, cb: (e: Error | null, out: string, err: string) => void) =>
      cb(new Error('boom'), '', 'PS> Access is denied'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const rows = await queryProcesses(10)

    expect(rows).toEqual([])                                       // still degrades to empty, never rejects
    expect(warn).toHaveBeenCalled()                               // failure is no longer silent
    expect(warn.mock.calls.flat().join(' ')).toContain('Access is denied') // stderr is surfaced
  })

  it('parses stdout on success', async () => {
    const sample = JSON.stringify([{ ProcessId: 10, ParentProcessId: 4, Name: 'pwsh.exe', CommandLine: null, CreationDate: null }])
    execFileMock.mockImplementation((_f: string, _a: string[], _o: object, cb: (e: Error | null, out: string, err: string) => void) =>
      cb(null, sample, ''))

    const rows = await queryProcesses(10)

    expect(rows).toHaveLength(1)
    expect(rows[0].ProcessId).toBe(10)
  })
})
