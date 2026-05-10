import React, { useEffect, useRef } from 'react'
import { RotateCcw, Edit3, Shield, Ban, Copy } from 'lucide-react'

export default function ContextMenu({
  x, y, flow,
  onReplay, onEditSend,
  onRespOverride, onReqOverride,
  onBlockHost, onBlockUrl, onBlockIp,
  onCopyUrl, onCopyHost,
  onClose,
}) {
  const ref = useRef()

  useEffect(() => {
    const handler = (e) => {
      if (!ref.current?.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Clamp to viewport
  const style = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 280),
  }

  return (
    <div className="ctx-menu" style={style} ref={ref}>
      <div className="ctx-menu__item" onClick={onReplay}><RotateCcw size={13} /> Replay</div>
      <div className="ctx-menu__item" onClick={onEditSend}><Edit3 size={13} /> Edit &amp; Send</div>
      <div className="ctx-menu__sep" />
      <div className="ctx-menu__item" onClick={onRespOverride}><Shield size={13} /> Override Response</div>
      <div className="ctx-menu__item" onClick={onReqOverride}><Shield size={13} /> Override Request</div>
      <div className="ctx-menu__sep" />
      <div className="ctx-menu__item" onClick={onBlockHost}><Ban size={13} /> Block Host</div>
      <div className="ctx-menu__item" onClick={onBlockUrl}><Ban size={13} /> Block URL</div>
      <div className="ctx-menu__item" onClick={onBlockIp}><Ban size={13} /> Block IP</div>
      <div className="ctx-menu__sep" />
      <div className="ctx-menu__item" onClick={onCopyUrl}><Copy size={13} /> Copy URL</div>
      <div className="ctx-menu__item" onClick={onCopyHost}><Copy size={13} /> Copy Host</div>
    </div>
  )
}
