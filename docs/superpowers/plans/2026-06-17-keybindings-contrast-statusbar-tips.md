# Keybindings, Adaptive Contrast & Status-Bar Tips — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two theme-contrast bugs (light-on-light menus, dark-on-dark Settings nav) and add two features — fully rebindable keyboard shortcuts in a new Settings section, and rotating shortcut tips in the status bar.

**Architecture:** A new pure `src/shared/keybindings.ts` holds a command registry, chord helpers, and a table-driven `matchShortcut` (the old `keymap.ts` becomes a re-export shim). User overrides persist on the per-machine `quick` store (like theme) and feed both the keydown dispatcher and a new `KeybindingsSettings` panel. A new luminance-adaptive `--fg-on-elevated` theme token (mirroring the existing `--on-busy`/`--on-needs` pattern) fixes all elevated-surface text contrast. The status bar gains a right-aligned hint that reads chords live from the same binding table.

**Tech Stack:** TypeScript, React, zustand, Electron; vitest (pure unit) + Playwright-for-Electron (e2e). Path alias `@shared/...`.

**Spec:** `docs/superpowers/specs/2026-06-17-keybindings-contrast-statusbar-tips-design.md`

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `src/shared/keybindings.ts` | Command registry, `Chord`/`Shortcut` types, chord helpers, `matchShortcut`, `resolveBindings`, conflict/validate, tip rotation | **Create** |
| `src/shared/keymap.ts` | Back-compat re-export shim | Modify |
| `src/shared/types.ts` | `QuickStore.keybindings?` field | Modify |
| `src/main/persistence/quick-store.ts` | Normalize the new `keybindings` field | Modify |
| `src/renderer/store/keybindings-slice.ts` | `setBinding`/`unbindCommand`/`resetBinding`/`resetAllBindings` on `quick` | **Create** |
| `src/renderer/store/types.ts` | `State` actions + `SettingsSection` adds `'keybindings'` | Modify |
| `src/renderer/store.ts` | Register the new slice | Modify |
| `src/renderer/App.tsx` | Pass resolved overrides to `matchShortcut` | Modify |
| `src/shared/theme.ts` | Add derived `--fg-on-elevated` token | Modify |
| `src/renderer/components/Modal.tsx` | `SURFACE.color` → adaptive token | Modify |
| `src/renderer/index.css` | Adaptive menu text + add `settings-panel` to themed chrome | Modify |
| `src/renderer/components/SettingsPanel.tsx` | New "Keybindings" section | Modify |
| `src/renderer/components/KeybindingsSettings.tsx` | The rebinding table + capture UI | **Create** |
| `src/renderer/components/StatusBar.tsx` | Right-aligned rotating tip | Modify |

---

## Task 1: Pure keybindings core

**Files:**
- Create: `src/shared/keybindings.ts`
- Modify: `src/shared/keymap.ts`
- Test: `tests/keybindings.test.ts` (new); `tests/keymap.test.ts` (must stay green, unchanged)

- [ ] **Step 1: Write the failing test**

