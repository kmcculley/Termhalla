import { useEffect } from 'react'
import type { ProcInfo, AiSession, UsageMetrics } from '@shared/types'
import { Z, SURFACE } from './Modal'

/** Compact token count: 999 -> "999", 1234 -> "1.2k", 156000 -> "156k". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
}

/** In-tile popover listing a terminal's child-process tree, with an AI-session usage header.
 *  Auto-dismisses 2s after opening on a terminal with no children; if a process appears within
 *  that window `procInfo` changes, the effect re-runs, sees a non-empty tree, and cancels. */
export function ProcessPopover(
  { paneId, procInfo, aiSession, usage, onClose }: {
    paneId: string
    procInfo: ProcInfo | undefined
    aiSession: AiSession | undefined
    usage: UsageMetrics | undefined
    onClose: () => void
  }
) {
  useEffect(() => {
    if (procInfo && procInfo.tree.length > 0) return
    const t = setTimeout(onClose, 2000)
    return () => clearTimeout(t)
  }, [procInfo, onClose])

  return (
    <div data-testid="proc-menu" onClick={e => e.stopPropagation()}
      style={{ ...SURFACE, position: 'absolute', left: 4, top: 28, zIndex: Z.popover, padding: 6, maxWidth: 460,
        maxHeight: 240, overflow: 'auto', fontSize: 12, fontFamily: 'Consolas, monospace' }}>
      {aiSession && usage && (
        <div data-testid={`usage-${paneId}`}
          style={{ borderBottom: '1px solid var(--border, #444)', paddingBottom: 4, marginBottom: 4 }}>
          <div>context {fmtTokens(usage.contextTokens)} / {fmtTokens(usage.contextWindow)} · {usage.contextPct}%</div>
          <div style={{ opacity: 0.7 }}>
            in {fmtTokens(usage.input)} · out {fmtTokens(usage.output)} · cache r {fmtTokens(usage.cacheRead)} / w {fmtTokens(usage.cacheCreation)}
          </div>
        </div>
      )}
      {(!procInfo || procInfo.tree.length === 0) && <div style={{ opacity: 0.6 }}>No child processes.</div>}
      {procInfo && procInfo.tree.map(n => (
        <div key={n.pid} data-testid={`proc-row-${n.pid}`}
          style={{ paddingLeft: n.depth * 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ opacity: 0.7 }}>{n.name}</span>
          <span style={{ opacity: 0.45 }}>  {n.command}</span>
        </div>
      ))}
    </div>
  )
}
