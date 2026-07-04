// FROZEN doc pin — feature 0016-remote-protocol-core-handshake (phase 4, REQ-017).
// Existence + load-bearing claims ONLY (doc-sync retains latitude over prose). The
// CLAUDE.md "Where things live" row is deliberately NOT pinned here — shared file,
// CONV-012/CONV-022.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('TEST-748 REQ-017 docs/features/remote-protocol.md documents the protocol contract', () => {
  it('exists and carries the load-bearing claims', () => {
    const text = readFileSync(resolve(process.cwd(), 'docs/features/remote-protocol.md'), 'utf8')
    // the wire format
    expect(text).toContain('hello')
    expect(text).toContain('WIRE_PROTO')
    expect(/8\s?MiB|8388608/.test(text), 'must state the default max frame size').toBe(true)
    // the handshake is a version CHECK, not a compatibility matrix
    expect(text.toLowerCase()).toContain('version check')
    expect(text.toLowerCase()).toContain('compatibility matrix')
    // the capability partition incl. the status reconciliation
    expect(text).toContain('status')
    expect(text).toContain('pty')
    // flow-control frames are reserved for F17
    expect(text).toContain('F17')
  })
})