Create `tests/keybindings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  chordKey, parseChordKey, formatChord, eventToChord, resolveBindings, matchShortcut,
  findConflict, isValidRebind, nextTipIndex, DEFAULT_BINDINGS, COMMANDS, TIP_COMMANDS, type Chord
} from '../src/shared/keybindings'

const ev = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) =>
  ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...over })
const ch = (mod: boolean, shift: boolean, key: string): Chord => ({ mod, shift, key })

describe('chordKey / parseChordKey', () => {
  it('round-trips', () => {
    expect(chordKey(ch(true, true, 't'))).toBe('mod+shift+t')
    expect(chordKey(ch(true, false, ','))).toBe('mod+,')
    expect(parseChordKey('mod+shift+t')).toEqual(ch(true, true, 't'))
    expect(parseChordKey('mod+,')).toEqual(ch(true, false, ','))
  })
  it('returns null for empty', () => { expect(parseChordKey('')).toBeNull() })
})

describe('formatChord', () => {
  it('renders human labels', () => {
    expect(formatChord(ch(true, true, 't'))).toBe('Ctrl+Shift+T')
    expect(formatChord(ch(true, false, 'enter'))).toBe('Ctrl+Enter')
    expect(formatChord(ch(true, false, ','))).toBe('Ctrl+,')
  })
})

describe('eventToChord', () => {
  it('treats Meta as mod and lowercases the key', () => {
    expect(eventToChord(ev({ key: 'K', metaKey: true, shiftKey: true }))).toEqual(ch(true, true, 'k'))
  })
})

describe('resolveBindings', () => {
  it('returns defaults when no overrides', () => {
    expect(resolveBindings(undefined)).toEqual(DEFAULT_BINDINGS)
  })
  it('applies a valid override and ignores unknown ids', () => {
    const r = resolveBindings({ 'new-terminal': 'mod+shift+n', 'bogus-id': 'mod+x' })
    expect(r['new-terminal']).toEqual(ch(true, true, 'n'))
  })
  it("'none' unbinds a command", () => {
    const r = resolveBindings({ 'new-terminal': 'none' })
    expect(r['new-terminal']).toBeUndefined()
  })
})

describe('matchShortcut with overrides', () => {
  it('matches a rebound chord and not the old default', () => {
    const bindings = resolveBindings({ 'new-terminal': 'mod+shift+n' })
    expect(matchShortcut(ev({ key: 'n', ctrlKey: true, shiftKey: true }), bindings)).toEqual({ type: 'new-terminal' })
    expect(matchShortcut(ev({ key: 't', ctrlKey: true, shiftKey: true }), bindings)).toBeNull()
  })
  it('Ctrl+1-9 jump is reserved regardless of bindings', () => {
    expect(matchShortcut(ev({ key: '3', ctrlKey: true }), DEFAULT_BINDINGS)).toEqual({ type: 'jump-workspace', index: 2 })
  })
})

describe('findConflict', () => {
  it('finds another command on the same chord, honoring exceptId', () => {
    expect(findConflict(DEFAULT_BINDINGS, ch(true, false, 'k'), 'new-terminal')).toBe('toggle-palette')
    expect(findConflict(DEFAULT_BINDINGS, ch(true, false, 'k'), 'toggle-palette')).toBeNull()
  })
})

describe('isValidRebind', () => {
  it('requires Ctrl/Meta, a real key, and not a reserved digit', () => {
    expect(isValidRebind(ch(true, true, 'n'))).toBe(true)
    expect(isValidRebind(ch(false, true, 'n'))).toBe(false)   // no mod
    expect(isValidRebind(ch(true, false, '3'))).toBe(false)   // reserved jump digit
    expect(isValidRebind(ch(true, false, 'control'))).toBe(false) // lone modifier
  })
})

describe('nextTipIndex', () => {
  it('wraps', () => {
    expect(nextTipIndex(0, 3)).toBe(1)
    expect(nextTipIndex(2, 3)).toBe(0)
    expect(nextTipIndex(0, 0)).toBe(0)
  })
})

describe('registry invariants', () => {
  it('every TIP command exists and has a tip phrase', () => {
    for (const id of TIP_COMMANDS) {
      const cmd = COMMANDS.find(c => c.id === id)
      expect(cmd, id).toBeTruthy()
      expect(cmd!.tip, id).toBeTruthy()
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- keybindings`
Expected: FAIL — `Cannot find module '../src/shared/keybindings'`.

- [ ] **Step 3: Create `src/shared/keybindings.ts`**

```ts
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

export type CommandId =
  | 'toggle-palette' | 'toggle-broadcast' | 'new-terminal' | 'close-workspace'
  | 'next-workspace' | 'prev-workspace' | 'open-settings' | 'toggle-maximize-pane'

export interface Command { id: CommandId; label: string; category: string; defaultChord: Chord; tip?: string }

const c = (mod: boolean, shift: boolean, key: string): Chord => ({ mod, shift, key })

/** The rebindable commands. `tip` (when present) is the phrase used in status-bar tips. */
export const COMMANDS: Command[] = [
  { id: 'toggle-palette',       label: 'Command palette',    category: 'General',    defaultChord: c(true, false, 'k'),    tip: 'open the command palette' },
  { id: 'new-terminal',         label: 'New terminal pane',  category: 'Panes',      defaultChord: c(true, true, 't'),     tip: 'open a new pane' },
  { id: 'toggle-maximize-pane', label: 'Maximize pane',      category: 'Panes',      defaultChord: c(true, true, 'm'),     tip: 'maximize the focused pane' },
  { id: 'toggle-broadcast',     label: 'Broadcast to all',   category: 'Panes',      defaultChord: c(true, true, 'enter'), tip: 'broadcast to every terminal' },
  { id: 'open-settings',        label: 'Settings',           category: 'General',    defaultChord: c(true, false, ','),    tip: 'open settings' },
  { id: 'next-workspace',       label: 'Next workspace',     category: 'Workspaces', defaultChord: c(true, false, 'tab') },
  { id: 'prev-workspace',       label: 'Previous workspace', category: 'Workspaces', defaultChord: c(true, true, 'tab') },
  { id: 'close-workspace',      label: 'Close workspace',    category: 'Workspaces', defaultChord: c(true, true, 'w') },
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

/** Human display, e.g. "Ctrl+Shift+T". `mod` shows as Ctrl (Windows/Linux primary target). */
export function formatChord(ch: Chord): string {
  const key = KEY_LABEL[ch.key] ?? (ch.key.length === 1 ? ch.key.toUpperCase() : ch.key)
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

/** A chord is a legal rebind iff it includes Ctrl/⌘, has a real (non-modifier) key, and is not a
 *  reserved Ctrl+1..9 digit. */
export function isValidRebind(ch: Chord): boolean {
  if (!ch.mod) return false
  if (!ch.key || ['control', 'meta', 'shift', 'alt'].includes(ch.key)) return false
  if (/^[1-9]$/.test(ch.key)) return false
  return true
}

/** Commands surfaced as rotating status-bar tips, in rotation order. */
export const TIP_COMMANDS: CommandId[] = ['new-terminal', 'toggle-palette', 'open-settings', 'toggle-maximize-pane', 'toggle-broadcast']

/** Next rotation index (wraps; 0 for an empty list). */
export const nextTipIndex = (i: number, len: number): number => len === 0 ? 0 : (i + 1) % len
```

