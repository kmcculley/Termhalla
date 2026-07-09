import { describe, it, expect } from 'vitest'
import { StatusTracker } from '../../src/main/status/status-tracker'
import { DEFAULT_NEEDS_INPUT_PATTERNS, type NeedsInputConfig } from '../../src/main/status/needs-input'

const cfg = (over: Partial<NeedsInputConfig> = {}): NeedsInputConfig => ({
  enabled: true, quietMs: 10000, patterns: DEFAULT_NEEDS_INPUT_PATTERNS,
  heuristicIdleMs: 1500, heuristicIdleHardMs: 5000, ...over
})

describe('StatusTracker (with integration markers)', () => {
  it('starts idle', () => {
    expect(new StatusTracker(0, cfg()).status().state).toBe('idle')
  })
  it('A -> idle, C -> busy, A -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onMarker('A', undefined, 1).state).toBe('idle')
    expect(t.onMarker('C', undefined, 2).state).toBe('busy')
    expect(t.onMarker('A', undefined, 3).state).toBe('idle')
  })
  it('D records lastExit applied at the next A', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 1)
    t.onMarker('D', 0, 2)
    expect(t.onMarker('A', undefined, 3)).toMatchObject({ state: 'idle', lastExit: 'success' })
    t.onMarker('C', undefined, 4)
    t.onMarker('D', 1, 5)
    expect(t.onMarker('A', undefined, 6)).toMatchObject({ state: 'idle', lastExit: 'failure' })
  })
  it('goes needs-input when busy, quiet past threshold, with a prompt tail; clears on new output', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(200).state).toBe('busy')
    expect(t.tick(11000).state).toBe('needs-input')
    expect(t.onOutput('y\r\n', 11500).state).toBe('busy')
  })
  it('ignores screen-redraw chunks: they do not reset the quiet timer or clear needs-input', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(11000).state).toBe('needs-input')
    // a PSReadLine-style repaint arrives — must NOT revert to busy nor reset quiet
    t.onOutput('\x1b[?25l\x1b[HOverwrite? [y/N] ', 11500)
    expect(t.tick(12000).state).toBe('needs-input')
  })
})

