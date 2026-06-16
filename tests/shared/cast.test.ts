import { describe, it, expect } from 'vitest'
import { castHeader, castEvent } from '../../src/shared/cast'

describe('castHeader', () => {
  it('is a v2 header with width/height/timestamp', () => {
    expect(JSON.parse(castHeader(80, 24, 1700))).toEqual({ version: 2, width: 80, height: 24, timestamp: 1700 })
  })
})
describe('castEvent', () => {
  it('is a [t, code, data] tuple with control bytes escaped', () => {
    expect(castEvent(1.5, 'o', 'hi\r\n')).toBe('[1.5,"o","hi\\r\\n"]')
    expect(JSON.parse(castEvent(2, 'r', '80x24'))).toEqual([2, 'r', '80x24'])
  })
})
