import type { DirEntry, FsChange } from '@shared/types'
import { basename as baseName } from '@shared/paths'

function sort(list: DirEntry[]): DirEntry[] {
  return [...list].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
}

/** Apply a single fs change to one directory's child list (pure). */
export function applyDirChange(entries: DirEntry[], change: FsChange): DirEntry[] {
  const name = baseName(change.path)
  switch (change.event) {
    case 'add':
    case 'addDir': {
      if (entries.some(e => e.path === change.path)) return entries
      return sort([...entries, { name, path: change.path, isDir: change.event === 'addDir' }])
    }
    case 'unlink':
    case 'unlinkDir':
      return entries.filter(e => e.path !== change.path)
    default:
      return entries
  }
}
