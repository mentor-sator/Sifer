import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { createReaderClient, readTimeout } from './client';
import type { ReadRequest } from './protocol';

class FakeWorker extends EventEmitter {
  readonly sent: ReadRequest[] = [];
  terminated = false;

  postMessage(request: ReadRequest): void {
    this.sent.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(id: number, outcome: unknown): void {
    this.emit('message', { id, outcome });
  }
}

const reading: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'value', control: 'Edit', text: 'hi' },
};

describe('createReaderClient', () => {
  let workers: FakeWorker[];
  let client: ReturnType<typeof createReaderClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    client = createReaderClient({
      spawn: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts one worker and matches replies to requests', async () => {
    const first = client.read({ x: 1.4, y: 2.6 });
    const second = client.read({ x: 3, y: 4 });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.sent).toEqual([
      { id: 1, x: 1, y: 3 },
      { id: 2, x: 3, y: 4 },
    ]);
    workers[0]!.reply(2, { ok: false, reason: 'nothing' });
    workers[0]!.reply(1, reading);
    await expect(first).resolves.toEqual(reading);
    await expect(second).resolves.toEqual({ ok: false, reason: 'nothing' });
  });

  it('ignores malformed replies', async () => {
    const read = client.read({ x: 0, y: 0 });
    workers[0]!.emit('message', { id: 1, outcome: { ok: true } });
    workers[0]!.emit('message', 'noise');
    workers[0]!.reply(1, reading);
    await expect(read).resolves.toEqual(reading);
  });

  it('times out, terminates a stuck worker and starts a fresh one', async () => {
    const stuck = client.read({ x: 0, y: 0 });
    vi.advanceTimersByTime(readTimeout);
    await expect(stuck).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.reply(1, reading);
    const next = client.read({ x: 0, y: 0 });
    expect(workers).toHaveLength(2);
    expect(workers[1]!.sent).toEqual([{ id: 2, x: 0, y: 0 }]);
    workers[1]!.reply(2, reading);
    await expect(next).resolves.toEqual(reading);
  });

  it('fails pending reads when the worker crashes', async () => {
    const read = client.read({ x: 0, y: 0 });
    workers[0]!.emit('error', new Error('crash'));
    await expect(read).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the worker', () => {
    void client.read({ x: 0, y: 0 });
    client.close();
    expect(workers[0]!.terminated).toBe(true);
  });
});
