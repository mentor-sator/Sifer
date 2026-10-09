import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';

export const browserProcesses: ReadonlySet<string> = new Set([
  'chrome.exe',
  'msedge.exe',
  'brave.exe',
]);

export interface ChainDependencies {
  app(physical: Point): Promise<string | null>;
  extensionConnected(): boolean;
  dom(dip: Point): Promise<ReadOutcome | null>;
  accessibility(physical: Point): Promise<ReadOutcome>;
}

export function createReadChain(dependencies: ChainDependencies) {
  return async (dip: Point, physical: Point): Promise<ReadOutcome> => {
    if (dependencies.extensionConnected()) {
      const app = await dependencies.app(physical);
      if (app !== null && browserProcesses.has(app)) {
        const outcome = await dependencies.dom(dip);
        if (outcome && (outcome.ok || outcome.reason === 'protected')) {
          return outcome;
        }
      }
    }
    return dependencies.accessibility(physical);
  };
}
