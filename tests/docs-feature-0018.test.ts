// FROZEN test suite — feature 0018-windowed-flow-control (phase 4).
// REQ-015: the documentation reflects the landed flow-control semantics — the feature docs
// name the defaults and the hysteresis rule, no doc still claims the frames are inert, and
// the changelog records the feature.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('TEST-796 REQ-015 docs and changelog reflect the landed semantics', () => {
  it('remote-agent.md documents the flow-control behavior: defaults, hysteresis, flood', () => {
    const doc = read('docs/features/remote-agent.md')
    expect(doc).toContain('DEFAULT_FLOW_WINDOW_BYTES')
    expect(doc).toContain('DEFAULT_ACK_EVERY_BYTES')
    expect(/low watermark|floor\(window\s*\/\s*2\)/i.test(doc),
      'the hysteresis (drained) rule must be documented').toBe(true)
    expect(doc).toContain('flood')
    expect(doc).not.toContain('inert by design') // the F16-era claim is superseded, not left stale
  })

  it('remote-protocol.md no longer describes ack/window as semantics-free', () => {
    const doc = read('docs/features/remote-protocol.md')
    expect(doc).not.toContain('attached to NO semantics')
    expect(doc).toContain('flow-control.ts') // points at where the semantics live now
  })

  it('the changelog records 0018 windowed flow control', () => {
    const log = read('CHANGELOG.md')
    expect(/flow control/i.test(log)).toBe(true)
    expect(log).toContain('0018')
  })
})
