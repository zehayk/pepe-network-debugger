import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ToggleLeft, ToggleRight, AlertTriangle, RefreshCw } from 'lucide-react'

function SectionTitle({ children }) {
  return (
    <div className="rules-section__header" style={{ marginBottom: 0 }}>
      <span className="rules-section__title">{children}</span>
    </div>
  )
}

function SettingRow({ label, hint, enabled, onToggle }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <button
        className={`toggle-btn ${enabled ? 'toggle-btn--on' : ''}`}
        onClick={onToggle}
        style={{ marginTop: 2, flexShrink: 0 }}
        title={enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      >
        {enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>{hint}</span>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, onEnter, type = 'text', placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{label}</label>
      <input
        className="dialog__input"
        type={type}
        value={value}
        onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
      />
    </div>
  )
}

function ServiceSection() {
  const el = window.electron
  const [status, setStatus] = useState({ installed: false, state: 'NOT_INSTALLED' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const pollRef = useRef(null)

  const refresh = useCallback(async () => {
    if (!el?.serviceStatus) return
    try {
      const s = await el.serviceStatus()
      setStatus(s)
    } catch { /* ignore */ }
  }, [el])

  useEffect(() => {
    refresh()
    pollRef.current = setInterval(refresh, 3000)
    return () => clearInterval(pollRef.current)
  }, [refresh])

  const act = async (fn) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      // Give SCM a moment then refresh
      setTimeout(refresh, 1500)
    } catch (e) {
      setErr(e.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const stateColor = {
    RUNNING: 'var(--accent)',
    STOPPED: 'var(--muted)',
    START_PENDING: 'var(--warn)',
    STOP_PENDING: 'var(--warn)',
    NOT_INSTALLED: 'var(--muted)',
  }[status.state] ?? 'var(--muted)'

  const notAvailable = !el?.serviceStatus

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Status:</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: stateColor }}>
          {status.state.replace(/_/g, ' ')}
        </span>
        <button
          className="btn btn--icon"
          style={{ marginLeft: 'auto', padding: '2px 4px' }}
          onClick={refresh}
          title="Refresh status"
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {notAvailable ? (
        <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0 }}>
          Service control is only available in the packaged Electron app.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {!status.installed ? (
            <button
              className="btn btn--accent"
              disabled={busy}
              onClick={() => act(() => el.serviceInstall())}
            >
              {busy ? 'Working…' : 'Install & Start'}
            </button>
          ) : (
            <>
              {status.state === 'RUNNING' ? (
                <button
                  className="btn btn--warn"
                  disabled={busy}
                  onClick={() => act(() => el.serviceStop())}
                >
                  {busy ? 'Working…' : 'Stop Service'}
                </button>
              ) : (
                <button
                  className="btn btn--accent"
                  disabled={busy}
                  onClick={() => act(() => el.serviceStart())}
                >
                  {busy ? 'Working…' : 'Start Service'}
                </button>
              )}
              <button
                className="btn"
                style={{ color: 'var(--error)' }}
                disabled={busy}
                onClick={() => act(() => el.serviceUninstall())}
              >
                Uninstall
              </button>
            </>
          )}

          {/* <button
            className="btn"
            disabled={busy}
            onClick={() => act(() => el.serviceRunInteractive())}
            title="Run pepe-service.exe in interactive mode (tray icon, no UAC needed)"
          >
            Run Interactive
          </button> */}
        </div>
      )}

      {err && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--error)', fontSize: 11, lineHeight: 1.5 }}>
          <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
          {err}
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
        Install &amp; Start registers <code style={{ background: 'var(--panel3)', padding: '1px 4px', borderRadius: 3 }}>PEPEService</code> in Windows Service Manager
        (auto-start, runs as SYSTEM) and requires a one-time UAC prompt.
        Run Interactive launches the service EXE with a tray icon instead, without UAC.
      </p>
    </div>
  )
}

