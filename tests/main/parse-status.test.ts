import { describe, it, expect } from 'vitest'
import { parseStatus } from '../../src/main/git/parse-status'

const CLEAN = [
  '# branch.oid 1111111111111111111111111111111111111111',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  ''
].join('\n')

const DIRTY = [
  '# branch.oid 2222222222222222222222222222222222222222',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
  '1 .M N... 100644 100644 100644 ccc ddd unstaged.txt',
  '1 MM N... 100644 100644 100644 eee fff both.txt',
  '? untracked.txt',
  ''
].join('\n')

const DETACHED = [
  '# branch.oid deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  '# branch.head (detached)',
  ''
].join('\n')

const NO_UPSTREAM = [
  '# branch.oid 3333333333333333333333333333333333333333',
  '# branch.head feature',
  ''
].join('\n')

const UNTRACKED_ONLY = [
  '# branch.oid 4444444444444444444444444444444444444444',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  '? new.txt',
  ''
].join('\n')

describe('parseStatus', () => {
  it('parses a clean repo with an upstream', () => {
    const s = parseStatus(CLEAN)
    expect(s).toMatchObject({ branch: 'main', detached: false, upstream: 'origin/main',
      ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, dirty: false })
  })

  it('counts staged/unstaged/untracked and ahead/behind', () => {
    const s = parseStatus(DIRTY)
    // M.→staged, .M→unstaged, MM→both
    expect(s.staged).toBe(2)
    expect(s.unstaged).toBe(2)
    expect(s.untracked).toBe(1)
    expect(s.dirty).toBe(true)
    expect(s.ahead).toBe(2)
    expect(s.behind).toBe(1)
  })

  it('reports detached HEAD with a short sha', () => {
    const s = parseStatus(DETACHED)
    expect(s.detached).toBe(true)
    expect(s.branch).toBe('deadbee')
    expect(s.upstream).toBeNull()
    expect(s.dirty).toBe(false)
  })

  it('handles a branch with no upstream', () => {
    const s = parseStatus(NO_UPSTREAM)
    expect(s.branch).toBe('feature')
    expect(s.upstream).toBeNull()
    expect(s.ahead).toBe(0)
    expect(s.behind).toBe(0)
  })

  it('treats untracked-only as dirty', () => {
    const s = parseStatus(UNTRACKED_ONLY)
    expect(s.dirty).toBe(true)
    expect(s.untracked).toBe(1)
    expect(s.staged).toBe(0)
    expect(s.unstaged).toBe(0)
  })

  // Baseline KNOWN BUG #3 (fixed 2026-07-09): a porcelain-v2 unmerged (`u`) entry used to
  // increment `unstaged` and nothing else — a repo mid-merge surfaced no conflict signal at all.
  it('counts unmerged entries as CONFLICTED, distinct from staged/unstaged', () => {
    const midMerge = [
      '# branch.oid 5555555555555555555555555555555555555555',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.txt',
      'u AA N... 100644 100644 100644 100644 ddd eee fff both-added.txt',
      '1 M. N... 100644 100644 100644 aaa bbb resolved-and-staged.txt',
      '? scratch.txt',
      ''
    ].join('\n')
    const s = parseStatus(midMerge)
    expect(s.conflicted).toBe(2)
    expect(s.staged).toBe(1)      // the resolved file — no longer masked by the u entries
    expect(s.unstaged).toBe(0)    // a conflict is not an "unstaged change"
    expect(s.untracked).toBe(1)
    expect(s.dirty).toBe(true)    // conflicts alone make the repo dirty
  })
  it('a conflict-only repo is dirty', () => {
    const out = [
      '# branch.oid 6666666666666666666666666666666666666666',
      '# branch.head main',
      'u UU N... 100644 100644 100644 100644 aaa bbb ccc only.txt',
      ''
    ].join('\n')
    const s = parseStatus(out)
    expect(s).toMatchObject({ conflicted: 1, staged: 0, unstaged: 0, untracked: 0, dirty: true })
  })
})
