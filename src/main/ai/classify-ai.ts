import type { AiSession, AiTool, ProcNode } from '@shared/types'

export interface AiToolPattern { tool: AiTool; label: string; re: RegExp }

/** Patterns are anchored on path/word boundaries and only accept EXECUTABLE extensions
 *  (.exe/.cmd/.bat/.ps1) so a doc argument like `claude.md` is NOT a false positive,
 *  while `claude`, `claude.cmd`, the `claude-code` package, and `@anthropic-ai/claude` all match.
 *
 *  EVERY alternative is boundary-anchored (baseline KNOWN BUG #1, fixed 2026-07-09): the
 *  `claude-code` / `@anthropic-ai/claude` / `@openai/codex` alternatives used to be plain
 *  substrings, so a command line merely CONTAINING them — a directory named `claude-codebase`,
 *  `my-claude-code-notes`, a lookalike scope member — classified as a live session. The bare
 *  `claude`/`codex` alternatives keep their original after-class (`$`/space/quote, deliberately
 *  NO dot or path separator — that exclusion is the `claude.md` guard and the "a dir named
 *  claude in a path is not a session" rule); the package alternatives allow a path separator
 *  after (they name directories inside node_modules). */
export const AI_TOOLS: AiToolPattern[] = [
  { tool: 'claude', label: 'Claude',
    re: /(^|[\\/\s"])claude(\.(?:exe|cmd|bat|ps1))?($|[\s"])|(^|[\\/\s"])claude-code(\.(?:exe|cmd|bat|ps1))?($|[\s"\\/])|@anthropic-ai[\\/]claude(-code)?($|[\s"\\/])/i },
  { tool: 'codex', label: 'Codex',
    re: /(^|[\\/\s"])codex(\.(?:exe|cmd|bat|ps1))?($|[\s"])|@openai[\\/]codex($|[\s"\\/])/i }
]

/** Detect a Claude/Codex session anywhere in a terminal's descendant process tree, or null. */
export function classifyAiSession(tree: ProcNode[]): AiSession | null {
  // AI_TOOLS order is the priority: the first tool that matches ANY node in the tree wins.
  for (const t of AI_TOOLS) {
    for (const n of tree) {
      if (t.re.test(n.command) || t.re.test(n.name)) return { tool: t.tool, label: t.label }
    }
  }
  return null
}
