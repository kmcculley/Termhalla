// FROZEN unit suite — feature 0003-pane-minimize-restore (phase 4 / TASK-006 keybinding).
// REQ-001/REQ-013: a rebindable `toggle-minimize-pane` command whose surfaced accelerator/tooltip is
// DERIVED from the keybinding registry (formatChord), never hard-coded. Runs RED today: the command
// is not in COMMANDS / DEFAULT_BINDINGS yet.
import { describe, it, expect } from 'vitest'
import { COMMANDS, DEFAULT_BINDINGS, matchShortcut, resolveBindings, formatChord, type Chord } from '@shared/keybindings'

const CMD = 'toggle-minimize-pane'
const bindingOf = (m: Record<string, Chord | undefined>): Chord | undefined => m[CMD]

describe('toggle-minimize-pane command (REQ-001 / REQ-013)', () => {
  it('TEST-021 REQ-001/REQ-013 the command exists with a default chord that matches and derives its label', () => {
    expect(COMMANDS.some(c => c.id === (CMD as unknown as typeof COMMANDS[number]['id']))).toBe(true)
    const ch = bindingOf(DEFAULT_BINDINGS as unknown as Record<string, Chord | undefined>)
    expect(ch).toBeTruthy()
    // The default chord round-trips to the command through the table-driven matcher.
    const ev = { key: ch!.key, ctrlKey: true, metaKey: false, shiftKey: ch!.shift }
    expect(matchShortcut(ev)).toEqual({ type: CMD })
    // The accelerator/tooltip is produced by formatChord (a non-empty, Ctrl-led string).
    expect(formatChord(ch!).length).toBeGreaterThan(0)
    expect(formatChord(ch!).startsWith('Ctrl')).toBe(true)
  })

  it('TEST-022 REQ-013 rebinding the command changes the surfaced accelerator', () => {
    const resolved = resolveBindings({ [CMD]: 'mod+shift+x' }) as unknown as Record<string, Chord | undefined>
    expect(bindingOf(resolved)).toEqual({ mod: true, shift: true, key: 'x' })
    expect(formatChord(bindingOf(resolved)!)).toBe('Ctrl+Shift+X')
  })
})
