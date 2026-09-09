# Troubleshooting

## Avatar loads but audio or microphone input does not work

- Click **▶ Click to Start** to satisfy the browser's audio permission requirement.
- Allow microphone access in the browser's site permissions.
- Confirm the AG2 backend is still running with `npm run start:ag2`.
- Confirm the web server is still running with `npm start`.

## AG2 backend unreachable or connection errors

- Start the backend with `npm run start:ag2`.
- Re-run `npm run setup` if the Python environment is incomplete.
- Confirm `ag2-backend/OAI_CONFIG_LIST` contains a valid API key.
- Make sure only one backend process is using port 5050.

## Avatar mouth does not move

- Open browser developer tools with **F12** and look for
  `[Avatar] HeadAudio lip-sync active.`
- If an error appears instead, refresh the page and click **▶ Click to Start** again.

## Agent does not stop when the user speaks

- Barge-in is enabled by default. OpenAI semantic VAD cancels the active response and
  the browser clears audio already queued for playback.
- Use headphones to keep speaker output out of the microphone.
- For a quiet microphone, set `bargeInThreshold` below `0.025` in
  `window.COHOST_CONFIG`.
- Raise the threshold when background noise causes false interruptions.
- Hard-refresh the browser with **Ctrl+Shift+R** after changing frontend settings.

## Voice is choppy, unusually fast, or unusually deep

- Hard-refresh with **Ctrl+Shift+R** so the current PCM AudioWorklet is loaded.
- Confirm only one web server and one AG2 backend are running.
- Prefer a stable wired network and close CPU-heavy browser tabs or OBS filters.
- Compare against AG2's native `SoundDevicePlayer` quick start to isolate the browser
  audio bridge from the provider voice.

## Port 3001 is already in use

Another process is using the web port. In PowerShell, start this app on another port:

```powershell
$env:PORT = 3002
npm start
```

Then open `http://localhost:3002`.
