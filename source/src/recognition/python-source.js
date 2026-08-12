'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

/**
 * Persistent bridge to donor_reader.py. Keeping Python alive avoids paying the
 * interpreter/OpenCV startup cost on every captured frame.
 */
class PythonDonorReader extends EventEmitter {
  constructor(options = {}) {
    super();
    this.python = options.python || process.env.CFB27_PYTHON || 'python';
    this.script = options.script || path.resolve(__dirname, '../../recognition/python/donor_reader.py');
    this.config = options.config || path.resolve(__dirname, '../../recognition/profile.example.json');
    this.process = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  start() {
    if (this.process) return;
    const child = spawn(this.python, [this.script, '--stream'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        this.emit('warning', new Error(`Invalid donor-reader output: ${line}`));
        return;
      }
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        message.ok ? pending.resolve(message) : pending.reject(new Error(message.error || 'Donor read failed'));
      }
      this.emit('result', message);
    });
    child.stderr.on('data', (chunk) => this.emit('warning', new Error(String(chunk).trim())));
    child.on('error', (error) => this._close(error));
    child.on('exit', (code) => this._close(new Error(`Donor reader exited with code ${code}`)));
  }

  readFrame(framePath, options = {}) {
    this.start();
    const id = this.nextId++;
    const command = {
      id,
      frame: path.resolve(framePath),
      config: path.resolve(options.config || this.config),
      baseline: options.baseline ? path.resolve(options.baseline) : undefined,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify(command)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  stop() {
    if (!this.process) return;
    this.process.stdin.end();
    this.process.kill();
    this._close(new Error('Donor reader stopped'));
  }

  _close(error) {
    if (!this.process && this.pending.size === 0) return;
    this.process = null;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}

module.exports = { PythonDonorReader };
