import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket.js'
import TitleBar from './components/TitleBar.jsx'
import Toolbar from './components/Toolbar.jsx'
import FilterBar from './components/FilterBar.jsx'
import FlowTable from './components/FlowTable.jsx'
import FlowDetail from './components/FlowDetail.jsx'
import RulesPanel from './components/RulesPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import TrafficGraph from './components/TrafficGraph.jsx'
import StreamsTable from './components/StreamsTable.jsx'
import StreamDetail from './components/StreamDetail.jsx'
import PacketsTable from './components/PacketsTable.jsx'
import PacketDetail from './components/PacketDetail.jsx'
import OverrideResponseDialog from './components/dialogs/OverrideResponseDialog.jsx'
import OverrideRequestDialog from './components/dialogs/OverrideRequestDialog.jsx'
import BlockDialog from './components/dialogs/BlockDialog.jsx'
import ProxyConfigDialog from './components/dialogs/ProxyConfigDialog.jsx'
import SendDialog from './components/dialogs/SendDialog.jsx'
import CloseConfirmDialog from './components/dialogs/CloseConfirmDialog.jsx'
import ContextMenu from './components/ContextMenu.jsx'
import * as api from './api.js'

// ── State ─────────────────────────────────────────────────────────────────────

const MAX_FLOWS = 5000
const MAX_PACKETS = 5000

const initialState = {
  flows: {},        // id → flow
  order: [],        // [id, ...]
  respOverrides: [], // serializable list from service
  reqOverrides: [],
  blocks: [],
  bypass: [],
  settings: { stream_only: true, target_mode: false, proxy_listen_host: '127.0.0.1', proxy_listen_port: 8080 },
}

