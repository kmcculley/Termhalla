// Characterization tests pin the behavior the system had at baseline. They are a CHANGE-DETECTOR, not a
// correctness oracle: a failure means behavior CHANGED — a human adjudicates whether that is an intended
// change (update the test) or a regression (fix the code). Captured by /orky:discover; do not hand-edit.
//
// Subsystem: shared pure logic — keybindings, run-commands, font-zoom, terminal-links, language map,
// git porcelain parse, project-key resolution, and FTS query/prune helpers.
import { describe, it, expect } from 'vitest'
import {
  chordKey, parseChordKey, formatChord, resolveBindings, matchShortcut, isValidRebind, DEFAULT_BINDINGS
} from '@shared/keybindings'
import { addRunCommand, updateRunCommand, removeRunCommand } from '@shared/run-commands'
import { nextFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX } from '@shared/font-zoom'
import { imageExt, isImageUrl, findImagePaths, resolveImageSrc } from '@shared/terminal-links'
import { languageForPath } from '@shared/language'
import { resolveProjectKey } from '@shared/project-key'
import { parseStatus } from '../src/main/git/parse-status'
import { toMatchExpr } from '../src/main/search/fts-query'
import { overage, SEGMENT_CAP } from '../src/main/search/prune-policy'

describe('CHAR-013 keybindings', () => {
  it('chordKey / parseChordKey round-trip a chord', () => {
    expect(chordKey({ mod: true, shift: true, key: 't' })).toBe('mod+shift+t')
    expect(parseChordKey('mod+shift+t')).toEqual({ mod: true, shift: true, key: 't' })
  })
  it('formatChord renders mod as Ctrl with friendly key labels', () => {
    expect(formatChord({ mod: true, shift: true, key: 't' })).toBe('Ctrl+Shift+T')
    expect(formatChord({ mod: true, shift: false, key: 'enter' })).toBe('Ctrl+Enter')
  })
  it('resolveBindings overlays overrides; "none" unbinds a command', () => {
    expect(resolveBindings(undefined)).toEqual(DEFAULT_BINDINGS)
    expect(resolveBindings({ 'toggle-palette': 'none' })['toggle-palette']).toBeUndefined()
    expect(resolveBindings({ 'new-terminal': 'mod+shift+x' })['new-terminal']).toEqual({ mod: true, shift: true, key: 'x' })
  })
  it('matchShortcut maps Ctrl+K to the palette and Ctrl+1 to a reserved jump', () => {
    expect(matchShortcut({ key: 'k', ctrlKey: true, metaKey: false, shiftKey: false })).toEqual({ type: 'toggle-palette' })
    expect(matchShortcut({ key: '1', ctrlKey: true, metaKey: false, shiftKey: false })).toEqual({ type: 'jump-workspace', index: 0 })
    expect(matchShortcut({ key: 'k', ctrlKey: false, metaKey: false, shiftKey: false })).toBeNull()
  })
  it('isValidRebind requires mod + a real non-reserved key', () => {
    expect(isValidRebind({ mod: true, shift: false, key: 't' })).toBe(true)
    expect(isValidRebind({ mod: false, shift: false, key: 't' })).toBe(false)
    expect(isValidRebind({ mod: true, shift: false, key: '1' })).toBe(false)
    expect(isValidRebind({ mod: true, shift: false, key: '+' })).toBe(false)
    expect(isValidRebind({ mod: true, shift: false, key: 'control' })).toBe(false)
  })
})

describe('CHAR-014 run-commands list ops are immutable & id-stable', () => {
  const a = { id: '1', label: 'a', command: 'ls' }
  it('addRunCommand appends (undefined => empty list)', () => {
    expect(addRunCommand(undefined, a)).toEqual([a])
  })
  it('updateRunCommand patches the matching id but never changes the id', () => {
    expect(updateRunCommand([a], '1', { label: 'b', id: 'X' } as never)).toEqual([{ id: '1', label: 'b', command: 'ls' }])
    expect(updateRunCommand([a], 'nope', { label: 'b' })).toEqual([a])
  })
  it('removeRunCommand drops the matching id', () => {
    expect(removeRunCommand([a], '1')).toEqual([])
    expect(removeRunCommand([a], 'nope')).toEqual([a])
  })
})

describe('CHAR-015 font-zoom: nextFontSize', () => {
  it('one notch up/down by 1px, clamped to [8,32], zero delta is a no-op', () => {
    expect(nextFontSize(14, -100)).toBe(15)
    expect(nextFontSize(14, 100)).toBe(13)
    expect(nextFontSize(14, 0)).toBe(14)
    expect(nextFontSize(FONT_SIZE_MAX, -1)).toBe(32)
    expect(nextFontSize(FONT_SIZE_MIN, 1)).toBe(8)
  })
})

