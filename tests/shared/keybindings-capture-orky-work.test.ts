// FROZEN unit suite — feature 0012-quick-capture-inbox (phase 4 — REQ-001, invocation surface).
// One new REBINDABLE command `capture-orky-work` (default chord mod+shift+u — decision #1: every
// plausible mnemonic collides: o=queue, n=notes, w=close-workspace, i=Electron's toggleDevTools role
// accelerator in Termhalla's own menu, c=terminal-copy; u is unoccupied) in the COMMANDS table,
// conflict-free against EVERY existing default and the reserved Ctrl+1..9 jumps, honoring rebinds and
// the explicit 'none' unbind through the ONE resolveBindings registry. Plus the Ctrl+K palette entry.
// Mirrors tests/shared/keybindings-toggle-queue.test.ts (the F6 precedent) exactly — that frozen
// suite (TEST-325..329, incl. TEST-326's belt-and-braces all-defaults loop) stays green byte-unchanged.
//
// Runs RED today: the COMMANDS entry, PaletteAction member, and palette command do not exist yet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMMANDS, DEFAULT_BINDINGS, findConflict, isValidRebind, matchShortcut, resolveBindings, chordKey
} from '@shared/keybindings'
import type { Chord, CommandId } from '@shared/keybindings'
import { buildCommandItems } from '@shared/quick'

const CAPTURE_ID = 'capture-orky-work' as CommandId
const CAPTURE_CHORD: Chord = { mod: true, shift: true, key: 'u' }
const ev = (key: string, shift = true) => ({ key, ctrlKey: true, metaKey: false, shiftKey: shift })

describe('capture-orky-work — COMMANDS registration (REQ-001)', () => {
  it('TEST-497 REQ-001 COMMANDS contains capture-orky-work with default chord mod+shift+u and a capture-naming label', () => {
    const cmd = COMMANDS.find(c => c.id === CAPTURE_ID)
    expect(cmd).toBeDefined()
    expect(cmd!.defaultChord).toEqual(CAPTURE_CHORD)
    expect(cmd!.label).toMatch(/capture/i)
    expect(cmd!.label).toMatch(/orky/i)
    expect(cmd!.label).toMatch(/work/i)
    expect(DEFAULT_BINDINGS[CAPTURE_ID]).toEqual(CAPTURE_CHORD)
  })

  it('TEST-498 REQ-001 the default chord is conflict-free against EVERY existing default, a legal rebind target, and not a reserved Ctrl+1..9 digit — so F6\'s frozen TEST-326 all-defaults loop stays green', () => {
    expect(findConflict(DEFAULT_BINDINGS, CAPTURE_CHORD, CAPTURE_ID)).toBeNull()
    expect(isValidRebind(CAPTURE_CHORD)).toBe(true)
    expect(/^[1-9]$/.test(CAPTURE_CHORD.key)).toBe(false)
    // Belt-and-braces over findConflict: no OTHER default occupies mod+shift+u (the TEST-326 pattern —
    // this is the symmetric guarantee that keeps THAT frozen loop green when this entry is added).
    for (const c of COMMANDS) {
      if (c.id === CAPTURE_ID) continue
      expect(chordKey(c.defaultChord), `${c.id} must not collide with the capture chord`).not.toBe(chordKey(CAPTURE_CHORD))
    }
  })

  it('TEST-499 REQ-001 matchShortcut dispatches Ctrl+Shift+U to { type: capture-orky-work } under the defaults; without shift it matches nothing (mod+u stays unbound)', () => {
    expect(matchShortcut(ev('U'))).toEqual({ type: CAPTURE_ID })
    expect(matchShortcut(ev('u'))).toEqual({ type: CAPTURE_ID })
    expect(matchShortcut(ev('u', false))).toBeNull()
  })

  it('TEST-500 REQ-001 a rebind is honored and an explicit \'none\' unbinds — resolveBindings is the single registry, no second keybinding path', () => {
    const rebound = resolveBindings({ [CAPTURE_ID]: 'mod+shift+j' })
    expect(matchShortcut(ev('j'), rebound)).toEqual({ type: CAPTURE_ID })
    expect(matchShortcut(ev('u'), rebound)).toBeNull()
    const unbound = resolveBindings({ [CAPTURE_ID]: 'none' })
    expect(unbound[CAPTURE_ID]).toBeUndefined()
    expect(matchShortcut(ev('u'), unbound)).toBeNull()
  })
})

describe('capture-orky-work — Ctrl+K palette entry (REQ-001)', () => {
  it('TEST-501 REQ-001 buildCommandItems offers the capture action with a /capture/i label and search terms covering capture/orky/work/idea/inbox; the palette activates it via openOrkyCapture()', () => {
    const item = buildCommandItems().find(i => i.kind === 'action' && (i as { action?: string }).action === 'capture-orky-work')
    expect(item).toBeDefined()
    expect(item!.label).toMatch(/capture/i)
    for (const term of ['capture', 'orky', 'work', 'idea', 'inbox']) {
      expect((item as { search: string }).search, `palette search must cover "${term}"`).toContain(term)
    }
    // The palette's activate() path must call the ONE store-level entry point with NO argument (the
    // picker-first flow) — and it must work WITHOUT an active workspace (ordering vs the activeId
    // guard is pinned structurally in tests/renderer/orky-capture-structure.test.ts TEST-495).
    const palette = readFileSync(resolve(process.cwd(), 'src/renderer/components/CommandPalette.tsx'), 'utf8')
    expect(palette).toContain('capture-orky-work')
    expect(palette).toContain('openOrkyCapture')
  })
})
