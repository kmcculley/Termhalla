// FROZEN unit suite — feature 0006-decision-queue-panel (phase 4 / REQ-009 pure matcher).
// `matchPaneRoot` is the renderer-safe pane↔root matcher: boundary-safe containment, slash-fold
// ALWAYS, case-fold iff `opts.caseFold` (INJECTED — the module never reads `process`, which is
// undefined in the contextIsolated renderer main world), longest-root-wins. Vectors are
// HOST-INDEPENDENT, built with explicit `path.win32`/`path.posix` (REQ-009 acceptance), plus one
// host-native equivalence check against the real main-side `normalizeProjectRoot`.
//
// AMENDED at the review→tests loopback (ESC-001 / FINDING-020 — the sanctioned frozen-test
// correction, recorded in 04-tests.md "Review loopback"): the original TEST-324 pinned
// match-FAILURE fall-through at the `matchPaneRootFromCandidates` seam ("first candidate matches
// nothing → the next is consulted"), contradicting frozen REQ-009's availability gating
// ("config.cwd WHEN no live cwd is known; gitStatus.root ONLY when neither"). The corrected
// contract: the seam keeps skip-on-INVALID (null/undefined/'') semantics but a VALID candidate is
// DECISIVE (match or null), and candidate AVAILABILITY per REQ-009 is its own pinned pure seam,
// `selectPaneCandidates` (TEST-368/369) — which does not exist yet, so those pins run RED.
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { matchPaneRoot, matchPaneRootFromCandidates, caseFoldFromPlatform } from '@shared/decision-queue'
import * as dq from '@shared/decision-queue'
import { normalizeProjectRoot } from '../../src/main/orky/validate-root'

const fold = { caseFold: true }
const noFold = { caseFold: false }

