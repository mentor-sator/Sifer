import type { WebPreferences } from 'electron';

export function hardenedWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    spellcheck: false,
  };
}

export function isAllowedNavigation(target: string, devServerUrl: string | undefined): boolean {
  if (!devServerUrl) {
    return false;
  }
  try {
    return new URL(target).origin === new URL(devServerUrl).origin;
  } catch {
    return false;
  }
}
