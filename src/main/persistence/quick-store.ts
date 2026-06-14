import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EMPTY_QUICK, type QuickStore as QuickData } from '@shared/types'

export class QuickStore {
  constructor(private readonly baseDir: string) {}

  private file() { return join(this.baseDir, 'quick.json') }

  async load(): Promise<QuickData> {
    try {
      const parsed = JSON.parse(await readFile(this.file(), 'utf8')) as Partial<QuickData>
      return {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        recentConnections: Array.isArray(parsed.recentConnections) ? parsed.recentConnections : [],
        favoriteDirs: Array.isArray(parsed.favoriteDirs) ? parsed.favoriteDirs : [],
        recentDirs: Array.isArray(parsed.recentDirs) ? parsed.recentDirs : []
      }
    } catch {
      return { ...EMPTY_QUICK }
    }
  }

  async save(data: QuickData): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(this.file(), JSON.stringify(data, null, 2), 'utf8')
  }
}
