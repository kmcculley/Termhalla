import { describe, it, expect } from 'vitest'
import { shouldAutoResumeClaude } from '../../src/renderer/store/pane-ops'

/** Auto-resume must fire ONLY on a genuinely fresh shell spawn (app start / new terminal restoring a
 *  persisted Claude pane), NEVER when a still-running PTY is re-adopted — minimize/restore, a
 *  same-window cross-workspace move, or a multi-window handoff. In a re-adoption Claude is already
 *  running, so typing `claude --resume` lands as a prompt into the live agent (the reported bug). The
 *  renderer signals a re-adoption by consuming a stashed scrollback snapshot, surfaced here as
 *  `isReadoption`. */
describe('shouldAutoResumeClaude', () => {
  it('resumes on a fresh spawn of a pane that had Claude (the legit restore path)', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, isReadoption: false })).toBe(true)
  })

  it('does NOT resume when re-adopting a live PTY (minimize/restore/move) — the bug', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: true, isReadoption: true })).toBe(false)
  })

  it('does NOT resume when the setting is off', () => {
    expect(shouldAutoResumeClaude({ resumeAi: 'claude', autoResumeEnabled: false, isReadoption: false })).toBe(false)
  })

  it('does NOT resume a pane that was not running Claude', () => {
    expect(shouldAutoResumeClaude({ resumeAi: undefined, autoResumeEnabled: true, isReadoption: false })).toBe(false)
    expect(shouldAutoResumeClaude({ resumeAi: 'codex', autoResumeEnabled: true, isReadoption: false })).toBe(false)
  })
})
