import React, { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'

export default function StreamDetail({ conn, messages }) {
  const scrollRef = useRef(null)
  const [tab, setTab] = useState('messages')
  const [popup, setPopup] = useState(null)

  useEffect(() => {
    if (!scrollRef.current || tab !== 'messages') return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages?.length, tab])

  if (!conn) {
    return (
      <div className="detail-empty" style={{ height: '100%' }}>
        Select a stream to see messages
      </div>
    )
  }

  const statusCls = conn.status === 'open' ? 'stream--open'
    : conn.status === 'error' ? 'stream--error' : 'stream--closed'

  return (
    <div className="detail-panel">
      <div className="stream-detail-header">
        <div className="stream-detail-url">
          <span className={`stream-type stream-type--${conn.scheme}`}>{conn.scheme.toUpperCase()}</span>
          <span className="mono" style={{ marginLeft: 8, fontSize: 12 }}>{conn.host}{conn.path}</span>
        </div>
        <div className="stream-detail-meta">
          {conn.process_name && <span className="muted">{conn.process_name}</span>}
          <span className={`stream-status ${statusCls}`}>{conn.status}</span>
          <span className="muted">{messages.length} messages</span>
        </div>
      </div>

      <div className="tab-bar">
        {['messages', 'headers', 'info'].map(t => (
          <button
            key={t}
            className={`tab-bar__tab ${tab === t ? 'tab-bar__tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'messages' && (
        <div className="stream-messages" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="detail-empty">No messages yet</div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`stream-msg ${msg.from_client ? 'stream-msg--client' : 'stream-msg--server'}`}>
              <div
                className="stream-msg__meta"
                onDoubleClick={() => setPopup(msg)}
                title="Double-click for full content"
              >
                {msg.from_client
                  ? <ArrowUp size={11} color="var(--accent)" />
                  : <ArrowDown size={11} color="var(--success)" />
                }
                <span className="stream-msg__dir">{msg.from_client ? 'Client' : 'Server'}</span>
                <span className="stream-msg__time">{
                  msg.time ? new Date(msg.time).toLocaleTimeString('en-US', { hour12: false }) : ''
                }</span>
                <span className="stream-msg__size muted">{msg.size} B</span>
                {msg.kind === 'binary' && <span className="stream-msg__kind">binary</span>}
              </div>
              <pre className="stream-msg__content">
                {msg.prettyContent ?? (msg.kind === 'binary' ? '[binary data]' : (msg.content ?? ''))}
              </pre>
            </div>
          ))}
        </div>
      )}

      {tab === 'headers' && (
        <div className="detail-content">
          {conn.headers && Object.keys(conn.headers).length > 0 ? (
            <div className="detail-kv">
              {Object.entries(conn.headers).map(([k, v]) => (
                <React.Fragment key={k}>
                  <div className="detail-kv__key">{k}</div>
                  <div className="detail-kv__val">{v}</div>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <div className="detail-empty">No headers available</div>
          )}
        </div>
      )}

      {tab === 'info' && (
        <div className="detail-content">
          <div className="detail-kv">
            {[
              ['Scheme', conn.scheme?.toUpperCase() ?? ''],
              ['Host', conn.host ?? ''],
              ['Port', conn.port ?? ''],
              ['Path', conn.path ?? ''],
              ['Process', conn.process_name || '—'],
              ['Connected', conn.time ? new Date(conn.time).toLocaleString() : '—'],
              ['Status', conn.status ?? ''],
              ['Messages', messages.length],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <div className="detail-kv__key">{k}</div>
                <div className="detail-kv__val">{String(v)}</div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {popup && (
        <div className="dialog-overlay" onClick={() => setPopup(null)}>
          <div className="dialog dialog--sm" onClick={e => e.stopPropagation()} style={{ maxHeight: '80vh' }}>
            <div className="dialog__title">
              {popup.from_client
                ? <ArrowUp size={14} color="var(--accent)" />
                : <ArrowDown size={14} color="var(--success)" />
              }
              {popup.from_client ? 'Client → Server' : 'Server → Client'}
            </div>
            <div className="dialog__subtitle">
              {popup.time ? new Date(popup.time).toLocaleString() : ''} · {popup.size} B · {popup.kind}
            </div>
            <pre className="code-block" style={{ maxHeight: '55vh', overflowY: 'auto', userSelect: 'text' }}>
              {popup.prettyContent ?? (popup.kind === 'binary' ? '[binary data]' : (popup.content ?? ''))}
            </pre>
            <div className="dialog__actions">
              <button className="btn" onClick={() => {
                const text = popup.prettyContent ?? (popup.kind === 'binary' ? '[binary data]' : (popup.content ?? ''))
                navigator.clipboard.writeText(text)
              }}>Copy</button>
              <button className="btn btn--primary" onClick={() => setPopup(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