describe('CHAR-016 terminal-links', () => {
  it('imageExt returns a lowercased known extension or null', () => {
    expect(imageExt('shot.PNG')).toBe('png')
    expect(imageExt('a.txt')).toBeNull()
    expect(imageExt('noext')).toBeNull()
  })
  it('isImageUrl ignores query/hash when classifying', () => {
    expect(isImageUrl('http://x/a.png?q=1')).toBe(true)
    expect(isImageUrl('http://x/page')).toBe(false)
  })
  it('findImagePaths finds quoted (spaced) and bare image paths, trimming trailing punctuation', () => {
    expect(findImagePaths('open "my dir/a.png" now').map(m => m.text)).toEqual(['my dir/a.png'])
    expect(findImagePaths('see img.png.').map(m => m.text)).toEqual(['img.png'])
    expect(findImagePaths('a url http://x/a.png here').map(m => m.text)).toEqual([]) // URLs excluded
  })
  it('resolveImageSrc handles absolute, ~ home, and cwd-relative refs', () => {
    expect(resolveImageSrc('a.png', 'C:\\dev', 'C:\\Users\\k')).toBe('C:\\dev\\a.png')
    expect(resolveImageSrc('~/a.png', 'C:\\dev', 'C:\\Users\\k')).toBe('C:\\Users\\k\\a.png')
    expect(resolveImageSrc('C:\\x\\a.png', 'C:\\dev', 'C:\\Users\\k')).toBe('C:\\x\\a.png')
  })
})

describe('CHAR-017 languageForPath', () => {
  it('maps known extensions to Monaco ids, unknown => plaintext', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('s.PY')).toBe('python')
    expect(languageForPath('README.md')).toBe('markdown')
    expect(languageForPath('mystery.zzz')).toBe('plaintext')
    expect(languageForPath('Dockerfile')).toBe('plaintext') // no extension => not matched
  })
})

describe('CHAR-018 git parseStatus (porcelain v2)', () => {
  it('parses branch, ahead/behind, and staged/unstaged/untracked counts', () => {
    const out = [
      '# branch.oid abc1234',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 aaa bbb file1',
      '1 .M N... 100644 100644 100644 ccc ddd file2',
      '? untracked.txt'
    ].join('\n')
    expect(parseStatus(out)).toEqual({
      branch: 'main', detached: false, upstream: 'origin/main',
      ahead: 2, behind: 1, staged: 1, unstaged: 1, untracked: 1, dirty: true
    })
  })
  it('reports a detached HEAD as the short oid', () => {
    const out = '# branch.oid abcdef1234567\n# branch.head (detached)\n'
    const s = parseStatus(out)
    expect(s.detached).toBe(true)
    expect(s.branch).toBe('abcdef1')
    expect(s.dirty).toBe(false)
  })
})

describe('CHAR-019 resolveProjectKey precedence', () => {
  const s = (over: Partial<{ gitStatus: Record<string, unknown>; cwds: Record<string, string>; workspaces: Record<string, unknown> }>) =>
    ({ gitStatus: {}, cwds: {}, workspaces: {}, ...over }) as never
  it('prefers git root, then live cwd, then persisted terminal cwd, else empty', () => {
    expect(resolveProjectKey(s({}), null)).toBe('')
    expect(resolveProjectKey(s({ gitStatus: { p: { root: 'C:\\repo' } } }), 'p')).toBe('C:\\repo')
    expect(resolveProjectKey(s({ cwds: { p: 'C:\\live' } }), 'p')).toBe('C:\\live')
    expect(resolveProjectKey(s({ workspaces: { w: { panes: { p: { config: { kind: 'terminal', cwd: 'C:\\persisted' } } } } } }), 'p')).toBe('C:\\persisted')
    expect(resolveProjectKey(s({}), 'unknown')).toBe('')
  })
})

describe('CHAR-020 search helpers', () => {
  it('toMatchExpr quotes each token (neutralizing FTS5 specials) and ANDs them; blank => ""', () => {
    expect(toMatchExpr('foo bar')).toBe('"foo" "bar"')
    expect(toMatchExpr('foo*')).toBe('"foo*"')
    expect(toMatchExpr('a"b')).toBe('"ab"')
    expect(toMatchExpr('   ')).toBe('')
  })
  it('overage returns rows-over-cap (0 within cap); default cap is 50000', () => {
    expect(overage(100, 50)).toBe(50)
    expect(overage(10, 50)).toBe(0)
    expect(SEGMENT_CAP).toBe(50000)
  })
})
