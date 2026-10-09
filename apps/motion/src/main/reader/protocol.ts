import type { ReadFailure, ReadingKind, ReadingSource, ReadOutcome } from '../../shared/bridge';

export type ReaderOperation = 'read' | 'app';

export interface ReadRequest {
  readonly id: number;
  readonly op: ReaderOperation;
  readonly x: number;
  readonly y: number;
}

export type ReaderReply =
  | { readonly id: number; readonly outcome: ReadOutcome }
  | { readonly id: number; readonly app: string | null };

const failures: ReadonlySet<string> = new Set<ReadFailure>([
  'nothing',
  'protected',
  'unsupported',
  'timeout',
  'failed',
]);

const kinds: ReadonlySet<string> = new Set<ReadingKind>(['text', 'value', 'name']);

const sources: ReadonlySet<string> = new Set<ReadingSource>(['dom', 'accessibility']);

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
    (value['op'] === 'read' || value['op'] === 'app') &&
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
    typeof reading['source'] === 'string' &&
    sources.has(reading['source']) &&
    typeof reading['kind'] === 'string' &&
    kinds.has(reading['kind']) &&
    typeof reading['control'] === 'string' &&
    typeof reading['text'] === 'string'
  );
}

export function isReaderReply(value: unknown): value is ReaderReply {
  if (!isRecord(value) || !isId(value['id'])) {
    return false;
  }
  if ('outcome' in value) {
    return isReadOutcome(value['outcome']);
  }
  const app = value['app'];
  return app === null || (typeof app === 'string' && app.length <= 260);
}
