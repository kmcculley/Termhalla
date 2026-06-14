import type { TermhallaApi } from '@shared/ipc-contract'

declare global {
  interface Window { termhalla: TermhallaApi }
}
export const api: TermhallaApi = window.termhalla
