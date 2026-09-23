export const frameInterval = 16;

export interface Point {
  x: number;
  y: number;
}

export interface Area extends Point {
  width: number;
  height: number;
}

export interface DragDependencies {
  cursor: () => Point;
  position: () => Point;
  size: () => { width: number; height: number };
  workArea: () => Area;
  move: (x: number, y: number) => void;
  start: (tick: () => void) => unknown;
  stop: (handle: unknown) => void;
}

export function grabOffset(cursor: Point, position: Point): Point {
  return { x: cursor.x - position.x, y: cursor.y - position.y };
}

export function clampToArea(
  point: Point,
  size: { width: number; height: number },
  area: Area,
): Point {
  const maxX = area.x + Math.max(area.width - size.width, 0);
  const maxY = area.y + Math.max(area.height - size.height, 0);
  return {
    x: Math.round(Math.min(Math.max(point.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(point.y, area.y), maxY)),
  };
}

export function createDrag(dependencies: DragDependencies) {
  let handle: unknown = null;
  let offset: Point = { x: 0, y: 0 };
  let last: Point | null = null;

  const tick = (): void => {
    const cursor = dependencies.cursor();
    const target = clampToArea(
      { x: cursor.x - offset.x, y: cursor.y - offset.y },
      dependencies.size(),
      dependencies.workArea(),
    );
    if (last && last.x === target.x && last.y === target.y) {
      return;
    }
    last = target;
    dependencies.move(target.x, target.y);
  };

  return {
    begin(): void {
      if (handle !== null) {
        return;
      }
      offset = grabOffset(dependencies.cursor(), dependencies.position());
      last = null;
      handle = dependencies.start(tick);
    },
    end(): void {
      if (handle === null) {
        return;
      }
      dependencies.stop(handle);
      handle = null;
    },
    get dragging(): boolean {
      return handle !== null;
    },
  };
}
