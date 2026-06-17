import { describe, it, expect } from 'vitest'
import { updateDialog } from '../../src/main/update-ui'

describe('updateDialog', () => {
  const packaged = { isPackaged: true, interactive: true }

  it('returns null for every event when not interactive (background check is silent)', () => {
    for (const e of ['checking', 'available', 'not-available', 'downloaded', 'error'] as const) {
      expect(updateDialog(e, { isPackaged: true, interactive: false })).toBeNull()
    }
  })

  it('dev + interactive: a check reports that updates need an installed build', () => {
    const d = updateDialog('checking', { isPackaged: false, interactive: true })
    expect(d).toMatchObject({ kind: 'info' })
    expect(d?.message).toMatch(/installed build/i)
    // other events in dev are silent
    expect(updateDialog('error', { isPackaged: false, interactive: true })).toBeNull()
  })

  it('packaged + interactive: checking is silent (no blocking dialog mid-check)', () => {
    expect(updateDialog('checking', packaged)).toBeNull()
  })

  it('packaged + interactive: not-available says up to date with the current version', () => {
    const d = updateDialog('not-available', { ...packaged, version: '0.1.0' })
    expect(d?.kind).toBe('info')
    expect(d?.message).toMatch(/up to date/i)
    expect(d?.message).toContain('0.1.0')
  })

  it('packaged + interactive: available announces a background download', () => {
    const d = updateDialog('available', { ...packaged, version: '0.2.0' })
    expect(d?.kind).toBe('info')
    expect(d?.message).toContain('0.2.0')
    expect(d?.message).toMatch(/download/i)
  })

  it('packaged + interactive: downloaded offers a restart with two buttons', () => {
    const d = updateDialog('downloaded', { ...packaged, version: '0.2.0' })
    expect(d?.kind).toBe('restart')
    expect(d?.buttons).toEqual(['Restart now', 'Later'])
    expect(d?.message).toContain('0.2.0')
  })

  it('packaged + interactive: error surfaces the error text', () => {
    const d = updateDialog('error', { ...packaged, error: 'ENOTFOUND' })
    expect(d?.kind).toBe('error')
    expect(d?.message).toContain('ENOTFOUND')
  })
})
