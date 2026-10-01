"""Only bounded transcript/usage/timing events leave the Python service."""

import time
from pipecat.frames.frames import (
    Frame,
    MetricsFrame,
    UserStoppedSpeakingFrame,
    OutputAudioRawFrame,
    InputTransportMessageFrame,
    ErrorFrame,
    UserSpeakingFrame,
    UserStartedSpeakingFrame,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection


class Telemetry(FrameProcessor):
    def __init__(self, emit, serializer, context):
        super().__init__()
        self.emit = emit
        self.serializer = serializer
        self.context = context
        self.origin = time.monotonic()
        self.speech_end = None
        self.first_audio = False
        self.usage: dict[str, float] = {}
        self.transcript = ""
        self.last_activity = 0

    def now(self):
        return round((time.monotonic() - self.origin) * 1000)

    async def line(self, role: str, text: str, interrupted=False):
        text = text[:16000]
        if interrupted:
            text += " [interrupted]"
        self.transcript = (self.transcript + f"\n{role}: {text}")[-24000:]
        await self.emit(
            {
                "type": "transcript",
                "role": role,
                "text": text,
                "final": True,
                "timestampMs": self.now(),
            }
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if (
            isinstance(frame, (UserSpeakingFrame, UserStartedSpeakingFrame))
            and time.monotonic() - self.last_activity > 1
        ):
            self.last_activity = time.monotonic()
            await self.emit({"type": "activity"})
        if isinstance(frame, UserStoppedSpeakingFrame):
            self.speech_end = time.monotonic()
            self.first_audio = False
        elif isinstance(frame, OutputAudioRawFrame) and self.speech_end and not self.first_audio:
            self.first_audio = True
            await self.emit(
                {
                    "type": "latency",
                    "turnId": self.serializer.turn_id,
                    "latencyMs": round((time.monotonic() - self.speech_end) * 1000),
                }
            )
        elif isinstance(frame, InputTransportMessageFrame):
            message = frame.message
            if message.get("type") == "played_ms":
                self.context.add_message(
                    {
                        "role": "user",
                        "content": f"[Playback interrupted after {message['playedMs']}ms. "
                        "Do not assume the remainder of the last answer was heard.]",
                    }
                )
        elif isinstance(frame, MetricsFrame):
            delta = {}
            for item in frame.data:
                tokens = getattr(item, "value", None)
                if hasattr(tokens, "prompt_tokens"):
                    delta["inputTokens"] = delta.get("inputTokens", 0) + tokens.prompt_tokens
                    delta["outputTokens"] = delta.get("outputTokens", 0) + tokens.completion_tokens
                if hasattr(tokens, "audio_seconds"):
                    delta["audioSeconds"] = delta.get("audioSeconds", 0) + tokens.audio_seconds
                if hasattr(item, "value") and type(item).__name__ == "TTSUsageMetricsData":
                    delta["ttsCharacters"] = delta.get("ttsCharacters", 0) + item.value
            if delta:
                for key, value in delta.items():
                    self.usage[key] = self.usage.get(key, 0) + value
                await self.emit({"type": "usage", "usage": delta})
        elif isinstance(frame, ErrorFrame):
            # Provider exception text can contain request headers. Emit only a fixed code.
            await self.emit({"type": "end", "reason": "Voice provider failed"})
        await self.push_frame(frame, direction)
