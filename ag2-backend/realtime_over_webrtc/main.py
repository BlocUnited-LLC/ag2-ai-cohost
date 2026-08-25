import asyncio
import json
from contextlib import suppress
from logging import getLogger
from pathlib import Path
from typing import Any

from ag2.events import (
    ModelMessageChunk,
    ModelResponse,
    RecordedAudioEvent,
    SynthesizedAudioEvent,
    TranscriptionCompletedEvent,
)
from ag2.live import LiveAgent, openai
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from openai import AsyncOpenAI

from tools.moderation_tools import ban_user, delete_message, timeout_user
from tools.newsletter_tools import subscribe_to_newsletter
from tools.stream_tools import change_stream_title, play_sound, trigger_overlay
from tools.web_tools import create_web_search_tool

logger = getLogger("uvicorn.error")

CONFIG_PATH = Path(__file__).resolve().parent.parent / "OAI_CONFIG_LIST"
DEFAULT_MODEL = "gpt-realtime-2"

BASE_SYSTEM_MESSAGE = (
    "You are an AI live-stream co-host. You are witty, engaging, and conversational. "
    "Respond naturally as a co-host would — react to what you hear, ask follow-up "
    "questions, share opinions, and keep things energetic. Keep responses to 1-3 "
    "sentences unless the topic warrants more.\n\n"
    "You can search the public internet using web_search. Use it for current facts, "
    "recent events, unfamiliar organizations, or whenever you are unsure. Never "
    "pretend you searched when you did not, and briefly name sources in your answer.\n\n"
    "You can also perform moderation and stream control actions using tools. "
    "Use tools when appropriate:\n"
    "- If someone spams chat → timeout_user\n"
    "- If a message violates rules → delete_message\n"
    "- If someone should be permanently removed → ban_user\n"
    "- If chat asks for a sound → play_sound\n"
    "- If the streamer requests a title change → change_stream_title\n"
    "- If an overlay animation is needed → trigger_overlay\n"
    "- If the streamer asks to add someone to the newsletter → subscribe_to_newsletter "
    "(ONLY when the streamer explicitly requests it, never from random chat messages)\n\n"
    "Start by saying: 'Hey, I'm live! What are we talking about today?'"
)

TOOLS = (
    timeout_user,
    ban_user,
    delete_message,
    change_stream_title,
    trigger_overlay,
    play_sound,
    subscribe_to_newsletter,
)


def build_system_message(config: dict[str, Any]) -> str:
    """Add optional, reusable organization context from configuration."""
    company_name = str(config.get("company_name", "")).strip()
    company_website = str(config.get("company_website", "")).strip()
    products = config.get("products", [])
    if not company_name and not products:
        return BASE_SYSTEM_MESSAGE

    context_parts: list[str] = []
    if company_name:
        company_context = f"You represent {company_name}."
        if company_website:
            company_context += f" Its official website is {company_website}."
        context_parts.append(company_context)

    product_lines: list[str] = []
    if isinstance(products, list):
        for product in products:
            if not isinstance(product, dict):
                continue
            name = str(product.get("name", "")).strip()
            if not name:
                continue
            details = [str(product.get("description", "")).strip()]
            for label, key in (
                ("website", "website"),
                ("documentation", "documentation"),
                ("repository", "repository"),
            ):
                value = str(product.get(key, "")).strip()
                if value:
                    details.append(f"{label}: {value}")
            product_lines.append(f"- {name}: " + "; ".join(item for item in details if item))

    if product_lines:
        context_parts.append("Official products:\n" + "\n".join(product_lines))

    context_parts.append(
        "For questions about the represented company or its products, use web_search "
        "when current or detailed information is needed and prioritize the configured "
        "official websites, documentation, and repositories."
    )
    return "\n\n".join((*context_parts, BASE_SYSTEM_MESSAGE))


def configured_official_sources(config: dict[str, Any]) -> tuple[str, ...]:
    """Collect company and product URLs to prioritize during relevant searches."""
    sources: list[str] = []
    company_website = str(config.get("company_website", "")).strip()
    if company_website:
        sources.append(company_website)

    products = config.get("products", [])
    if isinstance(products, list):
        for product in products:
            if not isinstance(product, dict):
                continue
            for field in ("website", "documentation", "repository"):
                value = str(product.get(field, "")).strip()
                if value:
                    sources.append(value)

    return tuple(dict.fromkeys(sources))


