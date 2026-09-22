import { describe, expect, it } from 'vitest';
import { describeRuntime } from './versions';

describe('describeRuntime', () => {
  it('names each runtime with its version', () => {
    expect(describeRuntime({ electron: '44.4.3', chrome: '146.0.0.0', node: '24.12.0' })).toBe(
      'Electron 44.4.3 \u00b7 Chromium 146.0.0.0 \u00b7 Node 24.12.0',
    );
  });
});
