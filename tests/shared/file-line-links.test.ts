// QoL batch 2026-07-17: compiler/stack-trace source locations in terminal output become clickable
// links that open the file in the editor pane at that position. Pure detection lives beside the
// image-path finder in shared/terminal-links.
import { describe, it, expect } from 'vitest'
import { findFileLineRefs } from '@shared/terminal-links'

describe('findFileLineRefs', () => {
  it('matches path:line and path:line:col', () => {
    const refs = findFileLineRefs('error at src/foo.ts:42:8 in build')
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ path: 'src/foo.ts', line: 42, col: 8 })
    expect(findFileLineRefs('see lib/a.js:7')[0]).toMatchObject({ path: 'lib/a.js', line: 7 })
  })
  it('matches absolute Windows paths (the drive colon is not a line separator)', () => {
    const refs = findFileLineRefs(String.raw`C:\dev\Termhalla\src\a.ts:12:3`)
    expect(refs[0]).toMatchObject({ path: 'C:\\dev\\Termhalla\\src\\a.ts', line: 12, col: 3 })
  })
  it('matches the MSBuild paren form path(line,col)', () => {
    const refs = findFileLineRefs('Program.cs(10,5): error CS1002')
    expect(refs[0]).toMatchObject({ path: 'Program.cs', line: 10, col: 5 })
  })
  it('ignores URLs, extensionless tokens, and paths with no line number', () => {
    expect(findFileLineRefs('https://example.com/a.ts:1')).toHaveLength(0)
    expect(findFileLineRefs('foo:12')).toHaveLength(0)
    expect(findFileLineRefs('just src/foo.ts here')).toHaveLength(0)
  })
  it('reports the span of the whole reference for xterm ranges', () => {
    const line = 'at src/foo.ts:42:8,'
    const [m] = findFileLineRefs(line)
    expect(line.slice(m.start, m.end)).toBe('src/foo.ts:42:8')
  })
})
