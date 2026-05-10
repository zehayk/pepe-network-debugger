import React, { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'

function StatusDot({ status }) {
  const cls = status === 'open' ? 'stream--open' : status === 'error' ? 'stream--error' : 'stream--closed'
  return <span className={`stream-status ${cls}`}>{status}</span>
}

export default function StreamsTable({ conns, order, selectedId, onSelect, autoScroll, onClear }) {
  const scrollRef = useRef(null)

  // When autoScroll turns on, always snap to bottom
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [autoScroll])

  // When new streams arrive and autoScroll is on, only scroll if already near bottom
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    const el = scrollRef.current
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight
    }
  }, [order.length])

  const list = order.map(id => conns[id]).filter(Boolean)

  const timeStr = (iso) => {
    if (!iso) return ''
    try { return new Date(iso).toLocaleTimeString('en-US', { hour12: false }) } catch { return iso }
  }

  return (
    <div className="flow-table-wrap">
      <div className="section-header">
        <span>Streams</span>
        <span className="section-header__count">{list.length} connections</span>
        {onClear && (
          <button className="btn btn--icon section-header__clear" onClick={onClear} title="Clear streams">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="flow-scroll" ref={scrollRef}>
        <table className="flow-table" style={{ tableLayout: 'auto', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 76 }}>Time</th>
              <th style={{ width: 50 }}>Type</th>
              <th style={{ width: 160 }}>Host</th>
              <th>Path</th>
              <th style={{ width: 100 }}>Process</th>
              <th style={{ width: 50 }}>Msgs</th>
              <th style={{ width: 70 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map(conn => (
              <tr
                key={conn.id}
                className={conn.id === selectedId ? 'selected' : ''}
                onClick={() => onSelect(conn.id)}
              >
                <td>{timeStr(conn.time)}</td>
                <td>
                  <span className={`stream-type stream-type--${conn.scheme}`}>
                    {conn.scheme.toUpperCase()}
                  </span>
                </td>
                <td className="truncate" title={conn.host}>{conn.host}</td>
                <td className="truncate mono" title={conn.path}>{conn.path}</td>
                <td className="truncate muted" title={conn.process_name}>{conn.process_name}</td>
                <td>{conn.msg_count}</td>
                <td><StatusDot status={conn.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && (
          <div className="detail-empty" style={{ minHeight: 120 }}>
            No WebSocket or gRPC streams captured yet
          </div>
        )}
      </div>
    </div>
  )
}
