/**
 * The workspace-grouped pane list (feature 0026, REQ-011/REQ-023): each row renders the pane's
 * live status chip — busy / idle / needs-input / exited — driven by the server's `panes`
 * inventory push and subsequent `status` pushes.
 */

export interface PaneRow {
  paneId: string
  title: string
  kind: string
  cols: number
  rows: number
  status: string
}

export interface WorkspaceGroup {
  id: string
  name: string
  panes: PaneRow[]
}

/** busy / idle / needs-input / exited — the full REQ-011 status chip vocabulary. */
const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  busy: 'busy',
  'needs-input': 'needs input',
  exited: 'exited'
}

export class PaneList {
  private statuses = new Map<string, string>()
  private workspaces: WorkspaceGroup[] = []

  constructor(private container: HTMLElement, private onSelect: (paneId: string) => void) {}

  setInventory(workspaces: WorkspaceGroup[]): void {
    this.workspaces = workspaces
    for (const ws of workspaces) for (const pane of ws.panes) this.statuses.set(pane.paneId, pane.status)
    this.render()
  }

  setStatus(paneId: string, status: string): void {
    this.statuses.set(paneId, status)
    this.render()
  }

  private render(): void {
    this.container.innerHTML = ''
    for (const ws of this.workspaces) {
      const section = document.createElement('section')
      section.className = 'pane-list-workspace'
      const heading = document.createElement('h2')
      heading.textContent = ws.name
      section.appendChild(heading)

      const list = document.createElement('ul')
      list.className = 'pane-list-rows'
      for (const pane of ws.panes) {
        const status = this.statuses.get(pane.paneId) ?? pane.status
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'pane-list-row'
        const title = document.createElement('span')
        title.className = 'pane-list-title'
        title.textContent = pane.title
        const chip = document.createElement('span')
        // Chip state names double as CSS hooks — kept literal so a status flip needs no mapping.
        chip.className = `pane-status-chip pane-status-chip--${status}`
        chip.textContent = STATUS_LABEL[status] ?? status
        btn.appendChild(title)
        btn.appendChild(chip)
        btn.addEventListener('click', () => this.onSelect(pane.paneId))
        li.appendChild(btn)
        list.appendChild(li)
      }
      section.appendChild(list)
      this.container.appendChild(section)
    }
  }
}
