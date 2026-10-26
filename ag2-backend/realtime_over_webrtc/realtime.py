"""Public AG2 RealtimeConfig adapter with explicit browser playback control.

AG2 1.2.1's OpenAI adapter does not forward provider interruption/error events.
This implements its public session protocol, without patching AG2 internals.
"""

import asyncio
import base64
import re
from collections import deque
from contextlib import asynccontextmanager

from ag2.events import (
    AudioInterruptedEvent,
    DataInput,
    ModelMessage,
    ModelMessageChunk,
    ModelResponse,
    RecordedAudioEvent,
    SynthesizedAudioEvent,
    TextInput,
    ToolCallEvent,
    ToolResultEvent,
    Usage,
    UsageEvent,
)
from ag2.tools.final import FunctionToolSchema


class OpenAIRealtimeTransport:
    """One provider connection owned by one server-side cohost session."""

    def __init__(self, client, *, model: str, voice: str, on_speech_stopped):
        self.client = client
        self.model = model
        self.voice = voice
        self.on_speech_stopped = on_speech_stopped
        self.on_audio_start = None
        self.playback_progress = lambda: 0
        self._connection = None
        self._context = None
        self._failed = asyncio.Event()
        self._failure = None
        self._ready = None
        self._active_response = None
        self._discarded_responses = set()
        self._discarded_order = deque()
        self._audio_item = None
        self._audio_index = 0
        self._audio_bytes = 0
        self._text = ""
        self._epoch = 0
        self._tool_epochs = {}
        self._tool_tasks = set()
        self._interrupt_lock = asyncio.Lock()

    async def wait_failure(self):
        await self._failed.wait()
        raise self._failure or RuntimeError("Realtime provider disconnected.")

    def _fail(self, error):
        self._failure = error
        self._failed.set()
        if self._ready is not None and not self._ready.done():
            self._ready.set_exception(error)

    @asynccontextmanager
    async def session(self, context, *, instructions=(), tools=(), serializer):
        schemas = []
        for schema in tools:
            if not isinstance(schema, FunctionToolSchema):
                raise ValueError("Realtime cohost tools must be function tools.")
            schemas.append({
                "type": "function", "name": schema.function.name,
                "description": schema.function.description,
                "parameters": schema.function.parameters,
            })
        session = {
            "type": "realtime", "instructions": "\n".join(instructions),
            "output_modalities": ["audio"], "tools": schemas,
            "audio": {
                "input": {
                    "format": {"type": "audio/pcm", "rate": 24000},
                    "turn_detection": {
                        "type": "semantic_vad", "create_response": True,
                        "interrupt_response": True,
                    },
                },
                "output": {"format": {"type": "audio/pcm", "rate": 24000}, "voice": self.voice},
            },
        }
        self._ready = asyncio.get_running_loop().create_future()
        self._context = context
        async with self.client.realtime.connect(model=self.model) as connection:
            self._connection = connection

            async def send_audio(event: RecordedAudioEvent):
                try:
                    await asyncio.wait_for(connection.input_audio_buffer.append(
                        audio=base64.b64encode(event.content).decode("ascii")
                    ), timeout=5)
                except Exception:
                    self._fail(RuntimeError("Microphone audio could not reach the provider."))

            async def send_tool_result(event: ToolResultEvent):
                parts = []
                for part in event.result.parts:
                    if isinstance(part, TextInput):
                        parts.append(part.content)
                    elif isinstance(part, DataInput):
                        parts.append(serializer.encode(part.data).decode())
                    else:
                        parts.append(str(part))
                try:
                    await asyncio.wait_for(connection.conversation.item.create(item={
                        "type": "function_call_output", "call_id": event.parent_id,
                        "output": "\n".join(parts),
                    }), timeout=10)
                    # An interrupted research call may finish, but must not restart speech.
                    if self._tool_epochs.pop(event.parent_id, -1) == self._epoch:
                        await asyncio.wait_for(connection.response.create(), timeout=10)
                except Exception:
                    self._fail(RuntimeError("The provider could not receive a tool result."))

            with (
                context.stream.where(RecordedAudioEvent).sub_scope(send_audio),
                context.stream.where(ToolResultEvent).sub_scope(send_tool_result),
            ):
                pump = asyncio.create_task(self._pump(connection, context))
                try:
                    await asyncio.wait_for(connection.session.update(session=session), timeout=15)
                    await asyncio.wait_for(asyncio.shield(self._ready), timeout=20)
                    yield
                finally:
                    pump.cancel()
                    for task in self._tool_tasks:
                        task.cancel()
                    await asyncio.gather(pump, *self._tool_tasks, return_exceptions=True)
                    if not self._ready.done():
                        self._ready.cancel()
                    elif not self._ready.cancelled():
                        self._ready.exception()  # retrieve errors if connection setup failed first
                    self._connection = None
                    self._context = None

    async def interrupt(self, played_ms=0, *, cancel=True):
        """Cancel generation and remove audio the output client has not played."""
        async with self._interrupt_lock:
            connection = self._connection
            if connection is None:
                return
            self._epoch += 1
            active_response = self._active_response
            if active_response and active_response not in self._discarded_responses:
                if len(self._discarded_order) >= 32:
                    self._discarded_responses.discard(self._discarded_order.popleft())
                self._discarded_order.append(active_response)
                self._discarded_responses.add(active_response)
            self._active_response = None
            self._text = ""
            if self._context is not None:
                await self._context.send(AudioInterruptedEvent())
            if cancel and active_response:
                await asyncio.wait_for(connection.response.cancel(response_id=active_response), timeout=5)
            if self._audio_item:
                duration = self._audio_bytes * 1000 // (24000 * 2)
                await asyncio.wait_for(connection.conversation.item.truncate(
                    item_id=self._audio_item, content_index=self._audio_index,
                    audio_end_ms=max(0, min(int(played_ms), duration)),
                ), timeout=5)
                self._audio_item = None
                self._audio_bytes = 0

    def _tool_done(self, task):
        self._tool_tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            self._fail(RuntimeError("A cohost tool failed. Stop and restart the session."))

    async def _pump(self, connection, context):
        try:
            async for event in connection:
                kind = event.type
                if kind == "session.updated":
                    if not self._ready.done():
                        self._ready.set_result(None)
                elif kind == "error":
                    code = str(getattr(event.error, "code", "provider_error") or "provider_error")
                    # A cancellation can race response.done; that race is harmless.
                    if code == "response_cancel_not_active":
                        continue
                    safe_code = re.sub(r"[^a-zA-Z0-9_-]", "", code)[:80]
                    raise RuntimeError(f"Realtime provider error ({safe_code}). Check configuration and restart.")
                elif kind == "input_audio_buffer.speech_started":
                    await self.interrupt(self.playback_progress(), cancel=False)
                elif kind == "input_audio_buffer.speech_stopped":
                    await self.on_speech_stopped()
                elif kind == "response.created":
                    if event.response.id in self._discarded_responses:
                        continue
                    self._active_response = event.response.id
                    self._text = ""
                elif kind == "response.output_audio.delta":
                    if getattr(event, "response_id", None) in self._discarded_responses:
                        continue
                    if self._audio_item != event.item_id:
                        self._audio_item = event.item_id
                        self._audio_index = event.content_index
                        self._audio_bytes = 0
                        if self.on_audio_start:
                            await self.on_audio_start(event.item_id)
                    audio = base64.b64decode(event.delta)
                    self._audio_bytes += len(audio)
                    await context.send(SynthesizedAudioEvent(audio))
                elif kind in ("response.output_audio_transcript.delta", "response.output_text.delta"):
                    if getattr(event, "response_id", None) in self._discarded_responses:
                        continue
                    self._text += event.delta
                    await context.send(ModelMessageChunk(event.delta))
                elif kind == "response.output_item.done":
                    if getattr(event, "response_id", None) in self._discarded_responses:
                        continue
                    item = event.item
                    if getattr(item, "status", None) not in (None, "completed"):
                        continue
                    if item.type == "function_call" and item.call_id and item.name:
                        if len(self._tool_tasks) >= 4:
                            raise RuntimeError("Too many simultaneous cohost tool calls.")
                        self._tool_epochs[item.call_id] = self._epoch
                        # Receiving voice events must continue while tools execute.
                        task = asyncio.create_task(context.send(ToolCallEvent(
                            id=item.call_id, name=item.name, arguments=item.arguments or "{}",
                        )))
                        self._tool_tasks.add(task)
                        task.add_done_callback(self._tool_done)
                elif kind == "response.done":
                    raw = event.response.usage
                    usage = Usage(
                        prompt_tokens=raw.input_tokens, completion_tokens=raw.output_tokens,
                        total_tokens=raw.total_tokens,
                    ) if raw else Usage()
                    if raw:
                        await context.send(UsageEvent(usage, kind="model_call", model=self.model, provider="openai"))
                    if event.response.id in self._discarded_responses:
                        continue
                    if getattr(event.response, "status", None) == "failed":
                        raise RuntimeError("The realtime model could not complete its response.")
                    await context.send(ModelResponse(
                        message=ModelMessage(self._text) if self._text else None,
                        usage=usage, model=self.model, provider="openai",
                    ))
                    self._text = ""
                    if self._active_response == event.response.id:
                        self._active_response = None
            raise RuntimeError("Realtime provider disconnected. Start a new session to reconnect.")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if isinstance(exc, RuntimeError):
                self._fail(exc)
            else:
                self._fail(RuntimeError("Realtime provider connection failed. Check your connection and restart."))
