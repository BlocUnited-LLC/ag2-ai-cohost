# Browser controls and OBS setup

## Browser controls

Start both services with `npm run start:ag2` and `npm start`, then open
`http://localhost:3001/control` in Chrome or Edge. Choose your microphone and click
**Start cohost**. Opening the page alone does not start a paid provider session.

- **Mute microphone** or **M** stops microphone audio while keeping the conversation open.
- **Interrupt** or **Escape** clears queued speech and cancels the current response.
- **Stop cohost** closes the provider connection and releases the microphone.
- **Monitor audio in this browser** lets you hear the cohost locally. It starts off
  so OBS and the control browser do not both play the same audio.
- The microphone meter shows input level. Captions and optional research task status
  appear below the controls.

The keyboard shortcuts are disabled while editing fields or focusing buttons.
Use headphones to keep the cohost's voice out of your microphone. Provider voice
activity detection handles natural interruptions; there is no browser RMS threshold
setting to configure.

Only one control page may own the conversation. Closing or reloading it leaves a
60-second reconnect window, after which the backend stops the conversation. After a
reload, click **Resume microphone** to rejoin the existing conversation. Keep the
control page open while broadcasting.

## OBS Browser Source

### Add it to an existing scene

1. Keep both services running. In the control page, click **Copy overlay URL** and
   leave **Monitor audio in this browser** off.
2. In OBS's **Scene Collection** menu, choose the collection you already use for
   your stream, then select the target scene in **Scenes**.
3. In **Sources**, click **+ → Browser → Create new**, name it **AG2 Cohost**, and
   paste the entire URL, including `#token=…`. Leave **Local file** unchecked.
4. Set width **1280** and height **720**. Enable **Control audio via OBS**, then
   confirm the source appears in the Audio Mixer.
5. Move the source above backgrounds and display/game captures in the Sources list
   so they do not cover it. Drag its corners to scale it and place it beside your
   camera or content. Keep the avatar's captions inside the canvas and away from
   alerts. For exact positioning, right-click the source and choose
   **Transform → Edit Transform**. Click the source's padlock when finished.
6. Click **Start cohost** in Chrome or Edge. Check that the avatar renders, captions
   appear during a response, and the OBS source's audio meter moves. OBS receives
   the conversation without requesting a microphone or starting another AI session.

The Browser Source dimensions define the overlay's own viewport; its transform
controls how large it appears in your existing scene. Scaling the source also scales
its captions, so check readability at your stream's output size. The overlay is
transparent and does not need a chroma-key filter.

For other scenes **within the same collection**, use **+ → Browser → Add Existing →
AG2 Cohost**. Each scene can place and scale that shared source independently. Avoid
adding multiple copies to one active scene, including through nested scenes. A
**different scene collection** needs its own Browser Source; use the same current
overlay URL there. All viewers still receive the one conversation controlled by the
control page.

### Example OBS layout

You can use **AG2 Cohost** in any scene collection and scene. The following
example places the avatar and captions in the lower-left corner of a 1920 × 1080
canvas. Adjust it around your own banners, camera, alerts, and other scene elements.

| Setting | Value |
| --- | --- |
| Scene canvas | 1920 × 1080 |
| Browser Source viewport | 1280 × 720 |
| Source order | **AG2 Cohost** at the top of Sources |
| Displayed size | 800 × 450 |
| Position | X **24**, Y **606**; top-left alignment |
| Rotation / crop | 0° / none |
| Transform lock | Locked |
| Browser Source audio | **Control audio via OBS** enabled |

To reproduce the placement, open **Transform → Edit Transform** and enter the
displayed size and position above, then lock the source. Keep the default transparent
Browser Source CSS. Use the private overlay URL copied from your own control page.

In this setup, the cohost is unmuted at **0.0 dB**, has **0 ms** sync offset, and
has output tracks **1–6** selected. **Monitor Off** sends it to the selected output
tracks without playing it through OBS's monitoring device. **Desktop Audio** is
also active, so leave control-page monitoring off to avoid capturing a second copy.
To hear the cohost locally, configure the OBS headphone monitoring route described
below and ensure Desktop Audio does not recapture it.

### Hear it and send it to the stream

Leave **Monitor audio in this browser** off when OBS handles the sound. In OBS,
open **Advanced Audio Properties** from the Audio Mixer and check the cohost's
monitoring setting and selected output tracks. Hearing audio in headphones and
sending it to a stream/recording are separate routes; the meter alone does not
confirm both.

If you want to hear the cohost through OBS, select your headphones as OBS's
monitoring device and enable monitoring for **AG2 Cohost**. Keep its output enabled
for the track used by your stream. Make sure desktop audio does not capture that
monitored sound again, which would duplicate the cohost in the output. Use
headphones so the cohost's voice does not feed back into your microphone.

### Refreshes, scene switches, and restarts

**Shutdown source when not visible** may be enabled to release rendering resources;
the voice session continues in the backend. When retained, hidden/inactive sources
stop their local playback. A reloaded source receives current captions and future
audio, without replaying old speech. **Refresh browser when scene becomes active**
is normally unnecessary and causes a short rendering reconnect.

OBS normally permits Browser Source audio automatically. If it displays **Enable
audio**, open **Interact** and click that button. Microphone capture always stays in
Chrome or Edge. The avatar requires access to its pinned CDN libraries; an avatar
load failure leaves audio and captions available with a visible error.

The overlay URL is a local viewer credential. It cannot start/stop the cohost or send
microphone audio. Keep it private, including in scene-collection exports and
screenshots. It changes when the Python backend restarts, so refresh the control
page and update the OBS source URL after a restart. Sources shared with **Add
Existing** update together; sources in other collections must be updated separately.

See the [OBS Browser Source reference](https://obsproject.com/kb/browser-source) for
viewport and lifecycle settings, and the [OBS Sources Guide](https://obsproject.com/kb/sources-guide)
for source ordering and transforms.

## What the automated tests cover

Run `npx playwright install chromium` once, then `npm test` after setup. Tests use
isolated ports and a simulated provider through the real AG2 LiveAgent event stream.
They cover authentication, one shared conversation, reload/reconnect, microphone
permission denial, mute, interruption, captions, source visibility, PCM resampling,
and rendered playback progress. They do not read `OAI_CONFIG_LIST` or call OpenAI.

Playwright drives the web app, not OBS's native controls. An OBS acceptance check
must additionally verify the Browser Source renders, the mixer receives audio,
source refresh/hide/show works, and the final monitoring/output route is correct.
A live provider conversation is needed to assess voice latency and natural barge-in.

[Back to the README](../README.md)
