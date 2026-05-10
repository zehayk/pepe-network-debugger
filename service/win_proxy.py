import ctypes
import winreg
from typing import Any, Dict, List

_PROXY_SUBKEY = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings"
_OPTION_SETTINGS_CHANGED = 39
_OPTION_REFRESH = 37


def _notify_system() -> None:
    """Notify WinINet of proxy settings change (only effective in caller's session)."""
    try:
        wininet = ctypes.windll.wininet
        wininet.InternetSetOptionW(0, _OPTION_SETTINGS_CHANGED, 0, 0)
        wininet.InternetSetOptionW(0, _OPTION_REFRESH, 0, 0)
    except Exception:
        pass


def _get_interactive_user_sids() -> List[str]:
    """Return SIDs of interactively logged-in users from HKEY_USERS.

    Real user SIDs look like S-1-5-21-…  We skip well-known SIDs
    (SYSTEM, LOCAL SERVICE, NETWORK SERVICE) and the *_Classes hives.
    """
    sids: List[str] = []
    try:
        i = 0
        while True:
            try:
                sid = winreg.EnumKey(winreg.HKEY_USERS, i)
                if sid.startswith("S-1-5-21-") and not sid.endswith("_Classes"):
                    sids.append(sid)
                i += 1
            except OSError:
                break
    except Exception:
        pass
    return sids


def _proxy_targets() -> List[tuple]:
    """Return (root_key, subkey) pairs for every interactive user's proxy settings.

    When running as SYSTEM (Windows service), HKCU points at the SYSTEM
    profile — useless.  Instead we enumerate real user SIDs under HKU.
    Falls back to HKCU when no user SIDs are found (interactive mode).
    """
    sids = _get_interactive_user_sids()
    if sids:
        return [(winreg.HKEY_USERS, f"{sid}\\{_PROXY_SUBKEY}") for sid in sids]
    return [(winreg.HKEY_CURRENT_USER, _PROXY_SUBKEY)]


def get_proxy_state() -> Dict[str, Any]:
    try:
        for root, subkey in _proxy_targets():
            with winreg.OpenKey(root, subkey) as key:
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
    errors: List[str] = []
    targets = _proxy_targets()
    for root, subkey in targets:
        try:
            with winreg.OpenKey(root, subkey, access=winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 1 if enabled else 0)
                if server:
                    winreg.SetValueEx(key, "ProxyServer", 0, winreg.REG_SZ, server)
        except Exception as e:
            errors.append(f"{subkey}: {e}")
    _notify_system()
    if errors:
        return {"ok": False, "error": "; ".join(errors)}
    return {"ok": True, "enabled": enabled, "server": server}
