// Characterization tests pin the behavior the system had at baseline. They are a CHANGE-DETECTOR, not a
// correctness oracle: a failure means behavior CHANGED — a human adjudicates whether that is an intended
// change (update the test) or a regression (fix the code). Captured by /orky:discover; do not hand-edit.
//
// Subsystem: terminal awareness — status/needs-input engine and cwd parser (src/main/status/).
import { describe, it, expect } from 'vitest'
import {
  stripAnsi, isPureControl, tailMatchesInputPrompt, computeNeedsInput, looksLikePrompt,
  computeIdleFallback, DEFAULT_NEEDS_INPUT_PATTERNS, AGENT_WORKING_RE, AGENT_WORKING_GRACE_MS,
  type NeedsInputConfig
} from '../src/main/status/needs-input'
import { StatusTracker } from '../src/main/status/status-tracker'
import { CwdParser } from '../src/main/status/cwd-parser'

const cfg: NeedsInputConfig = {
  enabled: true,
  quietMs: 500,
  patterns: DEFAULT_NEEDS_INPUT_PATTERNS,
  heuristicIdleMs: 1500,
  heuristicIdleHardMs: 8000
}

describe('CHAR-001 needs-input: ANSI stripping & pure-control detection', () => {
  it('stripAnsi removes CSI/SGR escapes, keeps printable text', () => {
    expect(stripAnsi('\x1b[31mhi\x1b[0m')).toBe('hi')
    expect(stripAnsi('plain')).toBe('plain')
  })
  it('isPureControl: true for ANSI-only and cursor-home redraws, false for real text', () => {
    expect(isPureControl('\x1b[2J')).toBe(true)          // erase-screen only
    expect(isPureControl('   \r\n')).toBe(true)          // whitespace only
    expect(isPureControl('\x1b[Hreal text')).toBe(true)  // BEGINS with cursor-home => screen repaint
    expect(isPureControl('hello')).toBe(false)
    expect(isPureControl('cleared \x1b[Hmid')).toBe(false) // home NOT at start => real output
  })
})

describe('CHAR-002 needs-input: prompt-tail matching', () => {
  it('tailMatchesInputPrompt matches recognized input prompts on the last non-blank line', () => {
    const p = DEFAULT_NEEDS_INPUT_PATTERNS
    expect(tailMatchesInputPrompt('Password: ', p)).toBe(true)
    expect(tailMatchesInputPrompt('Overwrite? [y/n] ', p)).toBe(true)
    expect(tailMatchesInputPrompt('Proceed (yes/no)? ', p)).toBe(true)
    expect(tailMatchesInputPrompt('Password: \n\n', p)).toBe(true) // trailing blank lines skipped
    expect(tailMatchesInputPrompt('just output', p)).toBe(false)
  })
  it('looksLikePrompt recognizes shell prompt terminators', () => {
    expect(looksLikePrompt('PS C:\\dev> ')).toBe(true)
    expect(looksLikePrompt('user@host:~$ ')).toBe(true)
    expect(looksLikePrompt('building...')).toBe(false)
  })
  it('computeNeedsInput requires enabled + quiet>=quietMs + prompt match', () => {
    expect(computeNeedsInput(600, 'Password: ', cfg)).toBe(true)
    expect(computeNeedsInput(100, 'Password: ', cfg)).toBe(false)         // not quiet long enough
    expect(computeNeedsInput(600, 'building...', cfg)).toBe(false)        // no prompt
    expect(computeNeedsInput(600, 'Password: ', { ...cfg, enabled: false })).toBe(false)
  })
})

describe('CHAR-003 needs-input: idle fallback heuristic', () => {
  it('stays busy until heuristicIdleMs elapses', () => {
    expect(computeIdleFallback(1000, 'PS C:\\> ', false, cfg)).toBe(false)
  })
  it('no-markers + recognized prompt => idle on the fast path', () => {
    expect(computeIdleFallback(2000, 'PS C:\\> ', false, cfg)).toBe(true)
  })
  it('with markers, a recognized prompt only idles after sustained (hard) silence', () => {
    expect(computeIdleFallback(2000, 'PS C:\\> ', true, cfg)).toBe(false)
    expect(computeIdleFallback(9000, 'PS C:\\> ', true, cfg)).toBe(true)
  })
  it('never idles while sitting at an input prompt', () => {
    expect(computeIdleFallback(9000, 'Password: ', false, cfg)).toBe(false)
  })
  it('AI session idles on sustained silence only once the working indicator has lapsed', () => {
    expect(computeIdleFallback(9000, 'agent box', true, cfg, { aiActive: true, aiWorkingRecent: false })).toBe(true)
    expect(computeIdleFallback(9000, 'agent box', true, cfg, { aiActive: true, aiWorkingRecent: true })).toBe(false)
  })
  it('AGENT_WORKING_RE matches the space-collapsed "esc to interrupt" indicator; grace is 6s', () => {
    expect(AGENT_WORKING_RE.test('esctointerrupt')).toBe(true)
    expect(AGENT_WORKING_RE.test('press esc to interrupt')).toBe(true)
    expect(AGENT_WORKING_GRACE_MS).toBe(6000)
  })
})

describe('CHAR-004 StatusTracker lifecycle', () => {
  it('starts idle and reports the constructor time as `since`', () => {
    const t = new StatusTracker(0, cfg)
    expect(t.status()).toEqual({ state: 'idle', lastExit: undefined, since: 0 })
  })
  it('OSC 133 C->busy, D records exit (state unchanged), A->idle', () => {
    const t = new StatusTracker(0, cfg)
    expect(t.onMarker('C', undefined, 10).state).toBe('busy')
    const afterDone = t.onMarker('D', 0, 20)
    expect(afterDone.state).toBe('busy')          // D alone does not return to idle
    expect(afterDone.lastExit).toBe('success')
    expect(t.onMarker('A', undefined, 30).state).toBe('idle')
  })
  it('records a non-zero exit as failure', () => {
    const t = new StatusTracker(0, cfg)
    t.onMarker('C', undefined, 10)
    expect(t.onMarker('D', 1, 20).lastExit).toBe('failure')
  })
  it('with no markers, real output flips idle->busy then sustained silence ticks back to idle', () => {
    const t = new StatusTracker(0, cfg)
    expect(t.onOutput('PS C:\\> ', 0).state).toBe('busy')
    expect(t.tick(2000).state).toBe('idle')
  })
  it('a quiet input prompt ticks into needs-input', () => {
    const t = new StatusTracker(0, cfg)
    t.onOutput('Password: ', 0)
    expect(t.tick(600).state).toBe('needs-input')
  })
})

describe('CHAR-005 CwdParser: OSC cwd extraction', () => {
  const ESC = '\x1b', BEL = '\x07'
  it('extracts an OSC 9;9 Windows path', () => {
    expect(new CwdParser().push(`${ESC}]9;9;C:\\dev\\foo${BEL}`)).toBe('C:\\dev\\foo')
  })
  it('translates an OSC 7 dos-style file URL to a Windows path', () => {
    expect(new CwdParser().push(`${ESC}]7;file://host/C:/dev/app${BEL}`)).toBe('C:\\dev\\app')
  })
  it('translates an OSC 7 WSL mount to a drive path', () => {
    expect(new CwdParser().push(`${ESC}]7;file://host/mnt/c/work${BEL}`)).toBe('C:\\work')
  })
  it('returns null on plain output and ignores unrelated OSC sequences', () => {
    expect(new CwdParser().push('regular output\r\n')).toBeNull()
    expect(new CwdParser().push(`${ESC}]0;title${BEL}`)).toBeNull()
  })
})
