import React, { useState } from 'react'
import { ShieldOff } from 'lucide-react'

const KIND_LABELS = {
  host:    'Host regex (SSL bypass)',
  process: 'Process name',
  address: 'Address / host substring',
}

const KIND_PLACEHOLDERS = {
  host:    'e.g. (.*\\.)?example\\.com',
  process: 'e.g. discord.exe',
  address: 'e.g. api.example.com',
}

export default function EditBypassDialog({ rule, onSave, onClose }) {
  const [pattern, setPattern] = useState(rule.pattern ?? '')
  const [label, setLabel] = useState(rule.label ?? '')
  const [kind, setKind] = useState(rule.kind ?? 'host')
  const [error, setError] = useState('')

  const save = () => {
    if (!pattern.trim()) { setError('Value is required'); return }
    onSave({ pattern: pattern.trim(), label: label.trim(), kind })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><ShieldOff size={16} /> Edit Bypass Rule</div>

        <div className="dialog__field">
          <label className="dialog__label">Kind</label>
          <select className="dialog__select" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="host">Host (SSL bypass + filter)</option>
            <option value="process">Process name</option>
            <option value="address">Address / host</option>
          </select>
        </div>

        <div className="dialog__field">
          <label className="dialog__label">{KIND_LABELS[kind] ?? 'Value'}</label>
          <input
            className="dialog__input"
            value={pattern}
            onChange={e => { setPattern(e.target.value); setError('') }}
            placeholder={KIND_PLACEHOLDERS[kind]}
            spellCheck={false}
            autoFocus
          />
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Label (optional)</label>
          <input
            className="dialog__input"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Short description"
          />
        </div>

        {error && <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p>}

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
