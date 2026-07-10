// Docs suite — feature 0025-cursor-home-output-suppression (phase 4).
// REQ-011 (CONV-008, doc-sync): every LIVING claim that "a chunk beginning with a
// cursor-home sequence is excluded from the status tail" is retired or amended to the new
// contract — "excluded from the quiet timer and all state effects; its printable text IS
// admitted to the tail" — across CLAUDE.md, docs/ (superpowers history excepted), and
// .orky/baseline/. TASK-007's doc edits make these true; the pins define the contract —
// this file runs RED at the tests phase (the docs-feature-0022/0024 precedent).
// Historical/past-tense records (docs/superpowers/, CHANGELOG history, the struck-through
// FIXED bug entries) are allowed per the REQ; the banned regexes below therefore match only
// the PRESENT-TENSE current-behavior phrasings that are live today.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = process.cwd()
const read = (rel: string): string => readFileSync(resolve(root, rel), 'utf8')

const walk = (dir: string, exts: string[], skipDirs: string[] = []): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!skipDirs.includes(name)) out.push(...walk(p, exts, skipDirs))
    } else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

describe('TEST-2531 REQ-011 baseline architecture.md marks known bug #4 FIXED with this feature', () => {
  it('bug #4 follows the FIXED pattern of bugs #1-#3 and cites 0025', () => {
    const arch = read('.orky/baseline/architecture.md')
    const start = arch.indexOf('4. **[KNOWN BUG')
    expect(start, 'bug #4 entry must still exist').toBeGreaterThan(-1)
    const nextHeading = arch.indexOf('\n## ', start)
    const item4 = arch.slice(start, nextHeading === -1 ? undefined : nextHeading)
    expect(item4).toMatch(/^4\. \*\*\[KNOWN BUG — FIXED/)
    expect(item4).toMatch(/0025/)
    // The pre-fix marker must be gone (nothing else uses this exact phrasing).
    expect(arch).not.toMatch(/KNOWN BUG — confirmed, fix with care/)
  })
})

describe('TEST-2532 REQ-011 no living surface still claims repaint chunks are excluded from the tail', () => {
  /** Present-tense current-behavior phrasings that are live TODAY and must be retired. */
  const BANNED: RegExp[] = [
    // CLAUDE.md — "A marker-less pane treats output as the only busy signal…" bullet:
    /MUST stay inside the `isPureControl` guard/,
    // docs/features/status-engine.md — marker-less-busy bullet:
    /lives \*\*inside\*\* the `isPureControl` guard/,
    // docs/features/status-engine.md — "ANSI-strip tail hazard" bullet:
    /cursor-home-prefixed chunks \(`isPureControl`\) as non-output/,
    // .orky/baseline/architecture.md — bug #4's present-tense description:
    /is treated as a screen repaint and excluded from the status tail/,
    // docs/deferred.md — "#4 is the only one still open":
    /leaving only #4 open/,
    // .orky/baseline/inferred-spec.md — baseline REQ-007's present-tense clause + its retired
    // acceptance vector (ESC-001 / FINDING-004: the spec's REQ-011 MUST scopes the WHOLE
    // .orky/baseline/ tree; the amended entry carries a 0025 supersession note instead):
    /treated as a screen repaint \(`isPureControl` true\)/,
    /isPureControl\('\\x1b\[Hreal text'\)===true/,
    // docs/features/ai-session-awareness.md — the retired classification surviving as
    // mechanism vocabulary (FINDING-008): post-0025 a repaint carrying printable text is NOT
    // pure-control, so the AGENT_WORKING_RE scan must not be described as reading
    // "pure-control repaints".
    /pure-control (?:screen )?repaints/
  ]

  it('CLAUDE.md, docs/ (superpowers history excepted), and .orky/baseline/ carry no retired phrasing', () => {
    const surfaces: string[] = [resolve(root, 'CLAUDE.md')]
    surfaces.push(...walk(resolve(root, 'docs'), ['.md'], ['superpowers']))
    if (existsSync(resolve(root, '.orky/baseline'))) {
      surfaces.push(...walk(resolve(root, '.orky/baseline'), ['.md']))
    }
    const offenders: string[] = []
    for (const f of surfaces) {
      const text = readFileSync(f, 'utf8')
      for (const re of BANNED) {
        if (re.test(text)) offenders.push(`${f} still matches ${String(re)}`)
      }
    }
    expect(offenders, `retire every phrasing in the SAME change (CONV-008):\n${offenders.join('\n')}`).toEqual([])
  })
})

describe('TEST-2533 REQ-011 the living docs state the NEW contract positively', () => {
  // The REQ's own wording: repaint chunks are "excluded from the quiet timer and all state
  // effects; its printable text IS admitted to the tail". The amended bullets must carry the
  // load-bearing half of that sentence.
  it('CLAUDE.md status gotchas describe repaint printable text as admitted to the tail', () => {
    expect(read('CLAUDE.md')).toMatch(/admitted to the (?:needs-input |status )?tail/i)
  })
  it('docs/features/status-engine.md describes repaint printable text as admitted to the tail', () => {
    expect(read('docs/features/status-engine.md')).toMatch(/admitted to the (?:needs-input |status )?tail/i)
  })
  it('docs/decisions.md surrounding prose is brought current (the locked decision text itself stays verbatim)', () => {
    const decisions = read('docs/decisions.md')
    // The 2026-07-08 locked decision heading must survive byte-identical…
    expect(decisions).toContain('A marker-less pane goes busy on real output only — never on a repaint')
    // …while the doc gains the 0025 amendment context somewhere in surrounding prose.
    expect(decisions).toMatch(/0025|admitted to the (?:needs-input |status )?tail/i)
  })
})

describe('TEST-2534 REQ-011 CHANGELOG [Unreleased] records the fix', () => {
  it('the [Unreleased] section mentions the cursor-home repaint admission', () => {
    const changelog = read('CHANGELOG.md')
    const start = changelog.indexOf('## [Unreleased]')
    expect(start).toBeGreaterThan(-1)
    const next = changelog.indexOf('\n## [', start + 1)
    const unreleased = changelog.slice(start, next === -1 ? undefined : next)
    expect(unreleased).toMatch(/cursor.home/i)
  })
})
