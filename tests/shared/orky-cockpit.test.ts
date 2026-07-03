// FROZEN unit suite — feature 0011-orky-workspace-template (phase 4 / TASK-001, REQ-001).
// The pure, deterministic cockpit generator: src/shared/orky-cockpit.ts (renderer-safe, no
// DOM/Electron/node builtins/ambient platform read — the orky-pane.ts discipline).
//
// Chosen contract (02-spec.md "Public interface" — frozen here):
//   export const ORKY_COCKPIT_TEMPLATE_ID: string
//   export function orkyCockpitTemplate(o: { root: string; shellId: string }): WorkspaceTemplate
//   export function orkyCockpitName(root: string): string   // 'Orky: <last path segment>'
//
// Runs RED today (2026-07-02): src/shared/orky-cockpit.ts does not exist (module-not-found).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ORKY_COCKPIT_TEMPLATE_ID, orkyCockpitTemplate, orkyCockpitName } from '@shared/orky-cockpit'
import type { MosaicParent, WorkspaceTemplate } from '@shared/types'

// REQ-001's spelled acceptance vectors: mixed-case Windows, POSIX, UNC, trailing-separator.
const VECTORS = [
  'C:\\Dev\\MixedCase\\Proj',
  '/home/kev/proj',
  '\\\\server\\share\\proj',
  'C:\\dev\\Trailing\\'
]

function panesOf(tpl: WorkspaceTemplate) {
  const configs = Object.values(tpl.panes).map(p => p.config as unknown as Record<string, unknown>)
  return {
    orky: configs.find(c => c.kind === 'orky') as { kind: string; root: unknown } | undefined,
    terminal: configs.find(c => c.kind === 'terminal') as Record<string, unknown> | undefined,
    all: configs
  }
}

describe('orkyCockpitTemplate — exactly an orky pane + a terminal pane in a row split (REQ-001)', () => {
  it('TEST-649 REQ-001 every vector yields EXACTLY two panes — { kind:"orky", root } byte-verbatim and { kind:"terminal", shellId, cwd: root } byte-verbatim with NO other terminal key — in a { direction:"row", first: orky, second: terminal } layout with no splitPercentage, named orkyCockpitName(root)', () => {
    for (const root of VECTORS) {
      const tpl = orkyCockpitTemplate({ root, shellId: 'pwsh' })
      const { orky, terminal, all } = panesOf(tpl)
      expect(all, `${root}: exactly two panes`).toHaveLength(2)

      // the orky binding is BYTE-verbatim (never re-cased/re-slashed/re-resolved)
      expect(orky, `${root}: an orky pane exists`).toBeDefined()
      expect(orky!.root).toBe(root)

      // the terminal carries EXACTLY kind/shellId/cwd — no launch, resumeAi, runCommands, envId,
      // name, alerts (D4: plain shell at the root; the launchDir recipe and nothing more)
      expect(terminal, `${root}: a terminal pane exists`).toBeDefined()
      expect(Object.keys(terminal!).sort()).toEqual(['cwd', 'kind', 'shellId'])
      expect(terminal!.shellId).toBe('pwsh')
      expect(terminal!.cwd).toBe(root)

      // layout: one row parent, orky leaf FIRST, terminal leaf SECOND, default 50/50 (no
      // splitPercentage key at all — not even undefined-valued)
      const layout = tpl.layout as MosaicParent
      expect(layout.direction).toBe('row')
      expect(typeof layout.first).toBe('string')
      expect(typeof layout.second).toBe('string')
      expect((tpl.panes[layout.first as string].config as { kind: string }).kind).toBe('orky')
      expect((tpl.panes[layout.second as string].config as { kind: string }).kind).toBe('terminal')
      expect('splitPercentage' in layout).toBe(false)

      expect(tpl.name).toBe(orkyCockpitName(root))
      expect(tpl.id).toBe(ORKY_COCKPIT_TEMPLATE_ID)
    }
  })

  it('TEST-650 REQ-001 deterministic: two calls with identical args return DEEP-EQUAL values (no clock/random/id-generation leak into the blueprint), and the sentinel template id is a fixed non-empty string', () => {
    expect(typeof ORKY_COCKPIT_TEMPLATE_ID).toBe('string')
    expect(ORKY_COCKPIT_TEMPLATE_ID.length).toBeGreaterThan(0)
    for (const root of VECTORS) {
      const a = orkyCockpitTemplate({ root, shellId: 'pwsh' })
      const b = orkyCockpitTemplate({ root, shellId: 'pwsh' })
      expect(a).toEqual(b) // same args -> identical structure, modulo NOTHING (ids are the seam's job)
    }
    // distinct roots produce distinct bindings but the SAME structural shape
    const x = orkyCockpitTemplate({ root: VECTORS[0], shellId: 'pwsh' })
    const y = orkyCockpitTemplate({ root: VECTORS[1], shellId: 'pwsh' })
    expect(Object.keys(x.panes).sort()).toEqual(Object.keys(y.panes).sort())
  })
})

describe('orkyCockpitName — total, pure naming (REQ-001 / CONV-002)', () => {
  it('TEST-651 REQ-001 "Orky: <last non-empty segment>" splitting on BOTH separators; trailing-separator and POSIX vectors hold; a segmentless/separator-only input falls back to the VERBATIM root and never throws', () => {
    expect(orkyCockpitName('C:\\dev\\Proj\\')).toBe('Orky: Proj') // the spec's literal vector
    expect(orkyCockpitName('/a/b')).toBe('Orky: b')               // the spec's literal vector
    expect(orkyCockpitName('C:\\Dev\\MixedCase\\Proj')).toBe('Orky: Proj')
    expect(orkyCockpitName('\\\\server\\share\\proj')).toBe('Orky: proj')
    expect(orkyCockpitName('/a/b/')).toBe('Orky: b')
    // total on ANY string input (CONV-002): segmentless roots fall back to the verbatim root
    for (const degenerate of ['\\', '/', '\\\\', '///', '']) {
      let out = ''
      expect(() => { out = orkyCockpitName(degenerate) }, `separator-only ${JSON.stringify(degenerate)} must not throw`).not.toThrow()
      expect(typeof out).toBe('string')
      expect(out.startsWith('Orky:')).toBe(true)
      expect(out.includes(degenerate)).toBe(true) // the verbatim-root fallback (decision 3)
    }
  })
})

describe('module purity — no clock, no randomness, no ambient platform, no id generation (REQ-001)', () => {
  it('TEST-652 REQ-001 a source grep of src/shared/orky-cockpit.ts finds no Date.now / Math.random / localeCompare / process read / navigator read / uuid import / node-builtin import / DOM-Electron reference', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/shared/orky-cockpit.ts'), 'utf8')
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random/)
    expect(src).not.toContain('localeCompare')
    expect(src).not.toMatch(/\bprocess\s*[.[]/)
    expect(src).not.toContain('navigator')
    // ids are the workspaceFromTemplate seam's job — the generator generates none
    expect(src).not.toMatch(/from 'uuid'|require\(['"]uuid/)
    // renderer-safe: no node builtins, no path module (the pure both-separator split instead),
    // no Electron, no DOM
    expect(src).not.toMatch(/from ['"]node:|require\(['"]node:|from ['"]path['"]|from ['"]electron/)
    expect(src).not.toMatch(/\bdocument\.|\bwindow\./)
  })
})
