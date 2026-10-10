export type ReadingKind = 'text' | 'value' | 'name';

export type ReadFailure = 'nothing' | 'protected' | 'unsupported' | 'timeout' | 'failed';

export interface Reading {
  readonly source: 'dom';
  readonly kind: ReadingKind;
  readonly control: string;
  readonly text: string;
}

export type ReadOutcome = { ok: true; reading: Reading } | { ok: false; reason: ReadFailure };

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export type MotionMessage =
  | { type: 'paired'; token: string }
  | { type: 'pair-refused' }
  | { type: 'read'; id: number; x: number; y: number; title: string };

export type ExtensionMessage =
  | { type: 'hello'; browser: string; version: string }
  | { type: 'keepalive' }
  | { type: 'reading'; id: number; outcome: ReadOutcome };

export interface PageReadRequest {
  readonly type: 'sifer.read';
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export type Status = 'connected' | 'connecting' | 'offline' | 'unpaired' | 'pairing' | 'refused';

export type PopupRequest = { type: 'sifer.status' } | { type: 'sifer.pair' };

export const bridgeUrl = 'ws://127.0.0.1:8770/';
export const bridgeProbeUrl = 'http://127.0.0.1:8770/';
export const bridgeProtocol = 'sifer.v1';
export const pairProtocol = 'sifer.pair';
export const tokenProtocolPrefix = 'sifer.token.';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const maxTitleLength = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && tokenPattern.test(value);
}

export function parseMotionMessage(raw: unknown): MotionMessage | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }
  switch (value['type']) {
    case 'paired':
      return isToken(value['token']) ? { type: 'paired', token: value['token'] } : null;
    case 'pair-refused':
      return { type: 'pair-refused' };
    case 'read':
      return Number.isSafeInteger(value['id']) &&
        Number.isFinite(value['x']) &&
        Number.isFinite(value['y']) &&
        typeof value['title'] === 'string' &&
        value['title'].length <= maxTitleLength
        ? {
            type: 'read',
            id: value['id'] as number,
            x: value['x'] as number,
            y: value['y'] as number,
            title: value['title'],
          }
        : null;
    default:
      return null;
  }
}

export function isPageReadRequest(value: unknown): value is PageReadRequest {
  return (
    isRecord(value) &&
    value['type'] === 'sifer.read' &&
    Number.isFinite(value['x']) &&
    Number.isFinite(value['y']) &&
    Number.isFinite(value['zoom']) &&
    (value['zoom'] as number) > 0
  );
}

export function isPopupRequest(value: unknown): value is PopupRequest {
  return isRecord(value) && (value['type'] === 'sifer.status' || value['type'] === 'sifer.pair');
}
