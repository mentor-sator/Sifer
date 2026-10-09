import type { ScreenPoint } from './protocol';

export interface WindowMetrics {
  readonly screenX: number;
  readonly screenY: number;
  readonly outerWidth: number;
  readonly outerHeight: number;
  readonly innerWidth: number;
  readonly innerHeight: number;
}

export interface PointerSample {
  readonly screenX: number;
  readonly screenY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly windowX: number;
  readonly windowY: number;
}

export interface ClientPoint {
  readonly x: number;
  readonly y: number;
}

export function viewportOrigin(
  metrics: WindowMetrics,
  zoom: number,
  sample: PointerSample | null,
): ScreenPoint {
  if (sample) {
    return {
      x: metrics.screenX + (sample.screenX - sample.clientX * zoom - sample.windowX),
      y: metrics.screenY + (sample.screenY - sample.clientY * zoom - sample.windowY),
    };
  }
  const border = Math.max(0, (metrics.outerWidth - metrics.innerWidth * zoom) / 2);
  return {
    x: metrics.screenX + border,
    y: metrics.screenY + Math.max(0, metrics.outerHeight - metrics.innerHeight * zoom - border),
  };
}

export function toClientPoint(
  screen: ScreenPoint,
  metrics: WindowMetrics,
  zoom: number,
  sample: PointerSample | null,
): ClientPoint | null {
  const origin = viewportOrigin(metrics, zoom, sample);
  const x = (screen.x - origin.x) / zoom;
  const y = (screen.y - origin.y) / zoom;
  if (x < 0 || y < 0 || x >= metrics.innerWidth || y >= metrics.innerHeight) {
    return null;
  }
  return { x, y };
}
