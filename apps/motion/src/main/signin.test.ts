import { describe, expect, it } from 'vitest';
import { signInWindowOptions } from './signin';

describe('signInWindowOptions', () => {
  const options = signInWindowOptions('/app/preload.cjs');

  it('is a small centred window the user can close', () => {
    expect(options).toMatchObject({
      width: 400,
      height: 460,
      resizable: false,
      center: true,
      show: false,
      title: 'Sign in to Sifer',
    });
    expect(options.frame).toBeUndefined();
    expect(options.alwaysOnTop).toBeUndefined();
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
