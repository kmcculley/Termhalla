import { describe, it, expect } from 'vitest'
import { reorderIds } from '../../src/shared/workspace-model'

describe('reorderIds', () => {
  it('moves an id forward to the target position', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a'])
  })
  it('moves an id backward to the target position', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })
  it('is a no-op when from === to or either is missing', () => {
    expect(reorderIds(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
    expect(reorderIds(['a', 'b'], 'x', 'a')).toEqual(['a', 'b'])
    expect(reorderIds(['a', 'b'], 'a', 'x')).toEqual(['a', 'b'])
  })
})
