import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Result of validating a `registry:addRoot` candidate. `ok:false` carries a SPECIFIC, actionable
 *  `error` distinct per rejection kind (CONV-001) — never one generic message for every failure. */
export type ValidateRootResult = { ok: true; root: string } | { ok: false; error: string }

/** The shared CASE/SLASH-FOLDING comparison key for "is this the same physical project root as that
 *  one" (FINDING-DA-001 / REQ-002 — "keyed and de-duplicated by RESOLVED project-root absolute path").
 *  `path.resolve()` alone normalizes `..`/`.` segments and forward/back-slash style but PRESERVES case,
 *  and Windows filesystems are case-insensitive, so two spellings of the same physical directory
 *  differing only by case (or only by slash style) are still the same project on disk — this function
 *  folds both away for COMPARISON purposes.
 *
 *  Deliberately NOT what `validateRegistryRoot` returns/stores, and NOT what `OrkyRegistry` keeps in
 *  `paneRoots`/`persistedRoots` or hands back to a caller: those values must stay the ORIGINAL,
 *  case-preserved `resolve()` form, because `tests/main/orky-registry-service.test.ts` and
 *  `tests/main/validate-root.test.ts` (both FROZEN) assert the canonical `root` byte-for-byte against
 *  the original `mkdtemp` fixture path, which on a real Windows box is mixed-case (e.g.
 *  `C:\Users\...\Temp\orky-regsvc-XXXX`). This function exists ONLY for `OrkyRegistry.resolveCanonical`
 *  to ask "does this incoming root already match an existing tracked spelling, modulo case/slash style"
 *  — if so, the EXISTING (case-preserved) spelling is reused as-is; this function's own folded output is
 *  never itself stored or returned anywhere. */
export function normalizeProjectRoot(root: string): string {
  const resolved = resolve(root)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

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
