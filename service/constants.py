from pathlib import Path

API_HOST = "127.0.0.1"
API_PORT = 7779

# Shared mitmproxy confdir — same path whether running as Windows service
# (Session 0 / SYSTEM) or interactively, so the CA cert is always findable.
MITMPROXY_CONFDIR = Path("C:/ProgramData/PEPE/mitmproxy")

SERVICE_NAME = "PEPEService"
SERVICE_DISPLAY = "PEPE Background Network Sniffer"
SERVICE_DESC = "PEPE transparent HTTP/S proxy and capture API (port 8080/7779)."
