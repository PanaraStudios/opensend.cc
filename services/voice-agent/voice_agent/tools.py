"""All side effects are authorized by Convex; FreeSWITCH controls return via the gateway."""

import asyncio

CONTROL_TOOLS = {"transfer_to_agent", "transfer_to_ivr", "end_call"}


class ToolRouter:
    def __init__(self, backend, emit, catalog: list[dict]):
        self.backend = backend
        self.emit = emit
        self.catalog = {tool["name"]: tool for tool in catalog}
        self.pending: dict[str, asyncio.Future] = {}
        self.count = 0
        self.goodbye = None

    def result(self, identifier, result):
        future = self.pending.get(identifier)
        if future and not future.done():
            future.set_result(result)

    async def run(self, identifier: str, name: str, arguments: dict):
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
            if name == "end_call" and self.goodbye:
                await self.goodbye()
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
