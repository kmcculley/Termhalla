// FROZEN unit suite — feature 0009-native-orky-pane (phase 4 / TASK-002, REQ-005).
// `sameProjectRoot(a, b, { caseFold })` — the pane↔binding EQUALITY matcher (src/shared/orky-pane.ts):
// separator folding ALWAYS (slash style + trailing separators never matter), case folding iff the
// INJECTED `opts.caseFold` (the module never reads `process` — undefined in the contextIsolated
// renderer main world though defined under vitest; the F6 FINDING-003 trap), EQUALITY, never
// containment/prefix. Vectors are HOST-INDEPENDENT, built with explicit path.win32/path.posix
// (REQ-005 acceptance). Reuses `caseFoldFromPlatform` from @shared/decision-queue — never redefined.
//
// Runs RED today: src/shared/orky-pane.ts does not exist yet (module-not-found).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import path from 'node:path'
import { sameProjectRoot } from '@shared/orky-pane'

const fold = { caseFold: true }
const noFold = { caseFold: false }

describe('sameProjectRoot — separator-folded equality (REQ-005)', () => {
  it('TEST-385 REQ-005 identical roots match across trailing separators, mixed separators and slash styles, in BOTH fold modes and both path flavors', () => {
    for (const opts of [fold, noFold]) {
      // win32 flavor
      const w = path.win32.join('C:\\', 'dev', 'Termhalla')
      expect(sameProjectRoot(w, w, opts)).toBe(true)
      expect(sameProjectRoot(w + '\\', w, opts)).toBe(true)                    // trailing separator
      expect(sameProjectRoot('C:/dev/Termhalla', w, opts)).toBe(true)          // slash style folds ALWAYS
      expect(sameProjectRoot('C:/dev\\Termhalla', w, opts)).toBe(true)         // mixed separators
      // posix flavor
      const p = path.posix.join('/home', 'kev', 'proj')
      expect(sameProjectRoot(p, p, opts)).toBe(true)
      expect(sameProjectRoot(p + '/', p, opts)).toBe(true)
      // different roots never match
      expect(sameProjectRoot(w, path.win32.join('C:\\', 'dev', 'Other'), opts)).toBe(false)
      expect(sameProjectRoot(p, '/home/kev/other', opts)).toBe(false)
    }
  })

  it('TEST-386 REQ-005 a case-divergent spelling matches WITH caseFold:true and does NOT match with caseFold:false (the injected fold decides — never ambient platform state)', () => {
    expect(sameProjectRoot('c:\\DEV\\termhalla', 'C:\\dev\\Termhalla', fold)).toBe(true)
    expect(sameProjectRoot('c:\\DEV\\termhalla', 'C:\\dev\\Termhalla', noFold)).toBe(false)
    expect(sameProjectRoot('/HOME/kev/proj', '/home/kev/proj', fold)).toBe(true)
    expect(sameProjectRoot('/HOME/kev/proj', '/home/kev/proj', noFold)).toBe(false)
  })

  it('TEST-387 REQ-005 EQUALITY, not prefix/containment — sibling-extension spellings and children never match; UNC roots compare correctly', () => {
    // basename-extension sibling (the pinned acceptance vector)
    expect(sameProjectRoot('C:\\dev\\Termhalla', 'C:\\dev\\TermhallaX', fold)).toBe(false)
    expect(sameProjectRoot('C:\\dev\\TermhallaX', 'C:\\dev\\Termhalla', fold)).toBe(false)
    // a child path is NOT its ancestor (equality, not containment)
    expect(sameProjectRoot('C:\\dev\\Termhalla\\src', 'C:\\dev\\Termhalla', fold)).toBe(false)
    expect(sameProjectRoot('/home/kev/proj/deep', '/home/kev/proj', fold)).toBe(false)
    // UNC root: identical + slash-variant + trailing-separator spellings match; a different share does not
    expect(sameProjectRoot('\\\\server\\share\\proj', '\\\\server\\share\\proj', noFold)).toBe(true)
    expect(sameProjectRoot('\\\\server\\share\\proj\\', '\\\\server\\share\\proj', noFold)).toBe(true)
    expect(sameProjectRoot('//server/share/proj', '\\\\server\\share\\proj', noFold)).toBe(true)
    expect(sameProjectRoot('\\\\server\\share2\\proj', '\\\\server\\share\\proj', fold)).toBe(false)
  })
})

describe('purity + single-definition reuse (REQ-005 / REQ-015 / FINDING-003 trap)', () => {
  it('TEST-388 REQ-005 REQ-015 orky-pane.ts is pure (no process/node builtins/electron/api) and REUSES caseFoldFromPlatform from decision-queue.ts (never redefines it)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/shared/orky-pane.ts'), 'utf8')
    expect(src).not.toMatch(/\bprocess\s*[.[]/)      // undefined in the contextIsolated renderer main world
    expect(src).not.toMatch(/from 'node:/)
    expect(src).not.toMatch(/require\(/)
    expect(src).not.toMatch(/from ['"]electron/)
    expect(src).not.toMatch(/\.\.\/api/)
    expect(src).not.toMatch(/\bnavigator\b/)          // the fold mode is INJECTED by the caller
    // single definition: consumed from decision-queue, never re-derived here
    expect(src).not.toMatch(/function caseFoldFromPlatform|const caseFoldFromPlatform\s*=/)
  })
})
