import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  keepaliveInterval,
  pairTimeout,
  retryDelays,
  type SocketHandlers,
  type SocketLike,
} from './connection';
import type { ReadOutcome, Status } from './protocol';

const token = 'K'.repeat(43);

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: unknown[] = [];
  closedWith: number | null = null;

  constructor(
    readonly protocols: string[],
    readonly handlers: SocketHandlers,
  ) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000): void {
    this.closedWith = code;
  }

  accept(): void {
    this.readyState = 1;
    this.handlers.open();
  }

  receive(message: unknown): void {
    this.handlers.message(JSON.stringify(message));
  }

  drop(code: number): void {
    this.readyState = 3;
    this.handlers.close(code);
  }
}

function harness(options: { stored?: string | null; reachable?: boolean } = {}) {
  let stored = options.stored === undefined ? token : options.stored;
  const sockets: FakeSocket[] = [];
  const statuses: Status[] = [];
  const read = vi.fn(async (): Promise<ReadOutcome> => ({
    ok: true,
    reading: { source: 'dom', kind: 'text', control: 'Paragraph', text: 'hello' },
  }));
  const connection = createConnection({
    open: (_url, protocols, handlers) => {
      const socket = new FakeSocket(protocols, handlers);
      sockets.push(socket);
      return socket;
    },
    storage: {
      load: async () => stored,
      save: async (next) => {
        stored = next;
      },
      clear: async () => {
        stored = null;
      },
    },
    reachable: async () => options.reachable ?? false,
    read,
    identity: { browser: 'Chrome', version: '141' },
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setRepeating: (callback, milliseconds) => setInterval(callback, milliseconds),
    clearRepeating: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    onStatus: (status) => statuses.push(status),
  });
  return { connection, sockets, statuses, read, stored: () => stored };
}

const last = (sockets: FakeSocket[]): FakeSocket => {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error('no socket opened');
  }
  return socket;
};

describe('createConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('connects with its token, says hello and keeps the worker alive', async () => {
    const { connection, sockets } = harness();
    await connection.connect();
    const socket = last(sockets);
    expect(socket.protocols).toEqual(['sifer.v1', `sifer.token.${token}`]);
    socket.accept();
    expect(connection.status).toBe('connected');
    expect(socket.sent).toEqual([{ type: 'hello', browser: 'Chrome', version: '141' }]);
    vi.advanceTimersByTime(keepaliveInterval * 2);
    expect(socket.sent.slice(1)).toEqual([{ type: 'keepalive' }, { type: 'keepalive' }]);
  });

  it('answers a read request with the page reading', async () => {
    const { connection, sockets, read } = harness();
    await connection.connect();
    const socket = last(sockets);
    socket.accept();
    socket.receive({ type: 'read', id: 7, x: 120, y: 340, title: 'Inbox - Google Chrome' });
    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(read).toHaveBeenCalledWith({ x: 120, y: 340 }, 'Inbox - Google Chrome');
    expect(socket.sent[1]).toMatchObject({ type: 'reading', id: 7, outcome: { ok: true } });
  });

  it('reports a failed read instead of staying silent', async () => {
    const { connection, sockets, read } = harness();
    read.mockRejectedValueOnce(new Error('tab closed'));
    await connection.connect();
    const socket = last(sockets);
    socket.accept();
    socket.receive({ type: 'read', id: 1, x: 0, y: 0, title: 'Inbox' });
    await vi.waitFor(() =>
      expect(socket.sent[1]).toEqual({
        type: 'reading',
        id: 1,
        outcome: { ok: false, reason: 'failed' },
      }),
    );
  });

  it('stays unpaired without a token', async () => {
    const { connection, sockets } = harness({ stored: null });
    await connection.connect();
    expect(sockets).toHaveLength(0);
    expect(connection.status).toBe('unpaired');
  });

  it('retries with growing delays while Motion is not running', async () => {
    const { connection, sockets } = harness();
    await connection.connect();
    last(sockets).drop(1006);
    await vi.waitFor(() => expect(connection.status).toBe('offline'));
    await vi.advanceTimersByTimeAsync(retryDelays[0]);
    expect(sockets).toHaveLength(2);
    last(sockets).drop(1006);
    await vi.waitFor(() => expect(connection.status).toBe('offline'));
    await vi.advanceTimersByTimeAsync(retryDelays[0]);
    expect(sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(retryDelays[1] - retryDelays[0]);
    expect(sockets).toHaveLength(3);
  });

  it('forgets a token Motion no longer accepts', async () => {
    const { connection, sockets, stored } = harness({ reachable: true });
    await connection.connect();
    last(sockets).drop(1006);
    await vi.waitFor(() => expect(connection.status).toBe('unpaired'));
    expect(stored()).toBeNull();
  });

  it('pairs, stores the token Motion issues and connects with it', async () => {
    const { connection, sockets, stored } = harness({ stored: null });
    const result = connection.pair();
    expect(connection.status).toBe('pairing');
    const pairing = last(sockets);
    expect(pairing.protocols).toEqual(['sifer.v1', 'sifer.pair']);
    pairing.accept();
    pairing.receive({ type: 'paired', token });
    pairing.drop(1000);
    await expect(result).resolves.toBe('connected');
    expect(stored()).toBe(token);
    expect(last(sockets).protocols).toEqual(['sifer.v1', `sifer.token.${token}`]);
  });

  it('reports a refusal and a timeout', async () => {
    const { connection, sockets } = harness({ stored: null });
    const refused = connection.pair();
    last(sockets).receive({ type: 'pair-refused' });
    await expect(refused).resolves.toBe('refused');
    const ignored = connection.pair();
    await vi.advanceTimersByTimeAsync(pairTimeout);
    await expect(ignored).resolves.toBe('refused');
    expect(last(sockets).closedWith).toBe(1000);
  });

  it('reports when Motion is not running during pairing', async () => {
    const { connection, sockets } = harness({ stored: null });
    const result = connection.pair();
    last(sockets).drop(1006);
    await expect(result).resolves.toBe('offline');
  });
});
