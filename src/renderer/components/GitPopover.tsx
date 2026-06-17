import type { GitStatus } from '@shared/types'
import { Z, SURFACE } from './Modal'

/** Read-only in-tile popover with full git detail. Positioned like ProcessPopover (absolute within
 *  the position:relative tile); closed by toggling the chip again. */
export function GitPopover({ status }: { status: GitStatus }) {
  return (
    <div data-testid="git-menu" onClick={e => e.stopPropagation()}
      style={{ ...SURFACE, position: 'absolute', left: 4, top: 28, zIndex: Z.popover, padding: 6,
        maxWidth: 320, fontSize: 12, fontFamily: 'var(--mono)' }}>
      <div>{status.detached ? `detached @ ${status.branch}` : status.branch}</div>
      {status.upstream && (
        <div style={{ color: 'var(--fg-dim, #aaa)' }}>{status.upstream} · ↑{status.ahead} ↓{status.behind}</div>
      )}
      <div style={{ color: 'var(--fg-dim, #aaa)' }}>
        staged {status.staged} · unstaged {status.unstaged} · untracked {status.untracked}
      </div>
    </div>
  )
}
