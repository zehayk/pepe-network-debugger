import json
import queue
import threading
from typing import Optional


class RabbitMQPublisher:
    """
    Publishes flow events to a RabbitMQ fanout exchange.
    A dedicated background thread owns the connection and drains an internal
    queue, so publish() is safe to call from any thread (including mitmproxy's
    event loop) without blocking it.
    Reconnects automatically on connection failure.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._queue: queue.Queue = queue.Queue(maxsize=2000)
        self._enabled = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def connect(self, url: str, exchange: str) -> Optional[str]:
        """Validate credentials, then start the publisher thread.
        Returns an error string on failure, None on success."""
        try:
            import pika
        except ImportError:
            return "pika is not installed — run: pip install pika"

        try:
            params = pika.URLParameters(url)
            params.socket_timeout = 5
            conn = pika.BlockingConnection(params)
            ch = conn.channel()
            ch.exchange_declare(exchange=exchange, exchange_type="fanout", durable=True)
            conn.close()
        except Exception as e:
            return str(e)

        self._stop_thread()

        with self._lock:
            self._enabled = True
            self._stop_event.clear()

        self._thread = threading.Thread(
            target=self._run,
            args=(url, exchange),
            daemon=True,
            name="pepe-rabbitmq",
        )
        self._thread.start()
        return None

    def disconnect(self):
        with self._lock:
            self._enabled = False
        self._stop_thread()

    def publish(self, msg: dict) -> None:
        with self._lock:
            if not self._enabled:
                return
        try:
            self._queue.put_nowait(msg)
        except queue.Full:
            pass

    # ── Internal ─────────────────────────────────────────────────────────────

    def _stop_thread(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._stop_event.clear()

    def _run(self, url: str, exchange: str):
        try:
            import pika
        except ImportError:
            return

        conn = None
        ch = None

        while not self._stop_event.is_set():
            try:
                if conn is None or conn.is_closed:
                    params = pika.URLParameters(url)
                    params.socket_timeout = 5
                    conn = pika.BlockingConnection(params)
                    ch = conn.channel()
                    ch.exchange_declare(exchange=exchange, exchange_type="fanout", durable=True)

                try:
                    msg = self._queue.get(timeout=1.0)
                    ch.basic_publish(
                        exchange=exchange,
                        routing_key="",
                        body=json.dumps(msg, default=str).encode(),
                        properties=pika.BasicProperties(
                            content_type="application/json",
                            delivery_mode=1,
                        ),
                    )
                except queue.Empty:
                    conn.process_data_events(time_limit=0)

            except Exception:
                conn = None
                ch = None
                self._stop_event.wait(5.0)

        try:
            if conn and not conn.is_closed:
                conn.close()
        except Exception:
            pass
