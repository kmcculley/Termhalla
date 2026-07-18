// FROZEN test suite — feature 0026-phone-web-remote (phase 4).
// The phone client's pure core: REQ-017 (resync is a buffer REPLACEMENT), REQ-023 (token
// stored client-side and stripped from the visible URL), REQ-024 (reconnect performs a fresh
// attach per subscribed pane), REQ-011/REQ-013 (client rendering wiring, structural).
//
// Contract set here for the implementer. These client modules MUST be import-safe under node
// (no top-level WebSocket / DOM / xterm access — side effects live in functions):
//   src/phone-client/token-storage.ts exports
//     extractTokenFromUrl(href: string): { token?: string; cleanedHref: string }
//     createTokenStorage(storage: { getItem(k: string): string | null;
//                                   setItem(k: string, v: string): void }):
//       { save(token: string): void; load(): string | undefined }
//   src/phone-client/ws-client.ts exports
//     applyPaneMessage(sink: { write(data: string): void; reset(): void },
//                      msg: { type: string; paneId?: string; data?: string }): void
//     reconnectAttachPlan(subscribedPaneIds: string[]): Array<{ type: 'subscribe'; paneId: string }>
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { extractTokenFromUrl, createTokenStorage } from '../src/phone-client/token-storage'
import { applyPaneMessage, reconnectAttachPlan } from '../src/phone-client/ws-client'

const mkSink = (): { log: string[]; sink: { write(d: string): void; reset(): void } } => {
  const log: string[] = []
  return { log, sink: { write: (d) => log.push(`write:${d}`), reset: () => log.push('reset') } }
}

describe('TEST-2670 REQ-017/REQ-024 snapshot and resync REPLACE the client buffer; data appends', () => {
  it('snapshot resets then writes (a fresh attach replaces any prior content)', () => {
    const { log, sink } = mkSink()
    applyPaneMessage(sink, { type: 'data', paneId: 'A', data: 'stale' })
    applyPaneMessage(sink, { type: 'snapshot', paneId: 'A', data: 'SNAP' })
    expect(log).toEqual(['write:stale', 'reset', 'write:SNAP'])
  })

  it('resync is reset + snapshot — never an append', () => {
    const { log, sink } = mkSink()
    applyPaneMessage(sink, { type: 'resync', paneId: 'A', data: 'RESYNC' })
    expect(log).toEqual(['reset', 'write:RESYNC'])
  })

  it('data appends without a reset; unknown message types are inert and never throw', () => {
    const { log, sink } = mkSink()
    applyPaneMessage(sink, { type: 'data', paneId: 'A', data: 'one' })
    applyPaneMessage(sink, { type: 'data', paneId: 'A', data: 'two' })
    expect(log).toEqual(['write:one', 'write:two'])
    expect(() => applyPaneMessage(sink, { type: 'mystery' })).not.toThrow()
    expect(log).toEqual(['write:one', 'write:two'])
  })
})

describe('TEST-2674 REQ-024 a reconnect is a fresh attach for every subscribed pane', () => {
  it('plans one fresh subscribe per subscribed pane (no assumed stream continuity)', () => {
    expect(reconnectAttachPlan(['A', 'B'])).toEqual([
      { type: 'subscribe', paneId: 'A' },
      { type: 'subscribe', paneId: 'B' }
    ])
    expect(reconnectAttachPlan([])).toEqual([])
  })
})

describe('TEST-2671 REQ-023 the pairing token is stripped from the visible URL', () => {
  it('extracts the token and returns a cleaned href without it', () => {
    const { token, cleanedHref } = extractTokenFromUrl('http://192.168.1.10:8199/?token=SECRET123&view=list')
    expect(token).toBe('SECRET123')
    expect(cleanedHref).not.toContain('SECRET123')
    expect(cleanedHref).not.toContain('token=')
    expect(cleanedHref).toContain('view=list')   // other params survive
  })

  it('a URL without a token is returned unchanged with no token', () => {
    const { token, cleanedHref } = extractTokenFromUrl('http://127.0.0.1:8199/')
    expect(token).toBeUndefined()
    expect(cleanedHref).toBe('http://127.0.0.1:8199/')
  })
})

describe('TEST-2672 REQ-023 client-side token persistence (paired phones survive restarts)', () => {
  it('save/load round-trips through the injected storage', () => {
    const backing = new Map<string, string>()
    const store = createTokenStorage({
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => { backing.set(k, v) }
    })
    expect(store.load()).toBeUndefined()
    store.save('tok-123')
    expect(store.load()).toBe('tok-123')
    expect([...backing.values()]).toContain('tok-123')
  })

  it('main.ts strips the token from the address bar via history.replaceState (structural)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/phone-client/main.ts'), 'utf8')
    expect(src).toMatch(/history\.replaceState/)
    expect(src).toMatch(/extractTokenFromUrl/)
  })
})

describe('TEST-2673 REQ-023/REQ-011/REQ-013 client UI wiring (structural)', () => {
  it('pane-list renders workspace-grouped rows with live status chips', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/phone-client/pane-list.ts'), 'utf8')
    for (const status of ['busy', 'idle', 'needs-input', 'exited']) {
      expect(src, `pane-list must know the '${status}' status`).toContain(status)
    }
  })

  it('terminal-view wires key-bar taps into input messages and never originates a resize', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/phone-client/terminal-view.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(src).toMatch(/key-bar/)              // imports the pure mapping module
    expect(src).toMatch(/['"]input['"]/)        // emits input messages
    // no client-originated resize: the ONLY grid source is the server's `grid` push
    expect(code).not.toMatch(/type:\s*['"]resize['"]/)
    expect(code).not.toMatch(/fit\(\)/)         // no FitAddon-driven grid (pinch-zoom/pan instead)
  })
})
