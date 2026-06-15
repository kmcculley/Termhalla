import { describe, it, expect } from 'vitest'
import { draftKey, resolveDraftOnOpen, UNTITLED, isUntitled } from '../../src/shared/editor-draft'

describe('draftKey', () => {
  it('combines paneId and path with the :: separator (matches the fs-watch id scheme)', () => {
    expect(draftKey('p1', 'C:\\dev\\a.ts')).toBe('p1::C:\\dev\\a.ts')
  })
})

describe('resolveDraftOnOpen', () => {
  it('passes disk content through when there is no draft', () => {
    expect(resolveDraftOnOpen('on disk', undefined)).toEqual({ content: 'on disk', dirty: false, externalChanged: false })
  })
  it('treats a missing file with no draft as empty content', () => {
    expect(resolveDraftOnOpen(null, undefined)).toEqual({ content: '', dirty: false, externalChanged: false })
  })
  it('restores the draft as dirty when disk is unchanged vs the baseline', () => {
    const r = resolveDraftOnOpen('base', { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: false })
  })
  it('flags externalChanged when disk differs from the draft baseline', () => {
    const r = resolveDraftOnOpen('disk moved', { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: true })
  })
  it('flags externalChanged for a now-deleted file with a draft', () => {
    const r = resolveDraftOnOpen(null, { content: 'edited', baseline: 'base' })
    expect(r).toEqual({ content: 'edited', dirty: true, externalChanged: true })
  })
  it('reports not-dirty when the draft equals disk (stale draft)', () => {
    const r = resolveDraftOnOpen('same', { content: 'same', baseline: 'base' })
    expect(r).toEqual({ content: 'same', dirty: false, externalChanged: true })
  })
})

describe('UNTITLED sentinel', () => {
  it('is a non-empty sentinel that is not a real path', () => {
    expect(typeof UNTITLED).toBe('string')
    expect(UNTITLED.length).toBeGreaterThan(0)
    expect(/[<>]/.test(UNTITLED)).toBe(true) // contains chars invalid in Windows paths
    expect(isUntitled('C:\\dev\\untitled')).toBe(false) // an absolute path is never the sentinel
  })
  it('isUntitled matches only the sentinel', () => {
    expect(isUntitled(UNTITLED)).toBe(true)
    expect(isUntitled('C:\\dev\\a.ts')).toBe(false)
    expect(isUntitled('untitled')).toBe(false)
    expect(isUntitled('')).toBe(false)
  })
  it('draftKey works with the sentinel', () => {
    expect(draftKey('p1', UNTITLED)).toBe(`p1::${UNTITLED}`)
  })
})
