import { BrowserWindow } from 'electron'

/** Fixed size of the ghost chip window (roughly one tab). */
const GHOST_SIZE = { width: 200, height: 32 }
/** Offset from the cursor so the chip trails it like the in-window DOM ghost does. */
const CURSOR_OFFSET = 12

/**
 * The OS-level tear-off drag ghost: a frameless, click-through, always-on-top mini window that
 * follows the screen cursor during a tab tear-off once it leaves every app window (the renderer's
 * DOM ghost is clipped at the window edge, so past it an undock drag had no visual at all).
 *
 * Purely cosmetic and strictly bounded:
 * - never focusable, never a drop target, ignores all mouse events;
 * - has NO preload and loads only an inline data: URL (the workspace name, HTML-escaped);
 * - destroyed on drag end, on the owning drag's window closing, and on quit — it can never be the
 *   thing keeping the app alive.
 */
export class DragGhost {
  private win: BrowserWindow | null = null
  private lastName: string | null = null

  /** Move the ghost to screen position (x, y), creating/re-labelling it as needed. */
  moveTo(x: number, y: number, name: string): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = this.create(name)
      this.lastName = name
    } else if (name !== this.lastName) {
      void this.win.loadURL(ghostUrl(name))
      this.lastName = name
    }
    this.win.setPosition(Math.round(x + CURSOR_OFFSET), Math.round(y + CURSOR_OFFSET))
    if (!this.win.isVisible()) this.win.showInactive()
  }

  /** Hide but keep the window (the cursor re-entered an app window mid-drag). */
  hide(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }

  /** Drag over / app teardown: drop the window entirely. */
  destroy(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.lastName = null
  }

  private create(name: string): BrowserWindow {
    const win = new BrowserWindow({
      ...GHOST_SIZE,
      frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
      focusable: false, resizable: false, movable: false, minimizable: false,
      hasShadow: false, show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    win.setIgnoreMouseEvents(true)
    void win.loadURL(ghostUrl(name))
    return win
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Inline chip markup — styled like the in-window DOM ghost (elevated surface, rounded border). */
function ghostUrl(name: string): string {
  const html =
    '<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden;background:transparent">' +
    '<div style="box-sizing:border-box;height:28px;line-height:24px;padding:1px 10px;margin:1px;' +
    'font:13px system-ui,sans-serif;color:#eee;background:#333;border:1px solid #555;border-radius:4px;' +
    'opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
    escapeHtml(name) + '</div></body>'
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html)
}