describe('matchPaneRoot — boundary-safe containment (REQ-009)', () => {
  it('TEST-313 REQ-009 equality matches, including trailing separators, in both path flavors and both fold modes', () => {
    for (const opts of [fold, noFold]) {
      // win32 flavor
      expect(matchPaneRoot('C:\\dev\\Termhalla', ['C:\\dev\\Termhalla'], opts)).toBe('C:\\dev\\Termhalla')
      expect(matchPaneRoot('C:\\dev\\Termhalla\\', ['C:\\dev\\Termhalla'], opts)).toBe('C:\\dev\\Termhalla')
      // posix flavor
      expect(matchPaneRoot('/home/kev/proj', ['/home/kev/proj'], opts)).toBe('/home/kev/proj')
      expect(matchPaneRoot('/home/kev/proj/', ['/home/kev/proj'], opts)).toBe('/home/kev/proj')
    }
  })

  it('TEST-314 REQ-009 a pane path BENEATH a root matches at a path-segment boundary and returns the member root verbatim', () => {
    expect(matchPaneRoot('C:\\dev\\Termhalla\\src\\renderer', ['C:\\dev\\Termhalla'], noFold)).toBe('C:\\dev\\Termhalla')
    expect(matchPaneRoot('/home/kev/proj/deep/nested/dir', ['/home/kev/proj'], noFold)).toBe('/home/kev/proj')
  })

  it('TEST-315 REQ-009 sibling-prefix spellings do NOT match, in both directions (boundary safety)', () => {
    // Pane is a sibling whose name merely EXTENDS the root's basename.
    expect(matchPaneRoot('C:\\dev\\TermhallaX', ['C:\\dev\\Termhalla'], fold)).toBeNull()
    expect(matchPaneRoot('/dev/TermhallaX', ['/dev/Termhalla'], fold)).toBeNull()
    // Root is a strict string-prefix of the pane path but not a path ancestor.
    expect(matchPaneRoot('C:\\dev\\Termhalla', ['C:\\dev\\Term'], fold)).toBeNull()
    expect(matchPaneRoot('/dev/Termhalla', ['/dev/Term'], fold)).toBeNull()
  })

  it('TEST-316 REQ-009 UNC roots: a pane beneath \\\\server\\share\\proj matches; the UNC sibling does not', () => {
    const unc = '\\\\server\\share\\proj'
    expect(matchPaneRoot('\\\\server\\share\\proj\\sub\\dir', [unc], noFold)).toBe(unc)
    expect(matchPaneRoot(unc, [unc], noFold)).toBe(unc)
    expect(matchPaneRoot('\\\\server\\share\\project2', [unc], noFold)).toBeNull()
  })

  it('TEST-317 REQ-009 a drive-letter root (C:\\) contains any path on that drive and matches itself', () => {
    expect(matchPaneRoot('C:\\anywhere\\at\\all', ['C:\\'], fold)).toBe('C:\\')
    expect(matchPaneRoot('C:\\', ['C:\\'], fold)).toBe('C:\\')
  })

  it('TEST-318 REQ-009 mixed /-vs-\\ spellings match WITHOUT case folding (slash-fold is unconditional)', () => {
    expect(matchPaneRoot('C:/dev/Termhalla/sub', ['C:\\dev\\Termhalla'], noFold)).toBe('C:\\dev\\Termhalla')
    expect(matchPaneRoot('C:\\dev\\Termhalla', ['C:/dev/Termhalla'], noFold)).toBe('C:/dev/Termhalla')
  })

  it('TEST-319 REQ-009 case-divergent spellings match with caseFold:true and do NOT match with caseFold:false', () => {
    expect(matchPaneRoot('c:\\DEV\\termhalla\\sub', ['C:\\dev\\Termhalla'], fold)).toBe('C:\\dev\\Termhalla')
    expect(matchPaneRoot('c:\\DEV\\termhalla\\sub', ['C:\\dev\\Termhalla'], noFold)).toBeNull()
    expect(matchPaneRoot('/home/KEV/proj', ['/home/kev/proj'], fold)).toBe('/home/kev/proj')
    expect(matchPaneRoot('/home/KEV/proj', ['/home/kev/proj'], noFold)).toBeNull()
  })

  it('TEST-320 REQ-009 among containing member roots the LONGEST wins, regardless of roots-array order (nearest-ancestor semantics)', () => {
    const r1 = 'C:\\dev', r2 = 'C:\\dev\\Termhalla'
    expect(matchPaneRoot('C:\\dev\\Termhalla\\sub', [r1, r2], fold)).toBe(r2)
    expect(matchPaneRoot('C:\\dev\\Termhalla\\sub', [r2, r1], fold)).toBe(r2)
    expect(matchPaneRoot('/repo/app/src', ['/repo', '/repo/app'], noFold)).toBe('/repo/app')
    expect(matchPaneRoot('/repo/other', ['/repo', '/repo/app'], noFold)).toBe('/repo')
  })

  it('TEST-321 REQ-009 total: no member contains the pane → null; empty inputs → null; never throws', () => {
    expect(matchPaneRoot('/somewhere/else', ['/home/kev/proj'], fold)).toBeNull()
    expect(matchPaneRoot('/home/kev/proj', [], fold)).toBeNull()
    expect(matchPaneRoot('', ['/home/kev/proj'], fold)).toBeNull()
    expect(() => matchPaneRoot('x', ['', 'relative/only'], fold)).not.toThrow()
  })
})

describe('caseFoldFromPlatform — pure fold-mode derivation (REQ-009 / FINDING-003)', () => {
  it('TEST-322 REQ-009 Win32 folds; MacIntel / Linux x86_64 / empty do not (injected strings, no navigator/process read)', () => {
    expect(caseFoldFromPlatform('Win32')).toBe(true)
    expect(caseFoldFromPlatform('MacIntel')).toBe(false)
    expect(caseFoldFromPlatform('Linux x86_64')).toBe(false)
    expect(caseFoldFromPlatform('')).toBe(false)
  })
})

