import type { AlertConfig } from './types'

export const DEFAULT_ALERTS: Required<AlertConfig> = {
  border: true, tabBadge: true, osNotification: true, needsInput: true
}

export function resolveAlerts(a: AlertConfig | undefined): Required<AlertConfig> {
  return { ...DEFAULT_ALERTS, ...(a ?? {}) }
}
