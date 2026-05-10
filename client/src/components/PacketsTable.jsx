import React, { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import * as api from '../api.js'

const ROW_H = 24
const OVERSCAN = 8

export default function PacketsTable({
  packets,
  selectedNo,
  onSelect,
  captureRunning,
  onStart,
  onStop,
  captureError,
  onClear,
}) {
  const [interfaces, setInterfaces] = useState([])
  const [selectedIface, setSelectedIface] = useState('')
  const [bpfFilter, setBpfFilter] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(500)
  const scrollRef = useRef(null)

  useEffect(() => {
    api.getInterfaces().then(r => setInterfaces(r.interfaces ?? [])).catch(() => {})
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  // Auto-scroll to bottom on new packets (only when already near bottom)
  const prevLenRef = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || packets.length === prevLenRef.current) return
    prevLenRef.current = packets.length
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [packets.length])

  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(packets.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)
  const visible = packets.slice(start, end)
  const topSpace = start * ROW_H
  const bottomSpace = Math.max(0, (packets.length - end) * ROW_H)

  const fmtTime = (ts) => {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${ms}`
  }

  const handleStart = () => onStart(selectedIface || null, bpfFilter)

  return (
    <div className="flow-table-wrap">
      <div className="capture-controls">
        <select
          className="capture-iface-select"
          value={selectedIface}
          onChange={e => setSelectedIface(e.target.value)}
          disabled={captureRunning}
        >
          <option value="">All interfaces</option>
          {interfaces.map(iface => (
            <option key={iface.name} value={iface.name}>
              {iface.description}{iface.ips?.length ? ` (${iface.ips[0]})` : ''}
            </option>
          ))}
        </select>
        <input
          className="capture-filter-input"
          value={bpfFilter}
          onChange={e => setBpfFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !captureRunning) handleStart() }}
          placeholder="BPF filter (e.g. tcp port 443)"
          disabled={captureRunning}
        />
        {captureRunning ? (
          <button className="btn btn--danger" onClick={onStop}>■ Stop</button>
        ) : (
          <button className="btn btn--success" onClick={handleStart}>▶ Start</button>
        )}
        {captureRunning && <span className="capture-live-indicator">● LIVE</span>}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{packets.length} pkts</span>
        {onClear && (
          <button className="btn btn--icon" onClick={onClear} title="Clear raw packets" style={{ marginLeft: 4 }}>
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {captureError && (
        <div className="capture-error-bar">{captureError}</div>
      )}

      <div
        className="flow-scroll"
        ref={scrollRef}
        onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
      >
        <table className="flow-table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 44 }}>No.</th>
              <th style={{ width: 84 }}>Time</th>
              <th style={{ width: 120 }}>Source</th>
              <th style={{ width: 120 }}>Destination</th>
              <th style={{ width: 64 }}>Proto</th>
              <th style={{ width: 52 }}>Len</th>
              <th>Info</th>
            </tr>
          </thead>
          <tbody>
            {topSpace > 0 && (
              <tr style={{ height: topSpace }}><td colSpan={7} /></tr>
            )}
            {visible.map(pkt => (
              <tr
                key={pkt.no}
                className={selectedNo === pkt.no ? 'selected' : ''}
                onClick={() => onSelect(pkt.no)}
              >
                <td className="mono muted" style={{ fontSize: 11 }}>{pkt.no}</td>
                <td className="mono muted" style={{ fontSize: 10 }}>{fmtTime(pkt.ts)}</td>
                <td className="mono truncate" style={{ fontSize: 11 }}>
                  {pkt.src}{pkt.sport != null ? `:${pkt.sport}` : ''}
                </td>
                <td className="mono truncate" style={{ fontSize: 11 }}>
                  {pkt.dst}{pkt.dport != null ? `:${pkt.dport}` : ''}
                </td>
                <td>
                  <span className={`pkt-proto pkt-proto--${(pkt.protocol ?? 'other').toLowerCase()}`}>
                    {pkt.protocol}
                  </span>
                </td>
                <td className="muted" style={{ fontSize: 11 }}>{pkt.length}</td>
                <td className="truncate muted" style={{ fontSize: 11 }}>{pkt.info}</td>
              </tr>
            ))}
            {bottomSpace > 0 && (
              <tr style={{ height: bottomSpace }}><td colSpan={7} /></tr>
            )}
          </tbody>
        </table>
        {packets.length === 0 && (
          <div className="detail-empty" style={{ minHeight: 140 }}>
            {captureRunning ? 'Capturing packets…' : 'Press ▶ Start to capture raw packets (requires npcap + admin)'}
          </div>
        )}
      </div>
    </div>
  )
}
