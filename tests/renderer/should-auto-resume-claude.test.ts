import { describe, it, expect } from 'vitest'
import { shouldAutoResumeClaude } from '../../src/renderer/store/pane-ops'

/** Auto-resume must fire ONLY on a genuinely fresh shell spawn (app start / new terminal restoring a
 *  persisted Claude pane), NEVER when a still-running PTY is re-adopted — minimize/restore, a
 *  same-window cross-workspace move, or a multi-window handoff. In a re-adoption Claude is already
 *  running, so typing `claude --resume` lands as a prompt into the live agent (the reported bug).
 *  There are TWO independent re-adoption signals and either alone must veto the resume:
 *  - `adoptedLivePty`: main's authoritative answer from the idempotent `pty:spawn` (`pty.has`). This
 *    is the ONLY signal that exists in the destination window of a multi-window undock/re-dock — the
 *    scrollback snapshot rides main's transit buffer there and arrives as `pty:data`, so the renderer
 *    stash is empty.
 *  - `consumedSnapshot`: a renderer-stashed scrollback snapshot was consumed on this mount
 *    (same-window move / minimize-restore; also the pty-died-while-stashed edge, where we keep the
 *    historical don't-resume behavior). */
describe('shouldAutoResumeClaude', () => {
  it('resumes on a fresh spawn of a pane that had Claude (the legit restore path)', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, adoptedLivePty: false, consumedSnapshot: false })).toBe(true)
  })

  it('does NOT resume when main adopted a live PTY with no local snapshot — the undock handoff bug', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, adoptedLivePty: true, consumedSnapshot: false })).toBe(false)
  })

  it('does NOT resume when a stashed snapshot was consumed (same-window move / minimize-restore)', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, adoptedLivePty: false, consumedSnapshot: true })).toBe(false)
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, adoptedLivePty: true, consumedSnapshot: true })).toBe(false)
  })

  it('does NOT resume when the setting is off', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: false, adoptedLivePty: false, consumedSnapshot: false })).toBe(false)
  })

  it('does NOT resume a pane that was not running Claude', () => {
    expect(shouldAutoResumeClaude({ resumeAi: undefined, autoResumeEnabled: true, adoptedLivePty: false, consumedSnapshot: false })).toBe(false)
    expect(shouldAutoResumeClaude({ resumeAi: 'codex', autoResumeEnabled: true, adoptedLivePty: false, consumedSnapshot: false })).toBe(false)
  })
})
