import type { ProcInfo, ProcNode } from '@shared/types'

export interface CimRow {
  ProcessId: number
  ParentProcessId: number
  Name: string
  CommandLine: string | null
  CreationDate: string | null
}

/** Parse `ConvertTo-Json` output. PowerShell emits a single result as one object, many as an array. */
export function parseCimRows(json: string): CimRow[] {
  let data: unknown
  try { data = JSON.parse(json) } catch { return [] }
  const arr: unknown[] = Array.isArray(data) ? data : data ? [data] : []
  const rows: CimRow[] = []
  for (const r of arr) {
    const o = r as Record<string, unknown>
    const pid = Number(o?.ProcessId)
    const ppid = Number(o?.ParentProcessId)
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
    rows.push({
      ProcessId: pid,
      ParentProcessId: ppid,
      Name: typeof o.Name === 'string' ? o.Name : '',
      CommandLine: typeof o.CommandLine === 'string' ? o.CommandLine : null,
      CreationDate: typeof o.CreationDate === 'string' ? o.CreationDate : null
    })
  }
  return rows
}

/** Accept both the WMI `/Date(ms)/` form and an ISO string; 0 when unknown. */
export function parseCimDate(s: string | null): number {
  if (!s) return 0
  const m = /\/Date\((\d+)\)\//.exec(s)
  if (m) return Number(m[1])
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

export function cleanName(name: string): string {
  return name.replace(/\.exe$/i, '')
}

function childrenMap(rows: CimRow[]): Map<number, CimRow[]> {
  const byParent = new Map<number, CimRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.ParentProcessId) ?? []
    list.push(r)
    byParent.set(r.ParentProcessId, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => parseCimDate(a.CreationDate) - parseCimDate(b.CreationDate))
  }
  return byParent
}

function toNode(r: CimRow, depth: number): ProcNode {
  const command = r.CommandLine && r.CommandLine.trim() ? r.CommandLine.trim() : cleanName(r.Name)
  return { pid: r.ProcessId, ppid: r.ParentProcessId, name: cleanName(r.Name), command, depth }
}

/** Flatten the subtree under `shellPid` (excluding the shell) DFS pre-order, with depth. */
export function descendantsOf(rows: CimRow[], shellPid: number): ProcNode[] {
  const byParent = childrenMap(rows)
  const out: ProcNode[] = []
  const seen = new Set<number>([shellPid])
  const walk = (pid: number, depth: number): void => {
    for (const c of byParent.get(pid) ?? []) {
      if (seen.has(c.ProcessId)) continue
      seen.add(c.ProcessId)
      out.push(toNode(c, depth))
      walk(c.ProcessId, depth + 1)
    }
  }
  walk(shellPid, 0)
  return out
}

/** Follow the most-recently-created child from the shell to the deepest leaf. */
export function pickForeground(rows: CimRow[], shellPid: number): CimRow | null {
  const byParent = childrenMap(rows)
  let parent = shellPid
  let chosen: CimRow | null = null
  const guard = new Set<number>([shellPid])
  for (;;) {
    const children = byParent.get(parent) ?? []
    if (children.length === 0) break
    const best = children[children.length - 1] // childrenMap sorts ascending by CreationDate
    if (guard.has(best.ProcessId)) break
    guard.add(best.ProcessId)
    chosen = best
    parent = best.ProcessId
  }
  return chosen
}

export function buildProcInfo(rows: CimRow[], shellPid: number): ProcInfo {
  const fg = pickForeground(rows, shellPid)
  return { foreground: fg ? cleanName(fg.Name) : '', tree: descendantsOf(rows, shellPid) }
}
