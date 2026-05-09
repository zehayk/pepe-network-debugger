import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from utils import safe_str, sig_to_key


class BypassStore:
    """
    Hosts matching these patterns are passed through as opaque TCP tunnels —
    no SSL interception, no cert substitution.  Required for apps that pin
    certificates or use device-level auth (Teams, Outlook, Apple, etc.).

    Patterns are Python regexes matched with re.match against the hostname
    (case-insensitive).  Use (.*\\.)? prefix to cover both root and subdomains.

    Rules are persisted to ~/.pepe/bypass_rules.json so they survive restarts.
    """

    _SAVE_PATH = Path.home() / ".pepe" / "bypass_rules.json"

    _DEFAULTS: List[tuple] = [
        (r"(.*\.)?microsoftonline\.com",  "Microsoft auth (Teams / Outlook / Azure)", "host"),
        (r"(.*\.)?teams\.microsoft\.com", "Microsoft Teams",                           "host"),
        (r"(.*\.)?skype\.com",            "Skype",                                    "host"),
        (r"(.*\.)?live\.com",             "Microsoft Live",                            "host"),
        (r"(.*\.)?office\.com",           "Microsoft Office",                          "host"),
        (r"(.*\.)?office365\.com",        "Office 365",                                "host"),
        (r"(.*\.)?sharepoint\.com",       "SharePoint",                               "host"),
        (r"accounts\.google\.com",        "Google accounts",                           "host"),
        (r"(.*\.)?apple\.com",            "Apple / iCloud",                            "host"),
    ]

    def __init__(self):
        self._lock = threading.Lock()
        self._rules: List[Dict[str, Any]] = []
        self._next_id = 1
        if not self._load():
            # First run — seed defaults and save
            for pattern, label, kind in self._DEFAULTS:
                self._rules.append({
                    "id": self._next_id,
                    "pattern": pattern,
                    "label": label,
                    "kind": kind,
                    "enabled": True,
                    "builtin": True,
                })
                self._next_id += 1
            self._save()

    # ── Persistence ───────────────────────────────────────────────────────────

    def _load(self) -> bool:
        try:
            if self._SAVE_PATH.exists():
                data = json.loads(self._SAVE_PATH.read_text(encoding="utf-8"))
                self._rules = data.get("rules", [])
                for r in self._rules:
                    r.setdefault("kind", "host")
                self._next_id = data.get("next_id", len(self._rules) + 1)
                return True
        except Exception:
            pass
        return False

    def _save(self) -> None:
        try:
            self._SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {"rules": list(self._rules), "next_id": self._next_id}
            self._SAVE_PATH.write_text(
                json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass

    # ── Mutations ─────────────────────────────────────────────────────────────

    def add(self, pattern: str, label: str = "", kind: str = "host") -> Dict[str, Any]:
        pattern = pattern.strip()
        if not pattern:
            raise ValueError("Pattern cannot be empty.")
        if kind not in ("host", "process", "address"):
            kind = "host"
        with self._lock:
            rule = {
                "id": self._next_id,
                "pattern": pattern,
                "label": label,
                "kind": kind,
                "enabled": True,
                "builtin": False,
            }
            self._next_id += 1
            self._rules.append(rule)
            self._save()
            return dict(rule)

    def update(self, rule_id: int, pattern: str = None, label: str = None,
               kind: str = None, enabled: bool = None) -> bool:
        with self._lock:
            for rule in self._rules:
                if rule["id"] == rule_id:
                    if pattern is not None:
                        pattern = pattern.strip()
                        if pattern:
                            rule["pattern"] = pattern
                    if label is not None:
                        rule["label"] = label
                    if kind is not None and kind in ("host", "process", "address"):
                        rule["kind"] = kind
                    if enabled is not None:
                        rule["enabled"] = enabled
                    self._save()
                    return True
        return False

    def remove(self, rule_id: int) -> None:
        with self._lock:
            self._rules = [r for r in self._rules if r["id"] != rule_id]
            self._save()

    def toggle_enabled(self, rule_id: int) -> None:
        with self._lock:
            for rule in self._rules:
                if rule["id"] == rule_id:
                    rule["enabled"] = not rule.get("enabled", True)
                    break
            self._save()

    def clear_custom(self) -> None:
        """Remove user-added rules; disable all builtins."""
        with self._lock:
            self._rules = [r for r in self._rules if r.get("builtin")]
            for r in self._rules:
                r["enabled"] = False
            self._save()

    # ── Queries ───────────────────────────────────────────────────────────────

    def all_rules(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._rules]

    def enabled_patterns(self) -> List[str]:
        """Host-kind patterns only — fed to mitmproxy ignore_hosts."""
        with self._lock:
            return [r["pattern"] for r in self._rules if r.get("enabled") and r.get("kind", "host") == "host"]


class FlowStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._flows: Dict[str, Dict[str, Any]] = {}
        self._order: List[str] = []

    def upsert(self, flow: Dict[str, Any]) -> None:
        fid = flow["id"]
        with self._lock:
            if fid not in self._flows:
                self._order.append(fid)
            self._flows[fid] = flow

    def clear(self) -> None:
        with self._lock:
            self._flows.clear()
            self._order.clear()

    def get(self, fid: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self._flows.get(fid)

    def all(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [self._flows[fid] for fid in self._order if fid in self._flows]

    def load_from_list(self, flows: List[Dict[str, Any]]) -> None:
        with self._lock:
            self._flows.clear()
            self._order.clear()
            for f in flows:
                fid = f.get("id")
                if fid:
                    self._order.append(fid)
                    self._flows[fid] = f


class OverrideStore:
    """Stores response override rules keyed by (method, scheme, host, port, path)."""

    def __init__(self):
        self._lock = threading.Lock()
        self._rules: Dict[Tuple, Dict[str, Any]] = {}

    def set_rule(self, sig: Tuple, rule: Dict[str, Any]) -> None:
        rule = dict(rule)
        rule.setdefault("enabled", True)
        with self._lock:
            self._rules[tuple(sig)] = rule

    def remove_rule(self, sig: Tuple) -> None:
        with self._lock:
            self._rules.pop(tuple(sig), None)

    def toggle_enabled(self, sig: Tuple) -> None:
        with self._lock:
            sig = tuple(sig)
            if sig in self._rules:
                self._rules[sig]["enabled"] = not self._rules[sig].get("enabled", True)

    def clear(self) -> None:
        with self._lock:
            self._rules.clear()

    def match(self, req) -> Optional[Dict[str, Any]]:
        from utils import request_signature
        sig = request_signature(req)
        with self._lock:
            rule = self._rules.get(sig)
            if rule and rule.get("enabled", True):
                return dict(rule)
        return None

    def all_raw(self) -> Dict[Tuple, Dict[str, Any]]:
        with self._lock:
            return dict(self._rules)

    def all_serializable(self) -> List[Dict[str, Any]]:
        """Return rules as JSON-safe list (body_bytes → body_b64)."""
        with self._lock:
            out = []
            for sig, rule in self._rules.items():
                r = {k: v for k, v in rule.items() if k != "body_bytes"}
                r["sig"] = list(sig)
                if "body_bytes" in rule and rule["body_bytes"]:
                    import base64
                    r["body_b64"] = base64.b64encode(rule["body_bytes"]).decode("ascii")
                else:
                    r["body_b64"] = ""
                out.append(r)
            return out


class RequestOverrideStore:
    """Stores request override rules."""

    def __init__(self):
        self._lock = threading.Lock()
        self._rules: Dict[Tuple, Dict[str, Any]] = {}

    def set_rule(self, sig: Tuple, rule: Dict[str, Any]) -> None:
        rule = dict(rule)
        rule.setdefault("enabled", True)
        with self._lock:
            self._rules[tuple(sig)] = rule

    def remove_rule(self, sig: Tuple) -> None:
        with self._lock:
            self._rules.pop(tuple(sig), None)

    def toggle_enabled(self, sig: Tuple) -> None:
        with self._lock:
            sig = tuple(sig)
            if sig in self._rules:
                self._rules[sig]["enabled"] = not self._rules[sig].get("enabled", True)

    def clear(self) -> None:
        with self._lock:
            self._rules.clear()

    def match(self, req) -> Optional[Dict[str, Any]]:
        from utils import request_signature
        sig = request_signature(req)
        with self._lock:
            rule = self._rules.get(sig)
            if rule and rule.get("enabled", True):
                return dict(rule)
        return None

    def all_raw(self) -> Dict[Tuple, Dict[str, Any]]:
        with self._lock:
            return dict(self._rules)

    def all_serializable(self) -> List[Dict[str, Any]]:
        with self._lock:
            out = []
            for sig, rule in self._rules.items():
                r = {k: v for k, v in rule.items() if k != "body_bytes"}
                r["sig"] = list(sig)
                if "body_bytes" in rule and rule["body_bytes"]:
                    import base64
                    r["body_b64"] = base64.b64encode(rule["body_bytes"]).decode("ascii")
                else:
                    r["body_b64"] = ""
                out.append(r)
            return out


class BlockStore:
    KIND_HOST = "host"
    KIND_URL = "url"
    KIND_PROCESS = "process"

    def __init__(self):
        self._lock = threading.Lock()
        self._rules: List[Dict[str, Any]] = []
        self._next_id = 1

    def add(self, kind: str, value: str) -> Dict[str, Any]:
        if kind not in (self.KIND_HOST, self.KIND_URL, self.KIND_PROCESS):
            raise ValueError(f"Unknown block kind: {kind}")
        value = safe_str(value).strip()
        if not value:
            raise ValueError("Block value cannot be empty.")
        with self._lock:
            rule = {"id": self._next_id, "kind": kind, "value": value, "enabled": True}
            self._next_id += 1
            self._rules.append(rule)
            return dict(rule)

    def remove(self, rule_id: int) -> None:
        with self._lock:
            self._rules = [r for r in self._rules if r["id"] != rule_id]

    def toggle_enabled(self, rule_id: int) -> None:
        with self._lock:
            for rule in self._rules:
                if rule["id"] == rule_id:
                    rule["enabled"] = not rule.get("enabled", True)
                    break

    def update(self, rule_id: int, kind: str = None, value: str = None,
               enabled: bool = None) -> bool:
        if kind is not None and kind not in (self.KIND_HOST, self.KIND_URL, self.KIND_PROCESS):
            raise ValueError(f"Unknown block kind: {kind}")
        with self._lock:
            for rule in self._rules:
                if rule["id"] == rule_id:
                    if kind is not None:
                        rule["kind"] = kind
                    if value is not None:
                        v = safe_str(value).strip()
                        if v:
                            rule["value"] = v
                    if enabled is not None:
                        rule["enabled"] = enabled
                    return True
        return False

    def clear(self) -> None:
        with self._lock:
            self._rules.clear()

    def all_rules(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._rules]

    def matches(self, host: str, url: str, process_name: str) -> Optional[Dict[str, Any]]:
        host_l = safe_str(host).lower()
        url_l = safe_str(url).lower()
        proc_l = safe_str(process_name).lower()
        with self._lock:
            for rule in self._rules:
                if not rule.get("enabled", True):
                    continue
                kind = rule["kind"]
                value = safe_str(rule["value"]).lower()
                if not value:
                    continue
                if kind == self.KIND_HOST:
                    if host_l == value or host_l.endswith("." + value):
                        return dict(rule)
                elif kind == self.KIND_URL:
                    if value in url_l:
                        return dict(rule)
                elif kind == self.KIND_PROCESS:
                    if proc_l and proc_l == value:
                        return dict(rule)
        return None
