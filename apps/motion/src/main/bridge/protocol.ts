import { isReadOutcome } from '../reader/protocol';
import type { ReadOutcome } from '../../shared/bridge';

export const bridgeHost = '127.0.0.1';
export const bridgePort = 8770;
export const extensionId = 'pnfjfpdamacdolncmomebegoflehaejh';
export const extensionOrigin = `chrome-extension://${extensionId}`;
export const bridgeProtocol = 'sifer.v1';
export const pairProtocol = 'sifer.pair';
export const tokenProtocolPrefix = 'sifer.token.';

export type BridgeAccess = { kind: 'pair' } | { kind: 'session'; token: string };

export type ExtensionMessage =
  | { type: 'hello'; browser: string; version: string }
  | { type: 'keepalive' }
  | { type: 'reading'; id: number; outcome: ReadOutcome };

export type MotionMessage =
  | { type: 'paired'; token: string }
  | { type: 'pair-refused' }
  | { type: 'read'; id: number; x: number; y: number; title: string };

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function parseProtocols(header: string | undefined): BridgeAccess | null {
  const offered = (header ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (!offered.includes(bridgeProtocol)) {
    return null;
  }
  const tokens = offered.filter((value) => value.startsWith(tokenProtocolPrefix));
  const pairing = offered.includes(pairProtocol);
  if (pairing && tokens.length === 0) {
    return { kind: 'pair' };
  }
  const token = tokens[0]?.slice(tokenProtocolPrefix.length);
  if (!pairing && tokens.length === 1 && token && tokenPattern.test(token)) {
    return { kind: 'session', token };
  }
  return null;
}

export function isAllowedHost(host: string | undefined, port = bridgePort): boolean {
  return host === `${bridgeHost}:${port}` || host === `localhost:${port}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shortText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64;
}

export function parseExtensionMessage(raw: string): ExtensionMessage | null {
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
    case 'hello':
      return shortText(value['browser']) && shortText(value['version'])
        ? { type: 'hello', browser: value['browser'], version: value['version'] }
        : null;
    case 'keepalive':
      return { type: 'keepalive' };
    case 'reading':
      return Number.isSafeInteger(value['id']) && isReadOutcome(value['outcome'])
        ? { type: 'reading', id: value['id'] as number, outcome: value['outcome'] }
        : null;
    default:
      return null;
  }
}
