import ctypes
import winreg
from typing import Any, Dict

_PROXY_KEY = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
_OPTION_SETTINGS_CHANGED = 39
_OPTION_REFRESH = 37


def _notify_system() -> None:
    try:
        wininet = ctypes.windll.wininet
        wininet.InternetSetOptionW(0, _OPTION_SETTINGS_CHANGED, 0, 0)
        wininet.InternetSetOptionW(0, _OPTION_REFRESH, 0, 0)
    except Exception:
        pass


def get_proxy_state() -> Dict[str, Any]:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _PROXY_KEY) as key:
            try:
                enabled, _ = winreg.QueryValueEx(key, "ProxyEnable")
                enabled = bool(enabled)
            except FileNotFoundError:
                enabled = False
            try:
                server, _ = winreg.QueryValueEx(key, "ProxyServer")
            except FileNotFoundError:
                server = ""
            return {"ok": True, "enabled": enabled, "server": server}
    except Exception as e:
        return {"ok": False, "enabled": False, "server": "", "error": str(e)}


def set_proxy_state(enabled: bool, server: str = "127.0.0.1:8080") -> Dict[str, Any]:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _PROXY_KEY, access=winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 1 if enabled else 0)
            if server:
                winreg.SetValueEx(key, "ProxyServer", 0, winreg.REG_SZ, server)
        _notify_system()
        return {"ok": True, "enabled": enabled, "server": server}
    except Exception as e:
        return {"ok": False, "error": str(e)}
