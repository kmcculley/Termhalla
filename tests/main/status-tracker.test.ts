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
    // PTY is resized, and the shell answers with a full-screen repaint. That repaint must stay
    // state-inert: it is a repaint (`isRepaintChunk`; since 0025 its printable text IS admitted to
    // the tail), so it never touches lastOutputAt — marking it busy would idle it again on the
    // very next tick, and around forever.
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
    // working bar via cursor-home screen repaints, which are repaint chunks (`isRepaintChunk`;
    // since 0025 their text reaches the tail but NOT the quiet timer). Silence alone would
    // wrongly idle it; the working-indicator scan keeps it busy.
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.setAiActive(true)
    const workingRepaint = '\x1b[H working on it… esc to interrupt '  // starts with cursor-home -> a repaint chunk
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

// ── Feature 0025-cursor-home-output-suppression (baseline KNOWN BUG #4) ────────────────
// A repaint chunk (CURSOR_HOME_RE-prefixed) carrying printable text is now ADMITTED to the
// needs-input tail with the same append-and-cap discipline as real output (REQ-001), but it
// NEVER touches the quiet timer (REQ-002) and NEVER directly changes tracker state (REQ-003).
// This amends baseline REQ-007's tail-exclusion clause; the LOCKED 2026-07-08 decision
// ("a marker-less pane goes busy on real output only — never on a repaint") is preserved
// verbatim. The two pre-existing repaint pins ABOVE ("ignores screen-redraw chunks…" and
// "a screen repaint does NOT resurrect busy…") are REQ-003/REQ-008 acceptance criteria and
// MUST keep their assertion bodies unmodified (their explanatory comments carry the ESC-001
// comment-only vocabulary amendments — recorded in 02-spec.md REQ-003/REQ-008 and 04-tests.md).
describe('StatusTracker: repaint tail admission (0025)', () => {
  const SCREEN = 'App v2 — file sync\r\nfile-a.txt  4 KB\r\nfile-b.txt  9 KB'
  // One chunk: the TUI redraws the screen AND prints a fresh input prompt (spec REQ-001 shape).
  const REPAINT_WITH_PROMPT = '\x1b[?25l\x1b[H' + SCREEN + '\r\nOverwrite? [y/N] '
  const ERASE_TRAILERS = '\x1b[K\r\n\x1b[K\x1b[?25h'
  // ConPTY-style full repaint whose painted content ENDS at the prompt, with erase/cursor
  // trailers after it (spec REQ-006 shape).
  const paintedThroughPrompt = (home: string): string =>
    home + 'Term UI v3\r\nsyncing 4 files\r\nlast: file-b.txt\r\n' + 'Overwrite? [y/N] ' + ERASE_TRAILERS

  it('TEST-2501 REQ-001 a marker-driven busy pane reaches needs-input from a single repaint-with-prompt chunk', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput(REPAINT_WITH_PROMPT, 100)              // redraw + fresh prompt in ONE chunk
    // Pre-0025 this wedged 'busy' forever: the whole chunk was suppressed from the tail.
    expect(t.tick(10200).state).toBe('needs-input')
  })

  it('TEST-2502 REQ-001 a marker-less busy pane reaches needs-input from a single repaint-with-prompt chunk', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('compiling...', 0).state).toBe('busy')   // busy via prior REAL output
    t.onOutput(REPAINT_WITH_PROMPT, 100)
    expect(t.tick(10200).state).toBe('needs-input')
  })

  it('TEST-2503 REQ-002 a repaint does not restart the quiet window: needs-input is timed from the last REAL output', () => {
    const t = new StatusTracker(0, cfg())
    t.onOutput('compiling...', 0)                     // real output at t0
    t.onOutput(REPAINT_WITH_PROMPT, 9900)             // repaint at t0 + quietMs - 100
    expect(t.tick(9999).state).toBe('busy')           // < quietMs after the REAL output -> not yet
    // ≥ quietMs after the real output, only 100ms after the repaint: still fires — the
    // repaint did NOT update lastOutputAt.
    expect(t.tick(10000).state).toBe('needs-input')
  })

  it('TEST-2504 REQ-002 a repaint does not delay the sustained-silence idle flip (computeIdleFallback timing)', () => {
    const t = new StatusTracker(0, cfg())
    t.onOutput('compiling...', 0)                     // marker-less busy at t0
    t.onOutput('\x1b[Hredrawn frame', 4900)           // repaint at t0 + heuristicIdleHardMs - 100
    // Hard idle fires timed from t0 — the repaint 100ms ago did not push it back.
    expect(t.tick(5000).state).toBe('idle')
  })

  it('TEST-2505 REQ-003(a) an idle marker-less pane stays idle on a repaint carrying NEW printable non-prompt text', () => {
    // The locked 2026-07-08 decision, preserved verbatim: a repaint is never a busy signal —
    // even now that its printable text is admitted to the tail.
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('\x1b[Hfresh TUI frame content', 100).state).toBe('idle')
    expect(t.tick(600).state).toBe('idle')
    expect(t.tick(11000).state).toBe('idle')
  })

  it('TEST-2506 REQ-003(c) an idle pane stays idle even when the repainted last line is prompt-shaped', () => {
    // tick() computes needs-input only from 'busy'; the state machine is unchanged.
    const t = new StatusTracker(0, cfg())
    expect(t.onOutput('\x1b[HDelete file? ', 100).state).toBe('idle')
    expect(t.tick(11000).state).toBe('idle')
    expect(t.tick(30000).state).toBe('idle')
  })

  it('TEST-2507 REQ-003(b) needs-input holds under a repaint carrying DIFFERENT printable text (reset stays exclusive to real output)', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(11000).state).toBe('needs-input')
    // Admitting the repaint's text must NOT ride the real-output needs-input->busy reset.
    expect(t.onOutput('\x1b[?25l\x1b[Ha completely different painted frame', 11500).state).toBe('needs-input')
    expect(t.tick(12000).state).toBe('needs-input')
  })

  it('TEST-2508 REQ-005 chunks without printable content stay fully inert (ANSI-only, whitespace-only, home-prefixed control)', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)              // real output: prompt in tail, timer at t=100
    t.onOutput('\x1b[2J', 9000)                        // ANSI-only
    t.onOutput('   \r\n', 9500)                        // whitespace-only
    t.onOutput('\x1b[H\x1b[K\r\n', 10000)              // repaint whose stripped content is only ws/control
    // If ANY of the three had updated the timer, quiet at 10150 would be ≤ 1150 and this
    // would read busy forever; firing on the ORIGINAL schedule with the ORIGINAL prompt
    // proves tail + timer + state were all untouched (CONV-003: no silent divergence
    // between home-prefixed and non-home-prefixed no-printable chunks).
    expect(t.tick(10050).state).toBe('busy')           // 9950ms quiet — still inside the window
    expect(t.tick(10150).state).toBe('needs-input')    // fires timed from the real output
  })

  it('TEST-2509 REQ-006 ConPTY repaint ending at the prompt (\\x1b[?25l\\x1b[1;1H form) neither evicts the prompt nor wedges busy', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)               // prompt already in the tail via real output
    t.onOutput(paintedThroughPrompt('\x1b[?25l\x1b[1;1H'), 500)
    // The erase-line/newline trailers after the painted prompt are skipped by lastLine's
    // trailing-blank skip; 'needs-input' still fires — regression (a) stays closed.
    expect(t.tick(10200).state).toBe('needs-input')
  })

  it('TEST-2510 REQ-006 the same prompt-terminal repaint delivered while already needs-input holds the state', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(11000).state).toBe('needs-input')
    expect(t.onOutput(paintedThroughPrompt('\x1b[?25l\x1b[1;1H'), 11200).state).toBe('needs-input')
    expect(t.tick(12000).state).toBe('needs-input')
  })

  it('TEST-2511 REQ-006 the bare \\x1b[H home form passes identically', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    t.onOutput(paintedThroughPrompt('\x1b[H'), 500)
    expect(t.tick(10200).state).toBe('needs-input')
  })

  it('TEST-2512 REQ-006 stacked cursor show/hide prefixes (\\x1b[?25l\\x1b[?25h\\x1b[H) pass identically', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    t.onOutput(paintedThroughPrompt('\x1b[?25l\x1b[?25h\x1b[H'), 500)
    expect(t.tick(10200).state).toBe('needs-input')
  })

  // REQ-007 — CHOSEN behavior (concept D2, full admission; human-resolved OQ2): a repaint
  // that paints content BELOW the prompt makes the painted last non-blank line the tail's
  // lastLine; when that line is not prompt-shaped, needs-input does not fire from that tail,
  // and a large repaint can displace an earlier prompt out of the 400-char window (CONV-003:
  // the cap is the only truncation). These two characterization pins are the recorded
  // residual risk of D2 and the REVISIT TRIGGER for the rejected prompt-gated-admission
  // alternative — if this trade stops being acceptable, revisit concept OQ2/OQ4.
  it('TEST-2513 REQ-007 painting below the prompt displaces it: the non-prompt painted last line wins and the pane stays busy', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    t.onOutput('\x1b[Hheader\r\nOverwrite? [y/N] \r\nlog line 1\r\nlog line 2\r\nstatus: running', 500)
    expect(t.tick(10200).state).toBe('busy')           // no needs-input from the displaced prompt
  })

  it('TEST-2514 REQ-007 the 400-char tail cap applies to repaint-admitted text (a large paint evicts an earlier prompt)', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('building step 1', 100)
    // 460 printable chars in one repaint, prompt-shaped text at the FRONT: with the
    // slice(-400) cap the '?' is evicted and the remaining tail matches no pattern -> busy.
    // WITHOUT the cap the single line would still end '?<spaces>' and /\?\s*$/ would
    // wrongly fire needs-input — this pin is what makes the cap observable.
    t.onOutput('\x1b[H' + 'Continue? ' + ' '.repeat(450), 500)
    expect(t.tick(10200).state).toBe('busy')
  })

  it('TEST-2515 REQ-004 real output still updates the quiet timer, appends the tail, and resets needs-input -> busy', () => {
    const t = new StatusTracker(0, cfg())
    t.onMarker('C', undefined, 0)
    t.onOutput('Overwrite? [y/N] ', 100)
    expect(t.tick(10200).state).toBe('needs-input')
    // Real output: the ONLY thing that resets needs-input -> busy…
    expect(t.onOutput('y\r\nOverwrite second file? ', 10300).state).toBe('busy')
    // …and it RESTARTED the quiet window (4700ms quiet at 15000 -> still busy)…
    expect(t.tick(15000).state).toBe('busy')
    // …and its text was appended: the NEW prompt is the tail that fires next.
    expect(t.tick(20400).state).toBe('needs-input')
  })

  it('TEST-2516 REQ-004 real printable output still marks a marker-less pane busy', () => {
    const t = new StatusTracker(0, cfg())
    expect(t.tick(6000).state).toBe('idle')
    expect(t.onOutput('npm run build\r\n', 6100).state).toBe('busy')
  })
})
