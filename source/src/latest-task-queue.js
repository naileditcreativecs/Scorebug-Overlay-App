'use strict';

/** Serialize lifecycle mutations while letting stale requests retire themselves. */
class LatestTaskQueue {
  constructor() {
    this.revision = 0;
    this.tail = Promise.resolve();
  }

  run(task) {
    if (typeof task !== 'function') throw new TypeError('task must be a function');
    const revision = ++this.revision;
    const context = {
      revision,
      isCurrent: () => revision === this.revision,
    };
    const execute = () => task(context);
    const result = this.tail.then(execute, execute);
    this.tail = result.catch(() => {});
    return result;
  }

  invalidate() {
    this.revision += 1;
    return this.revision;
  }

  whenIdle() {
    return this.tail;
  }
}

module.exports = { LatestTaskQueue };
