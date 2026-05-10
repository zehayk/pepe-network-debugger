import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

const PAUSE_PX = 22
const BAR_GAP = 1
const GRAPH_H = 90
const TOP_PAD = 6
const BOT_PAD = 18

function bktSize(dur) {
  if (dur < 120) return 1
  if (dur < 7200) return 60
  return 3600
}

function bktLabel(sz) {
  if (sz === 1) return 'req/s'
  if (sz === 60) return 'req/min'
  return 'req/hr'
}

function buildSegs(t0, t1, events) {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const segs = []
  let cur = t0
  let paused = false
  for (const ev of sorted) {
    const at = Math.max(cur, Math.min(ev.at, t1))
    if (at > cur) segs.push({ start: cur, end: at, type: paused ? 'pause' : 'active' })
    cur = at
    paused = ev.type === 'pause'
    if (cur >= t1) break
  }
  if (cur < t1) segs.push({ start: cur, end: t1, type: paused ? 'pause' : 'active' })
  return segs.filter(s => s.end > s.start)
}

function layoutSegs(segs, totalW) {
  const activeDur = segs.filter(s => s.type === 'active').reduce((sum, s) => sum + s.end - s.start, 0)
  const numPauses = segs.filter(s => s.type === 'pause').length
  const activePx = Math.max(0, totalW - numPauses * PAUSE_PX)
  let x = 0
  return segs.map(seg => {
    const w = seg.type === 'pause'
      ? PAUSE_PX
      : (activeDur > 0 ? ((seg.end - seg.start) / activeDur) * activePx : 0)
    const out = { ...seg, x, w }
    x += w
    return out
  })
}

function timeToX(layout, t) {
  for (const seg of layout) {
    if (t >= seg.start && t <= seg.end) {
      if (seg.type === 'pause') return seg.x + seg.w / 2
      const f = seg.end > seg.start ? (t - seg.start) / (seg.end - seg.start) : 0
      return seg.x + f * seg.w
    }
  }
  if (!layout.length) return 0
  if (t < layout[0].start) return layout[0].x
  const last = layout[layout.length - 1]
  return last.x + last.w
}

function xToTimeSnap(layout, x, preferEnd) {
  for (let i = 0; i < layout.length; i++) {
    const seg = layout[i]
    if (x >= seg.x && x < seg.x + seg.w) {
      if (seg.type === 'active') {
        const f = seg.w > 0 ? (x - seg.x) / seg.w : 0
        return seg.start + f * (seg.end - seg.start)
      }
      // pause segment — snap to boundary
      if (!preferEnd) {
        for (let j = i - 1; j >= 0; j--) {
          if (layout[j].type === 'active') return layout[j].end
        }
      }
      for (let j = i + 1; j < layout.length; j++) {
        if (layout[j].type === 'active') return layout[j].start
      }
      return null
    }
  }
  if (!layout.length) return null
  if (x < layout[0].x) return layout[0].start
  const last = layout[layout.length - 1]
  return last.end
}

