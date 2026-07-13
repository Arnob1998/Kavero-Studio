import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from urllib.parse import urlsplit


hits = []
hits_lock = Lock()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def _json(self, status, payload):
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlsplit(self.path).path != "/hits":
            self._json(404, {"error": "not-found"})
            return
        with hits_lock:
            snapshot = list(hits)
        self._json(200, {"count": len(snapshot), "hits": snapshot})

    def do_DELETE(self):
        if urlsplit(self.path).path != "/hits":
            self._json(404, {"error": "not-found"})
            return
        with hits_lock:
            hits.clear()
        self._json(200, {"count": 0})

    def do_POST(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body)
        except json.JSONDecodeError:
            self._json(400, {"error": "invalid-json"})
            return

        messages = payload.get("messages") if isinstance(payload, dict) else None
        serialized_messages = json.dumps(messages, separators=(",", ":")) if messages else ""
        record = {
            "method": "POST",
            "path": self.path,
            "bodyBytes": len(body),
            "bodyHash": hashlib.sha256(body).hexdigest(),
            "hasLargeMarker": "KAVERO_LARGE_MULTIMODAL_MARKER" in serialized_messages,
        }
        with hits_lock:
            hits.append(record)

        self._json(
            200,
            {
                "id": "mock-response",
                "object": "chat.completion",
                "created": 1,
                "model": payload.get("model", "mock"),
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "mock-ok"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
            },
        )


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