- [ ] **Step 4: Turn `keymap.ts` into a re-export shim**

Replace the entire contents of `src/shared/keymap.ts` with:

```ts
/** Back-compat shim. The implementation now lives in `keybindings.ts`; this keeps existing
 *  `@shared/keymap` import sites (and `tests/keymap.test.ts`) working. */
export * from './keybindings'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- keybindings keymap`
Expected: PASS — both the new `keybindings.test.ts` and the unchanged `keymap.test.ts` are green.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/keybindings.ts src/shared/keymap.ts tests/keybindings.test.ts
git commit -m "feat(keybindings): data-driven command registry + table-driven matcher"
```

---

## Task 2: Persist keybinding overrides on the quick store

**Files:**
- Modify: `src/shared/types.ts:67-76` (`QuickStore`)
- Modify: `src/main/persistence/quick-store.ts:13-25` (`normalizeQuick`)
- Test: `tests/main/quick-store.test.ts`

No `SCHEMA_VERSION` bump: `quick.json` is forward-compatible via optional-field normalization (same as `theme?`/`recordByDefault?`).

- [ ] **Step 1: Write the failing test**

Add this case inside the `describe('QuickStore', …)` block in `tests/main/quick-store.test.ts` (after the "round-trips a saved store" test):

```ts
  it('round-trips and normalizes the keybindings map', async () => {
    const store = new QuickStore(dir)
    const data = {
      connections: [], recentConnections: [], favoriteDirs: [], recentDirs: [],
      templates: [], themePresets: [], recordByDefault: false,
      keybindings: { 'new-terminal': 'mod+shift+n', 'close-workspace': 'none', 'bad': 42 as unknown as string }
    }
    await store.save(data)
    const loaded = await store.load()
    // Non-string values are dropped; string values survive.
    expect(loaded.keybindings).toEqual({ 'new-terminal': 'mod+shift+n', 'close-workspace': 'none' })
    rmSync(dir, { recursive: true, force: true })
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- quick-store`
Expected: FAIL — `loaded.keybindings` is `undefined` (field not yet persisted).

- [ ] **Step 3: Add the field to `QuickStore`**

In `src/shared/types.ts`, add a line inside the `QuickStore` interface (after `recordByDefault?: boolean`):

```ts
  recordByDefault?: boolean
  keybindings?: Record<string, string>   // CommandId -> chordKey ("mod+shift+t") | 'none' (unbound)
```

`EMPTY_QUICK` needs no change (the field is optional).

- [ ] **Step 4: Normalize the field in `normalizeQuick`**

In `src/main/persistence/quick-store.ts`, add this line to the object returned by `normalizeQuick` (after the `recordByDefault` line, before the closing `}`):

```ts
    recordByDefault: typeof v.recordByDefault === 'boolean' ? v.recordByDefault : false,
    keybindings: v.keybindings && typeof v.keybindings === 'object' && !Array.isArray(v.keybindings)
      ? Object.fromEntries(Object.entries(v.keybindings).filter(([, val]) => typeof val === 'string')) as Record<string, string>
      : undefined,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- quick-store`
Expected: PASS — including the existing missing-file and round-trip tests (vitest `toEqual` ignores `undefined` properties, so the no-keybindings cases stay green).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/persistence/quick-store.ts tests/main/quick-store.test.ts
git commit -m "feat(keybindings): persist override map on the quick store"
```

---

## Task 3: Keybindings store slice + State wiring

**Files:**
- Create: `src/renderer/store/keybindings-slice.ts`
- Modify: `src/renderer/store/types.ts` (`State` actions + `SettingsSection`)
- Modify: `src/renderer/store.ts` (register slice)
- Test: `tests/keybindings-slice.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/keybindings-slice.test.ts` (mirrors the harness in `tests/settings-slice.test.ts` — no `api` import):

```ts
import { describe, it, expect, vi } from 'vitest'
import { createKeybindingsSlice } from '../src/renderer/store/keybindings-slice'

function harness() {
  let state: any = { quick: { keybindings: {} } }
  const set = (patch: any) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) } }
  const get = () => state
  const scheduleQuickSave = vi.fn()
  return { slice: createKeybindingsSlice({ set, get, scheduleQuickSave } as any), get, scheduleQuickSave }
}

describe('keybindings slice', () => {
  it('setBinding stores the chordKey and schedules a save', () => {
    const { slice, get, scheduleQuickSave } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    expect(get().quick.keybindings['new-terminal']).toBe('mod+shift+n')
    expect(scheduleQuickSave).toHaveBeenCalled()
  })
  it('unbindCommand writes the none sentinel', () => {
    const { slice, get } = harness()
    slice.unbindCommand('close-workspace')
    expect(get().quick.keybindings['close-workspace']).toBe('none')
  })
  it('resetBinding removes the override', () => {
    const { slice, get } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    slice.resetBinding('new-terminal')
    expect(get().quick.keybindings['new-terminal']).toBeUndefined()
  })
  it('resetAllBindings clears the map', () => {
    const { slice, get } = harness()
    slice.setBinding('new-terminal', { mod: true, shift: true, key: 'n' })
    slice.resetAllBindings()
    expect(get().quick.keybindings).toEqual({})
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- keybindings-slice`
Expected: FAIL — `Cannot find module '../src/renderer/store/keybindings-slice'`.

- [ ] **Step 3: Create the slice**

Create `src/renderer/store/keybindings-slice.ts`:

```ts
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
```

- [ ] **Step 4: Extend the `State` type and `SettingsSection`**

In `src/renderer/store/types.ts`:

Add the import (extend the existing `@shared/...` imports — add a new import line near the top):

```ts
import type { Chord, CommandId } from '@shared/keybindings'
```

Change the `SettingsSection` union (line 17) to include keybindings:

```ts
export type SettingsSection = 'general' | 'appearance' | 'environment' | 'terminal' | 'keybindings'
```

Add the four actions to the `State` interface (place them next to the other settings members, just before `settings: SettingsTarget | null`):

```ts
  setBinding: (id: CommandId, chord: Chord) => void
  unbindCommand: (id: CommandId) => void
  resetBinding: (id: CommandId) => void
  resetAllBindings: () => void
```

- [ ] **Step 5: Register the slice in the store**

In `src/renderer/store.ts`:

Add the import after the other slice imports (after line 22):

```ts
import { createKeybindingsSlice } from './store/keybindings-slice'
```

Add the spread in the `// ---- domain slices ----` block (after `...createSettingsSlice(deps),`):

```ts
    ...createSettingsSlice(deps),
    ...createKeybindingsSlice(deps),
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm test -- keybindings-slice && npm run typecheck`
Expected: PASS for both.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/store/keybindings-slice.ts src/renderer/store/types.ts src/renderer/store.ts tests/keybindings-slice.test.ts
git commit -m "feat(keybindings): store slice for shortcut overrides"
```

---

## Task 4: Dispatch keydowns through the resolved bindings

**Files:**
- Modify: `src/renderer/App.tsx:17` (import) and `:58-94` (keydown handler)

This is wired by Task 7's e2e test (rebinding then pressing the new chord). No new unit test here — the change is a two-line rewiring of an existing handler.

- [ ] **Step 1: Update the import**

In `src/renderer/App.tsx`, change line 17:

```ts
import { matchShortcut, resolveBindings } from '@shared/keymap'
```

- [ ] **Step 2: Read state before matching, and pass the resolved bindings**

In the `onKey` handler, replace the opening lines:

```ts
    const onKey = (e: KeyboardEvent) => {
      const sc = matchShortcut(e)
      if (!sc) return
      e.preventDefault()
      const s = useStore.getState()
```

with:

```ts
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const sc = matchShortcut(e, resolveBindings(s.quick.keybindings))
      if (!sc) return
      e.preventDefault()
```

(The rest of the handler — `const activeId = s.activeId` onward — is unchanged.)

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS (build needed for the Task 7/8 e2e runs).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(keybindings): dispatch keydowns through user overrides"
```

---

## Task 5: Adaptive `--fg-on-elevated` theme token

**Files:**
- Modify: `src/shared/theme.ts:28-49` (`themeCssVars`) and `:65-77` (`themeCssVarsPartial`)
- Test: `tests/shared/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/shared/theme.test.ts`. Extend the existing imports on line 2 to include `readableOn`'s source values by importing it:

```ts
import { readableOn } from '../../src/shared/contrast'
```

Add a test inside `describe('themeCssVars', …)`:

```ts
  it('derives --fg-on-elevated from the elevated background luminance', () => {
    const v = themeCssVars(DEFAULT_THEME)
    expect(v['--fg-on-elevated']).toBe(readableOn(DEFAULT_THEME.elevatedBg))
  })
```

Add a test inside `describe('themeCssVarsPartial', …)`:

```ts
  it('recomputes --fg-on-elevated only when elevatedBg is overridden', () => {
    expect(themeCssVarsPartial({ panelBg: '#abcdef' })['--fg-on-elevated']).toBeUndefined()
    const light = themeCssVarsPartial({ elevatedBg: '#f5f5f5' })
    expect(light['--elevated']).toBe('#f5f5f5')
    expect(light['--fg-on-elevated']).toBe(readableOn('#f5f5f5'))
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- shared/theme`
Expected: FAIL — `v['--fg-on-elevated']` is `undefined`.

- [ ] **Step 3: Add the token to `themeCssVars`**

In `src/shared/theme.ts`, in the object returned by `themeCssVars`, add a line right after the `--on-needs` line:

```ts
    '--on-busy': readableOn(t.statusBusy),
    '--on-needs': readableOn(t.statusNeedsInput),
    // Readable text for elevated surfaces (menus, modals, Settings) — luminance-adaptive so a
    // light theme's light elevated bg gets dark text instead of staying light-on-light.
    '--fg-on-elevated': readableOn(t.elevatedBg),
```

- [ ] **Step 4: Add the recompute to `themeCssVarsPartial`**

In `themeCssVarsPartial`, after the existing `statusNeedsInput` recompute lines (before `return out`), add:

```ts
  if (partial.statusNeedsInput !== undefined) out['--on-needs'] = readableOn(partial.statusNeedsInput)
  if (partial.elevatedBg !== undefined) out['--fg-on-elevated'] = readableOn(partial.elevatedBg)
  return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- shared/theme`
Expected: PASS. (The existing `themeCssVarsPartial` exact-`toEqual` test passes `{ panelBg, fontSize }`, which has no `elevatedBg`, so no extra key appears.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/theme.ts tests/shared/theme.test.ts
git commit -m "feat(theme): adaptive --fg-on-elevated contrast token"
```

---

## Task 6: Apply the adaptive token to menus, modals & Settings

**Files:**
- Modify: `src/renderer/components/Modal.tsx:20-24` (`SURFACE`)
- Modify: `src/renderer/index.css:92-148` (themed chrome list + button text color)

No new unit test — this is paint-only CSS, covered by the contrast e2e in Task 7.

- [ ] **Step 1: Adapt `SURFACE` text color**

In `src/renderer/components/Modal.tsx`, change the `SURFACE` `color`:

```ts
export const SURFACE: CSSProperties = {
  background: 'var(--elevated, #252526)', color: 'var(--fg-on-elevated, var(--fg, #eee))',
  border: '1px solid var(--border, #444)', borderRadius: 4,
  boxShadow: 'var(--shadow-pop)'
}
```

- [ ] **Step 2: Use the adaptive token for themed chrome button text**

In `src/renderer/index.css`, in the base chrome-button rule (the `:is(...) :is(button, select) {` block at ~line 110), change the `color` line:

```css
  font: inherit;
  color: var(--fg-on-elevated, var(--fg, #eee));
  background: rgba(255, 255, 255, 0.06);
```

- [ ] **Step 3: Add `settings-panel` to the four themed-chrome selector lists**

In `src/renderer/index.css`, add `[data-testid="settings-panel"],` to each of the four `:is( … )` selector lists that theme chrome controls — the base rule (~line 93-110), the `:hover` rule (~line 120-126), the `:active` rule (~line 130-136), and the `:disabled` rule (~line 139-145). For example, in the base list add it after `[data-testid="theme-editor"],`:

```css
  [data-testid="theme-editor"],
  [data-testid="settings-panel"],
  [data-testid="broadcast-dialog"],
```

Add the same `[data-testid="settings-panel"],` entry to the other three lists (hover/active/disabled). This themes the Settings nav buttons + Close button with the consistent chrome look (readable `--fg-on-elevated` text) instead of OS defaults. (The nested `theme-editor`/`env-manager`/`terminal-settings` panels already have their own themed testids, so their inputs/selects remain covered.)

- [ ] **Step 4: Build + typecheck**

Run: `npm run typecheck && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Modal.tsx src/renderer/index.css
git commit -m "fix(theme): readable text on elevated surfaces + themed Settings nav"
```

---

## Task 7: Keybindings Settings section + capture UI

**Files:**
- Create: `src/renderer/components/KeybindingsSettings.tsx`
- Modify: `src/renderer/components/SettingsPanel.tsx:5-15` (import + SECTIONS) and `:46-51` (body switch)
- Test: `tests/e2e/keybindings.spec.ts` (new)

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/keybindings.spec.ts`:

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

async function openKeybindings(win: import('@playwright/test').Page) {
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  await win.getByTestId('settings-nav-keybindings').click()
  await expect(win.getByTestId('settings-keybindings')).toBeVisible()
}

test('rebinds a command, fires the new chord, and rejects a no-Ctrl chord', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kb-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  await openKeybindings(win)
  // Default chord shown.
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+T')

  // Invalid: a chord without Ctrl is rejected with an error and no change.
  await win.getByTestId('kb-change-new-terminal').click()
  await win.keyboard.press('Shift+N')
  await expect(win.getByTestId('kb-error')).toBeVisible()
  // Cancel the still-open capture.
  await win.getByTestId('kb-change-new-terminal').click()

  // Valid rebind to Ctrl+Shift+N.
  await win.getByTestId('kb-change-new-terminal').click()
  await win.keyboard.press('Control+Shift+N')
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+N')

  // Close Settings and confirm the new chord opens a pane (pane count grows).
  await win.getByTestId('settings-close').click()
  const before = await win.locator('[data-testid^="tile-"]').count()
  await win.keyboard.press('Control+Shift+N')
  await expect(win.locator('[data-testid^="tile-"]')).toHaveCount(before + 1, { timeout: 10_000 })

  // Reset restores the default.
  await openKeybindings(win)
  await win.getByTestId('kb-reset-new-terminal').click()
  await expect(win.getByTestId('kb-chord-new-terminal')).toHaveText('Ctrl+Shift+T')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})

test('Settings nav and dropdown menus are readable on a light theme', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-kb-contrast-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // Force a light elevated surface via the app theme CSS vars and assert the nav button resolves
  // to dark text (the adaptive token), not light-on-light.
  await win.evaluate(() => {
    document.documentElement.style.setProperty('--elevated', '#f5f5f5')
    document.documentElement.style.setProperty('--fg-on-elevated', '#182026')
  })
  await win.getByTestId('settings-button').click()
  await expect(win.getByTestId('settings-panel')).toBeVisible()
  const color = await win.getByTestId('settings-nav-general').evaluate(el => getComputedStyle(el).color)
  // Dark text → low RGB sum; assert it is not the light default (#eee ≈ rgb(238,238,238)).
  expect(color).not.toBe('rgb(238, 238, 238)')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build, then run to verify it fails**

Run: `npm run build && npm run e2e -- keybindings`
Expected: FAIL — no `settings-nav-keybindings` / `settings-keybindings` yet.

- [ ] **Step 3: Create `KeybindingsSettings.tsx`**

Create `src/renderer/components/KeybindingsSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import {
  COMMANDS, resolveBindings, eventToChord, formatChord, isValidRebind, findConflict, type CommandId
} from '@shared/keybindings'

/** View + rebind keyboard shortcuts. Overrides live on `quick` (per-machine). Capture mode reads
 *  the next keydown (capture-phase, so it pre-empts the app's global handler), validates it must
 *  include Ctrl/⌘, warns on conflict, then saves. Ctrl+1–9 (jump) is reserved/read-only. */
export function KeybindingsSettings() {
  const overrides = useStore(s => s.quick.keybindings)
  const setBinding = useStore(s => s.setBinding)
  const unbindCommand = useStore(s => s.unbindCommand)
  const resetBinding = useStore(s => s.resetBinding)
  const resetAllBindings = useStore(s => s.resetAllBindings)
  const [capturing, setCapturing] = useState<CommandId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolved = resolveBindings(overrides)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setCapturing(null); setError(null); return }
      if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return // wait for the non-modifier key
      const chord = eventToChord(e)
      if (!isValidRebind(chord)) { setError('Shortcut must include Ctrl and cannot be Ctrl+1–9.'); return }
      const conflict = findConflict(resolved, chord, capturing)
      if (conflict) {
        const other = COMMANDS.find(c => c.id === conflict)!
        if (!window.confirm(`${formatChord(chord)} is already bound to "${other.label}". Reassign it? "${other.label}" will be unbound.`)) return
        unbindCommand(conflict)
      }
      setBinding(capturing, chord)
      setCapturing(null); setError(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing, resolved, setBinding, unbindCommand])

  return (
    <div data-testid="settings-keybindings" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--fg-dim)' }}>Click Change, then press the new shortcut (must include Ctrl). Esc cancels.</span>
        <button data-testid="kb-reset-all" onClick={() => resetAllBindings()}>Reset all</button>
      </div>
      {error && <div data-testid="kb-error" style={{ color: 'var(--status-needs, #ff8f00)' }}>{error}</div>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <tbody>
          {COMMANDS.map(cmd => {
            const ch = resolved[cmd.id]
            return (
              <tr key={cmd.id} data-testid={`kb-row-${cmd.id}`}>
                <td style={{ padding: '3px 8px 3px 0' }}>{cmd.label}</td>
                <td data-testid={`kb-chord-${cmd.id}`} style={{ padding: '3px 8px', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
                  {capturing === cmd.id ? 'Press shortcut…' : ch ? formatChord(ch) : 'Unbound'}
                </td>
                <td style={{ padding: '3px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button data-testid={`kb-change-${cmd.id}`}
                    onClick={() => { setError(null); setCapturing(capturing === cmd.id ? null : cmd.id) }}>
                    {capturing === cmd.id ? 'Cancel' : 'Change'}
                  </button>{' '}
                  <button data-testid={`kb-reset-${cmd.id}`} onClick={() => resetBinding(cmd.id)}>Reset</button>
                </td>
              </tr>
            )
          })}
          <tr data-testid="kb-row-jump">
            <td style={{ padding: '3px 8px 3px 0', color: 'var(--fg-dim)' }}>Jump to workspace 1–9</td>
            <td style={{ padding: '3px 8px', fontFamily: 'var(--mono)', color: 'var(--fg-dim)' }}>Ctrl+1…9</td>
            <td style={{ padding: '3px 0', textAlign: 'right', color: 'var(--fg-dim)' }}>reserved</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Wire it into `SettingsPanel.tsx`**

Add the import (after the other settings imports, ~line 8):

```ts
import { KeybindingsSettings } from './KeybindingsSettings'
```

Add to the `SECTIONS` array (after the `terminal` entry):

```ts
  { id: 'terminal', label: 'Terminal' },
  { id: 'keybindings', label: 'Keybindings' }
```

Add to the body switch (after the `terminal` line):

```tsx
        {section === 'terminal' && <TerminalAlertsSettings wsId={settings.paneId ? activeId ?? undefined : undefined} paneId={settings.paneId} />}
        {section === 'keybindings' && <KeybindingsSettings />}
```

- [ ] **Step 5: Build + run the e2e**

Run: `npm run build && npm run e2e -- keybindings`
Expected: PASS — both the rebind/validation test and the contrast test.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/KeybindingsSettings.tsx src/renderer/components/SettingsPanel.tsx tests/e2e/keybindings.spec.ts
git commit -m "feat(keybindings): rebindable shortcuts in a Settings section"
```

---

## Task 8: Status-bar rotating shortcut tips

**Files:**
- Modify: `src/renderer/components/StatusBar.tsx`
- Test: `tests/e2e/statusbar-tips.spec.ts` (new)

(The `nextTipIndex` rotation helper is already unit-tested in Task 1.)

- [ ] **Step 1: Write the failing e2e test**

Create `tests/e2e/statusbar-tips.spec.ts`:

```ts
import { test, expect, _electron as electron, ElectronApplication } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function killTree(pid: number | undefined): void {
  if (pid && process.platform === 'win32') { try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' }) } catch {} }
}
function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: ['out/main/index.js', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userData}`] })
}

test('status bar shows a shortcut tip that reflects the current binding', async () => {
  test.setTimeout(45_000)
  const userData = mkdtempSync(join(tmpdir(), 'termh-tip-'))
  const app = await launch(userData)
  const win = await app.firstWindow()
  await win.getByTestId('add-first-terminal').click()
  await expect(win.locator('[data-testid^="terminal-"]')).toBeVisible({ timeout: 15_000 })

  // First tip in rotation is the new-pane tip at its default chord.
  const tip = win.getByTestId('statusbar-tip')
  await expect(tip).toContainText('Press')
  await expect(tip).toContainText('Ctrl+Shift+T')
  await expect(tip).toContainText('open a new pane')

  // Rebind new-terminal and confirm the tip text updates live (no rotation wait needed).
  await win.getByTestId('settings-button').click()
  await win.getByTestId('settings-nav-keybindings').click()
  await win.getByTestId('kb-change-new-terminal').click()
  await win.keyboard.press('Control+Shift+N')
  await win.getByTestId('settings-close').click()
  await expect(tip).toContainText('Ctrl+Shift+N')

  const pid = app.process().pid; await app.close().catch(() => {}); killTree(pid)
})
```

- [ ] **Step 2: Build, then run to verify it fails**

Run: `npm run build && npm run e2e -- statusbar-tips`
Expected: FAIL — no `statusbar-tip` element.

- [ ] **Step 3: Add the rotating tip to `StatusBar.tsx`**

Change the imports at the top of `src/renderer/components/StatusBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { CloudState, CloudStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'
import { resolveBindings, formatChord, COMMANDS, TIP_COMMANDS, nextTipIndex } from '@shared/keybindings'
```

Inside the `StatusBar` component, after the existing `const [openFor, …]` line, add the tip state + derivation:

```tsx
  const [openFor, setOpenFor] = useState<string | null>(null)
  const overrides = useStore(s => s.quick.keybindings)
  const [tipIdx, setTipIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTipIdx(i => nextTipIndex(i, TIP_COMMANDS.length)), 7000)
    return () => clearInterval(t)
  }, [])
  const resolved = resolveBindings(overrides)
  const tipId = TIP_COMMANDS[tipIdx % TIP_COMMANDS.length]
  const tipCmd = COMMANDS.find(c => c.id === tipId)
  const tipChord = resolved[tipId]
  const tipText = tipCmd && tipChord ? `Press ${formatChord(tipChord)} to ${tipCmd.tip ?? tipCmd.label.toLowerCase()}` : null
```

Add the spacer + tip span as the last children inside the `data-testid="status-bar"` div (after the closing `))}` of the `cloud.map`, before the div closes):

```tsx
      ))}
      <div style={{ flex: 1 }} />
      {tipText && <span data-testid="statusbar-tip" style={{ whiteSpace: 'nowrap', opacity: 0.85 }}>{tipText}</span>}
    </div>
