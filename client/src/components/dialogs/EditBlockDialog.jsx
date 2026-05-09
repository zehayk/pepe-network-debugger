import React, { useState } from 'react'
import { Ban } from 'lucide-react'

export default function EditBlockDialog({ rule, onSave, onClose }) {
  const [kind, setKind] = useState(rule.kind ?? 'host')
  const [value, setValue] = useState(rule.value ?? '')
  const [error, setError] = useState('')

  const save = () => {
    if (!value.trim()) { setError('Value is required'); return }
    onSave({ kind, value: value.trim() })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title"><Ban size={16} /> Edit Block Rule</div>

        <div className="dialog__field">
          <label className="dialog__label">Kind</label>
          <select className="dialog__select" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="host">Host</option>
            <option value="url">URL (substring)</option>
            <option value="process">Process</option>
          </select>
        </div>

        <div className="dialog__field">
          <label className="dialog__label">Value</label>
          <input
            className="dialog__input"
            value={value}
            onChange={e => { setValue(e.target.value); setError('') }}
            placeholder={kind === 'host' ? 'e.g. ads.example.com' : kind === 'url' ? 'e.g. /tracking/' : 'e.g. discord.exe'}
            spellCheck={false}
            autoFocus
          />
        </div>

        {error && <p style={{ color: 'var(--error)', fontSize: 12 }}>{error}</p>}

        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--danger" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
