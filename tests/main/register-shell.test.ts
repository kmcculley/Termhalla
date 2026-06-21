import { describe, it, expect, vi } from 'vitest'
import { safeOpenExternal } from '../../src/main/ipc/register-shell'

describe('safeOpenExternal', () => {
  it('opens http and https URLs', () => {
    const open = vi.fn()
    safeOpenExternal('http://example.com', open)
    safeOpenExternal('https://example.com/a?b=1', open)
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('ignores non-http(s) schemes and garbage', () => {
    const open = vi.fn()
    safeOpenExternal('file:///etc/passwd', open)
    safeOpenExternal('javascript:alert(1)', open)
    safeOpenExternal('not a url', open)
    expect(open).not.toHaveBeenCalled()
  })
})
