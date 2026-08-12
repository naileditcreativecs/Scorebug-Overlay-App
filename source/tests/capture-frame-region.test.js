'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { PersistentCaptureStream } = require('../src/capture-stream-controller');

class FakeTransport extends EventEmitter {
  constructor() {
    super();
    this.commands = [];
  }

  async ready() {}

  send(command) {
    this.commands.push(command);
    if (command.type === 'start') {
      queueMicrotask(() => this.emit('message', {
        type: 'started',
        epoch: command.epoch,
        attempt: command.attempt,
        sourceWidth: 1920,
        sourceHeight: 1080,
      }));
    }
    return true;
  }

  destroy() {}
}

test('a pull can request a one-frame region without changing the stream region', async () => {
  const transport = new FakeTransport();
  const stream = new PersistentCaptureStream({
    transportFactory: () => transport,
    frameTimeoutMs: 1_000,
  });
  await stream.start({
    sourceId: 'window:1:0',
    readRegion: { x: 0.4, y: 0.8, width: 0.2, height: 0.2 },
    width: 1920,
    height: 1080,
    fps: 4,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const promise = stream.captureFrame({ readRegion: { x: 0, y: 0, width: 1, height: 1 } });
  const pull = transport.commands.find((command) => command.type === 'pull-frame');
  assert.deepEqual(pull.readRegion, { x: 0, y: 0, width: 1, height: 1 });
  transport.emit('message', {
    type: 'frame',
    epoch: pull.epoch,
    attempt: pull.attempt,
    requestId: pull.requestId,
    width: 1920,
    height: 1080,
    sourceWidth: 1920,
    sourceHeight: 1080,
    bytes: Buffer.from('89504e470d0a1a0a', 'hex'),
  });
  const frame = await promise;
  assert.equal(frame.width, 1920);
  assert.equal(stream.desired.readRegion.x, 0.4);
  assert.equal(stream.desired.readRegion.y, 0.8);
  assert.equal(stream.desired.readRegion.width, 0.2);
  assert.ok(Math.abs(stream.desired.readRegion.height - 0.2) < 1e-9);
  await stream.dispose();
});