export default function TrafficGraph({ allFlows, pauseEvents, onTimeSelect, timeRange, paused }) {
  const containerRef = useRef(null)
  const [svgW, setSvgW] = useState(400)
  const [drag, setDrag] = useState(null) // { x0, x1 }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSvgW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const graphData = useMemo(() => {
    const ts = allFlows
      .map(f => f.time ? new Date(f.time).getTime() / 1000 : null)
      .filter(t => t !== null)
      .sort((a, b) => a - b)
    if (!ts.length) return null

    const t0 = ts[0]
    const lastPauseAt = pauseEvents.filter(e => e.type === 'pause').slice(-1)[0]?.at
    const t1 = paused && lastPauseAt
      ? Math.max(ts[ts.length - 1], lastPauseAt)
      : Math.max(ts[ts.length - 1], Date.now() / 1000 - 0.5)
    const dur = t1 - t0
    const bs = bktSize(dur)

    const buckets = {}
    for (const t of ts) {
      const b = Math.floor(t / bs) * bs
      buckets[b] = (buckets[b] || 0) + 1
    }

    const segs = buildSegs(t0, t1, pauseEvents)
    return { t0, t1, bs, buckets, segs }
  }, [allFlows, pauseEvents, paused]) // eslint-disable-line react-hooks/exhaustive-deps

  const layout = useMemo(
    () => graphData ? layoutSegs(graphData.segs, svgW) : [],
    [graphData, svgW]
  )

  const maxCount = useMemo(() => {
    if (!graphData) return 1
    const vals = Object.values(graphData.buckets)
    return vals.length ? Math.max(1, ...vals) : 1
  }, [graphData])

  const chartH = GRAPH_H - TOP_PAD - BOT_PAD

  const getX = (e) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return rect ? Math.max(0, Math.min(e.clientX - rect.left, svgW)) : 0
  }

  const handleMouseDown = (e) => {
    if (!graphData || e.button !== 0) return
    const x = getX(e)
    setDrag({ x0: x, x1: x })
    e.preventDefault()
  }

  useEffect(() => {
    if (!drag) return
    const onMove = (e) => setDrag(d => d ? { ...d, x1: getX(e) } : null)
    const onUp = (e) => {
      const x = getX(e)
      const x0 = Math.min(drag.x0, x)
      const x1 = Math.max(drag.x0, x)
      if (x1 - x0 < 5) {
        onTimeSelect(null)
      } else {
        const t0 = xToTimeSnap(layout, x0, false)
        const t1 = xToTimeSnap(layout, x1, true)
        if (t0 !== null && t1 !== null && t1 > t0) onTimeSelect({ start: t0, end: t1 })
      }
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [drag, layout, onTimeSelect]) // eslint-disable-line react-hooks/exhaustive-deps

  const dragRect = drag ? {
    x: Math.min(drag.x0, drag.x1),
    w: Math.abs(drag.x1 - drag.x0),
  } : null

  const rangeRect = (timeRange && layout.length) ? (() => {
    const rx0 = timeToX(layout, timeRange.start)
    const rx1 = timeToX(layout, timeRange.end)
    return { x: Math.min(rx0, rx1), w: Math.abs(rx1 - rx0) }
  })() : null

  if (!graphData) {
    return (
      <div ref={containerRef} className="traffic-graph traffic-graph--empty">
        <span>No traffic</span>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="traffic-graph">
      <svg
        width={svgW}
        height={GRAPH_H}
        style={{ display: 'block', cursor: 'crosshair' }}
        onMouseDown={handleMouseDown}
      >
        <defs>
          <pattern id="pg-hatch" width="6" height="6" patternUnits="userSpaceOnUse">
            <line x1="0" y1="6" x2="6" y2="0" stroke="var(--error)" strokeWidth="1.2" opacity="0.5" />
          </pattern>
        </defs>

        {/* Bars */}
        {Object.entries(graphData.buckets).map(([bStr, count]) => {
          const bs = graphData.bs
          const bStart = Number(bStr)
          const bEnd = bStart + bs
          for (const seg of layout) {
            if (seg.type !== 'active') continue
            if (bEnd <= seg.start || bStart >= seg.end) continue
            const cs = Math.max(bStart, seg.start)
            const ce = Math.min(bEnd, seg.end)
            const dur = seg.end - seg.start
            if (dur <= 0) continue
            const xS = seg.x + ((cs - seg.start) / dur) * seg.w
            const xE = seg.x + ((ce - seg.start) / dur) * seg.w
            const bW = Math.max(1, xE - xS - BAR_GAP)
            const bH = Math.max(2, (count / maxCount) * chartH)
            return (
              <rect
                key={bStr}
                x={xS}
                y={TOP_PAD + chartH - bH}
                width={bW}
                height={bH}
                fill="var(--accent)"
                opacity="0.72"
                rx="1"
              />
            )
          }
          return null
        })}

        {/* Pause segments */}
        {layout.filter(s => s.type === 'pause').map((seg, i) => (
          <g key={i}>
            <rect x={seg.x} y={TOP_PAD} width={seg.w} height={chartH} fill="url(#pg-hatch)" />
            <line
              x1={seg.x + 0.5} y1={0}
              x2={seg.x + 0.5} y2={GRAPH_H - BOT_PAD}
              stroke="var(--error)" strokeWidth="1.5" strokeDasharray="3,2"
            />
          </g>
        ))}

        {/* Active time range highlight */}
        {rangeRect && rangeRect.w > 0 && (
          <rect
            x={rangeRect.x} y={TOP_PAD}
            width={rangeRect.w} height={chartH}
            fill="var(--accent)" opacity="0.12"
            stroke="var(--accent)" strokeWidth="1"
          />
        )}

        {/* Drag selection */}
        {dragRect && dragRect.w > 2 && (
          <rect
            x={dragRect.x} y={TOP_PAD}
            width={dragRect.w} height={chartH}
            fill="var(--accent)" opacity="0.20"
            stroke="var(--accent)" strokeWidth="1" strokeDasharray="4,2"
          />
        )}

        {/* Axis line */}
        <line
          x1={0} y1={TOP_PAD + chartH}
          x2={svgW} y2={TOP_PAD + chartH}
          stroke="var(--border)" strokeWidth="1"
        />

        {/* Left label */}
        <text x={4} y={GRAPH_H - 4} fill="var(--muted)" fontSize={9} fontFamily="var(--font-ui)">
          {bktLabel(graphData.bs)}
        </text>

        {/* Paused indicator */}
        {paused && (
          <text x={svgW - 4} y={GRAPH_H - 4} fill="var(--error)" fontSize={9} textAnchor="end" fontFamily="var(--font-ui)">
            PAUSED
          </text>
        )}
      </svg>

      {timeRange && (
        <div className="traffic-graph__range-bar">
          <span className="traffic-graph__range-label">
            {new Date(timeRange.start * 1000).toLocaleTimeString('en-US', { hour12: false })}
            {' – '}
            {new Date(timeRange.end * 1000).toLocaleTimeString('en-US', { hour12: false })}
          </span>
          <button
            className="btn btn--icon traffic-graph__range-reset"
            onClick={() => onTimeSelect(null)}
            title="Clear time selection"
          >
            <X size={11} />
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
