import { useEffect } from 'react'
import type { ProcInfo, AiSession, UsageMetrics } from '@shared/types'
import { MenuSurface } from './MenuSurface'
import { INDENT_PX } from '../ui-tokens'

/** Auto-dismiss delay for a popover opened on a terminal that has no child processes yet. */
const NO_CHILDREN_AUTO_CLOSE_MS = 2000

/** Compact token count: 999 -> "999", 1234 -> "1.2k", 156000 -> "156k". */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 10 ? Math.round(k) : k.toFixed(1)}k`
}

/** Popover listing a terminal's child-process tree, with an AI-session usage header, anchored to
 *  its tile. Rendered through the shared MenuSurface (click-away + Escape dismiss).
 *  Auto-dismisses 2s after opening on a terminal with no children; if a process appears within
 *  that window `procInfo` changes, the effect re-runs, sees a non-empty tree, and cancels. */
export function ProcessPopover(
  { paneId, procInfo, aiSession, usage, anchor, onClose }: {
    paneId: string
    procInfo: ProcInfo | undefined
    aiSession: AiSession | undefined
    usage: UsageMetrics | undefined
    anchor: React.CSSProperties
    onClose: () => void
  }
) {
  useEffect(() => {
    if (procInfo && procInfo.tree.length > 0) return
    const t = setTimeout(onClose, NO_CHILDREN_AUTO_CLOSE_MS)
    return () => clearTimeout(t)
  }, [procInfo, onClose])

  return (
    <MenuSurface testid="proc-menu" portal onClose={onClose}
      style={{ ...anchor, padding: 6, maxWidth: 460, maxHeight: 240, overflow: 'auto', fontSize: 12, fontFamily: 'var(--mono)' }}>
      {aiSession && usage && (
        <div data-testid={`usage-${paneId}`}
          style={{ borderBottom: '1px solid var(--border, #444)', paddingBottom: 4, marginBottom: 4 }}>
          <div>context {fmtTokens(usage.contextTokens)} / {fmtTokens(usage.contextWindow)} · {usage.contextPct}%</div>
          <div style={{ color: 'var(--fg-dim, #aaa)' }}>
            in {fmtTokens(usage.input)} · out {fmtTokens(usage.output)} · cache r {fmtTokens(usage.cacheRead)} / w {fmtTokens(usage.cacheCreation)}
          </div>
        </div>
      )}
      {(!procInfo || procInfo.tree.length === 0) && <div style={{ color: 'var(--fg-dim, #aaa)' }}>No child processes.</div>}
      {procInfo && procInfo.tree.map(n => (
        <div key={n.pid} data-testid={`proc-row-${n.pid}`}
          style={{ paddingLeft: n.depth * INDENT_PX, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ color: 'var(--fg-dim, #aaa)' }}>{n.name}</span>
          <span style={{ opacity: 'var(--dimmer)' }}>  {n.command}</span>
        </div>
      ))}
    </MenuSurface>
  )
}
