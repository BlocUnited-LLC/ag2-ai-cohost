// avatar.js — ES module
// Loads TalkingHead via CDN importmap (see index.html).
// Uses HeadAudio (local) for audio-driven, real-time lip-sync from WebRTC.
//
// Required files in public/libs/:
//   headaudio.mjs      — from https://github.com/met4citizen/HeadAudio  (modules/)
//   headworklet.mjs    — from https://github.com/met4citizen/HeadAudio  (modules/)
//   model-en-mixed.bin — from https://github.com/met4citizen/HeadAudio  (dist/)
//
// Required file in public/assets/:
//   avatar.glb         — export from https://avaturn.me  (free, non-commercial)

import { TalkingHead } from "talkinghead";
import { HeadAudioNode } from "../libs/headaudio.mjs";

// ── Private state ─────────────────────────────────────────────────────────────
let talkingHead       = null;
let headAudio         = null;
let workletRegistered = false;
let lastStream        = null;   // detect reconnect re-use of same stream

// ── TalkingHead initialisation ────────────────────────────────────────────────
// Called once by main.js.  AG2 provides speech via WebRTC, so ttsEndpoint is null.
async function initAvatar() {
  const container = document.getElementById('avatar-container');
  if (!container) {
    console.error('[Avatar] #avatar-container not found — cannot initialise.');
    return;
  }

  talkingHead = new TalkingHead(container, {
    ttsEndpoint:    null,          // no TTS — AG2 audio arrives via WebRTC
    lipsyncModules: ['en'],        // load English lip-sync module only
    cameraView:     'upper',       // waist-up framing
    cameraRotateEnable: false      // fixed camera — OBS source should not move
  });

  try {
    await talkingHead.showAvatar({
      url:          'assets/julia.glb',
      body:         'F',           // 'M' for male avatars
      lipsyncLang:  'en',
      avatarMood:   'neutral'
    });
    console.info('[Avatar] Avatar loaded successfully.');
  } catch (err) {
    console.error('[Avatar] Failed to load avatar.glb:', err);
    // Non-fatal — WebRTC will still connect even if the model is missing.
  }

  // Pre-register the HeadAudio worklet processor now so that the first
  // WebRTC audio track can be wired up without any extra async delay.
  try {
    await talkingHead.audioCtx.audioWorklet.addModule('./libs/headworklet.mjs');
    workletRegistered = true;
    console.info('[Avatar] HeadAudio worklet registered.');
  } catch (err) {
    console.warn('[Avatar] HeadAudio worklet registration failed (lip-sync will not work):', err);
  }
}

// ── HeadAudio lip-sync setup ──────────────────────────────────────────────────
// Called by webrtc.js every time a new remote audio track arrives.
// Safe to call on reconnect — tears down the previous HeadAudio instance first.
async function setupHeadAudio(mediaStream) {
  if (!talkingHead) {
    console.warn('[Avatar] setupHeadAudio called before TalkingHead is ready.');
    return;
  }
  if (!workletRegistered) {
    console.warn('[Avatar] HeadAudio worklet not registered — lip-sync unavailable.');
    return;
  }
  if (mediaStream === lastStream) return;   // same stream on reconnect — no-op
  lastStream = mediaStream;

  // Tear down previous HeadAudio instance
  if (headAudio) {
    try { headAudio.disconnect(); } catch (_) {}
    talkingHead.opt.update = null;
    headAudio = null;
  }

  try {
    headAudio = new HeadAudioNode(talkingHead.audioCtx, {
      processorOptions: {},
      parameterData: {
        vadMode:             1,     // gate-based VAD
        vadGateActiveDb:   -40,     // dB threshold to detect speech
        vadGateInactiveDb: -60,     // dB threshold for silence
        silMode:             0      // use trained SIL prototypes (no manual calibration)
      }
    });

    await headAudio.loadModel('./libs/model-en-mixed.bin');

    // Connect WebRTC MediaStream → HeadAudio (analyser only — no audio output here;
    // the HTML <audio> element handles actual playback via srcObject).
    const source = talkingHead.audioCtx.createMediaStreamSource(mediaStream);
    source.connect(headAudio);

    // Map Oculus viseme blend-shape values into TalkingHead's morph targets
    headAudio.onvalue = (key, value) => {
      const mt = talkingHead.mtAvatar;
      if (mt && mt[key]) {
        Object.assign(mt[key], { newvalue: value, needsUpdate: true });
      }
    };

    // Plug into TalkingHead's rAF animation loop
    talkingHead.opt.update = headAudio.update.bind(headAudio);

    console.info('[Avatar] HeadAudio lip-sync active.');
  } catch (err) {
    console.error('[Avatar] HeadAudio setup failed:', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
window.initAvatar     = initAvatar;
window.setupHeadAudio = setupHeadAudio;