describe('matchPaneRoot ≡ normalizeProjectRoot fold semantics (REQ-009 / CONV-010)', () => {
  it('TEST-323 REQ-009 host-independent equivalence vectors (explicit path.win32/path.posix) plus a host-native normalizeProjectRoot check', () => {
    const W = path.win32, P = path.posix
    // Same-physical-dir spellings (equality-shaped, so containment == key equality).
    const vectors: { a: string; b: string; resolver: typeof W }[] = [
      { a: 'C:\\dev\\Termhalla\\', b: 'C:\\dev\\Termhalla', resolver: W },   // trailing separator
      { a: 'c:/DEV/termhalla', b: 'C:\\dev\\Termhalla', resolver: W },       // mixed slashes + case
      { a: 'C:\\', b: 'C:\\', resolver: W },                                 // drive root
      { a: '\\\\server\\share\\proj\\', b: '\\\\server\\share\\proj', resolver: W }, // UNC + trailing
      { a: '/home/kev/proj/', b: '/home/kev/proj', resolver: P },            // posix trailing
      { a: '/home/KEV/proj', b: '/home/kev/proj', resolver: P },             // posix case-divergent
      { a: '/home/kev/projX', b: '/home/kev/proj', resolver: P }             // sibling — never equal
    ]
    for (const { a, b, resolver } of vectors) {
      for (const caseFold of [true, false]) {
        // normalizeProjectRoot semantics, host-independently: resolve(), then lowercase iff folding.
        const key = (s: string) => (caseFold ? resolver.resolve(s).toLowerCase() : resolver.resolve(s))
        const shouldMatch = key(a) === key(b)
        expect(matchPaneRoot(a, [b], { caseFold }) === b, `${a} vs ${b} caseFold=${caseFold}`).toBe(shouldMatch)
      }
    }
    // Live equivalence with the REAL main-side comparison key, on host-native spellings.
    const hostFold = process.platform === 'win32'
    const hostVectors: [string, string][] = hostFold
      ? [['C:\\dev\\Termhalla\\', 'C:\\dev\\Termhalla'], ['c:/DEV/termhalla', 'C:\\dev\\Termhalla'], ['C:\\dev\\TermhallaX', 'C:\\dev\\Termhalla']]
      : [['/home/kev/proj/', '/home/kev/proj'], ['/home/KEV/proj', '/home/kev/proj'], ['/home/kev/projX', '/home/kev/proj']]
    for (const [a, b] of hostVectors) {
      const equal = normalizeProjectRoot(a) === normalizeProjectRoot(b)
      expect(matchPaneRoot(a, [b], { caseFold: hostFold }) === b, `${a} vs ${b} (host)`).toBe(equal)
    }
  })
})

describe('matchPaneRootFromCandidates — first-VALID-candidate decisiveness (REQ-009)', () => {
  it('TEST-324 REQ-009 the FIRST VALID candidate DECIDES (match or null); invalid null/undefined/empty candidates are skipped; a valid non-matching candidate never falls through (amended, FINDING-020)', () => {
    // Nested member roots R2 ⊂ R1: the pane cwd is under R2 while gitStatus.root === R1. The cwd
    // candidate + longest-root rule must yield R2 — the git root is never consulted.
    const R1 = '/repo', R2 = '/repo/app'
    expect(matchPaneRootFromCandidates(['/repo/app/src', R1], [R1, R2], noFold)).toBe(R2)
    // win32 flavor of the same shape.
    expect(matchPaneRootFromCandidates(
      ['C:\\repo\\app\\src', 'C:\\repo'], ['C:\\repo', 'C:\\repo\\app'], fold
    )).toBe('C:\\repo\\app')
    // Live cwd inside member R, git root a strict ANCESTOR of R that is NOT a member → still R.
    expect(matchPaneRootFromCandidates(['/repo/app/sub', '/repo'], ['/repo/app'], noFold)).toBe('/repo/app')
    // AMENDED (review loopback ESC-001 / FINDING-020 — sanctioned frozen-test correction): a VALID
    // first candidate that matches NOTHING is DECISIVE. The original vector here pinned
    // match-failure fall-through ("the next candidate is consulted"), contradicting frozen
    // REQ-009's availability gating ("config.cwd WHEN no live cwd is known"): a pane that cd'd OUT
    // of every member root kept matching via its stale persisted config.cwd. It must NOT match —
    // null is the REQ-010 fallback-affordance signal.
    expect(matchPaneRootFromCandidates(['/elsewhere/x', '/repo/app/deep'], ['/repo/app'], noFold)).toBeNull()
    // null / undefined / '' candidates are INVALID and skipped without consuming a turn (retained).
    expect(matchPaneRootFromCandidates([undefined, null, '', '/repo/app/x'], ['/repo/app'], noFold)).toBe('/repo/app')
    // No valid candidate matches → null; empty inputs → null (total, never throws).
    expect(matchPaneRootFromCandidates(['/nowhere'], ['/repo/app'], noFold)).toBeNull()
    expect(matchPaneRootFromCandidates([], ['/repo/app'], noFold)).toBeNull()
    expect(matchPaneRootFromCandidates(['/repo/app'], [], noFold)).toBeNull()
  })
})

