import React, { useRef, useState } from 'react'
import { Ban } from 'lucide-react'

const KINDS = ['host', 'url', 'process', 'ip']

const KIND_HINTS = {
  host: 'Exact domain or parent (e.g. example.com also matches www.example.com)',
  url: 'Substring match against the full URL',
  process: 'Exact process name (e.g. chrome.exe) — requires psutil',
  ip: 'Exact IPv4/IPv6 address — effective for direct IP connections',
}

const RESPONSE_TYPES = [
  { id: 'block', label: '403 Block' },
  { id: 'hang',  label: 'Hang' },
  { id: 'text',  label: 'Text' },
  { id: 'html',  label: 'HTML' },
  { id: 'gif',   label: 'GIF' },
  { id: 'video', label: 'Video' },
]

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1] ?? '')
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function decodeB64Text(b64) {
  if (!b64) return ''
  try { return decodeURIComponent(escape(atob(b64))) } catch { return '' }
}

function b64ByteSize(b64) {
  if (!b64) return 0
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor(b64.length * 3 / 4) - pad
}

export default function EditBlockDialog({ rule, onSave, onClose }) {
  const [kind, setKind] = useState(rule.kind ?? 'host')
  const [value, setValue] = useState(rule.value ?? '')
  const [responseType, setResponseType] = useState(rule.response_type ?? 'block')
  const [bodyText, setBodyText] = useState(() => {
    const rt = rule.response_type ?? 'block'
    if (rt === 'text' || rt === 'html') return decodeB64Text(rule.response_body_b64 ?? '')
    return ''
  })
  const [bodyB64, setBodyB64] = useState(rule.response_body_b64 ?? '')
  const [fileName, setFileName] = useState(() => {
    const rt = rule.response_type ?? 'block'
    if ((rt === 'gif' || rt === 'video') && rule.response_body_b64) {
      return `existing file (${b64ByteSize(rule.response_body_b64)} B)`
    }
    return ''
  })
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    setBodyB64(await fileToBase64(file))
  }

  const changeType = (rt) => {
    setResponseType(rt)
    setError('')
    if (rt === 'text' || rt === 'html') {
      // try to restore from current b64 if it was text
      if (!bodyText) setBodyText(decodeB64Text(bodyB64))
    }
  }

  const save = () => {
    if (!value.trim()) { setError('Value cannot be empty'); return }
    if ((responseType === 'gif' || responseType === 'video') && !bodyB64) {
      setError('Please choose a file'); return
    }
    let finalB64 = ''
    if (responseType === 'text' || responseType === 'html') {
      finalB64 = btoa(unescape(encodeURIComponent(bodyText)))
    } else if (responseType === 'gif' || responseType === 'video') {
      finalB64 = bodyB64
    }
    onSave({ kind, value: value.trim(), response_type: responseType, response_body_b64: finalB64 })
  }

  const needsText = responseType === 'text' || responseType === 'html'
  const needsFile = responseType === 'gif' || responseType === 'video'

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Ban size={16} /> Edit Block Rule</div>

        <div className="dialog__row">
          <div className="dialog__field" style={{ flex: '0 0 120px' }}>
            <label className="dialog__label">Match By</label>
            <select className="dialog__select" value={kind} onChange={e => setKind(e.target.value)}>
              {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="dialog__field">
            <label className="dialog__label">Value</label>
            <input
              className="dialog__input"
              value={value}
              onChange={e => { setValue(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && save()}
              autoFocus
            />
          </div>
        </div>

        <p className="dialog__hint">{KIND_HINTS[kind]}</p>

        <div className="dialog__field">
          <label className="dialog__label">Response</label>
          <div className="block-resp-types">
            {RESPONSE_TYPES.map(rt => (
              <button
                key={rt.id}
                type="button"
                className={`block-resp-type ${responseType === rt.id ? 'block-resp-type--active' : ''}`}
                onClick={() => changeType(rt.id)}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        {responseType === 'block' && (
          <p className="dialog__hint">Returns a <strong>403 Forbidden</strong> immediately.</p>
        )}
        {responseType === 'hang' && (
          <p className="dialog__hint">Stalls the connection for 90 seconds, then fails with a 504. Simulates a server that never responds.</p>
        )}

        {needsText && (
          <div className="dialog__field">
            <label className="dialog__label">
              {responseType === 'html' ? 'HTML Body' : 'Text Body'}
            </label>
            <textarea
              className="dialog__textarea"
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              placeholder={responseType === 'html' ? '<h1>Blocked</h1>' : 'Blocked by rule'}
              style={{ minHeight: 100, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        )}

        {needsFile && (
          <div className="dialog__field">
            <label className="dialog__label">
              {responseType === 'gif' ? 'GIF File' : 'Video File (mp4)'}
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                Choose File
              </button>
              <span className="muted" style={{ fontSize: 12 }}>{fileName || 'No file chosen'}</span>
              <input
                ref={fileRef}
                type="file"
                accept={responseType === 'gif' ? 'image/gif' : 'video/mp4,video/*'}
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
          </div>
        )}

        {error && <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p>}

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
