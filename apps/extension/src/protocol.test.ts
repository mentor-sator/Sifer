import { describe, expect, it } from 'vitest';
import { isPageReadRequest, isPopupRequest, isToken, parseMotionMessage } from './protocol';

const token = 'T'.repeat(43);

describe('parseMotionMessage', () => {
  it('reads the three messages Motion sends', () => {
    expect(parseMotionMessage(`{"type":"paired","token":"${token}"}`)).toEqual({
      type: 'paired',
      token,
    });
    expect(parseMotionMessage('{"type":"pair-refused"}')).toEqual({ type: 'pair-refused' });
    expect(parseMotionMessage('{"type":"read","id":3,"x":10.5,"y":-4}')).toEqual({
      type: 'read',
      id: 3,
      x: 10.5,
      y: -4,
    });
  });

  it('drops anything else', () => {
    expect(parseMotionMessage(new ArrayBuffer(4))).toBeNull();
    expect(parseMotionMessage('nonsense')).toBeNull();
    expect(parseMotionMessage('{"type":"paired","token":"short"}')).toBeNull();
    expect(parseMotionMessage('{"type":"read","id":1.5,"x":1,"y":1}')).toBeNull();
    expect(parseMotionMessage('{"type":"eval","code":"alert(1)"}')).toBeNull();
  });
});

describe('guards', () => {
  it('accepts only well formed page reads and popup requests', () => {
    expect(isPageReadRequest({ type: 'sifer.read', x: 1, y: 2, zoom: 1.25 })).toBe(true);
    expect(isPageReadRequest({ type: 'sifer.read', x: 1, y: 2, zoom: 0 })).toBe(false);
    expect(isPopupRequest({ type: 'sifer.pair' })).toBe(true);
    expect(isPopupRequest({ type: 'sifer.reset' })).toBe(false);
    expect(isToken(token)).toBe(true);
    expect(isToken(`${token}!`)).toBe(false);
  });
});
