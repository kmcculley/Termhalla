import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_QUICK, type QuickStore as QuickData, type Theme } from '@shared/types'
import { atomicWrite } from './atomic-write'

/** A theme override is kept only if it is a plain object; anything else (absent, primitive, array)
 *  normalizes to undefined (= no override). */
export function normalizeTheme(theme: unknown): Partial<Theme> | undefined {
  return theme && typeof theme === 'object' && !Array.isArray(theme) ? theme as Partial<Theme> : undefined
}

/** Coerce an untrusted/partial value into a well-formed QuickStore (each field a valid array).
 *  Used on both read (corrupt/partial file) and write (untrusted renderer payload). */
function normalizeQuick(value: unknown): QuickData {
  const v = (value ?? {}) as Partial<QuickData>
  return {
    connections: Array.isArray(v.connections) ? v.connections : [],
    recentConnections: Array.isArray(v.recentConnections) ? v.recentConnections : [],
    favoriteDirs: Array.isArray(v.favoriteDirs) ? v.favoriteDirs : [],
    recentDirs: Array.isArray(v.recentDirs) ? v.recentDirs : [],
    templates: Array.isArray(v.templates) ? v.templates : [],
    theme: normalizeTheme(v.theme),
    themePresets: Array.isArray(v.themePresets) ? v.themePresets : [],
    recordByDefault: typeof v.recordByDefault === 'boolean' ? v.recordByDefault : false,
    autoResumeClaude: typeof v.autoResumeClaude === 'boolean' ? v.autoResumeClaude : true,
    copyOnSelect: typeof v.copyOnSelect === 'boolean' ? v.copyOnSelect : true,
    keybindings: v.keybindings && typeof v.keybindings === 'object' && !Array.isArray(v.keybindings)
      ? Object.fromEntries(Object.entries(v.keybindings).filter(([, val]) => typeof val === 'string')) as Record<string, string>
      : undefined,
  }
}

export class QuickStore {
  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'quick.json') }

  async load(): Promise<QuickData> {
    try {
      return normalizeQuick(JSON.parse(await readFile(this.file(), 'utf8')))
    } catch {
      return { ...EMPTY_QUICK }
    }
  }

  async save(data: QuickData): Promise<void> {
    // Atomic: a killed write must not truncate quick.json into one that loads as EMPTY_QUICK,
    // wiping the user's saved SSH connections.
    await atomicWrite(this.file(), JSON.stringify(normalizeQuick(data), null, 2))
  }
}
