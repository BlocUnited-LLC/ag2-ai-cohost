"""Server-owned cohost lifecycle and authenticated browser fan-out."""

import asyncio
import inspect
import secrets
from collections import deque
from contextlib import ExitStack, suppress
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from ag2.events import (
    AudioInterruptedEvent, BaseEvent, ModelMessageChunk, ModelResponse,
    RecordedAudioEvent, SynthesizedAudioEvent,
    TaskStarted, TaskProgress, TaskCompleted, TaskFailed, TaskExpired, TaskCancelled,
)
from ag2.events.task_events import TaskEvent

SAMPLE_RATE = 24000
MAX_AUDIO_FRAME = 32_768
MAX_CLIENT_QUEUE = 128
MAX_VIEWERS = 16


class SessionAccessError(ValueError):
    def __init__(self, message, code="unauthorized"):
        super().__init__(message)
        self.code = code


@dataclass
class LiveRuntime:
    agent: Any
    transport: Any
    client: Any


class SessionStorage:
    """Keep bounded event metadata, never an hours-long PCM recording in RAM."""

    def __init__(self, max_events=2000):
        self.events = deque(maxlen=max_events)

    async def save_event(self, event: BaseEvent, context):
        if not isinstance(event, (RecordedAudioEvent, SynthesizedAudioEvent)):
            self.events.append((context.stream.id, event))

    async def get_history(self, stream_id):
        return [event for source, event in self.events if source == stream_id]

    async def set_history(self, stream_id, events):
        await self.drop_history(stream_id)
        self.events.extend((stream_id, event) for event in events)

    async def drop_history(self, stream_id):
        self.events = deque(
            ((source, event) for source, event in self.events if source != stream_id),
            maxlen=self.events.maxlen,
        )


@dataclass(eq=False)
class Peer:
    socket: Any
    role: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(MAX_CLIENT_QUEUE))
    writer: Any = None
    closing: bool = False
    item_id: str | None = None
    played_ms: int = 0
    output_active: bool = False
    has_full_item: bool = False


