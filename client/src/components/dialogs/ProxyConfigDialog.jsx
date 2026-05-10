import React, { useEffect, useState } from 'react'
import { Globe, ToggleLeft, ToggleRight } from 'lucide-react'

export default function ProxyConfigDialog({ listenHost, listenPort, winProxy, onApply, onClose, onOpen }) {
  const [host, setHost] = useState(listenHost || '127.0.0.1')
  const [port, setPort] = useState(String(listenPort || 8080))
  const [winEnabled, setWinEnabled] = useState(winProxy?.enabled ?? false)

  // Fetch fresh proxy state on mount so toggle is always accurate
  useEffect(() => { onOpen?.() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync winEnabled when winProxy arrives (async fetch)
  useEffect(() => {
    if (winProxy != null) setWinEnabled(winProxy.enabled ?? false)
  }, [winProxy?.enabled])

  const apply = () => {
    const h = host.trim() || '127.0.0.1'
    const p = port.trim() || '8080'
    onApply(h, p, winEnabled)
    onClose()
  }

  const addr = `${host.trim() || '127.0.0.1'}:${port.trim() || '8080'}`

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Globe size={16} /> Proxy Configuration</div>

        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>
          Listen Address
        </div>

        <div className="dialog__row">
          <div className="dialog__field">
            <label className="dialog__label">Host</label>
            <input
              className="dialog__input"
              value={host}
              onChange={e => setHost(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              placeholder="127.0.0.1"
            />
          </div>
          <div className="dialog__field" style={{ flex: '0 0 90px' }}>
            <label className="dialog__label">Port</label>
            <input
              className="dialog__input"
              value={port}
              onChange={e => setPort(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && apply()}
              placeholder="8080"
            />
          </div>
        </div>

        <p className="dialog__hint">
          Where PEPE listens for proxied traffic. Changing port restarts the proxy engine.
        </p>

        <div style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />

        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', color: 'var(--muted)' }}>
          Windows System Proxy
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className={`toggle-btn ${winEnabled ? 'toggle-btn--on' : ''}`}
            onClick={() => setWinEnabled(v => !v)}
            style={{ padding: 2 }}
          >
            {winEnabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
          </button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: winEnabled ? 'var(--success)' : 'var(--fg-dim)' }}>
              {winEnabled ? 'Enabled' : 'Disabled'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {winEnabled ? `Routing system traffic through ${addr}` : 'System proxy is off'}
            </div>
          </div>
        </div>

        <p className="dialog__hint">
          Writes to the Windows registry and signals running applications.
          Changes take effect immediately for most browsers.
        </p>

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={apply}>Apply</button>
        </div>
      </div>
    </div>
  )
}
