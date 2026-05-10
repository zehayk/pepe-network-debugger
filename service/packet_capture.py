"""Raw packet capture via scapy + npcap."""
import threading
import time
from collections import deque
from typing import Any, Dict, List, Optional, Tuple


# ── Protocol detection ────────────────────────────────────────────────────────

_STUN_PORTS = {3478, 5349, 19302, 19303, 19304, 19305, 19306, 19307, 19308, 19309}
_RTP_PORTS  = {5004, 5005, 5006, 5007}


def _detect(pkt) -> Tuple[str, str, str, str, Optional[int], Optional[int]]:
    """Returns (protocol, info, src, dst, sport, dport)."""
    try:
        from scapy.layers.inet import IP, TCP, UDP, ICMP
        from scapy.layers.inet6 import IPv6
        from scapy.layers.l2 import ARP
        from scapy.layers.dns import DNS
    except Exception:
        return "RAW", str(getattr(pkt, "summary", lambda: "")() or ""), "", "", None, None

    src = dst = ""
    sport = dport = None

    if pkt.haslayer(ARP):
        arp = pkt[ARP]
        return "ARP", f"Who has {arp.pdst}? Tell {arp.psrc}", arp.psrc, arp.pdst, None, None

    if pkt.haslayer(IP):
        src, dst = pkt[IP].src, pkt[IP].dst
    elif pkt.haslayer(IPv6):
        src, dst = pkt[IPv6].src, pkt[IPv6].dst

    if pkt.haslayer(TCP):
        tcp = pkt[TCP]
        sport, dport = tcp.sport, tcp.dport
        ports = {sport, dport}
        f = int(tcp.flags)
        flags = "".join(c for c, b in [("S",0x02),("A",0x10),("P",0x08),("F",0x01),("R",0x04)] if f & b) or "."
        payload = bytes(tcp.payload)
        if payload[:4] in (b"GET ", b"POST", b"HEAD", b"PUT ", b"DELE", b"OPTI") or payload[:5] == b"HTTP/":
            proto = "HTTP"
        elif payload and payload[0] == 0x16 and len(payload) > 1 and payload[1] == 0x03:
            proto = "TLS"
        elif 443 in ports or 8443 in ports:
            proto = "TLS"
        elif 80 in ports or 8080 in ports or 8000 in ports:
            proto = "HTTP"
        else:
            proto = "TCP"
        info = f"{src}:{sport} → {dst}:{dport} [{flags}] len={len(payload)}"
        return proto, info, src, dst, sport, dport

    if pkt.haslayer(UDP):
        udp = pkt[UDP]
        sport, dport = udp.sport, udp.dport
        ports = {sport, dport}
        payload_len = len(udp.payload)
        if 53 in ports:
            proto = "DNS"
            info = "DNS Query"
            if pkt.haslayer(DNS):
                dns = pkt[DNS]
                try:
                    if dns.qr == 0 and dns.qdcount > 0 and dns.qd:
                        qname = dns.qd.qname.decode("utf-8", errors="replace").rstrip(".")
                        info = f"Query {qname}"
                    else:
                        ancount = getattr(dns, "ancount", 0)
                        info = f"Response ({ancount} answers)"
                except Exception:
                    pass
        elif 443 in ports or 8443 in ports:
            proto = "QUIC"
            info = f"QUIC {src}:{sport} → {dst}:{dport} len={payload_len}"
        elif _STUN_PORTS & ports:
            proto = "STUN"
            info = f"STUN {src}:{sport} → {dst}:{dport}"
        elif _RTP_PORTS & ports:
            proto = "RTP"
            info = f"RTP {src}:{sport} → {dst}:{dport} len={payload_len}"
        else:
            proto = "UDP"
            info = f"{src}:{sport} → {dst}:{dport} len={payload_len}"
        return proto, info, src, dst, sport, dport

    if pkt.haslayer(ICMP):
        icmp = pkt[ICMP]
        return "ICMP", f"ICMP type={icmp.type} code={icmp.code} {src}→{dst}", src, dst, None, None

    return "OTHER", f"{src} → {dst}", src, dst, None, None


def _serialize(pkt, no: int, ts: float) -> Dict[str, Any]:
    protocol, info, src, dst, sport, dport = _detect(pkt)
    return {
        "no": no,
        "ts": ts,
        "src": src,
        "dst": dst,
        "sport": sport,
        "dport": dport,
        "protocol": protocol,
        "length": len(pkt),
        "info": info,
    }


# ── Runner ────────────────────────────────────────────────────────────────────

