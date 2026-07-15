import hashlib
import json
from email.parser import BytesParser
from email.policy import default
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
        content_type = self.headers.get("content-type", "")
        is_multipart = content_type.startswith("multipart/form-data")
        multipart_fields = {}
        multipart_files = {}
        if is_multipart:
            payload = {}
            message = BytesParser(policy=default).parsebytes(
                f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii") + body
            )
            for part in message.iter_parts():
                name = part.get_param("name", header="content-disposition")
                if not name:
                    continue
                value = part.get_payload(decode=True) or b""
                filename = part.get_filename()
                if filename:
                    multipart_files.setdefault(name, []).append({
                        "filename": filename,
                        "contentType": part.get_content_type(),
                        "bytes": len(value),
                        "hasImageCanary": b"KAVERO_MULTIPART_IMAGE_CANARY" in value,
                        "hasMaskCanary": b"KAVERO_MULTIPART_MASK_CANARY" in value,
                    })
                else:
                    multipart_fields[name] = value.decode("utf-8", errors="replace")
        else:
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
            "isMultipart": is_multipart,
            "hasImageField": b'name="image[]"' in body,
            "hasImageCanary": b"KAVERO_MULTIPART_IMAGE_CANARY" in body,
            "hasMaskCanary": b"KAVERO_MULTIPART_MASK_CANARY" in body,
            "multipartFieldNames": sorted(multipart_fields.keys()),
            "multipartFileNames": sorted(multipart_files.keys()),
            "translatedFieldsValid": (
                not is_multipart
                or (
                    multipart_fields.get("model") == "gpt-image-2"
                    and multipart_fields.get("prompt") == "security-gate-image-edit"
                    and multipart_fields.get("n") == "1"
                    and multipart_fields.get("size") == "1024x1024"
                    and multipart_fields.get("quality") == "high"
                    and multipart_fields.get("background") == "opaque"
                    and "image[]" in multipart_files
                    and "mask" in multipart_files
                    and "api_key" not in multipart_fields
                    and "imageConfig" not in multipart_fields
                    and "thinkingConfig" not in multipart_fields
                )
            ),
            "authorizationPresent": self.headers.get("authorization", "").startswith("Bearer "),
        }
        with hits_lock:
            hits.append(record)

        if "/images/" in self.path:
            self._json(
                200,
                {
                    "created": 1,
                    "data": [{"b64_json": "R0lGODlhAQABAIAAAAUEBA==", "revised_prompt": "mock-image-ok"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                },
            )
            return

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
