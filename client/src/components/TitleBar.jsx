import React, { useState } from 'react'
import { Minus, Square, X, ShieldCheck } from 'lucide-react'
import CertHelpDialog from './dialogs/CertHelpDialog.jsx'

export default function TitleBar({ connected }) {
  const el = window.electron
  const [showCert, setShowCert] = useState(false)

  return (
    <>
      <div className="titlebar">
        <div className="titlebar__logo">
          {/* <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="9" stroke="#00bfff" strokeWidth="1.5"/>
            <circle cx="10" cy="10" r="3.5" fill="#00bfff"/>
            <line x1="1" y1="10" x2="5.5" y2="10" stroke="#00bfff" strokeWidth="1.5"/>
            <line x1="14.5" y1="10" x2="19" y2="10" stroke="#00bfff" strokeWidth="1.5"/>
            <line x1="10" y1="1" x2="10" y2="5.5" stroke="#00bfff" strokeWidth="1.5"/>
          </svg> */}
          <img
            src="pepe.ico"
            width="20"
            height="20"
            alt="App Icon"
          />
          <span className="titlebar__name">PEPE</span>
        </div>

        <span className="titlebar__proxy">127.0.0.1:8080</span>

        <span className={`titlebar__status ${connected ? 'titlebar__status--connected' : 'titlebar__status--disconnected'}`}>
          {connected ? '● connected' : '○ disconnected'}
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
