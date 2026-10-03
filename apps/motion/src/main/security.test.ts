import { describe, expect, it } from 'vitest';
import { hardenedWebPreferences, isAllowedNavigation } from './security';

describe('hardenedWebPreferences', () => {
  it('isolates the renderer from Node and the preload', () => {
    const preferences = hardenedWebPreferences('/app/preload.cjs');
    expect(preferences).toMatchObject({
      preload: '/app/preload.cjs',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });
});

describe('isAllowedNavigation', () => {
  const devServer = 'http://localhost:5173/';

  it('allows only the dev server origin during development', () => {
    expect(isAllowedNavigation('http://localhost:5173/settings', devServer)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/', devServer)).toBe(false);
    expect(isAllowedNavigation('https://example.com/', devServer)).toBe(false);
    expect(isAllowedNavigation('file:///C:/Windows/System32/', devServer)).toBe(false);
  });

  it('allows nothing in a packaged build', () => {
    expect(isAllowedNavigation('http://localhost:5173/', undefined)).toBe(false);
    expect(isAllowedNavigation('file:///app/index.html', undefined)).toBe(false);
  });

  it('refuses malformed targets', () => {
    expect(isAllowedNavigation('not a url', devServer)).toBe(false);
  });
});
