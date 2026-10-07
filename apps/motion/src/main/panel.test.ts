import { describe, expect, it } from 'vitest';
import { panelPlacement, panelWindowOptions } from './panel';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const orbAt = (x: number, y: number) => ({ x, y, width: 72, height: 72 });

describe('panelWindowOptions', () => {
  const options = panelWindowOptions('/app/preload.cjs');

  it('is a 380 pixel frameless window that never takes a taskbar slot', () => {
    expect(options).toMatchObject({
      width: 380,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
    });
  });

  it('keeps the hardened web preferences', () => {
    expect(options.webPreferences).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });
});

describe('panelPlacement', () => {
  it('opens to the right of the orb, centred on it', () => {
    expect(panelPlacement(orbAt(400, 500), workArea)).toEqual({ x: 484, y: 406 });
  });

  it('flips to the left when the right edge is too close', () => {
    expect(panelPlacement(orbAt(1700, 500), workArea)).toEqual({ x: 1308, y: 406 });
  });

  it('stays inside the work area at the top and bottom', () => {
    expect(panelPlacement(orbAt(400, 0), workArea).y).toBe(0);
    expect(panelPlacement(orbAt(400, 968), workArea).y).toBe(780);
  });

  it('works on a display left of the primary one', () => {
    const left = { x: -1280, y: 0, width: 1280, height: 720 };
    expect(panelPlacement(orbAt(-100, 300), left)).toEqual({ x: -492, y: 206 });
  });

  it('clamps when neither side has room', () => {
    const narrow = { x: 0, y: 0, width: 500, height: 400 };
    expect(panelPlacement(orbAt(214, 100), narrow)).toEqual({ x: 120, y: 6 });
  });
});
