import sys
import threading

from constants import SERVICE_NAME, SERVICE_DISPLAY, SERVICE_DESC


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
            import service
            service.run_server()
            win32event.WaitForSingleObject(self._stop_event, win32event.INFINITE)
            service.stop_server()
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
