"""Test-only provider around the production session manager and FastAPI app.

No real provider client is constructed and no OAI_CONFIG_LIST is read. These
diagnostic routes exist only in this fixture, never in the production app.
"""

import asyncio
import math
import os
import struct
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ag2-backend"))

from ag2.events import (  # noqa: E402
    AudioInterruptedEvent,
    ModelMessageChunk,
    ModelResponse,
    RecordedAudioEvent,
    SynthesizedAudioEvent,
)
from ag2.live import LiveAgent  # noqa: E402
from fastapi import Body  # noqa: E402
from realtime_over_webrtc import main  # noqa: E402
from realtime_over_webrtc.session import CohostSession, LiveRuntime  # noqa: E402


def forbidden_config():
    raise AssertionError("Tests must never load real provider configuration")


main.load_openai_config = forbidden_config
stats = {}
runtime = None


def reset_stats():
    stats.clear()
    stats.update(starts=0, closes=0, clientCloses=0, audioMessages=0,
                 audioBytes=0, audioOutputs=0, interrupts=0, playedMs=[], failures=0)


class FakeTransport:
    def __init__(self, on_speech_stopped):
        self.on_speech_stopped = on_speech_stopped
        self.failure = asyncio.Event()
        self.context = None

    @asynccontextmanager
    async def session(self, context, **_kwargs):
        self.context = context
        stats["starts"] += 1

        async def receive_audio(event):
            stats["audioMessages"] += 1
            stats["audioBytes"] += len(event.content)

        with context.stream.where(RecordedAudioEvent).sub_scope(receive_audio):
            try:
                yield
            finally:
                stats["closes"] += 1
                self.context = None

    async def interrupt(self, played_ms=0):
        stats["interrupts"] += 1
        stats["playedMs"].append(played_ms)
        if self.context:
            await self.context.send(AudioInterruptedEvent())

    async def wait_failure(self):
        await self.failure.wait()
        raise RuntimeError("Simulated provider disconnected")


class FakeClient:
    async def close(self):
        stats["clientCloses"] += 1


def fake_factory(on_speech_stopped):
    global runtime
    transport = FakeTransport(on_speech_stopped)
    runtime = LiveRuntime(
        agent=LiveAgent("Test cohost", config=transport),
        transport=transport,
        client=FakeClient(),
    )
    return runtime


original_lifespan = main.app.router.lifespan_context


@asynccontextmanager
async def fixture_lifespan(app):
    async with original_lifespan(app):
        reset_stats()
        app.state.cohost = CohostSession(fake_factory, grace_seconds=3)
        yield


main.app.router.lifespan_context = fixture_lifespan
app = main.app


@app.get("/__test/health")
async def health():
    return {"fixture": True}


@app.get("/__test/stats")
async def statistics():
    return dict(stats, playbackMs=app.state.cohost.playback_progress())


@app.post("/__test/reset")
async def reset():
    global runtime
    await app.state.cohost.shutdown()
    runtime = None
    reset_stats()
    app.state.cohost = CohostSession(fake_factory, grace_seconds=3)
    return {"reset": True}


@app.post("/__test/emit")
async def emit(payload: dict = Body(...)):
    if runtime is None or runtime.transport.context is None:
        return {"emitted": False}
    context = runtime.transport.context
    kind = payload["type"]
    if kind == "subtitle":
        await context.send(ModelMessageChunk(payload.get("text", "Hello from the cohost")))
    elif kind == "audio":
        stats["audioOutputs"] += 1
        frames = int(24000 * min(float(payload.get("seconds", 1)), 5))
        audio = b"".join(struct.pack("<h", int(5000 * math.sin(i * 2 * math.pi * 440 / 24000)))
                         for i in range(frames))
        callback = getattr(runtime.transport, "on_audio_start", None)
        if callback and payload.get("newItem", True):
            result = callback(f"fixture-audio-{stats['audioOutputs']}")
            if asyncio.iscoroutine(result):
                await result
        await context.send(SynthesizedAudioEvent(audio))
    elif kind == "done":
        await context.send(ModelResponse(message=None))
    elif kind == "interrupt":
        await runtime.transport.interrupt()
    elif kind == "thinking":
        result = runtime.transport.on_speech_stopped()
        if asyncio.iscoroutine(result):
            await result
    elif kind == "failure":
        stats["failures"] += 1
        runtime.transport.failure.set()
    else:
        raise ValueError(f"Unknown fixture event: {kind}")
    return {"emitted": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("COHOST_TEST_BACKEND_PORT", "5350")),
                log_level="warning")
