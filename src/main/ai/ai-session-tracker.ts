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

  /** Re-deliver the current sticky session for a pane that was just RE-ADOPTED by pty:spawn (an
   *  undock/redock handoff or a same-window remount). aiSession pushes are pane-scoped — routed to
   *  the pane's OWNING window — and the set-only dedup above means a quiet agent (sitting at its
   *  own TUI prompt, emitting nothing, staying classified) would never re-emit, so a destination
   *  window's renderer starts with an empty aiSessions map and its ✨ chip/usage wiring stays dark
   *  for the whole remainder of the session. Emitting on adoption is the push twin of the
   *  missed-push recovery pulls (cloudCurrent/registryCurrent). No-op for panes with no session. */
  reemit(id: string): void {
    const cur = this.active.get(id)
    if (cur) this.onAi(id, cur)
  }

  /** The foreground shell command completed (OSC 133 D / pty exit) -> the session ended. */
  commandDone(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }

  unregister(id: string): void {
    if (this.active.delete(id)) this.onAi(id, null)
  }
}
