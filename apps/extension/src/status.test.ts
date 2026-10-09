import { describe, expect, it } from 'vitest';
import type { Status } from './protocol';
import { isStatus, statusView } from './status';

describe('statusView', () => {
  it('offers Connect only when the user can act on it', () => {
    const statuses: Status[] = [
      'connected',
      'connecting',
      'offline',
      'unpaired',
      'pairing',
      'refused',
    ];
    expect(statuses.filter((status) => statusView(status).canPair)).toEqual([
      'offline',
      'unpaired',
      'refused',
    ]);
    expect(statusView('connected').tone).toBe('good');
  });
});

describe('isStatus', () => {
  it('accepts only known statuses', () => {
    expect(isStatus('connected')).toBe(true);
    expect(isStatus('toString')).toBe(false);
    expect(isStatus(undefined)).toBe(false);
  });
});
