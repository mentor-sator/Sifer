import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { extensionOrigin, tokenProtocolPrefix } from './protocol';
import { createBridge, pairCooldown, type Bridge } from './server';

const goodToken = 'G'.repeat(43);

interface Harness {
  bridge: Bridge;
  approve: ReturnType<typeof vi.fn>;
  issue: ReturnType<typeof vi.fn>;
  status: boolean[];
  clock: { now: number };
}

const open: Bridge[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const bridge of open.splice(0)) {
    await bridge.stop();
  }
});

async function start(approved = true): Promise<Harness> {
  const status: boolean[] = [];
  const clock = { now: 1_000_000 };
  const approve = vi.fn(async () => approved);
  const issue = vi.fn(() => goodToken);
  const bridge = createBridge({
    port: 0,
    readTimeout: 100,
    now: () => clock.now,
    tokens: { matches: (token) => token === goodToken, issue },
    approvePairing: approve,
    onStatus: (connected) => status.push(connected),
  });
  await bridge.start();
  open.push(bridge);
  return { bridge, approve, issue, status, clock };
}

function connect(
  bridge: Bridge,
  protocols: string[],
  options: { origin?: string; host?: string } = {},
): WebSocket {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, protocols, {
    origin: options.origin ?? extensionOrigin,
    headers: options.host ? { host: options.host } : {},
  });
  sockets.push(socket);
  return socket;
}

function rejection(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0));
    socket.on('error', () => undefined);
  });
}

function opened(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) =>
    socket.once('message', (data) =>
      resolve(JSON.parse(data.toString()) as Record<string, unknown>),
    ),
  );
}

function closed(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

const session = [`sifer.v1`, `${tokenProtocolPrefix}${goodToken}`];

describe('createBridge', () => {
  it('listens on loopback only', async () => {
    const { bridge } = await start();
    expect(bridge.port).toBeGreaterThan(0);
    const status = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port: bridge.port, path: '/' }, (response) =>
        resolve(response.statusCode ?? 0),
      ).end();
    });
    expect(status).toBe(404);
  });

  it('refuses a web page origin', async () => {
    const { bridge } = await start();
    const socket = connect(bridge, session, { origin: 'https://evil.example' });
    expect(await rejection(socket)).toBe(403);
  });

  it('refuses a missing or wrong token', async () => {
    const { bridge } = await start();
    expect(await rejection(connect(bridge, ['sifer.v1']))).toBe(401);
    expect(
      await rejection(connect(bridge, ['sifer.v1', `${tokenProtocolPrefix}${'W'.repeat(43)}`])),
    ).toBe(401);
  });

  it('refuses a foreign host header', async () => {
    const { bridge } = await start();
    const socket = connect(bridge, session, { host: `rebind.example:${bridge.port}` });
    expect(await rejection(socket)).toBe(404);
  });

  it('pairs only after the user approves', async () => {
    const { bridge, approve, issue } = await start(true);
    const socket = connect(bridge, ['sifer.v1', 'sifer.pair']);
    const message = await nextMessage(socket);
    expect(message).toEqual({ type: 'paired', token: goodToken });
    expect(await closed(socket)).toBe(1000);
    expect(approve).toHaveBeenCalledOnce();
    expect(issue).toHaveBeenCalledOnce();
  });

  it('cools down after a refused pairing', async () => {
    const { bridge, approve, issue, clock } = await start(false);
    const first = connect(bridge, ['sifer.v1', 'sifer.pair']);
    expect(await nextMessage(first)).toEqual({ type: 'pair-refused' });
    expect(issue).not.toHaveBeenCalled();
    const second = connect(bridge, ['sifer.v1', 'sifer.pair']);
    expect(await closed(second)).toBe(1013);
    expect(approve).toHaveBeenCalledOnce();
    clock.now += pairCooldown;
    const third = connect(bridge, ['sifer.v1', 'sifer.pair']);
    expect(await nextMessage(third)).toEqual({ type: 'pair-refused' });
    expect(approve).toHaveBeenCalledTimes(2);
  });

  it('reads through a connected extension', async () => {
    const { bridge, status } = await start();
    const socket = connect(bridge, session);
    await opened(socket);
    await vi.waitFor(() => expect(bridge.connected).toBe(true));
    socket.send(JSON.stringify({ type: 'hello', browser: 'Chrome', version: '141' }));
    await vi.waitFor(() => expect(bridge.browser).toEqual({ browser: 'Chrome', version: '141' }));
    const request = nextMessage(socket);
    const read = bridge.read({ x: 10.4, y: 20.6 });
    const sent = await request;
    expect(sent).toEqual({ type: 'read', id: 1, x: 10, y: 21 });
    socket.send(JSON.stringify({ type: 'reading', id: 1, outcome: { ok: true } }));
    socket.send(
      JSON.stringify({
        type: 'reading',
        id: 1,
        outcome: {
          ok: true,
          reading: { source: 'dom', kind: 'value', control: 'Field', text: 'Kigali' },
        },
      }),
    );
    await expect(read).resolves.toMatchObject({ reading: { source: 'dom', text: 'Kigali' } });
    expect(status).toEqual([true]);
  });

  it('gives up on a slow extension so the next reader can run', async () => {
    const { bridge } = await start();
    const socket = connect(bridge, session);
    await opened(socket);
    await vi.waitFor(() => expect(bridge.connected).toBe(true));
    await expect(bridge.read({ x: 0, y: 0 })).resolves.toBeNull();
  });

  it('returns nothing when no extension is connected', async () => {
    const { bridge } = await start();
    await expect(bridge.read({ x: 0, y: 0 })).resolves.toBeNull();
  });

  it('keeps one session and reports when it leaves', async () => {
    const { bridge, status } = await start();
    const first = connect(bridge, session);
    await opened(first);
    const firstClosed = closed(first);
    const second = connect(bridge, session);
    await opened(second);
    expect(await firstClosed).toBe(4000);
    await vi.waitFor(() => expect(bridge.connected).toBe(true));
    const read = bridge.read({ x: 0, y: 0 });
    second.close();
    await expect(read).resolves.toBeNull();
    await vi.waitFor(() => expect(bridge.connected).toBe(false));
    expect(status.at(-1)).toBe(false);
  });
});
