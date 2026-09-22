import type { RuntimeVersions } from '../../shared/bridge';

export function describeRuntime(versions: RuntimeVersions): string {
  return `Electron ${versions.electron} \u00b7 Chromium ${versions.chrome} \u00b7 Node ${versions.node}`;
}
