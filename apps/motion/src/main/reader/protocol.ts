import type { ReadFailure, ReadingKind, ReadOutcome } from '../../shared/bridge';

export interface ReadRequest {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface ReadReply {
  readonly id: number;
  readonly outcome: ReadOutcome;
}

const failures: ReadonlySet<string> = new Set<ReadFailure>([
  'nothing',
  'protected',
  'unsupported',
  'timeout',
  'failed',
]);

const kinds: ReadonlySet<string> = new Set<ReadingKind>(['text', 'value', 'name']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function isReadRequest(value: unknown): value is ReadRequest {
  return (
    isRecord(value) &&
    isId(value['id']) &&
    Number.isInteger(value['x']) &&
    Number.isInteger(value['y'])
  );
}

export function isReadOutcome(value: unknown): value is ReadOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value['ok'] === false) {
    return typeof value['reason'] === 'string' && failures.has(value['reason']);
  }
  const reading = value['reading'];
  return (
    value['ok'] === true &&
    isRecord(reading) &&
    reading['source'] === 'accessibility' &&
    typeof reading['kind'] === 'string' &&
    kinds.has(reading['kind']) &&
    typeof reading['control'] === 'string' &&
    typeof reading['text'] === 'string'
  );
}

export function isReadReply(value: unknown): value is ReadReply {
  return isRecord(value) && isId(value['id']) && isReadOutcome(value['outcome']);
}
