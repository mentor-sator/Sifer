import { describe, expect, it } from 'vitest';
import { toClientPoint, viewportOrigin, type WindowMetrics } from './locate';

const maximized: WindowMetrics = {
  screenX: -8,
  screenY: -8,
  outerWidth: 1552,
  outerHeight: 840,
  innerWidth: 1536,
  innerHeight: 735,
};

describe('viewportOrigin', () => {
  it('estimates the toolbar height and side border without a pointer sample', () => {
    expect(viewportOrigin(maximized, 1, null)).toEqual({ x: 0, y: 89 });
  });

  it('uses a pointer sample when it has one, wherever the window moved since', () => {
    const sample = {
      screenX: 500,
      screenY: 400,
      clientX: 500,
      clientY: 315,
      windowX: -8,
      windowY: -8,
    };
    expect(viewportOrigin(maximized, 1, sample)).toEqual({ x: 0, y: 85 });
    expect(viewportOrigin({ ...maximized, screenX: 192, screenY: 92 }, 1, sample)).toEqual({
      x: 200,
      y: 185,
    });
  });

  it('accounts for page zoom', () => {
    const sample = {
      screenX: 600,
      screenY: 475,
      clientX: 400,
      clientY: 260,
      windowX: -8,
      windowY: -8,
    };
    expect(viewportOrigin(maximized, 1.5, sample)).toEqual({ x: 0, y: 85 });
  });
});

describe('toClientPoint', () => {
  const sample = { screenX: 0, screenY: 85, clientX: 0, clientY: 0, windowX: -8, windowY: -8 };

  it('maps a screen point into the page', () => {
    expect(toClientPoint({ x: 300, y: 285 }, maximized, 1, sample)).toEqual({ x: 300, y: 200 });
    expect(toClientPoint({ x: 300, y: 285 }, maximized, 2, sample)).toEqual({ x: 150, y: 100 });
  });

  it('refuses a point on the tab strip or outside the page', () => {
    expect(toClientPoint({ x: 300, y: 40 }, maximized, 1, sample)).toBeNull();
    expect(toClientPoint({ x: 1600, y: 300 }, maximized, 1, sample)).toBeNull();
    expect(toClientPoint({ x: 300, y: 900 }, maximized, 1, sample)).toBeNull();
  });
});
