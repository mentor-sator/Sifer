import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import type { WindowInfo } from './protocol';

export const browserProcesses: Readonly<Record<string, ReadonlySet<string>>> = {
  Chrome: new Set(['chrome.exe', 'brave.exe']),
  Edge: new Set(['msedge.exe']),
};

export const containerControls: ReadonlySet<string> = new Set([
  'Custom',
  'Document',
  'Edit',
  'Element',
  'Group',
  'List',
  'Pane',
  'Table',
  'Window',
]);

export interface ChainDependencies {
  app(physical: Point): Promise<WindowInfo | null>;
  extensionBrowser(): string | null;
  dom(dip: Point, title: string): Promise<ReadOutcome | null>;
  accessibility(physical: Point): Promise<ReadOutcome>;
  screenshot(dip: Point): Promise<ReadOutcome>;
}

function settled(outcome: ReadOutcome): boolean {
  if (!outcome.ok) {
    return outcome.reason === 'protected';
  }
  return outcome.reading.kind !== 'name' || !containerControls.has(outcome.reading.control);
}

export const chromiumProcesses: ReadonlySet<string> = new Set([
  'chrome.exe',
  'msedge.exe',
  'brave.exe',
  'msedgewebview2.exe',
]);

const nothing: ReadOutcome = { ok: false, reason: 'nothing' };

export function createReadChain(dependencies: ChainDependencies) {
  return async (dip: Point, physical: Point): Promise<ReadOutcome> => {
    const window = await dependencies.app(physical);
    const browser = dependencies.extensionBrowser();
    const processes = browser === null ? undefined : browserProcesses[browser];
    if (window && window.title !== '' && processes?.has(window.process)) {
      const outcome = await dependencies.dom(dip, window.title);
      if (outcome && (outcome.ok || outcome.reason === 'protected')) {
        return outcome;
      }
    }
    const accessibility = await dependencies.accessibility(physical);
    if (!accessibility.ok && accessibility.reason === 'protected') {
      return accessibility;
    }
    const chromium = window !== null && chromiumProcesses.has(window.process);
    if (!chromium && settled(accessibility)) {
      return accessibility;
    }
    const screenshot = await dependencies.screenshot(dip);
    if (screenshot.ok) {
      return screenshot;
    }
    if (settled(accessibility)) {
      return accessibility;
    }
    return accessibility.ok ? nothing : accessibility;
  };
}
