#!/usr/bin/env python3
"""
PEPE Service — always-running background proxy + API server.

Modes:
  python service.py              Interactive (tray icon)
  pepe-service.exe               Same when frozen (tray), or SCM dispatch if started by SCM
  pepe-service.exe install       Install as Windows service
  pepe-service.exe remove        Remove the service
  pepe-service.exe start         Start the service
  pepe-service.exe stop          Stop the service
  pepe-service.exe --interactive  Force interactive mode (skip SCM probe)
"""
import signal
import sys
import threading
import time

import uvicorn

import api
import state
from constants import API_HOST, API_PORT, MITMPROXY_CONFDIR
from proxy import ProxyRunner

_runner: ProxyRunner = None
_server: uvicorn.Server = None


def run_server():
    """Start proxy + API in daemon threads. Non-blocking."""
    global _runner, _server

    MITMPROXY_CONFDIR.mkdir(parents=True, exist_ok=True)

    _runner = ProxyRunner()
    state.proxy_runner = _runner
    _runner.start()

    config = uvicorn.Config(
        app=api.app,
        host=API_HOST,
        port=API_PORT,
        log_config=None,  # disable uvicorn's log setup (crashes when stdout is None in noconsole exe)
        loop="asyncio",
    )
    _server = uvicorn.Server(config)

    t = threading.Thread(target=_server.run, daemon=True, name="pepe-api")
    t.start()


def stop_server():
    """Signal server threads to shut down."""
    if _server:
        _server.should_exit = True
    if _runner:
        _runner.stop()


def interactive_mode():
    """Server + system tray. Must be called from the main thread."""
    signal.signal(signal.SIGINT, lambda *_: stop_server())
    signal.signal(signal.SIGTERM, lambda *_: stop_server())

    run_server()

    try:
        from tray_icon import run_tray
        run_tray(on_quit=stop_server)
    except Exception:
        # No tray available: just keep alive until a signal arrives
        while True:
            time.sleep(1)


if __name__ == '__main__':
    # --interactive bypasses the SCM probe (Electron's "Run Interactive" passes this)
    if '--interactive' in sys.argv:
        interactive_mode()
        sys.exit(0)

    try:
        from win_service import try_service_mode
        if try_service_mode(sys.argv):
            sys.exit(0)
    except Exception:
        pass

    interactive_mode()
