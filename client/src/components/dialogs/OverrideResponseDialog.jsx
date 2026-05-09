import React, { useState } from 'react'
import { Shield } from 'lucide-react'
import { bytesToB64 } from '../../api.js'

function renderBody(bodyObj) {
  if (!bodyObj || bodyObj.kind === 'empty') return ''
  if (bodyObj.kind === 'text') return bodyObj.value
  return bodyObj.value // base64
}

export default function OverrideResponseDialog({ flow, onSave, onClose, initialOverride }) {
  const resp = flow?.response ?? {}

  const [statusCode, setStatusCode] = useState(String(initialOverride?.status_code ?? flow?.status_code ?? 200))
  const [reason, setReason] = useState(initialOverride?.reason ?? flow?.status_reason ?? '')
  const [contentType, setContentType] = useState(initialOverride?.content_type ?? resp.content_type ?? '')
  const [headersText, setHeadersText] = useState(
    JSON.stringify(initialOverride?.headers ?? resp.headers ?? {}, null, 2)
  )
  const [body, setBody] = useState(renderBody(initialOverride?.body ?? resp.body))
  const [error, setError] = useState('')

  const sig = `${flow?.method ?? ''} ${flow?.url ?? ''}`

  const save = () => {
    const code = parseInt(statusCode, 10)
    if (isNaN(code)) { setError('Status code must be a number'); return }
    let headers = {}
    if (headersText.trim()) {
      try { headers = JSON.parse(headersText) }
      catch (e) { setError('Headers: ' + e.message); return }
    }
    onSave({
      status_code: code,
      reason,
      content_type: contentType,
      headers,
      body_b64: bytesToB64(body),
    })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--lg" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Shield size={16} /> Override Response</div>
        <div className="dialog__subtitle">{sig}</div>

        <div className="dialog__row">
          <div className="dialog__field" style={{ flex: '0 0 120px' }}>
            <label className="dialog__label">Status Code</label>
            <input className="dialog__input" value={statusCode} onChange={e => setStatusCode(e.target.value)} />
          </div>
          <div className="dialog__field">
            <label className="dialog__label">Reason</label>
            <input className="dialog__input" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Content-Type</label>
          <input className="dialog__input" value={contentType} onChange={e => setContentType(e.target.value)} />
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
