'use strict';

const { EventEmitter } = require('node:events');
const { readFile } = require('node:fs/promises');

/**
 * Deterministic source for testing the overlay before CFB27 is open.
 * Emits raw recognition observations, including deliberately repeated frames,
 * so the production state validator is exercised in demo mode too.
 */
class MockScoreboardSource extends EventEmitter {
  constructor(sequence, options = {}) {
    super();
    this.sequence = Array.isArray(sequence) ? sequence : [];
    this.intervalMs = options.intervalMs ?? 500;
    this.loop = options.loop ?? true;
    this.index = 0;
    this.timer = null;
  }

  static async fromFile(path, options = {}) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    return new MockScoreboardSource(data.frames || data, { ...data.options, ...options });
  }

  next() {
    if (this.sequence.length === 0) return null;
    if (this.index >= this.sequence.length) {
      if (!this.loop) {
        this.stop();
        this.emit('end');
        return null;
      }
      this.index = 0;
    }
    const frame = structuredClone(this.sequence[this.index]);
    this.index += 1;
    frame.timestampMs = Date.now();
    this.emit('observation', frame);
    return frame;
  }

  start() {
    if (this.timer) return;
    this.next();
    this.timer = setInterval(() => this.next(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  reset() {
    this.index = 0;
  }
}

module.exports = { MockScoreboardSource };
