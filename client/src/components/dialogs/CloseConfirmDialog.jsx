import React from 'react'
import { AlertTriangle } from 'lucide-react'

export default function CloseConfirmDialog({ onConfirm, onClose }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">
          <AlertTriangle size={16} style={{ color: 'var(--warn)' }} />
          Close PEPE?
        </div>
        <p className="dialog__hint" style={{ marginTop: 4 }}>
          Unsaved session data will be lost.
        </p>
        <div className="dialog__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--danger" onClick={onConfirm}>Exit</button>
        </div>
      </div>
    </div>
  )
}
