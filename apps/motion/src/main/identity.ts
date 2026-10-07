export interface Tokens {
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type IdentityFailure =
  'credentials' | 'refresh' | 'unavailable' | 'consent' | 'account-exists' | 'rejected';

export class IdentityError extends Error {
  constructor(
    readonly reason: IdentityFailure,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

interface ErrorPayload {
  error?: unknown;
}

interface StartPayload {
  authorization_url?: unknown;
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
    failure: 'credentials' | 'refresh' | 'oauth',
  ): Promise<Tokens> {
    if (response.status === 401 && failure !== 'oauth') {
      throw new IdentityError(
        failure,
        failure === 'credentials'
          ? 'email or password is incorrect'
          : 'the saved sign-in has expired',
      );
    }
    if (!response.ok) {
      throw failure === 'oauth'
        ? await oauthError(response)
        : new IdentityError('unavailable', `identity answered ${response.status}`);
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

  async function oauthError(response: Response): Promise<IdentityError> {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    const code = typeof payload.error === 'string' ? payload.error : '';
    switch (code) {
      case 'consent_required':
        return new IdentityError('consent', 'the provider must be asked for consent again');
      case 'account_exists':
        return new IdentityError('account-exists', 'this email already has a password account');
      case 'invalid_state':
      case 'invalid_grant':
      case 'email_unverified':
      case 'account_disabled':
        return new IdentityError('rejected', `sign-in refused: ${code}`);
      default:
        return new IdentityError('unavailable', `identity answered ${response.status}`);
    }
  }

  return {
    async oauthStart(provider: string, redirectUri: string, forceConsent: boolean): Promise<URL> {
      const response = await post(`/v1/oauth/${encodeURIComponent(provider)}/start`, {
        redirect_uri: redirectUri,
        force_consent: forceConsent,
      });
      if (!response.ok) {
        throw await oauthError(response);
      }
      const payload = (await response.json().catch(() => ({}))) as StartPayload;
      const raw = payload.authorization_url;
      const url = typeof raw === 'string' && URL.canParse(raw) ? new URL(raw) : null;
      if (!url || url.protocol !== 'https:') {
        throw new IdentityError('unavailable', 'identity returned an unexpected answer');
      }
      return url;
    },
    async oauthFinish(provider: string, state: string, code: string): Promise<Tokens> {
      return tokensFrom(
        await post(`/v1/oauth/${encodeURIComponent(provider)}/finish`, { state, code }),
        'oauth',
      );
    },
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

export function emailFromAccessToken(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
    };
    return typeof claims.email === 'string' && claims.email.includes('@')
      ? claims.email.toLowerCase()
      : null;
  } catch {
    return null;
  }
}
