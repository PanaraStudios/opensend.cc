"""The existing gateway HMAC channel; credentials and provider failures never enter logs."""

import hashlib
import hmac
import json
import time
import uuid
import httpx


class VoiceBackend:
    def __init__(self, origin: str, secret: str, session: dict):
        if len(secret) < 32:
            raise ValueError("Invalid gateway secret")
        self.origin = origin.rstrip("/")
        self.secret = secret.encode()
        self.session = session
        self.client = httpx.AsyncClient(timeout=5, trust_env=False)

    async def post(self, path: str, data: dict):
        body = json.dumps({"version": 1, **data}, separators=(",", ":")).encode()
        timestamp, nonce = str(int(time.time())), str(uuid.uuid4())
        canonical = f"{timestamp}\n{nonce}\nPOST\n{path}\n{hashlib.sha256(body).hexdigest()}"
        signature = hmac.new(self.secret, canonical.encode(), hashlib.sha256).hexdigest()
        response = await self.client.post(
            self.origin + path,
            content=body,
            headers={
                "content-type": "application/json",
                "x-call-gateway-timestamp": timestamp,
                "x-call-gateway-nonce": nonce,
                "x-call-gateway-signature": "sha256=" + signature,
            },
        )
        if response.status_code != 200:
            raise ValueError("Voice backend request failed")
        return response.json()

    async def config(self):
        config = await self.post(
            "/calling/gateway/voice/session",
            {
                "callId": self.session["callId"],
                "organizationId": self.session["organizationId"],
            },
        )
        if config.get("botId") != self.session["botId"]:
            raise ValueError("Bot session changed")
        return config

    async def tool(self, call: dict):
        return await self.post(
            "/calling/gateway/voice/tools",
            {
                "callId": self.session["callId"],
                "organizationId": self.session["organizationId"],
                "toolCall": call,
            },
        )

    async def close(self):
        await self.client.aclose()
