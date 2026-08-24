/**
 * Counting semaphore for bounding concurrent async operations.
 * Usage: `await semaphore.run(() => expensiveTask())`
 */
export class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];
  private queueHead = 0;

  constructor(private readonly limit: number) {
    if (limit < 1) throw new RangeError('Semaphore limit must be >= 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.current < this.limit) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next =
      this.queueHead < this.queue.length ? this.queue[this.queueHead++] : undefined;
    if (next) {
      next();
    } else {
      this.current--;
    }
    if (this.queueHead > 1_024 && this.queueHead * 2 >= this.queue.length) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
  }
}