class CohostSession:
    def __init__(self, factory, *, grace_seconds=60, startup_timeout=30):
        self.factory = factory
        self.grace_seconds = grace_seconds
        self.startup_timeout = startup_timeout
        self.controller_token = secrets.token_urlsafe(32)
        self.viewer_token = secrets.token_urlsafe(32)
        self.peers = set()
        self.controller = None
        self.status = "idle"
        self.session_id = None
        self.muted = False
        self.subtitle = ""
        self.thinking = False
        self.error = None
        self.context = None
        self.runtime = None
        self.runner = None
        self._grace = None
        self._lock = asyncio.Lock()
        self._background = set()
        self._audio_item = None
        self._new_response = True
        self._closed = False

    def state(self):
        state = {
            "type": "state", "status": self.status, "sessionId": self.session_id,
            "controllerConnected": self.controller is not None,
            "viewers": sum(p.role == "viewer" for p in self.peers),
            "muted": self.muted, "subtitle": self.subtitle, "thinking": self.thinking,
        }
        if self.error:
            state["error"] = self.error
        return state

    def _spawn(self, coro):
        task = asyncio.create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background.discard)
        return task

    def _offer(self, peer, message):
        if peer.closing:
            return
        try:
            peer.queue.put_nowait(message)
        except asyncio.QueueFull:
            peer.closing = True
            self._spawn(self._drop_slow(peer))

    def broadcast(self, message):
        for peer in tuple(self.peers):
            self._offer(peer, message)

    def broadcast_state(self):
        self.broadcast(self.state())

    async def _drop_slow(self, peer):
        with suppress(Exception):
            await asyncio.wait_for(peer.socket.close(code=1013, reason="Output client is too slow"), 2)
        await self.detach(peer)

    async def _write(self, peer):
        try:
            while True:
                message = await peer.queue.get()
                if isinstance(message, bytes):
                    await asyncio.wait_for(peer.socket.send_bytes(message), 5)
                else:
                    await asyncio.wait_for(peer.socket.send_json(message), 5)
        except asyncio.CancelledError:
            raise
        except Exception:
            await self.detach(peer)
            with suppress(Exception):
                await peer.socket.close(code=1011)

    async def attach(self, socket, role, token):
        if (
            role not in ("controller", "viewer") or not isinstance(token, str)
            or len(token) > 256 or not token.isascii()
        ):
            raise SessionAccessError("A valid session role and token are required.", "auth_failed")
        expected = self.controller_token if role == "controller" else self.viewer_token
        if not secrets.compare_digest(token, expected):
            raise SessionAccessError("The session token is invalid. Reload the controller.", "auth_failed")
        async with self._lock:
            if self._closed:
                raise SessionAccessError("The cohost server is shutting down.")
            if role == "controller" and self.controller is not None:
                raise SessionAccessError("Another controller is already connected.", "controller_busy")
            if role == "viewer" and sum(p.role == "viewer" for p in self.peers) >= MAX_VIEWERS:
                raise SessionAccessError("The maximum of 16 output viewers is connected.", "viewer_limit")
            peer = Peer(socket, role)
            self.peers.add(peer)
            if role == "controller":
                self.controller = peer
                if self._grace:
                    self._grace.cancel()
                    self._grace = None
            self._offer(peer, {"type": "authenticated", "role": role, "sampleRate": SAMPLE_RATE})
            # Late viewers wait for the next complete audio_start. A partial
            # item has no trustworthy playback offset and is never replayed.
            peer.writer = asyncio.create_task(self._write(peer))
            self.broadcast_state()
            return peer

    async def detach(self, peer):
        if peer not in self.peers:
            return
        self.peers.discard(peer)
        peer.closing = True
        if peer.writer and peer.writer is not asyncio.current_task():
            peer.writer.cancel()
            await asyncio.gather(peer.writer, return_exceptions=True)
        if self.controller is peer:
            self.controller = None
            if self.status in ("starting", "running") and not self._closed:
                self._grace = asyncio.create_task(self._expire_controller())
        self.broadcast_state()

    async def _expire_controller(self):
        await asyncio.sleep(self.grace_seconds)
        self._grace = None
        if self.controller is None:
            await self.stop()

    async def command(self, peer, message):
        if peer not in self.peers or not isinstance(message, dict):
            raise SessionAccessError("An authenticated connection is required.")
        kind = message.get("type")
        if kind == "output":
            if not isinstance(message.get("active"), bool):
                raise ValueError("Output activity requires a boolean active value.")
            peer.output_active = message["active"]
            if not peer.output_active:
                peer.has_full_item = False
            return
        if kind == "playback":
            value = message.get("playedMs")
            if (
                message.get("itemId") == self._audio_item and self._audio_item
                and peer.has_full_item and peer.output_active
                and isinstance(value, (int, float)) and not isinstance(value, bool)
                and 0 <= value <= 3_600_000
            ):
                peer.item_id = self._audio_item
                peer.played_ms = max(peer.played_ms, int(value))
            return
        if peer is not self.controller:
            raise SessionAccessError("Only the controller can change the cohost session.")
        if kind == "start":
            await self.start()
        elif kind == "stop":
            await self.stop()
        elif kind == "mute":
            if not isinstance(message.get("muted"), bool):
                raise ValueError("The mute command requires a boolean muted value.")
            self.muted = message["muted"]
            self.broadcast_state()
        elif kind == "interrupt":
            played_ms = self.playback_progress()
            await self.interrupted()
            if self.runtime and self.status == "running":
                try:
                    await asyncio.wait_for(self.runtime.transport.interrupt(played_ms), 10)
                except Exception:
                    await self.stop(error="Could not interrupt the provider. The session was stopped.")
        else:
            raise ValueError("Unknown cohost command.")

    async def audio(self, peer, data):
        if peer is not self.controller or peer not in self.peers:
            raise SessionAccessError("Only the controller can send microphone audio.")
        if not data or len(data) > MAX_AUDIO_FRAME or len(data) % 2:
            raise ValueError("Audio frames must be even-sized PCM16, at most 32768 bytes.")
        if self.status == "running" and not self.muted and self.context:
            try:
                await asyncio.wait_for(self.context.send(RecordedAudioEvent(data)), 6)
            except Exception:
                await self.stop(error="Microphone audio transport failed. Start a new session.")

    async def start(self):
        async with self._lock:
            if self.status in ("starting", "running") or self._closed:
                return
            # An error becomes visible before bounded provider/client cleanup ends.
            # Finish that cleanup before a replacement runner can own these fields.
            if self.runner and not self.runner.done():
                await asyncio.gather(self.runner, return_exceptions=True)
            self.status = "starting"
            self.session_id = uuid4().hex
            self.error = None
            self.subtitle = ""
            self.thinking = False
            self._new_response = True
            self.broadcast_state()
            self.runner = asyncio.create_task(self._run())

    async def _run(self):
        runtime = None
        try:
            runtime = self.factory(self.speech_stopped)
            if inspect.isawaitable(runtime):
                runtime = await runtime
            self.runtime = runtime
            runtime.transport.on_audio_start = self.audio_start
            runtime.transport.playback_progress = self.playback_progress
            # The startup deadline includes provider connection and acknowledgement.
            run_context = runtime.agent.run()
            context = await asyncio.wait_for(run_context.__aenter__(), self.startup_timeout)
            try:
                self.context = context
                with ExitStack() as subscriptions:
                    for event, callback in (
                        (SynthesizedAudioEvent, self.send_audio),
                        (ModelMessageChunk, self.send_subtitle),
                        (ModelResponse, self.response_done),
                        (AudioInterruptedEvent, self.interrupted),
                        (TaskEvent, self.task_changed),
                    ):
                        subscriptions.enter_context(context.stream.where(event).sub_scope(callback))
                    self.status = "running"
                    self.broadcast_state()
                    await runtime.transport.wait_failure()
                    raise RuntimeError("Realtime provider disconnected.")
            finally:
                self.context = None
                await asyncio.wait_for(run_context.__aexit__(None, None, None), 10)
        except asyncio.CancelledError:
            raise
        except Exception:
            # Raw SDK exceptions may contain request headers or sensitive configuration.
            self.status = "error"
            self.error = "The cohost connection failed. Check the API key, model access and connection, then start again."
            await self.interrupted()
            self.broadcast({"type": "error", "code": "provider_error", "message": self.error})
            self.broadcast_state()
        finally:
            self.context = None
            self.runtime = None
            if runtime is not None:
                with suppress(Exception):
                    await asyncio.wait_for(runtime.client.close(), 5)

    async def stop(self, *, error=None):
        async with self._lock:
            self.status = "error" if error else "idle"
            self.error = error
            self.context = None
            await self.interrupted()
            task, self.runner = self.runner, None
            if task and not task.done() and task is not asyncio.current_task():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            self.status = "error" if error else "idle"
            self.error = error
            self.session_id = None
            self.runtime = None
            self.context = None
            await self.interrupted()
            self.broadcast_state()

    async def speech_stopped(self):
        self.thinking = True
        self.broadcast({"type": "thinking", "payload": True})
        self.broadcast_state()

    async def audio_start(self, item_id):
        self._audio_item = item_id
        for peer in self.peers:
            peer.item_id = item_id
            peer.played_ms = 0
            peer.has_full_item = peer.output_active
        self.broadcast({"type": "audio_start", "itemId": item_id})

    def playback_progress(self):
        eligible = [
            p for p in self.peers if p.output_active and p.has_full_item
            and p.item_id == self._audio_item
        ]
        viewers = [p for p in eligible if p.role == "viewer"]
        outputs = viewers or [p for p in eligible if p is self.controller]
        return min((p.played_ms if p.item_id == self._audio_item else 0 for p in outputs), default=0)

    async def send_audio(self, event: SynthesizedAudioEvent):
        self.broadcast(event.content)
        if self.thinking:
            self.thinking = False
            self.broadcast({"type": "thinking", "payload": False})
            self.broadcast_state()

    async def send_subtitle(self, event: ModelMessageChunk):
        if self._new_response:
            self.subtitle = ""
            self._new_response = False
        self.subtitle = (self.subtitle + event.content)[-8000:]
        self.broadcast({"type": "subtitle", "payload": self.subtitle})
        self.broadcast_state()

    async def response_done(self, event: ModelResponse):
        self.thinking = False
        self._new_response = True
        self.broadcast({"type": "audio_end", "itemId": self._audio_item})
        self.broadcast({"type": "thinking", "payload": False})
        self.broadcast_state()

    async def task_changed(self, event: TaskEvent):
        statuses = {
            TaskStarted: "started", TaskProgress: "progress", TaskCompleted: "completed",
            TaskFailed: "failed", TaskExpired: "expired", TaskCancelled: "cancelled",
        }
        if self.controller:
            self._offer(self.controller, {
                "type": "task", "status": statuses.get(type(event), "progress"),
                "title": str(event.objective)[:240], "taskId": event.task_id,
            })

    async def interrupted(self, event: AudioInterruptedEvent = None):
        self.subtitle = ""
        self.thinking = False
        self._new_response = True
        self._audio_item = None
        # Remove unsent PCM before enqueueing the flush, including slow observers.
        for peer in tuple(self.peers):
            pending = []
            while not peer.queue.empty():
                item = peer.queue.get_nowait()
                if not isinstance(item, bytes) and item.get("type") not in (
                    "subtitle", "audio_start", "audio_end", "thinking", "state",
                ):
                    pending.append(item)
            for item in pending:
                self._offer(peer, item)
        self.broadcast({"type": "audio_interrupted"})
        self.broadcast({"type": "subtitle", "payload": ""})
        self.broadcast({"type": "thinking", "payload": False})
        self.broadcast_state()

    async def shutdown(self):
        self._closed = True
        if self._grace:
            self._grace.cancel()
            await asyncio.gather(self._grace, return_exceptions=True)
            self._grace = None
        await self.stop()
        for peer in tuple(self.peers):
            await self.detach(peer)
            with suppress(Exception):
                await asyncio.wait_for(peer.socket.close(code=1001), 2)
        for task in tuple(self._background):
            task.cancel()
        await asyncio.gather(*self._background, return_exceptions=True)
