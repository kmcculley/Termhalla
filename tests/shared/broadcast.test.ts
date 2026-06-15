import { describe, it, expect } from 'vitest'
import { encodeBroadcast, terminalPaneIds } from '../../src/shared/broadcast'
import type { Workspace } from '../../src/shared/types'

describe('encodeBroadcast', () => {
  it('keys mode sends raw bytes with newlines as CR', () => {
    expect(encodeBroadcast('a\nb', 'keys', false)).toBe('a\rb')
  })
  it('paste mode wraps in bracketed-paste markers', () => {
    expect(encodeBroadcast('x', 'paste', false)).toBe('\x1b[200~x\x1b[201~')
  })
  it('appends a trailing CR (outside the paste wrapper) when enter is true', () => {
    expect(encodeBroadcast('x', 'keys', true)).toBe('x\r')
    expect(encodeBroadcast('x', 'paste', true)).toBe('\x1b[200~x\x1b[201~\r')
  })
})

describe('terminalPaneIds', () => {
  it('returns only terminal pane ids', () => {
    const ws = { id: 'w', name: 'W', layout: 'a', panes: {
      a: { paneId: 'a', config: { kind: 'terminal', shellId: 's', cwd: '' } },
      b: { paneId: 'b', config: { kind: 'editor', files: [] } },
      c: { paneId: 'c', config: { kind: 'terminal', shellId: 's', cwd: '' } }
    } } as unknown as Workspace
    expect(terminalPaneIds(ws).sort()).toEqual(['a', 'c'])
  })
  it('is empty when there are no terminals', () => {
    const ws = { id: 'w', name: 'W', layout: null, panes: {} } as unknown as Workspace
    expect(terminalPaneIds(ws)).toEqual([])
  })
})
