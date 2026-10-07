import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import { isReadReply, type ReadRequest } from './protocol';

export const readTimeout = 1500;

export interface ReaderWorker {
  postMessage(request: ReadRequest): void;
  on(event: 'message' | 'error' | 'exit', listener: (value: unknown) => void): unknown;
  terminate(): unknown;
}

export interface ReaderClientDependencies {
  spawn(): ReaderWorker;
  timeout?: number;
}

export function createReaderClient(dependencies: ReaderClientDependencies) {
  const timeout = dependencies.timeout ?? readTimeout;
  const pending = new Map<number, (outcome: ReadOutcome) => void>();
  let worker: ReaderWorker | null = null;
  let nextId = 1;

  const discard = (gone: ReaderWorker, reason: 'timeout' | 'failed'): void => {
    if (worker !== gone) {
      return;
    }
    worker = null;
    void gone.terminate();
    for (const settle of [...pending.values()]) {
      settle({ ok: false, reason });
    }
  };

  const ensure = (): ReaderWorker => {
    if (worker) {
      return worker;
    }
    const created = dependencies.spawn();
    created.on('message', (reply) => {
      if (isReadReply(reply)) {
        pending.get(reply.id)?.(reply.outcome);
      }
    });
    created.on('error', () => discard(created, 'failed'));
    created.on('exit', () => discard(created, 'failed'));
    worker = created;
    return created;
  };

  return {
    read(point: Point): Promise<ReadOutcome> {
      const target = ensure();
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => discard(target, 'timeout'), timeout);
        pending.set(id, (outcome) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(outcome);
        });
        target.postMessage({ id, x: Math.round(point.x), y: Math.round(point.y) });
      });
    },
    close(): void {
      if (worker) {
        discard(worker, 'failed');
      }
    },
  };
}
