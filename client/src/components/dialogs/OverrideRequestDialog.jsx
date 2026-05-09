import React, { useState } from 'react'
import { Shield } from 'lucide-react'
import { bytesToB64 } from '../../api.js'

function renderBody(bodyObj) {
  if (!bodyObj || bodyObj.kind === 'empty') return ''
  return bodyObj.value
}

export default function OverrideRequestDialog({ flow, onSave, onClose, initialOverride }) {
  const req = flow?.request ?? {}

  const [method, setMethod] = useState(initialOverride?.method ?? flow?.method ?? '')
  const [url, setUrl] = useState(initialOverride?.url ?? '')
  const [headersText, setHeadersText] = useState(
    JSON.stringify(initialOverride?.headers ?? req.headers ?? {}, null, 2)
  )
  const [body, setBody] = useState(renderBody(initialOverride?.body ?? req.body))
  const [error, setError] = useState('')

  const sig = `${flow?.method ?? ''} ${flow?.url ?? ''}`

  const save = () => {
    let headers = {}
    if (headersText.trim()) {
      try { headers = JSON.parse(headersText) }
      catch (e) { setError('Headers: ' + e.message); return }
    }
    onSave({
      method,
      url,
      headers,
      body_b64: bytesToB64(body),
    })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--lg" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Shield size={16} /> Override Request</div>
        <div className="dialog__subtitle">{sig}</div>

        <div className="dialog__row">
          <div className="dialog__field" style={{ flex: '0 0 120px' }}>
            <label className="dialog__label">Method</label>
            <input className="dialog__input" value={method} onChange={e => setMethod(e.target.value)} placeholder="GET" />
          </div>
          <div className="dialog__field">
            <label className="dialog__label">Override URL (optional)</label>
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
          <button className="btn btn--accent" onClick={save}>Save Override</button>
        </div>
      </div>
    </div>
  )
}