```

- [ ] **Step 4: Build + run the e2e**

Run: `npm run build && npm run e2e -- statusbar-tips`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/StatusBar.tsx tests/e2e/statusbar-tips.spec.ts
git commit -m "feat(statusbar): rotating shortcut tips driven by live bindings"
```

---

## Task 9: Full-suite verification + living docs

**Files:**
- Modify: `CHANGELOG.md`
- Create: `docs/features/keybindings.md`
- Modify: `docs/architecture.md` (persistence/quick.json row), `CLAUDE.md` "Where things live" table

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`
Expected: PASS (all vitest, including `keybindings`, `keybindings-slice`, `quick-store`, `shared/theme`, and the unchanged `keymap`).

- [ ] **Step 2: Typecheck + build + targeted e2e**

Run: `npm run typecheck && npm run build && npm run e2e -- keybindings statusbar-tips editor`
Expected: PASS. (Include `editor` — it guards the editor-tabs/Monaco layout that the chrome CSS change in Task 6 could perturb.)

- [ ] **Step 3: Update the changelog**

Add an entry to `CHANGELOG.md` (match the existing format) covering: adaptive `--fg-on-elevated` contrast fix for menus/modals/Settings; rebindable keyboard shortcuts in a new Settings → Keybindings section; rotating shortcut tips in the status bar.

- [ ] **Step 4: Write the feature doc**

Create `docs/features/keybindings.md` describing: the command registry + chord model (`src/shared/keybindings.ts`), the override persistence on `quick.json` (`keybindings` map, `'none'` sentinel, Ctrl-required + reserved Ctrl+1–9), the Settings UI, and the status-bar tips. Cross-reference `src/renderer/App.tsx` dispatch and `tests/keybindings*.spec.ts`/`*.test.ts`.

- [ ] **Step 5: Update architecture + CLAUDE.md pointers**

- In `docs/architecture.md`, note the new `keybindings` field on `quick.json` in the persistence table.
- In `CLAUDE.md` "Where things live" table, add a Keybindings row (`src/shared/keybindings.ts`, `src/renderer/components/KeybindingsSettings.tsx` → `docs/features/keybindings.md`).

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md docs/features/keybindings.md docs/architecture.md CLAUDE.md
git commit -m "docs: keybindings, adaptive contrast, status-bar tips"
```

