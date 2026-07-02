// FROZEN unit suite — feature 0006-decision-queue-panel (phase 4 / REQ-002 keybinding + palette).
// One new REBINDABLE command `toggle-orky-queue` (default chord mod+shift+o) in the COMMANDS table,
// conflict-free against every existing default and the reserved Ctrl+1..9 jumps, honoring rebinds and
// the explicit 'none' unbind (baseline REQ-017/CHAR-013 extended, not changed). Plus the Ctrl+K
// palette entry. Runs RED: the COMMANDS entry and the palette command do not exist yet.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COMMANDS, DEFAULT_BINDINGS, findConflict, isValidRebind, matchShortcut, resolveBindings, chordKey
} from '@shared/keybindings'
import type { Chord, CommandId } from '@shared/keybindings'
import { buildCommandItems } from '@shared/quick'

const QUEUE_ID = 'toggle-orky-queue' as CommandId
const QUEUE_CHORD: Chord = { mod: true, shift: true, key: 'o' }
const ev = (key: string, shift = true) => ({ key, ctrlKey: true, metaKey: false, shiftKey: shift })

describe('toggle-orky-queue — COMMANDS registration (REQ-002)', () => {
  it('TEST-325 REQ-002 COMMANDS contains toggle-orky-queue with default chord mod+shift+o and a queue-naming label', () => {
    const cmd = COMMANDS.find(c => c.id === QUEUE_ID)
    expect(cmd).toBeDefined()
    expect(cmd!.defaultChord).toEqual(QUEUE_CHORD)
    expect(cmd!.label).toMatch(/orky/i)
    expect(cmd!.label).toMatch(/queue/i)
    expect(DEFAULT_BINDINGS[QUEUE_ID]).toEqual(QUEUE_CHORD)
  })

  it('TEST-326 REQ-002 the default chord is conflict-free, a legal rebind target, and not a reserved Ctrl+1..9 digit', () => {
    expect(findConflict(DEFAULT_BINDINGS, QUEUE_CHORD, QUEUE_ID)).toBeNull()
    expect(isValidRebind(QUEUE_CHORD)).toBe(true)
    expect(/^[1-9]$/.test(QUEUE_CHORD.key)).toBe(false)
    // No OTHER default occupies mod+shift+o (belt-and-braces over findConflict).
    for (const c of COMMANDS) {
      if (c.id === QUEUE_ID) continue
      expect(chordKey(c.defaultChord)).not.toBe(chordKey(QUEUE_CHORD))
    }
  })

  it('TEST-327 REQ-002 matchShortcut dispatches Ctrl+Shift+O to { type: toggle-orky-queue } under the defaults', () => {
    expect(matchShortcut(ev('O'))).toEqual({ type: QUEUE_ID })
    expect(matchShortcut(ev('o'))).toEqual({ type: QUEUE_ID })
    // Without shift it is NOT the queue toggle (mod+o is unbound).
    expect(matchShortcut(ev('o', false))).toBeNull()
  })

  it('TEST-328 REQ-002 a rebind is honored and an explicit none unbinds (resolveBindings is the single registry)', () => {
    const rebound = resolveBindings({ [QUEUE_ID]: 'mod+shift+y' })
    expect(matchShortcut(ev('y'), rebound)).toEqual({ type: QUEUE_ID })
    expect(matchShortcut(ev('o'), rebound)).toBeNull()
    const unbound = resolveBindings({ [QUEUE_ID]: 'none' })
    expect(unbound[QUEUE_ID]).toBeUndefined()
    expect(matchShortcut(ev('o'), unbound)).toBeNull()
  })
})

describe('toggle-orky-queue — Ctrl+K palette entry (REQ-002)', () => {
  it('TEST-329 REQ-002 buildCommandItems offers the queue toggle and the palette activates it via setQueueOpen', () => {
    const item = buildCommandItems().find(i => i.kind === 'action' && (i as { action?: string }).action === 'toggle-orky-queue')
    expect(item).toBeDefined()
    expect(item!.label).toMatch(/queue/i)
    // The palette's activate() path must handle the new action by toggling the store's queueOpen —
    // and it must work WITHOUT an active workspace (the drawer is window chrome, not a pane).
    const palette = readFileSync(resolve(process.cwd(), 'src/renderer/components/CommandPalette.tsx'), 'utf8')
    expect(palette).toContain('toggle-orky-queue')
    expect(palette).toContain('setQueueOpen')
  })
})
