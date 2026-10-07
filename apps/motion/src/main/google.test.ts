import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callbackPath,
  createGoogleSignIn,
  GoogleSignInError,
  openReceiver,
  type Callback,
  type Receiver,
} from './google';
import { IdentityError, type IdentityClient, type Tokens } from './identity';

const tokens: Tokens = {
  accessToken: 'a.b.c',
  refreshToken: 'r'.repeat(43),
  accessExpiresAt: 1,
  refreshExpiresAt: 2,
};

const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth?state=s1');

function fakeReceiver(callback: Callback | null) {
  const closed = vi.fn();
  const receiver: Receiver = {
    redirectUri: 'http://127.0.0.1:50123/oauth/callback',
    next: (signal) =>
      callback
        ? Promise.resolve(callback)
        : new Promise((_resolve, reject) => {
            if (signal.aborted) {
              reject(signal.reason);
              return;
            }
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          }),
    close: closed,
  };
  return { receiver, closed };
}

function fakeClient(overrides: Partial<IdentityClient> = {}): IdentityClient {
  return {
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    oauthStart: vi.fn(async () => authorization),
    oauthFinish: vi.fn(async () => tokens),
    ...overrides,
  } as IdentityClient;
}

describe('createGoogleSignIn', () => {
  it('opens Google, waits for the callback and finishes the sign-in', async () => {
    const client = fakeClient();
    const { receiver, closed } = fakeReceiver({ state: 's1', code: 'c1' });
    const openBrowser = vi.fn(async () => undefined);
    const flow = createGoogleSignIn({ client, openBrowser, openReceiver: async () => receiver });

    await expect(flow.signIn()).resolves.toEqual(tokens);
    expect(client.oauthStart).toHaveBeenCalledWith('google', receiver.redirectUri, false);
    expect(openBrowser).toHaveBeenCalledWith(authorization.toString());
    expect(client.oauthFinish).toHaveBeenCalledWith('google', 's1', 'c1');
    expect(closed).toHaveBeenCalledOnce();
  });

  it('asks for consent once more when no refresh token was granted', async () => {
    const finish = vi
      .fn<IdentityClient['oauthFinish']>()
      .mockRejectedValueOnce(new IdentityError('consent', 'again'))
      .mockResolvedValueOnce(tokens);
    const client = fakeClient({ oauthFinish: finish });
    const flow = createGoogleSignIn({
      client,
      openBrowser: async () => undefined,
      openReceiver: async () => fakeReceiver({ state: 's', code: 'c' }).receiver,
    });

    await expect(flow.signIn()).resolves.toEqual(tokens);
    expect(client.oauthStart).toHaveBeenNthCalledWith(2, 'google', expect.any(String), true);
  });

  it('turns failures into reasons the screen can explain', async () => {
    const cases: [Partial<IdentityClient>, Callback, string][] = [
      [{}, { error: 'access_denied' }, 'cancelled'],
      [
        { oauthFinish: async () => Promise.reject(new IdentityError('account-exists', 'x')) },
        { state: 's', code: 'c' },
        'account-exists',
      ],
      [
        { oauthFinish: async () => Promise.reject(new IdentityError('rejected', 'x')) },
        { state: 's', code: 'c' },
        'refused',
      ],
      [
        { oauthStart: async () => Promise.reject(new IdentityError('unavailable', 'x')) },
        { state: 's', code: 'c' },
        'unavailable',
      ],
      [
        { oauthStart: async () => new URL('https://evil.example/auth') },
        { state: 's', code: 'c' },
        'unavailable',
      ],
    ];
    for (const [overrides, callback, reason] of cases) {
      const flow = createGoogleSignIn({
        client: fakeClient(overrides),
        openBrowser: async () => undefined,
        openReceiver: async () => fakeReceiver(callback).receiver,
      });
      await expect(flow.signIn()).rejects.toMatchObject({ reason });
    }
  });

  it('never opens the browser for an unexpected authorization host', async () => {
    const openBrowser = vi.fn(async () => undefined);
    const flow = createGoogleSignIn({
      client: fakeClient({ oauthStart: async () => new URL('https://evil.example/auth') }),
      openBrowser,
      openReceiver: async () => fakeReceiver({ state: 's', code: 'c' }).receiver,
    });
    await expect(flow.signIn()).rejects.toBeInstanceOf(GoogleSignInError);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('gives up after the timeout and closes the receiver', async () => {
    const { receiver, closed } = fakeReceiver(null);
    const flow = createGoogleSignIn({
      client: fakeClient(),
      openBrowser: async () => undefined,
      openReceiver: async () => receiver,
      timeout: 20,
    });
    await expect(flow.signIn()).rejects.toMatchObject({ reason: 'cancelled' });
    expect(closed).toHaveBeenCalledOnce();
  });

  it('a second click replaces the first attempt', async () => {
    const first = fakeReceiver(null);
    const second = fakeReceiver({ state: 's', code: 'c' });
    const receivers = [first.receiver, second.receiver];
    const flow = createGoogleSignIn({
      client: fakeClient(),
      openBrowser: async () => undefined,
      openReceiver: async () => receivers.shift()!,
    });
    const abandoned = flow.signIn();
    await vi.waitFor(() => expect(receivers).toHaveLength(1));
    const replacement = flow.signIn();
    await expect(abandoned).rejects.toMatchObject({ reason: 'cancelled' });
    await expect(replacement).resolves.toEqual(tokens);
    expect(first.closed).toHaveBeenCalledOnce();
  });
});

describe('openReceiver', () => {
  let receiver: Receiver | null = null;

  afterEach(() => {
    receiver?.close();
    receiver = null;
  });

  it('listens on a loopback port and hands over the code', async () => {
    receiver = await openReceiver();
    const redirect = new URL(receiver.redirectUri);
    expect(redirect.hostname).toBe('127.0.0.1');
    expect(redirect.pathname).toBe(callbackPath);
    expect(Number(redirect.port)).toBeGreaterThanOrEqual(1024);

    const waiting = receiver.next(new AbortController().signal);
    const stray = await fetch(new URL('/favicon.ico', redirect));
    expect(stray.status).toBe(404);
    const page = await fetch(`${receiver.redirectUri}?state=s1&code=c1&scope=openid`);
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(await page.text()).toContain('Signed in to Sifer');
    await expect(waiting).resolves.toEqual({ state: 's1', code: 'c1' });
  });

  it('reports a refusal from Google', async () => {
    receiver = await openReceiver();
    const waiting = receiver.next(new AbortController().signal);
    const page = await fetch(`${receiver.redirectUri}?error=access_denied&state=s1`);
    expect(await page.text()).toContain('Sign-in cancelled');
    await expect(waiting).resolves.toEqual({ error: 'access_denied' });
  });

  it('stops waiting when aborted', async () => {
    receiver = await openReceiver();
    const controller = new AbortController();
    const waiting = receiver.next(controller.signal);
    controller.abort(new Error('stop'));
    await expect(waiting).rejects.toThrow('stop');
  });
});
