/** Data-driven keyboard shortcuts: a command registry, chord helpers, and a table-driven matcher.
 *  Replaces the old hardcoded keymap; `keymap.ts` re-exports this for back-compat. Pure — no DOM,
 *  no Electron, no store — so it is fully unit-testable. */

/** A normalized chord. `mod` means "Ctrl OR ⌘" (mac parity); `key` is a lowercased
 *  KeyboardEvent.key. We model only mod[+shift]+key: every app shortcut requires Ctrl/⌘, which
 *  keeps unmatched keys flowing to the terminal. */
export interface Chord { mod: boolean; shift: boolean; key: string }

/** The dispatched shortcut. `type` for the rebindable commands equals their CommandId, so the
 *  App.tsx dispatch switch is unchanged. `jump-workspace` is parametric and non-rebindable. */
export type Shortcut =
  | { type: 'toggle-palette' }
  | { type: 'toggle-broadcast' }
  | { type: 'new-terminal' }
  | { type: 'close-workspace' }
  | { type: 'next-workspace' }
  | { type: 'prev-workspace' }
  | { type: 'jump-workspace'; index: number }
  | { type: 'open-settings' }
  | { type: 'toggle-maximize-pane' }
  | { type: 'toggle-minimize-pane' }
  | { type: 'toggle-notes' }
  | { type: 'toggle-search' }
  | { type: 'redraw-terminal' }
  | { type: 'toggle-orky-queue' }

export type CommandId =
  | 'toggle-palette' | 'toggle-broadcast' | 'new-terminal' | 'close-workspace'
  | 'next-workspace' | 'prev-workspace' | 'open-settings' | 'toggle-maximize-pane'
  | 'toggle-minimize-pane' | 'toggle-notes' | 'toggle-search' | 'redraw-terminal'
  | 'toggle-orky-queue'

export interface Command { id: CommandId; label: string; category: string; defaultChord: Chord; tip?: string }

const c = (mod: boolean, shift: boolean, key: string): Chord => ({ mod, shift, key })

/** The rebindable commands. `tip` (when present) is the phrase used in status-bar tips. */
export const COMMANDS: Command[] = [
  { id: 'toggle-palette',       label: 'Command palette',    category: 'General',    defaultChord: c(true, false, 'k'),    tip: 'open the command palette' },
  { id: 'new-terminal',         label: 'New terminal pane',  category: 'Panes',      defaultChord: c(true, true, 't'),     tip: 'open a new pane' },
  { id: 'toggle-maximize-pane', label: 'Maximize pane',      category: 'Panes',      defaultChord: c(true, true, 'm'),     tip: 'maximize the focused pane' },
  { id: 'toggle-minimize-pane', label: 'Minimize pane',      category: 'Panes',      defaultChord: c(true, true, 'h'),     tip: 'minimize the focused pane to the tray' },
  { id: 'toggle-broadcast',     label: 'Broadcast to all',   category: 'Panes',      defaultChord: c(true, true, 'enter'), tip: 'broadcast to every terminal' },
  { id: 'open-settings',        label: 'Settings',           category: 'General',    defaultChord: c(true, false, ','),    tip: 'open settings' },
  { id: 'next-workspace',       label: 'Next workspace',     category: 'Workspaces', defaultChord: c(true, false, 'tab') },
  { id: 'prev-workspace',       label: 'Previous workspace', category: 'Workspaces', defaultChord: c(true, true, 'tab') },
  { id: 'close-workspace',      label: 'Close workspace',    category: 'Workspaces', defaultChord: c(true, true, 'w') },
  { id: 'toggle-notes',         label: 'Toggle notes panel',          category: 'General',    defaultChord: c(true, true, 'n'), tip: 'open the project notes panel' },
  { id: 'toggle-search',        label: 'Search output history',       category: 'General',    defaultChord: c(true, true, 'f'), tip: 'search terminal output history' },
  { id: 'redraw-terminal',      label: 'Redraw terminal',             category: 'Panes',      defaultChord: c(true, true, 'l'), tip: 'redraw a garbled terminal' },
  { id: 'toggle-orky-queue',    label: 'Toggle Orky decision queue',  category: 'General',    defaultChord: c(true, true, 'o'), tip: 'open the Orky decision queue' },
]

/** Canonical, JSON-storable, comparable key for a chord, e.g. "mod+shift+t". */
export function chordKey(ch: Chord): string {
  return [ch.mod ? 'mod' : '', ch.shift ? 'shift' : '', ch.key].filter(Boolean).join('+')
}

