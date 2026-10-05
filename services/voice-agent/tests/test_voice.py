from pipecat.processors.frameworks.rtvi.models import MESSAGE_LABEL
import asyncio
import base64
import hashlib
import hmac
import json
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch
import pytest
from fastapi.testclient import TestClient
from pipecat.frames.frames import InputAudioRawFrame, OutputAudioRawFrame, InterruptionFrame
from pipecat.frames.frames import OutputTransportMessageFrame
from voice_agent.auth import SessionTokens
from voice_agent.serializer import VoiceSerializer
from voice_agent.tools import ToolRouter
from voice_agent.factory import create_services, ResumableGeminiLive, VoiceSarvamLLM

SECRET = "a" * 64


def token(claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    signature = (
        base64.urlsafe_b64encode(
            hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()
        )
        .decode()
        .rstrip("=")
    )
    return payload + "." + signature


def claims():
    return {
        "version": 1,
        "callId": "call-1",
        "organizationId": "team-1",
        "botId": "bot-1",
        "expiresAt": time.time() * 1000 + 45000,
        "nonce": "unique-nonce",
    }


def config():
    return {
        "engine": "cascade",
        "keys": {"stt": "fake", "llm": "fake", "tts": "fake"},
        "language": "hi-IN",
        "systemPrompt": "Helpful assistant",
        "stt": {"provider": "sarvam", "model": "saaras:v4", "language": "hi-IN"},
        "llm": {"provider": "sarvam", "model": "sarvam-105b-conversations"},
        "tts": {"provider": "elevenlabs", "model": "eleven_flash_v2_5", "voice": "test-voice"},
    }


async def test_serializer_pcm_round_trip_and_interrupt_epoch():
    emit = AsyncMock()
    serializer = VoiceSerializer(emit)
    pcm = bytes(640)
    frame = await serializer.deserialize(pcm)
    assert isinstance(frame, InputAudioRawFrame)
    assert frame.sample_rate == 16000 and frame.num_channels == 1 and frame.audio == pcm
    assert await serializer.serialize(OutputAudioRawFrame(pcm, 16000, 1)) == pcm
    assert (
        await serializer.serialize(
            OutputTransportMessageFrame({"label": MESSAGE_LABEL, "type": "bot-ready"})
        )
        is None
    )
    old = serializer.turn_id
    assert json.loads(await serializer.serialize(InterruptionFrame())) == {
        "type": "clear",
        "turnId": old,
    }
    await serializer.serialize(OutputAudioRawFrame(pcm, 16000, 1))
    assert emit.await_args.args[0]["turnId"] != old
    with pytest.raises(ValueError):
        await serializer.deserialize(b"x")
    with pytest.raises(ValueError):
        await serializer.serialize(OutputAudioRawFrame(pcm, 8000, 1))
    with pytest.raises(ValueError):
        await serializer.deserialize('{"type":"played_ms","playedMs":-1}')


def test_auth_expiry_call_binding_signature_and_replay():
    auth = SessionTokens(SECRET)
    data = claims()
    signed = token(data)
    assert auth.verify(signed, "call-1")["organizationId"] == "team-1"
    for value, call_id in [(signed, "call-1"), (signed, "other-call"), (signed + "bad", "call-1")]:
        with pytest.raises(ValueError, match="Unauthorized"):
            auth.verify(value, call_id)
    data["expiresAt"] = time.time() * 1000 - 1
    with pytest.raises(ValueError):
        SessionTokens(SECRET).verify(token(data), "call-1")


@pytest.mark.parametrize("stt_provider", ["sarvam", "elevenlabs"])
@pytest.mark.parametrize("llm_provider", ["sarvam", "gemini"])
@pytest.mark.parametrize("tts_provider", ["sarvam", "elevenlabs"])
def test_factory_selects_every_supported_cascade(stt_provider, llm_provider, tts_provider):
    value = config()
    value["stt"].update(
        provider=stt_provider,
        model="saaras:v4" if stt_provider == "sarvam" else "scribe_v2_realtime",
    )
    value["llm"].update(
        provider=llm_provider,
        model="sarvam-105b-conversations" if llm_provider == "sarvam" else "gemini-3.8-flash",
    )
    value["tts"].update(
        provider=tts_provider,
        model="bulbul:v3" if tts_provider == "sarvam" else "eleven_flash_v2_5",
        voice="shubh" if tts_provider == "sarvam" else "test-voice",
    )
    services = create_services(value)
    assert not services.realtime
    assert stt_provider.lower() in type(services.stt).__name__.lower()
    assert ("sarvam" if llm_provider == "sarvam" else "google") in type(
        services.llm
    ).__name__.lower()
    assert tts_provider.lower() in type(services.tts).__name__.lower()
    assert services.tts._sample_rate == 16000 or services.tts._init_sample_rate == 16000


def test_factory_live_compression_and_sarvam_reasoning_disabled():
    value = config()
    value.update(engine="gemini_live", model="gemini-3.8-live", voice="Kore", keys={"live": "fake"})
    services = create_services(value)
    assert services.realtime
    assert services.llm._settings.context_window_compression["enabled"] is True
    assert services.llm._settings.language is None
    sarvam = create_services(config()).llm
    with patch.object(
        VoiceSarvamLLM.__mro__[1],
        "build_chat_completion_params",
        return_value={"model": "sarvam-105b-conversations"},
    ):
        assert sarvam.build_chat_completion_params({})["reasoning_effort"] is None


async def test_goaway_uses_pipecat_resumption_path():
    service = object.__new__(ResumableGeminiLive)
    service._disconnecting = False
    service._reconnect = AsyncMock()

    async def execute(coroutine, name):
        await coroutine

    service.create_task = lambda coroutine, name: asyncio.create_task(execute(coroutine, name))
    message = SimpleNamespace(go_away={"time_left": "10s"})
    with patch.object(ResumableGeminiLive.__mro__[1], "_handle_server_message", new=AsyncMock()):
        await service._handle_server_message(message)
        await asyncio.sleep(0)
    service._reconnect.assert_awaited_once()


async def test_tools_keep_authority_in_backend_and_controls_in_gateway():
    backend, emit = Mock(), AsyncMock()
    backend.tool = AsyncMock(return_value={"ok": True, "result": {"name": "Caller"}})
    catalog = [
        {"name": name, "parameters": {"properties": {}, "required": []}}
        for name in ["lookup_contact", "end_call", "transfer_to_ivr"]
    ]
    router = ToolRouter(backend, emit, catalog)
    assert (await router.run("tool-1", "lookup_contact", {}))["ok"]
    backend.tool.assert_awaited_once_with(
        {"id": "tool-1", "name": "lookup_contact", "arguments": {}}
    )
    assert not (await router.run("tool-2", "lookup_contact", {"organizationId": "evil"}))["ok"]
    pending = asyncio.create_task(router.run("tool-3", "end_call", {}))
    await asyncio.sleep(0)
    emit.assert_awaited_with(
        {"type": "tool_call", "id": "tool-3", "name": "end_call", "arguments": {}}
    )
    router.result("tool-3", {"ok": True, "result": {"action": "end_call"}})
    assert (await pending)["ok"]
    router.close()


def test_websocket_rejects_bad_auth_before_fetching_credentials(monkeypatch):
    from voice_agent import app as module

    monkeypatch.setenv("VOICE_AGENT_SECRET", SECRET)
    module.tokens = None
    with patch.object(module.VoiceBackend, "config", new=AsyncMock()) as fetch_config:
        with TestClient(module.app) as client:
            with client.websocket_connect("/ws") as socket:
                socket.send_json({"type": "start", "callId": "call-1", "sessionToken": "invalid"})
                message = socket.receive()
                assert message["type"] == "websocket.close" and message["code"] == 1008
        fetch_config.assert_not_awaited()


def test_factory_eleven_v4_uses_dialogue_endpoint_for_all_indian_languages():
    value = config()
    value["tts"].update(model="eleven_v4_turbo")
    value["language"] = "or-IN"
    service = create_services(value).tts
    assert "Dialogue" in type(service).__name__
    assert service._settings.model == "eleven_v4_turbo"
    service._output_format = "pcm_16000"
    assert "/text-to-dialogue/multi-stream-input" in service._build_websocket_url()
    assert "model_id=eleven_v4_turbo" in service._build_websocket_url()


def test_authenticated_fake_pipeline_starts_and_finishes_over_websocket(monkeypatch):
    from voice_agent import app as module

    monkeypatch.setenv("VOICE_AGENT_SECRET", SECRET)
    monkeypatch.setenv("CALL_GATEWAY_SECRET", SECRET)
    monkeypatch.setenv("CALL_GATEWAY_CONVEX_HTTP_URL", "http://fixture.test")
    monkeypatch.setenv("VOICE_AGENT_FAKE_ENABLED", "true")
    module.tokens = None
    value = config()
    value.update(
        botId="bot-1",
        maxDurationSeconds=6,
        toolCatalog=[
            {
                "name": "lookup_contact",
                "description": "Current caller",
                "parameters": {"type": "object", "properties": {}, "required": []},
            }
        ],
    )
    with patch.object(module.VoiceBackend, "config", new=AsyncMock(return_value=value)):
        with TestClient(module.app) as client:
            with client.websocket_connect("/ws") as socket:
                socket.send_json(
                    {"type": "start", "callId": "call-1", "sessionToken": token(claims())}
                )
                first = socket.receive()
                assert first["type"] == "websocket.send", first
                assert json.loads(first["text"])["type"] == "ready"
                socket.send_json({"type": "end", "reason": "Test completed"})
                while True:
                    message = socket.receive()
                    assert message["type"] != "websocket.close", message
                    if message.get("text"):
                        data = json.loads(message["text"])
                        assert data["type"] in {
                            "mark",
                            "clear",
                            "transcript",
                            "usage",
                            "latency",
                            "end",
                        }, data
                        if data["type"] == "end":
                            assert data["summary"].startswith("Harness caller")
                            break


def test_end_call_instructions_are_conditional_and_preserve_custom_prompt():
    from voice_agent.factory import system_instruction
    value = config()
    original = value["systemPrompt"]
    assert "end_call" not in system_instruction(value)
    value["toolCatalog"] = [{"name": "end_call"}]
    instruction = system_instruction(value)
    assert instruction.startswith(original)
    for text in ["says goodbye", "asks to hang up", "conversation is complete", "invoke end_call", "pending"]:
        assert text in instruction
    assert value["systemPrompt"] == original


@pytest.mark.parametrize("names", [[], ["end_call"], ["lookup_contact", "send_whatsapp_message", "create_note", "end_call", "transfer_to_agent", "transfer_to_ivr"]])
async def test_live_first_websocket_setup_declares_all_enabled_tools(names):
    from voice_agent.fake_live import capture_live_setup, setup_tool_names
    value = config()
    value.update(engine="gemini_live", model="gemini-3.8-live", voice="Kore", keys={"live": "fake"})
    value["toolCatalog"] = [{"name": name, "description": "Test " + name,
        "parameters": {"properties": {"text": {"type": "string"}}, "required": []}} for name in names]
    legacy_setup = await capture_live_setup(value, declare_tools=False)
    assert setup_tool_names(legacy_setup) == []
    setup = await capture_live_setup(value)
    assert setup_tool_names(setup) == names
    if names:
        assert setup["tools"][0]["functionDeclarations"][0]["parameters"]["properties"]["text"]["type"].lower() == "string"


@pytest.mark.parametrize("provider", ["sarvam", "gemini"])
def test_cascade_invocation_contains_same_tool_declarations(provider):
    from voice_agent.factory import tool_schema
    from pipecat.processors.aggregators.llm_context import LLMContext
    value = config()
    value["llm"].update(provider=provider, model="gemini-3.8-flash" if provider == "gemini" else "sarvam-105b-conversations")
    value["toolCatalog"] = [{"name": name, "description": name,
        "parameters": {"properties": {}, "required": []}} for name in ["create_note", "end_call"]]
    schema = tool_schema(value)
    services = create_services(value, schema)
    context = LLMContext(messages=[], tools=schema)
    for function in schema.standard_tools:
        services.llm.register_function(function.name, AsyncMock())
    params = services.llm.get_llm_adapter().get_llm_invocation_params(context, **({"convert_developer_to_user": False} if provider == "sarvam" else {}))
    serialized = json.dumps(params, default=str)
    assert "create_note" in serialized and "end_call" in serialized


def test_caller_context_is_injected_for_both_engines_and_capped():
    from voice_agent.factory import system_instruction

    block = "Caller context (from the CRM; do not read it out unless relevant): name: Ada"
    live = config()
    live.update(
        engine="gemini_live",
        model="gemini-3.8-live",
        voice="Kore",
        keys={"live": "fake"},
        callerContextBlock=block,
    )
    cascade = config()
    cascade["callerContextBlock"] = block
    for value in (live, cascade):
        text = create_services(value).llm._settings.system_instruction
        assert isinstance(text, str)
        assert text.startswith(value["systemPrompt"])
        assert block in text
    bare = config()
    assert "Caller context" not in system_instruction(bare)
    bare["callerContextBlock"] = {"name": "Ada"}
    assert "Ada" not in system_instruction(bare)
    huge = config()
    huge["callerContextBlock"] = "¤" * 5000
    assert system_instruction(huge).count("¤") == 2000


@pytest.mark.parametrize("gender, word", [("female", "feminine"), ("male", "masculine")])
def test_voice_gender_is_in_runtime_prompt(gender, word):
    from voice_agent.factory import system_instruction
    value = config()
    value["voiceGender"] = gender
    assert word in system_instruction(value)


async def test_tool_logs_and_gateway_observations_include_backend_errors_without_arguments(caplog):
    backend, emit = Mock(), AsyncMock()
    backend.tool = AsyncMock(return_value={"ok": False, "error": "No agent available"})
    router = ToolRouter(backend, emit, [{"name": "create_note", "parameters": {
        "properties": {"text": {"type": "string"}}, "required": ["text"]}}])
    await router.run("note-1", "create_note", {"text": "Secret note contents"})
    events = [call.args[0] for call in emit.await_args_list]
    assert [e["status"] for e in events] == ["requested", "failed"]
    assert events[-1]["latencyMs"] >= 0
    assert "create_note" in caplog.text
    assert "Secret note" not in caplog.text
    assert "No agent available" in caplog.text
    assert events[-1]["error"] == "No agent available"


async def test_output_playback_observer_marks_completion_and_next_speech_epoch():
    from pipecat.frames.frames import BotStoppedSpeakingFrame
    from pipecat.processors.frame_processor import FrameDirection
    from voice_agent.playback import PlaybackObserver
    emit = AsyncMock()
    serializer = VoiceSerializer(emit)
    observer = PlaybackObserver(emit, serializer)
    observer.push_frame = AsyncMock()
    await serializer.serialize(OutputAudioRawFrame(bytes(640), 16000, 1))
    turn = serializer.turn_id
    await observer.process_frame(BotStoppedSpeakingFrame(), FrameDirection.DOWNSTREAM)
    assert emit.await_args.args[0] == {"type": "playback_done", "turnId": turn}
    await serializer.serialize(OutputAudioRawFrame(bytes(640), 16000, 1))
    assert emit.await_args.args[0]["type"] == "mark"
    assert emit.await_args.args[0]["turnId"] != turn


def test_outbound_opening_starts_with_the_configured_greeting():
    from voice_agent.factory import opening_text
    config = {
        "greeting": "Hello Ada, this is your seminar follow-up.",
        "disclosure": "I am an automated assistant.",
        "callDirection": "outbound",
    }
    assert opening_text(config).startswith(config["greeting"])
    assert opening_text(config).endswith(config["disclosure"])
    config["callDirection"] = "inbound"
    assert opening_text(config).startswith(config["disclosure"])


def toolkit_config():
    value = config()
    value["collect"] = [{"key": "guests", "label": "Guests", "description": "Ask how many guests", "type": "number", "required": True}]
    value["knowledgeBaseIds"] = ["knowledge-base"]
    value["customToolIds"] = ["custom-tool"]
    value["toolCatalog"] = [
        {"name": "search_knowledge", "description": "Search material", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
        {"name": "save_field", "description": "Save caller data", "parameters": {"type": "object", "properties": {"key": {"type": "string"}, "value": {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}]}}, "required": ["key", "value"]}},
        {"name": "book_appointment", "description": "Call a system", "parameters": {"type": "object", "properties": {"guests": {"type": "number"}, "confirmed": {"type": "boolean"}}, "required": ["guests"]}},
    ]
    return value


