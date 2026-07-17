/** Data-driven keyboard shortcuts: a command registry, chord helpers, and a table-driven matcher.
 *  Replaces the old hardcoded keymap; `keymap.ts` re-exports this for back-compat. Pure — no DOM,
 *  no Electron, no store — so it is fully unit-testable. */

/** A normalized chord. `mod` means "Ctrl OR ⌘" (mac parity); `key` is a lowercased
 *  KeyboardEvent.key; `alt` (optional, QoL batch 2026-07-17) adds the Alt modifier. Every app
 *  shortcut still requires Ctrl/⌘, which keeps unmatched keys flowing to the terminal. Modeling
 *  alt also FIXES a latent AltGr bug: AltGr reports ctrl+alt on many layouts, and the old
 *  alt-blind matcher let AltGr+K falsely trigger the mod+K palette while typing. */
export interface Chord { mod: boolean; shift: boolean; key: string; alt?: boolean }

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
  | { type: 'capture-orky-work' }
  | { type: 'close-pane' }
  | { type: 'focus-pane-left' }
  | { type: 'focus-pane-right' }
  | { type: 'focus-pane-up' }
  | { type: 'focus-pane-down' }
  | { type: 'restore-last-minimized' }
  | { type: 'font-zoom-in' }
  | { type: 'font-zoom-out' }
  | { type: 'font-zoom-reset' }
  | { type: 'clear-terminal' }
  | { type: 'find-in-terminal' }

export type CommandId =
  | 'toggle-palette' | 'toggle-broadcast' | 'new-terminal' | 'close-workspace'
  | 'next-workspace' | 'prev-workspace' | 'open-settings' | 'toggle-maximize-pane'
  | 'toggle-minimize-pane' | 'toggle-notes' | 'toggle-search' | 'redraw-terminal'
  | 'toggle-orky-queue' | 'capture-orky-work'
  | 'close-pane' | 'focus-pane-left' | 'focus-pane-right' | 'focus-pane-up' | 'focus-pane-down'
  | 'restore-last-minimized' | 'font-zoom-in' | 'font-zoom-out' | 'font-zoom-reset'
  | 'clear-terminal' | 'find-in-terminal'

export interface Command { id: CommandId; label: string; category: string; defaultChord: Chord; tip?: string }

const c = (mod: boolean, shift: boolean, key: string): Chord => ({ mod, shift, key })
const ca = (key: string): Chord => ({ mod: true, shift: false, alt: true, key })

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
  // Feature 0012: mod+shift+u because every plausible mnemonic collides — o=queue, n=notes,
  // w=close-workspace, i=Electron's toggleDevTools role accelerator (menu.ts), c=terminal-copy.
  { id: 'capture-orky-work',    label: 'Capture Orky work item',      category: 'General',    defaultChord: c(true, true, 'u'), tip: 'capture an Orky work item' },
  // QoL batch 2026-07-17. Chord choices: q (close) because w=close-workspace; j (restore) pairs
  // with h (minimize); mod+alt+arrows for directional focus because mod+shift+arrows are
  // PSReadLine's word-selection defaults; mod+alt+=/-/0 for font zoom because the View menu's
  // Electron roles own mod+-/mod+0 for whole-UI zoom; g ("grep") for in-pane find because
  // mod+shift+f is the history search and bare mod+f must keep reaching the shell (readline ^F).
  { id: 'close-pane',           label: 'Close pane',              category: 'Panes', defaultChord: c(true, true, 'q'), tip: 'close the focused pane' },
  { id: 'focus-pane-left',      label: 'Focus pane left',         category: 'Panes', defaultChord: ca('arrowleft') },
  { id: 'focus-pane-right',     label: 'Focus pane right',        category: 'Panes', defaultChord: ca('arrowright') },
  { id: 'focus-pane-up',        label: 'Focus pane above',        category: 'Panes', defaultChord: ca('arrowup') },
  { id: 'focus-pane-down',      label: 'Focus pane below',        category: 'Panes', defaultChord: ca('arrowdown') },
  { id: 'restore-last-minimized', label: 'Restore last minimized pane', category: 'Panes', defaultChord: c(true, true, 'j'), tip: 'restore the last minimized pane' },
  { id: 'font-zoom-in',         label: 'Terminal font larger',    category: 'Panes', defaultChord: ca('=') },
  { id: 'font-zoom-out',        label: 'Terminal font smaller',   category: 'Panes', defaultChord: ca('-') },
  { id: 'font-zoom-reset',      label: 'Terminal font reset',     category: 'Panes', defaultChord: ca('0') },
  { id: 'clear-terminal',       label: 'Clear terminal scrollback', category: 'Panes', defaultChord: c(true, true, 'k'), tip: 'clear the terminal and its scrollback' },
  { id: 'find-in-terminal',     label: 'Find in terminal',        category: 'Panes', defaultChord: c(true, true, 'g'), tip: 'search within this terminal' },
]

/** Canonical, JSON-storable, comparable key for a chord, e.g. "mod+shift+t" / "mod+alt+arrowleft". */
export function chordKey(ch: Chord): string {
  return [ch.mod ? 'mod' : '', ch.alt ? 'alt' : '', ch.shift ? 'shift' : '', ch.key].filter(Boolean).join('+')
}

/** Parse a chordKey back to a Chord; null if it has no key segment. Pre-alt stored keys parse
 *  unchanged (alt simply stays unset). */
export function parseChordKey(s: string): Chord | null {
  const parts = s.split('+')
  const key = parts.pop()
  if (!key) return null
  const set = new Set(parts)
  return { mod: set.has('mod'), shift: set.has('shift'), key, alt: set.has('alt') ? true : undefined }
}

interface KeyEvent { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey?: boolean }

/** Normalize a keyboard event to a Chord (mod = Ctrl OR ⌘). `alt` is set only when held, so a
 *  chordKey comparison distinguishes AltGr (ctrl+alt) events from plain mod chords. */
export function eventToChord(e: KeyEvent): Chord {
  return { mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, key: e.key.toLowerCase(), alt: e.altKey ? true : undefined }
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
  return [ch.mod ? 'Ctrl' : '', ch.alt ? 'Alt' : '', ch.shift ? 'Shift' : '', key].filter(Boolean).join('+')
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
  // Reserved numeric jump — checked first so a rebind can never shadow it. Never with Alt held:
  // AltGr layouts report ctrl+alt while typing, and ctrl+alt+digit types characters there.
  if (!e.shiftKey && !e.altKey && k.length === 1 && k >= '1' && k <= '9') return { type: 'jump-workspace', index: Number(k) - 1 }
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
  if (!ch.alt && /^[1-9]$/.test(ch.key)) return false  // reserved jump digits — free with Alt held
  if (ch.key === '+') return false
  return true
}

/** Commands surfaced as rotating status-bar tips, in rotation order. */
export const TIP_COMMANDS: CommandId[] = ['new-terminal', 'toggle-palette', 'open-settings', 'toggle-maximize-pane', 'toggle-minimize-pane', 'toggle-broadcast']

/** Next rotation index (wraps; 0 for an empty list). */
export const nextTipIndex = (i: number, len: number): number => len === 0 ? 0 : (i + 1) % len
