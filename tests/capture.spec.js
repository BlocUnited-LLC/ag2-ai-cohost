'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, expect } = require('@playwright/test');

for (const sampleRate of [44100, 48000]) {
  test(`microphone resampling preserves timing and sine continuity at ${sampleRate} Hz`, () => {
    let Processor;
    const messages = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/pcm-capture-worklet.js'), 'utf8'), {
      sampleRate,
      AudioWorkletProcessor: class {
        constructor() { this.port = { postMessage(message) { messages.push(message); } }; }
      },
      registerProcessor(_name, implementation) { Processor = implementation; },
    });
    const capture = new Processor({ processorOptions: { targetSampleRate: 24000 } });
    const frequency = 997;
    const blocks = 500;
    for (let block = 0; block < blocks; block++) {
      const input = Float32Array.from({ length: 128 }, (_, offset) =>
        0.65 * Math.sin(2 * Math.PI * frequency * (block * 128 + offset) / sampleRate));
      const monitor = new Float32Array(128).fill(1);
      capture.process([[input]], [[monitor]]);
      // Capture must never feed the streamer's microphone back to the speakers.
      expect(monitor.every((sample) => sample === 0)).toBeTruthy();
    }
    const packets = messages.filter((message) => message.type === 'pcm');
    expect(packets.length).toBeGreaterThan(0);
    expect(packets.every((packet) => packet.buffer.byteLength === 960)).toBeTruthy();
    const samples = packets.flatMap((packet) => [...new Int16Array(packet.buffer)]);
    const expectedSamples = blocks * 128 * 24000 / sampleRate;
    expect(Math.abs(samples.length - expectedSamples)).toBeLessThan(480);
    let maxError = 0;
    for (let index = 0; index < samples.length; index++) {
      const expected = 0.65 * Math.sin(2 * Math.PI * frequency * index / 24000);
      maxError = Math.max(maxError, Math.abs(samples[index] / 32768 - expected));
    }
    // This bound catches phase resets at worklet boundaries while allowing
    // ordinary linear interpolation and PCM16 quantization error.
    expect(maxError).toBeLessThan(0.003);
    const levels = messages.filter((message) => message.type === 'level');
    expect(levels.length).toBeGreaterThan(0);
    expect(levels.every((message) => Number.isFinite(message.rms) && message.rms > 0 && message.rms < 1)).toBeTruthy();
  });
}
