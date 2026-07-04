/**
 * The named-agent registry store (REQ-004): a path-injected JSON file. F19 binds no
 * persistence location — F21 wires the path under Electron `userData` when the app grows
 * the UI. Load and save BOTH run the shared normalizer, so no unknown (possibly secret)
 * field survives a round-trip in either direction (baseline no-secrets posture), and the
 * save is atomic (temp file in the same directory + rename) so a crashed or aborted save
 * can never leave a torn registry file (CONV-014 posture).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizeNamedAgents, type NamedAgent } from '@shared/remote-agents'

/** Missing file or unparsable JSON → [] — a registry read never throws (CONV-002). */
export async function loadNamedAgents(filePath: string): Promise<NamedAgent[]> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch {
    return []
  }
  try {
    return normalizeNamedAgents(JSON.parse(text))
  } catch {
    return []
  }
}

/** Monotonic per-process counter: with the pid it makes every save's temp name unique, so
 *  two concurrent saves to the SAME path can never interleave on a shared temp file
 *  (FINDING-003) — the loser's rename still replaces whole-file, never tears. */
let saveSeq = 0

/** Normalize, then write atomically: unique temp file in the SAME directory, then rename
 *  onto the final path (rename is atomic within a volume; Windows MoveFileEx replaces). */
export async function saveNamedAgents(filePath: string, agents: unknown): Promise<void> {
  const normalized = normalizeNamedAgents(agents)
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid.toString(36)}-${(saveSeq++).toString(36)}.tmp`
  await writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf8')
  await rename(tmp, filePath)
}
