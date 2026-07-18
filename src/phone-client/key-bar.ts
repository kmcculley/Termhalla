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

      if (wasLatched && typeof key === 'string' && key.length === 1) {
        const code = key.toUpperCase().charCodeAt(0)
        if (code >= 65 && code <= 90) return String.fromCharCode(code - 64)
      }

      if (Object.prototype.hasOwnProperty.call(SPECIAL, key)) return SPECIAL[key]
      if (typeof key === 'string' && key.length === 1) return key
      return ''
    },
    isCtrlLatched() {
      return ctrlLatched
    }
  }
}
