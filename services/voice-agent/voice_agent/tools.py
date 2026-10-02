"""All side effects are authorized by Convex; FreeSWITCH controls return via the gateway."""

import asyncio
import json
import logging
import time

CONTROL_TOOLS = {"transfer_to_agent", "transfer_to_ivr", "end_call"}


class ToolRouter:
    def __init__(self, backend, emit, catalog: list[dict], call_id=None):
        self.call_id = call_id
        self.backend = backend
        self.emit = emit
        self.catalog = {tool["name"]: tool for tool in catalog}
        self.pending: dict[str, asyncio.Future] = {}
        self.count = 0

    def result(self, identifier, result):
        future = self.pending.get(identifier)
        if future and not future.done():
            future.set_result(result)

    async def run(self, identifier: str, name: str, arguments: dict):
        started = time.monotonic()
        async def report(status, **fields):
            event = {"type": "tool_observed", "id": identifier[:128], "name": name[:128],
                     "status": status, **fields}
            # Log bounded backend validation errors, never arguments, results or provider exceptions.
            logging.getLogger("voice-agent").warning(json.dumps({"callId": self.call_id, **event}))
            await self.emit(event)
        await report("requested")
        try:
            result = await self._run(identifier, name, arguments)
        except asyncio.CancelledError:
            await report("failed", latencyMs=round((time.monotonic() - started) * 1000), error="cancelled")
            raise
        except Exception:
            result = {"ok": False, "error": "Tool execution failed"}
        await report("succeeded" if result.get("ok") else "failed",
                     latencyMs=round((time.monotonic() - started) * 1000),
                     **({} if result.get("ok") else {"error": str(result.get("error", "Tool execution failed"))[:512]}))
        return result

    async def _run(self, identifier: str, name: str, arguments: dict):
        tool = self.catalog.get(name)
        if not tool or not isinstance(arguments, dict) or self.count >= 128:
            return {"ok": False, "error": "Tool is not enabled"}
        schema = tool["parameters"]
        if any(key not in schema["properties"] for key in arguments):
            return {"ok": False, "error": "Invalid tool arguments"}
        if any(not isinstance(value, str) or len(value) > 4096 for value in arguments.values()):
            return {"ok": False, "error": "Invalid tool arguments"}
        if any(not arguments.get(key) for key in schema.get("required", [])):
            return {"ok": False, "error": "Missing tool argument"}
        self.count += 1
        call = {"id": identifier, "name": name, "arguments": arguments}
        try:
            if name not in CONTROL_TOOLS:
                return await self.backend.tool(call)
            if len(self.pending) >= 8:
                return {"ok": False, "error": "Tool concurrency limit"}
            future = asyncio.get_running_loop().create_future()
            self.pending[identifier] = future
            await self.emit({"type": "tool_call", **call})
            return await asyncio.wait_for(future, timeout=6)
        except (ValueError, asyncio.TimeoutError):
            return {"ok": False, "error": "Tool could not be completed"}
        finally:
            self.pending.pop(identifier, None)

    async def handle(self, params):
        result = await self.run(params.tool_call_id, params.function_name, params.arguments)
        await params.result_callback(result)

    def close(self):
        for future in self.pending.values():
            if not future.done():
                future.cancel()
        self.pending.clear()
