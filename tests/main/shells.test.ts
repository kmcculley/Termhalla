import { describe, it, expect } from 'vitest'
import { detectShells, DEFAULT_SHELL_CANDIDATES } from '../../src/main/pty/shells'

describe('detectShells', () => {
  it('returns only candidates whose executable exists', () => {
    const candidates = [
      { id: 'a', label: 'A', path: 'C:\\real.exe', args: [] },
      { id: 'b', label: 'B', path: 'C:\\missing.exe', args: [] }
    ]
    const exists = (p: string) => p === 'C:\\real.exe'
    const shells = detectShells(candidates, exists)
    expect(shells.map(s => s.id)).toEqual(['a'])
  })

  it('always includes a guaranteed fallback even if nothing else exists', () => {
    const shells = detectShells(DEFAULT_SHELL_CANDIDATES, () => false)
    expect(shells.length).toBeGreaterThanOrEqual(1)
    expect(shells.some(s => s.id === 'cmd')).toBe(true)
  })
})
