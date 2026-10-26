import asyncio
import base64
import unittest
from contextlib import asynccontextmanager
from types import SimpleNamespace as Event
from unittest.mock import AsyncMock

from ag2.context import ConversationContext
from ag2.events import AudioInterruptedEvent, SynthesizedAudioEvent, ToolCallEvent
from ag2.stream import MemoryStream

from realtime_over_webrtc.realtime import OpenAIRealtimeTransport


class Connection:
    def __init__(self, ack=True):
        self.events = asyncio.Queue()
        self.ack = ack
        self.session = Event(update=self.update)
        self.response = Event(cancel=AsyncMock(), create=AsyncMock())
        self.conversation = Event(item=Event(truncate=AsyncMock(), create=AsyncMock()))
        self.input_audio_buffer = Event(append=AsyncMock())
        self.closed = False
        self.sent_session = None

    async def update(self, *, session):
        self.sent_session = session
        if self.ack:
            await self.events.put(Event(type="session.updated"))

    def __aiter__(self):
        return self

    async def __anext__(self):
        event = await self.events.get()
        if event is None:
            raise StopAsyncIteration
        return event


class Client:
    def __init__(self, connection):
        self.connection = connection
        self.realtime = Event(connect=self.connect)

    @asynccontextmanager
    async def connect(self, *, model):
        try:
            yield self.connection
        finally:
            self.connection.closed = True


class RealtimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.connection = Connection()
        self.stopped = AsyncMock()
        self.started = AsyncMock()
        self.transport = OpenAIRealtimeTransport(
            Client(self.connection), model="test", voice="coral", on_speech_stopped=self.stopped,
        )
        self.transport.on_audio_start = self.started
        self.transport.playback_progress = lambda: 100
        self.context = ConversationContext(stream=MemoryStream())
        self.interruptions = []
        self.audio = []

        async def interrupted(event: AudioInterruptedEvent):
            self.interruptions.append(event)

        async def audio(event: SynthesizedAudioEvent):
            self.audio.append(event.content)

        self.context.stream.where(AudioInterruptedEvent).subscribe(interrupted)
        self.context.stream.where(SynthesizedAudioEvent).subscribe(audio)
        self.session = self.transport.session(self.context, serializer=None)
        await self.session.__aenter__()

    async def asyncTearDown(self):
        await self.session.__aexit__(None, None, None)

    async def wait(self, predicate):
        async def poll():
            while not predicate():
                await asyncio.sleep(.005)
        await asyncio.wait_for(poll(), 1)

    async def emit(self, kind, **fields):
        await self.connection.events.put(Event(type=kind, **fields))

    async def begin_audio(self):
        await self.emit("response.created", response=Event(id="response-1"))
        await self.emit("response.output_audio.delta", response_id="response-1", item_id="item-1",
                        content_index=0, delta=base64.b64encode(b"\x00" * 9600).decode())
        await self.wait(lambda: len(self.audio) == 1)

    async def test_ack_and_semantic_vad_configuration(self):
        config = self.connection.sent_session
        self.assertTrue(self.transport._ready.done())
        self.assertEqual(config["audio"]["input"]["turn_detection"]["type"], "semantic_vad")
        self.assertEqual(config["audio"]["output"]["format"]["rate"], 24000)

    async def test_speech_interruption_flushes_and_truncates_played_audio(self):
        await self.begin_audio()
        await self.emit("input_audio_buffer.speech_started")
        await self.wait(lambda: self.connection.conversation.item.truncate.await_count == 1)
        self.assertEqual(len(self.interruptions), 1)
        self.connection.conversation.item.truncate.assert_awaited_with(
            item_id="item-1", content_index=0, audio_end_ms=100,
        )
        self.connection.response.cancel.assert_not_awaited()  # VAD already cancels it
        await self.emit("response.output_audio.delta", response_id="response-1", item_id="item-1",
                        content_index=0, delta=base64.b64encode(b"\x00\x00").decode())
        await self.emit("input_audio_buffer.speech_stopped")
        await self.wait(lambda: self.stopped.await_count == 1)
        self.assertEqual(len(self.audio), 1)

    async def test_manual_interrupt_cancels_generation_and_clamps_duration(self):
        await self.begin_audio()
        await self.transport.interrupt(5000)
        self.connection.response.cancel.assert_awaited_with(response_id="response-1")
        self.connection.conversation.item.truncate.assert_awaited_with(
            item_id="item-1", content_index=0, audio_end_ms=200,
        )
        self.assertEqual(len(self.interruptions), 1)

    async def test_provider_error_reaches_session_without_echoing_message(self):
        await self.emit("error", error=Event(code="invalid_api_key", message="secret-in-raw-error"))
        with self.assertRaisesRegex(RuntimeError, "invalid_api_key") as raised:
            await asyncio.wait_for(self.transport.wait_failure(), 1)
        self.assertNotIn("secret-in-raw-error", str(raised.exception))

    async def test_disconnection_reaches_session(self):
        await self.connection.events.put(None)
        with self.assertRaisesRegex(RuntimeError, "disconnected"):
            await asyncio.wait_for(self.transport.wait_failure(), 1)

    async def test_slow_tool_does_not_block_provider_speech_events(self):
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow_tool(event: ToolCallEvent):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        self.context.stream.where(ToolCallEvent).subscribe(slow_tool)
        await self.emit("response.output_item.done", item=Event(
            type="function_call", call_id="call-1", name="slow", arguments="{}",
        ))
        await asyncio.wait_for(entered.wait(), 1)
        await self.emit("input_audio_buffer.speech_stopped")
        await self.wait(lambda: self.stopped.await_count == 1)
        self.assertFalse(cancelled.is_set())
        await self.session.__aexit__(None, None, None)
        self.assertTrue(cancelled.is_set())

    async def test_provider_error_before_ack_fails_startup(self):
        connection = Connection(ack=False)
        transport = OpenAIRealtimeTransport(
            Client(connection), model="test", voice="coral", on_speech_stopped=AsyncMock(),
        )
        await connection.events.put(Event(type="error", error=Event(code="bad_model")))
        with self.assertRaisesRegex(RuntimeError, "bad_model"):
            async with transport.session(self.context, serializer=None):
                self.fail("Session must not open without provider acknowledgement")
        self.assertTrue(connection.closed)

    async def test_cancelled_response_cannot_resume_or_invoke_tools_after_new_response(self):
        calls = []

        async def tool_called(event: ToolCallEvent):
            calls.append(event.name)

        self.context.stream.where(ToolCallEvent).subscribe(tool_called)
        await self.begin_audio()
        await self.transport.interrupt(100)
        await self.emit("response.created", response=Event(id="response-2"))
        await self.emit("response.output_audio.delta", response_id="response-1", item_id="item-1",
                        content_index=0, delta=base64.b64encode(b"old").decode())
        await self.emit("response.output_item.done", response_id="response-1", item=Event(
            type="function_call", call_id="cancelled-call", name="cancelled", arguments="{}", status="completed",
        ))
        await self.emit("response.output_item.done", response_id="response-2", item=Event(
            type="function_call", call_id="partial-call", name="partial", arguments="{}", status="incomplete",
        ))
        await self.emit("response.output_audio.delta", response_id="response-2", item_id="item-2",
                        content_index=0, delta=base64.b64encode(b"new").decode())
        await self.wait(lambda: len(self.audio) == 2)
        self.assertEqual(self.audio[-1], b"new")
        self.assertEqual(calls, [])
        await self.emit("response.output_item.done", response_id="response-2", item=Event(
            type="function_call", call_id="valid-call", name="valid", arguments="{}", status="completed",
        ))
        await self.wait(lambda: bool(calls))
        self.assertEqual(calls, ["valid"])


if __name__ == "__main__":
    unittest.main()
