/**
 * The phone-remote renderer slice (feature 0026, REQ-002/REQ-007/REQ-020/REQ-031): settings/status
 * state for the desktop Settings UI, wrapping the `phoneRemote:*` IPC. The preload bridge is
 * INJECTED (the repo's `op.ts` / `remote-slice.ts` pattern) — this module never imports `../api`,
 * so it stays unit-testable under the node harness.
 *
 * Enable-failure errors ride the `pushToast` chokepoint with the 'error' severity, which bypasses
 * the `quick.toastsEnabled` opt-in (CONV-004) — a failed server start must never go unseen. v2
 * (ESC-001): the APP-WIDE `phoneRemote:error` push (consumed at `App.tsx`, independent of whether
 * this Settings surface is even mounted) is the primary path (FINDING-034); this slice's own
 * `applyStatus`-driven toast stays as a belt-and-suspenders local echo while Settings IS open.
 * `pairingUrl()` re-fetches the current session's pairing URL WITHOUT ever calling
 * `regenerateToken` — reopening Settings (or a second device pairing an hour later) must never
 * force a revoking regenerate of an already-paired phone (REQ-007).
 */
import type { PhoneRemoteStatus } from '@shared/phone-remote/status'

export interface PhoneRemoteSliceDeps {
  set: (patch: object | ((s: PhoneRemoteSliceState) => object)) => void
  get: () => PhoneRemoteSliceState
  phoneRemoteStatus: () => Promise<PhoneRemoteStatus>
  phoneRemoteSetEnabled: (enabled: boolean) => Promise<PhoneRemoteStatus>
  phoneRemoteSetBind: (mode: 'localhost' | 'lan') => Promise<PhoneRemoteStatus>
  phoneRemoteSetPort: (port: number) => Promise<PhoneRemoteStatus>
  phoneRemoteSetExternalHost: (host: string | undefined) => Promise<PhoneRemoteStatus>
  phoneRemoteRegenerateToken: () => Promise<{ pairingUrl: string }>
  phoneRemotePairingUrl: () => Promise<{ pairingUrl: string } | { unavailable: true }>
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
  setPhoneRemoteExternalHost(host: string | undefined): Promise<void>
  regeneratePhoneRemoteToken(): Promise<void>
  /** Re-fetch (never regenerate) the pairing URL for the CURRENT session — call on mount so
   *  reopening Settings re-renders the QR without forcing a revoking regenerate (REQ-007). */
  refreshPhoneRemotePairingUrl(): Promise<void>
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
    ingestPhoneRemoteStatus: (status) => {
      applyStatus(status)
      // FINDING-110: another window regenerated the token — the broadcast carries only a
      // secret-free `pairingUrlChanged` signal (never the URL/token itself), so re-PULL the
      // pairing URL; the cached one would keep rendering a revoked QR. `unavailable` clears it.
      if (status.pairingUrlChanged) {
        void deps.phoneRemotePairingUrl()
          .then((out) => set({ phoneRemotePairingUrl: 'pairingUrl' in out ? out.pairingUrl : null }))
          .catch(() => { /* a transport failure here degrades exactly like refreshPhoneRemotePairingUrl */ })
      }
    },

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
        // FINDING-108: the advertised pairing-URL host just changed with the bind mode —
        // re-derive it exactly as setPhoneRemoteExternalHost does (never a regenerate).
        const out = await deps.phoneRemotePairingUrl()
        if ('pairingUrl' in out) set({ phoneRemotePairingUrl: out.pairingUrl })
      } catch (e) {
        deps.pushToast(`Phone remote bind mode could not be changed: ${msg(e)}`, 'error')
      }
    },

    setPhoneRemotePort: async (port) => {
      try {
        const status = await deps.phoneRemoteSetPort(port)
        applyStatus(status)
        // FINDING-108: the advertised pairing-URL port just changed — re-derive it exactly as
        // setPhoneRemoteExternalHost does (never a regenerate).
        const out = await deps.phoneRemotePairingUrl()
        if ('pairingUrl' in out) set({ phoneRemotePairingUrl: out.pairingUrl })
      } catch (e) {
        deps.pushToast(`Phone remote port could not be changed: ${msg(e)}`, 'error')
      }
    },

    setPhoneRemoteExternalHost: async (host) => {
      try {
        const status = await deps.phoneRemoteSetExternalHost(host)
        applyStatus(status)
        // The advertised pairing-URL host just changed — re-derive it (never a regenerate).
        const out = await deps.phoneRemotePairingUrl()
        if ('pairingUrl' in out) set({ phoneRemotePairingUrl: out.pairingUrl })
      } catch (e) {
        deps.pushToast(`Phone remote external host could not be changed: ${msg(e)}`, 'error')
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
    },

    refreshPhoneRemotePairingUrl: async () => {
      try {
        const out = await deps.phoneRemotePairingUrl()
        set({ phoneRemotePairingUrl: 'pairingUrl' in out ? out.pairingUrl : null })
      } catch {
        // A restart with no session plaintext is the expected `{ unavailable: true }` case — the
        // UI degrades to offering Regenerate; a transport failure here is not worth a toast.
      }
    }
  }
}
