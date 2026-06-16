import { describe, it, expect } from 'vitest'
import { INDENT_PX } from '../src/renderer/ui-tokens'

describe('ui-tokens', () => {
  it('exports a numeric indent step', () => {
    expect(typeof INDENT_PX).toBe('number')
    expect(INDENT_PX).toBe(14)
  })
})
