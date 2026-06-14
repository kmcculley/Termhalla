import { describe, it, expect } from 'vitest'
import {
  parseCimRows, parseCimDate, cleanName, descendantsOf, pickForeground, buildProcInfo
} from '../../src/main/proc/proc-tree'

// shell pid = 100. Tree: 100 -> 200(node) -> 300(node) ; 100 -> 250(git). 999 unrelated.
const rows = [
  { ProcessId: 200, ParentProcessId: 100, Name: 'node.exe', CommandLine: 'node app.js', CreationDate: '/Date(1000)/' },
  { ProcessId: 300, ParentProcessId: 200, Name: 'node.exe', CommandLine: 'node child.js', CreationDate: '/Date(3000)/' },
  { ProcessId: 250, ParentProcessId: 100, Name: 'git.exe', CommandLine: 'git status', CreationDate: '/Date(2000)/' },
  { ProcessId: 999, ParentParentTypo: 0, ParentProcessId: 1, Name: 'svc.exe', CommandLine: null, CreationDate: null }
]

describe('parseCimRows', () => {
  it('parses an array form', () => {
    expect(parseCimRows(JSON.stringify(rows)).length).toBe(4)
  })
  it('wraps a single-object form into a one-element array', () => {
    const one = parseCimRows(JSON.stringify(rows[0]))
    expect(one).toHaveLength(1)
    expect(one[0].ProcessId).toBe(200)
  })
  it('returns [] on malformed JSON and drops rows without numeric ids', () => {
    expect(parseCimRows('not json')).toEqual([])
    expect(parseCimRows(JSON.stringify([{ Name: 'x' }]))).toEqual([])
  })
})

describe('parseCimDate', () => {
  it('reads the /Date(ms)/ form', () => { expect(parseCimDate('/Date(1718000000000)/')).toBe(1718000000000) })
  it('reads an ISO string', () => { expect(parseCimDate('2026-06-14T00:00:00.000Z')).toBe(Date.parse('2026-06-14T00:00:00.000Z')) })
  it('returns 0 for null/garbage', () => { expect(parseCimDate(null)).toBe(0); expect(parseCimDate('nope')).toBe(0) })
})

describe('cleanName', () => {
  it('strips a trailing .exe case-insensitively', () => {
    expect(cleanName('node.exe')).toBe('node')
    expect(cleanName('PING.EXE')).toBe('PING')
    expect(cleanName('bash')).toBe('bash')
  })
})

describe('descendantsOf', () => {
  it('returns the subtree DFS pre-order with depth, excluding the shell and unrelated procs', () => {
    const out = descendantsOf(parseCimRows(JSON.stringify(rows)), 100)
    expect(out.map(n => [n.pid, n.depth])).toEqual([[200, 0], [300, 1], [250, 0]])
    expect(out.find(n => n.pid === 999)).toBeUndefined()
    expect(out[0]).toMatchObject({ name: 'node', command: 'node app.js' })
  })
  it('returns [] when the shell pid has no children', () => {
    expect(descendantsOf(parseCimRows(JSON.stringify(rows)), 100000)).toEqual([])
  })
})

describe('pickForeground', () => {
  it('follows the most-recently-created child to the deepest leaf', () => {
    // 100 -> children {200@1000, 250@2000}; newest=250(git, leaf). So foreground = git.
    const fg = pickForeground(parseCimRows(JSON.stringify(rows)), 100)
    expect(fg?.ProcessId).toBe(250)
  })
  it('descends a chain to its leaf', () => {
    const chain = [
      { ProcessId: 2, ParentProcessId: 1, Name: 'a.exe', CommandLine: null, CreationDate: '/Date(1)/' },
      { ProcessId: 3, ParentProcessId: 2, Name: 'b.exe', CommandLine: null, CreationDate: '/Date(2)/' }
    ]
    expect(pickForeground(parseCimRows(JSON.stringify(chain)), 1)?.ProcessId).toBe(3)
  })
  it('returns null when the shell has no children', () => {
    expect(pickForeground(parseCimRows(JSON.stringify(rows)), 100000)).toBeNull()
  })
})

describe('buildProcInfo', () => {
  it('combines the foreground name and the descendant tree', () => {
    const info = buildProcInfo(parseCimRows(JSON.stringify(rows)), 100)
    expect(info.foreground).toBe('git')
    expect(info.tree.map(n => n.pid)).toEqual([200, 300, 250])
  })
  it('yields an empty foreground + tree when nothing runs under the shell', () => {
    expect(buildProcInfo(parseCimRows(JSON.stringify(rows)), 100000)).toEqual({ foreground: '', tree: [] })
  })
})
