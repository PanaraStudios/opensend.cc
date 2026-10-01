"""Explicitly env-gated Pipecat processor used only by the isolated Docker harness."""

import math
import struct
from pipecat.frames.frames import Frame, StartFrame, InputAudioRawFrame, OutputAudioRawFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection


class FakePipeline(FrameProcessor):
    def __init__(self, emit, tools):
        super().__init__()
        self.emit = emit
        self.tools = tools
        self.frames = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, StartFrame):
            await self.push_frame(frame, direction)
            pcm = b"".join(
                struct.pack("<h", round(4000 * math.sin(2 * math.pi * 880 * n / 16000)))
                for n in range(48000)
            )
            await self.push_frame(OutputAudioRawFrame(pcm, 16000, 1))
        elif isinstance(frame, InputAudioRawFrame):
            samples = struct.unpack(f"<{len(frame.audio) // 2}h", frame.audio)
            if not samples or sum(n * n for n in samples) / len(samples) < 10000:
                return
            self.frames += 1
            if self.frames == 10:
                await self.broadcast_interruption()
            if self.frames >= 10:
                await self.push_frame(OutputAudioRawFrame(frame.audio, 16000, 1))
            if self.frames == 20:
                result = await self.tools.run("fake-tool-1", "lookup_contact", {})
                import json

                await self.emit(
                    {
                        "type": "transcript",
                        "role": "agent",
                        "text": json.dumps(result),
                        "final": True,
                        "timestampMs": self.frames * 20,
                    }
                )
            if self.frames == 80:
                if "transfer_to_agent" in self.tools.catalog:
                    await self.tools.run("fake-transfer-1", "transfer_to_agent", {"summary": "Harness caller needs an agent"})
                elif "transfer_to_ivr" in self.tools.catalog:
                    await self.tools.run("fake-transfer-1", "transfer_to_ivr", {})
        else:
            await self.push_frame(frame, direction)
