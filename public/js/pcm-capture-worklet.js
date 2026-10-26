// Stateful interpolation preserves sample timing across 128-frame worklet blocks.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions?.targetSampleRate || 24000;
    this.ratio = sampleRate / this.targetRate;
    this.position = 0;
    this.previous = 0;
    this.chunk = new Int16Array(Math.round(this.targetRate / 50));
    this.chunkOffset = 0;
    this.energy = 0;
    this.levelSamples = 0;
  }

  process(inputs, outputs) {
    outputs[0]?.forEach((channel) => channel.fill(0));
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    for (const sample of input) this.energy += sample * sample;
    this.levelSamples += input.length;
    if (this.levelSamples >= sampleRate / 20) {
      this.port.postMessage({ type: 'level', rms: Math.sqrt(this.energy / this.levelSamples) });
      this.energy = this.levelSamples = 0;
    }
    while (this.position < input.length - 1) {
      const index = Math.floor(this.position);
      const fraction = this.position - index;
      const before = index < 0 ? this.previous : input[index];
      const after = input[index + 1];
      const value = Math.max(-1, Math.min(1, before + (after - before) * fraction));
      this.chunk[this.chunkOffset++] = value < 0 ? value * 32768 : value * 32767;
      if (this.chunkOffset === this.chunk.length) {
        const buffer = this.chunk.buffer;
        this.port.postMessage({ type: 'pcm', buffer }, [buffer]);
        this.chunk = new Int16Array(Math.round(this.targetRate / 50));
        this.chunkOffset = 0;
      }
      this.position += this.ratio;
    }
    this.position -= input.length;
    this.previous = input[input.length - 1];
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
