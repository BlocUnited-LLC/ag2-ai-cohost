# Browser controls and OBS setup

## Browser controls

Press **M** to mute or unmute the microphone. The same controls are available from
the browser console:

```js
window.toggleMic();
window.setMicMuted(true);
window.setMicMuted(false);
```

Optional browser behavior can be configured by defining `window.COHOST_CONFIG`
before the application scripts load:

```html
<script>
  window.COHOST_CONFIG = {
    signalingBaseUrl: "http://localhost:3001",
    bargeInEnabled: true,
    bargeInThreshold: 0.025
  };
</script>
```

`signalingBaseUrl` overrides the cohost server address; omit it to use the page's
origin. The current audio transport is WebSocket despite this legacy setting name.
Lower
`bargeInThreshold` for a quiet microphone; raise it when background noise causes
false interruptions.

## OBS Browser Source

See the [OBS Browser Source reference](https://obsproject.com/kb/browser-source)
for the URL, viewport size, and source lifecycle settings.

1. Start both services with `npm run start:ag2` and `npm start`.
2. In OBS, add a **Browser Source** to the scene.
3. Set its URL to `http://localhost:3001`.
4. Set its width and height to match the scene, such as 1280 × 720.
5. Right-click the source and choose **Interact**, then click **▶ Click to Start**.
   Check microphone input and audio output in OBS before using the scene live.
6. Enable **Shutdown source when not visible** if the source should release resources
   when its scene is hidden.

OBS Browser Source microphone permissions and device support vary by environment.
If microphone input is unavailable there, run the app in Chrome or Edge and capture
that browser window plus its audio in OBS instead. That capture route may require
additional scene styling because it is capturing a browser window.

Both services must remain running while streaming. Reinitializing a source can
require clicking **▶ Click to Start** again. Headphones provide the most
reliable barge-in because the microphone is less likely to capture the cohost's voice.

[Back to the README](../README.md)
