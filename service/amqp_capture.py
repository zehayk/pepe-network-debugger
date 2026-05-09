"""
AMQP 0-9-1 capture proxy.

Apps connect to the local listen port instead of the real broker.
We pipe traffic transparently while parsing frames on the fly to extract
Basic.Publish and Basic.Deliver messages and emit them as PEPE flows.

Usage: set local_port to e.g. 5673, upstream to localhost:5672.
Apps must point their connection string at localhost:5673.
"""

import asyncio
import struct
import threading
import time
import uuid
from typing import Dict, Optional

import state
from utils import body_to_serializable, now_iso

# ── AMQP constants ────────────────────────────────────────────────────────────

FRAME_METHOD = 1
FRAME_HEADER = 2
FRAME_BODY = 3
FRAME_END = 0xCE

CLASS_BASIC = 60
METHOD_BASIC_PUBLISH = 40
METHOD_BASIC_RETURN = 50
METHOD_BASIC_DELIVER = 60
METHOD_BASIC_GET_OK = 71

# ── Minimal frame parser ──────────────────────────────────────────────────────

def _shortstr(data: bytes, i: int):
    n = data[i]
    return data[i + 1:i + 1 + n].decode("utf-8", errors="replace"), i + 1 + n

def _short(data: bytes, i: int):
    return struct.unpack_from(">H", data, i)[0], i + 2

def _long(data: bytes, i: int):
    return struct.unpack_from(">I", data, i)[0], i + 4

def _longlong(data: bytes, i: int):
    return struct.unpack_from(">Q", data, i)[0], i + 8


def _parse_method(payload: bytes):
    """Return (kind, exchange, routing_key) or None if not interesting."""
    if len(payload) < 4:
        return None
    try:
        class_id, i = _short(payload, 0)
        method_id, i = _short(payload, i)
        if class_id != CLASS_BASIC:
            return None

        if method_id == METHOD_BASIC_PUBLISH:
            _, i = _short(payload, i)          # ticket (deprecated)
            exchange, i = _shortstr(payload, i)
            routing_key, i = _shortstr(payload, i)
            return ("PUBLISH", exchange or "(default)", routing_key)

        if method_id == METHOD_BASIC_DELIVER:
            _, i = _shortstr(payload, i)       # consumer-tag
            _, i = _longlong(payload, i)        # delivery-tag
            i += 1                              # redelivered (packed bit)
            exchange, i = _shortstr(payload, i)
            routing_key, i = _shortstr(payload, i)
            return ("DELIVER", exchange or "(default)", routing_key)

        if method_id == METHOD_BASIC_RETURN:
            _, i = _short(payload, i)           # reply-code
            _, i = _shortstr(payload, i)        # reply-text
            exchange, i = _shortstr(payload, i)
            routing_key, i = _shortstr(payload, i)
            return ("RETURN", exchange or "(default)", routing_key)

        if method_id == METHOD_BASIC_GET_OK:
            _, i = _longlong(payload, i)        # delivery-tag
            i += 1                              # redelivered
            exchange, i = _shortstr(payload, i)
            routing_key, i = _shortstr(payload, i)
            return ("GET", exchange or "(default)", routing_key)

    except Exception:
        pass
    return None


def _parse_header(payload: bytes):
    """Return (content_type, body_size) from a CONTENT-HEADER frame."""
    try:
        if len(payload) < 14:
            return "", 0
        body_size = struct.unpack_from(">Q", payload, 4)[0]
        prop_flags = struct.unpack_from(">H", payload, 12)[0]
        i = 14
        content_type = ""
        if prop_flags & 0x8000:
            content_type, i = _shortstr(payload, i)
        return content_type, body_size
    except Exception:
        return "", 0


# ── Per-connection handler ────────────────────────────────────────────────────

