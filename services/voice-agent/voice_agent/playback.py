"""Observe output transport completion, after Pipecat has sent the speech audio."""

import uuid
from pipecat.frames.frames import BotStoppedSpeakingFrame, Frame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection


class PlaybackObserver(FrameProcessor):
    def __init__(self, emit, serializer):
        super().__init__()
        self.emit = emit
        self.serializer = serializer

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, BotStoppedSpeakingFrame) and direction == FrameDirection.DOWNSTREAM:
            if not self.serializer.mark_pending:
                await self.emit({"type": "playback_done", "turnId": self.serializer.turn_id})
                self.serializer.turn_id = str(uuid.uuid4())
                self.serializer.mark_pending = True
        await self.push_frame(frame, direction)
