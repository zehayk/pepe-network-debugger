import React, { useState } from 'react'
import { Send } from 'lucide-react'

function renderBody(bodyObj) {
  if (!bodyObj || bodyObj.kind === 'empty') return ''
  return bodyObj.value
}

export default function SendDialog({ flow, onSend, onClose }) {
  const req = flow?.request ?? {}

  const [method, setMethod] = useState(flow?.method ?? 'GET')
  const [url, setUrl] = useState(flow?.url ?? '')
  const [headersText, setHeadersText] = useState(
    JSON.stringify(req.headers ?? {}, null, 2)
  )
  const [body, setBody] = useState(renderBody(req.body))
  const [error, setError] = useState('')

  const send = () => {
    if (!url.trim()) { setError('URL is required'); return }
    let headers = {}
    if (headersText.trim()) {
      try { headers = JSON.parse(headersText) }
      catch (e) { setError('Headers: ' + e.message); return }
    }
    onSend({ method, url: url.trim(), headers, body })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--lg" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Send size={16} /> Edit &amp; Send Request</div>

        <div className="dialog__row">
          <div className="dialog__field" style={{ flex: '0 0 120px' }}>
            <label className="dialog__label">Method</label>
            <input className="dialog__input" value={method} onChange={e => setMethod(e.target.value)} />
          </div>
          <div className="dialog__field">
            <label className="dialog__label">URL</label>
            <input className="dialog__input" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Headers (JSON)</label>
          <textarea
            className="dialog__textarea"
            style={{ minHeight: 100 }}
            value={headersText}
            onChange={e => setHeadersText(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Body</label>
          <textarea
            className="dialog__textarea"
            style={{ minHeight: 180 }}
            value={body}
            onChange={e => setBody(e.target.value)}
            spellCheck={false}
          />
        </div>

        {error && <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p>}

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={send}><Send size={13} /> Send</button>
        </div>
      </div>
    </div>
  )
}
