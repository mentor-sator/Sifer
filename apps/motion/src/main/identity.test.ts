import { describe, expect, it, vi } from 'vitest';
import { createIdentityClient, IdentityError, type FetchLike } from './identity';

const clock = 1_700_000_000_000;
const goodBody = {
  access_token: 'header.payload.signature',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'r'.repeat(43),
  refresh_expires_in: 2_592_000,
};

function clientWith(handler: FetchLike) {
  return createIdentityClient({
    baseUrl: 'http://127.0.0.1:8081',
    fetch: handler,
    now: () => clock,
  });
}

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('createIdentityClient', () => {
  it('logs in and turns lifetimes into absolute times', async () => {
    const fetcher = vi.fn<FetchLike>(async () => answer(200, goodBody));
    const tokens = await clientWith(fetcher).login(
      'ninette@example.com',
      'correct horse battery staple',
    );
    expect(tokens).toEqual({
      accessToken: goodBody.access_token,
      refreshToken: goodBody.refresh_token,
      accessExpiresAt: clock + 900_000,
      refreshExpiresAt: clock + 2_592_000_000,
    });
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:8081/v1/login');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ninette@example.com',
      password: 'correct horse battery staple',
    });
  });

  it('reports wrong credentials separately from a broken service', async () => {
    await expect(
      clientWith(async () => answer(401, { error: 'invalid_credentials' })).login('a@b.co', 'x'),
    ).rejects.toMatchObject({ reason: 'credentials' });
    await expect(clientWith(async () => answer(500)).login('a@b.co', 'x')).rejects.toMatchObject({
      reason: 'unavailable',
    });
    await expect(
      clientWith(async () => {
        throw new Error('ECONNREFUSED');
      }).login('a@b.co', 'x'),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('reports an expired refresh token separately', async () => {
    await expect(
      clientWith(async () => answer(401, { error: 'invalid_refresh_token' })).refresh('r'),
    ).rejects.toMatchObject({ reason: 'refresh' });
  });

  it('refuses an answer that is not a token pair', async () => {
    for (const body of [
      {},
      { access_token: 'a' },
      { ...goodBody, expires_in: 'soon' },
      { ...goodBody, access_token: '' },
    ]) {
      await expect(
        clientWith(async () => answer(200, body)).login('a@b.co', 'x'),
      ).rejects.toBeInstanceOf(IdentityError);
    }
  });

  it('posts the refresh token to the refresh and logout endpoints', async () => {
    const fetcher = vi.fn<FetchLike>(async () => answer(200, goodBody));
    const client = clientWith(fetcher);
    await client.refresh('old-token');
    await client.logout('old-token');
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8081/v1/refresh',
      'http://127.0.0.1:8081/v1/logout',
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      refresh_token: 'old-token',
    });
  });

  it('never fails a sign-out because the service is down', async () => {
    await expect(
      clientWith(async () => {
        throw new Error('offline');
      }).logout('token'),
    ).resolves.toBeUndefined();
  });

  it('gives up on a hanging service', async () => {
    const client = createIdentityClient({
      baseUrl: 'http://127.0.0.1:8081',
      timeout: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await expect(client.login('a@b.co', 'x')).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
