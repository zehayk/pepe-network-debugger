const BASE = 'http://127.0.0.1:7779'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const r = await fetch(BASE + path, opts)
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`)
  return r.json()
}

// ── Flows ─────────────────────────────────────────────────────────────────────
export const getFlows = () => req('GET', '/api/flows')
export const clearFlows = () => req('DELETE', '/api/flows')
export const replayFlow = (flow_id) => req('POST', '/api/replay', { flow_id })
export const sendRequest = (method, url, headers, body_b64) =>
  req('POST', '/api/send', { method, url, headers, body_b64 })

// ── Session ───────────────────────────────────────────────────────────────────
export const exportSession = () => req('GET', '/api/session/export')
export const importSession = (flows) => req('POST', '/api/session/import', { flows })

// ── Response overrides ────────────────────────────────────────────────────────
export const setRespOverride = (sig, rule) =>
  req('POST', '/api/rules/resp-overrides', { sig, ...rule })
export const removeRespOverride = (sig) =>
  req('POST', '/api/rules/resp-overrides/remove', { sig })
export const toggleRespOverride = (sig) =>
  req('POST', '/api/rules/resp-overrides/toggle', { sig })
export const clearRespOverrides = () =>
  req('POST', '/api/rules/resp-overrides/clear')

// ── Request overrides ─────────────────────────────────────────────────────────
export const setReqOverride = (sig, rule) =>
  req('POST', '/api/rules/req-overrides', { sig, ...rule })
export const removeReqOverride = (sig) =>
  req('POST', '/api/rules/req-overrides/remove', { sig })
export const toggleReqOverride = (sig) =>
  req('POST', '/api/rules/req-overrides/toggle', { sig })
export const clearReqOverrides = () =>
  req('POST', '/api/rules/req-overrides/clear')

// ── Block rules ───────────────────────────────────────────────────────────────
export const addBlock = (kind, value, response_type = 'block', response_body_b64 = '') =>
  req('POST', '/api/rules/blocks', { kind, value, response_type, response_body_b64 })
export const removeBlock = (id) =>
  req('POST', '/api/rules/blocks/remove', { id })
export const toggleBlock = (id) =>
  req('POST', '/api/rules/blocks/toggle', { id })
export const clearBlocks = () =>
  req('POST', '/api/rules/blocks/clear')

// ── Bypass rules ─────────────────────────────────────────────────────────────
export const addBypass = (pattern, label = '', kind = 'host') =>
  req('POST', '/api/rules/bypass', { pattern, label, kind })
export const updateBypass = (id, data) =>
  req('POST', '/api/rules/bypass/update', { id, ...data })
export const removeBypass = (id) =>
  req('POST', '/api/rules/bypass/remove', { id })
export const toggleBypass = (id) =>
  req('POST', '/api/rules/bypass/toggle', { id })
export const clearBypass = () =>
  req('POST', '/api/rules/bypass/clear')

// ── Block update ──────────────────────────────────────────────────────────────
export const updateBlock = (id, data) =>
  req('POST', '/api/rules/blocks/update', { id, ...data })

// ── Settings ──────────────────────────────────────────────────────────────────
export const getSettings = () => req('GET', '/api/settings')
export const updateSettings = (settings) => req('POST', '/api/settings', settings)

// ── Windows proxy ─────────────────────────────────────────────────────────────
export const getWinProxy = () => req('GET', '/api/proxy/win-proxy')
export const setWinProxy = (enabled, server = '127.0.0.1:8080') =>
  req('POST', '/api/proxy/win-proxy', { enabled, server })

// ── Packet capture ────────────────────────────────────────────────────────────
export const getInterfaces = () => req('GET', '/api/capture/interfaces')
export const startCapture = (iface = null, filter = '') =>
  req('POST', '/api/capture/start', { iface, filter })
export const stopCapture = () => req('POST', '/api/capture/stop')
export const getCaptureStatus = () => req('GET', '/api/capture/status')
export const getPacketHex = (no) => req('GET', `/api/capture/packet/${no}/hex`)

// ── Status ────────────────────────────────────────────────────────────────────
export const getStatus = () => req('GET', '/api/status')

// ── Helpers ───────────────────────────────────────────────────────────────────
export function entrySig(flow) {
  return [
    flow.method ?? '',
    flow.scheme ?? '',
    flow.host ?? '',
    flow.port ?? 80,
    flow.path ?? '',
  ]
}

export function bytesToB64(str) {
  // str is the body text from the editor
  try {
    return btoa(unescape(encodeURIComponent(str)))
  } catch {
    return btoa(str)
  }
}
