import React, { useState } from 'react'
import { Minus, Square, X, ShieldCheck } from 'lucide-react'
import CertHelpDialog from './dialogs/CertHelpDialog.jsx'

export default function TitleBar({ connected, proxyAddr, winProxyEnabled }) {
  const el = window.electron
  const [showCert, setShowCert] = useState(false)

  return (
    <>
      <div className="titlebar">
        <div className="titlebar__logo">
          <img src="pepe.ico" width="20" height="20" alt="App Icon" />
          <span className="titlebar__name">PEPE</span>
        </div>

        <span className="titlebar__proxy">{proxyAddr || '127.0.0.1:8080'}</span>

        <span
          className={`titlebar__status ${connected ? 'titlebar__status--connected' : 'titlebar__status--disconnected'}`}
          title="Connection to PEPE service"
        >
          {connected ? '●' : '○'} Sniffer
        </span>

        <span
          className={`titlebar__status ${winProxyEnabled ? 'titlebar__status--connected' : 'titlebar__status--disconnected'}`}
          title="Windows system proxy"
        >
          {winProxyEnabled ? '●' : '○'} Proxy
        </span>

        <span className="titlebar__spacer" />

        <button
          className="btn btn--icon"
          style={{ marginRight: 8, fontSize: 11, gap: 5, WebkitAppRegion: 'no-drag' }}
          onClick={() => setShowCert(true)}
          title="CA Certificate — install to decrypt HTTPS"
        >
          <ShieldCheck size={13} />
          CA Cert
        </button>

        <div className="titlebar__controls">
          <button className="titlebar__ctrl" onClick={() => el?.minimize()} title="Minimize">
            <Minus size={14} />
          </button>
          <button className="titlebar__ctrl" onClick={() => el?.maximize()} title="Maximize">
            <Square size={12} />
          </button>
          <button className="titlebar__ctrl titlebar__ctrl--close" onClick={() => el?.close()} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {showCert && <CertHelpDialog onClose={() => setShowCert(false)} />}
    </>
  )
}
