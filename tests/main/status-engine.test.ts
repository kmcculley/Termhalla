import { describe, it, expect, afterEach } from 'vitest'
import { StatusEngine } from '../../src/main/status/status-engine'
import type { TerminalStatus } from '@shared/types'

const ESC = '\x1b', BEL = '\x07'
const mark = (b: string) => `${ESC}]133;${b}${BEL}`

describe('StatusEngine', () => {
  let engine: StatusEngine | null = null
  afterEach(() => { engine?.dispose(); engine = null })

  it('emits only on status change and routes markers to the right session', () => {
    const events: Array<[string, TerminalStatus]> = []
    let clock = 0
    engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => {}, () => clock)
    engine.register('t1')                       // emits initial idle
    engine.feed('t1', mark('C') + 'working')    // -> busy
    engine.feed('t1', 'more output')            // still busy -> no new emit
    engine.feed('t1', mark('D;0') + mark('A'))  // -> idle (success)

    const states = events.filter(e => e[0] === 't1').map(e => e[1].state)
    expect(states).toEqual(['idle', 'busy', 'idle'])
    expect(events.filter(e => e[0] === 't1').pop()![1].lastExit).toBe('success')
  })

  it('markExit drives the session back to idle', () => {
    const events: Array<[string, TerminalStatus]> = []
    let clock = 0
    engine = new StatusEngine((id, st) => events.push([id, { ...st }]), () => {}, () => clock)
    engine.register('t1')
    engine.feed('t1', mark('C'))   // busy
    engine.markExit('t1', 0)       // idle
    expect(events.pop()![1].state).toBe('idle')
  })

  it('emits cwd changes (deduped) from OSC 9;9 reports', () => {
    const cwds: Array<[string, string]> = []
    let clock = 0
    engine = new StatusEngine(() => {}, (id, cwd) => cwds.push([id, cwd]), () => clock)
    engine.register('t1')
    engine.feed('t1', `${ESC}]9;9;C:\\a${BEL}`)
    engine.feed('t1', 'output')                  // no cwd -> no emit
    engine.feed('t1', `${ESC}]9;9;C:\\a${BEL}`)  // same cwd -> no emit
    engine.feed('t1', `${ESC}]9;9;C:\\b${BEL}`)  // changed -> emit
    expect(cwds).toEqual([['t1', 'C:\\a'], ['t1', 'C:\\b']])
  })
})
