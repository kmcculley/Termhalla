import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_QUICK, type QuickStore as QuickData } from '@shared/types'

/** Coerce an untrusted/partial value into a well-formed QuickStore (each field a valid array).
 *  Used on both read (corrupt/partial file) and write (untrusted renderer payload). */
function normalizeQuick(value: unknown): QuickData {
  const v = (value ?? {}) as Partial<QuickData>
  return {
    connections: Array.isArray(v.connections) ? v.connections : [],
    recentConnections: Array.isArray(v.recentConnections) ? v.recentConnections : [],
    favoriteDirs: Array.isArray(v.favoriteDirs) ? v.favoriteDirs : [],
    recentDirs: Array.isArray(v.recentDirs) ? v.recentDirs : [],
    templates: Array.isArray(v.templates) ? v.templates : []
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
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.file(), JSON.stringify(normalizeQuick(data), null, 2), 'utf8')
  }
}
