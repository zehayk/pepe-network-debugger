import React, { useState } from 'react'

const TABS = ['Overview', 'Req Headers', 'Req Body', 'Resp Headers', 'Resp Body', 'JSON']

function renderBody(bodyObj) {
  if (!bodyObj) return ''
  if (bodyObj.kind === 'empty') return ''
  if (bodyObj.kind === 'text') {
    try {
      return JSON.stringify(JSON.parse(bodyObj.value), null, 2)
    } catch {
      return bodyObj.value
    }
  }
  return `[binary — base64]\n\n${bodyObj.value}`
}

function statusColor(code) {
  if (code === 'ERROR') return 'error'
  const n = Number(code)
  if (n >= 200 && n < 300) return 'success'
  if (n >= 400 && n < 500) return 'warn'
  if (n >= 500) return 'error'
  return undefined
}

function KV({ label, value, color }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <>
      <div className="detail-kv__key">{label}</div>
      <div className={`detail-kv__val ${color ? `detail-kv__val--${color}` : ''}`}>{value}</div>
    </>
  )
}

function CodeBlock({ value }) {
  if (!value) return <span className="muted" style={{ fontSize: 12 }}>empty</span>
  return <pre className="code-block">{value}</pre>
}

function HeadersTable({ headers }) {
  const entries = Object.entries(headers ?? {})
  if (entries.length === 0) {
    return <span className="muted" style={{ fontSize: 12 }}>No headers</span>
  }
  return (
    <table className="rules-table" style={{ tableLayout: 'fixed', width: '100%' }}>
      <thead>
        <tr>
          <th style={{ width: '38%' }}>Name</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="mono truncate" title={k} style={{ fontSize: 11 }}>{k}</td>
            <td className="truncate" title={String(v)} style={{ fontSize: 11 }}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function FlowDetail({ flow }) {
  const [tab, setTab] = useState('Overview')

  if (!flow) {
    return (
      <div className="detail-panel">
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t} className={`tab-bar__tab ${tab === t ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <div className="detail-empty">Select a request to inspect</div>
      </div>
    )
  }

  const req = flow.request ?? {}
  const resp = flow.response

  const renderTab = () => {
    switch (tab) {
      case 'Overview': return (
        <div className="detail-kv">
          <KV label="Time" value={flow.time} />
          <KV label="Method" value={flow.method} />
          <KV label="URL" value={flow.url} color="accent" />
          <KV label="Host" value={flow.host} />
          <KV label="Path" value={flow.path} />
          <KV label="HTTP" value={flow.http_version} />
          <KV label="Status" value={`${flow.status_code ?? '—'} ${flow.status_reason ?? ''}`} color={statusColor(flow.status_code)} />
          <KV label="Duration" value={flow.duration_ms != null ? `${flow.duration_ms} ms` : undefined} />
          <KV label="Client" value={flow.client_address} />
          <KV label="Server" value={flow.remote_address} />
          <KV label="Process" value={flow.process_name} />
          <KV label="Blocked" value={flow.blocked ? `Yes — ${flow.block_rule?.kind}: ${flow.block_rule?.value}` : undefined} color={flow.blocked ? 'error' : undefined} />
          <KV label="Req Content-Type" value={req.content_type} />
          <KV label="Resp Content-Type" value={resp?.content_type} />
          {Object.keys(req.query_params ?? {}).length > 0 && (
            <>
              <div className="detail-kv__key" style={{ marginTop: 8 }}>Query Params</div>
              <div className="detail-kv__val"><pre className="code-block">{JSON.stringify(req.query_params, null, 2)}</pre></div>
            </>
          )}
          {Object.keys(req.form ?? {}).length > 0 && (
            <>
              <div className="detail-kv__key" style={{ marginTop: 8 }}>Form Data</div>
              <div className="detail-kv__val"><pre className="code-block">{JSON.stringify(req.form, null, 2)}</pre></div>
            </>
          )}
        </div>
      )
      case 'Req Headers':
        return <HeadersTable headers={req.headers} />
      case 'Req Body':
        return <CodeBlock value={renderBody(req.body)} />
      case 'Resp Headers':
        return resp
          ? <HeadersTable headers={resp.headers} />
          : <span className="muted">No response yet</span>
      case 'Resp Body':
        return resp
          ? <CodeBlock value={renderBody(resp.body)} />
          : <span className="muted">No response yet</span>
      case 'JSON':
        return <CodeBlock value={JSON.stringify(flow, null, 2)} />
      default:
        return null
    }
  }

  return (
    <div className="detail-panel">
      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t} className={`tab-bar__tab ${tab === t ? 'tab-bar__tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="detail-content">
        {renderTab()}
      </div>
    </div>
  )
}
