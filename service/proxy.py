import asyncio
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


from pathlib import Path
from mitmproxy.certs import CertStore

confdir = Path.home() / ".mitmproxy"

# Creates ~/.mitmproxy and the CA files if they are missing.
store = CertStore.from_store(confdir, "mitmproxy", 2048)

print("Created or loaded:", confdir)
print("CA file exists:", (confdir / "mitmproxy-ca.pem").exists())
print("Cert file exists:", (confdir / "mitmproxy-ca-cert.pem").exists())


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

    def _should_emit(self, flow: http.HTTPFlow) -> bool:
        target_mode = state.settings_store.get("target_mode", False)
        all_rules = state.bypass_store.all_rules()
        filter_rules = [
            r for r in all_rules
            if r.get("enabled") and r.get("kind") in ("process", "address")
        ]
        if not filter_rules and not target_mode:
            return True

        process_name = (flow.metadata.get("process_name") or "").lower()
        host = safe_str(flow.request.host).lower()

        matched = any(
            (r["kind"] == "process" and process_name and process_name == safe_str(r["value"]).lower()) or
            (r["kind"] == "address" and safe_str(r["value"]).lower() in host)
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

    def request(self, flow: http.HTTPFlow):
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
        initial_bypass = state.bypass_store.enabled_patterns()
        opts = Options(
            listen_host=LISTEN_HOST,
            listen_port=LISTEN_PORT,
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
                self._error = str(e)
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

    def is_running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()
