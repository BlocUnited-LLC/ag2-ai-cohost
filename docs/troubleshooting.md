# Troubleshooting

## The control page cannot connect

Start the backend with `npm run start:ag2` and the web server with `npm start`.
Re-run `npm run setup` after upgrading to install AG2 1.2.1 and the OpenAI Realtime
WebSocket dependency. Check that only one process owns each port. Open the control
page at `http://localhost:3001/control`; the backend port does not serve the UI.

The local app validates Host and Origin and binds to loopback. A remote hostname or
custom port needs matching `COHOST_ALLOWED_ORIGINS` on both services; see
[configuration](configuration.md#local-services-and-access). If another control page
owns the session, close it before opening a replacement.

## Microphone or audio does not work

- Use Chrome or Edge for the control page, click **Start cohost**, and allow microphone access.
- Check the selected input device and input meter. Change devices while stopped.
- In a browser-only session, enable **Monitor audio in this browser**.
- In OBS, use the copied **overlay** URL and enable **Control audio via OBS**.
  Check the source's mute state and Advanced Audio Properties.
- If the overlay displays **Enable audio**, use OBS **Interact** to click it.
- After reloading the control page, click **Resume microphone**.

If audio doubles or echoes, keep only one audible overlay and one monitoring route.
Use headphones. OBS source visibility or scene changes must not start a new provider
session; the control page owns that lifecycle.

## The OBS overlay cannot authenticate

Backend restarts rotate the viewer token. Refresh the control page, copy the new
overlay URL, and replace the OBS URL including its fragment. A plain `/overlay`
address is intentionally insufficient. The link never contains your provider key.

## Avatar is missing or its mouth does not move

Check internet/CDN access and OBS browser hardware acceleration/WebGL support.
Browser developer tools should show `[Avatar] HeadAudio lip-sync active.` after
initialization. Refresh the source after resolving network or graphics errors.
Avatar failure does not prevent audio/captions from connecting. Hard-refresh the
browser after frontend changes to replace cached worklets.

## The cohost does not stop when I speak

Provider voice detection cancels the active response, and all overlays clear queued
audio. Try the **Interrupt** button to separate microphone/VAD issues from playback.
Use headphones and check microphone level. The backend uses playback receipts to
truncate unheard speech from provider history; it ignores hidden outputs and viewers
that joined partway through a response.

## Voice is choppy or has the wrong pitch

Hard-refresh the control page and overlay to load the current audio worklets. They
resample input to 24 kHz and output to the device rate. Check network quality, OBS
rendering load, and whether multiple browser sources are playing at once. Compare
a browser-only monitored session with OBS to isolate output routing.

## Provider or tool errors

Check the local `OAI_CONFIG_LIST` model, API access, and voice settings. Start a fresh
conversation after changing them. Errors are shown in the controls without printing
credentials. Research and newsletter signup require explicit `enabled_tools` entries;
newsletter signup also requires `NEWSLETTER_API_URL`. Placeholder stream/chat actions
cannot be enabled until a real integration is implemented.

[Back to the README](../README.md)
