/**
 * Deterministic reachable-URL ranking (feature 0026, REQ-031 — closes FINDING-006/039/044, the
 * "first non-internal IPv4 in unspecified OS enumeration order" bug, same defect class as
 * CONV-025/CONV-063). Only non-internal IPv4 addresses participate (loopback is the bind layer's
 * business, not a LAN candidate); ranked RFC1918-class-first (192.168/16, then 10/8, then
 * 172.16/12, then any other/public IPv4), name-sorted within a rank so the result never depends on
 * `os.networkInterfaces()`'s enumeration order.
 */

export interface NetIface {
  address: string
  family: string
  internal: boolean
}

export type NetIfaceTable = Record<string, NetIface[] | undefined>

const inRange = (octets: number[], lo: number[], hi: number[]): boolean => {
  for (let i = 0; i < 4; i++) {
    if (octets[i] < lo[i] || octets[i] > hi[i]) return false
  }
  return true
}

const rankOf = (address: string): number => {
  const octets = address.split('.').map((n) => Number(n))
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n))) return 3
  if (octets[0] === 192 && octets[1] === 168) return 0
  if (octets[0] === 10) return 1
  if (inRange(octets, [172, 16, 0, 0], [172, 31, 255, 255])) return 2
  return 3
}

/** Enumerates ALL non-internal IPv4 addresses from an `os.networkInterfaces()`-shaped table and
 *  returns full `http://<addr>:<port>` URLs ranked deterministically: RFC1918 class first, then
 *  interface NAME ascending, then address ascending — independent of the table's key order. */
export function rankReachableUrls(ifaces: NetIfaceTable, port: number): string[] {
  if (!ifaces || typeof ifaces !== 'object') return []
  const entries: Array<{ name: string; address: string; rank: number }> = []
  for (const name of Object.keys(ifaces)) {
    const list = ifaces[name]
    if (!Array.isArray(list)) continue
    for (const iface of list) {
      if (!iface || iface.family !== 'IPv4' || iface.internal) continue
      entries.push({ name, address: iface.address, rank: rankOf(iface.address) })
    }
  }
  entries.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.address.localeCompare(b.address))
  return entries.map((e) => `http://${e.address}:${port}`)
}
