import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ReadOutcome } from '../../shared/bridge';
import type { Point } from '../drag';
import {
  bridgeHost,
  bridgePort,
  bridgeProtocol,
  extensionOrigin,
  isAllowedHost,
  parseExtensionMessage,
  parseProtocols,
  type BridgeAccess,
  type MotionMessage,
} from './protocol';

export const domReadTimeout = 800;
export const pairCooldown = 10_000;
export const heartbeatInterval = 15_000;
export const maxMessageBytes = 1024 * 1024;

export interface BridgeTokens {
  matches(token: string): boolean;
  issue(): string | null;
}

export interface BridgeDependencies {
  tokens: BridgeTokens;
  approvePairing(): Promise<boolean>;
  onStatus(connected: boolean): void;
  port?: number;
  origin?: string;
  readTimeout?: number;
  now?: () => number;
}

export interface BrowserInfo {
  browser: string;
  version: string;
}

function refuse(socket: Duplex, status: 401 | 403 | 404 | 409): void {
  const text = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict' }[status];
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createBridge(dependencies: BridgeDependencies) {
  let port = dependencies.port ?? bridgePort;
  const origin = dependencies.origin ?? extensionOrigin;
  const readTimeout = dependencies.readTimeout ?? domReadTimeout;
  const now = dependencies.now ?? Date.now;
  const pending = new Map<number, (outcome: ReadOutcome | null) => void>();
  const sockets = new WeakMap<WebSocket, BridgeAccess>();
  const liveness = new WeakMap<WebSocket, { alive: boolean }>();
  let server: Server | null = null;
  let session: WebSocket | null = null;
  let browser: BrowserInfo | null = null;
  let pairing = false;
  let refusedAt = Number.NEGATIVE_INFINITY;
  let nextId = 1;
  let heartbeat: NodeJS.Timeout | null = null;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: maxMessageBytes,
    perMessageDeflate: false,
    handleProtocols: (offered) => (offered.has(bridgeProtocol) ? bridgeProtocol : false),
  });

  const send = (socket: WebSocket, message: MotionMessage): void => {
    socket.send(JSON.stringify(message));
  };

  const settleAll = (): void => {
    for (const settle of [...pending.values()]) {
      settle(null);
    }
  };

  const endSession = (socket: WebSocket): void => {
    if (session !== socket) {
      return;
    }
    session = null;
    browser = null;
    settleAll();
    dependencies.onStatus(false);
  };

  const pair = async (socket: WebSocket): Promise<void> => {
    if (pairing || now() - refusedAt < pairCooldown) {
      socket.close(1013, 'try later');
      return;
    }
    pairing = true;
    try {
      const approved = await dependencies.approvePairing();
      const token = approved ? dependencies.tokens.issue() : null;
      if (!token) {
        refusedAt = now();
        send(socket, { type: 'pair-refused' });
        socket.close(1000, 'refused');
        return;
      }
      if (session) {
        session.close(4001, 'paired again');
      }
      send(socket, { type: 'paired', token });
      socket.close(1000, 'paired');
    } finally {
      pairing = false;
    }
  };

  const attach = (socket: WebSocket): void => {
    session?.close(4000, 'replaced');
    session = socket;
    const state = { alive: true };
    liveness.set(socket, state);
    socket.on('pong', () => {
      state.alive = true;
    });
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, 'text only');
        return;
      }
      state.alive = true;
      const message = parseExtensionMessage(data.toString());
      if (!message) {
        return;
      }
      if (message.type === 'hello') {
        browser = { browser: message.browser, version: message.version };
      } else if (message.type === 'reading') {
        pending.get(message.id)?.(message.outcome);
      }
    });
    socket.on('close', () => endSession(socket));
    socket.on('error', () => endSession(socket));
    dependencies.onStatus(true);
  };

  wss.on('connection', (socket: WebSocket) => {
    const access = sockets.get(socket);
    if (access?.kind === 'pair') {
      socket.on('error', () => undefined);
      void pair(socket);
    } else if (access?.kind === 'session') {
      attach(socket);
    } else {
      socket.terminate();
    }
  });

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on('error', () => socket.destroy());
    if (request.url !== '/' || !isAllowedHost(request.headers.host, port)) {
      refuse(socket, 404);
      return;
    }
    if (request.headers.origin !== origin) {
      refuse(socket, 403);
      return;
    }
    const access = parseProtocols(request.headers['sec-websocket-protocol']);
    if (!access || (access.kind === 'session' && !dependencies.tokens.matches(access.token))) {
      refuse(socket, 401);
      return;
    }
    if (access.kind === 'pair' && pairing) {
      refuse(socket, 409);
      return;
    }
    wss.handleUpgrade(request, socket, head, (accepted) => {
      sockets.set(accepted, access);
      wss.emit('connection', accepted, request);
    });
  };

  const beat = (): void => {
    if (!session) {
      return;
    }
    const state = liveness.get(session);
    if (!state?.alive) {
      session.terminate();
      return;
    }
    state.alive = false;
    session.ping();
  };

  return {
    get port(): number {
      return port;
    },
    get connected(): boolean {
      return session !== null;
    },
    get browser(): BrowserInfo | null {
      return browser;
    },
    start(): Promise<void> {
      if (server) {
        return Promise.resolve();
      }
      const created = createServer((_request, response) => {
        response.writeHead(404, { 'Content-Length': '0' }).end();
      });
      created.on('upgrade', upgrade);
      return new Promise((resolve, reject) => {
        created.once('error', reject);
        created.listen(port, bridgeHost, () => {
          created.off('error', reject);
          const address = created.address();
          if (address && typeof address === 'object') {
            port = address.port;
          }
          server = created;
          heartbeat = setInterval(beat, heartbeatInterval);
          resolve();
        });
      });
    },
    stop(): Promise<void> {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      session?.terminate();
      for (const client of wss.clients) {
        client.terminate();
      }
      const closing = server;
      server = null;
      return new Promise((resolve) => (closing ? closing.close(() => resolve()) : resolve()));
    },
    read(point: Point): Promise<ReadOutcome | null> {
      const target = session;
      if (!target) {
        return Promise.resolve(null);
      }
      const id = nextId++;
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(null), readTimeout);
        const settle = (outcome: ReadOutcome | null): void => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(outcome);
        };
        pending.set(id, settle);
        send(target, { type: 'read', id, x: Math.round(point.x), y: Math.round(point.y) });
      });
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;