@pytest.mark.asyncio
async def test_live_declares_knowledge_collection_and_custom_tools():
    from voice_agent.fake_live import capture_live_setup, setup_tool_names
    value = toolkit_config()
    value.update(engine="gemini_live", model="gemini-3.8-live", voice="Kore", keys={"live": "sk_fixture_not_a_real_key"})
    setup = await capture_live_setup(value)
    assert setup_tool_names(setup) == ["search_knowledge", "save_field", "book_appointment"]
    parameters = setup["tools"][0]["functionDeclarations"][1]["parameters"]["properties"]["value"]
    assert len(parameters.get("anyOf", parameters.get("any_of", []))) == 3, parameters


@pytest.mark.parametrize("provider", ["sarvam", "gemini"])
def test_cascade_declares_toolkit_and_collection_instructions(provider):
    from voice_agent.factory import tool_schema, system_instruction
    from pipecat.processors.aggregators.llm_context import LLMContext
    value = toolkit_config()
    value["llm"].update(provider=provider, model="gemini-3.8-flash" if provider == "gemini" else "sarvam-105b-conversations")
    schema = tool_schema(value)
    services = create_services(value, schema)
    context = LLMContext(messages=[], tools=schema)
    params = services.llm.get_llm_adapter().get_llm_invocation_params(context, **({"convert_developer_to_user": False} if provider == "sarvam" else {}))
    serialized = json.dumps(params, default=str)
    for name in ["search_knowledge", "save_field", "book_appointment"]:
        assert name in serialized
    instruction = system_instruction(value)
    assert "say you do not know" in instruction
    assert "Ask how many guests" in instruction


