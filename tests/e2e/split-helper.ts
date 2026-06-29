// Shared helper for the feature-0002 split contract (REQ-003..REQ-007, REQ-013).
// The pane toolbar has ONE split button (`split-${paneId}`) that opens a combined popover
// (`split-menu`); the split is committed by selecting a kind (`split-kind-*`, Terminal by default)
// and then activating a direction target (`split-dir-*`). The old `split-col-`/`split-row-` toolbar
// buttons and the immediately-committing `split-terminal-`/`split-editor-`/`split-explorer-` kind
// buttons are gone. Specs that only need a SECOND terminal pane (the old two-click flow) use this.
import { expect, Page } from '@playwright/test'

/**
 * Open the first pane's split popover and commit a Terminal split to the right (new contract).
 * Mirrors the frozen split-compass / split-menu interaction: open `split-${id}` → `split-menu`
 * visible → select Terminal kind (default, clicked explicitly) → activate `split-dir-right-${id}`,
 * which commits and closes the popover. Uses prefix locators so callers need no paneId.
 */
export async function splitSecondTerminal(win: Page): Promise<void> {
  // The toolbar split button is the only `split-`-prefixed element before the popover opens.
  await win.locator('[data-testid^="split-"]').first().click()
  await expect(win.getByTestId('split-menu')).toBeVisible()
  // Terminal is the default kind; click it explicitly to be robust, then activate a direction.
  await win.locator('[data-testid^="split-kind-terminal-"]').first().click()
  await win.locator('[data-testid^="split-dir-right-"]').first().click()
  await expect(win.getByTestId('split-menu')).toHaveCount(0)
}
