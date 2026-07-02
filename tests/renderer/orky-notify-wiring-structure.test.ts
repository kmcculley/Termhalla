// FROZEN structural suite — feature 0013-os-needs-you-notifications (phase 4 / TASK-007..TASK-010,
// TASK-012). The composition-root observer wiring, the production Notification/click sink, the
// strictly-read-only scope guards, the app-wide opt-in UI + slice setter, and the renderer
// orkyNotify:focus handler cannot be mounted in the node-env vitest gate (no jsdom; register.ts pulls
// in Electron + the whole service graph). Per the repo precedent (tests/renderer/app-queue-wiring.test.ts,
// TEST-414), these are pinned by structural source scans over greppable literals the implementer MUST
// keep. Behavioral coverage of the observer itself lives in tests/main/orky-needs-you-notifier.test.ts
// and the live-refresh seam in tests/main/orky-needs-you-mirror.test.ts.
//
// Runs RED today: none of the wiring/source literals exist yet, and src/main/orky/orky-needs-you-notifier.ts
// is not created.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')
const OBSERVER = 'src/main/orky/orky-needs-you-notifier.ts'
const REGISTER = 'src/main/ipc/register.ts'

describe('composition-root wiring — observer over the aggregate (REQ-001)', () => {
  it('TEST-564 REQ-001 register.ts constructs OrkyNeedsYouNotifier, subscribes orkyRegistry.onSnapshot (a SECOND subscription), and registers its dispose in the disposer set', () => {
    const src = read(REGISTER)
    expect(src).toContain('OrkyNeedsYouNotifier')
    expect(src).toMatch(/orkyRegistry\.onSnapshot\s*\(/)   // the second independent subscription (no new engine consumer)
    expect(src).toMatch(/\.dispose\(\)/)                   // teardown wired into the existing disposers array
  })

  it('TEST-567 REQ-006 REQ-007 the production sink is defined at the composition root: Notification + main-window bring-forward + send(CH.orkyNotifyFocus) on click', () => {
    const src = read(REGISTER)
    expect(src).toContain('Notification')
    expect(src).toMatch(/CH\.orkyNotifyFocus/)
    expect(src).toMatch(/mainWindow\(\)/)   // wm.mainWindow().show()/focus() — the register-pty click pattern
  })
})

describe('strictly read-only scope guards (REQ-008)', () => {
  it('TEST-565 REQ-001 REQ-008 the observer module performs NO .orky filesystem read (no node:fs import, no readFile/readdir, the aggregate is the sole source)', () => {
    const src = read(OBSERVER)
    expect(src).not.toMatch(/from\s*['"]node:fs(\/promises)?['"]/)
    expect(src).not.toMatch(/\breadFile\b|\breaddir\b|\breadFileSync\b/)
    expect(src).not.toContain('.orky')
  })

  it('TEST-566 REQ-008 the observer module invokes no CLI, no orkyAction, and no registry mutation surface', () => {
    const src = read(OBSERVER)
    expect(src).not.toMatch(/child_process|execFile|spawn\(/)
    expect(src).not.toContain('orkyAction')
    expect(src).not.toMatch(/registryAddRoot|registryRemoveRoot|addRoot\(|removeRoot\(/)
  })
})

describe('app-wide opt-in UI + slice (REQ-005)', () => {
  it('TEST-568 REQ-005 GeneralSettings.tsx renders the opt-in checkbox with the default-ENABLED `!== false` idiom, wired to the new setter', () => {
    const src = read('src/renderer/components/GeneralSettings.tsx')
    expect(src).toContain('data-testid="orky-needs-you-notifications"')
    expect(src).toMatch(/orkyNeedsYouNotifications\s*!==\s*false/)   // default-on comparison, not a raw boolean
    expect(src).toContain('setOrkyNeedsYouNotifications')
  })

  it('TEST-569 REQ-005 quick-slice.ts adds setOrkyNeedsYouNotifications (scheduleQuickSave) and lists it in the slice Pick union', () => {
    const src = read('src/renderer/store/quick-slice.ts')
    expect(src).toMatch(/setOrkyNeedsYouNotifications:\s*\(on\)\s*=>/)
    expect(src).toMatch(/orkyNeedsYouNotifications:\s*on/)
    expect(src).toContain("'setOrkyNeedsYouNotifications'")   // the QuickSlice Pick<State, …> union entry
    // the setter schedules a persist (mirrors setToastsEnabled)
    expect(src).toMatch(/setOrkyNeedsYouNotifications[\s\S]{0,120}scheduleQuickSave\(\)/)
  })
})

describe('renderer orkyNotify:focus handler — reveal / drawer (REQ-006/REQ-007)', () => {
  it('TEST-570 REQ-006 REQ-007 App.tsx subscribes onOrkyNotifyFocus and routes to the reused pane matcher or the drawer reveal, dispatching NO action/registry mutation', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('onOrkyNotifyFocus')
    expect(app).toContain('setQueueOpen')            // the pane-less / no-match drawer reveal (REQ-007)
    // the handler is a read-side handoff only — it never mutates .orky or the registry
    expect(app).not.toContain('orkyAction')
    expect(app).not.toMatch(/registryAddRoot|registryRemoveRoot/)
    // the drawer reveal scrolls to the target project group; the F6 group testid is reused
    const revealSrc = app + read('src/renderer/components/DecisionQueuePanel.tsx')
    expect(revealSrc).toMatch(/scrollIntoView|decision-queue-group-/)
  })
})
