import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import {
  isReaderReply,
  type OcrRequest,
  type PointRequest,
  type ReaderOperation,
  type ReaderReply,
  type ReadRequest,
  type WindowInfo,
} from './protocol';

export const readTimeout = 1500;
export const appTimeout = 300;
export const ocrTimeout = 3000;

export interface ReaderWorker {
  postMessage(request: ReadRequest): void;
  on(event: 'message' | 'exit', listener: (value: unknown) => void): unknown;
  terminate(): unknown;
}

export interface ReaderClientDependencies {
  spawn(): ReaderWorker;
  timeout?: number;
  appTimeout?: number;
  ocrTimeout?: number;
}

export interface CapturedImage {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
  readonly point: Point;
}

type Settle = (reply: ReaderReply | null, reason: 'timeout' | 'failed') => void;

type Outgoing = Omit<PointRequest, 'id'> | Omit<OcrRequest, 'id'>;

export function createReaderClient(dependencies: ReaderClientDependencies) {
  const timeouts: Record<ReaderOperation, number> = {
    read: dependencies.timeout ?? readTimeout,
    app: dependencies.appTimeout ?? appTimeout,
    ocr: dependencies.ocrTimeout ?? ocrTimeout,
  };
  const pending = new Map<number, Settle>();
  let worker: ReaderWorker | null = null;
  let nextId = 1;

  const discard = (gone: ReaderWorker, reason: 'timeout' | 'failed'): void => {
    if (worker !== gone) {
      return;
    }
    worker = null;
    void gone.terminate();
    for (const settle of [...pending.values()]) {
      settle(null, reason);
    }
  };

  const ensure = (): ReaderWorker => {
    if (worker) {
      return worker;
    }
    const created = dependencies.spawn();
    created.on('message', (reply) => {
      if (isReaderReply(reply)) {
        pending.get(reply.id)?.(reply, 'failed');
      }
    });
    created.on('exit', () => discard(created, 'failed'));
    worker = created;
    return created;
  };

  const request = (
    outgoing: Outgoing,
  ): Promise<{ reply: ReaderReply | null; reason: 'timeout' | 'failed' }> => {
    const target = ensure();
    const id = nextId++;
    return new Promise((resolve) => {
      const settle: Settle = (reply, reason) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ reply, reason });
      };
      const timer = setTimeout(
        () => (outgoing.op === 'app' ? settle(null, 'timeout') : discard(target, 'timeout')),
        timeouts[outgoing.op],
      );
      pending.set(id, settle);
      target.postMessage({ ...outgoing, id } as ReadRequest);
    });
  };

  const outcomeOf = async (outgoing: Outgoing): Promise<ReadOutcome> => {
    const { reply, reason } = await request(outgoing);
    return reply && 'outcome' in reply ? reply.outcome : { ok: false, reason };
  };

  return {
    read(point: Point): Promise<ReadOutcome> {
      return outcomeOf({ op: 'read', x: Math.round(point.x), y: Math.round(point.y) });
    },
    async app(point: Point): Promise<WindowInfo | null> {
      const { reply } = await request({
        op: 'app',
        x: Math.round(point.x),
        y: Math.round(point.y),
      });
      return reply && 'app' in reply ? reply.app : null;
    },
    recognize(image: CapturedImage): Promise<ReadOutcome> {
      return outcomeOf({
        op: 'ocr',
        x: Math.round(image.point.x),
        y: Math.round(image.point.y),
        width: image.width,
        height: image.height,
        pixels: image.pixels,
      });
    },
    close(): void {
      if (worker) {
        discard(worker, 'failed');
      }
    },
  };
}

export type ReaderClient = ReturnType<typeof createReaderClient>;
