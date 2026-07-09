// The CONNECTED remote-workspace surface, end-to-end under production wiring. Every layer here
// (remote-slice → preload → register-remote → RemoteWorkspaceManager → connectWithProvisioning →
// fake-ssh shim → the REAL out/agent bundle → bridge → per-workspace daemon) is individually
// vitest-tested; this spec is the one place they compose in the actual app. The transport is
// `tests/fixtures/fake-ssh.mjs` (the same stand-in the vitest integration suites drive), injected
// through the env-gated `TERMHALLA_E2E_REMOTE_SSH` seam (src/main/e2e-remote.ts) with the fake
// pty backend FORCED — no network, no native pty, deterministic output.
//
// Until this spec existed, the only in-app remote e2e (remote-workspace.spec.ts) deliberately
// connected to an RFC 6761 `.invalid` host: the green path had never once run renderer→agent.
// Its first run caught two real composition bugs — the dev artifact path doubling to
// `out/main/out/agent` under an entry-file launch (services.ts devAppRoot), and the fake
// backend's parser missing the CR a real keyboard sends (fake-backend.ts) — exactly the seams
// only an in-app run exercises. Teardown order is load-bearing: see remote-harness.ts.
//
//   TEST-QA01 — the single-gesture remote workspace actually CONNECTS: the banner clears, the
//               fake backend's prompt renders in the pane, and the ledger shows the provision
//               really happened (upload + daemon-attach; the versioned artifact is on "the
//               remote").
//   TEST-QA02 — a live round-trip: `echo` output renders; `size` proves the spawn grid reached
//               the agent; the pane's status chip settles idle (agent-side status stack →
//               status domain → pane chip).
//   TEST-QA03 — the CONNECTED capability set still allows pty only (v1 agent advertises
//               pty+status): editor/explorer/orky stay greyed WITH a reason, terminal enabled —
//               same surface as the not-connected pin in remote-workspace.spec.ts, different
//               truth being pinned.
import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchWithShim, createRemoteWorkspace, closeRemoteApp } from './remote-harness'

test.describe.serial('connected remote workspace (fake-ssh transport)', () => {
  let app: ElectronApplication
  let win: Page
  let fakeHome: string

  test.beforeAll(async () => {
    const userData = mkdtempSync(join(tmpdir(), 'termh-remc-'))
    fakeHome = mkdtempSync(join(tmpdir(), 'termh-remc-home-'))
    app = await launchWithShim(userData, fakeHome)
    win = await app.firstWindow()
    await win.waitForSelector('[data-tab-id]')
  })

  test.afterAll(async () => {
    await closeRemoteApp(app, fakeHome)
  })

  test('TEST-QA01 the workspace connects: banner clears, prompt renders, provision is real', async () => {
    await createRemoteWorkspace(win, 'e2e-fake-agent')
    await expect(win.locator('[data-tab-id]')).toHaveCount(2)

    // Connected = the banner is GONE (remoteBannerModel returns null) and the fake backend's
    // prompt reached xterm through the whole stack. First connect provisions (absent → exit 127
    // → upload → relaunch), so give it the generous end of the budget.
    await expect(win.locator('.xterm-rows')).toContainText('fake$', { timeout: 45_000 })
    await expect(win.getByTestId('remote-banner')).toHaveCount(0)

    // The provision was real: the version-embedded artifact landed under the fake remote home…
    const agentDir = join(fakeHome, '.termhalla', 'agent')
    const installed = readdirSync(agentDir).filter(f => /^termhalla-agent-.+\.cjs$/.test(f))
    expect(installed, 'the versioned agent artifact must be installed on the fake remote').toHaveLength(1)
    // …and the ledger shows the daemon flow drove it: at least one upload and one daemon-attach
    // (production connects opt into the daemon flow), with the daemon actually spawned once.
    const ledger = readFileSync(join(fakeHome, 'ssh-ledger.jsonl'), 'utf8')
      .trim().split('\n').map(l => JSON.parse(l) as { kind: string })
    expect(ledger.some(e => e.kind === 'upload')).toBe(true)
    expect(ledger.some(e => e.kind === 'daemon-attach')).toBe(true)
    expect(ledger.filter(e => e.kind === 'daemon-spawn')).toHaveLength(1)
  })

  test('TEST-QA02 a live pty round-trip: echo renders, the grid reached the agent, status settles idle', async () => {
    await win.locator('.xterm-screen').click() // hidden mode: focus the terminal before typing
    await win.keyboard.type('echo hello-remote-7291')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText('hello-remote-7291', { timeout: 15_000 })

    // The spawn grid is the renderer's real cols×rows, not a default: the fake backend reports
    // whatever reached it through pty:spawn/resize.
    await win.keyboard.type('size')
    await win.keyboard.press('Enter')
    await expect(win.locator('.xterm-rows')).toContainText(/size=\d+x\d+/, { timeout: 15_000 })

    // Status detection happens AT THE SOURCE (the agent reuses src/main/status), rides the
    // status domain, and lands on the pane chip: after the commands complete the pane is idle.
    await expect(win.locator('[data-status="idle"]')).toHaveCount(1, { timeout: 15_000 })
  })

  test('TEST-QA03 the CONNECTED capability set is still pty-only (v1): kinds grey with a reason', async () => {
    const paneId = await win.locator('[data-testid^="close-"]').first()
      .getAttribute('data-testid').then(v => v!.replace('close-', ''))
    await win.getByTestId(`split-${paneId}`).click()
    await expect(win.getByTestId(`split-kind-terminal-${paneId}`)).toBeEnabled()
    for (const kind of ['editor', 'explorer', 'orky']) {
      const btn = win.getByTestId(`split-kind-${kind}-${paneId}`)
      await expect(btn, `${kind} must stay greyed while connected (v1 caps: pty+status)`).toBeDisabled()
      const title = (await btn.getAttribute('title')) ?? ''
      expect(title.length, `${kind} carries an actionable reason`).toBeGreaterThan(10)
    }
    await win.keyboard.press('Escape')
  })
})