class _AMQPConn:
    def __init__(self, client_r, client_w, upstream_host, upstream_port):
        self._cr = client_r
        self._cw = client_w
        self._host = upstream_host
        self._port = upstream_port
        # direction-keyed pending state: {channel: {meta, content_type, body_size, body, ts}}
        self._pending: Dict[str, dict] = {}  # key = f"{direction}:{channel}"

    async def run(self):
        try:
            up_r, up_w = await asyncio.wait_for(
                asyncio.open_connection(self._host, self._port), timeout=10
            )
        except Exception:
            self._cw.close()
            return
        try:
            await asyncio.gather(
                self._pipe(self._cr, up_w, "C→B", skip_header=True),
                self._pipe(up_r, self._cw, "B→C", skip_header=False),
            )
        except Exception:
            pass
        finally:
            try:
                up_w.close()
            except Exception:
                pass
            try:
                self._cw.close()
            except Exception:
                pass

    async def _pipe(self, reader, writer, direction, skip_header: bool):
        buf = bytearray()
        try:
            if skip_header:
                # Client sends "AMQP\x00\x00\x09\x01" before any frames
                proto = await asyncio.wait_for(reader.readexactly(8), timeout=10)
                writer.write(proto)
                await writer.drain()

            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    break
                writer.write(chunk)
                await writer.drain()
                buf += chunk
                self._consume(buf, direction)
        except Exception:
            pass

    def _consume(self, buf: bytearray, direction: str):
        while len(buf) >= 7:
            ftype = buf[0]
            channel = struct.unpack_from(">H", buf, 1)[0]
            size = struct.unpack_from(">I", buf, 3)[0]
            total = 7 + size + 1
            if len(buf) < total:
                break
            if buf[7 + size] == FRAME_END:
                payload = bytes(buf[7:7 + size])
                self._handle(ftype, channel, payload, direction)
            del buf[:total]

    def _handle(self, ftype: int, channel: int, payload: bytes, direction: str):
        key = f"{direction}:{channel}"

        if ftype == FRAME_METHOD:
            parsed = _parse_method(payload)
            if parsed:
                kind, exchange, routing_key = parsed
                self._pending[key] = {
                    "kind": kind,
                    "exchange": exchange,
                    "routing_key": routing_key,
                    "direction": direction,
                    "content_type": "",
                    "body_size": 0,
                    "body": bytearray(),
                    "ts": time.time(),
                }

        elif ftype == FRAME_HEADER and key in self._pending:
            content_type, body_size = _parse_header(payload)
            p = self._pending[key]
            p["content_type"] = content_type
            p["body_size"] = body_size
            if body_size == 0:
                self._emit(key)

        elif ftype == FRAME_BODY and key in self._pending:
            self._pending[key]["body"] += payload
            p = self._pending[key]
            if len(p["body"]) >= p["body_size"]:
                self._emit(key)

    def _emit(self, key: str):
        p = self._pending.pop(key, None)
        if not p:
            return
        body_bytes = bytes(p["body"])
        exchange = p["exchange"]
        routing_key = p["routing_key"]
        kind = p["kind"]
        content_type = p["content_type"]

        entry = {
            "id": f"amqp-{uuid.uuid4().hex[:12]}",
            "time": now_iso(),
            "method": kind,
            "scheme": "amqp",
            "host": exchange,
            "port": self._port,
            "path": f"/{routing_key}" if routing_key else "/",
            "url": f"amqp://{exchange}/{routing_key}",
            "http_version": "AMQP 0-9-1",
            "status_code": None,
            "status_reason": "",
            "duration_ms": int((time.time() - p["ts"]) * 1000),
            "remote_address": f"{self._host}:{self._port}",
            "client_address": "amqp-capture",
            "process_name": "",
            "blocked": False,
            "block_rule": None,
            "request": {
                "headers": {"content-type": content_type} if content_type else {},
                "cookies": {},
                "query_params": {},
                "content_type": content_type,
                "body": body_to_serializable(body_bytes),
                "form": {},
            },
            "response": None,
        }

        if not state.settings_store.get("stream_only", True):
            state.flow_store.upsert(entry)
        state.broadcast_queue.put({"type": "upsert", "flow": entry})


# ── Proxy runner ──────────────────────────────────────────────────────────────

class AMQPCaptureRunner:
    """Manages the asyncio-based AMQP capture server in a background thread."""

    def __init__(self):
        self._thread: Optional[threading.Thread] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._server = None

    def start(self, local_port: int, upstream_host: str, upstream_port: int) -> Optional[str]:
        """Start (or restart) the capture proxy. Returns error string or None."""
        self.stop()
        started = threading.Event()
        error_box: list = []

        def run():
            import sys
            # ProactorEventLoop (Windows default) crashes on server cleanup when the loop
            # is stopped externally — the proactor becomes None before __aexit__ runs.
            # SelectorEventLoop doesn't have this problem.
            if sys.platform == "win32":
                loop = asyncio.SelectorEventLoop()
            else:
                loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            try:
                loop.run_until_complete(
                    self._serve(local_port, upstream_host, upstream_port, started, error_box)
                )
            except Exception:
                pass
            finally:
                try:
                    loop.close()
                except Exception:
                    pass
                self._loop = None

        self._thread = threading.Thread(target=run, daemon=True, name="pepe-amqp")
        self._thread.start()
        started.wait(timeout=5)
        return error_box[0] if error_box else None

    def stop(self):
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._server = None
        self._loop = None
        self._thread = None

    async def _serve(self, local_port, upstream_host, upstream_port,
                     started: threading.Event, error_box: list):
        try:
            async def handle(r, w):
                await _AMQPConn(r, w, upstream_host, upstream_port).run()

            # Don't use "async with server" — its __aexit__ calls close() which
            # accesses loop._proactor that may already be None on Windows.
            self._server = await asyncio.start_server(handle, "127.0.0.1", local_port)
            await self._server.start_serving()
        except Exception as e:
            error_box.append(str(e))
            started.set()
            return

        started.set()
        try:
            # Park here until loop.stop() is called from another thread
            await asyncio.get_event_loop().create_future()
        except Exception:
            pass
        finally:
            try:
                self._server.close()
            except Exception:
                pass
