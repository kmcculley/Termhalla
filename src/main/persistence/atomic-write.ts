import * as fsp from 'node:fs/promises'
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

let seq = 0

/** A unique temp path beside `file`. Unique per call so concurrent writes to the same target
 *  (e.g. the debounced autosave racing the quit flush) never clobber each other's temp file. The
 *  `.tmp` suffix keeps it out of `listWorkspaceIds`' `*.json` filter and any other directory scan. */
function tmpPath(file: string): string {
  return `${file}.${process.pid}.${seq++}.tmp`
}

/** The fs operations atomicWrite needs, injectable so the rename-failure (crash) path is testable
 *  without redefining the frozen node:fs/promises namespace. Defaults to the real promises API. */
export interface AtomicFs {
  mkdir(dir: string, opts: { recursive: boolean }): Promise<unknown>
  writeFile(file: string, data: string, enc: 'utf8'): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(file: string, opts: { force: boolean }): Promise<void>
}

const realFs: AtomicFs = {
  mkdir: fsp.mkdir, writeFile: fsp.writeFile, rename: fsp.rename, rm: fsp.rm,
}

/** Windows can transiently fail `rename` over an existing target (EPERM/EBUSY/EACCES) when another
 *  process — antivirus, the search indexer, or a concurrent write to the same file — momentarily
 *  holds it. These are not real failures; a short retry clears them (same approach as
 *  write-file-atomic). A genuine error (e.g. a non-existent dir, or the injected test failure with
 *  no errno code) is not retried and propagates immediately. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRIES = 10

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function renameWithRetry(fs: AtomicFs, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(from, to); return }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt >= RENAME_RETRIES || !code || !TRANSIENT.has(code)) throw e
      await delay(10 * (attempt + 1))
    }
  }
}

/**
 * Write `data` to `file` atomically: write to a unique temp file in the same directory, then
 * `rename` it over the target. `rename` is atomic on the same volume, so a process kill mid-write
 * (e.g. an auto-update installer tearing the app down) leaves EITHER the previous complete file OR
 * the new complete one — never a truncated file that would silently degrade to defaults on load.
 *
 * Plain `writeFile` truncates the target to zero before writing, so an interrupted write corrupts
 * previously-good data; that was the root cause of cwd/SSH loss on auto-update restart.
 */
export async function atomicWrite(file: string, data: string, fs: AtomicFs = realFs): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = tmpPath(file)
  try {
    await fs.writeFile(tmp, data, 'utf8')
    await renameWithRetry(fs, tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => { /* temp may not exist */ })
    throw e
  }
}

/** Synchronous counterpart for shutdown flushes (notes/drafts run on the window 'close' event,
 *  where there is no chance to await). Same temp+rename atomicity guarantee. Best-effort: callers
 *  wrap it in try/catch on teardown. */
export function atomicWriteSync(file: string, data: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = tmpPath(file)
  writeFileSync(tmp, data, 'utf8')
  renameSync(tmp, file)
}
