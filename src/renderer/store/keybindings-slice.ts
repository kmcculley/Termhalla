import { chordKey, type Chord, type CommandId } from '@shared/keybindings'
import type { State, SliceDeps } from './types'

type KeybindingsSlice = Pick<State, 'setBinding' | 'unbindCommand' | 'resetBinding' | 'resetAllBindings'>

/** User keyboard-shortcut overrides (CommandId -> chordKey | 'none'), stored on `quick`
 *  (per-machine) and saved via the debounced quick-save, like theme. An absent id means the
 *  command is at its default; the 'none' sentinel means it is explicitly unbound. */
export function createKeybindingsSlice({ set, scheduleQuickSave }: SliceDeps): KeybindingsSlice {
  return {
    setBinding: (id: CommandId, chord: Chord) => {
      set(s => ({ quick: { ...s.quick, keybindings: { ...s.quick.keybindings, [id]: chordKey(chord) } } }))
      scheduleQuickSave()
    },
    unbindCommand: (id: CommandId) => {
      set(s => ({ quick: { ...s.quick, keybindings: { ...s.quick.keybindings, [id]: 'none' } } }))
      scheduleQuickSave()
    },
    resetBinding: (id: CommandId) => {
      set(s => { const kb = { ...s.quick.keybindings }; delete kb[id]; return { quick: { ...s.quick, keybindings: kb } } })
      scheduleQuickSave()
    },
    resetAllBindings: () => {
      set(s => ({ quick: { ...s.quick, keybindings: {} } }))
      scheduleQuickSave()
    }
  }
}
