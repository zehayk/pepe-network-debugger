import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

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

// Default column widths — matches previous fixed widths; path gets remaining space
const DEFAULT_WIDTHS = [76, 62, 56, 160, 150, 50, 100]
const COL_MIN = 30
const ROW_H = 28
const OVERSCAN = 5

export default function FlowTable({
  flows, selectedId, onSelect, onContextMenu,
  autoScroll, pauseEvents, onClear,
}) {
  const scrollRef = useRef(null)
  const [colWidths, setColWidths] = useState(DEFAULT_WIDTHS)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerH, setContainerH] = useState(600)

  const startResize = (e, idx) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[idx]
    const onMove = (ev) => {
      const newW = Math.max(COL_MIN, startW + ev.clientX - startX)
      setColWidths(w => { const n = [...w]; n[idx] = newW; return n })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Build interleaved list of flow rows and pause-marker rows
  const items = useMemo(() => {
    if (!pauseEvents?.length) return flows
    const pauses = pauseEvents
      .filter(e => e.type === 'pause')
      .sort((a, b) => a.at - b.at)
    if (!pauses.length) return flows

    const result = []
    for (let i = 0; i < flows.length; i++) {
      if (i > 0) {
        const prevTs = flows[i - 1].time ? new Date(flows[i - 1].time).getTime() / 1000 : -Infinity
        const curTs  = flows[i].time     ? new Date(flows[i].time).getTime()     / 1000 :  Infinity
        for (const p of pauses) {
          if (p.at > prevTs && p.at < curTs) {
            result.push({ _pauseAt: p.at })
          }
        }
      }
      result.push(flows[i])
    }
    return result
  }, [flows, pauseEvents])

  // Track container height for virtual scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setContainerH(el.clientHeight)
    const ro = new ResizeObserver(() => setContainerH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // When autoScroll turns on, snap to bottom immediately
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
  }, [autoScroll])

  // When new items arrive and autoScroll is on, only scroll if already near bottom
  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return
    const el = scrollRef.current
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight
      setScrollTop(el.scrollTop)
    }
  }, [items.length])

  const timeStr = (iso) => {
    if (!iso) return ''
    try { return new Date(iso).toLocaleTimeString('en-US', { hour12: false }) } catch { return iso }
  }

  const totalW = colWidths.reduce((s, w) => s + w, 0)

  const effectiveScrollTop = scrollTop
  const startIdx = Math.max(0, Math.floor(effectiveScrollTop / ROW_H) - OVERSCAN)
  const endIdx = Math.min(items.length, Math.ceil((effectiveScrollTop + containerH) / ROW_H) + OVERSCAN)
  const topPad = startIdx * ROW_H
  const bottomPad = Math.max(0, (items.length - endIdx) * ROW_H)

  const cols = ['Time', 'Method', 'Status', 'Host', 'Path', 'ms', 'Process']

  return (
    <div className="flow-table-wrap">
      <div className="section-header">
        <span>Traffic</span>
        <span className="section-header__count">{flows.length} flows</span>
        {onClear && (
          <button className="btn btn--icon section-header__clear" onClick={onClear} title="Clear HTTP flows">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="flow-scroll" ref={scrollRef} onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
        <table className="flow-table" style={{ width: totalW, minWidth: '100%' }}>
          <colgroup>
            {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map((label, i) => (
                <th key={label}>
                  {label}
                  {i < cols.length - 1 && (
                    <div className="col-resize-handle" onMouseDown={e => startResize(e, i)} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topPad > 0 && <tr key="pad-top"><td colSpan={7} style={{ height: topPad, padding: 0, border: 'none' }} /></tr>}
            {items.slice(startIdx, endIdx).map((item) => {
              if (item._pauseAt !== undefined) {
                return (
                  <tr key={`pause-${item._pauseAt}`} className="flow-pause-row">
                    <td colSpan={7}>
                      Capture paused · {new Date(item._pauseAt * 1000).toLocaleTimeString('en-US', { hour12: false })}
                    </td>
                  </tr>
                )
              }
              const flow = item
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
                </tr>
              )
            })}
            {bottomPad > 0 && <tr key="pad-bottom"><td colSpan={7} style={{ height: bottomPad, padding: 0, border: 'none' }} /></tr>}
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
