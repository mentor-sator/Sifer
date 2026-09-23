import type { BrowserWindowConstructorOptions } from 'electron';
import { hardenedWebPreferences } from './security';

export const signInSize = { width: 400, height: 460 };

export function signInWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: signInSize.width,
    height: signInSize.height,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: 'Sign in to Sifer',
    autoHideMenuBar: true,
    backgroundColor: '#12142a',
    webPreferences: hardenedWebPreferences(preload),
  };
}
