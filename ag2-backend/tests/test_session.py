import asyncio
import unittest
from contextlib import asynccontextmanager

from ag2.context import ConversationContext
from ag2.events import ModelMessageChunk, RecordedAudioEvent, SynthesizedAudioEvent
from ag2.live import LiveAgent
from ag2.stream import MemoryStream

from realtime_over_webrtc.session import (
    CohostSession, LiveRuntime, MAX_CLIENT_QUEUE, MAX_VIEWERS, SessionAccessError, SessionStorage,
)


async def eventually(predicate, timeout=1):
    async def wait():
        while not predicate():
            await asyncio.sleep(.005)
    await asyncio.wait_for(wait(), timeout)


class Socket:
    def __init__(self, blocked=False):
        self.messages = []
        self.closed = []
        self.blocked = asyncio.Event() if blocked else None

    async def send_json(self, message):
        if self.blocked:
            await self.blocked.wait()
        self.messages.append(message)

    async def send_bytes(self, message):
        await self.send_json(message)

    async def close(self, code=1000, reason=""):
        self.closed.append(code)


class FakeClient:
    def __init__(self):
        self.closed = 0

    async def close(self):
        self.closed += 1


class FakeTransport:
    def __init__(self, *, delay=0):
        self.failure = asyncio.Event()
        self.context = None
        self.audio = []
        self.interruptions = []
        self.delay = delay
        self.exited = 0

    @asynccontextmanager
    async def session(self, context, *, instructions=(), tools=(), serializer):
        await asyncio.sleep(self.delay)
        self.context = context

        async def capture(event: RecordedAudioEvent):
            self.audio.append(event.content)

        with context.stream.where(RecordedAudioEvent).sub_scope(capture):
            try:
                yield
            finally:
                self.exited += 1

    async def wait_failure(self):
        await self.failure.wait()
        raise RuntimeError("SDK error containing secret-test-key")

    async def interrupt(self, played_ms=0):
        self.interruptions.append(played_ms)


class SessionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.created = []
        self.delay = 0

        def factory(callback):
            transport = FakeTransport(delay=self.delay)
            agent = LiveAgent("test", config=transport, stream=MemoryStream(SessionStorage()))
            runtime = LiveRuntime(agent, transport, FakeClient())
            self.created.append(runtime)
            return runtime

        self.manager = CohostSession(factory, grace_seconds=.04, startup_timeout=.05)

    async def asyncTearDown(self):
        await self.manager.shutdown()

    async def attach(self, role="controller", socket=None):
        token = self.manager.controller_token if role == "controller" else self.manager.viewer_token
        return await self.manager.attach(socket or Socket(), role, token)

    async def start(self):
        controller = await self.attach()
        await self.manager.command(controller, {"type": "start"})
        await eventually(lambda: self.manager.status == "running")
        return controller

    async def test_authenticated_roles_and_exclusive_controller(self):
        with self.assertRaises(SessionAccessError):
            await self.manager.attach(Socket(), "viewer", self.manager.controller_token)
        viewer = await self.attach("viewer")
        controller = await self.attach()
        self.assertEqual(self.created, [])
        with self.assertRaisesRegex(SessionAccessError, "already connected"):
            await self.attach()
        with self.assertRaises(SessionAccessError):
            await self.manager.command(viewer, {"type": "start"})
        with self.assertRaises(SessionAccessError):
            await self.manager.audio(viewer, b"\x00\x00")
        self.assertEqual(self.manager.state()["viewers"], 1)
        self.assertIs(self.manager.controller, controller)

    async def test_viewer_reload_preserves_one_agent_and_session(self):
        controller = await self.start()
        first = await self.attach("viewer")
        session_id = self.manager.session_id
        await self.manager.detach(first)
        replacement = await self.attach("viewer")
        await self.manager.command(controller, {"type": "start"})
        self.assertEqual(len(self.created), 1)
        self.assertEqual(self.manager.session_id, session_id)
        await self.manager.context.send(SynthesizedAudioEvent(b"\x01\x00"))
        await eventually(lambda: b"\x01\x00" in replacement.socket.messages)
        self.assertEqual(self.manager.status, "running")

    async def test_audio_mute_interrupt_and_stop(self):
        controller = await self.start()
        runtime = self.created[0]
        await self.manager.audio(controller, b"\x01\x00")
        await self.manager.command(controller, {"type": "mute", "muted": True})
        await self.manager.audio(controller, b"\x02\x00")
        self.assertEqual(runtime.transport.audio, [b"\x01\x00"])
        with self.assertRaises(ValueError):
            await self.manager.audio(controller, b"odd")
        await self.manager.context.send(ModelMessageChunk("Hello"))
        await self.manager.command(controller, {"type": "output", "active": True})
        await self.manager.audio_start("item-1")
        await self.manager.command(controller, {"type": "playback", "itemId": "item-1", "playedMs": 75})
        await self.manager.command(controller, {"type": "interrupt"})
        self.assertEqual(runtime.transport.interruptions, [75])
        self.assertEqual(self.manager.subtitle, "")
        await self.manager.command(controller, {"type": "stop"})
        self.assertEqual(self.manager.status, "idle")
        self.assertEqual(runtime.client.closed, 1)
        self.assertEqual(runtime.transport.exited, 1)
        self.assertIsNone(self.manager.session_id)

    async def test_controller_reconnect_grace_then_expires(self):
        controller = await self.start()
        original_id = self.manager.session_id
        await self.manager.detach(controller)
        replacement = await self.attach()
        await asyncio.sleep(.06)
        self.assertEqual(self.manager.status, "running")
        self.assertEqual(self.manager.session_id, original_id)
        await self.manager.detach(replacement)
        await eventually(lambda: self.manager.status == "idle")
        self.assertEqual(self.created[0].client.closed, 1)

    async def test_provider_failure_is_visible_and_client_closed(self):
        await self.start()
        runtime = self.created[0]
        runtime.transport.failure.set()
        await eventually(lambda: self.manager.status == "error" and runtime.client.closed == 1)
        self.assertNotIn("secret-test-key", self.manager.error)
        self.assertIsNone(self.manager.context)

    async def test_startup_timeout_closes_client(self):
        self.delay = 1
        controller = await self.attach()
        await self.manager.command(controller, {"type": "start"})
        await eventually(lambda: self.manager.status == "error")
        self.assertEqual(self.created[0].client.closed, 1)

    async def test_slow_viewer_is_bounded_and_cannot_block_session(self):
        await self.start()
        slow = await self.attach("viewer", Socket(blocked=True))
        for _ in range(MAX_CLIENT_QUEUE + 2):
            self.manager._offer(slow, b"\x01\x00")
        self.assertLessEqual(slow.queue.qsize(), MAX_CLIENT_QUEUE)
        await eventually(lambda: slow not in self.manager.peers)
        self.assertEqual(self.manager.status, "running")
        self.assertIn(1013, slow.socket.closed)

    async def test_storage_keeps_no_pcm_and_has_a_bound(self):
        storage = SessionStorage(max_events=2)
        context = ConversationContext(stream=MemoryStream(storage))
        for _ in range(10):
            await storage.save_event(RecordedAudioEvent(b"audio"), context)
        for text in ("one", "two", "three"):
            await storage.save_event(ModelMessageChunk(text), context)
        self.assertEqual([e.content for e in await storage.get_history(context.stream.id)], ["two", "three"])

    async def test_shared_storage_isolates_child_stream_histories(self):
        storage = SessionStorage(max_events=20)
        parent = ConversationContext(stream=MemoryStream(storage))
        child = ConversationContext(stream=MemoryStream(storage))
        await storage.save_event(ModelMessageChunk("parent"), parent)
        await storage.save_event(ModelMessageChunk("child"), child)
        await storage.set_history(child.stream.id, [ModelMessageChunk("child replacement")])
        self.assertEqual([e.content for e in await storage.get_history(parent.stream.id)], ["parent"])
        self.assertEqual([e.content for e in await storage.get_history(child.stream.id)], ["child replacement"])
        await storage.drop_history(child.stream.id)
        self.assertEqual([e.content for e in await storage.get_history(parent.stream.id)], ["parent"])
        self.assertEqual(await storage.get_history(child.stream.id), [])

    async def test_viewer_count_is_bounded(self):
        for _ in range(MAX_VIEWERS):
            await self.attach("viewer")
        with self.assertRaisesRegex(SessionAccessError, "maximum"):
            await self.attach("viewer")
        self.assertEqual(self.manager.state()["viewers"], MAX_VIEWERS)

    async def test_hidden_and_partial_viewers_do_not_erase_active_playback_progress(self):
        await self.start()
        visible = await self.attach("viewer")
        hidden = await self.attach("viewer")
        await self.manager.command(visible, {"type": "output", "active": True})
        await self.manager.audio_start("item-1")
        late = await self.attach("viewer")
        await self.manager.command(late, {"type": "output", "active": True})
        await self.manager.command(visible, {"type": "playback", "itemId": "item-1", "playedMs": 240})
        await self.manager.command(hidden, {"type": "playback", "itemId": "item-1", "playedMs": 0})
        await self.manager.command(late, {"type": "playback", "itemId": "item-1", "playedMs": 0})
        self.assertEqual(self.manager.playback_progress(), 240)
        await self.manager.command(visible, {"type": "output", "active": False})
        self.assertEqual(self.manager.playback_progress(), 0)
        await self.manager.audio_start("item-2")
        await self.manager.command(late, {"type": "playback", "itemId": "item-2", "playedMs": 80})
        self.assertEqual(self.manager.playback_progress(), 80)

    async def test_restart_waits_for_previous_client_cleanup(self):
        controller = await self.start()
        runtime = self.created[0]
        cleanup_started = asyncio.Event()
        finish_cleanup = asyncio.Event()

        async def delayed_close():
            cleanup_started.set()
            await finish_cleanup.wait()

        runtime.client.close = delayed_close
        runtime.transport.failure.set()
        await asyncio.wait_for(cleanup_started.wait(), 1)
        restart = asyncio.create_task(self.manager.command(controller, {"type": "start"}))
        await asyncio.sleep(.01)
        self.assertEqual(len(self.created), 1)
        finish_cleanup.set()
        await restart
        await eventually(lambda: self.manager.status == "running")
        self.assertEqual(len(self.created), 2)
        self.assertIs(self.manager.runtime, self.created[1])


if __name__ == "__main__":
    unittest.main()
