import React, { useEffect, useRef } from 'react'

function methodClass(m) {
  const map = { GET: 'GET', POST: 'POST', PUT: 'PUT', DELETE: 'DELETE', PATCH: 'PATCH' }
  return `method method--${map[m] ?? 'other'}`
}

function StatusBadge({ code }) {
  if (code === null || code === undefined) return <span className="status status--pend">—</span>
  if (code === 'ERROR') return <span className="status status--err">ERR</span>
  const n = Number(code)
  let cls = 'status--pend'
  if (n >= 200 && n < 300) cls = 'status--2xx'
  else if (n >= 300 && n < 400) cls = 'status--3xx'
  else if (n >= 400 && n < 500) cls = 'status--4xx'
  else if (n >= 500) cls = 'status--5xx'
  return <span className={`status ${cls}`}>{code}</span>
}

function rowClass(flow, selectedId) {
  const parts = []
  if (flow.id === selectedId) parts.push('selected')
  if (flow.blocked) return [...parts, 'blocked'].join(' ')
  const code = flow.status_code
  if (code === 'ERROR' || (typeof code === 'number' && code >= 500)) parts.push('err')
  else if (typeof code === 'number' && code >= 400) parts.push('warn')
  return parts.join(' ')
}

function hasSigMatch(flow, overrides) {
  return overrides.some(r =>
    r.sig &&
    r.sig[0] === flow.method &&
    r.sig[1] === flow.scheme &&
    r.sig[2] === flow.host &&
    r.sig[3] === (flow.port ?? 80) &&
    r.sig[4] === flow.path
  )
}

export default function FlowTable({
  flows, selectedId, onSelect, onContextMenu,
  autoScroll, respOverrides, reqOverrides,
}) {
  const scrollRef = useRef(null)
  const tbodyRef = useRef(null)

  // Auto-scroll to bottom when new flows arrive
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [flows.length, autoScroll])

  const timeStr = (iso) => {
    if (!iso) return ''
    try { return new Date(iso).toLocaleTimeString('en-US', { hour12: false }) } catch { return iso }
  }

  return (
    <div className="flow-table-wrap">
      <div className="section-header">
        <span>Traffic</span>
        <span className="section-header__count">{flows.length} flows</span>
      </div>
      <div className="flow-scroll" ref={scrollRef}>
        <table className="flow-table">
          <thead>
            <tr>
              <th style={{ width: 76 }}>Time</th>
              <th style={{ width: 62 }}>Method</th>
              <th style={{ width: 56 }}>Status</th>
              <th style={{ width: 160 }}>Host</th>
              <th>Path</th>
              <th style={{ width: 50 }}>ms</th>
              <th style={{ width: 100 }}>Process</th>
              <th style={{ width: 48 }}>Tags</th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {flows.map(flow => {
              const hasRespOv = hasSigMatch(flow, respOverrides)
              const hasReqOv = hasSigMatch(flow, reqOverrides)
              return (
                <tr
                  key={flow.id}
                  className={rowClass(flow, selectedId)}
                  onClick={() => onSelect(flow.id)}
                  onContextMenu={e => onContextMenu(e, flow)}
                >
                  <td title={flow.time}>{timeStr(flow.time)}</td>
                  <td><span className={methodClass(flow.method)}>{flow.method}</span></td>
                  <td><StatusBadge code={flow.status_code} /></td>
                  <td className="truncate" title={flow.host}>{flow.host}</td>
                  <td className="truncate mono" title={flow.path}>{flow.path}</td>
                  <td>{flow.duration_ms ?? ''}</td>
                  <td className="truncate muted" title={flow.process_name}>{flow.process_name}</td>
                  <td>
                    {flow.blocked && <span className="tag tag--blk">BLK</span>}
                    {!flow.blocked && (hasRespOv || hasReqOv) && <span className="tag tag--ov">OV</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {flows.length === 0 && (
          <div className="detail-empty" style={{ minHeight: 120 }}>
            No traffic captured yet — make sure your proxy is set to 127.0.0.1:8080
          </div>
        )}
      </div>
    </div>
  )
}
