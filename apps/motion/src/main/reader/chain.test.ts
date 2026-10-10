import { describe, expect, it, vi } from 'vitest';
import type { ReadOutcome } from '../../shared/bridge';
import { createReadChain } from './chain';
import type { WindowInfo } from './protocol';

const fromPage: ReadOutcome = {
  ok: true,
  reading: { source: 'dom', kind: 'text', control: 'Heading', text: 'Changelog' },
};
const fromAccessibility: ReadOutcome = {
  ok: true,
  reading: { source: 'accessibility', kind: 'text', control: 'Document', text: 'Changelog' },
};
const fromScreenshot: ReadOutcome = {
  ok: true,
  reading: { source: 'screenshot', kind: 'text', control: 'Screen', text: 'const total = 3;' },
};

const dip = { x: 100, y: 200 };
const physical = { x: 125, y: 250 };

const chromePage: WindowInfo = { process: 'chrome.exe', title: 'Changelog - Google Chrome' };
const edgePage: WindowInfo = { process: 'msedge.exe', title: 'Changelog - Microsoft Edge' };
const word: WindowInfo = { process: 'winword.exe', title: 'Report.docx - Word' };
const code: WindowInfo = { process: 'code.exe', title: 'main.ts - Sifer - Visual Studio Code' };

function chain(options: {
  app?: WindowInfo | null;
  browser?: string | null;
  dom?: ReadOutcome | null;
  accessibility?: ReadOutcome;
  screenshot?: ReadOutcome;
}) {
  const calls = {
    app: vi.fn(async () => options.app ?? null),
    dom: vi.fn(async () => (options.dom === undefined ? fromPage : options.dom)),
    accessibility: vi.fn(async () => options.accessibility ?? fromAccessibility),
    screenshot: vi.fn(async () => options.screenshot ?? fromScreenshot),
  };
  const read = createReadChain({
    app: calls.app,
    extensionBrowser: () => (options.browser === undefined ? 'Chrome' : options.browser),
    dom: calls.dom,
    accessibility: calls.accessibility,
    screenshot: calls.screenshot,
  });
  return { read, calls };
}

describe('createReadChain', () => {
  it('asks the extension first when the orb is on its own browser', async () => {
    const { read, calls } = chain({ app: chromePage });
    await expect(read(dip, physical)).resolves.toBe(fromPage);
    expect(calls.app).toHaveBeenCalledWith(physical);
    expect(calls.dom).toHaveBeenCalledWith(dip, 'Changelog - Google Chrome');
    expect(calls.accessibility).not.toHaveBeenCalled();
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('keeps a protected answer from the page', async () => {
    const { read, calls } = chain({
      app: edgePage,
      browser: 'Edge',
      dom: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.accessibility).not.toHaveBeenCalled();
  });

  it('looks at the screen first for a browser window the page did not answer for', async () => {
    for (const dom of [{ ok: false, reason: 'nothing' } as const, null]) {
      const { read, calls } = chain({ app: chromePage, dom });
      await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
      expect(calls.accessibility).toHaveBeenCalledWith(physical);
    }
  });

  it('uses the text from a browser window when the screen shows nothing readable', async () => {
    const { read } = chain({
      app: { process: 'msedge.exe', title: 'Netflix' },
      screenshot: { ok: false, reason: 'nothing' },
    });
    await expect(read(dip, physical)).resolves.toBe(fromAccessibility);
  });

  it('never photographs a protected field in a browser window', async () => {
    const { read, calls } = chain({
      app: { process: 'msedge.exe', title: 'Bank' },
      dom: null,
      accessibility: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('uses accessibility directly for other apps or without the extension', async () => {
    const other = chain({ app: word });
    await expect(other.read(dip, physical)).resolves.toBe(fromAccessibility);
    expect(other.calls.dom).not.toHaveBeenCalled();
    const offline = chain({ app: chromePage, browser: null });
    await offline.read(dip, physical);
    expect(offline.calls.dom).not.toHaveBeenCalled();
  });

  it('never asks the extension about a window of another browser', async () => {
    const edgeApp = chain({ app: { process: 'msedge.exe', title: 'Netflix' } });
    await edgeApp.read(dip, physical);
    expect(edgeApp.calls.dom).not.toHaveBeenCalled();
    const chromeFromEdge = chain({ app: chromePage, browser: 'Edge' });
    await chromeFromEdge.read(dip, physical);
    expect(chromeFromEdge.calls.dom).not.toHaveBeenCalled();
  });

  it('skips the extension for a browser window without a title', async () => {
    const { read, calls } = chain({ app: { process: 'chrome.exe', title: '' } });
    await read(dip, physical);
    expect(calls.dom).not.toHaveBeenCalled();
  });

  it('takes a screenshot when accessibility finds nothing or fails', async () => {
    for (const reason of ['nothing', 'timeout', 'failed', 'unsupported'] as const) {
      const { read, calls } = chain({ app: code, accessibility: { ok: false, reason } });
      await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
      expect(calls.screenshot).toHaveBeenCalledWith(dip);
    }
  });

  it('never takes a screenshot of a protected field', async () => {
    const { read, calls } = chain({
      app: word,
      accessibility: { ok: false, reason: 'protected' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'protected' });
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('never shows the bare name of a container, which can hold a whole page', async () => {
    const name: ReadOutcome = {
      ok: true,
      reading: { source: 'accessibility', kind: 'name', control: 'Edit', text: 'Editor content' },
    };
    const { read } = chain({ app: code, accessibility: name });
    await expect(read(dip, physical)).resolves.toBe(fromScreenshot);
    const fallback = chain({
      app: code,
      accessibility: name,
      screenshot: { ok: false, reason: 'nothing' },
    });
    await expect(fallback.read(dip, physical)).resolves.toEqual({ ok: false, reason: 'nothing' });
  });

  it('keeps the name of a button or link', async () => {
    const button: ReadOutcome = {
      ok: true,
      reading: { source: 'accessibility', kind: 'name', control: 'Button', text: 'Save' },
    };
    const { read, calls } = chain({ app: word, accessibility: button });
    await expect(read(dip, physical)).resolves.toBe(button);
    expect(calls.screenshot).not.toHaveBeenCalled();
  });

  it('reports the accessibility failure when the screenshot also finds nothing', async () => {
    const { read } = chain({
      app: { process: 'notepad.exe', title: 'notes.txt - Notepad' },
      accessibility: { ok: false, reason: 'nothing' },
      screenshot: { ok: false, reason: 'unsupported' },
    });
    await expect(read(dip, physical)).resolves.toEqual({ ok: false, reason: 'nothing' });
  });
});
