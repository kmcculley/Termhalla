// The e2e harness must never put pixels on the developer's screen: ~190 app launches per run, each
// of which used to raise a window and could fire real desktop toasts. `TERMHALLA_E2E_WINDOW` is set
// only by playwright.config.ts; unset, every predicate must report production behavior so the
// shipped app is untouched.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { presentationMode, presentsWindows, raisesOsSurfaces } from '../../src/main/e2e-presentation'

const walk = (dir: string, ext: string): string[] => {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, ext))
    else if (p.endsWith(ext)) out.push(p)
  }
  return out
}

describe('presentationMode', () => {
  it('recognizes the two harness modes', () => {
    expect(presentationMode('hidden')).toBe('hidden')
    expect(presentationMode('inactive')).toBe('inactive')
  })

  it('falls back to production behavior when unset or unrecognized', () => {
    expect(presentationMode(undefined)).toBe('show')
    expect(presentationMode('')).toBe('show')
    expect(presentationMode('show')).toBe('show')
    expect(presentationMode('Hidden')).toBe('show')   // exact match only — no accidental suppression
    expect(presentationMode('nonsense')).toBe('show')
  })

  it('reads the harness env by default', () => {
    const saved = process.env.TERMHALLA_E2E_WINDOW
    try {
      process.env.TERMHALLA_E2E_WINDOW = 'hidden'
      expect(presentationMode()).toBe('hidden')
      delete process.env.TERMHALLA_E2E_WINDOW
      expect(presentationMode()).toBe('show')
    } finally {
      if (saved === undefined) delete process.env.TERMHALLA_E2E_WINDOW
      else process.env.TERMHALLA_E2E_WINDOW = saved
    }
  })
})

describe('presentsWindows', () => {
  it('presents in every mode but hidden', () => {
    expect(presentsWindows('hidden')).toBe(false)
    expect(presentsWindows('inactive')).toBe(true)
    expect(presentsWindows('show')).toBe(true)
  })
})

describe('raisesOsSurfaces', () => {
  // False for BOTH harness modes, not just 'hidden': `inactive` presents a window but never activates
  // it, so `BrowserWindow.getFocusedWindow()` is still null and a raise would still steal the
  // foreground. (Renderer focus is a separate matter — Playwright emulates it, so document.hasFocus()
  // is true in every mode; this predicate governs MAIN-side surfaces only.)
  it('is false for inactive as well as hidden — neither may raise the foreground', () => {
    expect(raisesOsSurfaces('hidden')).toBe(false)
    expect(raisesOsSurfaces('inactive')).toBe(false)
  })

  it('is true in production, so the shipped app reaches toasts by the same code path', () => {
    expect(raisesOsSurfaces('show')).toBe(true)
    expect(raisesOsSurfaces(presentationMode(undefined))).toBe(true)
  })
})

describe('no regression seam', () => {
  it('every `new Notification(` in src/main is gated on raisesOsSurfaces', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(process.cwd(), 'src/main'), '.ts')) {
      const src = readFileSync(f, 'utf8')
      if (!/\bnew Notification\s*\(/.test(src)) continue
      if (!/\braisesOsSurfaces\b/.test(src)) offenders.push(f.replace(/\\/g, '/'))
    }
    expect(offenders, 'gate the toast on raisesOsSurfaces() from src/main/e2e-presentation.ts — an e2e run must never raise a desktop notification').toEqual([])
  })

  it('window presentation is decided only through e2e-presentation.ts', () => {
    const offenders: string[] = []
    for (const f of walk(resolve(process.cwd(), 'src/main'), '.ts')) {
      const norm = f.replace(/\\/g, '/')
      if (norm.endsWith('src/main/e2e-presentation.ts')) continue
      // Comments legitimately NAME the variable to explain why a call site is gated; only code that
      // READS it is a regression seam.
      const code = readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      if (/TERMHALLA_E2E_WINDOW/.test(code)) offenders.push(norm)
    }
    expect(offenders, 'import presentationMode()/presentsWindows()/raisesOsSurfaces() instead of reading the env var directly').toEqual([])
  })
})
