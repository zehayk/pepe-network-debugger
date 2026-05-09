import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket.js'
import TitleBar from './components/TitleBar.jsx'
import Toolbar from './components/Toolbar.jsx'
import FilterBar from './components/FilterBar.jsx'
import FlowTable from './components/FlowTable.jsx'
import FlowDetail from './components/FlowDetail.jsx'
import RulesPanel from './components/RulesPanel.jsx'
import SettingsPanel from './components/SettingsPanel.jsx'
import OverrideResponseDialog from './components/dialogs/OverrideResponseDialog.jsx'
import OverrideRequestDialog from './components/dialogs/OverrideRequestDialog.jsx'
import BlockDialog from './components/dialogs/BlockDialog.jsx'
import SendDialog from './components/dialogs/SendDialog.jsx'
import CloseConfirmDialog from './components/dialogs/CloseConfirmDialog.jsx'
import ContextMenu from './components/ContextMenu.jsx'
import * as api from './api.js'

// ── State ─────────────────────────────────────────────────────────────────────

const initialState = {
  flows: {},        // id → flow
  order: [],        // [id, ...]
  respOverrides: [], // serializable list from service
  reqOverrides: [],
  blocks: [],
  bypass: [],
  settings: { stream_only: true, target_mode: false },
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
  const [rightTab, setRightTab] = useState('details') // 'details' | 'rules'
  const [dialog, setDialog] = useState(null) // { type, data, override? }
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, flow }
  const [showSettings, setShowSettings] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const splitRef = useRef(null)
  const [leftWidth, setLeftWidth] = useState(650)

  const selectedFlow = selectedId ? state.flows[selectedId] : null

  // ── Close dialog via IPC ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = window.electron
    if (!el?.onRequestClose) return
    el.onRequestClose(() => setShowClose(true))
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'connected') { setConnected(true); return }
    if (msg.type === 'disconnected') { setConnected(false); return }
    if (msg.type === 'upsert') { dispatch({ type: 'UPSERT', flow: msg.flow }); return }
    if (msg.type === 'clear') { dispatch({ type: 'CLEAR' }); return }
    if (msg.type === 'snapshot') {
      dispatch({
        type: 'SNAPSHOT',
        flows: msg.flows,
        resp_overrides: msg.resp_overrides,
        req_overrides: msg.req_overrides,
        blocks: msg.blocks,
        bypass: msg.bypass,
        settings: msg.settings,
      })
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
  }, [])

  useWebSocket(handleWsMessage)

  // ── Derived ───────────────────────────────────────────────────────────────────

  const visibleFlows = state.order
    .map(id => state.flows[id])
    .filter(f => f && flowVisible(f, filter, errorsOnly, regexMode))

  // ── Actions ───────────────────────────────────────────────────────────────────

  const clearAll = async () => {
    await api.clearFlows()
    dispatch({ type: 'CLEAR' })
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

  // ── Copy proxy ────────────────────────────────────────────────────────────────

  const copyProxy = () => {
    navigator.clipboard.writeText('127.0.0.1:8080')
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="app" onClick={closeCtxMenu}>
      <TitleBar connected={connected} />
      <Toolbar
        selectedFlow={selectedFlow}
        onReplay={() => replay(selectedFlow)}
        onEditSend={() => openSend(selectedFlow)}
        onRespOverride={() => openRespOverride(selectedFlow)}
        onReqOverride={() => openReqOverride(selectedFlow)}
        onClearOverrides={async () => { await api.clearRespOverrides(); await api.clearReqOverrides() }}
        onBlockHost={() => openBlock(selectedFlow, 'host')}
        onBlockUrl={() => openBlock(selectedFlow, 'url')}
        onBlockProcess={() => openBlock(selectedFlow, 'process')}
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
          <FlowTable
            flows={visibleFlows}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onContextMenu={handleCtxMenu}
            autoScroll={autoScroll}
            respOverrides={state.respOverrides}
            reqOverrides={state.reqOverrides}
          />
        </div>

        <div
          className="split-divider"
          onMouseDown={startDrag}
          style={{ cursor: 'col-resize' }}
        />

        <div className="split-right">
          <div className="tab-bar">
            <button
              className={`tab-bar__tab ${rightTab === 'details' ? 'tab-bar__tab--active' : ''}`}
              onClick={() => setRightTab('details')}
            >Details</button>
            <button
              className={`tab-bar__tab ${rightTab === 'rules' ? 'tab-bar__tab--active' : ''}`}
              onClick={() => setRightTab('rules')}
            >Rules</button>
          </div>

          {rightTab === 'details' && (
            <FlowDetail flow={selectedFlow} />
          )}

          {rightTab === 'rules' && (
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
              onAddBlock={() => setDialog({ type: 'block', data: { flow: null, kind: 'host' } })}
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
            dialog.data.kind === 'host' ? (dialog.data.flow?.host ?? '') :
            dialog.data.kind === 'url'  ? (dialog.data.flow?.url ?? '') :
            dialog.data.kind === 'process' ? (dialog.data.flow?.process_name ?? '') : ''
          }
          onSave={async (kind, value) => {
            await api.addBlock(kind, value)
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
