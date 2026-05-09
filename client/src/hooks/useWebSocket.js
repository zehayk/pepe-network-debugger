import { useEffect, useRef, useCallback } from 'react'

const WS_URL = 'ws://127.0.0.1:7779/ws'
const RECONNECT_DELAY = 2500

export function useWebSocket(onMessage) {
  const wsRef = useRef(null)
  const timerRef = useRef(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < 2) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      onMessageRef.current({ type: 'connected' })
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        onMessageRef.current(msg)
      } catch { /* ignore malformed */ }
    }

    ws.onclose = () => {
      onMessageRef.current({ type: 'disconnected' })
      timerRef.current = setTimeout(connect, RECONNECT_DELAY)
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return send
}