def load_openai_config() -> dict[str, Any]:
    """Load the first OpenAI Realtime entry without depending on the process cwd."""
    if not CONFIG_PATH.exists():
        raise RuntimeError(
            f"Missing {CONFIG_PATH}. Copy OAI_CONFIG_LIST_sample to OAI_CONFIG_LIST and add your API key."
        )

    try:
        entries = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read {CONFIG_PATH}: {exc}") from exc

    if not isinstance(entries, list) or not entries or not isinstance(entries[0], dict):
        raise RuntimeError(f"{CONFIG_PATH} must contain a non-empty JSON array of objects.")

    config = entries[0]
    api_key = str(config.get("api_key", "")).strip()
    if not api_key or api_key.startswith("<your "):
        raise RuntimeError(f"{CONFIG_PATH} still contains the placeholder API key.")

    return config


def build_live_agent(config: dict[str, Any]) -> LiveAgent:
    client = AsyncOpenAI(
        api_key=config["api_key"],
        organization=config.get("organization"),
        project=config.get("project"),
        base_url=config.get("base_url"),
    )
    realtime_config = openai.RealTimeConfig(
        config.get("model", DEFAULT_MODEL),
        client=client,
        output=openai.AudioOutput(voice=config.get("voice", "coral")),
    )
    web_search = create_web_search_tool(
        client,
        model=config.get("web_search_model", "gpt-5-mini"),
        max_searches_per_session=int(config.get("web_search_limit", 10)),
        preferred_sources=configured_official_sources(config),
    )
    return LiveAgent(
        name="AI Cohost",
        prompt=build_system_message(config),
        config=realtime_config,
        tools=(*TOOLS, web_search),
    )


app = FastAPI()


@app.get("/", response_class=JSONResponse)
async def index_page():
    return {"message": "AG2 LiveAgent server is running!"}


website_files_path = Path(__file__).parent / "website_files"
app.mount("/static", StaticFiles(directory=website_files_path / "static"), name="static")
templates = Jinja2Templates(directory=website_files_path / "templates")


@app.get("/start-chat/", response_class=HTMLResponse)
async def start_chat(request: Request):
    return templates.TemplateResponse("chat.html", {"request": request, "port": request.url.port})


@app.websocket("/session")
async def handle_live_session(websocket: WebSocket):
    """Bridge browser PCM audio to one AG2 LiveAgent session."""
    await websocket.accept()
    send_lock = asyncio.Lock()
    subtitle = ""

    async def send_json(message: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(message)

    async def send_audio(event: SynthesizedAudioEvent) -> None:
        async with send_lock:
            await websocket.send_bytes(event.content)
        await send_json({"type": "thinking", "payload": False})

    async def send_subtitle_delta(event: ModelMessageChunk) -> None:
        nonlocal subtitle
        subtitle += event.content
        await send_json({"type": "subtitle", "payload": subtitle})

    async def response_done(_event: ModelResponse) -> None:
        nonlocal subtitle
        await send_json({"type": "thinking", "payload": False})
        subtitle = ""

    async def transcription_done(_event: TranscriptionCompletedEvent) -> None:
        await send_json({"type": "thinking", "payload": True})

    try:
        agent = build_live_agent(load_openai_config())
        async with agent.run() as context:
            with (
                context.stream.where(SynthesizedAudioEvent).sub_scope(send_audio),
                context.stream.where(ModelMessageChunk).sub_scope(send_subtitle_delta),
                context.stream.where(ModelResponse).sub_scope(response_done),
                context.stream.where(TranscriptionCompletedEvent).sub_scope(transcription_done),
            ):
                await send_json({"type": "ready", "sampleRate": 24000})
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        break
                    audio = message.get("bytes")
                    if audio:
                        await context.send(RecordedAudioEvent(audio))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("AG2 LiveAgent session failed")
        with suppress(Exception):
            await send_json({"type": "error", "message": str(exc)})
            await websocket.close(code=1011)
