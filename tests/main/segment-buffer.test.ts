import { describe, it, expect } from 'vitest'
import { SegmentBuffer, SEGMENT_MAX_BYTES } from '../../src/main/search/segment-buffer'

describe('SegmentBuffer', () => {
  it('flushes on idle and carries cwd + start ts', () => {
    const b = new SegmentBuffer('/proj')
    expect(b.push('hello ', 1000)).toBeNull()
    expect(b.push('world', 1100)).toBeNull()
    expect(b.flushDue(1500)).toBeNull()              // < idle
    const seg = b.flushDue(2200)                      // >= 1000ms since last push (1100)
    expect(seg).toEqual({ text: 'hello world', ts: 1000, cwd: '/proj' })
    expect(b.flushDue(9999)).toBeNull()               // buffer now empty
  })

  it('flushes immediately when size threshold is crossed', () => {
    const b = new SegmentBuffer('')
    const big = 'x'.repeat(SEGMENT_MAX_BYTES + 1)
    const seg = b.push(big, 50)
    expect(seg).not.toBeNull()
    expect(seg!.text.length).toBe(SEGMENT_MAX_BYTES + 1)
  })

  it('end() flushes the remainder, then nothing', () => {
    const b = new SegmentBuffer('/d')
    b.push('tail', 10)
    expect(b.end()).toEqual({ text: 'tail', ts: 10, cwd: '/d' })
    expect(b.end()).toBeNull()
  })

  it('drops empty/whitespace-only segments', () => {
    const b = new SegmentBuffer('')
    b.push('   \r\n', 1)
    expect(b.flushDue(5000)).toBeNull()
    expect(b.end()).toBeNull()
  })

  it('setCwd updates the cwd carried by the next segment', () => {
    const b = new SegmentBuffer('/a')
    b.push('x', 1)
    b.setCwd('/b')
    expect(b.end()).toEqual({ text: 'x', ts: 1, cwd: '/b' })
  })
})
