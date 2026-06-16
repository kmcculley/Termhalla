import { describe, it, expect } from 'vitest'
import { relativeTo } from '../src/shared/paths'

describe('relativeTo', () => {
  it('strips a backslash root', () => {
    expect(relativeTo('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src\\a.ts')
  })
  it('strips a forward-slash root', () => {
    expect(relativeTo('/home/p', '/home/p/src/a.ts')).toBe('src/a.ts')
  })
  it('tolerates a trailing separator on root', () => {
    expect(relativeTo('C:\\proj\\', 'C:\\proj\\a.ts')).toBe('a.ts')
  })
  it('returns empty for the root itself', () => {
    expect(relativeTo('C:\\proj', 'C:\\proj')).toBe('')
  })
  it('returns the input unchanged when not under root', () => {
    expect(relativeTo('C:\\proj', 'D:\\other\\a.ts')).toBe('D:\\other\\a.ts')
  })
})