---

## Self-Review

**Spec coverage:**
- Item 2 (light-on-light menus) → Task 5 (`--fg-on-elevated`) + Task 6 (SURFACE/menu CSS). ✓
- Item 3 (dark-on-dark Settings nav) → Task 6 (add `settings-panel` to themed chrome + adaptive text). ✓
- Item 4 (rebindable keybindings under a menu; resolved to Settings section) → Tasks 1–4 (core/persistence/slice/dispatch) + Task 7 (UI). Scope cuts (Ctrl+1–9 reserved; Ctrl-required) enforced in `matchShortcut`/`isValidRebind` and shown reserved in the UI. ✓
- Item 1 (status-bar rotating tips) → Task 8, chords resolved live from bindings. ✓
- Persistence on `quick` (revised from app-state during planning; no `SCHEMA_VERSION` bump — optional-field normalization) → Task 2. ✓
- Conflict UX = warn-and-confirm with unbound sentinel → Task 7 capture handler. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step has concrete assertions. ✓

**Type consistency:** `CommandId`, `Chord`, `Shortcut`, `chordKey`, `resolveBindings`, `findConflict`, `isValidRebind`, `eventToChord`, `formatChord`, `nextTipIndex`, `TIP_COMMANDS`, `COMMANDS`, `DEFAULT_BINDINGS` are defined once in Task 1 and used with the same signatures in Tasks 3, 4, 7, 8. Store actions `setBinding`/`unbindCommand`/`resetBinding`/`resetAllBindings` match between the slice (Task 3), `State` type (Task 3), and the UI (Task 7). The `quick.keybindings` shape (`Record<string,string>`, `'none'` sentinel) is consistent across persistence (Task 2), slice (Task 3), and `resolveBindings` (Task 1). ✓
