export interface Tokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class IdentityError extends Error {
  constructor(
    readonly reason: 'credentials' | 'refresh' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

interface TokenPayload {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_expires_in?: unknown;
}

export interface IdentityClientOptions {
  baseUrl: string;
  fetch: FetchLike;
  now?: () => number;
  timeout?: number;
}

const requestTimeout = 10_000;

export function createIdentityClient(options: IdentityClientOptions) {
  const now = options.now ?? Date.now;
  const timeout = options.timeout ?? requestTimeout;

  async function post(path: string, body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await options.fetch(new URL(path, options.baseUrl).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      throw new IdentityError('unavailable', `cannot reach the identity service: ${String(cause)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function tokensFrom(
    response: Response,
    failure: 'credentials' | 'refresh',
  ): Promise<Tokens> {
    if (response.status === 401) {
      throw new IdentityError(
        failure,
        failure === 'credentials'
          ? 'email or password is incorrect'
          : 'the saved sign-in has expired',
      );
    }
    if (!response.ok) {
      throw new IdentityError('unavailable', `identity answered ${response.status}`);
    }
    const payload = (await response.json().catch(() => ({}))) as TokenPayload;
    const accessToken = payload.access_token;
    const refreshToken = payload.refresh_token;
    const expiresIn = payload.expires_in;
    const refreshExpiresIn = payload.refresh_expires_in;
    if (
      typeof accessToken !== 'string' ||
      typeof refreshToken !== 'string' ||
      typeof expiresIn !== 'number' ||
      typeof refreshExpiresIn !== 'number' ||
      accessToken === '' ||
      refreshToken === ''
    ) {
      throw new IdentityError('unavailable', 'identity returned an unexpected answer');
    }
    return {
      accessToken,
      refreshToken,
      accessExpiresAt: now() + expiresIn * 1000,
      refreshExpiresAt: now() + refreshExpiresIn * 1000,
    };
  }

  return {
    async login(email: string, password: string): Promise<Tokens> {
      return tokensFrom(await post('/v1/login', { email, password }), 'credentials');
    },
    async refresh(refreshToken: string): Promise<Tokens> {
      return tokensFrom(await post('/v1/refresh', { refresh_token: refreshToken }), 'refresh');
    },
    async logout(refreshToken: string): Promise<void> {
      await post('/v1/logout', { refresh_token: refreshToken }).catch(() => undefined);
    },
  };
}

export type IdentityClient = ReturnType<typeof createIdentityClient>;
