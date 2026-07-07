import { readFile, readdir, stat, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirEntry, ReadResult, StatResult } from '@shared/types'
import { atomicWrite, type AtomicFs } from '../persistence/atomic-write'

const MAX_BYTES = 50 * 1024 * 1024

export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function sortEntries(list: DirEntry[]): DirEntry[] {
  return [...list].sort((a, b) =>
    a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name))
}

export async function readTextFile(path: string, maxBytes = MAX_BYTES): Promise<ReadResult> {
  const s = await stat(path)
  if (s.size > maxBytes) return { content: '', tooLarge: true }
  const buf = await readFile(path)
  if (isBinary(buf)) throw new Error('Cannot open binary file')
  return { content: buf.toString('utf8'), tooLarge: false }
}

/** Editor save. Atomic (temp + rename) like every other durable write in the app: plain writeFile
 *  truncates the target before writing, so an app kill mid-save would leave the user's source file
 *  truncated. Returns the saved file's mtime for the editor's external-change detection. */
export async function writeTextFile(path: string, content: string, fs?: AtomicFs): Promise<number> {
  await atomicWrite(path, content, fs)
  return (await stat(path)).mtimeMs
}

export async function readDirectory(path: string): Promise<DirEntry[]> {
  const ents = await readdir(path, { withFileTypes: true })
  return sortEntries(ents.map(e => ({ name: e.name, path: join(path, e.name), isDir: e.isDirectory() })))
}

export async function statPath(path: string): Promise<StatResult> {
  const s = await stat(path)
  return { size: s.size, mtimeMs: s.mtimeMs, isDir: s.isDirectory() }
}

/** Rename/move a file or directory. Rejects (caller surfaces an error toast) if the source
 *  is missing or the target exists — node's rename throws on a cross-device move too. */
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await rename(oldPath, newPath)
}
