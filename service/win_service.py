import sys
import threading
import traceback
from pathlib import Path

from constants import SERVICE_NAME, SERVICE_DISPLAY, SERVICE_DESC

_LOG_PATH = Path("C:/ProgramData/PEPE/pepe-service.log")


def _log(msg: str):
    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _LOG_PATH.open("a", encoding="utf-8") as f:
            import datetime
            f.write(f"[{datetime.datetime.now().isoformat()}] {msg}\n")
    except Exception:
        pass


class PEPEService:
    """Lazy-imported inside try_service_mode to avoid hard dependency on pywin32."""
    pass


def _make_service_class():
    import win32serviceutil
    import win32service
    import win32event
    import servicemanager

    class _PEPEService(win32serviceutil.ServiceFramework):
        _svc_name_ = SERVICE_NAME
        _svc_display_name_ = SERVICE_DISPLAY
        _svc_description_ = SERVICE_DESC

        def __init__(self, args):
            super().__init__(args)
            self._stop_event = win32event.CreateEvent(None, 0, 0, None)

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
            win32event.SetEvent(self._stop_event)

        def SvcDoRun(self):
            servicemanager.LogInfoMsg(f"{SERVICE_NAME} starting…")
            _log(f"{SERVICE_NAME} SvcDoRun started")
            try:
                import service
                service.run_server()
                _log("run_server() returned — waiting for stop event")
            except Exception:
                tb = traceback.format_exc()
                _log(f"FATAL error in SvcDoRun:\n{tb}")
                servicemanager.LogErrorMsg(f"{SERVICE_NAME} startup error: {tb}")
                return
            win32event.WaitForSingleObject(self._stop_event, win32event.INFINITE)
            _log(f"{SERVICE_NAME} stop event received")
            try:
                service.stop_server()
            except Exception:
                _log(f"Error in stop_server:\n{traceback.format_exc()}")
            servicemanager.LogInfoMsg(f"{SERVICE_NAME} stopped.")

    return _PEPEService


def try_service_mode(argv) -> bool:
    """
    Returns True if this process was launched by SCM or given a service
    management command (install / remove / start / stop / …).
    Returns False for plain interactive runs.
    """
    try:
        import win32serviceutil
        import servicemanager
    except ImportError:
        return False

    cls = _make_service_class()

    # Service management commands from the command line
    if len(argv) >= 2:
        win32serviceutil.HandleCommandLine(cls)
        return True

    # Frozen exe with no args: attempt SCM dispatcher (fails fast if not from SCM)
    if getattr(sys, 'frozen', False):
        try:
            servicemanager.Initialize()
            servicemanager.PrepareToHostSingle(cls)
            servicemanager.StartServiceCtrlDispatcher()
            return True
        except Exception:
            return False

    return False
