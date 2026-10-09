import {
  bridgeProtocol,
  bridgeUrl,
  pairProtocol,
  parseMotionMessage,
  tokenProtocolPrefix,
  type ExtensionMessage,
  type ReadOutcome,
  type ScreenPoint,
  type Status,
} from './protocol';

export const keepaliveInterval = 20_000;
export const pairTimeout = 60_000;
export const retryDelays = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface SocketHandlers {
  open(): void;
  close(code: number): void;
  message(data: unknown): void;
}

export interface TokenStorage {
  load(): Promise<string | null>;
  save(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ConnectionDependencies {
  open(url: string, protocols: string[], handlers: SocketHandlers): SocketLike;
  storage: TokenStorage;
  reachable(): Promise<boolean>;
  read(point: ScreenPoint): Promise<ReadOutcome>;
  identity: { browser: string; version: string };
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(handle: unknown): void;
  setRepeating(callback: () => void, milliseconds: number): unknown;
  clearRepeating(handle: unknown): void;
  onStatus(status: Status): void;
}

const openState = 1;

export function createConnection(dependencies: ConnectionDependencies) {
  let status: Status = 'connecting';
  let socket: SocketLike | null = null;
  let keepalive: unknown = null;
  let retry: unknown = null;
  let attempts = 0;
  let pairing: Promise<Status> | null = null;

  const setStatus = (next: Status): void => {
    if (status !== next) {
      status = next;
      dependencies.onStatus(next);
    }
  };

  const send = (target: SocketLike, message: ExtensionMessage): void => {
    if (target.readyState === openState) {
      target.send(JSON.stringify(message));
    }
  };

  const stopKeepalive = (): void => {
    if (keepalive !== null) {
      dependencies.clearRepeating(keepalive);
      keepalive = null;
    }
  };

  const cancelRetry = (): void => {
    if (retry !== null) {
      dependencies.clearTimer(retry);
      retry = null;
    }
  };

  const scheduleRetry = (): void => {
    cancelRetry();
    const delay = retryDelays[Math.min(attempts, retryDelays.length - 1)] ?? 30_000;
    attempts += 1;
    retry = dependencies.setTimer(() => {
      retry = null;
      void connect();
    }, delay);
  };

  const answer = async (target: SocketLike, id: number, point: ScreenPoint): Promise<void> => {
    let outcome: ReadOutcome;
    try {
      outcome = await dependencies.read(point);
    } catch {
      outcome = { ok: false, reason: 'failed' };
    }
    send(target, { type: 'reading', id, outcome });
  };

  async function connect(): Promise<void> {
    if (socket || pairing) {
      return;
    }
    cancelRetry();
    const token = await dependencies.storage.load();
    if (!token) {
      setStatus('unpaired');
      return;
    }
    setStatus('connecting');
    let opened = false;
    const created: SocketLike = dependencies.open(
      bridgeUrl,
      [bridgeProtocol, `${tokenProtocolPrefix}${token}`],
      {
        open: () => {
          opened = true;
          attempts = 0;
          setStatus('connected');
          send(created, { type: 'hello', ...dependencies.identity });
          stopKeepalive();
          keepalive = dependencies.setRepeating(
            () => send(created, { type: 'keepalive' }),
            keepaliveInterval,
          );
        },
        message: (data) => {
          const message = parseMotionMessage(data);
          if (message?.type === 'read') {
            void answer(created, message.id, { x: message.x, y: message.y });
          }
        },
        close: (code) => {
          if (socket !== created) {
            return;
          }
          socket = null;
          stopKeepalive();
          void afterClose(opened, code);
        },
      },
    );
    socket = created;
  }

  async function afterClose(opened: boolean, code: number): Promise<void> {
    if (code === 4001 || (!opened && (await dependencies.reachable()))) {
      await dependencies.storage.clear();
      setStatus('unpaired');
      return;
    }
    setStatus('offline');
    scheduleRetry();
  }

  function pairOnce(): Promise<Status> {
    return new Promise((resolve) => {
      let settled = false;
      let paired = false;
      const finish = (result: Status): void => {
        if (settled) {
          return;
        }
        settled = true;
        dependencies.clearTimer(timer);
        resolve(result);
      };
      const created = dependencies.open(bridgeUrl, [bridgeProtocol, pairProtocol], {
        open: () => undefined,
        message: (data) => {
          const message = parseMotionMessage(data);
          if (message?.type === 'paired') {
            paired = true;
            void dependencies.storage.save(message.token).then(() => finish('connected'));
          } else if (message?.type === 'pair-refused') {
            finish('refused');
          }
        },
        close: (code) => {
          if (!paired) {
            finish(code === 1013 || code === 1000 ? 'refused' : 'offline');
          }
        },
      });
      const timer = dependencies.setTimer(() => {
        created.close(1000, 'timeout');
        finish('refused');
      }, pairTimeout);
    });
  }

  return {
    get status(): Status {
      return status;
    },
    connect,
    async pair(): Promise<Status> {
      if (pairing) {
        return pairing;
      }
      cancelRetry();
      const current = socket;
      socket = null;
      stopKeepalive();
      current?.close(1000, 'pairing');
      setStatus('pairing');
      pairing = pairOnce();
      const result = await pairing;
      pairing = null;
      attempts = 0;
      await connect();
      return result;
    },
    ensure(): void {
      if (!socket && !pairing && status !== 'unpaired') {
        void connect();
      }
    },
  };
}

export type Connection = ReturnType<typeof createConnection>;
