import { describe, it, expect } from 'vitest'
import { DEFAULT_ALERTS, resolveAlerts } from '@shared/alerts'

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
