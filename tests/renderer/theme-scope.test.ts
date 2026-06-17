import { describe, it, expect } from 'vitest'
import { selectionToScope, resolvedForSelection, panePidOf } from '../../src/renderer/components/theme-scope'
import { mergeTheme, resolveTheme } from '../../src/shared/theme'

describe('panePidOf', () => {
  it('extracts the pane id from a pane selection', () => {
    expect(panePidOf('pane:abc')).toBe('abc')
  })
  it('is null for app/workspace selections', () => {
    expect(panePidOf('app')).toBeNull()
    expect(panePidOf('workspace')).toBeNull()
  })
})

describe('selectionToScope', () => {
  it('maps app', () => {
    expect(selectionToScope('app', 'w1')).toEqual({ kind: 'app' })
  })
  it('maps workspace with the active id', () => {
    expect(selectionToScope('workspace', 'w1')).toEqual({ kind: 'workspace', wsId: 'w1' })
  })
  it('maps a pane selection', () => {
    expect(selectionToScope('pane:p9', 'w1')).toEqual({ kind: 'pane', wsId: 'w1', paneId: 'p9' })
  })
})

describe('resolvedForSelection', () => {
  const ws = { theme: { text: '#111' }, panes: { p9: { config: { theme: { text: '#222' } } } } } as never

  it('app resolves the quick (app) theme', () => {
    expect(resolvedForSelection('app', { text: '#999' }, ws)).toEqual(mergeTheme({ text: '#999' }))
  })
  it('workspace resolves app + workspace', () => {
    expect(resolvedForSelection('workspace', { text: '#999' }, ws)).toEqual(resolveTheme({ text: '#999' }, { text: '#111' }, undefined))
  })
  it('pane resolves app + workspace + pane', () => {
    expect(resolvedForSelection('pane:p9', { text: '#999' }, ws)).toEqual(resolveTheme({ text: '#999' }, { text: '#111' }, { text: '#222' }))
  })
})
