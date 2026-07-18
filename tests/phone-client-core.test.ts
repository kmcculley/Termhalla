// FROZEN test suite — feature 0026-phone-web-remote (phase 4; TEST-2672 AMENDED + TEST-2720..2724
// added at the v2 loopback, ESC-001 — FINDING-025/021/037/026/036/003/028/016/031/035/050).
// The phone client's pure core: REQ-017 (resync is a buffer REPLACEMENT), REQ-023 (token stripped
// from the URL and NEVER persisted in script-readable storage — the HttpOnly cookie is the durable
// credential; subscription hygiene), REQ-024 (fresh attach per reconnect; capped backoff; the
// terminal re-pair state), REQ-010 (client half of the hello drift check), REQ-013 (size from the
// freshest grid BEFORE the snapshot), REQ-030 (errors/exit/empty rendered), REQ-011 (list wiring).
//
// Contract set here for the implementer. These client modules MUST be import-safe under node
// (no top-level WebSocket / DOM / xterm access — side effects live in functions):
//   src/phone-client/token-storage.ts exports
//     extractTokenFromUrl(href: string): { token?: string; cleanedHref: string }
//     // v2: the module NO LONGER persists the plaintext token anywhere — the REQ-028 HttpOnly
//     // cookie (set server-side, invisible to script) is the durable client credential.
//   src/phone-client/ws-client.ts exports
//     applyPaneMessage(sink: { write(data: string): void; reset(): void },
//                      msg: { type: string; paneId?: string; data?: string }): void
//     reconnectAttachPlan(subscribedPaneIds: string[]): Array<{ type: 'subscribe'; paneId: string }>
//     createMessageGate(bundledProto: number): {
//       accept(msg: { type?: string; proto?: unknown }): 'handle' | 'reload-required' | 'drop' }
//     // a `hello` whose proto mismatches yields 'reload-required'; EVERY later message yields
//     // 'drop' (a stale cached PWA never silently misparses newer traffic).
//     reconnectDelayMs(attempt: number): number          // capped exponential backoff
//     reconnectOutcome(consecutiveAuthRefusals: number): 'retry' | 'revoked'
//     paneSwitchPlan(from: string | undefined, to: string | undefined):
//       Array<{ type: 'subscribe' | 'unsubscribe'; paneId: string }>
//     openPanePlan(pane: { paneId: string; cols: number; rows: number }):
//       [{ op: 'size'; cols: number; rows: number }, { op: 'subscribe'; paneId: string }]
//     // size FIRST: the terminal is sized from the freshest known grid BEFORE the snapshot
//     // is applied, so a non-80x24 pane never renders mis-wrapped (REQ-013).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { extractTokenFromUrl } from '../src/phone-client/token-storage'
import {
  applyPaneMessage, reconnectAttachPlan, createMessageGate,
  reconnectDelayMs, reconnectOutcome, paneSwitchPlan, openPanePlan
} from '../src/phone-client/ws-client'
import { PHONE_REMOTE_PROTO_VERSION } from '../src/shared/phone-remote/protocol'

const mkSink = (): { log: string[]; sink: { write(d: string): void; reset(): void } } => {
  const log: string[] = []
  return { log, sink: { write: (d) => log.push(`write:${d}`), reset: () => log.push('reset') } }
}

