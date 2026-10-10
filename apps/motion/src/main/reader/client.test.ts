import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { appTimeout, createReaderClient, readTimeout } from './client';
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

  const worker = (index = 0): FakeWorker => {
    const found = workers[index];
    if (!found) {
      throw new Error(`no worker ${index}`);
    }
    return found;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    client = createReaderClient({
      spawn: () => {
        const created = new FakeWorker();
        workers.push(created);
        return created;
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
    expect(worker().sent).toEqual([
      { id: 1, op: 'read', x: 1, y: 3 },
      { id: 2, op: 'read', x: 3, y: 4 },
    ]);
    worker().reply(2, { ok: false, reason: 'nothing' });
    worker().reply(1, reading);
    await expect(first).resolves.toEqual(reading);
    await expect(second).resolves.toEqual({ ok: false, reason: 'nothing' });
  });

  it('asks which app is under a point', async () => {
    const app = client.app({ x: 10, y: 20 });
    expect(worker().sent).toEqual([{ id: 1, op: 'app', x: 10, y: 20 }]);
    worker().emit('message', {
      id: 1,
      app: { process: 'chrome.exe', title: 'Inbox - Google Chrome' },
    });
    await expect(app).resolves.toEqual({ process: 'chrome.exe', title: 'Inbox - Google Chrome' });
  });

  it('gives up on the app question quickly but keeps the reader running', async () => {
    const app = client.app({ x: 0, y: 0 });
    vi.advanceTimersByTime(appTimeout);
    await expect(app).resolves.toBeNull();
    expect(worker().terminated).toBe(false);
    const read = client.read({ x: 0, y: 0 });
    expect(workers).toHaveLength(1);
    worker().reply(2, reading);
    await expect(read).resolves.toEqual(reading);
  });

  it('ignores malformed replies', async () => {
    const read = client.read({ x: 0, y: 0 });
    worker().emit('message', { id: 1, outcome: { ok: true } });
    worker().emit('message', 'noise');
    worker().reply(1, reading);
    await expect(read).resolves.toEqual(reading);
  });

  it('times out, terminates a stuck worker and starts a fresh one', async () => {
    const stuck = client.read({ x: 0, y: 0 });
    vi.advanceTimersByTime(readTimeout);
    await expect(stuck).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(worker().terminated).toBe(true);
    worker().reply(1, reading);
    const next = client.read({ x: 0, y: 0 });
    expect(workers).toHaveLength(2);
    expect(worker(1).sent).toEqual([{ id: 2, op: 'read', x: 0, y: 0 }]);
    worker(1).reply(2, reading);
    await expect(next).resolves.toEqual(reading);
  });

  it('fails pending reads when the reader process exits', async () => {
    const read = client.read({ x: 0, y: 0 });
    worker().emit('exit', 1);
    await expect(read).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes the worker', () => {
    void client.read({ x: 0, y: 0 });
    client.close();
    expect(worker().terminated).toBe(true);
  });
});
