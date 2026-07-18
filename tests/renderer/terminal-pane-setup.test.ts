import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setupAutoResume, setupAltScreenRepaint, setupVisualBell,
  RESUME_QUIET_MS, ALT_SCREEN_REFRESH_MS, BELL_FLASH_MS,
  type AltScreenTerm
} from '../../src/renderer/components/terminal-pane-setup'

/** Contracts of the trickiest concerns extracted from TerminalPane's mount effect (quality audit
 *  2026-07-17, finding 8 — a mechanical extraction, so these pin CURRENT behavior). All side
 *  effects are injected (the redraw.ts / grid-sync.ts convention), so the timers run against
 *  vitest's fake clock. */

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('setupAutoResume (the output-quiet resume timer)', () => {
  it('armed true with quiet output: types the resume command once after RESUME_QUIET_MS', () => {
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.arm(true)
    vi.advanceTimersByTime(RESUME_QUIET_MS - 1)
    expect(typeResume).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(typeResume).toHaveBeenCalledTimes(1)
  })

  it('each data chunk re-arms the quiet window (fires only after output goes quiet)', () => {
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.arm(true)
    vi.advanceTimersByTime(RESUME_QUIET_MS - 100)
    r.onData()                                       // prompt bytes land — reset the window
    vi.advanceTimersByTime(RESUME_QUIET_MS - 100)
    expect(typeResume).not.toHaveBeenCalled()        // still inside the re-armed window
    vi.advanceTimersByTime(100)
    expect(typeResume).toHaveBeenCalledTimes(1)
  })

  it('fires at most once — later output never types the command again', () => {
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.arm(true)
    vi.advanceTimersByTime(RESUME_QUIET_MS)
    r.onData()                                       // Claude's own output after the resume
    vi.advanceTimersByTime(RESUME_QUIET_MS * 5)
    expect(typeResume).toHaveBeenCalledTimes(1)
  })

  it('data before the spawn resolves no-ops; the arm(true) kick starts the quiet window', () => {
    // The spawn promise resolves late: chunks arriving meanwhile must schedule nothing (the armed
    // flag is still false), and the kick at resolution starts the timer fresh.
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.onData()
    vi.advanceTimersByTime(RESUME_QUIET_MS * 5)
    expect(typeResume).not.toHaveBeenCalled()
    r.arm(true)
    vi.advanceTimersByTime(RESUME_QUIET_MS)
    expect(typeResume).toHaveBeenCalledTimes(1)
  })

  it('armed false (setting off / re-adopted live PTY) never fires, however much data arrives', () => {
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.arm(false)
    r.onData(); vi.advanceTimersByTime(RESUME_QUIET_MS * 5); r.onData()
    vi.advanceTimersByTime(RESUME_QUIET_MS * 5)
    expect(typeResume).not.toHaveBeenCalled()
  })

  it('dispose cancels a pending resume (unmount mid-window must not type into a dead pane)', () => {
    const typeResume = vi.fn()
    const r = setupAutoResume({ typeResume })
    r.arm(true)
    r.dispose()
    vi.advanceTimersByTime(RESUME_QUIET_MS * 5)
    expect(typeResume).not.toHaveBeenCalled()
  })
})

/** A fake terminal exposing just the alt-screen surface ({@link AltScreenTerm}). */
function fakeAltTerm() {
  let bufferCb: ((b: { type: string }) => void) | undefined
  let writeCb: (() => void) | undefined
  const disposed = { buffer: false, write: false }
  const term: AltScreenTerm = {
    buffer: { onBufferChange: (cb) => { bufferCb = cb; return { dispose: () => { disposed.buffer = true } } } },
    onWriteParsed: (cb) => { writeCb = cb; return { dispose: () => { disposed.write = true } } }
  }
  return {
    term,
    enterAlt: () => bufferCb!({ type: 'alternate' }),
    exitAlt: () => bufferCb!({ type: 'normal' }),
    writeParsed: () => writeCb!(),
    disposed
  }
}

describe('setupAltScreenRepaint (the one-shot alt-screen repaint debounce)', () => {
  it('entering the alternate buffer repaints once after ALT_SCREEN_REFRESH_MS of parse quiet', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt()
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS - 1)
    expect(repaint).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(repaint).toHaveBeenCalledTimes(1)
  })

  it('parsed writes while pending debounce the one-shot until output quiets', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt()
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS - 50)
    t.writeParsed()                                  // the TUI is still drawing its first frame
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS - 50)
    expect(repaint).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(repaint).toHaveBeenCalledTimes(1)
  })

  it('is a one-shot: parsed writes after the repaint schedule nothing (harmless no-op otherwise)', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt()
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS)
    t.writeParsed()
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS * 5)
    expect(repaint).toHaveBeenCalledTimes(1)
  })

  it('returning to the normal buffer cancels a pending repaint', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt()
    t.exitAlt()                                      // the TUI quit before the settle window closed
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS * 5)
    expect(repaint).not.toHaveBeenCalled()
  })

  it('re-arms on each alt entry (detach/reattach, another TUI)', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt(); vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS)
    t.exitAlt()
    t.enterAlt(); vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS)
    expect(repaint).toHaveBeenCalledTimes(2)
  })

  it('dispose cancels a pending repaint and unsubscribes both parser hooks', () => {
    const repaint = vi.fn()
    const t = fakeAltTerm()
    const dispose = setupAltScreenRepaint(t.term, { repaint })
    t.enterAlt()
    dispose()
    vi.advanceTimersByTime(ALT_SCREEN_REFRESH_MS * 5)
    expect(repaint).not.toHaveBeenCalled()
    expect(t.disposed).toEqual({ buffer: true, write: true })
  })
})

describe('setupVisualBell (the paint-only bell flash)', () => {
  it('BEL flashes on, then off after BELL_FLASH_MS', () => {
    const setBell = vi.fn()
    let bellCb: (() => void) | undefined
    setupVisualBell({ onBell: (cb) => { bellCb = cb; return { dispose: () => {} } } }, { setBell })
    bellCb!()
    expect(setBell).toHaveBeenLastCalledWith(true)
    vi.advanceTimersByTime(BELL_FLASH_MS)
    expect(setBell).toHaveBeenLastCalledWith(false)
  })

  it('rapid BELs extend the flash (one off at the end, not one per bell)', () => {
    const setBell = vi.fn()
    let bellCb: (() => void) | undefined
    setupVisualBell({ onBell: (cb) => { bellCb = cb; return { dispose: () => {} } } }, { setBell })
    bellCb!()
    vi.advanceTimersByTime(BELL_FLASH_MS - 50)
    bellCb!()                                        // second bell inside the flash window
    vi.advanceTimersByTime(BELL_FLASH_MS - 50)
    expect(setBell.mock.calls.filter(c => c[0] === false)).toHaveLength(0)
    vi.advanceTimersByTime(50)
    expect(setBell.mock.calls.filter(c => c[0] === false)).toHaveLength(1)
  })

  it('dispose cancels a pending off and unsubscribes onBell', () => {
    const setBell = vi.fn()
    let bellCb: (() => void) | undefined
    let unsubscribed = false
    const dispose = setupVisualBell(
      { onBell: (cb) => { bellCb = cb; return { dispose: () => { unsubscribed = true } } } }, { setBell }
    )
    bellCb!()
    dispose()
    vi.advanceTimersByTime(BELL_FLASH_MS * 5)
    expect(setBell.mock.calls.filter(c => c[0] === false)).toHaveLength(0)
    expect(unsubscribed).toBe(true)
  })
})