/** Parse a chordKey back to a Chord; null if it has no key segment. */
export function parseChordKey(s: string): Chord | null {
  const parts = s.split('+')
  const key = parts.pop()
  if (!key) return null
  const set = new Set(parts)
  return { mod: set.has('mod'), shift: set.has('shift'), key }
}

interface KeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Normalize a keyboard event to a Chord (mod = Ctrl OR ⌘). */
export function eventToChord(e: KeyEvent): Chord {
  return { mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, key: e.key.toLowerCase() }
}

const KEY_LABEL: Record<string, string> = {
  enter: 'Enter', tab: 'Tab', ' ': 'Space', escape: 'Esc',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→'
}

/** Human display, e.g. "Ctrl+Shift+T". `mod` shows as Ctrl (Windows/Linux primary target).
 *  Multi-char keys not in KEY_LABEL (e.g. function keys) are capitalized (F1 → "F1"). */
export function formatChord(ch: Chord): string {
  const key = KEY_LABEL[ch.key] ?? (ch.key.length === 1
    ? ch.key.toUpperCase()
    : ch.key.charAt(0).toUpperCase() + ch.key.slice(1))
  return [ch.mod ? 'Ctrl' : '', ch.shift ? 'Shift' : '', key].filter(Boolean).join('+')
}

export const DEFAULT_BINDINGS: Record<CommandId, Chord> =
  Object.fromEntries(COMMANDS.map(cmd => [cmd.id, cmd.defaultChord])) as Record<CommandId, Chord>

/** Effective bindings = defaults overlaid with user overrides. An override value is a chordKey
 *  string, or the sentinel 'none' meaning the command is explicitly unbound (omitted from the
 *  result). Unknown ids / unparseable chords are ignored (forward-compatible). */
export function resolveBindings(overrides: Record<string, string> | undefined): Partial<Record<CommandId, Chord>> {
  const out: Partial<Record<CommandId, Chord>> = { ...DEFAULT_BINDINGS }
  for (const [id, val] of Object.entries(overrides ?? {})) {
    if (!(id in DEFAULT_BINDINGS)) continue
    if (val === 'none') { delete out[id as CommandId]; continue }
    const ch = parseChordKey(val)
    if (ch) out[id as CommandId] = ch
  }
  return out
}

/** Map an event to a Shortcut using the given bindings (defaults if omitted). Ctrl/⌘ required;
 *  Ctrl+1..9 is a reserved, non-rebindable jump. Callers preventDefault ONLY on a non-null result
 *  so unmatched keys reach the terminal. */
export function matchShortcut(e: KeyEvent, bindings: Partial<Record<CommandId, Chord>> = DEFAULT_BINDINGS): Shortcut | null {
  const mod = e.ctrlKey || e.metaKey
  if (!mod) return null
  const k = e.key.toLowerCase()
  // Reserved numeric jump — checked first so a rebind can never shadow it.
  if (!e.shiftKey && k.length === 1 && k >= '1' && k <= '9') return { type: 'jump-workspace', index: Number(k) - 1 }
  const wanted = chordKey(eventToChord(e))
  for (const id of Object.keys(bindings) as CommandId[]) {
    const ch = bindings[id]
    if (ch && chordKey(ch) === wanted) return { type: id } as Shortcut
  }
  return null
}

/** The command currently bound to `chord` (other than `exceptId`), if any. */
export function findConflict(bindings: Partial<Record<CommandId, Chord>>, chord: Chord, exceptId: CommandId): CommandId | null {
  const wanted = chordKey(chord)
  for (const id of Object.keys(bindings) as CommandId[]) {
    if (id === exceptId) continue
    const ch = bindings[id]
    if (ch && chordKey(ch) === wanted) return id
  }
  return null
}

/** A chord is a legal rebind iff it includes Ctrl/⌘, has a real (non-modifier) key, is not a
 *  reserved Ctrl+1..9 digit, and is not the '+' key (which collides with the chordKey separator
 *  and would fail to round-trip through persistence). */
export function isValidRebind(ch: Chord): boolean {
  if (!ch.mod) return false
  if (!ch.key || ['control', 'meta', 'shift', 'alt'].includes(ch.key)) return false
  if (/^[1-9]$/.test(ch.key)) return false
  if (ch.key === '+') return false
  return true
}

/** Commands surfaced as rotating status-bar tips, in rotation order. */
export const TIP_COMMANDS: CommandId[] = ['new-terminal', 'toggle-palette', 'open-settings', 'toggle-maximize-pane', 'toggle-minimize-pane', 'toggle-broadcast']

/** Next rotation index (wraps; 0 for an empty list). */
export const nextTipIndex = (i: number, len: number): number => len === 0 ? 0 : (i + 1) % len