function reducer(state, action) {
  switch (action.type) {
    case 'UPSERT': {
      const flow = action.flow
      const exists = flow.id in state.flows
      return {
        ...state,
        flows: { ...state.flows, [flow.id]: flow },
        order: exists ? state.order : [...state.order, flow.id],
      }
    }
    case 'UPSERT_BATCH': {
      const incoming = action.flows
      const flows = { ...state.flows }
      const order = [...state.order]
      for (const flow of incoming) {
        if (!(flow.id in flows)) order.push(flow.id)
        flows[flow.id] = flow
      }
      if (order.length > MAX_FLOWS) {
        const removed = order.splice(0, order.length - MAX_FLOWS)
        for (const id of removed) delete flows[id]
      }
      return { ...state, flows, order }
    }

    case 'CLEAR':
      return { ...state, flows: {}, order: [] }

    case 'SNAPSHOT':
      return {
        flows: Object.fromEntries(action.flows.map(f => [f.id, f])),
        order: action.flows.map(f => f.id),
        respOverrides: action.resp_overrides,
        reqOverrides: action.req_overrides,
        blocks: action.blocks,
        bypass: action.bypass ?? [],
        settings: action.settings ?? state.settings,
      }

    case 'SET_RULES':
      return {
        ...state,
        respOverrides: action.resp_overrides ?? state.respOverrides,
        reqOverrides: action.req_overrides ?? state.reqOverrides,
        blocks: action.blocks ?? state.blocks,
        bypass: action.bypass ?? state.bypass,
      }

    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }

    default:
      return state
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flowVisible(flow, filter, errorsOnly, regexMode) {
  const code = flow.status_code
  const isErr = code === 'ERROR' || (typeof code === 'number' && code >= 400)
  if (errorsOnly && !isErr) return false
  if (!filter) return true

  const haystack = [
    flow.method, flow.host, flow.path, flow.url,
    String(flow.status_code ?? ''), flow.status_reason, flow.process_name,
  ].map(v => (v ?? '').toLowerCase()).join(' ')

  if (regexMode) {
    try {
      return new RegExp(filter, 'i').test(haystack)
    } catch {
      return false
    }
  }
  return filter.toLowerCase().trim().split(/\s+/).filter(Boolean)
    .every(term => haystack.includes(term))
}

function b64decode(b64) {
  try { return atob(b64 ?? '') } catch { return '' }
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [connected, setConnected] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('')
  const [regexMode, setRegexMode] = useState(false)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [leftTab, setLeftTab] = useState('http')      // 'http' | 'streams' | 'raw'
  const [showGraph, setShowGraph] = useState(true)
  const [showRules, setShowRules] = useState(false)
  const [showProxy, setShowProxy] = useState(false)
  const [dialog, setDialog] = useState(null) // { type, data, override? }
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, flow }
  const [showSettings, setShowSettings] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const splitRef = useRef(null)
  const pendingFlows = useRef([])
  const flushTimer = useRef(null)
  const [leftWidth, setLeftWidth] = useState(650)
  const [winProxy, setWinProxy] = useState(null)

  // Pause / time-range state
  const pausedRef = useRef(false)
  const [paused, setPaused] = useState(false)
  const [pauseEvents, setPauseEvents] = useState([]) // [{at: unixSec, type: 'pause'|'resume'}]
  const [timeRange, setTimeRange] = useState(null)   // null | {start, end} in unix seconds

  // WebSocket / stream state (also used for gRPC)
  const [wsConns, setWsConns] = useState({})   // id → conn
  const [wsOrder, setWsOrder] = useState([])   // [id, ...]
  const [wsMsgs, setWsMsgs] = useState({})     // id → [msg, ...]
  const [selectedStreamId, setSelectedStreamId] = useState(null)

  // Raw packet capture state
  const [packets, setPackets] = useState([])
  const [selectedPacketNo, setSelectedPacketNo] = useState(null)
  const [captureRunning, setCaptureRunning] = useState(false)
  const [captureError, setCaptureError] = useState(null)
  const pktPendingRef = useRef([])
  const pktFlushTimerRef = useRef(null)

  const selectedFlow = selectedId ? state.flows[selectedId] : null

  // ── Close dialog via IPC ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = window.electron
    if (!el?.onRequestClose) return
    el.onRequestClose(() => setShowClose(true))
  }, [])

  useEffect(() => {
    api.getWinProxy().then(setWinProxy).catch(() => {})
  }, [])

  const applyProxy = async (host, port, winEnabled) => {
    const addr = `${host}:${port}`
    // Always send listen address — backend only restarts mitmproxy if values actually changed
    try {
      await api.updateSettings({ proxy_listen_host: host, proxy_listen_port: parseInt(port) })
    } catch {}
    // Always update Windows system proxy, then re-fetch real state from backend
    try {
      await api.setWinProxy(winEnabled, addr)
    } catch {}
    try {
      const actual = await api.getWinProxy()
      setWinProxy(actual)
    } catch {}
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'connected') { setConnected(true); return }
    if (msg.type === 'disconnected') { setConnected(false); return }
    if (msg.type === 'upsert') {
      if (!pausedRef.current) {
        pendingFlows.current.push(msg.flow)
        if (!flushTimer.current) {
          flushTimer.current = setTimeout(() => {
            dispatch({ type: 'UPSERT_BATCH', flows: pendingFlows.current })
            pendingFlows.current = []
            flushTimer.current = null
          }, 50)
        }
      }
      return
    }
    if (msg.type === 'clear') {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
      pendingFlows.current = []
      dispatch({ type: 'CLEAR' })
      setPauseEvents([])
      setTimeRange(null)
      return
    }
    if (msg.type === 'snapshot') {
      if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
      pendingFlows.current = []
      dispatch({
        type: 'SNAPSHOT',
        flows: msg.flows,
        resp_overrides: msg.resp_overrides,
        req_overrides: msg.req_overrides,
        blocks: msg.blocks,
        bypass: msg.bypass,
        settings: msg.settings,
      })
      setPauseEvents([])
      setTimeRange(null)
      setWsConns({})
      setWsOrder([])
      setWsMsgs({})
      setPackets([])
      setSelectedPacketNo(null)
      return
    }
    if (msg.type === 'ws_start' || msg.type === 'grpc_start') {
      setWsConns(c => ({ ...c, [msg.conn.id]: msg.conn }))
      setWsOrder(o => o.includes(msg.conn.id) ? o : [...o, msg.conn.id])
      return
    }
    if (msg.type === 'ws_message' || msg.type === 'grpc_frame') {
      setWsConns(c => {
        const conn = c[msg.conn_id]
        if (!conn) return c
        return { ...c, [msg.conn_id]: { ...conn, msg_count: msg.msg_count } }
      })
      setWsMsgs(m => {
        const existing = m[msg.conn_id] ?? []
        const capped = existing.length >= 1000 ? existing.slice(1) : existing
        const raw = msg.msg
        const prettyContent = raw.kind === 'base64'
          ? `[protobuf/binary ${raw.size ?? 0} B]\n${raw.content}`
          : raw.kind === 'binary' ? '[binary data]' : (() => {
              if (!raw.content) return ''
              try { return JSON.stringify(JSON.parse(raw.content), null, 2) } catch { return raw.content }
            })()
        return { ...m, [msg.conn_id]: [...capped, { ...raw, prettyContent }] }
      })
      return
    }
    if (msg.type === 'ws_end' || msg.type === 'grpc_end') {
      setWsConns(c => {
        const conn = c[msg.conn_id]
        if (!conn) return c
        return { ...c, [msg.conn_id]: { ...conn, status: msg.status } }
      })
      return
    }
    if (msg.type === 'raw_packets') {
      if (!pausedRef.current) {
        pktPendingRef.current.push(...msg.packets)
        if (!pktFlushTimerRef.current) {
          pktFlushTimerRef.current = setTimeout(() => {
            const batch = pktPendingRef.current
            pktPendingRef.current = []
            pktFlushTimerRef.current = null
            setPackets(prev => {
              const combined = [...prev, ...batch]
              return combined.length > MAX_PACKETS ? combined.slice(-MAX_PACKETS) : combined
            })
          }, 50)
        }
      }
      return
    }
    if (msg.type === 'capture_error') {
      setCaptureError(msg.message)
      setCaptureRunning(false)
      return
    }
    if (msg.type === 'capture_stopped') {
      setCaptureRunning(false)
      return
    }
    if (msg.type === 'rules') {
      dispatch({
        type: 'SET_RULES',
        resp_overrides: msg.resp_overrides,
        req_overrides: msg.req_overrides,
        blocks: msg.blocks,
        bypass: msg.bypass,
      })
      return
    }
    if (msg.type === 'settings') {
      const { type, ...settings } = msg
      dispatch({ type: 'SET_SETTINGS', settings })
      return
    }
    if (msg.type === 'proxy_restarted') {
      dispatch({ type: 'SET_SETTINGS', settings: { proxy_listen_host: msg.host, proxy_listen_port: msg.port } })
      return
    }
  }, []) // pausedRef is stable, no deps needed

  useWebSocket(handleWsMessage)

  // ── Derived ───────────────────────────────────────────────────────────────────

  // Stable reference for graph (timestamps don't change after first UPSERT)
  const allFlows = useMemo(
    () => state.order.map(id => state.flows[id]).filter(Boolean),
    [state.order] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Fresh reference for FlowTable (needs latest status_code, duration_ms, etc.)
  const visibleFlows = useMemo(() => {
    let flows = state.order
      .map(id => state.flows[id])
      .filter(f => f && flowVisible(f, filter, errorsOnly, regexMode))
    if (timeRange) {
      flows = flows.filter(f => {
        const ts = f.time ? new Date(f.time).getTime() / 1000 : 0
        return ts >= timeRange.start && ts <= timeRange.end
      })
    }
    return flows
  }, [state.order, state.flows, filter, errorsOnly, regexMode, timeRange])

  // ── Actions ───────────────────────────────────────────────────────────────────

  const clearHttp = () => api.clearFlows().catch(() => {})

  const clearStreams = () => {
    setWsConns({})
    setWsOrder([])
    setWsMsgs({})
    setSelectedStreamId(null)
  }

  const clearRaw = () => {
    if (pktFlushTimerRef.current) { clearTimeout(pktFlushTimerRef.current); pktFlushTimerRef.current = null }
    pktPendingRef.current = []
    setPackets([])
    setSelectedPacketNo(null)
  }

  const clearAll = async () => {
    clearStreams()
    clearRaw()
    setPauseEvents([])
    setTimeRange(null)
    await clearHttp()
  }

  const togglePause = () => {
    const now = Date.now() / 1000
    const newPaused = !pausedRef.current
    pausedRef.current = newPaused
    setPaused(newPaused)
    setPauseEvents(evs => [...evs, { at: now, type: newPaused ? 'pause' : 'resume' }])
  }

  const openRespOverride = (flow) => {
    if (!flow) return
    setDialog({ type: 'resp-override', data: flow })
  }

  const openReqOverride = (flow) => {
    if (!flow) return
    setDialog({ type: 'req-override', data: flow })
  }

  const openBlock = (flow, kind) => {
    setDialog({ type: 'block', data: { flow, kind } })
  }

  const openSend = (flow) => {
    setDialog({ type: 'send', data: flow ?? null })
  }

  const replay = async (flow) => {
    if (!flow) return
    await api.replayFlow(flow.id)
  }

  const handleCtxMenu = (e, flow) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, flow })
  }

  const closeCtxMenu = () => setCtxMenu(null)

  // ── Edit override rules (double-click from RulesPanel) ────────────────────────

  const editRespOverride = (rule) => {
    const fakeFlow = {
      method: rule.sig?.[0] ?? '',
      scheme: rule.sig?.[1] ?? '',
      host: rule.sig?.[2] ?? '',
      port: rule.sig?.[3] ?? 80,
      path: rule.sig?.[4] ?? '',
      url: `${rule.sig?.[1] ?? 'http'}://${rule.sig?.[2] ?? ''}${rule.sig?.[4] ?? '/'}`,
      status_code: rule.status_code,
      status_reason: rule.reason ?? '',
      response: { content_type: rule.content_type ?? '', headers: rule.headers ?? {} },
    }
    const initialOverride = {
      status_code: rule.status_code,
      reason: rule.reason ?? '',
      content_type: rule.content_type ?? '',
      headers: rule.headers ?? {},
      body: rule.body_b64 ? { kind: 'text', value: b64decode(rule.body_b64) } : { kind: 'empty' },
    }
    setDialog({ type: 'resp-override', data: fakeFlow, override: initialOverride })
  }

  const editReqOverride = (rule) => {
    const fakeFlow = {
      method: rule.sig?.[0] ?? '',
      scheme: rule.sig?.[1] ?? '',
      host: rule.sig?.[2] ?? '',
      port: rule.sig?.[3] ?? 80,
      path: rule.sig?.[4] ?? '',
      url: `${rule.sig?.[1] ?? 'http'}://${rule.sig?.[2] ?? ''}${rule.sig?.[4] ?? '/'}`,
      request: { headers: rule.headers ?? {} },
    }
    const initialOverride = {
      method: rule.method ?? '',
      url: rule.url ?? '',
      headers: rule.headers ?? {},
      body: rule.body_b64 ? { kind: 'text', value: b64decode(rule.body_b64) } : { kind: 'empty' },
    }
    setDialog({ type: 'req-override', data: fakeFlow, override: initialOverride })
  }

  // ── Save / Load session ───────────────────────────────────────────────────────

  const saveSession = async () => {
    try {
      const { flows } = await api.exportSession()
      const blob = new Blob([flows.map(f => JSON.stringify(f)).join('\n')], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pepe-session-${Date.now()}.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Save failed: ' + e.message)
    }
  }

  const loadSession = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.jsonl,.json'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return
      const text = await file.text()
      const flows = text.split('\n').filter(Boolean).map(l => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
      await api.importSession(flows)
    }
    input.click()
  }

  // ── Resizable split ───────────────────────────────────────────────────────────

  const startDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = leftWidth

    const onMove = (e) => {
      const delta = e.clientX - startX
      const containerW = splitRef.current?.offsetWidth ?? 1200
      const newW = Math.min(Math.max(startW + delta, 300), containerW - 300)
      setLeftWidth(newW)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Packet capture ────────────────────────────────────────────────────────────

  const startCapture = async (iface, filter) => {
    setCaptureError(null)
    try {
      const r = await api.startCapture(iface, filter)
      if (r.ok) {
        setCaptureRunning(true)
      } else {
        setCaptureError(r.error || 'Failed to start capture')
      }
    } catch (e) {
      setCaptureError(e.message)
    }
  }

  const stopCapture = async () => {
    try { await api.stopCapture() } catch {}
    setCaptureRunning(false)
  }

  // ── Copy proxy ────────────────────────────────────────────────────────────────

  const copyProxy = () => {
    const addr = `${state.settings.proxy_listen_host || '127.0.0.1'}:${state.settings.proxy_listen_port || 8080}`
    navigator.clipboard.writeText(addr)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="app" onClick={closeCtxMenu}>
      <TitleBar
        connected={connected}
        proxyAddr={`${state.settings.proxy_listen_host || '127.0.0.1'}:${state.settings.proxy_listen_port || 8080}`}
        winProxyEnabled={winProxy?.enabled ?? false}
      />
      <Toolbar
        selectedFlow={selectedFlow}
        paused={paused}
        onTogglePause={togglePause}
        showGraph={showGraph}
        onToggleGraph={() => setShowGraph(g => !g)}
        onRules={() => setShowRules(true)}
        onProxy={() => setShowProxy(true)}
        onReplay={() => replay(selectedFlow)}
        onEditSend={() => openSend(selectedFlow)}
        onRespOverride={() => openRespOverride(selectedFlow)}
        onReqOverride={() => openReqOverride(selectedFlow)}
        onClearOverrides={async () => { await api.clearRespOverrides(); await api.clearReqOverrides() }}
        onBlockHost={() => openBlock(selectedFlow, 'host')}
        onBlockUrl={() => openBlock(selectedFlow, 'url')}
        onBlockProcess={() => openBlock(selectedFlow, 'process')}
        onBlockIp={() => openBlock(selectedFlow, 'ip')}
        onAddBlock={() => setDialog({ type: 'block', data: { flow: null, kind: 'host' } })}
        onClearBlocks={() => api.clearBlocks()}
        onClear={clearAll}
        onCopyProxy={copyProxy}
        onSaveSession={saveSession}
        onLoadSession={loadSession}
        onSettings={() => setShowSettings(true)}
      />
      <FilterBar
        filter={filter}
        onFilter={setFilter}
        regexMode={regexMode}
        onRegexMode={setRegexMode}
        errorsOnly={errorsOnly}
        onErrorsOnly={setErrorsOnly}
        autoScroll={autoScroll}
        onAutoScroll={setAutoScroll}
        count={visibleFlows.length}
        total={state.order.length}
      />

      <div className="main-split" ref={splitRef}>
        <div className="split-left" style={{ width: leftWidth, flexShrink: 0 }}>
          <div className="left-sub-tabs">
            <button
              className={`left-sub-tab ${leftTab === 'http' ? 'left-sub-tab--active' : ''}`}
              onClick={() => setLeftTab('http')}
            >HTTP</button>
            <button
              className={`left-sub-tab ${leftTab === 'streams' ? 'left-sub-tab--active' : ''}`}
              onClick={() => setLeftTab('streams')}
            >
              Streams
              {wsOrder.length > 0 && <span className="left-sub-tab__count">{wsOrder.length}</span>}
            </button>
            <button
              className={`left-sub-tab ${leftTab === 'raw' ? 'left-sub-tab--active' : ''}`}
              onClick={() => setLeftTab('raw')}
            >
              Raw
              {captureRunning && <span className="left-sub-tab__count" style={{ color: 'var(--error)', background: 'color-mix(in srgb, var(--error) 15%, transparent)' }}>●</span>}
            </button>
          </div>

          {leftTab === 'http' && showGraph && (
            <TrafficGraph
              allFlows={allFlows}
              pauseEvents={pauseEvents}
              paused={paused}
              timeRange={timeRange}
              onTimeSelect={setTimeRange}
            />
          )}
          {leftTab === 'http' && (
            <FlowTable
              flows={visibleFlows}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onContextMenu={handleCtxMenu}
              autoScroll={autoScroll}
              pauseEvents={pauseEvents}
              onClear={clearHttp}
            />
          )}
          {leftTab === 'streams' && (
            <StreamsTable
              conns={wsConns}
              order={wsOrder}
              selectedId={selectedStreamId}
              onSelect={setSelectedStreamId}
              autoScroll={autoScroll}
              onClear={clearStreams}
            />
          )}
          {leftTab === 'raw' && (
            <PacketsTable
              packets={packets}
              selectedNo={selectedPacketNo}
              onSelect={setSelectedPacketNo}
              captureRunning={captureRunning}
              onStart={startCapture}
              onStop={stopCapture}
              captureError={captureError}
              onClear={clearRaw}
            />
          )}
        </div>

        <div
          className="split-divider"
          onMouseDown={startDrag}
          style={{ cursor: 'col-resize' }}
        />

        <div className="split-right">
          {leftTab === 'http' && <FlowDetail flow={selectedFlow} />}
          {leftTab === 'streams' && (
            <StreamDetail
              conn={wsConns[selectedStreamId] ?? null}
              messages={wsMsgs[selectedStreamId] ?? []}
            />
          )}
          {leftTab === 'raw' && (
            <PacketDetail
              packet={packets.find(p => p.no === selectedPacketNo) ?? null}
            />
          )}
        </div>
      </div>

      {/* ── Dialogs ────────────────────────────────────────────────────────────── */}
      {dialog?.type === 'resp-override' && (
        <OverrideResponseDialog
          flow={dialog.data}
          initialOverride={dialog.override}
          onSave={async (rule) => {
            await api.setRespOverride(api.entrySig(dialog.data), rule)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'req-override' && (
        <OverrideRequestDialog
          flow={dialog.data}
          initialOverride={dialog.override}
          onSave={async (rule) => {
            await api.setReqOverride(api.entrySig(dialog.data), rule)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'block' && (
        <BlockDialog
          initialKind={dialog.data.kind}
          initialValue={
            dialog.data.kind === 'host'    ? (dialog.data.flow?.host ?? '') :
            dialog.data.kind === 'url'     ? (dialog.data.flow?.url ?? '') :
            dialog.data.kind === 'process' ? (dialog.data.flow?.process_name ?? '') :
            dialog.data.kind === 'ip'      ? (dialog.data.flow?.host ?? '') : ''
          }
          onSave={async (kind, value, responseType, bodyB64) => {
            await api.addBlock(kind, value, responseType, bodyB64)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'send' && (
        <SendDialog
          flow={dialog.data}
          onSend={async ({ method, url, headers, body }) => {
            await api.sendRequest(method, url, headers, api.bytesToB64(body))
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {showRules && (
        <div className="dialog-overlay" onClick={() => setShowRules(false)}>
          <div
            className="dialog"
            style={{ width: 920, maxWidth: '95vw', height: '80vh', padding: 0, gap: 0, display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>Rules</span>
              <button className="btn btn--icon" onClick={() => setShowRules(false)}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              <RulesPanel
                respOverrides={state.respOverrides}
                reqOverrides={state.reqOverrides}
                blocks={state.blocks}
                bypass={state.bypass}
                onToggleResp={(sig) => api.toggleRespOverride(sig)}
                onRemoveResp={(sig) => api.removeRespOverride(sig)}
                onToggleReq={(sig) => api.toggleReqOverride(sig)}
                onRemoveReq={(sig) => api.removeReqOverride(sig)}
                onToggleBlock={(id) => api.toggleBlock(id)}
                onRemoveBlock={(id) => api.removeBlock(id)}
                onClearAll={async () => { await api.clearRespOverrides(); await api.clearReqOverrides() }}
                onClearBlocks={() => api.clearBlocks()}
                onAddBlock={() => { setShowRules(false); setDialog({ type: 'block', data: { flow: null, kind: 'host' } }) }}
                onToggleBypass={(id) => api.toggleBypass(id)}
                onRemoveBypass={(id) => api.removeBypass(id)}
                onAddBypass={(pattern, label, kind) => api.addBypass(pattern, label, kind)}
                onClearBypass={() => api.clearBypass()}
                onEditResp={editRespOverride}
                onEditReq={editReqOverride}
                onEditBlock={(id, data) => api.updateBlock(id, data)}
                onEditBypass={(id, data) => api.updateBypass(id, data)}
                settings={state.settings}
                onUpdateSettings={api.updateSettings}
              />
            </div>
          </div>
        </div>
      )}

      {showProxy && (
        <ProxyConfigDialog
          listenHost={state.settings.proxy_listen_host || '127.0.0.1'}
          listenPort={state.settings.proxy_listen_port || 8080}
          winProxy={winProxy}
          onApply={applyProxy}
          onClose={() => setShowProxy(false)}
          onOpen={() => api.getWinProxy().then(setWinProxy).catch(() => {})}
        />
      )}

      {showSettings && (
        <div className="dialog-overlay" onClick={() => setShowSettings(false)}>
          <div className="dialog dialog--sm" style={{ maxHeight: '80vh' }} onClick={e => e.stopPropagation()}>
            <div className="dialog__title" style={{ marginBottom: 4 }}>Settings</div>
            <SettingsPanel
              settings={state.settings}
              onUpdate={api.updateSettings}
            />
          </div>
        </div>
      )}

      {showClose && (
        <CloseConfirmDialog
          onConfirm={() => window.electron?.confirmClose()}
          onClose={() => setShowClose(false)}
        />
      )}

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          flow={ctxMenu.flow}
          onReplay={() => { replay(ctxMenu.flow); closeCtxMenu() }}
          onEditSend={() => { openSend(ctxMenu.flow); closeCtxMenu() }}
          onRespOverride={() => { openRespOverride(ctxMenu.flow); closeCtxMenu() }}
          onReqOverride={() => { openReqOverride(ctxMenu.flow); closeCtxMenu() }}
          onBlockHost={() => { openBlock(ctxMenu.flow, 'host'); closeCtxMenu() }}
          onBlockUrl={() => { openBlock(ctxMenu.flow, 'url'); closeCtxMenu() }}
          onBlockIp={() => { openBlock(ctxMenu.flow, 'ip'); closeCtxMenu() }}
          onCopyUrl={() => {
            navigator.clipboard.writeText(ctxMenu.flow?.url ?? '')
            closeCtxMenu()
          }}
          onCopyHost={() => {
            navigator.clipboard.writeText(ctxMenu.flow?.host ?? '')
            closeCtxMenu()
          }}
          onClose={closeCtxMenu}
        />
      )}
    </div>
  )
}
