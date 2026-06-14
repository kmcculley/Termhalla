import { describe, it, expect } from 'vitest'
import { Osc133Parser } from '../../src/main/status/osc133-parser'

const ESC = '\x1b', BEL = '\x07'
const mark = (body: string) => `${ESC}]133;${body}${BEL}`

describe('Osc133Parser', () => {
  it('extracts a single A marker amid normal text', () => {
    const p = new Osc133Parser()
    expect(p.push(`hello ${mark('A')}world`)).toEqual([{ kind: 'A' }])
  })
  it('parses D with an exit code', () => {
    const p = new Osc133Parser()
    expect(p.push(mark('D;0'))).toEqual([{ kind: 'D', exit: 0 }])
    expect(p.push(mark('D;1'))).toEqual([{ kind: 'D', exit: 1 }])
  })
  it('parses D with no exit code', () => {
    const p = new Osc133Parser()
    expect(p.push(mark('D'))).toEqual([{ kind: 'D', exit: undefined }])
  })
  it('extracts multiple markers in one chunk', () => {
    const p = new Osc133Parser()
    expect(p.push(`${mark('C')}out${mark('D;0')}${mark('A')}`))
      .toEqual([{ kind: 'C' }, { kind: 'D', exit: 0 }, { kind: 'A' }])
  })
  it('handles a marker whose body is split across two chunks', () => {
    const p = new Osc133Parser()
    expect(p.push(`${ESC}]133;D;`)).toEqual([])
    expect(p.push(`0${BEL}`)).toEqual([{ kind: 'D', exit: 0 }])
  })
  it('handles a marker whose START sequence is split across chunks', () => {
    const p = new Osc133Parser()
    expect(p.push(`done${ESC}]1`)).toEqual([])
    expect(p.push(`33;A${BEL}`)).toEqual([{ kind: 'A' }])
  })
  it('accepts the ESC-backslash string terminator', () => {
    const p = new Osc133Parser()
    expect(p.push(`${ESC}]133;A${ESC}\\`)).toEqual([{ kind: 'A' }])
  })
  it('returns nothing and does not grow its buffer on plain output', () => {
    const p = new Osc133Parser()
    expect(p.push('just regular output with a \x1b[32mcolor\x1b[0m code')).toEqual([])
    expect(p.push(mark('A'))).toEqual([{ kind: 'A' }])
  })
})
