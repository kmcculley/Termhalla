import type { WindowState } from '@shared/types'

export const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200, height: 800, maximized: false
}

export interface DisplayBounds { x: number; y: number; width: number; height: number }

/** Pure: ensure the window sits on a known display; otherwise recenter on the first. */
export function clampWindowState(
  state: WindowState | undefined, displays: DisplayBounds[]
): WindowState {
  if (!state) return { ...DEFAULT_WINDOW_STATE }
  const onScreen = displays.some(d =>
    state.x !== undefined && state.y !== undefined &&
    state.x >= d.x && state.y >= d.y &&
    state.x + state.width <= d.x + d.width &&
    state.y + state.height <= d.y + d.height)
  if (onScreen || state.x === undefined) return state
  const d = displays[0]
  return {
    ...state,
    x: Math.round(d.x + (d.width - state.width) / 2),
    y: Math.round(d.y + (d.height - state.height) / 2)
  }
}
