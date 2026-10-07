import type { BrowserWindowConstructorOptions, Rectangle } from 'electron';
import { hardenedWebPreferences } from './security';

export const panelSize = { width: 380, height: 260 };
export const panelGap = 12;

export function panelWindowOptions(preload: string): BrowserWindowConstructorOptions {
  return {
    width: panelSize.width,
    height: panelSize.height,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'Sifer',
    backgroundColor: '#12142a',
    webPreferences: hardenedWebPreferences(preload),
  };
}

export function panelPlacement(
  orb: Rectangle,
  workArea: Rectangle,
  size = panelSize,
  gap = panelGap,
): { x: number; y: number } {
  const right = orb.x + orb.width + gap;
  const left = orb.x - gap - size.width;
  const workRight = workArea.x + workArea.width;
  const x = right + size.width <= workRight ? right : left >= workArea.x ? left : right;
  const y = orb.y + orb.height / 2 - size.height / 2;
  const maxX = workArea.x + Math.max(workArea.width - size.width, 0);
  const maxY = workArea.y + Math.max(workArea.height - size.height, 0);
  return {
    x: Math.round(Math.min(Math.max(x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(y, workArea.y), maxY)),
  };
}
