import { describe, expect, it } from 'vitest';
import { windowAt, type WindowBox } from './target';

const box = (id: number, left: number, focused = false, minimized = false): WindowBox => ({
  id,
  left,
  top: 0,
  width: 800,
  height: 600,
  focused,
  minimized,
});

describe('windowAt', () => {
  it('picks the focused window when several cover the point', () => {
    expect(windowAt([box(1, 0), box(2, 100, true)], { x: 400, y: 300 })?.id).toBe(2);
  });

  it('falls back to any window that covers the point', () => {
    expect(windowAt([box(1, 0), box(2, 900, true)], { x: 400, y: 300 })?.id).toBe(1);
  });

  it('ignores minimized windows and points outside every window', () => {
    expect(windowAt([box(1, 0, true, true)], { x: 400, y: 300 })).toBeNull();
    expect(windowAt([box(1, 0)], { x: 900, y: 300 })).toBeNull();
  });
});
