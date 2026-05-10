import asyncio
import base64
import threading
import time
from typing import Optional

from mitmproxy import http
from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster

import state
from constants import MITMPROXY_CONFDIR
from utils import (
    body_to_serializable,
    cookies_to_dict,
    headers_to_dict,
    lookup_process_name,
    now_iso,
    parse_override_url,
    request_signature,
    safe_str,
)

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = 8080


def _log_proxy_error(msg: str):
    try:
        from pathlib import Path
        import datetime
        log = Path("C:/ProgramData/PEPE/pepe-service.log")
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now().isoformat()}] [proxy] {msg}\n")
    except Exception:
        pass


class LiveFlowAddon:
    def _serialize(self, flow: http.HTTPFlow):
        req = flow.request
        resp = flow.response

        start_ts = flow.metadata.get("start_ts")
        duration_ms = None
        if start_ts is not None:
            duration_ms = int((time.time() - start_ts) * 1000)

        req_body = body_to_serializable(bytes(req.raw_content or b""))
        resp_body = None
        if resp is not None:
            resp_body = body_to_serializable(bytes(resp.raw_content or b""))

        process_name = ""
        if flow.client_conn and flow.client_conn.address:
            process_name = flow.metadata.get("process_name") or lookup_process_name(flow.client_conn.address)

        return {
            "id": flow.id,
            "time": now_iso(),
            "method": safe_str(req.method),
            "scheme": safe_str(req.scheme),
            "host": safe_str(req.host),
            "port": req.port,
            "path": safe_str(req.path),
            "url": safe_str(req.pretty_url),
            "http_version": safe_str(req.http_version),
            "status_code": resp.status_code if resp else None,
            "status_reason": safe_str(resp.reason) if resp else "",
            "duration_ms": duration_ms,
            "remote_address": safe_str(flow.server_conn.address) if flow.server_conn else "",
            "client_address": safe_str(flow.client_conn.address) if flow.client_conn else "",
            "process_name": process_name,
            "blocked": bool(flow.metadata.get("blocked")),
            "block_rule": flow.metadata.get("block_rule"),
            "request": {
                "headers": headers_to_dict(req.headers),
                "cookies": cookies_to_dict(req.cookies),
                "query_params": dict(req.query),
                "content_type": safe_str(req.headers.get("content-type", "")),
                "body": req_body,
                "form": dict(req.urlencoded_form) if req.urlencoded_form else {},
            },
            "response": {
                "headers": headers_to_dict(resp.headers) if resp else {},
                "cookies": cookies_to_dict(resp.cookies) if resp else {},
                "content_type": safe_str(resp.headers.get("content-type", "")) if resp else "",
                "body": resp_body,
            } if resp else None,
        }

    def _is_grpc(self, flow: http.HTTPFlow) -> bool:
        return safe_str(flow.request.headers.get("content-type", "")).startswith("application/grpc")

    def _parse_grpc_frames(self, data: bytes) -> list:
        frames, offset = [], 0
        while offset + 5 <= len(data):
            compressed = bool(data[offset])
            length = int.from_bytes(data[offset + 1:offset + 5], 'big')
            end = offset + 5 + length
            if end > len(data):
                break
            payload = data[offset + 5:end]
            content_data = body_to_serializable(payload)
            frames.append({
                "compressed": compressed,
                "size": length,
                "kind": content_data["kind"],
                "content": content_data["value"],
            })
            offset = end
        return frames

    def _should_emit(self, flow: http.HTTPFlow) -> bool:
        target_mode = state.settings_store.get("target_mode", False)
        all_rules = state.bypass_store.all_rules()
        filter_rules = [
            r for r in all_rules
            if r.get("enabled") and r.get("kind") in ("process", "address", "url")
        ]
        if not filter_rules and not target_mode:
            return True

        process_name = (flow.metadata.get("process_name") or "").lower()
        host = safe_str(flow.request.host).lower()
        url_l = safe_str(flow.request.pretty_url).lower()

        matched = any(
            (r["kind"] == "process" and process_name and process_name == safe_str(r["value"]).lower()) or
            (r["kind"] == "address" and safe_str(r["value"]).lower() in host) or
            (r["kind"] == "url" and safe_str(r["value"]).lower() in url_l)
            for r in filter_rules
        )
        return matched if target_mode else not matched

    def _emit(self, flow: http.HTTPFlow):
        if not self._should_emit(flow):
            return
        entry = self._serialize(flow)
        if not state.settings_store.get("stream_only", True):
            state.flow_store.upsert(entry)
        state.broadcast_queue.put({"type": "upsert", "flow": entry})

    async def request(self, flow: http.HTTPFlow):
        process_name = ""
        if flow.client_conn and flow.client_conn.address:
            process_name = lookup_process_name(flow.client_conn.address)
            flow.metadata["process_name"] = process_name

        block_rule = state.block_store.matches(
            host=safe_str(flow.request.host),
            url=safe_str(flow.request.pretty_url),
            process_name=process_name,
        )
        if block_rule is not None:
            flow.metadata["blocked"] = True
            flow.metadata["block_rule"] = block_rule
            flow.metadata["start_ts"] = time.time()
            resp_type = block_rule.get("response_type", "block")

            if resp_type == "hang":
                self._emit(flow)
                await asyncio.sleep(90)
                flow.response = http.Response.make(
                    504, b"Gateway Timeout\n", {"content-type": "text/plain"}
                )
                self._emit(flow)
                return

            body_b64 = block_rule.get("response_body_b64", "")
            try:
                body_bytes = base64.b64decode(body_b64) if body_b64 else b""
            except Exception:
                body_bytes = b""

            if resp_type == "text":
                flow.response = http.Response.make(
                    200, body_bytes or b"Blocked by PEPE\n", {"content-type": "text/plain"}
                )
            elif resp_type == "html":
                flow.response = http.Response.make(
                    200, body_bytes or b"<h1>Blocked by PEPE</h1>", {"content-type": "text/html"}
                )
            elif resp_type == "gif":
                flow.response = http.Response.make(
                    200, body_bytes, {"content-type": "image/gif"}
                ) if body_bytes else http.Response.make(
                    403, b"Blocked\n", {"content-type": "text/plain"}
                )
            elif resp_type == "video":
                flow.response = http.Response.make(
                    200, body_bytes, {"content-type": "video/mp4"}
                ) if body_bytes else http.Response.make(
                    403, b"Blocked\n", {"content-type": "text/plain"}
                )
            else:
                flow.response = http.Response.make(
                    403,
                    f"Blocked by PEPE ({block_rule['kind']}: {block_rule['value']})\n".encode(),
                    {"content-type": "text/plain"},
                )

            self._emit(flow)
            return

        rule = state.req_override_store.match(flow.request)
        if rule:
            if rule.get("method"):
                flow.request.method = safe_str(rule["method"])
            if rule.get("url"):
                parsed = parse_override_url(rule["url"])
                if parsed:
                    scheme, host, port, path = parsed
                    flow.request.scheme = scheme
                    flow.request.host = host
                    flow.request.port = port
                    flow.request.path = path
                    try:
                        flow.request.headers["host"] = host
                    except Exception:
                        pass
            if rule.get("headers"):
                try:
                    flow.request.headers = http.Headers(rule["headers"])
                except Exception:
                    pass
            if rule.get("body_bytes") is not None:
                flow.request.content = rule["body_bytes"]

        flow.metadata["start_ts"] = time.time()

        if self._is_grpc(flow) and self._should_emit(flow):
            req = flow.request
            process_name = flow.metadata.get("process_name", "")
            req_frames = self._parse_grpc_frames(bytes(req.raw_content or b""))
            flow.metadata["grpc_req_frame_count"] = len(req_frames)
            state.broadcast_queue.put({
                "type": "grpc_start",
                "conn": {
                    "id": flow.id,
                    "time": now_iso(),
                    "host": safe_str(req.host),
                    "port": req.port,
                    "path": safe_str(req.path),
                    "scheme": "grpcs" if req.scheme == "https" else "grpc",
                    "process_name": process_name,
                    "status": "open",
                    "msg_count": 0,
                    "headers": headers_to_dict(req.headers),
                },
            })
            for i, frame in enumerate(req_frames):
                state.broadcast_queue.put({
                    "type": "grpc_frame",
                    "conn_id": flow.id,
                    "msg": {
                        "index": i,
                        "from_client": True,
                        "kind": frame["kind"],
                        "content": frame["content"],
                        "time": now_iso(),
                        "size": frame["size"],
                    },
                    "msg_count": len(req_frames),
                })

        self._emit(flow)

    def response(self, flow: http.HTTPFlow):
        rule = state.resp_override_store.match(flow.request)
        if rule and flow.response is not None:
            headers = dict(rule.get("headers", {}))
            body_bytes = rule.get("body_bytes", b"")
            status_code = int(rule.get("status_code", 200))
            reason = safe_str(rule.get("reason", ""))
            new_resp = http.Response.make(
                status_code=status_code,
                content=body_bytes,
                headers=headers or None,
            )
            if reason:
                new_resp.reason = reason
            if rule.get("content_type"):
                new_resp.headers["content-type"] = safe_str(rule["content_type"])
            flow.response = new_resp

        if self._is_grpc(flow) and flow.response is not None and self._should_emit(flow):
            resp_frames = self._parse_grpc_frames(bytes(flow.response.raw_content or b""))
            req_count = flow.metadata.get("grpc_req_frame_count", 0)
            for i, frame in enumerate(resp_frames):
                state.broadcast_queue.put({
                    "type": "grpc_frame",
                    "conn_id": flow.id,
                    "msg": {
                        "index": req_count + i,
                        "from_client": False,
                        "kind": frame["kind"],
                        "content": frame["content"],
                        "time": now_iso(),
                        "size": frame["size"],
                    },
                    "msg_count": req_count + len(resp_frames),
                })
            state.broadcast_queue.put({
                "type": "grpc_end",
                "conn_id": flow.id,
                "status": "closed",
            })

        self._emit(flow)

    def error(self, flow: http.HTTPFlow):
        if not self._should_emit(flow):
            return
        entry = self._serialize(flow)
        entry["status_code"] = "ERROR"
        entry["status_reason"] = safe_str(flow.error.msg) if flow.error else "Proxy error"
        if not state.settings_store.get("stream_only", True):
            state.flow_store.upsert(entry)
        state.broadcast_queue.put({"type": "upsert", "flow": entry})

    def websocket_start(self, flow: http.HTTPFlow):
        if not self._should_emit(flow):
            return
        if flow.client_conn and flow.client_conn.address:
            process_name = flow.metadata.get("process_name") or lookup_process_name(flow.client_conn.address)
            flow.metadata["process_name"] = process_name
        else:
            process_name = ""
        req = flow.request
        state.broadcast_queue.put({
            "type": "ws_start",
            "conn": {
                "id": flow.id,
                "time": now_iso(),
                "host": safe_str(req.host),
                "port": req.port,
                "path": safe_str(req.path),
                "scheme": "wss" if req.scheme == "https" else "ws",
                "process_name": process_name,
                "status": "open",
                "msg_count": 0,
                "headers": headers_to_dict(req.headers),
            },
        })

    def websocket_message(self, flow: http.HTTPFlow):
        if not self._should_emit(flow):
            return
        ws = flow.websocket
        if not ws or not ws.messages:
            return
        msg = ws.messages[-1]
        raw = msg.content if msg.content else b""
        content_data = body_to_serializable(raw)
        state.broadcast_queue.put({
            "type": "ws_message",
            "conn_id": flow.id,
            "msg": {
                "index": len(ws.messages) - 1,
                "from_client": bool(msg.from_client),
                "kind": content_data["kind"],
                "content": content_data["value"],
                "time": now_iso(),
                "size": len(raw),
            },
            "msg_count": len(ws.messages),
        })

    def websocket_end(self, flow: http.HTTPFlow):
        state.broadcast_queue.put({"type": "ws_end", "conn_id": flow.id, "status": "closed"})

    def websocket_error(self, flow: http.HTTPFlow):
        state.broadcast_queue.put({"type": "ws_end", "conn_id": flow.id, "status": "error"})


