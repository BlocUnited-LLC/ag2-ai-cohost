'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, expect } = require('@playwright/test');

function playback() {
  let Processor;
  const messages = [];
  const scope = {
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage(message) { messages.push(message); } }; }
    },
    registerProcessor(_name, implementation) { Processor = implementation; },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/pcm-player-worklet.js'), 'utf8'), scope);
  const player = new Processor({ processorOptions: { inputSampleRate: 24000, prebufferMs: 80, maxBufferMs: 5000 } });
  player.reports = messages;
  return player;
}

test('interruption discards queued speech and produces silence on the next render quantum', () => {
  const player = playback();
  const samples = new Int16Array(24000).fill(10000);
  player.port.onmessage({ data: { type: 'audio', buffer: samples.buffer } });
  const before = new Float32Array(128);
  player.process([], [[before]]);
  expect(before.some((sample) => sample !== 0)).toBeTruthy();
  player.port.onmessage({ data: { type: 'clear' } });
  const after = new Float32Array(128).fill(1);
  player.process([], [[after]]);
  expect([...after].every((sample) => sample === 0)).toBeTruthy();
  // Silence remains on later callbacks; discarded audio cannot reappear.
  player.process([], [[after]]);
  expect([...after].every((sample) => sample === 0)).toBeTruthy();
});

test('end-of-response flush plays speech shorter than the startup cushion', () => {
  const player = playback();
  const samples = new Int16Array(240).fill(10000); // 10 ms, below the 80 ms prebuffer.
  player.port.onmessage({ data: { type: 'audio', buffer: samples.buffer } });
  const buffered = new Float32Array(128);
  player.process([], [[buffered]]);
  expect([...buffered].every((sample) => sample === 0)).toBeTruthy();
  player.port.onmessage({ data: { type: 'end' } });
  const final = new Float32Array(128);
  player.process([], [[final]]);
  expect(final.some((sample) => sample !== 0)).toBeTruthy();
});

test('playback receipts count rendered audio rather than queued bytes', () => {
  const player = playback();
  player.port.onmessage({ data: { type: 'start', itemId: 'response-a' } });
  player.port.onmessage({ data: { type: 'audio', itemId: 'response-a', buffer: new Int16Array(24000).fill(5000).buffer } });
  player.port.onmessage({ data: { type: 'end', itemId: 'response-a' } });
  expect(player.reports.filter((message) => message.type === 'playback')).toHaveLength(0);
  // 48,000 rendered output frames at 48 kHz = 1,000 ms of the 24 kHz input.
  for (let block = 0; block < 376; block++) player.process([], [[new Float32Array(128)]]);
  const receipts = player.reports.filter((message) => message.type === 'playback');
  expect(receipts.at(-1)).toMatchObject({ itemId: 'response-a', playedMs: 1000, final: true });
  expect(receipts.every((message) => message.playedMs <= 1000)).toBeTruthy();
});
