import React, { useEffect, useRef, useState } from 'react'
import * as api from '../api.js'

function formatHex(hexStr) {
  if (!hexStr) return ''
  const lines = []
  for (let i = 0; i < hexStr.length; i += 32) {
    const slice = hexStr.slice(i, i + 32)
    const offset = (i / 2).toString(16).padStart(4, '0')
    const bytes = []
    const ascii = []
    for (let j = 0; j < slice.length; j += 2) {
      const b = parseInt(slice.slice(j, j + 2), 16)
      bytes.push(slice.slice(j, j + 2))
      ascii.push(b >= 32 && b < 127 ? String.fromCharCode(b) : '.')
    }
    const hexPart = bytes.reduce(
      (acc, b, idx) => acc + (idx === 8 ? '  ' : idx > 0 ? ' ' : '') + b,
      ''
    )
    lines.push(`${offset}  ${hexPart.padEnd(49)}  ${ascii.join('')}`)
  }
  return lines.join('\n')
}

export default function PacketDetail({ packet }) {
  const [hex, setHex] = useState(null)
  const [hexLoading, setHexLoading] = useState(false)
  const prevNoRef = useRef(null)

  useEffect(() => {
    if (!packet) return
    if (packet.no === prevNoRef.current) return
    prevNoRef.current = packet.no
    setHex(null)
    setHexLoading(true)
    api.getPacketHex(packet.no)
      .then(r => setHex(r.hex ?? ''))
      .catch(() => setHex(null))
      .finally(() => setHexLoading(false))
  }, [packet?.no])

  if (!packet) {
    return (
      <div className="detail-empty" style={{ height: '100%' }}>
        Select a packet to inspect
      </div>
    )
  }

  const fmtTime = (ts) => {
    if (!ts) return ''
    return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 23)
  }

  return (
    <div className="detail-panel">
      <div className="section-header">
        Packet #{packet.no}
        <span className="section-header__count">{packet.length} B · {packet.protocol}</span>
      </div>
      <div className="detail-content">
        <div className="detail-kv">
          {[
            ['No', String(packet.no)],
            ['Time', fmtTime(packet.ts)],
            ['Protocol', packet.protocol],
            ['Source', `${packet.src ?? ''}${packet.sport != null ? ':' + packet.sport : ''}`],
            ['Destination', `${packet.dst ?? ''}${packet.dport != null ? ':' + packet.dport : ''}`],
            ['Length', `${packet.length} B`],
            ['Info', packet.info ?? ''],
          ].map(([k, v]) => (
            <React.Fragment key={k}>
              <div className="detail-kv__key">{k}</div>
              <div className="detail-kv__val">{v}</div>
            </React.Fragment>
          ))}
        </div>

        <div className="section-label">Hex Dump</div>
        {hexLoading && (
          <div className="muted" style={{ fontSize: 11 }}>Loading…</div>
        )}
        {!hexLoading && hex !== null && hex !== '' && (
          <pre className="code-block" style={{ fontSize: 11, lineHeight: 1.6, userSelect: 'text' }}>
            {formatHex(hex)}
          </pre>
        )}
        {!hexLoading && hex === '' && (
          <div className="muted" style={{ fontSize: 11 }}>Empty packet</div>
        )}
        {!hexLoading && hex === null && (
          <div className="muted" style={{ fontSize: 11 }}>
            Hex not available — packet evicted from ring buffer
          </div>
        )}
      </div>
    </div>
  )
}
