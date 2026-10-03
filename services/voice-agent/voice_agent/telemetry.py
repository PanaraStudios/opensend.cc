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
    InterruptionFrame,
    TTSTextFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    LLMFullResponseStartFrame,
    LLMFullResponseEndFrame,
    EndFrame,
    CancelFrame,
)
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from .transcript import TurnTranscripts


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
        self.turns = TurnTranscripts()

    def now(self):
        return round((time.monotonic() - self.origin) * 1000)

    async def line(self, role: str, text: str, interrupted=False, timestamp_ms=None):
        text = text[:16000]
        if interrupted:
            text += " [interrupted]"
        self.transcript = (self.transcript + f"\n{role}: {text}")[-24000:]
        stamp = self.now() if timestamp_ms is None else max(0, int(timestamp_ms))
        await self.emit(
            {
                "type": "transcript",
                "role": role,
                "text": text,
                "final": True,
                "timestampMs": stamp,
            }
        )

    async def _emit_caller(self):
        flushed = self.turns.caller.flush()
        if flushed:
            text, timestamp_ms = flushed
            await self.line("caller", text, timestamp_ms=timestamp_ms)

    async def _emit_agent(self, interrupted: bool):
        flushed = self.turns.agent.seal(interrupted)
        if flushed:
            text, timestamp_ms, was_interrupted = flushed
            await self.line("agent", text, was_interrupted, timestamp_ms=timestamp_ms)

    async def _note(self, frame: Frame):
        now = self.now()
        if isinstance(frame, (TTSStartedFrame, LLMFullResponseStartFrame)):
            self.turns.agent.begin()
        elif isinstance(frame, TTSTextFrame):
            self.turns.agent.add_text(
                frame.text,
                now,
                spaced=bool(getattr(frame, "includes_inter_frame_spaces", False)),
            )
        elif isinstance(frame, (InterruptionFrame, UserStartedSpeakingFrame)):
            # The Gemini service has already appended any unsent input tail.
            # Transcription frames still queued behind this system frame are
            # the next utterance, so they stay open until the following flush.
            await self._emit_caller()
            if isinstance(frame, InterruptionFrame):
                await self._emit_agent(True)
        elif isinstance(frame, InputTransportMessageFrame):
            message = frame.message
            if message.get("type") == "played_ms" and self.turns.agent.parts:
                await self._emit_agent(True)
        elif isinstance(frame, (TTSStoppedFrame, LLMFullResponseEndFrame)):
            # Do not commit the caller here. Gemini may still be holding the
            # tail of the utterance in its input-transcription buffer.
            if not self.turns.agent.dropping:
                await self._emit_agent(False)
        elif isinstance(frame, EndFrame):
            await self._emit_caller()
            await self._emit_agent(False)
        elif isinstance(frame, CancelFrame):
            await self._emit_caller()
            await self._emit_agent(True)

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
        await self._note(frame)
        await self.push_frame(frame, direction)
