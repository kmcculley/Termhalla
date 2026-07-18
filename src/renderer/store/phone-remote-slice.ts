/**
 * The phone-remote renderer slice (feature 0026, REQ-002/REQ-007/REQ-020): settings/status state
 * for the desktop Settings UI, wrapping the `phoneRemote:*` IPC. The preload bridge is INJECTED
 * (the repo's `op.ts` / `remote-slice.ts` pattern) — this module never imports `../api`, so it
 * stays unit-testable under the node harness.
 *
 * Enable-failure errors ride the `pushToast` chokepoint with the 'error' severity, which bypasses
 * the `quick.toastsEnabled` opt-in (CONV-004) — a failed server start must never go unseen.
 */
import type { PhoneRemoteStatus } from '@shared/phone-remote/status'

export interface PhoneRemoteSliceDeps {
  set: (patch: object | ((s: PhoneRemoteSliceState) => object)) => void
  get: () => PhoneRemoteSliceState
  phoneRemoteStatus: () => Promise<PhoneRemoteStatus>
  phoneRemoteSetEnabled: (enabled: boolean) => Promise<PhoneRemoteStatus>
  phoneRemoteSetBind: (mode: 'localhost' | 'lan') => Promise<PhoneRemoteStatus>
  phoneRemoteSetPort: (port: number) => Promise<PhoneRemoteStatus>
  phoneRemoteRegenerateToken: () => Promise<{ pairingUrl: string }>
  pushToast: (text: string, kind: 'info' | 'success' | 'error') => void
}

export interface PhoneRemoteSliceState {
  phoneRemoteStatus: PhoneRemoteStatus | null
  /** The plaintext pairing URL — main-process-session-only (REQ-004); never persisted, cleared on
   *  any status refresh that reports a fresh (non-regenerated) session. */
  phoneRemotePairingUrl: string | null
}

export interface PhoneRemoteSlice {
  ingestPhoneRemoteStatus(status: PhoneRemoteStatus): void
  seedPhoneRemoteStatus(): Promise<void>
  setPhoneRemoteEnabled(enabled: boolean): Promise<void>
  setPhoneRemoteBind(mode: 'localhost' | 'lan'): Promise<void>
  setPhoneRemotePort(port: number): Promise<void>
  regeneratePhoneRemoteToken(): Promise<void>
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

export function createPhoneRemoteSlice(deps: PhoneRemoteSliceDeps): PhoneRemoteSlice {
  const { set } = deps

  const applyStatus = (status: PhoneRemoteStatus): void => {
    // A fresh, error-free status push from a real enable/regenerate cycle bumps the toast; an
    // enable FAILURE (status.error set) is the one case that must surface even though
    // `quick.toastsEnabled` may be off.
    if (status.error) deps.pushToast(status.error, 'error')
    set({ phoneRemoteStatus: status })
  }

  return {
    ingestPhoneRemoteStatus: (status) => { applyStatus(status) },

    seedPhoneRemoteStatus: async () => {
      try {
        const status = await deps.phoneRemoteStatus()
        set({ phoneRemoteStatus: status })
      } catch (e) {
        deps.pushToast(`Phone remote status could not be read: ${msg(e)}`, 'error')
      }
    },

    setPhoneRemoteEnabled: async (enabled) => {
      try {
        const status = await deps.phoneRemoteSetEnabled(enabled)
        applyStatus(status)
      } catch (e) {
        deps.pushToast(`Phone remote could not be ${enabled ? 'enabled' : 'disabled'}: ${msg(e)}`, 'error')
      }
    },

    setPhoneRemoteBind: async (mode) => {
      try {
        const status = await deps.phoneRemoteSetBind(mode)
        applyStatus(status)
      } catch (e) {
        deps.pushToast(`Phone remote bind mode could not be changed: ${msg(e)}`, 'error')
      }
    },

    setPhoneRemotePort: async (port) => {
      try {
        const status = await deps.phoneRemoteSetPort(port)
        applyStatus(status)
      } catch (e) {
        deps.pushToast(`Phone remote port could not be changed: ${msg(e)}`, 'error')
      }
    },

    regeneratePhoneRemoteToken: async () => {
      try {
        const { pairingUrl } = await deps.phoneRemoteRegenerateToken()
        set({ phoneRemotePairingUrl: pairingUrl })
        const status = await deps.phoneRemoteStatus()
        set({ phoneRemoteStatus: status })
      } catch (e) {
        deps.pushToast(`Regenerating the pairing token failed: ${msg(e)}`, 'error')
      }
    }
  }
}
