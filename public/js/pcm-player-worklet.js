// Streamed PCM player. Progress measures rendered samples, never received bytes.
class PcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = options?.processorOptions || {};
    this.inputSampleRate = settings.inputSampleRate || 24000;
    this.prebufferSamples = Math.round(this.inputSampleRate * ((settings.prebufferMs ?? 120) / 1000));
    this.maxQueuedSamples = Math.round(this.inputSampleRate * ((settings.maxBufferMs ?? 60000) / 1000));
    this.items = [];
    this.available = 0;
    this.currentItemId = null;
    this.blockedItemId = null;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') this.start(data.itemId);
      if (data.type === 'audio') this.append(new Int16Array(data.buffer), data.itemId);
      if (data.type === 'end' || data.type === 'audio_end') this.end(data.itemId);
      if (data.type === 'clear') {
        this.clear();
        this.port.postMessage({ type: 'cleared', requestId: data.requestId });
      }
    };
  }

  start(itemId = 'audio') {
    this.currentItemId = itemId;
    this.blockedItemId = null;
    if (!this.items.some((item) => item.id === itemId)) {
      this.items.push({ id: itemId, chunks: [], offset: 0, available: 0, fraction: 0, played: 0, lastReport: 0, started: false, ended: false });
    }
  }

  append(pcm, itemId = this.currentItemId || 'audio') {
    if (!pcm.length || itemId === this.blockedItemId) return;
    if (!this.items.some((item) => item.id === itemId)) this.start(itemId);
    if (this.available + pcm.length > this.maxQueuedSamples) {
      this.clear();
      this.blockedItemId = itemId;
      this.port.postMessage({ type: 'overflow' });
      return;
    }
    const item = this.items.find((entry) => entry.id === itemId);
    const samples = new Float32Array(pcm.length);
    for (let index = 0; index < pcm.length; index++) samples[index] = pcm[index] / 32768;
    item.chunks.push(samples);
    item.available += samples.length;
    this.available += samples.length;
  }

  end(itemId = this.currentItemId) {
    const item = this.items.find((entry) => entry.id === itemId);
    if (item) item.ended = true;
  }

  report(item, final = false) {
    if (!final && item.played - item.lastReport < this.inputSampleRate / 4) return;
    item.lastReport = item.played;
    this.port.postMessage({ type: 'playback', itemId: item.id, playedMs: Math.floor(item.played * 1000 / this.inputSampleRate), final });
  }

  clear() {
    this.items.forEach((item) => this.report(item, true));
    this.items = [];
    this.available = 0;
    this.currentItemId = null;
  }

  consume(item, amount) {
    let remaining = Math.min(amount, item.available);
    const consumed = remaining;
    while (remaining > 0 && item.chunks.length) {
      const count = Math.min(remaining, item.chunks[0].length - item.offset);
      item.offset += count;
      remaining -= count;
      if (item.offset === item.chunks[0].length) { item.chunks.shift(); item.offset = 0; }
    }
    item.available -= consumed;
    item.played += consumed;
    this.available -= consumed;
    return consumed;
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;
    output.fill(0);
    const ratio = this.inputSampleRate / sampleRate;
    for (let index = 0; index < output.length; index++) {
      let item = this.items[0];
      while (item?.ended && !item.available) {
        this.report(item, true);
        this.items.shift();
        item = this.items[0];
      }
      if (!item) break;
      // End-of-response flushes even a final chunk shorter than the prebuffer.
      if (!item.started && (item.available >= this.prebufferSamples || item.ended)) item.started = true;
      if (!item.started || item.available < 1 || (item.available < 2 && !item.ended)) break;
      const current = item.chunks[0][item.offset];
      const next = item.offset + 1 < item.chunks[0].length ? item.chunks[0][item.offset + 1] : (item.chunks[1]?.[0] ?? current);
      output[index] = current + (next - current) * item.fraction;
      item.fraction += ratio;
      const consumed = this.consume(item, Math.floor(item.fraction));
      item.fraction -= consumed;
      this.report(item);
    }
    return true;
  }
}
registerProcessor('pcm-player', PcmPlayerProcessor);
