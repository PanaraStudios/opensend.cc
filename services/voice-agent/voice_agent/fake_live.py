"""Fake Gemini socket for the env-gated Docker harness and setup regression tests."""
import asyncio
import contextlib
import json
from unittest.mock import patch
from .factory import create_services, tool_schema


async def capture_live_setup(config, *, declare_tools=True):
    """Exercise pinned Pipecat AND genai serialization before any context frame arrives."""
    sent = []
    ready = asyncio.Event()

    class Socket:
        async def send(self, raw):
            sent.append(json.loads(raw))
            ready.set()

        async def recv(self, **kwargs):
            if not hasattr(self, "acknowledged"):
                self.acknowledged = True
                return b'{"setupComplete":{}}'
            await asyncio.Future()

    @contextlib.asynccontextmanager
    async def connect(*args, **kwargs):
        yield Socket()

    service = create_services(config, tool_schema(config if declare_tools else {})).llm
    # No pipeline task manager is needed for this isolated connection test.
    service.create_task = lambda coro, **kwargs: asyncio.create_task(coro)
    with patch("google.genai.live.ws_connect", connect):
        try:
            assert service._context is None
            await service._connect()
            await asyncio.wait_for(ready.wait(), 3)
            return sent[0]["setup"]
        finally:
            if service._connection_task:
                service._connection_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await service._connection_task
            await service._client.aio.aclose()


def setup_tool_names(setup):
    return [declaration["name"] for tool in setup.get("tools", [])
            for declaration in tool.get("functionDeclarations", [])]
