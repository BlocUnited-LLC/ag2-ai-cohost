
# **LiveAgent browser audio bridge**

This project demonstrates a voice assistant using Python, [FastAPI](https://fastapi.tiangolo.com/), and [AG2 LiveAgent](https://docs.ag2.ai/docs/user-guide/live/live_agent/). The browser streams 24 kHz PCM audio over a local WebSocket; LiveAgent owns the server-side OpenAI Realtime connection.

## **Key Features**
- **Realtime Audio Streaming**: Full-duplex browser audio over a WebSocket bridge to AG2 LiveAgent.
- **FastAPI Integration**: A lightweight Python backend that connects each browser session to LiveAgent.

## **Prerequisites**

Before you begin, ensure you have the following:
- **Python 3.9+**: The project was tested with `3.9`. Download [here](https://www.python.org/downloads/).
- **An OpenAI account and an OpenAI API Key.** You can sign up [here](https://platform.openai.com/).
  - **OpenAI Realtime API access** for `gpt-realtime-2`.

## **Local Setup**

Follow these steps to set up the project locally:

### **1. Clone the Repository**
```bash
git clone https://github.com/BlocUnited-LLC/ag2-ai-cohost.git
cd ag2-ai-cohost
```

### **2. Set Up Environment Variables**
Create a `OAI_CONFIG_LIST` file based on the provided `OAI_CONFIG_LIST_sample`:
```bash
cp OAI_CONFIG_LIST_sample OAI_CONFIG_LIST
```
In the OAI_CONFIG_LIST file, update the `api_key` to your OpenAI API key.

### **Choose a Realtime voice**

Set the `voice` field in `OAI_CONFIG_LIST`:

```json
{
  "model": "gpt-realtime-2",
  "api_key": "<your OpenAI API key here>",
  "voice": "coral"
}
```

OpenAI currently supports these built-in Realtime voices:

| Voice | Best-effort listening impression | Likely visual-avatar fit | Confidence |
|---|---|---|---|
| `alloy` | Smooth, balanced, and adaptable | Androgynous or neutral | Medium |
| `ash` | Energetic, clear, and conversational | Man or masculine-presenting | Medium-high |
| `ballad` | Expressive, lyrical, and animated | Man or masculine-presenting | Medium |
| `coral` | Warm, upbeat, and approachable; the project default | Woman or feminine-presenting | High |
| `echo` | Smooth, resonant, and steady | Man or masculine-presenting | High |
| `sage` | Calm, measured, and soft | Woman, androgynous, or neutral | Medium |
| `shimmer` | Bright, light, and energetic | Woman or feminine-presenting | High |
| `verse` | Confident, crisp, and expressive | Man, androgynous, or neutral | Medium |
| `marin` | Natural, warm, and polished; recommended by OpenAI for quality | Woman or feminine-presenting | Medium-high |
| `cedar` | Grounded, rich, and polished; recommended by OpenAI for quality | Man or masculine-presenting | Medium-high |

The descriptions above are subjective listening shorthand, not official gender or
personality labels. OpenAI does not gender-label these voices, and delivery can vary
with the model's instructions, language, and conversation. For a woman avatar, try
`coral`, `shimmer`, and `marin`, then keep whichever sounds best for the character.
For a man avatar, `ash`, `echo`, and `cedar` are useful starting points. For an
androgynous or non-gendered character, try `alloy`, `sage`, or `verse`. These groups
are casting suggestions for matching audio to a visual character, not fixed identity
claims about the voices.

These classifications are a best-effort casting guide based on how the voices are
commonly perceived, not attributes guaranteed by the API. Audition them in
[OpenAI.fm](https://openai.fm/), OpenAI's interactive voice demo. The demo uses the
text-to-speech model, so the same voice may have somewhat different emotion, pacing,
or intonation in a Realtime conversation. For a visual character, test finalists
with the same script and speaking instructions that the production avatar will use.

See the [official OpenAI Realtime voice list](https://developers.openai.com/api/reference/python/__sdk_schema?declaration=%28resource%29+realtime.calls+%3E+%28method%29+accept+%3E+%28params%29+default+%3E+%28param%29+audio+%3E+%28schema%29&selected=%28resource%29+realtime.calls+%3E+%28method%29+accept).
OpenAI also notes that a voice cannot be changed after a session has produced audio.
After changing `voice`, restart the backend and begin a new browser session.

### **Configure the agent prompt**

Set `agent_prompt` to control the cohost's identity, tone, and conversational style:

```json
"agent_prompt": "You are a warm, curious AI cohost. Have a natural conversation and answer whatever the user wants to know. Be concise but useful, point out practical value when it helps, and ask thoughtful follow-up questions without sounding scripted."
```

Keep this outcome-focused and natural. Tool capabilities and safety rules are added by
the application, so the prompt does not need to repeat them.

### **Configure grounding contacts**

The optional `contacts` object gives the cohost reusable background context without
hard-coding a company/product relationship into the prompt:

```json
"contacts": {
  "primary": {
    "name": "Your central subject",
    "context": "Natural background knowledge and useful value propositions.",
    "websites": ["https://example.com"]
  },
  "secondary": [
    {
      "name": "A related subject",
      "context": "What the agent should naturally understand about this subject.",
      "websites": [
        "https://example.com/about",
        "https://example.com/resources",
        "https://github.com/example/project"
      ]
    }
  ]
}
```

Every contact uses the same deterministic fields: `name`, `context`, and `websites`.
Write `context` as natural background knowledge rather than metadata. Include useful
value propositions there, but do not write dialogue for the model to repeat verbatim.
The `websites` array can contain any number of relevant pages; it does not assign
fixed roles such as website, documentation, or repository. `primary` and `secondary`
only organize configuration and are never spoken to the user. The cohost remains a
general agent, uses contact context only when relevant, and prioritizes these pages
when current information requires `web_search`.

### **Barge-in and interruptions**

OpenAI semantic voice activity detection is configured with `interrupt_response`
enabled. When the user begins speaking, the provider cancels its current response and
the browser clears audio that was already queued for playback. Local detection uses a
default RMS threshold of `0.025`. It can be tuned in the optional browser configuration:

```html
<script>
  window.COHOST_CONFIG = {
    bargeInEnabled: true,
    bargeInThreshold: 0.025
  };
</script>
```

Lower the threshold for a quiet microphone; raise it when background noise causes
false interruptions. Headphones provide the most reliable barge-in because they keep
the cohost's own voice out of the microphone.

### (Optional) Create and use a virtual environment

To reduce cluttering your global Python environment on your machine, you can create a virtual environment. On your command line, enter:

```
python3 -m venv env
source env/bin/activate
```

### **3. Install Dependencies**
Install the required Python packages using `pip`:
```bash
pip install -r requirements.txt
```

### **4. Start the Server**
Run the application with [Uvicorn](https://www.uvicorn.org/):
```bash
uvicorn realtime_over_webrtc.main:app --port 5050
```

## **Test the App**
With the server running, open the client application in your browser by navigating to [http://localhost:5050/start-chat/](http://localhost:5050/start-chat/). Speak into your microphone, and the AI assistant will respond in real time.

## **License**
This project is licensed under the [MIT License](LICENSE).
