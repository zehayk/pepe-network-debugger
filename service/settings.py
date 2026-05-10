import json
import threading
from pathlib import Path


class SettingsStore:
    # Use a shared location so settings are consistent whether running
    # interactively or as a SYSTEM service (Path.home() under SYSTEM
    # resolves to the SYSTEM profile, not the logged-in user's home).
    _SAVE_PATH = Path("C:/ProgramData/PEPE/settings.json")

    _DEFAULTS = {
        "stream_only": True,
        "target_mode": False,
        "amqp_capture_enabled": False,
        "amqp_listen_port": 5673,
        "amqp_upstream_host": "localhost",
        "amqp_upstream_port": 5672,
        "proxy_listen_host": "127.0.0.1",
        "proxy_listen_port": 8080,
    }

    def __init__(self):
        self._lock = threading.Lock()
        self._data = dict(self._DEFAULTS)
        self._load()

    def _load(self):
        try:
            if self._SAVE_PATH.exists():
                data = json.loads(self._SAVE_PATH.read_text(encoding="utf-8"))
                for k in self._DEFAULTS:
                    if k in data:
                        self._data[k] = data[k]
        except Exception:
            pass

    def _save(self):
        try:
            self._SAVE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._SAVE_PATH.write_text(
                json.dumps(self._data, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception:
            pass

    def get(self, key, default=None):
        with self._lock:
            return self._data.get(key, default)

    def set(self, key, value):
        with self._lock:
            self._data[key] = value
            self._save()

    def all(self):
        with self._lock:
            return dict(self._data)
