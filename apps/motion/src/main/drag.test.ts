import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clampToArea, createDrag, frameInterval, grabOffset, type Area, type Point } from './drag';

const workArea: Area = { x: 0, y: 0, width: 1280, height: 720 };
const size = { width: 72, height: 72 };

describe('grabOffset', () => {
  it('remembers where inside the orb the pointer went down', () => {
    expect(grabOffset({ x: 1200, y: 650 }, { x: 1184, y: 624 })).toEqual({ x: 16, y: 26 });
  });
});

describe('clampToArea', () => {
  it('keeps the whole orb inside the work area', () => {
    expect(clampToArea({ x: 640, y: 360 }, size, workArea)).toEqual({ x: 640, y: 360 });
    expect(clampToArea({ x: -50, y: -50 }, size, workArea)).toEqual({ x: 0, y: 0 });
    expect(clampToArea({ x: 5000, y: 5000 }, size, workArea)).toEqual({ x: 1208, y: 648 });
  });

  it('respects a display that does not start at zero', () => {
    const second: Area = { x: 1280, y: -200, width: 1920, height: 1080 };
    expect(clampToArea({ x: 0, y: 0 }, size, second)).toEqual({ x: 1280, y: 0 });
    expect(clampToArea({ x: 1000, y: -900 }, size, second)).toEqual({ x: 1280, y: -200 });
    expect(clampToArea({ x: 9999, y: 9999 }, size, second)).toEqual({ x: 3128, y: 808 });
  });

  it('rounds to whole pixels', () => {
    expect(clampToArea({ x: 100.6, y: 200.4 }, size, workArea)).toEqual({ x: 101, y: 200 });
  });
});

describe('createDrag', () => {
  let cursor: Point;
  let position: Point;
  let ticks: Array<() => void>;
  let moves: Point[];
  let stopped: number;

  const drag = () =>
    createDrag({
      cursor: () => cursor,
      position: () => position,
      size: () => size,
      workArea: () => workArea,
      move: (x, y) => {
        moves.push({ x, y });
        position = { x, y };
      },
      start: (tick) => {
        ticks.push(tick);
        return ticks.length;
      },
      stop: () => {
        stopped += 1;
      },
    });

  const runTick = (index = ticks.length - 1) => {
    const tick = ticks[index];
    if (!tick) {
      throw new Error(`no tick registered at ${index}`);
    }
    tick();
  };

  beforeEach(() => {
    cursor = { x: 1200, y: 650 };
    position = { x: 1184, y: 624 };
    ticks = [];
    moves = [];
    stopped = 0;
  });

  it('moves the orb so the grabbed point stays under the pointer', () => {
    const dragging = drag();
    dragging.begin();
    cursor = { x: 400, y: 300 };
    runTick(0);
    expect(moves).toEqual([{ x: 384, y: 274 }]);
    cursor = { x: 402, y: 301 };
    runTick(0);
    expect(moves.at(-1)).toEqual({ x: 386, y: 275 });
  });

  it('does not move the window when the cursor has not moved', () => {
    const dragging = drag();
    dragging.begin();
    runTick(0);
    runTick(0);
    runTick(0);
    expect(moves).toHaveLength(1);
  });

  it('never leaves the work area', () => {
    const dragging = drag();
    dragging.begin();
    cursor = { x: -500, y: -500 };
    runTick(0);
    expect(moves.at(-1)).toEqual({ x: 0, y: 0 });
    cursor = { x: 9999, y: 9999 };
    runTick(0);
    expect(moves.at(-1)).toEqual({ x: 1208, y: 648 });
  });

  it('ignores a second begin and stops exactly once', () => {
    const dragging = drag();
    dragging.begin();
    dragging.begin();
    expect(ticks).toHaveLength(1);
    expect(dragging.dragging).toBe(true);
    dragging.end();
    dragging.end();
    expect(stopped).toBe(1);
    expect(dragging.dragging).toBe(false);
  });

  it('stops moving the orb after the drag ends', () => {
    const dragging = drag();
    dragging.begin();
    dragging.end();
    cursor = { x: 10, y: 10 };
    expect(moves).toHaveLength(0);
  });

  it('starts a fresh grab each time', () => {
    const dragging = drag();
    dragging.begin();
    cursor = { x: 500, y: 500 };
    runTick(0);
    dragging.end();
    cursor = { x: 600, y: 520 };
    dragging.begin();
    cursor = { x: 640, y: 560 };
    runTick(1);
    expect(moves.at(-1)).toEqual({ x: 524, y: 514 });
  });

  it('runs at 60 Hz when wired to a timer', () => {
    vi.useFakeTimers();
    const moved: Point[] = [];
    const dragging = createDrag({
      cursor: () => cursor,
      position: () => position,
      size: () => size,
      workArea: () => workArea,
      move: (x, y) => moved.push({ x, y }),
      start: (tick) => setInterval(tick, frameInterval),
      stop: (handle) => clearInterval(handle as NodeJS.Timeout),
    });
    dragging.begin();
    for (let frame = 1; frame <= 60; frame += 1) {
      cursor = { x: 1200 - frame, y: 650 - frame };
      vi.advanceTimersByTime(frameInterval);
    }
    dragging.end();
    vi.useRealTimers();
    expect(moved).toHaveLength(60);
    expect(frameInterval).toBeLessThanOrEqual(1000 / 60);
  });
});
