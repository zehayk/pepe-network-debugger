import React, { useState } from 'react'
import { ToggleLeft, ToggleRight, Trash2, Plus, X, ShieldOff, Target } from 'lucide-react'
import ConfirmDialog from './dialogs/ConfirmDialog.jsx'
import EditBypassDialog from './dialogs/EditBypassDialog.jsx'
import EditBlockDialog from './dialogs/EditBlockDialog.jsx'

// ── Shared sub-components ─────────────────────────────────────────────────────

function SectionHeader({ title, hint, onClear }) {
  return (
    <div className="rules-section__header">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="rules-section__title">{title}</span>
        {hint && <span className="muted" style={{ fontSize: 11, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{hint}</span>}
      </div>
      {onClear && (
        <button className="btn btn--danger btn--icon" onClick={onClear} title="Remove all">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function ToggleCell({ enabled, onToggle }) {
  return (
    <td>
      <button
        className={`toggle-btn ${enabled ? 'toggle-btn--on' : ''}`}
        onClick={onToggle}
        title={enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      >
        {enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      </button>
    </td>
  )
}

function RemoveCell({ onRemove }) {
  return (
    <td>
      <button className="toggle-btn" onClick={onRemove} title="Remove">
        <Trash2 size={12} />
      </button>
    </td>
  )
}

function EmptyRow({ cols, message }) {
  return (
    <tr>
      <td colSpan={cols} style={{ color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: 12, padding: '8px 10px' }}>
        {message}
      </td>
    </tr>
  )
}

// ── Override tables ───────────────────────────────────────────────────────────

function sigLabel(sig) {
  if (!sig) return ''
  return `${sig[0]} ${sig[1]}://${sig[2]}:${sig[3]}${sig[4]}`
}

function OverrideTable({ title, rules, onToggle, onRemove, onClear, onEdit, extraCols }) {
  return (
    <div>
      <SectionHeader title={title} onClear={onClear} />
      <table className="rules-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>En</th>
            <th>Match</th>
            {extraCols.map(c => <th key={c.key} style={{ width: c.w }}>{c.label}</th>)}
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rules.length === 0
            ? <EmptyRow cols={3 + extraCols.length} message="No rules" />
            : rules.map(rule => (
              <tr
                key={JSON.stringify(rule.sig)}
                className={rule.enabled ? 'enabled' : ''}
                onDoubleClick={() => onEdit?.(rule)}
                title="Double-click to edit"
              >
                <ToggleCell enabled={rule.enabled} onToggle={() => onToggle(rule.sig)} />
                <td className="truncate" title={sigLabel(rule.sig)}>{sigLabel(rule.sig)}</td>
                {extraCols.map(c => (
                  <td key={c.key} className="truncate" title={String(rule[c.key] ?? '')}>{rule[c.key] ?? ''}</td>
                ))}
                <RemoveCell onRemove={() => onRemove(rule.sig)} />
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

// ── Block table ───────────────────────────────────────────────────────────────

function BlockTable({ rules, onToggle, onRemove, onAdd, onClear, onEdit }) {
  return (
    <div>
      <SectionHeader
        title="Block Rules"
        hint="Matching requests get a 403 response"
        onClear={onClear}
      />
      <table className="rules-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>En</th>
            <th style={{ width: 80 }}>Kind</th>
            <th>Value</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rules.length === 0
            ? <EmptyRow cols={4} message="No block rules" />
            : rules.map(rule => (
              <tr
                key={rule.id}
                className={rule.enabled ? 'enabled' : ''}
                onDoubleClick={() => onEdit?.(rule)}
                title="Double-click to edit"
              >
                <ToggleCell enabled={rule.enabled} onToggle={() => onToggle(rule.id)} />
                <td>{rule.kind}</td>
                <td className="truncate" title={rule.value}>{rule.value}</td>
                <RemoveCell onRemove={() => onRemove(rule.id)} />
              </tr>
            ))
          }
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        <button className="btn btn--accent" onClick={onAdd}>
          <Plus size={12} /> Add Block Rule
        </button>
      </div>
    </div>
  )
}

// ── Bypass table ──────────────────────────────────────────────────────────────

const KIND_BADGE_STYLE = {
  host:    { color: 'var(--accent)',   background: 'color-mix(in srgb, var(--accent) 12%, transparent)' },
  process: { color: 'var(--success)',  background: 'color-mix(in srgb, var(--success) 12%, transparent)' },
  address: { color: 'var(--warn)',     background: 'color-mix(in srgb, var(--warn) 12%, transparent)' },
  url:     { color: 'var(--error)',    background: 'color-mix(in srgb, var(--error) 12%, transparent)' },
}

const KIND_PLACEHOLDERS = {
  host:    'regex, e.g. (.*\\.)?example\\.com',
  process: 'e.g. discord.exe',
  address: 'e.g. api.example.com',
  url:     'e.g. /api/v1/users',
}

function KindBadge({ kind }) {
  const style = KIND_BADGE_STYLE[kind] ?? {}
  return (
    <span className="tag" style={{ fontSize: 10, ...style }}>
      {kind ?? 'host'}
    </span>
  )
}

function BypassTable({ rules, onToggle, onRemove, onAdd, onClear, onEdit, settings, onUpdateSettings }) {
  const [pattern, setPattern] = useState('')
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState('host')
  const [err, setErr] = useState('')
  const targetMode = settings?.target_mode ?? false

  const submit = () => {
    if (!pattern.trim()) { setErr('Value required'); return }
    setErr('')
    onAdd(pattern.trim(), label.trim(), kind)
    setPattern('')
    setLabel('')
  }

  const onKey = (e) => { if (e.key === 'Enter') submit() }

  return (
    <div>
      {/* Target mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', marginBottom: 8, borderBottom: '1px solid var(--border)' }}>
        <button
          className={`toggle-btn ${targetMode ? 'toggle-btn--on' : ''}`}
          onClick={() => onUpdateSettings?.({ target_mode: !targetMode })}
          title={targetMode ? 'Target mode ON — monitoring only matching rules' : 'Target mode OFF — filtering out matching rules'}
        >
          {targetMode ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
        </button>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Target size={12} style={{ color: targetMode ? 'var(--success)' : 'var(--muted)' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: targetMode ? 'var(--fg)' : 'var(--fg-dim)' }}>
              Target Mode
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>
            {targetMode
              ? 'Showing ONLY traffic matching process/address rules below'
              : 'Hiding traffic from matching process/address rules'}
          </span>
        </div>
      </div>

      <SectionHeader
        title="Bypass / Filter Rules"
        hint="Host rules bypass SSL. Process & address rules filter what's shown."
        onClear={onClear}
      />

      <table className="rules-table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>En</th>
            <th style={{ width: 72 }}>Kind</th>
            <th>Pattern / Value</th>
            <th style={{ width: 160 }}>Label</th>
            <th style={{ width: 32 }} />
          </tr>
        </thead>
        <tbody>
          {rules.length === 0
            ? <EmptyRow cols={5} message="No bypass rules" />
            : rules.map(rule => (
              <tr
                key={rule.id}
                className={rule.enabled ? 'enabled' : ''}
                onDoubleClick={() => onEdit?.(rule)}
                title="Double-click to edit"
              >
                <ToggleCell enabled={rule.enabled} onToggle={() => onToggle(rule.id)} />
                <td><KindBadge kind={rule.kind ?? 'host'} /></td>
                <td className="truncate mono" title={rule.pattern}>{rule.pattern}</td>
                <td className="truncate muted" title={rule.label}>{rule.label}</td>
                <RemoveCell onRemove={() => onRemove(rule.id)} />
              </tr>
            ))
          }
        </tbody>
      </table>

      {/* Inline add form */}
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            className="dialog__select"
            style={{ width: 110, flexShrink: 0 }}
            value={kind}
            onChange={e => setKind(e.target.value)}
          >
            <option value="host">host</option>
            <option value="process">process</option>
            <option value="address">address</option>
            <option value="url">url</option>
          </select>
          <input
            className="dialog__input"
            style={{ flex: 2, minWidth: 0 }}
            placeholder={KIND_PLACEHOLDERS[kind]}
            value={pattern}
            onChange={e => { setPattern(e.target.value); setErr('') }}
            onKeyDown={onKey}
            spellCheck={false}
          />
          <input
            className="dialog__input"
            style={{ flex: 1, minWidth: 0 }}
            placeholder="label (optional)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={onKey}
          />
          <button className="btn btn--accent" onClick={submit} style={{ flexShrink: 0 }}>
            <Plus size={12} /> Add
          </button>
        </div>
        {err && <span style={{ color: 'var(--error)', fontSize: 11 }}>{err}</span>}
        <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
          <ShieldOff size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
          <strong>host</strong> rules bypass SSL interception.{' '}
          <strong>process</strong>, <strong>address</strong> &amp; <strong>url</strong> rules filter displayed traffic (or target in target mode).
        </p>
      </div>
    </div>
  )
}

// ── RulesPanel ────────────────────────────────────────────────────────────────

const PANEL_TABS = ['Overrides', 'Blocks', 'Bypass']

export default function RulesPanel({
  respOverrides, reqOverrides, blocks, bypass,
  onToggleResp, onRemoveResp,
  onToggleReq, onRemoveReq,
  onToggleBlock, onRemoveBlock,
  onClearAll, onClearBlocks, onAddBlock,
  onToggleBypass, onRemoveBypass, onAddBypass, onClearBypass,
  onEditResp, onEditReq, onEditBlock, onEditBypass,
  settings, onUpdateSettings,
}) {
  const [tab, setTab] = useState('Overrides')
  const [pending, setPending] = useState(null) // { message, action }
  const [editingBypass, setEditingBypass] = useState(null)
  const [editingBlock, setEditingBlock] = useState(null)

  const ask = (message, action) => setPending({ message, action })

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Sub-tab bar */}
        <div className="tab-bar" style={{ background: 'var(--panel)' }}>
          {PANEL_TABS.map(t => (
            <button
              key={t}
              className={`tab-bar__tab ${tab === t ? 'tab-bar__tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === 'Overrides' && (respOverrides.length + reqOverrides.length) > 0 &&
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--accent)', opacity: 0.8 }}>
                  {respOverrides.length + reqOverrides.length}
                </span>
              }
              {t === 'Blocks' && blocks.filter(r => r.enabled).length > 0 &&
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--error)', opacity: 0.8 }}>
                  {blocks.filter(r => r.enabled).length}
                </span>
              }
              {t === 'Bypass' && bypass.filter(r => r.enabled).length > 0 &&
                <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--warn)', opacity: 0.8 }}>
                  {bypass.filter(r => r.enabled).length}
                </span>
              }
            </button>
          ))}
        </div>

        <div className="rules-panel">
          {tab === 'Overrides' && (
            <>
              <OverrideTable
                title="Response Overrides"
                rules={respOverrides}
                onToggle={onToggleResp}
                onRemove={onRemoveResp}
                onEdit={onEditResp}
                onClear={() => ask('Remove all response overrides?', () => respOverrides.forEach(r => onRemoveResp(r.sig)))}
                extraCols={[
                  { key: 'status_code', label: 'Status', w: 60 },
                  { key: 'reason', label: 'Reason', w: 100 },
                ]}
              />
              <OverrideTable
                title="Request Overrides"
                rules={reqOverrides}
                onToggle={onToggleReq}
                onRemove={onRemoveReq}
                onEdit={onEditReq}
                onClear={() => ask('Remove all request overrides?', () => reqOverrides.forEach(r => onRemoveReq(r.sig)))}
                extraCols={[
                  { key: 'method', label: 'Method', w: 70 },
                  { key: 'url', label: 'Override URL', w: 160 },
                ]}
              />
              <div>
                <button className="btn btn--warn" onClick={() => ask('Remove all response and request overrides?', onClearAll)}>
                  <Trash2 size={12} /> Clear All Overrides
                </button>
              </div>
            </>
          )}

          {tab === 'Blocks' && (
            <BlockTable
              rules={blocks}
              onToggle={onToggleBlock}
              onRemove={onRemoveBlock}
              onAdd={onAddBlock}
              onEdit={(rule) => setEditingBlock(rule)}
              onClear={() => ask('Remove all block rules?', () => blocks.filter(r => !r.builtin).forEach(r => onRemoveBlock(r.id)))}
            />
          )}

          {tab === 'Bypass' && (
            <BypassTable
              rules={bypass}
              onToggle={onToggleBypass}
              onRemove={onRemoveBypass}
              onAdd={onAddBypass}
              onEdit={(rule) => setEditingBypass(rule)}
              onClear={() => ask('Clear all custom bypass rules and disable built-ins?', onClearBypass)}
              settings={settings}
              onUpdateSettings={onUpdateSettings}
            />
          )}
        </div>
      </div>

      {pending && (
        <ConfirmDialog
          title="Confirm"
          message={pending.message}
          confirmLabel="Yes, proceed"
          onConfirm={pending.action}
          onClose={() => setPending(null)}
        />
      )}

      {editingBypass && (
        <EditBypassDialog
          rule={editingBypass}
          onSave={(data) => {
            onEditBypass?.(editingBypass.id, data)
            setEditingBypass(null)
          }}
          onClose={() => setEditingBypass(null)}
        />
      )}

      {editingBlock && (
        <EditBlockDialog
          rule={editingBlock}
          onSave={(data) => {
            onEditBlock?.(editingBlock.id, data)
            setEditingBlock(null)
          }}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </>
  )
}
