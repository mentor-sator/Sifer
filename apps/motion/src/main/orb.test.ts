import { describe, expect, it } from 'vitest';
import { orbRestingPlace, orbSize, orbStateFor, orbWindowOptions } from './orb';

describe('orbWindowOptions', () => {
  const options = orbWindowOptions('/app/preload.cjs');

  it('is a 72 by 72 transparent frameless window that stays on top', () => {
    expect(options).toMatchObject({
      width: 72,
      height: 72,
      useContentSize: true,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      movable: true,
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

describe('orbRestingPlace', () => {
  it('rests near the bottom right of the work area', () => {
    expect(orbRestingPlace({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({ x: 1824, y: 944 });
  });

  it('respects a display whose work area does not start at zero', () => {
    expect(orbRestingPlace({ x: 1920, y: -200, width: 1280, height: 720 })).toEqual({
      x: 3104,
      y: 424,
    });
  });

  it('never places the orb outside a tiny work area', () => {
    expect(orbRestingPlace({ x: 0, y: 0, width: 60, height: 60 })).toEqual({ x: 0, y: 0 });
  });

  it('uses a 72 pixel orb by default', () => {
    expect(orbSize).toBe(72);
  });
});

describe('orbStateFor', () => {
  const signedIn = { status: 'signed-in', email: 'ninette@example.com' } as const;
  const signedOut = { status: 'signed-out' } as const;

  it('shows the signed-out ring until someone signs in', () => {
    expect(orbStateFor(signedOut, 'idle')).toBe('signed-out');
    expect(orbStateFor(signedOut, 'reading')).toBe('signed-out');
  });

  it('follows the activity once signed in', () => {
    expect(orbStateFor(signedIn, 'idle')).toBe('idle');
    expect(orbStateFor(signedIn, 'reading')).toBe('reading');
  });
});
