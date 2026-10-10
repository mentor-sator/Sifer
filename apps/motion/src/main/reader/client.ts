import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import {
  isReaderReply,
  type ReaderOperation,
  type ReaderReply,
  type ReadRequest,
} from './protocol';

export const readTimeout = 1500;
export const appTimeout = 300;

export interface ReaderWorker {
  postMessage(request: ReadRequest): void;
  on(event: 'message' | 'exit', listener: (value: unknown) => void): unknown;
  terminate(): unknown;
}

export interface ReaderClientDependencies {
  spawn(): ReaderWorker;
  timeout?: number;
  appTimeout?: number;
}

type Settle = (reply: ReaderReply | null, reason: 'timeout' | 'failed') => void;

export function createReaderClient(dependencies: ReaderClientDependencies) {
  const timeouts: Record<ReaderOperation, number> = {
    read: dependencies.timeout ?? readTimeout,
    app: dependencies.appTimeout ?? appTimeout,
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
    op: ReaderOperation,
    point: Point,
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
        () => (op === 'read' ? discard(target, 'timeout') : settle(null, 'timeout')),
        timeouts[op],
      );
      pending.set(id, settle);
      target.postMessage({ id, op, x: Math.round(point.x), y: Math.round(point.y) });
    });
  };

  return {
    async read(point: Point): Promise<ReadOutcome> {
      const { reply, reason } = await request('read', point);
      return reply && 'outcome' in reply ? reply.outcome : { ok: false, reason };
    },
    async app(point: Point): Promise<string | null> {
      const { reply } = await request('app', point);
      return reply && 'app' in reply ? reply.app : null;
    },
    close(): void {
      if (worker) {
        discard(worker, 'failed');
      }
    },
  };
}

export type ReaderClient = ReturnType<typeof createReaderClient>;
