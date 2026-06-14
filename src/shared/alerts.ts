import type { AlertConfig, TerminalStatus } from './types'

export const DEFAULT_ALERTS: Required<AlertConfig> = {
  border: true, tabBadge: true, osNotification: true, needsInput: true
}

export function resolveAlerts(a: AlertConfig | undefined): Required<AlertConfig> {
  return { ...DEFAULT_ALERTS, ...(a ?? {}) }
}

/** Apply the per-terminal needs-input toggle: if detection is disabled for this
 *  terminal, present needs-input as busy so no alert channel reacts to it. */
export function effectiveStatus(status: TerminalStatus, alerts: AlertConfig | undefined): TerminalStatus {
  if (status.state === 'needs-input' && !resolveAlerts(alerts).needsInput) {
    return { ...status, state: 'busy' }
  }
  return status
}
