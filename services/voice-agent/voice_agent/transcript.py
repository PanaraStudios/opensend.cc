"""Aggregate one caller utterance and one agent turn before they are stored.

Gemini Live input transcription (Pipecat 1.12 ``GeminiLiveLLMService``) appends
word and phrase deltas and pushes one upstream ``TranscriptionFrame`` per
sentence. Those frames are pieces of one caller turn. The private buffer is
not flushed on interruption, so a tail such as a trailing word is lost unless
we take it ourselves. Cascade STT replaces an interim hypothesis and then
commits one final transcript. Output transcription can run ahead of audio;
text still queued when an interruption arrives was not spoken.
"""

from pipecat.frames.frames import (
    Frame,
    InterimTranscriptionFrame,
    TranscriptionFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


def _join(existing: str, text: str) -> str:
    text = text.strip()
    if not text:
        return existing
    if existing and not existing.endswith((" ", "\n")):
        return f"{existing} {text}"
    return existing + text


class CallerUtterance:
    def __init__(self):
        self.committed = ""
        self.hypothesis = ""
        self.started_ms: int | None = None
        self._suppress = 0

    def add_interim(self, text: str, now_ms: int) -> None:
        text = text.strip()
        if not text:
            return
        self._touch(now_ms)
        self.hypothesis = text

    def add_final(self, text: str, now_ms: int, *, from_frame: bool = False) -> None:
        if from_frame and self._suppress:
            self._suppress -= 1
            return
        self._append(text, now_ms)

    def add_direct(self, text: str, now_ms: int) -> None:
        """Record a buffer tail we also push upstream, without storing it twice."""
        if not text.strip():
            return
        self._append(text, now_ms)
        self._suppress += 1

    def _append(self, text: str, now_ms: int) -> None:
        text = text.strip()
        if not text:
            return
        self._touch(now_ms)
        # A cascade final replaces the open hypothesis. Gemini sentences have none.
        self.hypothesis = ""
        self.committed = _join(self.committed, text)

    def _touch(self, now_ms: int) -> None:
        if self.started_ms is None:
            self.started_ms = now_ms

    def flush(self) -> tuple[str, int] | None:
        text = _join(self.committed, self.hypothesis).strip()
        started = self.started_ms if self.started_ms is not None else 0
        self.committed = ""
        self.hypothesis = ""
        self.started_ms = None
        self._suppress = 0
        if not text:
            return None
        return text, started


class AgentUtterance:
    def __init__(self):
        self.parts = ""
        self.started_ms: int | None = None
        self.sealed = False
        # Look-ahead transcription queued behind an interruption is not speech.
        self.dropping = False

    def begin(self) -> None:
        self.dropping = False
        self.sealed = False

    def add_text(self, text: str, now_ms: int, *, spaced: bool) -> None:
        if self.sealed or self.dropping or not text:
            return
        if self.started_ms is None:
            self.started_ms = now_ms
        if (
            self.parts
            and not spaced
            and not self.parts.endswith((" ", "\n"))
            and not text.startswith((" ", "\n"))
        ):
            self.parts += " "
        self.parts += text

    def seal(self, interrupted: bool) -> tuple[str, int, bool] | None:
        text = self.parts.strip()
        started = self.started_ms if self.started_ms is not None else 0
        self.parts = ""
        self.started_ms = None
        self.sealed = True
        if interrupted:
            self.dropping = True
        if not text:
            return None
        return text, started, interrupted


class TurnTranscripts:
    def __init__(self):
        self.caller = CallerUtterance()
        self.agent = AgentUtterance()


class TranscriptTap(FrameProcessor):
    """Record caller transcription flowing in one direction.

    Cascade STT pushes frames downstream. Gemini Live pushes input
    transcription upstream. A processor cannot sit in both places, so the
    pipeline installs two taps on one ``TurnTranscripts``.
    """

    def __init__(self, turns: TurnTranscripts, now, watch: FrameDirection):
        super().__init__()
        self.turns = turns
        self._now = now
        self._watch = watch

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if direction == self._watch:
            now = int(self._now())
            if isinstance(frame, InterimTranscriptionFrame):
                self.turns.caller.add_interim(frame.text, now)
            elif isinstance(frame, TranscriptionFrame):
                self.turns.caller.add_final(frame.text, now, from_frame=True)
        await self.push_frame(frame, direction)


async def take_gemini_user_buffer(service, turns: TurnTranscripts | None, now) -> None:
    """Flush Gemini's unsent input-transcription buffer.

    Pipecat 1.12 cancels ``_transcription_timeout_task`` on the next chunk and
    does not flush ``_user_transcription_buffer`` from ``_handle_interruption``
    or disconnect. The timeout is what would have emitted the tail.
    """
    task = getattr(service, "_transcription_timeout_task", None)
    service._transcription_timeout_task = None
    if task is not None and not task.done():
        await service.cancel_task(task)
    text = str(getattr(service, "_user_transcription_buffer", "") or "").strip()
    service._user_transcription_buffer = ""
    if not text:
        return
    if turns is not None:
        turns.caller.add_direct(text, int(now()))
    push = getattr(service, "_push_user_transcription", None)
    if push:
        await push(text)
