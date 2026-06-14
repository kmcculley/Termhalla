import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function seedWorkspace(
  userData: string,
  panes: Array<{ paneId: string; config: unknown }>,
  layout: unknown
): void {
  const wsDir = join(userData, 'workspaces')
  mkdirSync(wsDir, { recursive: true })
  const panesObj: Record<string, unknown> = {}
  for (const p of panes) panesObj[p.paneId] = { paneId: p.paneId, config: p.config }
  const ws = { id: 'ws-seed', name: 'Seed', layout, panes: panesObj }
  writeFileSync(join(wsDir, 'ws-seed.json'), JSON.stringify({ schemaVersion: 3, workspace: ws }), 'utf8')
  writeFileSync(join(userData, 'app-state.json'),
    JSON.stringify({ schemaVersion: 3, openWorkspaceIds: ['ws-seed'], activeWorkspaceId: 'ws-seed' }), 'utf8')
}
