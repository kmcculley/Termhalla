import type { GitStatus } from '@shared/types'
import { MenuSurface } from './MenuSurface'

/** Read-only popover with full git detail, anchored to its tile (the caller measures the anchor).
 *  Rendered through the shared MenuSurface so click-away and Escape dismiss it like every menu. */
export function GitPopover(
  { status, anchor, onClose }: { status: GitStatus; anchor: React.CSSProperties; onClose: () => void }
) {
  return (
    <MenuSurface testid="git-menu" portal onClose={onClose}
      style={{ ...anchor, padding: 6, maxWidth: 320, fontSize: 12, fontFamily: 'var(--mono)' }}>
      <div>{status.detached ? `detached @ ${status.branch}` : status.branch}</div>
      {status.upstream && (
        <div style={{ color: 'var(--fg-dim, #aaa)' }}>{status.upstream} · ↑{status.ahead} ↓{status.behind}</div>
      )}
      <div style={{ color: 'var(--fg-dim, #aaa)' }}>
        staged {status.staged} · unstaged {status.unstaged} · untracked {status.untracked}
      </div>
      {/* Only mid-merge: a conflict is the popover's most urgent fact, in the needs-attention
          tint (paint-only). Absent entirely for the everyday no-conflict case. */}
      {status.conflicted > 0 && (
        <div style={{ color: 'var(--status-needs, #ff8f00)' }}>
          conflicted {status.conflicted}
        </div>
      )}
    </MenuSurface>
  )
}
