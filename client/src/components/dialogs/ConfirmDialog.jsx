import React from 'react'
import { AlertTriangle } from 'lucide-react'

export default function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onClose }) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog dialog--sm" onClick={e => e.stopPropagation()}>
        <div className="dialog__title">
          <AlertTriangle size={15} />
          {title}
        </div>
        <p style={{ fontSize: 13, color: 'var(--fg-dim)', margin: '8px 0 20px', lineHeight: 1.5 }}>
          {message}
        </p>
        <div className="dialog__actions">
          <button className="btn" onClick={onClose} autoFocus>Cancel</button>
          <button className="btn btn--danger" onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
