import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { IdentityError, type IdentityClient, type Tokens } from './identity';

export const callbackPath = '/oauth/callback';
export const googleTimeout = 5 * 60_000;
const allowedAuthorizationHost = 'accounts.google.com';

export type Callback = { state: string; code: string } | { error: string };

export interface Receiver {
  readonly redirectUri: string;
  next(signal: AbortSignal): Promise<Callback>;
  close(): void;
}

const page = (title: string, detail: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sifer</title>` +
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
  `<style>body{margin:0;display:grid;place-items:center;height:100vh;background:#12142a;color:#e9ecff;` +
  `font:15px 'Segoe UI',system-ui,sans-serif}main{text-align:center}p{color:#aab0d8}</style></head>` +
  `<body><main><h1>${title}</h1><p>${detail}</p></main></body></html>`;

function respond(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  });
  response.end(body);
}

function read(request: IncomingMessage): Callback | null {
  if (request.method !== 'GET' || !request.url) {
    return null;
  }
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== callbackPath) {
    return null;
  }
  const error = url.searchParams.get('error');
  if (error) {
    return { error };
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  return state && code ? { state, code } : { error: 'missing_code' };
}

export async function openReceiver(): Promise<Receiver> {
  let deliver: ((callback: Callback) => void) | null = null;
  const server = createServer((request, response) => {
    const callback = read(request);
    if (!callback) {
      respond(response, 404, page('Not found', 'This address is only used by Sifer sign-in.'));
      return;
    }
    const succeeded = !('error' in callback);
    respond(
      response,
      200,
      succeeded
        ? page('Signed in to Sifer', 'You can close this tab and return to Sifer.')
        : page('Sign-in cancelled', 'You can close this tab and try again from Sifer.'),
    );
    deliver?.(callback);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}${callbackPath}`,
    next(signal) {
      return new Promise<Callback>((resolve, reject) => {
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        const abort = (): void => {
          deliver = null;
          reject(signal.reason);
        };
        signal.addEventListener('abort', abort, { once: true });
        deliver = (callback) => {
          deliver = null;
          signal.removeEventListener('abort', abort);
          resolve(callback);
        };
      });
    },
    close() {
      deliver = null;
      server.closeAllConnections();
      server.close();
    },
  };
}

export class GoogleSignInError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'account-exists' | 'refused' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

export interface GoogleFlowOptions {
  client: IdentityClient;
  openBrowser: (url: string) => Promise<void>;
  openReceiver?: () => Promise<Receiver>;
  timeout?: number;
}

function translate(error: unknown): GoogleSignInError {
  if (error instanceof GoogleSignInError) {
    return error;
  }
  if (error instanceof IdentityError) {
    switch (error.reason) {
      case 'account-exists':
        return new GoogleSignInError('account-exists', error.message);
      case 'rejected':
      case 'consent':
        return new GoogleSignInError('refused', error.message);
      default:
        return new GoogleSignInError('unavailable', error.message);
    }
  }
  return new GoogleSignInError('cancelled', 'Google sign-in was cancelled or timed out');
}

export function createGoogleSignIn(options: GoogleFlowOptions) {
  const open = options.openReceiver ?? openReceiver;
  const timeout = options.timeout ?? googleTimeout;
  let current: AbortController | null = null;

  async function attempt(signal: AbortSignal, forceConsent: boolean): Promise<Tokens> {
    const receiver = await open();
    try {
      const url = await options.client.oauthStart('google', receiver.redirectUri, forceConsent);
      if (url.hostname !== allowedAuthorizationHost) {
        throw new GoogleSignInError('unavailable', `unexpected authorization host ${url.hostname}`);
      }
      const waiting = receiver.next(signal);
      await options.openBrowser(url.toString());
      const callback = await waiting;
      if ('error' in callback) {
        throw new GoogleSignInError('cancelled', `Google answered ${callback.error}`);
      }
      return await options.client.oauthFinish('google', callback.state, callback.code);
    } finally {
      receiver.close();
    }
  }

  return {
    async signIn(): Promise<Tokens> {
      current?.abort(new GoogleSignInError('cancelled', 'a newer sign-in replaced this one'));
      const controller = new AbortController();
      current = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
      try {
        try {
          return await attempt(signal, false);
        } catch (error) {
          if (error instanceof IdentityError && error.reason === 'consent') {
            return await attempt(signal, true);
          }
          throw error;
        }
      } catch (error) {
        throw translate(error);
      } finally {
        if (current === controller) {
          current = null;
        }
      }
    },
    cancel(): void {
      current?.abort(new GoogleSignInError('cancelled', 'sign-in was cancelled'));
      current = null;
    },
  };
}

export type GoogleSignIn = ReturnType<typeof createGoogleSignIn>;