class PacketCaptureRunner:
    _STORE_MAX = 5000  # packets kept in memory for hex lookup
    _BATCH_INTERVAL = 0.1  # seconds between WebSocket flushes

    def __init__(self):
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._count = 0
        # lightweight ring buffer for hex lookup
        self._raw_store: Dict[int, bytes] = {}
        self._raw_order: deque = deque()
        # batch buffer
        self._pending: List[Dict] = []
        self._flush_thread: Optional[threading.Thread] = None

    # ── Interface listing ─────────────────────────────────────────────────────

    def list_interfaces(self) -> List[Dict[str, Any]]:
        self._check_scapy()
        try:
            from scapy.arch.windows import get_windows_if_list  # type: ignore
            result = []
            for iface in get_windows_if_list():
                result.append({
                    "name":        iface.get("name", ""),
                    "description": iface.get("description", iface.get("name", "")),
                    "ips":         iface.get("ips", []),
                })
            return result
        except ImportError:
            from scapy.all import get_if_list, get_if_addr  # type: ignore
            result = []
            for name in get_if_list():
                try:
                    addr = get_if_addr(name)
                except Exception:
                    addr = ""
                result.append({"name": name, "description": name, "ips": [addr] if addr else []})
            return result

    # ── Start / stop ──────────────────────────────────────────────────────────

    def start(self, iface: Optional[str], bpf_filter: str) -> Optional[str]:
        if self._running:
            return "Capture is already running"
        try:
            self._check_scapy()
        except RuntimeError as e:
            return str(e)

        self._running = True
        self._count = 0

        def _sniff():
            import state
            try:
                from scapy.all import sniff  # type: ignore
                self._start_flush_loop()
                sniff(
                    iface=iface or None,
                    filter=bpf_filter or None,
                    prn=self._on_pkt,
                    stop_filter=lambda _: not self._running,
                    store=False,
                )
            except OSError as e:
                msg = str(e)
                if "access" in msg.lower() or "denied" in msg.lower() or "permission" in msg.lower():
                    state.broadcast_queue.put({
                        "type": "capture_error",
                        "message": "Permission denied. Run the service as Administrator.",
                    })
                else:
                    state.broadcast_queue.put({"type": "capture_error", "message": msg})
            except Exception as e:
                state.broadcast_queue.put({"type": "capture_error", "message": str(e)})
            finally:
                self._running = False
                self._flush_pending()
                import state as _state
                _state.broadcast_queue.put({"type": "capture_stopped"})

        self._thread = threading.Thread(target=_sniff, daemon=True, name="pepe-capture")
        self._thread.start()
        return None

    def stop(self):
        self._running = False

    def is_running(self) -> bool:
        return self._running

    # ── Hex lookup ────────────────────────────────────────────────────────────

    def get_hex(self, no: int) -> Optional[str]:
        with self._lock:
            raw = self._raw_store.get(no)
        return raw.hex() if raw is not None else None

    # ── Internals ─────────────────────────────────────────────────────────────

    @staticmethod
    def _check_scapy():
        try:
            import scapy  # noqa: F401
        except ImportError:
            raise RuntimeError("scapy is not installed. Run: pip install scapy")
        # Trigger actual driver check
        try:
            from scapy.all import conf  # noqa: F401
        except (RuntimeError, OSError) as e:
            msg = str(e).lower()
            if "winpcap" in msg or "npcap" in msg or "pcap" in msg or "winerror" in msg:
                raise RuntimeError(
                    "npcap is not installed or not accessible. "
                    "Download and install it from https://npcap.com, then restart the service."
                )
            raise RuntimeError(str(e))

    def _on_pkt(self, pkt):
        self._count += 1
        no = self._count
        ts = time.time()
        try:
            data = _serialize(pkt, no, ts)
            raw = bytes(pkt)
            with self._lock:
                self._raw_store[no] = raw
                self._raw_order.append(no)
                if len(self._raw_order) > self._STORE_MAX:
                    old = self._raw_order.popleft()
                    self._raw_store.pop(old, None)
                self._pending.append(data)
        except Exception:
            pass

    def _start_flush_loop(self):
        def _loop():
            while self._running:
                time.sleep(self._BATCH_INTERVAL)
                self._flush_pending()

        self._flush_thread = threading.Thread(target=_loop, daemon=True, name="pepe-capture-flush")
        self._flush_thread.start()

    def _flush_pending(self):
        import state
        with self._lock:
            if not self._pending:
                return
            batch = self._pending[:]
            self._pending.clear()
        state.broadcast_queue.put({"type": "raw_packets", "packets": batch})
