// FROZEN test suite — feature 0026-phone-web-remote (phase 4, v2 loopback — FINDING-006/039/044).
// REQ-031: `status().urls` enumerates ALL candidate reachable URLs under a STATED deterministic
// ranking — never raw OS enumeration order (CONV-025/CONV-063 class).
//
// Contract set here for the implementer — src/main/phone-remote/network-urls.ts exports:
//   rankReachableUrls(
//     ifaces: Record<string, Array<{ address: string; family: string; internal: boolean }>>,
//     port: number
//   ): string[]
// Semantics (each pinned below):
//  - only non-internal IPv4 addresses participate (loopback/internal and IPv6 are excluded —
//    the loopback URL is the bind layer's business, not the LAN candidate list)
//  - rank order: 192.168.0.0/16 first (the motivating home-LAN phone case), then 10.0.0.0/8,
//    then 172.16.0.0/12, then any other (public) IPv4
//  - within a rank: ordered by interface NAME ascending, then address ascending — deterministic
//    under any enumeration order of the OS table
//  - each entry is a full `http://<addr>:<port>` URL
import { describe, it, expect } from 'vitest'
import { rankReachableUrls } from '../../src/main/phone-remote/network-urls'

type Table = Record<string, Array<{ address: string; family: string; internal: boolean }>>

const TABLE: Table = {
  'Wi-Fi': [
    { address: '192.168.1.23', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false }
  ],
  'Ethernet 2': [{ address: '10.0.0.7', family: 'IPv4', internal: false }],
  Ethernet: [{ address: '192.168.50.5', family: 'IPv4', internal: false }],
  'vEthernet (WSL)': [{ address: '172.20.144.1', family: 'IPv4', internal: false }],
  Tailscale: [{ address: '100.101.102.103', family: 'IPv4', internal: false }],
  'Loopback Pseudo-Interface 1': [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
}

const EXPECTED = [
  'http://192.168.50.5:8199', // rank 0 (192.168/16), name 'Ethernet' < 'Wi-Fi'
  'http://192.168.1.23:8199',
  'http://10.0.0.7:8199', // rank 1 (10/8)
  'http://172.20.144.1:8199', // rank 2 (172.16/12)
  'http://100.101.102.103:8199' // rank 3 (everything else, non-internal IPv4)
]

describe('TEST-2694 REQ-031 deterministic reachable-URL ranking', () => {
  it('ranks RFC1918 classes 192.168 -> 10 -> 172.16, name-sorted within a rank, excluding internal + IPv6', () => {
    expect(rankReachableUrls(TABLE, 8199)).toEqual(EXPECTED)
  })

  it('is deterministic under permuted OS enumeration order (never raw table order)', () => {
    const names = Object.keys(TABLE)
    const permutations = [
      [...names].reverse(),
      [names[2], names[0], names[4], names[1], names[5], names[3]],
      [names[4], names[3], names[5], names[0], names[2], names[1]]
    ]
    for (const order of permutations) {
      const permuted: Table = {}
      for (const n of order) permuted[n] = TABLE[n]
      expect(rankReachableUrls(permuted, 8199)).toEqual(EXPECTED)
    }
  })

  it('172.16.0.0/12 boundaries: 172.15.x and 172.32.x are NOT private (rank below 172.16..172.31)', () => {
    const t: Table = {
      a: [{ address: '172.15.0.1', family: 'IPv4', internal: false }],
      b: [{ address: '172.31.255.1', family: 'IPv4', internal: false }],
      c: [{ address: '172.32.0.1', family: 'IPv4', internal: false }]
    }
    expect(rankReachableUrls(t, 80)).toEqual([
      'http://172.31.255.1:80',
      'http://172.15.0.1:80',
      'http://172.32.0.1:80'
    ])
  })

  it('an empty/garbage table yields an empty list, never a throw', () => {
    expect(rankReachableUrls({}, 8199)).toEqual([])
    expect(() => rankReachableUrls({ x: [] }, 8199)).not.toThrow()
  })
})