@pytest.mark.asyncio
async def test_tool_router_accepts_zero_false_and_typed_collection_rejects_invalid_scalars():
    backend = AsyncMock()
    backend.tool.return_value = {"ok": True, "result": "saved"}
    router = ToolRouter(backend, AsyncMock(), toolkit_config()["toolCatalog"])
    assert (await router.run("zero", "save_field", {"key": "guests", "value": 0}))["ok"]
    assert (await router.run("false", "book_appointment", {"guests": 0, "confirmed": False}))["ok"]
    assert not (await router.run("invalid", "book_appointment", {"guests": "zero"}))["ok"]
    assert not (await router.run("nan", "book_appointment", {"guests": float("nan")}))["ok"]
    assert backend.tool.call_count == 2


async def test_rejected_duplicate_session_cannot_release_the_owners_active_marker(monkeypatch):
    from voice_agent import app as module

    monkeypatch.setenv("VOICE_AGENT_SECRET", SECRET)
    monkeypatch.setenv("CALL_GATEWAY_SECRET", SECRET)
    monkeypatch.setenv("CALL_GATEWAY_CONVEX_HTTP_URL", "http://fixture.test")
    monkeypatch.setattr(module, "tokens", None)
    monkeypatch.setattr(module, "active_calls", set())
    entered = asyncio.Event()

    async def blocked_config():
        entered.set()
        await asyncio.Event().wait()

    def socket(nonce):
        value = claims()
        value["nonce"] = nonce
        return SimpleNamespace(
            accept=AsyncMock(),
            receive_json=AsyncMock(return_value={"type": "start", "callId": "call-1", "sessionToken": token(value)}),
            close=AsyncMock(),
        )

    with patch.object(module.VoiceBackend, "config", new=AsyncMock(side_effect=blocked_config)) as fetch_config:
        owner = asyncio.create_task(module.session(socket("owner")))
        await entered.wait()
        try:
            for nonce in ("duplicate", "another-duplicate"):
                duplicate = socket(nonce)
                await module.session(duplicate)
                duplicate.close.assert_awaited_once_with(code=1008, reason="Voice session rejected")
                assert module.active_calls == {"call-1"}
            assert fetch_config.await_count == 1
        finally:
            owner.cancel()
            with pytest.raises(asyncio.CancelledError):
                await owner
        assert not module.active_calls