describe('StatusTracker (heuristic, no markers)', () => {
  it('output -> busy, then long quiet with prompt tail -> idle', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('compiling...', 0).state).toBe('busy')
    expect(t.tick(1000).state).toBe('busy')
    t.onOutput('\r\nPS C:\\> ', 1100)
    expect(t.tick(3000).state).toBe('idle')
  })

  it('goes idle after sustained silence even when the prompt is never recognized', () => {
    // Reproduces the cmd "stuck busy after Ctrl+C" bug: the return-to-prompt was
    // never captured into the tail, so looksLikePrompt stays false forever.
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('dir output, interrupted, no prompt char', 0).state).toBe('busy')
    expect(t.tick(2000).state).toBe('busy')   // quiet > heuristicIdleMs but no prompt, < hard threshold
    expect(t.tick(6000).state).toBe('idle')   // sustained silence past hard threshold -> idle (the fix)
  })

  it('does NOT hard-idle while a no-integration shell waits at an input prompt', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('Overwrite? [y/N] ', 0).state).toBe('busy')
    expect(t.tick(6000).state).toBe('busy')          // past hard threshold but tail is an input prompt -> stays busy
    expect(t.tick(11000).state).toBe('needs-input')  // then needs-input fires at quietMs >= quietMs
  })

  it('idles when integration markers stop and it sits silent at a prompt (nested shell)', () => {
    // pwsh (integrated) launched `cmd`: markers latched true, but cmd emits none.
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)                       // pwsh said busy (running `cmd`)
    t.onOutput('Microsoft Windows ...\r\nC:\\>', 100)   // nested cmd prompt; hasMarkers stays true
    expect(t.tick(2000).state).toBe('busy')             // < hard threshold -> still busy
    expect(t.tick(6000).state).toBe('idle')             // long silence at a prompt -> idle (the fix)
  })

  it('keeps a genuine integration command busy when its output is not a prompt', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)                  // busy via marker
    t.onOutput('still compiling...', 100)          // output, not a prompt
    expect(t.tick(8000).state).toBe('busy')        // silent but not a prompt -> stays busy (marker A will idle it)
  })

  it('a screen repaint does NOT resurrect busy on a marker-less pane (busy<->idle oscillation)', () => {
    // The busy<->idle loop reported on ssh/agent panes. A marker-less pane (an `ssh` launch gets no
    // shell-integration injection, and the remote agent injects none either, so hasMarkers stays
    // false forever) idles at its prompt; the idle pane chrome resizes the terminal by a hair, the
    // PTY is resized, and the shell answers with a full-screen repaint. That repaint must be inert:
    // it is `isPureControl`, so it never touched lastOutputAt — marking it busy would idle it again
    // on the very next tick, and around forever.
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('build finished\r\nuser@host:~$ ', 0).state).toBe('busy')
    expect(t.tick(6000).state).toBe('idle')        // sustained silence at a prompt -> idle
    // A SIGWINCH/ConPTY repaint: begins with cursor-home, so it is a redraw, not real output.
    expect(t.onOutput('\x1b[H\x1b[2Juser@host:~$ ', 6100).state).toBe('idle')
    expect(t.tick(6600).state).toBe('idle')        // and it stays idle — no oscillation
  })

  it('still marks a marker-less pane busy on REAL printable output', () => {
    // The guard above must not deafen the only signal a marker-less pane has.
    const t = new StatusTracker(0, cfg())
    expect(t.tick(6000).state).toBe('idle')
    expect(t.onOutput('npm run build\r\n', 6100).state).toBe('busy')
  })

  it('an AI session goes idle (awaiting) once quiet, despite markers + a non-shell-prompt tail', () => {
    // Reproduces "claude always shows active": the shell emits C when `claude` launches (busy,
    // hasMarkers) and won't emit D until claude exits; claude's TUI tail is not a shell prompt,
    // so the normal heuristic can never idle it. The AI-active signal fixes that.
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)                       // shell launched `claude` -> busy
    t.onOutput('Claude Code ready\r\n? for shortcuts', 100)
    expect(t.tick(6000).state).toBe('busy')             // without ai-active: stuck busy (the bug)
    t.setAiActive(true)
    expect(t.tick(7000).state).toBe('idle')             // ai-active + sustained silence -> idle (awaiting)
  })

  it('keeps an AI session BUSY while it shows "esc to interrupt", even when the quiet timer is silent', () => {
    // Reproduces "idle during the sleep": claude is working (blocked on a tool) and redraws its
    // working bar via cursor-home screen repaints, which are pure-control and do NOT update the
    // quiet timer. Silence alone would wrongly idle it; the working-indicator scan keeps it busy.
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.setAiActive(true)
    const workingRepaint = '\x1b[H working on it… esc to interrupt '  // starts with cursor-home -> pure control
    t.onOutput(workingRepaint, 1000)
    t.onOutput(workingRepaint, 4000)                    // bar re-rendered ~every few seconds
    t.onOutput(workingRepaint, 7000)
    // Real-output quiet timer says 9s of silence, but the working bar was seen 2s ago -> still busy.
    expect(t.tick(9000).state).toBe('busy')
    // Agent finishes and stops showing the bar; after the grace + silence it goes idle (awaiting).
    expect(t.tick(14000).state).toBe('idle')
  })

  it('an idle AI session returns to busy when the agent starts its next turn', () => {
    // The core "idle no matter what" bug: once the agent idles at its prompt, the launching shell
    // emits no new command-start marker for the next turn, so the agent's working output must be
    // what flips it back to busy.
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.setAiActive(true)
    t.onOutput('Welcome\r\n? for shortcuts', 100)        // ready prompt
    expect(t.tick(7000).state).toBe('idle')              // awaiting
    t.onOutput('\x1b[H thinking… esc to interrupt', 8000) // user submitted a task; agent works
    expect(t.status().state).toBe('busy')                // flips back to busy on the working indicator
    expect(t.tick(9000).state).toBe('busy')              // stays busy while working
  })
})
