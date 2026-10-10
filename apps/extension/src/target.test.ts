import { describe, expect, it } from 'vitest';
import { windowAt, type WindowBox } from './target';

const box = (
  id: number,
  left: number,
  tabTitle: string,
  options: { focused?: boolean; minimized?: boolean } = {},
): WindowBox => ({
  id,
  left,
  top: 0,
  width: 800,
  height: 600,
  focused: options.focused ?? false,
  minimized: options.minimized ?? false,
  tabId: id * 10,
  tabTitle,
});

const point = { x: 400, y: 300 };

describe('windowAt', () => {
  it('picks the window whose page title the window under the orb shows', () => {
    const windows = [box(1, 0, 'Claude', { focused: true }), box(2, 0, 'Inbox (3)')];
    expect(windowAt(windows, point, 'Inbox (3) - Google Chrome')?.id).toBe(2);
  });

  it('prefers the focused window when two pages share a title', () => {
    const windows = [box(1, 0, 'New Tab'), box(2, 100, 'New Tab', { focused: true })];
    expect(windowAt(windows, point, 'New Tab - Google Chrome')?.id).toBe(2);
  });

  it('refuses a window of another app lying over the browser', () => {
    expect(windowAt([box(1, 0, 'Claude', { focused: true })], point, 'Netflix')).toBeNull();
  });

  it('ignores minimized windows, empty titles and points outside every window', () => {
    expect(windowAt([box(1, 0, 'Inbox', { minimized: true })], point, 'Inbox')).toBeNull();
    expect(windowAt([box(1, 0, '')], point, 'Inbox')).toBeNull();
    expect(windowAt([box(1, 0, 'Inbox')], { x: 900, y: 300 }, 'Inbox')).toBeNull();
  });
});
