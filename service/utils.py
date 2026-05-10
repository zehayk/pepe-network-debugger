import base64
import json
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    psutil = None
    PSUTIL_AVAILABLE = False

_PROCESS_CACHE: Dict[Tuple[str, int], str] = {}
_PROCESS_CACHE_LOCK = threading.Lock()
_PROCESS_LOOKUP_DENIED_UNTIL: float = 0.0
_LOOKUP_DENY_COOLDOWN = 30.0
_SNAPSHOT: Dict[Tuple[str, int], int] = {}
_SNAPSHOT_TS: float = 0.0
_SNAPSHOT_TTL = 0.5


def _parse_client_address(client_address: Any) -> Optional[Tuple[str, int]]:
    if not client_address:
        return None
    try:
        if isinstance(client_address, (tuple, list)) and len(client_address) >= 2:
            return str(client_address[0]), int(client_address[1])
        s = str(client_address)
        if s.startswith("(") and s.endswith(")"):
            s = s[1:-1]
        if "," in s:
            parts = [p.strip().strip("'\"") for p in s.split(",")]
            if len(parts) >= 2:
                return parts[0], int(parts[1])
    except Exception:
        return None
    return None


def _refresh_snapshot() -> bool:
    global _SNAPSHOT, _SNAPSHOT_TS, _PROCESS_LOOKUP_DENIED_UNTIL
    if not PSUTIL_AVAILABLE:
        return False
    if time.time() < _PROCESS_LOOKUP_DENIED_UNTIL:
        return False
    new_snap: Dict[Tuple[str, int], int] = {}
    try:
        for conn in psutil.net_connections(kind="inet"):
            laddr = conn.laddr
            if not laddr or not conn.pid:
                continue
            new_snap[(laddr.ip, laddr.port)] = conn.pid
    except (psutil.AccessDenied, PermissionError, OSError):
        _PROCESS_LOOKUP_DENIED_UNTIL = time.time() + _LOOKUP_DENY_COOLDOWN
        return False
    except Exception:
        return False
    with _PROCESS_CACHE_LOCK:
        _SNAPSHOT = new_snap
        _SNAPSHOT_TS = time.time()
    return True


def lookup_process_name(client_address: Any) -> str:
    if not PSUTIL_AVAILABLE or time.time() < _PROCESS_LOOKUP_DENIED_UNTIL:
        return ""
    addr = _parse_client_address(client_address)
    if not addr:
        return ""
    with _PROCESS_CACHE_LOCK:
        if addr in _PROCESS_CACHE:
            return _PROCESS_CACHE[addr]
        snap_age = time.time() - _SNAPSHOT_TS
        snap = _SNAPSHOT
        pid = snap.get(addr)
    if pid is None and snap_age > _SNAPSHOT_TTL:
        if not _refresh_snapshot():
            return ""
        with _PROCESS_CACHE_LOCK:
            pid = _SNAPSHOT.get(addr)
    if pid is None:
        ip, port = addr
        if ip in ("127.0.0.1", "::1", "0.0.0.0"):
            with _PROCESS_CACHE_LOCK:
                for (sip, sport), spid in _SNAPSHOT.items():
                    if sport == port and sip in ("127.0.0.1", "::1", "0.0.0.0"):
                        pid = spid
                        break
    name = ""
    if pid is not None:
        try:
            name = psutil.Process(pid).name()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            name = ""
    with _PROCESS_CACHE_LOCK:
        _PROCESS_CACHE[addr] = name
    return name


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_str(x: Any) -> str:
    if x is None:
        return ""
    try:
        return str(x)
    except Exception:
        return repr(x)


def headers_to_dict(headers) -> Dict[str, str]:
    return {safe_str(k): safe_str(v) for k, v in headers.items()}


def cookies_to_dict(cookies) -> Dict[str, str]:
    out = {}
    try:
        for k, v in cookies.items():
            out[safe_str(k)] = safe_str(v)
    except Exception:
        pass
    return out


def body_to_serializable(data: bytes) -> Dict[str, str]:
    if not data:
        return {"kind": "empty", "value": ""}
    sample = data[:4096]
    if b"\x00" not in sample:
        try:
            return {"kind": "text", "value": data.decode("utf-8", errors="replace")}
        except Exception:
            pass
    return {"kind": "base64", "value": base64.b64encode(data).decode("ascii")}


def render_body(body_obj: Optional[Dict]) -> str:
    if not body_obj:
        return ""
    kind = body_obj.get("kind", "empty")
    value = body_obj.get("value", "")
    if kind == "empty":
        return ""
    if kind == "text":
        return value
    return "[binary body, base64 encoded]\n\n" + value


def body_obj_to_bytes(body_obj: Optional[Dict]) -> bytes:
    if not body_obj:
        return b""
    kind = body_obj.get("kind", "empty")
    value = body_obj.get("value", "")
    if kind == "text":
        return value.encode("utf-8")
    if kind == "base64":
        try:
            return base64.b64decode(value)
        except Exception:
            return b""
    return b""


def pretty_json_text(text: str) -> str:
    try:
        obj = json.loads(text)
        return json.dumps(obj, indent=2, ensure_ascii=False)
    except Exception:
        return text


def pretty_body(body_obj: Any) -> str:
    text = render_body(body_obj)
    if not text:
        return ""
    if text.startswith("[binary body, base64 encoded]"):
        return text
    return pretty_json_text(text)


def request_signature(req) -> Tuple[str, str, str, int, str]:
    return (
        safe_str(req.method),
        safe_str(req.scheme),
        safe_str(req.host),
        int(req.port or 80),
        safe_str(req.path),
    )


def entry_signature(entry: Dict[str, Any]) -> Tuple[str, str, str, int, str]:
    return (
        safe_str(entry.get("method", "")),
        safe_str(entry.get("scheme", "")),
        safe_str(entry.get("host", "")),
        int(entry.get("port") or 80),
        safe_str(entry.get("path", "")),
    )


def parse_override_url(url: str) -> Optional[Tuple[str, str, int, str]]:
    if not url:
        return None
    try:
        parts = urllib.parse.urlsplit(url)
    except Exception:
        return None
    if not parts.scheme or not parts.hostname:
        return None
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    return parts.scheme, parts.hostname, port, path


def sig_to_key(sig: Tuple) -> str:
    return json.dumps(list(sig))


def key_to_sig(key: str) -> Tuple:
    lst = json.loads(key)
    return (str(lst[0]), str(lst[1]), str(lst[2]), int(lst[3]), str(lst[4]))
