import { describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { createReadChain } from './chain';

const fromPage: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'text', control: 'Heading', text: 'Changelog' },
};
const fromAccessibility: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'Changelog' },
};

const dip = { x: 100, y: 200 };
const physical = { x: 125, y: 250 };

function chain(options: { app?: string | null; connected?: boolean; dom?: ReadOutcome | null }) {
  const calls = {
    app: vi.fn(async () => options.app ?? null),
    dom: vi.fn(async () => (options.dom === undefined ? fromPage : options.dom)),
    accessibility: vi.fn(async () => fromAccessibility),
  };
  const read = createReadChain({
    app: calls.app,
    extensionConnected: () => options.connected ?? true,
    dom: calls.dom,
    accessibility: calls.accessibility,
  });
  return { read, calls };
}

describe('createReadChain', () => {
  it('asks the extension first when the orb is on a browser', async () => {
    const { read, calls } = chain({ app: 'chrome.exe' });
    await expect(read(dip, physical)).resolves.toBe(fromPage);
    expect(calls.app).toHaveBeenCalledWith(physical);
    expect(calls.dom).toHaveBeenCalledWith(dip);
    expect(calls.accessibility).not.toHaveBeenCalled();
  });

  it('keeps a protected answer from the page', async () => {
    const { read, calls } = chain({ app: 'msedge.exe', dom: { ok: false, reason: 'protected' } });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.accessibility).not.toHaveBeenCalled();
  });

  it('falls back to accessibility when the page has nothing or does not answer', async () => {
    for (const dom of [{ ok: false, reason: 'nothing' } as const, null]) {
      const { read, calls } = chain({ app: 'chrome.exe', dom });
      await expect(read(dip, physical)).resolves.toBe(fromAccessibility);
      expect(calls.accessibility).toHaveBeenCalledWith(physical);
    }
  });

  it('uses accessibility directly for other apps or without the extension', async () => {
    const other = chain({ app: 'winword.exe' });
    await expect(other.read(dip, physical)).resolves.toBe(fromAccessibility);
    expect(other.calls.dom).not.toHaveBeenCalled();
    const offline = chain({ app: 'chrome.exe', connected: false });
    await expect(offline.read(dip, physical)).resolves.toBe(fromAccessibility);
    expect(offline.calls.app).not.toHaveBeenCalled();
  });
});
