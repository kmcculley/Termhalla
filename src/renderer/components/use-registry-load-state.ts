// The ONE shared derivation of the registry snapshot's load state (feature 0009, FINDING-019 —
// REQ-015's reuse discipline). Loading is DERIVED, never stored (registry-slice.ts's rule):
// `registrySnapshot === null && registryError === null`; `failed` is its held-error twin. Every
// registry-snapshot consumer that needs the boundary states (DecisionQueuePanel, OrkyRootPicker)
// reads THIS hook instead of restating the rule, so a future change to what "loading" means edits
// exactly one place. (SplitMenu's compass button keeps an inline copy by design: its frozen
// loopback guard TEST-455 pins the literal derivation in that file.)
import { useShallow } from 'zustand/react/shallow'
import type { OrkyRegistrySnapshot } from '@shared/types'
import { useStore } from '../store'

export interface RegistryLoadState {
  registrySnapshot: OrkyRegistrySnapshot | null
  registryError: string | null
  /** No snapshot has settled and no error is held — the pre-first-push window. */
  loading: boolean
  /** No snapshot is held AND a specific error text is (surfaced verbatim, CONV-001). */
  failed: boolean
}

export function useRegistryLoadState(): RegistryLoadState {
  return useStore(useShallow(s => ({
    registrySnapshot: s.registrySnapshot,
    registryError: s.registryError,
    loading: s.registrySnapshot === null && s.registryError === null,
    failed: s.registrySnapshot === null && s.registryError !== null
  })))
}
