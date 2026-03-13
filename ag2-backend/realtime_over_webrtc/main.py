import sys
from logging import getLogger
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Ensure the ag2-backend directory is on sys.path so the tools package is importable
_backend_dir = str(Path(__file__).resolve().parent.parent)
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

import autogen
from autogen.agentchat.realtime_agent import RealtimeAgent

from tools.moderation_tools import timeout_user, ban_user, delete_message
from tools.stream_tools import change_stream_title, trigger_overlay, play_sound
from tools.newsletter_tools import subscribe_to_newsletter

realtime_config_list = autogen.config_list_from_json(
    "OAI_CONFIG_LIST",
    filter_dict={
        "tags": ["gpt-4o-mini-realtime"],
    },
)

realtime_llm_config = {
    "timeout": 600,
    "config_list": realtime_config_list,
    "temperature": 0.8,
}

app = FastAPI()


@app.get("/", response_class=JSONResponse)
async def index_page():
    return {"message": "WebRTC AG2 Server is running!"}


website_files_path = Path(__file__).parent / "website_files"

app.mount(
    "/static", StaticFiles(directory=website_files_path / "static"), name="static"
)

# Templates for HTML responses

templates = Jinja2Templates(directory=website_files_path / "templates")


@app.get("/start-chat/", response_class=HTMLResponse)
async def start_chat(request: Request):
    """Endpoint to return the HTML page for audio chat."""
    port = request.url.port
    return templates.TemplateResponse("chat.html", {"request": request, "port": port})


@app.websocket("/session")
async def handle_media_stream(websocket: WebSocket):
    """Handle WebSocket connections providing audio stream and OpenAI."""
    await websocket.accept()

    logger = getLogger("uvicorn.error")

    realtime_agent = RealtimeAgent(
        name="AI Cohost",
        system_message=(
            "You are an AI live-stream co-host. You are witty, engaging, and conversational. "
            "Respond naturally as a co-host would — react to what you hear, ask follow-up "
            "questions, share opinions, and keep things energetic. Keep responses to 1-3 "
            "sentences unless the topic warrants more.\n\n"
            "You can perform moderation and stream control actions using tools. "
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
        ),
        llm_config=realtime_llm_config,
        websocket=websocket,
        logger=logger,
    )

    # ── Register moderation tools ──────────────────────────────────────
    realtime_agent.register_realtime_function(
        name="timeout_user",
        description="Timeout a user from chat for a given duration",
    )(timeout_user)

    realtime_agent.register_realtime_function(
        name="ban_user",
        description="Permanently ban a user from chat",
    )(ban_user)

    realtime_agent.register_realtime_function(
        name="delete_message",
        description="Delete a specific chat message by its ID",
    )(delete_message)

    # ── Register stream control tools ─────────────────────────────────
    realtime_agent.register_realtime_function(
        name="change_stream_title",
        description="Change the live stream title",
    )(change_stream_title)

    realtime_agent.register_realtime_function(
        name="trigger_overlay",
        description="Trigger an OBS overlay animation",
    )(trigger_overlay)

    realtime_agent.register_realtime_function(
        name="play_sound",
        description="Play a sound effect on stream",
    )(play_sound)

    # ── Register newsletter tools ─────────────────────────────────────
    realtime_agent.register_realtime_function(
        name="subscribe_to_newsletter",
        description="Subscribe an email to the BlocUnited newsletter. Only use when the streamer explicitly asks.",
    )(subscribe_to_newsletter)

    await realtime_agent.run()