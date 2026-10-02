"""Raw PCM16 mono at 16k; versioned JSON controls preserve interruption epochs."""

import json
import uuid
from collections.abc import Awaitable, Callable
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    OutputAudioRawFrame,
    InterruptionFrame,
    InputTransportMessageFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    EndFrame,
    CancelFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer


class VoiceSerializer(FrameSerializer):
    def __init__(self, emit: Callable[[dict], Awaitable[None]], finalize=None):
        super().__init__()
        self.emit = emit
        self.finalize = finalize
        self.turn_id = str(uuid.uuid4())
        self.mark_pending = True
        self.end_reason = "Call ended"
        self.results: dict[str, object] = {}
        self.on_result = None

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if self.should_ignore_frame(frame):
            return None
        if isinstance(frame, InterruptionFrame):
            previous = self.turn_id
            self.turn_id = str(uuid.uuid4())
            self.mark_pending = True
            return json.dumps({"type": "clear", "turnId": previous})
        if isinstance(frame, OutputAudioRawFrame):
            if frame.sample_rate != 16000 or frame.num_channels != 1 or len(frame.audio) % 2:
                raise ValueError("Expected PCM16 mono 16k")
            if self.mark_pending:
                await self.emit({"type": "mark", "turnId": self.turn_id})
                self.mark_pending = False
            return frame.audio
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            return json.dumps(frame.message)
        if isinstance(frame, (EndFrame, CancelFrame)):
            result = await self.finalize() if self.finalize else {}
            return json.dumps({"type": "end", "reason": self.end_reason, **result})
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            if len(data) > 64000 or len(data) % 2:
                raise ValueError("Invalid PCM16 frame")
            return InputAudioRawFrame(data, 16000, 1)
        if len(data) > 24000:
            raise ValueError("Control too large")
        message = json.loads(data)
        if message.get("type") == "end":
            self.end_reason = str(message.get("reason", "Call ended"))[:256]
            return EndFrame()
        if message.get("type") == "tool_result":
            if self.on_result:
                self.on_result(message.get("id"), message.get("result"))
            return None
        if message.get("type") == "played_ms":
            value = message.get("playedMs")
            if not isinstance(value, (int, float)) or not 0 <= value <= 3600000:
                raise ValueError("Invalid playback mark")
            return InputTransportMessageFrame(message)
        raise ValueError("Unknown voice control")
