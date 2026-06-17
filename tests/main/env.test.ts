import { describe, it, expect } from 'vitest'
import { sanitizeShellEnv } from '../../src/main/pty/env'

describe('sanitizeShellEnv', () => {
  it('removes Electron-injected variables', () => {
    const out = sanitizeShellEnv({
      PATH: 'C:\\Windows',
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      ELECTRON_RENDERER_URL: 'http://localhost:5173',
      USERPROFILE: 'C:\\Users\\dev'
    })
    expect(out.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(out.ELECTRON_NO_ATTACH_CONSOLE).toBeUndefined()
    expect(out.ELECTRON_RENDERER_URL).toBeUndefined()
  })
  it('preserves normal user environment variables', () => {
    const out = sanitizeShellEnv({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev', FOO: 'bar' })
    expect(out).toEqual({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev', FOO: 'bar' })
  })
  it('does not mutate the input object', () => {
    const input = { ELECTRON_RUN_AS_NODE: '1', PATH: 'x' }
    sanitizeShellEnv(input)
    expect(input.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
