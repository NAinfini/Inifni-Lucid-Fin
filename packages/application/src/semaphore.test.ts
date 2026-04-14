import { describe, expect, it } from 'vitest';
import { Semaphore } from './semaphore.js';

describe('Semaphore', () => {
  it('allows up to N concurrent executions', async () => {
    const sem = new Semaphore(2);
    const running: number[] = [];
    let maxConcurrent = 0;

    const task = async (id: number) =>
      sem.run(async () => {
        running.push(id);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        await new Promise((r) => setTimeout(r, 50));
        running.splice(running.indexOf(id), 1);
      });

    await Promise.all([task(1), task(2), task(3), task(4)]);
    expect(maxConcurrent).toBe(2);
  });

  it('returns the task result', async () => {
    const sem = new Semaphore(1);
    const result = await sem.run(async () => 42);
    expect(result).toBe(42);
  });

  it('releases on error', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('throws on invalid limit', () => {
    expect(() => new Semaphore(0)).toThrow(RangeError);
    expect(() => new Semaphore(-1)).toThrow(RangeError);
  });
});
