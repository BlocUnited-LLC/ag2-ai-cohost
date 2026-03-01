'use strict';

(function () {

  // ---------------------------------------------------------------------------
  // Private state — no networking code in this module
  // ---------------------------------------------------------------------------
  var talkingHead     = null;
  var attachedElement = null;   // track last attached element to avoid duplicate calls

  // ---------------------------------------------------------------------------
  // Initialize TalkingHead inside #avatar-container
  // Called once from main.js on DOMContentLoaded.
  // ---------------------------------------------------------------------------
  async function initAvatar() {
    var container = document.getElementById('avatar-container');
    if (!container) {
      console.error('[Avatar] #avatar-container not found — cannot initialize.');
      return;
    }

    // TalkingHead is loaded from libs/talkinghead.js by index.html.
    // ttsEndpoint: null — AG2 provides audio via WebRTC, not TTS.
    talkingHead = new TalkingHead(container, {
      ttsEndpoint: null
    });

    try {
      await talkingHead.showAvatar({ url: 'assets/avatar.glb' });
      console.info('[Avatar] Avatar loaded successfully.');
    } catch (err) {
      // Non-fatal: avatar may not be present in all deployments
      console.error('[Avatar] Failed to load avatar GLB:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Attach (or re-attach) a remote audio element to TalkingHead for lip-sync.
  // Safe to call multiple times — skips if the same element is already attached.
  // Called by webrtc.js whenever a new remote track arrives.
  // ---------------------------------------------------------------------------
  function attachAudioToAvatar(audioElement) {
    if (!talkingHead) {
      console.warn('[Avatar] TalkingHead not ready — audio attachment deferred.');
      return;
    }
    if (attachedElement === audioElement) return;  // already attached, no-op

    try {
      talkingHead.attachAudio(audioElement);
      attachedElement = audioElement;
      console.info('[Avatar] Audio stream attached to TalkingHead.');
    } catch (err) {
      console.error('[Avatar] attachAudio() failed:', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API (consumed by webrtc.js and main.js)
  // ---------------------------------------------------------------------------
  window.initAvatar          = initAvatar;
  window.attachAudioToAvatar = attachAudioToAvatar;

}());
