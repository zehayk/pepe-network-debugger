"""Singleton instances shared between proxy.py and api.py."""
import queue

from stores import FlowStore, OverrideStore, RequestOverrideStore, BlockStore, BypassStore
from settings import SettingsStore
from amqp_capture import AMQPCaptureRunner

flow_store = FlowStore()
resp_override_store = OverrideStore()
req_override_store = RequestOverrideStore()
block_store = BlockStore()
bypass_store = BypassStore()
settings_store = SettingsStore()
amqp_runner = AMQPCaptureRunner()

# mitmproxy posts {"type": ..., ...} here; api.py drains and broadcasts to WS clients
broadcast_queue: queue.Queue = queue.Queue()

# Set by service.py after ProxyRunner is created so api.py can call update_ignore_hosts()
proxy_runner = None

# Auto-start AMQP capture if it was enabled in persisted settings
if settings_store.get("amqp_capture_enabled"):
    amqp_runner.start(
        local_port=settings_store.get("amqp_listen_port", 5673),
        upstream_host=settings_store.get("amqp_upstream_host", "localhost"),
        upstream_port=settings_store.get("amqp_upstream_port", 5672),
    )
