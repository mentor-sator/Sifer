import type { ScreenPoint } from './protocol';

export interface WindowBox {
  readonly id: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly focused: boolean;
  readonly minimized: boolean;
  readonly tabId: number;
  readonly tabTitle: string;
}

function contains(window: WindowBox, point: ScreenPoint): boolean {
  return (
    !window.minimized &&
    point.x >= window.left &&
    point.x < window.left + window.width &&
    point.y >= window.top &&
    point.y < window.top + window.height
  );
}

export function windowAt(
  windows: readonly WindowBox[],
  point: ScreenPoint,
  title: string,
): WindowBox | null {
  const matching = windows.filter(
    (candidate) =>
      contains(candidate, point) &&
      candidate.tabTitle !== '' &&
      title.startsWith(candidate.tabTitle),
  );
  return matching.find((candidate) => candidate.focused) ?? matching[0] ?? null;
}