export default function SettingsPanel({ settings, onUpdate }) {
  const streamOnly = settings?.stream_only ?? true
  const amqpEnabled = settings?.amqp_capture_enabled ?? false

  const [listenPort, setListenPort] = useState(settings?.amqp_listen_port ?? 5673)
  const [upstreamHost, setUpstreamHost] = useState(settings?.amqp_upstream_host ?? 'localhost')
  const [upstreamPort, setUpstreamPort] = useState(settings?.amqp_upstream_port ?? 5672)
  const [amqpError, setAmqpError] = useState('')
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    setListenPort(settings?.amqp_listen_port ?? 5673)
    setUpstreamHost(settings?.amqp_upstream_host ?? 'localhost')
    setUpstreamPort(settings?.amqp_upstream_port ?? 5672)
  }, [settings?.amqp_listen_port, settings?.amqp_upstream_host, settings?.amqp_upstream_port])

  const applyAmqp = async () => {
    setApplying(true)
    setAmqpError('')
    try {
      const result = await onUpdate({
        amqp_listen_port: listenPort,
        amqp_upstream_host: upstreamHost,
        amqp_upstream_port: upstreamPort,
      })
      if (result?.amqp_error) setAmqpError(result.amqp_error)
    } catch (e) {
      setAmqpError(e.message)
    } finally {
      setApplying(false)
    }
  }

  const toggleAmqp = async () => {
    setAmqpError('')
    try {
      const result = await onUpdate({ amqp_capture_enabled: !amqpEnabled })
      if (result?.amqp_error) setAmqpError(result.amqp_error)
    } catch (e) {
      setAmqpError(e.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0' }}>
      <SectionTitle>Background Service</SectionTitle>
      <ServiceSection />

      <div style={{ height: 4 }} />
      <SectionTitle>Traffic</SectionTitle>

      <SettingRow
        label="Stream-only mode"
        hint={
          streamOnly
            ? 'Flows are forwarded live to connected clients but not kept in memory. Reconnecting starts empty.'
            : 'Flows are stored in memory. Reconnecting clients receive the full history.'
        }
        enabled={streamOnly}
        onToggle={() => onUpdate({ stream_only: !streamOnly })}
      />

      <div style={{ height: 12 }} />
      <SectionTitle>AMQP Capture</SectionTitle>

      <SettingRow
        label="Enable AMQP capture"
        hint={
          amqpEnabled
            ? `Listening on localhost:${listenPort} → proxying to ${upstreamHost}:${upstreamPort}. Point your apps here instead of the real broker.`
            : 'Intercept AMQP 0-9-1 messages via a local TCP proxy. No code changes needed — just update your connection string.'
        }
        enabled={amqpEnabled}
        onToggle={toggleAmqp}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Field label="Listen port" type="number" value={listenPort} onChange={setListenPort} onEnter={applyAmqp} placeholder="5673" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 2 }}>
            <Field label="Upstream host" value={upstreamHost} onChange={setUpstreamHost} onEnter={applyAmqp} placeholder="localhost" />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Upstream port" type="number" value={upstreamPort} onChange={setUpstreamPort} onEnter={applyAmqp} placeholder="5672" />
          </div>
        </div>
        <button
          className="btn btn--accent"
          style={{ alignSelf: 'flex-start' }}
          onClick={applyAmqp}
          disabled={applying}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
        {amqpError && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--error)', fontSize: 11, lineHeight: 1.5 }}>
            <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} />
            {amqpError}
          </div>
        )}
        {amqpEnabled && !amqpError && (
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
            Change your app's AMQP connection string from{' '}
            <code style={{ background: 'var(--panel3)', padding: '1px 4px', borderRadius: 3 }}>
              amqp://...@{upstreamHost}:{upstreamPort}/
            </code>
            {' '}to{' '}
            <code style={{ background: 'var(--panel3)', padding: '1px 4px', borderRadius: 3 }}>
              amqp://...@localhost:{listenPort}/
            </code>
          </p>
        )}
      </div>
    </div>
  )
}
