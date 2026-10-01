"""One-use, 45-second HMAC tokens minted exclusively by call-gateway."""

import base64
import hashlib
import hmac
import json
import re
import time


class SessionTokens:
    def __init__(self, secret: str):
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", secret):
            raise ValueError("Invalid voice-agent secret")
        self.secret = secret.encode()
        self.used: dict[str, float] = {}

    def verify(self, token: str, call_id: str, now: float | None = None) -> dict:
        now = time.time() * 1000 if now is None else now
        try:
            if len(token) > 2048:
                raise ValueError()
            payload, signature = token.split(".")
            expected = (
                base64.urlsafe_b64encode(
                    hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()
                )
                .decode()
                .rstrip("=")
            )
            if not hmac.compare_digest(signature, expected):
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if data.get("version") != 1 or data.get("callId") != call_id:
                raise ValueError()
            if not now < data["expiresAt"] <= now + 60000:
                raise ValueError()
            for field in ("callId", "organizationId", "botId", "nonce"):
                if not re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", data[field]):
                    raise ValueError()
            self.used = {nonce: exp for nonce, exp in self.used.items() if exp > now}
            if data["nonce"] in self.used or len(self.used) >= 512:
                raise ValueError()
            self.used[data["nonce"]] = data["expiresAt"]
            return data
        except (ValueError, KeyError, TypeError):
            raise ValueError("Unauthorized voice session") from None
