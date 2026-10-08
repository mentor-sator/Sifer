import { describe, expect, it } from 'vitest';
import { isReadOutcome, isReadReply, isReadRequest } from './protocol';

describe('isReadRequest', () => {
  it('accepts a positive id and integer coordinates', () => {
    expect(isReadRequest({ id: 1, x: -20, y: 400 })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isReadRequest({ id: 0, x: 1, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, x: 1.5, y: 1 })).toBe(false);
    expect(isReadRequest({ id: 1, x: 1 })).toBe(false);
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

  it('checks the reply id', () => {
    expect(isReadReply({ id: 3, outcome: { ok: false, reason: 'nothing' } })).toBe(true);
    expect(isReadReply({ id: -3, outcome: { ok: false, reason: 'nothing' } })).toBe(false);
  });
});
