import type { ReadOutcome } from '../shared/bridge';
import { frameInterval, type Point } from './drag';

export const hideSettle = 50;
export const hideDelay = frameInterval + hideSettle;

export interface DropDependencies {
  hide(): void;
  restore(): void;
  wait(milliseconds: number): Promise<void>;
  read(point: Point): Promise<ReadOutcome>;
}

export function dropPoint(orb: { x: number; y: number; width: number; height: number }): Point {
  return { x: Math.round(orb.x + orb.width / 2), y: Math.round(orb.y + orb.height / 2) };
}

export function createDropReader(dependencies: DropDependencies) {
  let busy = false;

  return {
    get busy(): boolean {
      return busy;
    },
    async read(point: Point): Promise<ReadOutcome | null> {
      if (busy) {
        return null;
      }
      busy = true;
      dependencies.hide();
      try {
        await dependencies.wait(hideDelay);
        return await dependencies.read(point);
      } catch {
        return { ok: false, reason: 'failed' };
      } finally {
        dependencies.restore();
        busy = false;
      }
    },
  };
}
