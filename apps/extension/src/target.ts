import type { ScreenPoint } from './protocol';

export interface WindowBox {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly focused: boolean;
  readonly minimized: boolean;
}

export function windowAt(windows: readonly WindowBox[], point: ScreenPoint): WindowBox | null {
  const containing = windows.filter(
    (candidate) =>
      !candidate.minimized &&
      point.x >= candidate.left &&
      point.x < candidate.left + candidate.width &&
      point.y >= candidate.top &&
      point.y < candidate.top + candidate.height,
  );
  return containing.find((candidate) => candidate.focused) ?? containing[0] ?? null;
}
