import { describe, it, expect } from 'vitest'
import { procPollIntervalMs } from '../src/main/proc/process-tracker'

describe('procPollIntervalMs', () => {
  it('defaults to 1000 when unset or invalid', () => {
    expect(procPollIntervalMs(undefined)).toBe(1000)
    expect(procPollIntervalMs('')).toBe(1000)
    expect(procPollIntervalMs('abc')).toBe(1000)
    expect(procPollIntervalMs('0')).toBe(1000)
    expect(procPollIntervalMs('-5')).toBe(1000)
  })
  it('parses a positive integer override (e.g. e2e slows polling to cut WMI contention)', () => {
    expect(procPollIntervalMs('60000')).toBe(60000)
    expect(procPollIntervalMs('1500')).toBe(1500)
  })
})
