import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'
import { useStore } from '../store'
import { createPhoneRemoteSlice, type PhoneRemoteSliceState } from '../store/phone-remote-slice'

/**
 * Desktop Settings panel for the phone web remote (feature 0026, REQ-002/REQ-007/REQ-020): the
 * enable toggle, bind-mode toggle (with the LAN plaintext-transport warning shown only in LAN
 * mode), port field, QR pairing code, and Regenerate — with the disclosed consequence that every
 * already-paired phone must re-scan. After an app restart the plaintext token no longer exists in
 * memory (`tokenAvailableThisSession` false) — the UI offers Regenerate instead of a stale QR.
 *
 * A local `createPhoneRemoteSlice` instance owns the settings/status state (this panel is not yet
 * spliced into the app-wide store — a deliberate, documented scope boundary, see the feature's
 * implementation notes); it reuses the app-wide `pushToast` action for the one thing that must
 * ride the shared chokepoint (REQ-020's error surfacing, CONV-004).
 */
export function PhoneRemoteSettings() {
  const pushToast = useStore(s => s.pushToast)
  const [state, setState] = useState<PhoneRemoteSliceState>({ phoneRemoteStatus: null, phoneRemotePairingUrl: null })
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [portDraft, setPortDraft] = useState('')

  const slice = useMemo(() => createPhoneRemoteSlice({
    set: (patch) => setState(s => ({ ...s, ...(typeof patch === 'function' ? (patch as (s: PhoneRemoteSliceState) => object)(s) : patch) })),
    get: () => stateRef.current,
    phoneRemoteStatus: () => api.phoneRemoteStatus(),
    phoneRemoteSetEnabled: (enabled) => api.phoneRemoteSetEnabled(enabled),
    phoneRemoteSetBind: (mode) => api.phoneRemoteSetBind(mode),
    phoneRemoteSetPort: (port) => api.phoneRemoteSetPort(port),
    phoneRemoteRegenerateToken: () => api.phoneRemoteRegenerateToken(),
    pushToast
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pushToast])

  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    void slice.seedPhoneRemoteStatus()
    return api.onPhoneRemoteChanged((status) => slice.ingestPhoneRemoteStatus(status))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice])

  useEffect(() => {
    if (!state.phoneRemotePairingUrl) { setQrDataUrl(null); return }
    let cancelled = false
    QRCode.toDataURL(state.phoneRemotePairingUrl, { margin: 1 }).then((url) => {
      if (!cancelled) setQrDataUrl(url)
    }).catch(() => { if (!cancelled) setQrDataUrl(null) })
    return () => { cancelled = true }
  }, [state.phoneRemotePairingUrl])

  const status = state.phoneRemoteStatus
  const bind = status?.bind ?? 'localhost'
  const isLan = bind === 'lan'

  const applyPort = (): void => {
    const n = Number(portDraft)
    if (Number.isInteger(n) && n > 0 && n <= 65535) void slice.setPhoneRemotePort(n)
  }

  return (
    <div data-testid="phone-remote-settings" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          onChange={(e) => void slice.setPhoneRemoteEnabled(e.target.checked)}
        />
        Enable phone remote (read and type into panes from your phone)
      </label>

      <fieldset disabled={!status?.enabled} style={{ border: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <legend style={{ fontSize: 12, color: 'var(--fg-dim, #999)' }}>Network</legend>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" name="phone-remote-bind" value="localhost" checked={!isLan}
            onChange={() => void slice.setPhoneRemoteBind('localhost')} />
          This computer only (127.0.0.1)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="radio" name="phone-remote-bind" value="lan" checked={isLan}
            onChange={() => void slice.setPhoneRemoteBind('lan')} />
          My local network (0.0.0.0)
        </label>
        {isLan && (
          <p role="alert" style={{ color: 'var(--warn-fg, #e0a030)', background: 'var(--warn-bg, transparent)', fontSize: 12, padding: 4, borderRadius: 4 }}>
            Warning: LAN mode serves plaintext, unencrypted HTTP — anyone on your network can see
            pane contents and keystrokes. For remote access away from home, use{' '}
            <code>tailscale serve</code> against the localhost bind instead.
          </p>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Port
          <input
            type="number"
            value={portDraft || String(status?.port ?? '')}
            onChange={(e) => setPortDraft(e.target.value)}
            onBlur={applyPort}
          />
        </label>
      </fieldset>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--fg-dim, #999)' }}>
          Pairing {status?.hasToken ? '(paired)' : '(never paired)'}
        </div>
        {status?.tokenAvailableThisSession && qrDataUrl && (
          <img src={qrDataUrl} alt="Pairing QR code" width={180} height={180} />
        )}
        {status?.hasToken && !status?.tokenAvailableThisSession && (
          <p style={{ fontSize: 12 }}>
            The pairing QR code isn&apos;t available after an app restart (the token only ever
            lives in memory) — already-paired phones keep working with no action; regenerate to
            pair a NEW device.
          </p>
        )}
        <button type="button" disabled={!status?.enabled} onClick={() => void slice.regeneratePhoneRemoteToken()}>
          Regenerate pairing token
        </button>
        <p style={{ fontSize: 12, color: 'var(--fg-dim, #999)' }}>
          Regenerating invalidates the current token immediately — every already-paired phone will
          need to re-scan (re-pair) with the new QR code.
        </p>
        {status?.urls && status.urls.length > 0 && (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {status.urls.map((u) => <li key={u}>{u}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
