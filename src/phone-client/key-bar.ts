/**
 * The accessory key bar's pure key -> byte-sequence mapping (feature 0026, REQ-023). No DOM
 * dependency: the terminal view wires taps into this module's `press()`, which returns the exact
 * bytes to write to the pane's input stream. `ctrl` latches the modifier for exactly the NEXT
 * key (Ctrl+letter -> 0x01..0x1a, case-insensitive); every other key clears the latch without
 * fabricating a control byte. Unknown keys are a silent no-op — never a throw.
 */

const SPECIAL: Record<string, string> = {
  esc: '\x1b',
  tab: '\t',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D'
}

export interface KeyBar {
  /** The bytes to emit for one key-bar tap ('' = nothing to emit). */
  press(key: string): string
  isCtrlLatched(): boolean
  /** Routes a `term.onData` (soft-keyboard/typed) datum through the SAME Ctrl latch `press` uses
   *  (feature 0026 v2, REQ-023 — closes FINDING-033): with the latch armed, a single-letter datum
   *  becomes its control byte (Ctrl+C is producible by tapping Ctrl then typing 'c' on the iOS
   *  keyboard) and the latch clears, one-shot, exactly like a key-bar tap. Unlatched or
   *  non-single-letter data (pastes, multi-byte input) passes through unchanged — never a
   *  fabricated control byte. */
  transformTyped(data: string): string
}

/** Ctrl+<letter> -> 0x01..0x1a, case-insensitive; every other single character (or the latch
 *  being unarmed) never fabricates a control byte. Shared by `press` and `transformTyped`. */
const controlByteFor = (letter: string): string | undefined => {
  if (typeof letter !== 'string' || letter.length !== 1) return undefined
  const code = letter.toUpperCase().charCodeAt(0)
  return code >= 65 && code <= 90 ? String.fromCharCode(code - 64) : undefined
}

export function createKeyBar(): KeyBar {
  let ctrlLatched = false

  return {
    press(key) {
      if (key === 'ctrl') {
        ctrlLatched = true
        return ''
      }
      const wasLatched = ctrlLatched
      ctrlLatched = false

      if (wasLatched) {
        const controlByte = controlByteFor(key)
        if (controlByte) return controlByte
      }

      if (Object.prototype.hasOwnProperty.call(SPECIAL, key)) return SPECIAL[key]
      if (typeof key === 'string' && key.length === 1) return key
      return ''
    },
    isCtrlLatched() {
      return ctrlLatched
    },
    transformTyped(data) {
      const wasLatched = ctrlLatched
      if (!wasLatched) return data
      // Only a PLAUSIBLE single-character keystroke may consume the latch. xterm's `onData`
      // callback also carries the terminal's OWN generated escape sequences — notably DEC mode
      // 1004 focus-tracking reports (`\x1b[I`/`\x1b[O`), fired whenever DOM focus moves into/out
      // of the terminal, which happens on the VERY NEXT `onData` after a key-bar tap (clicking
      // the Ctrl button itself steals focus, and re-focusing the terminal to type re-fires it).
      // Without this guard that spurious multi-character event silently consumed an armed latch
      // before the real keystroke ever arrived, so Ctrl+C could never be typed on a real page
      // (verified against the served client: `\x1b[I` arrives latched, clears it, and the
      // following 'c' then passes through as a literal, unlatched character).
      if (typeof data !== 'string' || data.length !== 1) return data
      ctrlLatched = false
      const controlByte = controlByteFor(data)
      return controlByte ?? data
    }
  }
}
