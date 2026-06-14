import { describe, it, expect } from 'vitest'
import { DEFAULT_ALERTS, resolveAlerts, effectiveStatus } from '@shared/alerts'
import type { TerminalStatus } from '@shared/types'

describe('resolveAlerts', () => {
  it('returns all-on defaults when config is undefined', () => {
    expect(resolveAlerts(undefined)).toEqual({
      border: true, tabBadge: true, osNotification: true, needsInput: true
    })
  })
  it('merges a partial override onto defaults', () => {
    expect(resolveAlerts({ osNotification: false })).toEqual({
      border: true, tabBadge: true, osNotification: false, needsInput: true
    })
  })
  it('DEFAULT_ALERTS is all-on', () => {
    expect(DEFAULT_ALERTS).toEqual({ border: true, tabBadge: true, osNotification: true, needsInput: true })
  })
})

describe('effectiveStatus', () => {
  const st = (state: TerminalStatus['state']): TerminalStatus => ({ state, since: 0 })
  it('downgrades needs-input to busy when needsInput is disabled', () => {
    expect(effectiveStatus(st('needs-input'), { needsInput: false }).state).toBe('busy')
  })
  it('keeps needs-input when needsInput is enabled (default)', () => {
    expect(effectiveStatus(st('needs-input'), undefined).state).toBe('needs-input')
  })
  it('leaves busy and idle untouched regardless of config', () => {
    expect(effectiveStatus(st('busy'), { needsInput: false }).state).toBe('busy')
    expect(effectiveStatus(st('idle'), { needsInput: false }).state).toBe('idle')
  })
})
