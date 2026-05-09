import React from 'react'
import { Search } from 'lucide-react'

export default function FilterBar({
  filter, onFilter,
  regexMode, onRegexMode,
  errorsOnly, onErrorsOnly,
  autoScroll, onAutoScroll,
  count, total,
}) {
  return (
    <div className="filterbar">
      <div className="filterbar__input-wrap">
        <Search size={13} />
        <input
          className="filterbar__input"
          placeholder={regexMode ? 'Regex pattern…' : 'Keywords — space-separated AND…'}
          value={filter}
          onChange={e => onFilter(e.target.value)}
        />
        <button
          className={`btn btn--icon${regexMode ? ' btn--accent' : ''}`}
          style={{
            marginLeft: 4,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            padding: '2px 7px',
            flexShrink: 0,
            opacity: regexMode ? 1 : 0.45,
          }}
          onClick={() => onRegexMode(!regexMode)}
          title={regexMode ? 'Regex mode active — click for keyword mode' : 'Enable regex mode'}
        >
          .*
        </button>
      </div>

      <label className="filterbar__check">
        <input type="checkbox" checked={errorsOnly} onChange={e => onErrorsOnly(e.target.checked)} />
        Errors only
      </label>

      <label className="filterbar__check">
        <input type="checkbox" checked={autoScroll} onChange={e => onAutoScroll(e.target.checked)} />
        Auto-scroll
      </label>

      <span className="filterbar__count">
        {count !== total ? `${count} / ${total}` : `${total}`} flows
      </span>
    </div>
  )
}
