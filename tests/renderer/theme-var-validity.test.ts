// FROZEN loopback suite — feature 0009-native-orky-pane (phase 4, ESC-001 tests loopback).
// REQ-019 (amended 2026-07-02, FINDING-025) — the theme-var VALIDITY guard, generalized:
//
//   TEST-462 (REPO-WIDE over src/renderer/**/*.{ts,tsx,css}): every CSS custom property referenced
//     via var(--x…) must be an ESTABLISHED token — a name the theme system emits
//     (src/shared/theme.ts's themeCssVars map) or a name that appears in src/renderer/index.css.
//     Scope note, stated honestly: "appears in index.css" accepts tokens index.css itself only
//     REFERENCES with a consistent fallback (--status-failure, --status-needs-input) — those are
//     the tokens the spec's Verified contract designates as established (REQ-019 mandates
//     --status-failure for F9's failed accent), even though nothing DECLARES them, so a
//     stricter declared-only rule would contradict the spec. The residual wider observation
//     (--status-failure/--status-needs-input always render their fallbacks; no theme override can
//     reach them) is recorded for the coordinator in 04-tests.md — it is upstream of F9.
//     Verified at design time: every non-F9 renderer file passes this rule; the ONLY offender is
//     F9's dead --status-fail (OrkyPane's failed accent — the FINDING-025 defect), so this
//     repo-wide guard is RED exactly on the F9 defect.
//
//   TEST-463 (F9-scoped): every status-token fallback in F9's components byte-matches the token's
//     ESTABLISHED fallback (--status-needs → #ff8f00, --status-failure → #c62828,
//     --status-busy → #1e88e5), and no unknown --status-* name is referenced at all — a var()
//     with an undefined name or a novel fallback literal is a hard-coded color the existing
//     hex-in-fallback scan (TEST-439) cannot catch.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { themeCssVars, DEFAULT_THEME } from '@shared/theme'

const RENDERER_ROOT = resolve(process.cwd(), 'src/renderer')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css)$/.test(name)) out.push(p)
  }
  return out
}

function establishedTokens(): Set<string> {
  const tokens = new Set<string>(Object.keys(themeCssVars(DEFAULT_THEME)))
  const indexCss = readFileSync(join(RENDERER_ROOT, 'index.css'), 'utf8')
  for (const m of indexCss.matchAll(/--[\w-]+/g)) tokens.add(m[0])
  return tokens
}

describe('theme-var validity — every referenced custom property is an established token (REQ-019 / FINDING-025)', () => {
  it('TEST-462 REQ-019 REPO-WIDE: every var(--x…) referenced under src/renderer resolves to a token in theme.ts\'s var map or index.css — a dead variable name renders its fallback unconditionally and no theme override can ever reach it', () => {
    const established = establishedTokens()
    const offenders: string[] = []
    for (const file of walk(RENDERER_ROOT)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!established.has(m[1])) offenders.push(`${relative(process.cwd(), file)}: ${m[1]}`)
      }
    }
    expect(offenders, 'undefined CSS custom properties referenced (hard-coded colors in disguise)').toEqual([])
  })

  it('TEST-463 REQ-019 F9 components: only established --status-* tokens, each with its ESTABLISHED fallback byte-for-byte — never a novel fallback literal on a parameterized surface', () => {
    const ESTABLISHED_FALLBACK: Record<string, string> = {
      '--status-needs': '#ff8f00',    // index.css:11,50 / Toasts.tsx — the needs token's standard fallback
      '--status-failure': '#c62828',  // index.css term-failure + failed-chip outline — THE failure token
      '--status-busy': '#1e88e5'
    }
    for (const rel of ['src/renderer/components/OrkyPane.tsx', 'src/renderer/components/OrkyRootPicker.tsx']) {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
      for (const m of src.matchAll(/var\(\s*(--status-[\w-]+)\s*(?:,\s*([^)]*))?\)/g)) {
        const name = m[1]
        const fallback = (m[2] ?? '').trim()
        expect(Object.keys(ESTABLISHED_FALLBACK), `${rel} references a non-established status token: ${name}`).toContain(name)
        expect(fallback, `${rel}: ${name} must carry its established fallback`).toBe(ESTABLISHED_FALLBACK[name])
      }
    }
  })
})
