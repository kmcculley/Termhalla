import type { AiSession, ProcNode } from '@shared/types'

export interface AiToolPattern { tool: string; label: string; re: RegExp }

/** Patterns are anchored on path/word boundaries and only accept EXECUTABLE extensions
 *  (.exe/.cmd/.bat/.ps1) so a doc argument like `claude.md` is NOT a false positive,
 *  while `claude`, `claude.cmd`, the `claude-code` package, and `@anthropic-ai/claude` all match. */
export const AI_TOOLS: AiToolPattern[] = [
  { tool: 'claude', label: 'Claude',
    re: /(^|[\\/\s"])claude(\.(?:exe|cmd|bat|ps1))?($|[\s"])|claude-code|@anthropic-ai[\\/]claude/i },
  { tool: 'codex', label: 'Codex',
    re: /(^|[\\/\s"])codex(\.(?:exe|cmd|bat|ps1))?($|[\s"])|@openai[\\/]codex/i }
]

/** Detect a Claude/Codex session anywhere in a terminal's descendant process tree, or null. */
export function classifyAiSession(tree: ProcNode[]): AiSession | null {
  for (const t of AI_TOOLS) {
    for (const n of tree) {
      if (t.re.test(n.command) || t.re.test(n.name)) return { tool: t.tool, label: t.label }
    }
  }
  return null
}
