import type { State, SliceDeps, SettingsTarget } from './types'

type SettingsSlice = Pick<State, 'settings' | 'openSettings' | 'closeSettings'>

/** Ephemeral open-state for the unified Settings panel: which section + (optionally)
 *  which pane's context. Never persisted. */
export function createSettingsSlice({ set }: SliceDeps): SettingsSlice {
  return {
    settings: null,
    openSettings: (t: SettingsTarget) => set({ settings: t }),
    closeSettings: () => set({ settings: null })
  }
}
