/** Terminal font-size bounds for Ctrl+scroll zoom. Match the numeric input in ThemeSettings so a
 *  zoom and a manual edit can't disagree on the allowed range. */
export const FONT_SIZE_MIN = 8
export const FONT_SIZE_MAX = 32

/** The font size after one Ctrl+wheel notch. Up (deltaY < 0) grows, down shrinks, each by one px,
 *  clamped to [min, max]. A zero delta is a no-op so a stray inertial event can't drift the size. */
export function nextFontSize(current: number, deltaY: number, min = FONT_SIZE_MIN, max = FONT_SIZE_MAX): number {
  if (deltaY === 0) return current
  const step = deltaY < 0 ? 1 : -1
  return Math.min(max, Math.max(min, current + step))
}
