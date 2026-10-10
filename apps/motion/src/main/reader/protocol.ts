import type { ReadFailure, ReadingKind, ReadingSource, ReadOutcome } from '../../shared/bridge';

export type ReaderOperation = 'read' | 'app' | 'ocr';

export const maxImagePixels = 8_000_000;

export interface PointRequest {
  readonly id: number;
  readonly op: 'read' | 'app';
  readonly x: number;
  readonly y: number;
}

export interface OcrRequest {
  readonly id: number;
  readonly op: 'ocr';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export type ReadRequest = PointRequest | OcrRequest;

export interface WindowInfo {
  readonly process: string;
  readonly title: string;
}

export type ReaderReply =
  | { readonly id: number; readonly outcome: ReadOutcome }
  | { readonly id: number; readonly app: WindowInfo | null };

const failures: ReadonlySet<string> = new Set<ReadFailure>([
  'nothing',
  'protected',
  'unsupported',
  'timeout',
  'failed',
]);

const kinds: ReadonlySet<string> = new Set<ReadingKind>(['text', 'value', 'name']);

const sources: ReadonlySet<string> = new Set<ReadingSource>(['dom', 'accessibility', 'screenshot']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isImage(value: Record<string, unknown>): boolean {
  const width = value['width'];
  const height = value['height'];
  const pixels = value['pixels'];
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    (width as number) > 0 &&
    (height as number) > 0 &&
    (width as number) * (height as number) <= maxImagePixels &&
    pixels instanceof Uint8Array &&
    pixels.length === (width as number) * (height as number) * 4
  );
}

export function isReadRequest(value: unknown): value is ReadRequest {
  if (
    !isRecord(value) ||
    !isId(value['id']) ||
    !Number.isInteger(value['x']) ||
    !Number.isInteger(value['y'])
  ) {
    return false;
  }
  const op = value['op'];
  return op === 'read' || op === 'app' || (op === 'ocr' && isImage(value));
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
  return (
    app === null ||
    (isRecord(app) &&
      typeof app['process'] === 'string' &&
      app['process'].length <= 260 &&
      typeof app['title'] === 'string' &&
      app['title'].length <= 512)
  );
}
