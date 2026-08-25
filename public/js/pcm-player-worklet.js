'use strict';

// Continuous mono PCM player for streamed AG2/OpenAI Realtime audio. A small
// jitter buffer prevents individual WebSocket message timing from changing the
// cadence of playback.
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    var settings = (options && options.processorOptions) || {};
    this.inputSampleRate = settings.inputSampleRate || 24000;
    this.prebufferSamples = Math.round(
      this.inputSampleRate * ((settings.prebufferMs || 80) / 1000)
    );
    this.maxQueuedSamples = Math.round(
      this.inputSampleRate * ((settings.maxBufferMs || 2000) / 1000)
    );
    this.capacity = Math.max(
      this.maxQueuedSamples + this.inputSampleRate,
      this.inputSampleRate * 4
    );
    this.samples = new Float32Array(this.capacity);
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.readFraction = 0;
    this.playing = false;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'clear') {
        this.clear();
        return;
      }
      if (event.data && event.data.type === 'audio') {
        this.append(new Int16Array(event.data.buffer));
      }
    };
  }

  clear() {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.available = 0;
    this.readFraction = 0;
    this.playing = false;
  }

  discard(count) {
    var discarded = Math.min(count, this.available);
    this.readIndex = (this.readIndex + discarded) % this.capacity;
    this.available -= discarded;
    this.readFraction = 0;
  }

  append(pcm) {
    var start = Math.max(0, pcm.length - this.maxQueuedSamples);
    var incoming = pcm.length - start;
    var overflow = this.available + incoming - this.maxQueuedSamples;
    if (overflow > 0) this.discard(overflow);

    for (var i = start; i < pcm.length; i += 1) {
      this.samples[this.writeIndex] = pcm[i] / 32768;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
      this.available += 1;
    }
  }

  process(_inputs, outputs) {
    var output = outputs[0] && outputs[0][0];
    if (!output) return true;
    output.fill(0);

    if (!this.playing && this.available >= this.prebufferSamples) {
      this.playing = true;
    }

    var inputSamplesPerOutputSample = this.inputSampleRate / sampleRate;
    for (var i = 0; i < output.length && this.playing; i += 1) {
      if (this.available < 2) {
        this.playing = false;
        this.readFraction = 0;
        break;
      }

      var nextIndex = (this.readIndex + 1) % this.capacity;
      var current = this.samples[this.readIndex];
      var next = this.samples[nextIndex];
      output[i] = current + (next - current) * this.readFraction;

      this.readFraction += inputSamplesPerOutputSample;
      var consumed = Math.floor(this.readFraction);
      if (consumed > 0) {
        this.readFraction -= consumed;
        var advanced = Math.min(consumed, this.available);
        this.readIndex = (this.readIndex + advanced) % this.capacity;
        this.available -= advanced;
      }
    }

    return true;
  }
}

registerProcessor('pcm-player', PcmPlayerProcessor);
