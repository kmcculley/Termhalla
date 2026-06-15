import type { AiSession, ProcInfo } from '@shared/types'
import { classifyAiSession } from './classify-ai'

type OnAi = (id: string, ai: AiSession | null) => void

/** Tracks active Claude/Codex sessions per terminal. SET from sub-project C's process info
 *  (sticky — persists across busy->idle); CLEARED on the shell command-done marker or close. */
export class AiSessionTracker {
  private active = new Map<string, AiSession>()

  constructor(private readonly onAi: OnAi) {}

  /** Feed from ProcessTracker. Only SETS (never clears); clearing is command-done driven. */
  onProcs(id: string, info: ProcInfo | null): void {
    if (!info) return
    const ai = classifyAiSession(info.tree)
    if (!ai) return
    const cur = this.active.get(id)
    if (!cur || cur.tool !== ai.tool) {
      this.active.set(id, ai)
      this.onAi(id, ai)
    }
  }

  /** The foreground shell command completed (OSC 133 D / pty exit) -> the session ended. */
  commandDone(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }

  unregister(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }
}
