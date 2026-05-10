import React, { useRef, useState } from 'react'
import {
  RotateCcw, Edit3, Shield, Ban, Save, FolderOpen,
  Trash2, Copy, ChevronDown, Plus, X, Settings, Pause, Play,
  BarChart2, Globe, List,
} from 'lucide-react'
import ConfirmDialog from './dialogs/ConfirmDialog.jsx'

function Dropdown({ label, icon: Icon, children, variant }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  React.useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="dropdown" ref={ref}>
      <button
        className={`btn ${variant ? `btn--${variant}` : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        {Icon && <Icon size={13} />}
        {label}
        <ChevronDown size={11} style={{ marginLeft: 2 }} />
      </button>
      {open && (
        <div className="dropdown__menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  )
}

function Item({ icon: Icon, label, onClick, danger }) {
  return (
    <div
      className={`dropdown__item ${danger ? 'dropdown__item--danger' : ''}`}
      onClick={onClick}
    >
      {Icon && <Icon size={13} />}
      {label}
    </div>
  )
}

function Sep() {
  return <div className="dropdown__sep" />
}

export default function Toolbar({
  selectedFlow,
  paused, onTogglePause,
  showGraph, onToggleGraph,
  onRules, onProxy,
  onReplay, onEditSend,
  onRespOverride, onReqOverride, onClearOverrides,
  onBlockHost, onBlockUrl, onBlockProcess, onBlockIp, onAddBlock, onClearBlocks,
  onClear, onCopyProxy,
  onSaveSession, onLoadSession,
  onSettings,
}) {
  const [confirm, setConfirm] = useState(null)

  const ask = (message, action) => setConfirm({ message, action })

  return (
    <>
      <div className="toolbar">
        {/* Request */}
        <Dropdown label="Request" icon={RotateCcw}>
          <Item icon={RotateCcw} label="Replay Selected" onClick={onReplay} />
          <Item icon={Edit3} label="Edit & Send" onClick={onEditSend} />
        </Dropdown>

        {/* Override */}
        <Dropdown label="Override" icon={Shield}>
          <Item icon={Shield} label="Override Response" onClick={onRespOverride} />
          <Item icon={Shield} label="Override Request" onClick={onReqOverride} />
          <Sep />
          <Item
            icon={X} label="Remove All Overrides" danger
            onClick={() => ask('Remove all response and request overrides?', onClearOverrides)}
          />
        </Dropdown>

        {/* Block */}
        <Dropdown label="Block" icon={Ban}>
          <Item icon={Ban} label="Block Host (selected)" onClick={onBlockHost} />
          <Item icon={Ban} label="Block URL (selected)" onClick={onBlockUrl} />
          <Item icon={Ban} label="Block Process (selected)" onClick={onBlockProcess} />
          <Item icon={Ban} label="Block IP (selected)" onClick={onBlockIp} />
          <Sep />
          <Item icon={Plus} label="Add Block Rule…" onClick={onAddBlock} />
          <Item
            icon={X} label="Clear All Blocks" danger
            onClick={() => ask('Remove all block rules?', onClearBlocks)}
          />
        </Dropdown>

        {/* Session */}
        <Dropdown label="Session" icon={Save}>
          <Item icon={Save} label="Save Session" onClick={onSaveSession} />
          <Item icon={FolderOpen} label="Load Session" onClick={onLoadSession} />
        </Dropdown>

        <div className="toolbar__sep" />

        <button
          className={`btn ${paused ? 'btn--warn' : 'btn--accent'}`}
          onClick={onTogglePause}
          title={paused ? 'Resume traffic capture' : 'Pause traffic capture'}
        >
          {paused ? <Play size={13} /> : <Pause size={13} />}
          {paused ? 'Resume' : 'Pause'}
        </button>

        <button
          className={`btn ${showGraph ? 'btn--accent' : ''}`}
          onClick={onToggleGraph}
          title={showGraph ? 'Hide graph' : 'Show graph'}
        >
          <BarChart2 size={13} />
          Graph
        </button>

        <button className="btn btn--warn" onClick={() => ask('Clear all captured traffic?', onClear)}>
          <Trash2 size={13} />
          Clear
        </button>

        {/* <button className="btn" onClick={onCopyProxy} title="Copy proxy address to clipboard">
          <Copy size={13} />
          Copy Proxy
        </button> */}

        {/* allign to the right */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginLeft: 'auto'}}>

          <button className="btn" onClick={onRules} title="Manage overrides, blocks and bypass rules">
            <List size={13} />
            Rules
          </button>

          <button className="btn" onClick={onProxy} title="Configure Windows system proxy">
            <Globe size={13} />
            Proxy
          </button>

          <button className="btn btn--icon" onClick={onSettings} title="Settings">
            <Settings size={13} />
          </button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          title="Confirm"
          message={confirm.message}
          confirmLabel="Yes, proceed"
          onConfirm={confirm.action}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  )
}
