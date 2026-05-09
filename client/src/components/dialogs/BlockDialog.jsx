import React, { useState } from 'react'
import { Ban } from 'lucide-react'

const KINDS = ['host', 'url', 'process']

const HINTS = {
  host: 'Exact domain or parent (e.g. example.com also matches www.example.com)',
  url: 'Substring match against the full URL',
  process: 'Exact process name (e.g. chrome.exe) — requires psutil',
}

export default function BlockDialog({ initialKind, initialValue, onSave, onClose }) {
  const [kind, setKind] = useState(initialKind ?? 'host')
  const [value, setValue] = useState(initialValue ?? '')
  const [error, setError] = useState('')

  const save = () => {
    if (!value.trim()) { setError('Value cannot be empty'); return }
    onSave(kind, value.trim())
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Ban size={16} /> Add Block Rule</div>

        <div className="dialog__field">
          <label className="dialog__label">Kind</label>
          <select className="dialog__select" value={kind} onChange={e => setKind(e.target.value)}>
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Value</label>
          <input
            className="dialog__input"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && save()}
            autoFocus
          />
        </div>

        <p className="dialog__hint">{HINTS[kind]}</p>

        {error && <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p>}

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save}>Add Rule</button>
        </div>
      </div>
    </div>
  )
}
