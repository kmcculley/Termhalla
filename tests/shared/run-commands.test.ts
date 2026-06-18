import { describe, it, expect } from 'vitest'
import { addRunCommand, updateRunCommand, removeRunCommand } from '../../src/shared/run-commands'
import type { RunCommand } from '../../src/shared/types'

const a: RunCommand = { id: 'a', label: 'Test', command: 'npm test' }
const b: RunCommand = { id: 'b', label: 'Build', command: 'npm run build' }

describe('addRunCommand', () => {
  it('appends immutably and treats undefined as empty', () => {
    const out = addRunCommand(undefined, a)
    expect(out).toEqual([a])
    const out2 = addRunCommand([a], b)
    expect(out2).toEqual([a, b])
    expect(out2).not.toBe(out)   // new array
  })
})

describe('updateRunCommand', () => {
  it('patches the matching id and leaves others', () => {
    const out = updateRunCommand([a, b], 'a', { label: 'Test!', command: 'npm t' })
    expect(out).toEqual([{ id: 'a', label: 'Test!', command: 'npm t' }, b])
  })
  it('no-ops for an unknown id', () => {
    expect(updateRunCommand([a], 'zzz', { label: 'x' })).toEqual([a])
  })
  it('treats undefined as empty', () => {
    expect(updateRunCommand(undefined, 'a', { label: 'x' })).toEqual([])
  })
})

describe('removeRunCommand', () => {
  it('filters by id; no-op on unknown', () => {
    expect(removeRunCommand([a, b], 'a')).toEqual([b])
    expect(removeRunCommand([a], 'zzz')).toEqual([a])
    expect(removeRunCommand(undefined, 'a')).toEqual([])
  })
})