class ProxyRunner:
    def __init__(self):
        self.master: Optional[DumpMaster] = None
        self.thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._error: Optional[str] = None

    @property
    def error(self) -> Optional[str]:
        return self._error

    async def _run_async(self):
        self._loop = asyncio.get_running_loop()
        MITMPROXY_CONFDIR.mkdir(parents=True, exist_ok=True)
        listen_host = state.settings_store.get("proxy_listen_host", LISTEN_HOST)
        listen_port = int(state.settings_store.get("proxy_listen_port", LISTEN_PORT))
        initial_bypass = state.bypass_store.enabled_patterns()
        opts = Options(
            listen_host=listen_host,
            listen_port=listen_port,
            ignore_hosts=initial_bypass,
            confdir=str(MITMPROXY_CONFDIR),
        )
        self.master = DumpMaster(opts, with_termlog=False, with_dumper=False)
        self.master.addons.add(LiveFlowAddon())
        await self.master.run()

    def start(self):
        if self.thread and self.thread.is_alive():
            return

        def runner():
            try:
                asyncio.run(self._run_async())
            except Exception as e:
                import traceback
                self._error = str(e)
                _log_proxy_error(traceback.format_exc())
                state.broadcast_queue.put({"type": "proxy_error", "message": str(e)})

        self.thread = threading.Thread(target=runner, daemon=True, name="pepe-proxy")
        self.thread.start()

    def update_ignore_hosts(self):
        """Apply the current bypass list to mitmproxy. Safe to call from any thread."""
        patterns = state.bypass_store.enabled_patterns()
        if self.master and self._loop and not self._loop.is_closed():
            async def _apply():
                self.master.options.update(ignore_hosts=patterns)
            asyncio.run_coroutine_threadsafe(_apply(), self._loop)

    def stop(self):
        if self.master is not None:
            try:
                self.master.shutdown()
            except Exception:
                pass

    def restart(self):
        """Stop mitmproxy and restart with current settings. Non-blocking."""
        self.stop()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=6)
        self.thread = None
        self.master = None
        self._loop = None
        self._error = None
        self.start()
        state.broadcast_queue.put({
            "type": "proxy_restarted",
            "host": state.settings_store.get("proxy_listen_host", LISTEN_HOST),
            "port": state.settings_store.get("proxy_listen_port", LISTEN_PORT),
        })

    def is_running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()
