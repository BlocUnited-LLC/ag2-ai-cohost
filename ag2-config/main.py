from logging import getLogger
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import autogen
from autogen.agentchat.realtime_agent import RealtimeAgent

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
            "You are an AI podcast co-host. You are witty, engaging, and conversational. "
            "Respond naturally as a co-host would — react to what you hear, ask follow-up "
            "questions, share opinions, and keep things energetic. Keep responses to 1-3 "
            "sentences unless the topic warrants more. "
            "Start by saying: 'Hey, I'm live! What are we talking about today?'"
        ),
        llm_config=realtime_llm_config,
        websocket=websocket,
        logger=logger,
    )

    await realtime_agent.run()
