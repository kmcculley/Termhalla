import { describe, it, expect } from 'vitest'
import { CH } from '@shared/ipc-contract'

/**
 * Feature 0001 — REQ-003 (unit, channel declaration half).
 * The `menu:open-settings` push channel must be declared in the shared contract so neither
 * main nor preload nor renderer references an undeclared channel. The renderer subscription
 * shape (`onOpenSettings`) and its unsubscribe are exercised by `npm run typecheck` and the
 * App.tsx cleanup set (e2e), per REQ-003.
 *
 * RED until TASK-001 adds `CH.openSettings`.
 */
describe('ipc-contract — menu:open-settings channel', () => {
  it('TEST-003: declares CH.openSettings as the literal main->renderer channel name', () => {
    expect((CH as Record<string, string>).openSettings).toBe('menu:open-settings')
  })
})
