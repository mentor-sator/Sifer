import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import type { OrbState, SignedInState } from '../shared/bridge';
import { hardenedWebPreferences } from './security';

export const orbSize = 72;
export const orbMargin = 24;

export function orbWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: orbSize,
    height: orbSize,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    title: 'Sifer',
    webPreferences: hardenedWebPreferences(preload),
  };
}

export function orbRestingPlace(
  workArea: Rectangle,
  size = orbSize,
  margin = orbMargin,
): { x: number; y: number } {
  const x = workArea.x + Math.max(workArea.width - size - margin, 0);
  const y = workArea.y + Math.max(workArea.height - size - margin, 0);
  return { x: Math.round(x), y: Math.round(y) };
}

export type Activity = 'idle' | 'reading';

export function orbStateFor(session: SignedInState, activity: Activity): OrbState {
  if (session.status !== 'signed-in') {
    return 'signed-out';
  }
  return activity;
}