const clientSources = (): Array<[string, string]> => {
  const dir = resolve(process.cwd(), 'src/phone-client')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')])
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

describe('TEST-2672 REQ-023/REQ-028 (AMENDED v2 — ESC-001/FINDING-025) no plaintext token in script-readable storage', () => {
  // v1 of this test pinned a localStorage token round-trip. That contract is REVERSED by the
  // v2 spec: the HttpOnly session cookie (REQ-028, set by the server, invisible to script) is
  // the durable client credential, and the plaintext token must never be persisted anywhere
  // script-readable — localStorage, sessionStorage, or a script-written cookie.
  it('no phone-client source touches localStorage/sessionStorage or writes document.cookie', () => {
    for (const [name, code] of clientSources()) {
      expect(code, `${name} must not persist the token in script-readable storage`).not.toMatch(/localStorage|sessionStorage/)
      expect(code, `${name} must not write a script cookie (the credential cookie is HttpOnly, server-set)`).not.toMatch(/document\.cookie\s*=/)
    }
  })

  it('main.ts still strips the token from the address bar via history.replaceState (structural)', () => {
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

// ---------------------------------------------------------------------------------------------
// v2 loopback additions

describe('TEST-2720 REQ-010 the client half of the hello drift check (FINDING-021/037)', () => {
  it('a matching hello handles; a mismatched hello demands a reload and suppresses ALL later messages', () => {
    const ok = createMessageGate(PHONE_REMOTE_PROTO_VERSION)
    expect(ok.accept({ type: 'hello', proto: PHONE_REMOTE_PROTO_VERSION })).toBe('handle')
    expect(ok.accept({ type: 'data', paneId: 'A' })).toBe('handle')

    const stale = createMessageGate(PHONE_REMOTE_PROTO_VERSION)
    expect(stale.accept({ type: 'hello', proto: PHONE_REMOTE_PROTO_VERSION + 1 })).toBe('reload-required')
    expect(stale.accept({ type: 'data', paneId: 'A' }), 'a drifted client must stop processing').toBe('drop')
    expect(stale.accept({ type: 'panes' })).toBe('drop')
  })

  it('main.ts surfaces the "new version — reload" state and attempts a reload of the served bundle (structural)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/phone-client/main.ts'), 'utf8')
    expect(src).toMatch(/PHONE_REMOTE_PROTO_VERSION/)
    expect(src).toMatch(/reload/i)
  })
})

describe('TEST-2721 REQ-024 reconnect backoff is capped-exponential; auth refusal reaches a TERMINAL re-pair state', () => {
  it('delays increase monotonically and cap (never retry-forever-instantly, never unbounded)', () => {
    const d1 = reconnectDelayMs(1)
    const d3 = reconnectDelayMs(3)
    const d6 = reconnectDelayMs(6)
    expect(d1).toBeGreaterThan(0)
    expect(d3).toBeGreaterThan(d1)
    expect(d6).toBeGreaterThanOrEqual(d3)
    expect(reconnectDelayMs(20), 'the backoff must cap').toBe(reconnectDelayMs(50))
    expect(reconnectDelayMs(50)).toBeLessThanOrEqual(120_000)
  })

  it('repeated auth refusals become "revoked" within a bounded number of attempts; transient failures keep retrying', () => {
    expect(reconnectOutcome(0)).toBe('retry')
    expect(reconnectOutcome(1)).toBe('retry')
    let terminalAt = -1
    for (let n = 1; n <= 10; n++) {
      if (reconnectOutcome(n) === 'revoked') { terminalAt = n; break }
    }
    expect(terminalAt, 'auth refusal must reach the terminal re-pair state within 10 attempts').toBeGreaterThan(0)
    for (let n = terminalAt; n <= terminalAt + 5; n++) {
      expect(reconnectOutcome(n), 'once revoked, stays revoked').toBe('revoked')
    }
  })

  it('the client renders the re-pair guidance for the revoked state (structural)', () => {
    const all = clientSources().map(([, c]) => c).join('\n')
    expect(all, 'the terminal state must tell the user to re-scan the QR').toMatch(/re-?scan|re-?pair|new QR/i)
  })
})

describe('TEST-2722 REQ-023 subscription hygiene: at most the active pane stays subscribed', () => {
  it('switching panes unsubscribes the departing pane before subscribing the next', () => {
    expect(paneSwitchPlan('A', 'B')).toEqual([
      { type: 'unsubscribe', paneId: 'A' },
      { type: 'subscribe', paneId: 'B' }
    ])
    expect(paneSwitchPlan(undefined, 'A')).toEqual([{ type: 'subscribe', paneId: 'A' }])
    expect(paneSwitchPlan('A', undefined), 'returning to the list unsubscribes').toEqual([{ type: 'unsubscribe', paneId: 'A' }])
    expect(paneSwitchPlan('A', 'A')).toEqual([])
  })
})

describe('TEST-2723 REQ-013/REQ-023 the terminal is sized from the freshest grid BEFORE the snapshot', () => {
  it('openPanePlan sizes first, then subscribes (a 120x30 pane never renders mis-wrapped at 80x24)', () => {
    expect(openPanePlan({ paneId: 'P', cols: 120, rows: 30 })).toEqual([
      { op: 'size', cols: 120, rows: 30 },
      { op: 'subscribe', paneId: 'P' }
    ])
  })

  it('terminal-view consumes the plan (structural)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/phone-client/terminal-view.ts'), 'utf8')
    expect(src).toMatch(/openPanePlan/)
  })
})

describe('TEST-2724 REQ-030 the client RENDERS errors, in-view exit, and empty-inventory guidance', () => {
  it('server error frames become a visible status strip naming the reason (never silently discarded)', () => {
    const all = clientSources().map(([, c]) => c).join('\n')
    expect(all, 'an error banner/strip surface must exist').toMatch(/error/i)
    expect(all).toMatch(/banner|strip|toast|notice/i)
  })

  it('a paneExit for the ACTIVE pane shows an in-view "process exited" notice and disables input', () => {
    const view = readFileSync(resolve(process.cwd(), 'src/phone-client/terminal-view.ts'), 'utf8')
    expect(view).toMatch(/process exited|exited/i)
    expect(view, 'input must stop for an exited pane').toMatch(/exited/)
  })

  it('an empty inventory renders guidance, not a blank screen', () => {
    const list = readFileSync(resolve(process.cwd(), 'src/phone-client/pane-list.ts'), 'utf8')
    expect(list).toMatch(/open a terminal/i)
  })
})
