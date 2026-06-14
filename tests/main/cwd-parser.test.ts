import { describe, it, expect } from 'vitest'
import { CwdParser } from '../../src/main/status/cwd-parser'

const ESC = '\x1b', BEL = '\x07'

describe('CwdParser', () => {
  it('extracts an OSC 9;9 Windows path (PowerShell form)', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\dev\\Termhalla${BEL}`)).toBe('C:\\dev\\Termhalla')
  })
  it('extracts an OSC 7 dos-style file URL', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/C:/dev/app${BEL}`)).toBe('C:\\dev\\app')
  })
  it('translates an OSC 7 msys path (/c/...) to a Windows path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/c/dev/app${BEL}`)).toBe('C:\\dev\\app')
  })
  it('translates an OSC 7 WSL mount (/mnt/c/...) to a Windows path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/mnt/c/work${BEL}`)).toBe('C:\\work')
  })
  it('URL-decodes spaces in an OSC 7 path', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]7;file://host/C:/my%20dir${BEL}`)).toBe('C:\\my dir')
  })
  it('returns the most recent cwd when several arrive in one chunk', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\a${BEL}out${ESC}]9;9;C:\\b${BEL}`)).toBe('C:\\b')
  })
  it('handles a report split across two chunks', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]9;9;C:\\de`)).toBeNull()
    expect(p.push(`v${BEL}`)).toBe('C:\\dev')
  })
  it('ignores unrelated OSC sequences (title, status markers)', () => {
    const p = new CwdParser()
    expect(p.push(`${ESC}]0;some title${BEL}${ESC}]133;A${BEL}`)).toBeNull()
  })
  it('returns null on plain output', () => {
    const p = new CwdParser()
    expect(p.push('just regular output\r\n')).toBeNull()
  })
})
