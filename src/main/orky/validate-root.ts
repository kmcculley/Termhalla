import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Result of validating a `registry:addRoot` candidate. `ok:false` carries a SPECIFIC, actionable
 *  `error` distinct per rejection kind (CONV-001) — never one generic message for every failure. */
export type ValidateRootResult = { ok: true; root: string } | { ok: false; error: string }

/** Validate + normalize a `registry:addRoot` IPC argument (TASK-003, REQ-009/REQ-016). NEVER throws — a
 *  malformed IPC arg must not become an unhandled rejection that kills the main process (Node 22 default
 *  `--unhandled-rejections=throw`). Accepts ONLY a resolved, currently-existing directory that contains a
 *  `.orky/` directory (reusing the same `.orky/`-existence check semantics as `findOrkyRoot`, but checked
 *  AT the resolved dir, not an upward walk — `addRoot` names the project root directly).
 *
 *  `path.resolve` collapses any `..` segment syntactically before the existence check ever runs, so a
 *  traversal-laden path that collapses onto a legitimate `.orky/` project resolves to the canonical
 *  absolute root (no literal `..` ever survives into the accepted `root`); a traversal that does NOT
 *  land on a valid project is rejected the same as any other non-`.orky/` path. */
export async function validateRegistryRoot(input: unknown): Promise<ValidateRootResult> {
  if (typeof input !== 'string') return { ok: false, error: 'root must be a string path' }

  let root: string
  try { root = resolve(input) }
  catch { return { ok: false, error: `root path could not be resolved: ${input}` } }

  let rootStat
  try { rootStat = await stat(root) }
  catch { return { ok: false, error: `path does not exist: ${root}` } }
  if (!rootStat.isDirectory()) return { ok: false, error: `path is not a directory: ${root}` }

  try {
    const orkyStat = await stat(join(root, '.orky'))
    if (!orkyStat.isDirectory()) return { ok: false, error: `no .orky/ directory found under ${root}` }
  } catch {
    return { ok: false, error: `no .orky/ directory found under ${root}` }
  }

  return { ok: true, root }
}
