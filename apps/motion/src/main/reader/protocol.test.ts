import { describe, expect, it } from 'vitest';
import { isReaderReply, isReadOutcome, isReadRequest } from './protocol';

describe('isReadRequest', () => {
  it('accepts a positive id, a known operation and integer coordinates', () => {
    expect(isReadRequest({ id: 1, op: 'read', x: -20, y: 400 })).toBe(true);
    expect(isReadRequest({ id: 2, op: 'app', x: 0, y: 0 })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isReadRequest({ id: 0, op: 'read', x: 1, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, op: 'read', x: 1.5, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, op: 'type', x: 1, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, x: 1, y: 1 })).toBe(false);
    expect(isReadRequest(null)).toBe(false);
  });
});

describe('isReadOutcome', () => {
  it('accepts readings and known failures', () => {
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'accessibility', kind: 'name', control: 'Button', text: 'Save' },
      }),
    ).toBe(true);
    expect(isReadOutcome({ ok: false, reason: 'protected' })).toBe(true);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'dom', kind: 'value', control: 'Field', text: 'Kigali' },
      }),
    ).toBe(true);
  });

  it('rejects unknown kinds, sources and reasons', () => {
    expect(isReadOutcome({ ok: false, reason: 'other' })).toBe(false);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'clipboard', kind: 'text', control: 'Text', text: 'x' },
      }),
    ).toBe(false);
    expect(
      isReadOutcome({
        ok: true,
        reading: { source: 'accessibility', kind: 'html', control: 'Text', text: 'x' },
      }),
    ).toBe(false);
  });
});

describe('isReaderReply', () => {
  it('accepts readings and process names', () => {
    expect(isReaderReply({ id: 3, outcome: { ok: false, reason: 'nothing' } })).toBe(true);
    expect(isReaderReply({ id: 4, app: 'chrome.exe' })).toBe(true);
    expect(isReaderReply({ id: 5, app: null })).toBe(true);
  });

  it('rejects malformed replies', () => {
    expect(isReaderReply({ id: -3, outcome: { ok: false, reason: 'nothing' } })).toBe(false);
    expect(isReaderReply({ id: 3, outcome: { ok: true } })).toBe(false);
    expect(isReaderReply({ id: 3, app: 7 })).toBe(false);
    expect(isReaderReply({ id: 3 })).toBe(false);
  });
});
