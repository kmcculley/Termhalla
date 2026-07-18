// Finding 27 (2026-07 quality audit): openTab used to classify read failures by regexing the
// IPC-serialized error message (/binary/i), and folded EVERY other failure (permission denied,
// transient I/O, path-too-long) into `missing` — which the tab strip renders struck-through as
// "(deleted)", a misreport. fsRead now returns a discriminated ReadResult classified in main;
// this pure mapper turns it into the tab flags, with a DISTINCT `readError` state for unknown
// failures. `null` models the invoke itself rejecting (handler teardown) — also errored, never
// missing. Pure module (no ../api / monaco imports) per the CLAUDE.md renderer-unit-test rule.
import { describe, it, expect } from 'vitest'
import { toTabReadState } from '../../src/renderer/editor/read-state'

describe('toTabReadState', () => {
  it('ok → saved content, no flags', () => {
    expect(toTabReadState({ kind: 'ok', content: 'abc', tooLarge: false }))
      .toEqual({ saved: 'abc', tooLarge: false, missing: false, binary: false, readError: undefined })
  })
  it('ok + tooLarge keeps the tooLarge flag', () => {
    expect(toTabReadState({ kind: 'ok', content: '', tooLarge: true }))
      .toEqual({ saved: '', tooLarge: true, missing: false, binary: false, readError: undefined })
  })
  it('binary → binary flag only (the file exists — never "(deleted)")', () => {
    const s = toTabReadState({ kind: 'binary' })
    expect(s.binary).toBe(true)
    expect(s.missing).toBe(false)
    expect(s.readError).toBeUndefined()
  })
  it('not-found → missing (the ONLY state that renders "(deleted)")', () => {
    const s = toTabReadState({ kind: 'not-found' })
    expect(s.missing).toBe(true)
    expect(s.binary).toBe(false)
    expect(s.readError).toBeUndefined()
  })
  it('error → readError carrying the message, NOT missing', () => {
    const s = toTabReadState({ kind: 'error', message: 'EACCES: permission denied' })
    expect(s.missing).toBe(false)
    expect(s.binary).toBe(false)
    expect(s.readError).toBe('EACCES: permission denied')
  })
  it('a rejected invoke (null) → readError, never missing', () => {
    const s = toTabReadState(null)
    expect(s.missing).toBe(false)
    expect(s.readError).toBeTruthy()
  })
  it('an empty error message still yields a truthy readError (flag checks stay reliable)', () => {
    expect(toTabReadState({ kind: 'error', message: '' }).readError).toBeTruthy()
  })
})
