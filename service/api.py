import asyncio
import base64
import json
import statistics
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Set

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import state
from utils import (
    body_obj_to_bytes,
    body_to_serializable,
    entry_signature,
    now_iso,
    safe_str,
)

# ── WebSocket manager ─────────────────────────────────────────────────────────

class _WSManager:
    def __init__(self):
        self._clients: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def add(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        async with self._lock:
            self._clients.add(q)
        return q

    async def remove(self, q: asyncio.Queue):
        async with self._lock:
            self._clients.discard(q)

    async def broadcast(self, msg: dict):
        data = json.dumps(msg, default=str)
        async with self._lock:
            dead = set()
            for q in self._clients:
                try:
                    q.put_nowait(data)
                except asyncio.QueueFull:
                    dead.add(q)
            for q in dead:
                self._clients.discard(q)


ws_manager = _WSManager()
_fastapi_loop: Optional[asyncio.AbstractEventLoop] = None

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="PEPE Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    global _fastapi_loop
    _fastapi_loop = asyncio.get_event_loop()
    asyncio.create_task(_drain_broadcast_queue())


async def _drain_broadcast_queue():
    """Drain the thread-safe broadcast_queue and fan out to WebSocket clients."""
    while True:
        try:
            while True:
                msg = state.broadcast_queue.get_nowait()
                await ws_manager.broadcast(msg)
        except Exception:
            pass
        await asyncio.sleep(0.04)


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    q = await ws_manager.add()

    try:
        # Send current state snapshot so the client is immediately up-to-date
        stream_only = state.settings_store.get("stream_only", True)
        snapshot = {
            "type": "snapshot",
            "flows": [] if stream_only else state.flow_store.all(),
            "resp_overrides": state.resp_override_store.all_serializable(),
            "req_overrides": state.req_override_store.all_serializable(),
            "blocks": state.block_store.all_rules(),
            "bypass": state.bypass_store.all_rules(),
            "settings": state.settings_store.all(),
        }
        await ws.send_text(json.dumps(snapshot, default=str))

        while True:
            send_task = asyncio.create_task(q.get())
            recv_task = asyncio.create_task(ws.receive_text())
            done, pending = await asyncio.wait(
                [send_task, recv_task], return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
            for t in done:
                if t is send_task:
                    await ws.send_text(t.result())
                else:
                    try:
                        msg = json.loads(t.result())
                        if msg.get("type") == "ping":
                            await ws.send_text(json.dumps({"type": "pong"}))
                    except Exception:
                        pass
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        await ws_manager.remove(q)


# ── Status ────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def get_status():
    from proxy import LISTEN_HOST, LISTEN_PORT
    return {
        "status": "running",
        "proxy": f"{LISTEN_HOST}:{LISTEN_PORT}",
        "flows": len(state.flow_store.all()),
    }


# ── Flows ─────────────────────────────────────────────────────────────────────

@app.get("/api/flows")
def get_flows():
    return {"flows": state.flow_store.all()}


@app.delete("/api/flows")
def clear_flows():
    state.flow_store.clear()
    asyncio.run_coroutine_threadsafe(
        ws_manager.broadcast({"type": "clear"}), _fastapi_loop
    )
    return {"ok": True}


# ── Replay / Send ─────────────────────────────────────────────────────────────

class SendPayload(BaseModel):
    method: str = "GET"
    url: str
    headers: Dict[str, str] = {}
    body_b64: str = ""


@app.post("/api/send")
def send_request(payload: SendPayload):
    body_bytes = base64.b64decode(payload.body_b64) if payload.body_b64 else b""
    threading.Thread(
        target=_do_send,
        args=(payload.method, payload.url, payload.headers, body_bytes),
        daemon=True,
    ).start()
    return {"ok": True}


class ReplayPayload(BaseModel):
    flow_id: str


@app.post("/api/replay")
def replay_flow(payload: ReplayPayload):
    flow = state.flow_store.get(payload.flow_id)
    if not flow:
        raise HTTPException(404, "Flow not found")
    req = flow.get("request", {})
    body_bytes = body_obj_to_bytes(req.get("body"))
    threading.Thread(
        target=_do_send,
        args=(
            flow.get("method", "GET"),
            flow.get("url", ""),
            req.get("headers", {}),
            body_bytes,
        ),
        daemon=True,
    ).start()
    return {"ok": True}


def _do_send(method: str, url: str, headers: Dict[str, str], body_bytes: bytes):
    if not url:
        return
    start = time.time()
    status_code: Any = "ERROR"
    reason = "Request failed"
    resp_headers: Dict[str, str] = {}
    resp_body = b""

    try:
        req = urllib.request.Request(url=url, data=body_bytes or None, method=method)
        for k, v in headers.items():
            req.add_header(str(k), str(v))
        with urllib.request.urlopen(req, timeout=30) as resp:
            status_code = resp.status
            reason = safe_str(resp.reason)
            resp_headers = {k: v for k, v in resp.headers.items()}
            resp_body = resp.read()
    except urllib.error.HTTPError as e:
        status_code = e.code
        reason = safe_str(e.reason)
        resp_headers = {k: v for k, v in e.headers.items()} if e.headers else {}
        try:
            resp_body = e.read()
        except Exception:
            resp_body = b""
    except Exception as e:
        reason = str(e)

    duration_ms = int((time.time() - start) * 1000)
    parts = urllib.parse.urlsplit(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query

    entry = {
        "id": f"replay-{int(time.time() * 1000)}",
        "time": now_iso(),
        "method": safe_str(method),
        "scheme": safe_str(parts.scheme),
        "host": safe_str(parts.hostname),
        "port": port,
        "path": safe_str(path),
        "url": safe_str(url),
        "http_version": "",
        "status_code": status_code,
        "status_reason": reason,
        "duration_ms": duration_ms,
        "remote_address": safe_str(parts.hostname),
        "client_address": "replay",
        "process_name": "",
        "blocked": False,
        "block_rule": None,
        "request": {
            "headers": {str(k): str(v) for k, v in headers.items()},
            "cookies": {},
            "query_params": dict(urllib.parse.parse_qsl(parts.query)),
            "content_type": safe_str(headers.get("content-type", "")),
            "body": body_to_serializable(body_bytes),
            "form": {},
        },
        "response": {
            "headers": {str(k): str(v) for k, v in resp_headers.items()},
            "cookies": {},
            "content_type": safe_str(resp_headers.get("content-type", "")),
            "body": body_to_serializable(resp_body),
        },
    }
    state.flow_store.upsert(entry)
    state.broadcast_queue.put({"type": "upsert", "flow": entry})


# ── Response overrides ────────────────────────────────────────────────────────

class RespOverridePayload(BaseModel):
    sig: List[Any]
    status_code: int = 200
    reason: str = ""
    content_type: str = ""
    headers: Dict[str, str] = {}
    body_b64: str = ""


class SigPayload(BaseModel):
    sig: List[Any]


@app.get("/api/rules/resp-overrides")
def get_resp_overrides():
    return {"rules": state.resp_override_store.all_serializable()}


@app.post("/api/rules/resp-overrides")
def set_resp_override(payload: RespOverridePayload):
    sig = tuple(payload.sig[:4]) + (str(payload.sig[4]),) if len(payload.sig) >= 5 else tuple(payload.sig)
    sig = (str(sig[0]), str(sig[1]), str(sig[2]), int(sig[3]), str(sig[4]))
    body_bytes = base64.b64decode(payload.body_b64) if payload.body_b64 else b""
    rule = {
        "status_code": payload.status_code,
        "reason": payload.reason,
        "content_type": payload.content_type,
        "headers": payload.headers,
        "body_bytes": body_bytes,
    }
    state.resp_override_store.set_rule(sig, rule)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/resp-overrides/remove")
def remove_resp_override(payload: SigPayload):
    sig = _parse_sig(payload.sig)
    state.resp_override_store.remove_rule(sig)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/resp-overrides/toggle")
def toggle_resp_override(payload: SigPayload):
    sig = _parse_sig(payload.sig)
    state.resp_override_store.toggle_enabled(sig)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/resp-overrides/clear")
def clear_resp_overrides():
    state.resp_override_store.clear()
    _broadcast_rules()
    return {"ok": True}


# ── Request overrides ─────────────────────────────────────────────────────────

class ReqOverridePayload(BaseModel):
    sig: List[Any]
    method: str = ""
    url: str = ""
    headers: Dict[str, str] = {}
    body_b64: str = ""


@app.get("/api/rules/req-overrides")
def get_req_overrides():
    return {"rules": state.req_override_store.all_serializable()}


@app.post("/api/rules/req-overrides")
def set_req_override(payload: ReqOverridePayload):
    sig = _parse_sig(payload.sig)
    body_bytes = base64.b64decode(payload.body_b64) if payload.body_b64 else b""
    rule = {
        "method": payload.method,
        "url": payload.url,
        "headers": payload.headers,
        "body_bytes": body_bytes,
    }
    state.req_override_store.set_rule(sig, rule)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/req-overrides/remove")
def remove_req_override(payload: SigPayload):
    sig = _parse_sig(payload.sig)
    state.req_override_store.remove_rule(sig)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/req-overrides/toggle")
def toggle_req_override(payload: SigPayload):
    sig = _parse_sig(payload.sig)
    state.req_override_store.toggle_enabled(sig)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/req-overrides/clear")
def clear_req_overrides():
    state.req_override_store.clear()
    _broadcast_rules()
    return {"ok": True}


# ── Block rules ───────────────────────────────────────────────────────────────

class BlockPayload(BaseModel):
    kind: str
    value: str


class BlockIdPayload(BaseModel):
    id: int


@app.get("/api/rules/blocks")
def get_blocks():
    return {"rules": state.block_store.all_rules()}


@app.post("/api/rules/blocks")
def add_block(payload: BlockPayload):
    rule = state.block_store.add(payload.kind, payload.value)
    _broadcast_rules()
    return {"ok": True, "rule": rule}


@app.post("/api/rules/blocks/remove")
def remove_block(payload: BlockIdPayload):
    state.block_store.remove(payload.id)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/blocks/toggle")
def toggle_block(payload: BlockIdPayload):
    state.block_store.toggle_enabled(payload.id)
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/blocks/clear")
def clear_blocks():
    state.block_store.clear()
    _broadcast_rules()
    return {"ok": True}


class UpdateBlockPayload(BaseModel):
    id: int
    kind: Optional[str] = None
    value: Optional[str] = None
    enabled: Optional[bool] = None


@app.post("/api/rules/blocks/update")
def update_block(payload: UpdateBlockPayload):
    state.block_store.update(payload.id, kind=payload.kind, value=payload.value, enabled=payload.enabled)
    _broadcast_rules()
    return {"ok": True}


# ── Session ───────────────────────────────────────────────────────────────────

class SessionPayload(BaseModel):
    flows: List[Dict[str, Any]]


@app.get("/api/session/export")
def export_session():
    return {"flows": state.flow_store.all()}


@app.post("/api/session/import")
def import_session(payload: SessionPayload):
    state.flow_store.load_from_list(payload.flows)
    asyncio.run_coroutine_threadsafe(
        ws_manager.broadcast({"type": "clear"}), _fastapi_loop
    )
    for flow in payload.flows:
        state.broadcast_queue.put({"type": "upsert", "flow": flow})
    return {"ok": True}


# ── Bypass rules ──────────────────────────────────────────────────────────────

class BypassPayload(BaseModel):
    pattern: str
    label: str = ""
    kind: str = "host"


class UpdateBypassPayload(BaseModel):
    id: int
    pattern: Optional[str] = None
    label: Optional[str] = None
    kind: Optional[str] = None
    enabled: Optional[bool] = None


@app.get("/api/rules/bypass")
def get_bypass():
    return {"rules": state.bypass_store.all_rules()}


@app.post("/api/rules/bypass")
def add_bypass(payload: BypassPayload):
    state.bypass_store.add(payload.pattern, payload.label, payload.kind)
    _apply_bypass()
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/bypass/update")
def update_bypass(payload: UpdateBypassPayload):
    state.bypass_store.update(
        payload.id,
        pattern=payload.pattern,
        label=payload.label,
        kind=payload.kind,
        enabled=payload.enabled,
    )
    _apply_bypass()
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/bypass/remove")
def remove_bypass(payload: BlockIdPayload):
    state.bypass_store.remove(payload.id)
    _apply_bypass()
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/bypass/toggle")
def toggle_bypass(payload: BlockIdPayload):
    state.bypass_store.toggle_enabled(payload.id)
    _apply_bypass()
    _broadcast_rules()
    return {"ok": True}


@app.post("/api/rules/bypass/clear")
def clear_bypass():
    state.bypass_store.clear_custom()
    _apply_bypass()
    _broadcast_rules()
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────

class SettingsPayload(BaseModel):
    stream_only: Optional[bool] = None
    target_mode: Optional[bool] = None
    amqp_capture_enabled: Optional[bool] = None
    amqp_listen_port: Optional[int] = None
    amqp_upstream_host: Optional[str] = None
    amqp_upstream_port: Optional[int] = None


@app.get("/api/settings")
def get_settings():
    return state.settings_store.all()


@app.post("/api/settings")
def update_settings(payload: SettingsPayload):
    if payload.stream_only is not None:
        state.settings_store.set("stream_only", payload.stream_only)
    if payload.target_mode is not None:
        state.settings_store.set("target_mode", payload.target_mode)
    if payload.amqp_listen_port is not None:
        state.settings_store.set("amqp_listen_port", payload.amqp_listen_port)
    if payload.amqp_upstream_host is not None:
        state.settings_store.set("amqp_upstream_host", payload.amqp_upstream_host)
    if payload.amqp_upstream_port is not None:
        state.settings_store.set("amqp_upstream_port", payload.amqp_upstream_port)
    if payload.amqp_capture_enabled is not None:
        state.settings_store.set("amqp_capture_enabled", payload.amqp_capture_enabled)

    result = state.settings_store.all()
    amqp_touched = any(v is not None for v in [
        payload.amqp_capture_enabled, payload.amqp_listen_port,
        payload.amqp_upstream_host, payload.amqp_upstream_port,
    ])
    if amqp_touched:
        if state.settings_store.get("amqp_capture_enabled"):
            err = state.amqp_runner.start(
                local_port=state.settings_store.get("amqp_listen_port", 5673),
                upstream_host=state.settings_store.get("amqp_upstream_host", "localhost"),
                upstream_port=state.settings_store.get("amqp_upstream_port", 5672),
            )
            if err:
                result = dict(result)
                result["amqp_error"] = err
        else:
            state.amqp_runner.stop()

    _broadcast_settings()
    return result


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_sig(sig_list: List[Any]):
    return (str(sig_list[0]), str(sig_list[1]), str(sig_list[2]), int(sig_list[3]), str(sig_list[4]))


def _apply_bypass():
    if state.proxy_runner:
        state.proxy_runner.update_ignore_hosts()


def _broadcast_rules():
    if _fastapi_loop:
        msg = {
            "type": "rules",
            "resp_overrides": state.resp_override_store.all_serializable(),
            "req_overrides": state.req_override_store.all_serializable(),
            "blocks": state.block_store.all_rules(),
            "bypass": state.bypass_store.all_rules(),
        }
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast(msg), _fastapi_loop)


def _broadcast_settings():
    if _fastapi_loop:
        msg = {"type": "settings", **state.settings_store.all()}
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast(msg), _fastapi_loop)
