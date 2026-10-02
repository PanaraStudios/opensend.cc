import asyncio

from pipecat.frames.frames import (
    EndFrame,
    InterimTranscriptionFrame,
    InputTransportMessageFrame,
    InterruptionFrame,
    TTSStartedFrame,
    TTSStoppedFrame,
    TTSTextFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection
from voice_agent.telemetry import Telemetry
from voice_agent.transcript import TranscriptTap, TurnTranscripts, take_gemini_user_buffer


def caller(text, user_id="caller"):
    return TranscriptionFrame(text=text, user_id=user_id, timestamp="0")


def interim(text):
    return InterimTranscriptionFrame(text=text, user_id="caller", timestamp="0")


def spoken(text, spaced=False):
    frame = TTSTextFrame(text=text, aggregated_by="sentence")
    frame.includes_inter_frame_spaces = spaced
    return frame


def telemetry(turns=None):
    lines = []

    async def emit(message):
        lines.append(message)

    serializer = type("Serializer", (), {"turn_id": "turn-1"})()
    context = type("Context", (), {"add_message": lambda self, message: None})()
    processor = Telemetry(emit, serializer, context)
    if turns is not None:
        processor.turns = turns
    return processor, lines


async def test_gemini_chunks_and_buffer_tail_store_one_caller_line():
    turns = TurnTranscripts()
    clock = {"t": 1000}
    tap = TranscriptTap(turns, lambda: clock["t"], FrameDirection.UPSTREAM)
    processor, lines = telemetry(turns)
    await tap.process_frame(caller("मुझे एक टिकट चाहिए"), FrameDirection.UPSTREAM)
    clock["t"] = 1100
    await take_gemini_user_buffer(_buffer("और"), turns, lambda: clock["t"])
    # The upstream frame Pipecat would also push must not be stored again.
    await tap.process_frame(caller("और"), FrameDirection.UPSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    caller_lines = [line for line in lines if line["role"] == "caller"]
    assert caller_lines == [
        {
            "type": "transcript",
            "role": "caller",
            "text": "मुझे एक टिकट चाहिए और",
            "final": True,
            "timestampMs": 1000,
        }
    ]
    await processor.cleanup()
    await tap.cleanup()


async def test_barge_in_keeps_caller_speech_and_marks_spoken_agent_text():
    turns = TurnTranscripts()
    clock = {"t": 2000}
    tap = TranscriptTap(turns, lambda: clock["t"], FrameDirection.UPSTREAM)
    processor, lines = telemetry(turns)
    await tap.process_frame(caller("मुझे एक टिकट चाहिए"), FrameDirection.UPSTREAM)
    await processor.process_frame(TTSStartedFrame(), FrameDirection.DOWNSTREAM)
    await processor.process_frame(spoken("The next train leaves at six"), FrameDirection.DOWNSTREAM)

    async def quiet_interruption():
        return None

    # The processor is not inside a pipeline, so Pipecat's interruption task
    # setup has no task manager. Transcript handling still runs after it.
    processor._start_interruption = quiet_interruption
    await processor.process_frame(InterruptionFrame(), FrameDirection.DOWNSTREAM)
    await processor.process_frame(spoken(" and platform two"), FrameDirection.DOWNSTREAM)
    clock["t"] = 2500
    await tap.process_frame(caller("रुकिए ज़रा"), FrameDirection.UPSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    assert [line["text"] for line in lines] == [
        "मुझे एक टिकट चाहिए",
        "The next train leaves at six [interrupted]",
        "रुकिए ज़रा",
    ]
    assert lines[0]["role"] == "caller" and lines[1]["role"] == "agent"
    assert lines[0]["timestampMs"] == 2000
    assert lines[2]["timestampMs"] == 2500
    assert all(line["final"] is True for line in lines)
    await processor.cleanup()
    await tap.cleanup()


async def test_tts_stop_waits_for_the_gemini_tail():
    turns = TurnTranscripts()
    clock = {"t": 4000}
    tap = TranscriptTap(turns, lambda: clock["t"], FrameDirection.UPSTREAM)
    processor, lines = telemetry(turns)
    await tap.process_frame(caller("मुझे एक टिकट चाहिए"), FrameDirection.UPSTREAM)
    await processor.process_frame(TTSStoppedFrame(), FrameDirection.DOWNSTREAM)
    assert lines == []
    clock["t"] = 4200
    await take_gemini_user_buffer(_buffer("और"), turns, lambda: clock["t"])
    await tap.process_frame(caller("और"), FrameDirection.UPSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    assert [line["text"] for line in lines if line["role"] == "caller"] == [
        "मुझे एक टिकट चाहिए और"
    ]
    assert lines[0]["timestampMs"] == 4000
    await processor.cleanup()
    await tap.cleanup()


async def test_cascade_interim_then_final_is_stored_once():
    turns = TurnTranscripts()
    tap = TranscriptTap(turns, lambda: 3000, FrameDirection.DOWNSTREAM)
    processor, lines = telemetry(turns)
    await tap.process_frame(interim("hello"), FrameDirection.DOWNSTREAM)
    await tap.process_frame(interim("hello there"), FrameDirection.DOWNSTREAM)
    await tap.process_frame(caller("hello there"), FrameDirection.DOWNSTREAM)
    await processor.process_frame(TTSStoppedFrame(), FrameDirection.DOWNSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    caller_lines = [line for line in lines if line["role"] == "caller"]
    assert [line["text"] for line in caller_lines] == ["hello there"]
    assert caller_lines[0]["timestampMs"] == 3000
    await processor.cleanup()
    await tap.cleanup()


async def test_played_ms_seals_an_open_agent_turn_without_a_second_copy():
    processor, lines = telemetry()
    await processor.process_frame(spoken("Hello"), FrameDirection.DOWNSTREAM)
    await processor.process_frame(
        InputTransportMessageFrame({"type": "played_ms", "playedMs": 0}),
        FrameDirection.DOWNSTREAM,
    )
    await processor.process_frame(spoken(" there"), FrameDirection.DOWNSTREAM)
    await processor.process_frame(EndFrame(), FrameDirection.DOWNSTREAM)
    assert [line["text"] for line in lines] == ["Hello [interrupted]"]
    await processor.cleanup()


async def test_take_gemini_buffer_cancels_the_timeout_and_is_empty_after():
    cancelled = asyncio.Event()

    async def linger():
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            cancelled.set()
            raise

    task = asyncio.create_task(linger())
    await asyncio.sleep(0)
    pushed = []

    class Service:
        _user_transcription_buffer = "और"
        _transcription_timeout_task = task

        async def cancel_task(self, pending):
            pending.cancel()
            try:
                await pending
            except asyncio.CancelledError:
                pass

        async def _push_user_transcription(self, text):
            pushed.append(text)

    turns = TurnTranscripts()
    service = Service()
    await take_gemini_user_buffer(service, turns, lambda: 40)
    await take_gemini_user_buffer(service, turns, lambda: 50)
    assert cancelled.is_set()
    assert service._user_transcription_buffer == ""
    assert pushed == ["और"]
    assert turns.caller.flush() == ("और", 40)
    assert turns.caller.flush() is None


def _buffer(text):
    class Service:
        _user_transcription_buffer = text
        _transcription_timeout_task = None

        async def _push_user_transcription(self, spoken_text):
            self.pushed = spoken_text

    return Service()
