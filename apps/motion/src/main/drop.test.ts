import { describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../shared/bridge';
import { createDropReader, dropPoint, hideDelay } from './drop';

const reading: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'Hello' },
};

function harness(read: () => Promise<ReadOutcome>) {
  const steps: string[] = [];
  const reader = createDropReader({
    hide: () => steps.push('hide'),
    restore: () => steps.push('restore'),
    wait: async (milliseconds) => {
      steps.push(`wait ${milliseconds}`);
    },
    read: async (point) => {
      steps.push(`read ${point.x},${point.y}`);
      return read();
    },
  });
  return { reader, steps };
}

describe('dropPoint', () => {
  it('is the centre of the orb', () => {
    expect(dropPoint({ x: 100, y: 200, width: 72, height: 72 })).toEqual({ x: 136, y: 236 });
  });
});

describe('createDropReader', () => {
  it('hides, waits one frame plus 50 ms, reads, then restores', async () => {
    const { reader, steps } = harness(async () => reading);
    await expect(reader.read({ x: 5, y: 6 })).resolves.toEqual(reading);
    expect(hideDelay).toBe(66);
    expect(steps).toEqual(['hide', 'wait 66', 'read 5,6', 'restore']);
  });

  it('restores the orb and reports failure when the read throws', async () => {
    const { reader, steps } = harness(() => Promise.reject(new Error('boom')));
    await expect(reader.read({ x: 1, y: 1 })).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(steps.at(-1)).toBe('restore');
    expect(reader.busy).toBe(false);
  });

  it('ignores a second drop while one is being read', async () => {
    let finish: (outcome: ReadOutcome) => void = () => undefined;
    const pending = new Promise<ReadOutcome>((resolve) => {
      finish = resolve;
    });
    const read = vi.fn(() => pending);
    const { reader } = harness(read);
    const first = reader.read({ x: 1, y: 1 });
    expect(reader.busy).toBe(true);
    await expect(reader.read({ x: 2, y: 2 })).resolves.toBeNull();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    finish(reading);
    await expect(first).resolves.toEqual(reading);
    expect(reader.busy).toBe(false);
  });
});
