import hashlib
import hmac
import os
import re
import time

from fastapi import HTTPException, Request
from litellm.proxy._types import UserAPIKeyAuth


CONTRACT_NAME = "kavero-litellm-routing"
CONTRACT_VERSION = "v1"
MAX_CLOCK_SKEW_SECONDS = 60
HEADER_VERSION = "x-kavero-routing-version"
HEADER_TIMESTAMP = "x-kavero-routing-timestamp"
HEADER_SIGNATURE = "x-kavero-routing-signature"
INFERENCE_ROUTES = {
    ("POST", "/v1/chat/completions"),
    ("POST", "/v1/images/generations"),
}
MODEL_INFO_ROUTES = {
    ("GET", "/model/info"),
    ("GET", "/v1/models"),
}
HEALTH_ROUTES = {
    ("GET", "/health/readiness"),
    ("GET", "/health/liveliness"),
}
HEX_SIGNATURE = re.compile(r"^[0-9a-f]{64}$")
UNIX_TIMESTAMP = re.compile(r"^[0-9]{10}$")


def _required_secret(name: str) -> str:
    value = os.environ.get(name, "")
    if len(value) < 32 or "replace-with-" in value:
        raise RuntimeError(f"{name} must be configured with at least 32 characters")
    return value


def validate_configuration() -> None:
    _required_secret("LITELLM_MASTER_KEY")
    _required_secret("KAVERO_LITELLM_ROUTING_SECRET")


def _reject(status_code: int = 401) -> None:
    raise HTTPException(status_code=status_code, detail="Request authorization failed.")


def _bearer_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        _reject()
    return authorization[len(prefix) :]


def _validate_gateway_key(request: Request) -> str:
    supplied = _bearer_token(request)
    expected = _required_secret("LITELLM_MASTER_KEY")
    if not hmac.compare_digest(supplied.encode("utf-8"), expected.encode("utf-8")):
        _reject()
    return supplied


def _canonical_value(timestamp: str, method: str, path: str, body_hash: str) -> str:
    return "\n".join(
        [CONTRACT_NAME, CONTRACT_VERSION, timestamp, method, path, body_hash]
    )


async def _validate_routing_signature(request: Request, method: str, path: str) -> None:
    version = request.headers.get(HEADER_VERSION, "")
    timestamp = request.headers.get(HEADER_TIMESTAMP, "")
    signature = request.headers.get(HEADER_SIGNATURE, "")

    if version != CONTRACT_VERSION:
        _reject()
    if not UNIX_TIMESTAMP.fullmatch(timestamp):
        _reject()
    if not HEX_SIGNATURE.fullmatch(signature):
        _reject()

    now = int(time.time())
    if abs(now - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
        _reject()

    body = await request.body()
    body_hash = hashlib.sha256(body).hexdigest()
    canonical = _canonical_value(timestamp, method, path, body_hash)
    expected = hmac.new(
        _required_secret("KAVERO_LITELLM_ROUTING_SECRET").encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(signature.encode("ascii"), expected.encode("ascii")):
        _reject()


async def user_api_key_auth(request: Request, api_key: str) -> UserAPIKeyAuth:
    method = request.method.upper()
    path = request.url.path
    route = (method, path)

    if route in HEALTH_ROUTES:
        return UserAPIKeyAuth()

    validated_key = _validate_gateway_key(request)

    if route in MODEL_INFO_ROUTES:
        return UserAPIKeyAuth(api_key=validated_key)

    if route not in INFERENCE_ROUTES:
        _reject(403)

    await _validate_routing_signature(request, method, path)
    return UserAPIKeyAuth(api_key=validated_key)
