'use strict';

// ---------------------------------------------------------------------------
// Application bootstrap — error boundary + ordered init
// This is the only file that coordinates avatar and WebRTC startup.
// It does not contain networking or avatar rendering logic.
// ---------------------------------------------------------------------------
(function () {

  // Global error boundary — prevents silent crashes in OBS Browser Source
  window.addEventListener('error', function (e) {
    console.error('[Main] Uncaught error:', e.message, e.filename + ':' + e.lineno);
  });

  window.addEventListener('unhandledrejection', function (e) {
    console.error('[Main] Unhandled Promise rejection:', e.reason);
    e.preventDefault();  // suppress browser "Uncaught (in promise)" noise in OBS
  });

  // ES module scripts are deferred — by the time this runs the DOM is already
  // parsed and avatar.js / webrtc.js have already defined their window.* exports.
  // Use the readyState guard so the same code also works if somehow called early.
  async function boot() {
    // Step 1: Avatar must be ready before WebRTC can attach audio to it
    try {
      await window.initAvatar();
    } catch (err) {
      console.error('[Main] Avatar initialization failed:', err);
      // Not fatal — continue so WebRTC still connects
    }

    // Step 2: Start WebRTC signaling — reconnect logic lives entirely in webrtc.js
    try {
      await window.initWebRTC();
    } catch (err) {
      console.error('[Main] WebRTC initialization failed:', err);
      // webrtc.js schedules its own reconnect; this catch is a last-resort guard
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Optional: clean up on page hide (browser tab switch / OBS scene swap)
  // Reconnection runs automatically when the page becomes visible again via OBS.
  window.addEventListener('pagehide', function () {
    if (typeof window.destroyWebRTC === 'function') {
      window.destroyWebRTC();
    }
  });

}());