// The candidate-SELECTION seam (review loopback ESC-001 / FINDING-020): REQ-009 conditions each
// signal's AVAILABILITY — (1) the live tracked cwd when known (even if it will not match!), (2) the
// persisted terminal config.cwd only when NO live cwd is known, (3) gitStatus.root ONLY when
// neither cwd signal exists. Selection is pure availability logic over the signals; the member-root
// set is deliberately NOT an input, so a known-but-elsewhere live cwd can never be displaced by a
// stale persisted cwd. Accessed via the namespace import so the retained vectors above stay
// runnable (GREEN) while this seam does not exist yet (these pins run RED).
type PaneCandidateSignals = { liveCwd?: string | null; configCwd?: string | null; gitRoot?: string | null }
const selectPaneCandidates = (dq as unknown as {
  selectPaneCandidates?: (signals: PaneCandidateSignals) => string[]
}).selectPaneCandidates

describe('selectPaneCandidates — availability-gated candidate selection (REQ-009 / FINDING-020)', () => {
  it('TEST-368 REQ-009 EXACTLY the available candidate set: [liveCwd] when known (even non-matching); [configCwd] only when no live cwd; [gitRoot] only when neither; [] when none', () => {
    expect(typeof selectPaneCandidates, 'selectPaneCandidates must be exported from @shared/decision-queue').toBe('function')
    const pick = selectPaneCandidates!
    // (1) A known live cwd is ALWAYS the whole candidate set — the other signals are UNAVAILABLE
    //     by REQ-009's when/ONLY-when conditions, never fallbacks.
    expect(pick({ liveCwd: '/live/cwd', configCwd: '/persisted/cwd', gitRoot: '/git/root' })).toEqual(['/live/cwd'])
    expect(pick({ liveCwd: '/live/cwd' })).toEqual(['/live/cwd'])
    // (2) config.cwd only when no live cwd is known ('' / null / undefined = unknown).
    expect(pick({ liveCwd: undefined, configCwd: '/persisted/cwd', gitRoot: '/git/root' })).toEqual(['/persisted/cwd'])
    expect(pick({ liveCwd: null, configCwd: '/persisted/cwd' })).toEqual(['/persisted/cwd'])
    expect(pick({ liveCwd: '', configCwd: '/persisted/cwd' })).toEqual(['/persisted/cwd'])
    // (3) gitStatus.root ONLY when neither cwd signal exists.
    expect(pick({ gitRoot: '/git/root' })).toEqual(['/git/root'])
    expect(pick({ liveCwd: '', configCwd: '', gitRoot: '/git/root' })).toEqual(['/git/root'])
    // No signal at all → no candidates (the pane can never match; REQ-010's fallback applies).
    expect(pick({})).toEqual([])
    expect(pick({ liveCwd: '', configCwd: null, gitRoot: undefined })).toEqual([])
    // Total (CONV-002): a mistyped signal is treated as absent, never a throw.
    expect(pick({ liveCwd: 42 as unknown as string, configCwd: '/persisted/cwd' })).toEqual(['/persisted/cwd'])
  })

  it("TEST-369 REQ-009 REQ-010 composed with the matcher: a pane that cd'd OUT of every member root does NOT match via its stale config.cwd — the fallback shows", () => {
    const pick = selectPaneCandidates!
    const roots = ['/repo/app']
    // The FINDING-020 discriminating vector: live cwd KNOWN but outside every member root, while
    // the stale persisted config.cwd still points inside one. The pane must NOT match — null is
    // the signal that renders the REQ-010 'open terminal here' affordance for this project.
    expect(matchPaneRootFromCandidates(
      pick({ liveCwd: '/elsewhere/x', configCwd: '/repo/app/deep', gitRoot: '/repo/app' }), roots, noFold
    )).toBeNull()
    // No live cwd → the persisted config.cwd IS the available signal, and it matches.
    expect(matchPaneRootFromCandidates(pick({ configCwd: '/repo/app/deep' }), roots, noFold)).toBe('/repo/app')
    // Neither cwd signal → the git root IS the available signal, and it matches.
    expect(matchPaneRootFromCandidates(pick({ gitRoot: '/repo/app' }), roots, noFold)).toBe('/repo/app')
    // A matching live cwd wins outright — stale signals are never consulted.
    expect(matchPaneRootFromCandidates(
      pick({ liveCwd: '/repo/app/src', configCwd: '/stale/elsewhere', gitRoot: '/repo' }), roots, noFold
    )).toBe('/repo/app')
  })
})
