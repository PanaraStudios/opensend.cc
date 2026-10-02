"""Optional paid provider smoke, launched explicitly with pnpm test:voice-live.
Uses only environment keys; CI uses fake providers and never runs this script.
"""

import asyncio
import os
from loguru import logger

from pipecat.frames.frames import Frame, OutputAudioRawFrame, LLMRunFrame, InputAudioRawFrame
from pipecat.processors.frame_processor import FrameProcessor, FrameDirection
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.workers.runner import WorkerRunner
from voice_agent.factory import create_services

logger.remove()


class Capture(FrameProcessor):
    def __init__(self):
        super().__init__()
        self.audio_bytes = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, OutputAudioRawFrame):
            self.audio_bytes += len(frame.audio)
        await self.push_frame(frame, direction)


async def run(config):
    services = create_services(config)
    context = LLMContext(messages=[{"role": "user", "content": "Say a short hello."}])
    pair = LLMContextAggregatorPair(
        context,
        realtime_service_mode=services.realtime,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer(sample_rate=16000)),
    )
    capture = Capture()
    processors = ([services.stt] if services.stt else []) + [pair.user(), services.llm]
    processors += ([services.tts] if services.tts else []) + [capture, pair.assistant()]
    worker = PipelineWorker(
        Pipeline(processors),
        name="smoke",
        params=PipelineParams(audio_in_sample_rate=16000, audio_out_sample_rate=16000),
    )
    runner = WorkerRunner(handle_sigint=False)
    await runner.add_workers(worker)
    await worker.queue_frame(LLMRunFrame())

    async def finish():
        for _ in range(200):
            await worker.queue_frame(InputAudioRawFrame(bytes(640), 16000, 1))
            await asyncio.sleep(0.02)
        await worker.end()

    finish_task = asyncio.create_task(finish())
    try:
        await asyncio.wait_for(runner.run(), timeout=15)
        if not capture.audio_bytes:
            raise RuntimeError("No provider audio")
    finally:
        finish_task.cancel()
        await runner.cancel()
    print(f"PASS {config['engine']}: provider audio received")


async def main():
    shared = {"systemPrompt": "You are a concise voice assistant.", "language": "en-IN"}
    cases = []
    gemini, sarvam, eleven = (
        os.getenv(name) for name in ("GEMINI_API_KEY", "SARVAM_API_KEY", "ELEVENLABS_API_KEY")
    )
    if gemini:
        cases.append(
            {
                **shared,
                "engine": "gemini_live",
                "model": "gemini-3.8-live",
                "voice": "Kore",
                "keys": {"live": gemini},
            }
        )
    if sarvam:
        cases.append(
            {
                **shared,
                "engine": "cascade",
                "keys": {"stt": sarvam, "llm": sarvam, "tts": eleven or sarvam},
                "stt": {"provider": "sarvam", "model": "saaras:v4", "language": "en-IN"},
                "llm": {"provider": "sarvam", "model": "sarvam-105b-conversations"},
                "tts": {
                    "provider": "elevenlabs" if eleven else "sarvam",
                    "model": "eleven_v4_turbo" if eleven else "bulbul:v3",
                    "voice": os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")
                    if eleven
                    else "shubh",
                },
            }
        )
    if not cases:
        print("SKIP: set provider API keys in the environment to run live smoke sessions")
    for config in cases:
        try:
            await run(config)
        except Exception:
            raise SystemExit(f"FAILED {config['engine']} live smoke") from None
        finally:
            config["keys"].clear()


if __name__ == "__main__":
    asyncio.run(main())
