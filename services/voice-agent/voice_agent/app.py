"""Private FastAPI transport. No Meta WebRTC/WhatsApp transport: FreeSWITCH owns the call."""

import asyncio
import logging
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from loguru import logger
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.workers.runner import WorkerRunner
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
    LLMAssistantAggregatorParams,
)
from pipecat.frames.frames import LLMRunFrame, TTSSpeakFrame
from pipecat.turns.user_mute.mute_until_first_bot_complete_user_mute_strategy import (
    MuteUntilFirstBotCompleteUserMuteStrategy,
)
from pipecat.transports.websocket.fastapi import FastAPIWebsocketTransport, FastAPIWebsocketParams
from .auth import SessionTokens
from .backend import VoiceBackend
from .serializer import VoiceSerializer
from .tools import ToolRouter
from .factory import create_services, summarize
from .telemetry import Telemetry
from .fake import FakePipeline

# Provider SDK logs can include request details. Our own events contain only bounded safe fields.
logger.remove()
for name in ("httpx", "httpcore", "openai", "google"):
    logging.getLogger(name).setLevel(logging.CRITICAL)
app = FastAPI()
tokens = None
active_calls: set[str] = set()


@app.get("/healthz")
async def health():
    ok = bool(os.getenv("VOICE_AGENT_SECRET") and os.getenv("CALL_GATEWAY_SECRET"))
    return JSONResponse({"ok": ok}, status_code=200 if ok else 503)


@app.websocket("/ws")
async def session(websocket: WebSocket):
    global tokens
    await websocket.accept()
    backend = None
    call_id = None
    config = None
    tools = None
    phase = "auth"
    try:
        start = await asyncio.wait_for(websocket.receive_json(), timeout=5)
        if start.get("type") != "start":
            raise ValueError("Unauthorized start")
        if tokens is None:
            tokens = SessionTokens(os.environ["VOICE_AGENT_SECRET"])
        claims = tokens.verify(start.get("sessionToken", ""), start.get("callId", ""))
        call_id = claims["callId"]
        if call_id in active_calls or len(active_calls) >= 100:
            raise ValueError("Voice session unavailable")
        active_calls.add(call_id)
        phase = "config"
        backend = VoiceBackend(
            os.environ["CALL_GATEWAY_CONVEX_HTTP_URL"], os.environ["CALL_GATEWAY_SECRET"], claims
        )
        config = await backend.config()
        phase = "pipeline"
        lock = asyncio.Lock()

        async def emit(message):
            async with lock:
                await websocket.send_json(message)

        serializer = VoiceSerializer(emit)
        tools = ToolRouter(backend, emit, config["toolCatalog"])
        serializer.on_result = tools.result
        transport = FastAPIWebsocketTransport(
            websocket,
            FastAPIWebsocketParams(
                audio_in_enabled=True,
                audio_out_enabled=True,
                audio_in_sample_rate=16000,
                audio_out_sample_rate=16000,
                add_wav_header=False,
                serializer=serializer,
                session_timeout=config["maxDurationSeconds"] + 10,
            ),
        )
        runner = WorkerRunner(handle_sigint=False)
        fake = os.getenv("VOICE_AGENT_FAKE_ENABLED") == "true"
        if fake:
            pipeline = Pipeline([transport.input(), FakePipeline(emit, tools), transport.output()])
            serializer.finalize = lambda: fake_summary()
        else:
            services = create_services(config)

            async def goodbye():
                await worker.queue_frame(services.goodbye_frame())

            tools.goodbye = goodbye
            functions = [
                FunctionSchema(
                    name=tool["name"],
                    description=tool["description"],
                    properties=tool["parameters"]["properties"],
                    required=tool["parameters"].get("required", []),
                )
                for tool in config["toolCatalog"]
            ]
            context = LLMContext(messages=[], tools=ToolsSchema(standard_tools=functions))
            aggregators = LLMContextAggregatorPair(
                context,
                realtime_service_mode=services.realtime,
                user_params=LLMUserAggregatorParams(
                    vad_analyzer=SileroVADAnalyzer(
                        sample_rate=16000, params=VADParams(start_secs=0.2, stop_secs=0.5)
                    ),
                    user_idle_timeout=config["silenceTimeoutSeconds"],
                    user_mute_strategies=[MuteUntilFirstBotCompleteUserMuteStrategy()],
                ),
                assistant_params=LLMAssistantAggregatorParams(
                    enable_auto_context_summarization=not services.realtime
                ),
            )
            telemetry = Telemetry(emit, serializer, context)
            for function in functions:
                services.llm.register_function(
                    function.name, tools.handle, cancel_on_interruption=True
                )

            @aggregators.user().event_handler("on_user_turn_message_added")
            async def user_line(aggregator, message):
                await telemetry.line("caller", message.content)

            @aggregators.assistant().event_handler("on_assistant_turn_stopped")
            async def assistant_line(aggregator, message):
                if message.content:
                    await telemetry.line("agent", message.content, message.interrupted)

            @aggregators.user().event_handler("on_user_turn_idle")
            async def idle(aggregator):
                serializer.end_reason = "Bot silence timeout"
                await worker.end()

            async def finalize():
                return {
                    "summary": await summarize(services.summarizer, telemetry.transcript),
                    "usage": telemetry.usage,
                }

            serializer.finalize = finalize
            processors = [transport.input()]
            if services.stt:
                processors.append(services.stt)
            processors.extend([aggregators.user(), services.llm])
            if services.tts:
                processors.append(services.tts)
            processors.extend([telemetry, transport.output(), aggregators.assistant()])
            pipeline = Pipeline(processors)

        worker = PipelineWorker(
            pipeline,
            name="voice-assistant",
            params=PipelineParams(
                audio_in_sample_rate=16000,
                audio_out_sample_rate=16000,
                enable_metrics=True,
                enable_usage_metrics=True,
            ),
        )

        @transport.event_handler("on_client_connected")
        async def connected(transport, client):
            await emit({"type": "ready"})
            if not fake:
                disclosure = config["disclosure"] + " " + config["greeting"]
                if services.tts:
                    await worker.queue_frame(TTSSpeakFrame(disclosure))
                else:
                    context.add_message(
                        {
                            "role": "user",
                            "content": "First say exactly this disclosure, then the greeting: "
                            + disclosure,
                        }
                    )
                    await worker.queue_frame(LLMRunFrame())

        @transport.event_handler("on_client_disconnected")
        async def disconnected(transport, client):
            await runner.cancel()

        await runner.add_workers(worker)
        await runner.run()
    except (ValueError, KeyError, TypeError, asyncio.TimeoutError) as error:
        logging.getLogger("voice-agent").error(
            "Voice session rejected in %s (%s)", phase, type(error).__name__
        )
        try:
            await websocket.close(code=1008, reason="Voice session rejected")
        except RuntimeError:
            pass
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logging.getLogger("voice-agent").error("Voice session failed (%s)", type(error).__name__)
        try:
            await websocket.close(code=1011, reason="Voice session failed")
        except RuntimeError:
            pass
    finally:
        if tools:
            tools.close()
        if config:
            config.get("keys", {}).clear()
        if backend:
            await backend.close()
        if call_id:
            active_calls.discard(call_id)


async def fake_summary():
    return {
        "summary": "Harness caller interrupted the greeting and looked up their contact.",
        "usage": {"inputTokens": 1, "outputTokens": 1},
    }
