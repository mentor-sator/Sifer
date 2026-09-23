import { IdentityError, type IdentityClient, type Tokens } from './identity';
import type { SessionStore } from './secrets';

export type SignedInState = { status: 'signed-out' } | { status: 'signed-in'; email: string };

export interface SessionOptions {
  client: IdentityClient;
  store: SessionStore;
  now?: () => number;
  onChange?: (state: SignedInState) => void;
}

const renewBefore = 60_000;

export function createSessionManager(options: SessionOptions) {
  const now = options.now ?? Date.now;
  let tokens: Tokens | null = null;
  let email: string | null = null;
  let renewal: Promise<Tokens> | null = null;

  const state = (): SignedInState =>
    email ? { status: 'signed-in', email } : { status: 'signed-out' };

  const announce = (): void => options.onChange?.(state());

  const remember = (address: string, fresh: Tokens): void => {
    tokens = fresh;
    email = address;
    options.store.save({ email: address, refreshToken: fresh.refreshToken });
    announce();
  };

  const forget = (): void => {
    tokens = null;
    email = null;
    options.store.clear();
    announce();
  };

  async function renew(refreshToken: string, address: string): Promise<Tokens> {
    renewal ??= options.client
      .refresh(refreshToken)
      .then((fresh) => {
        remember(address, fresh);
        return fresh;
      })
      .catch((error: unknown) => {
        if (error instanceof IdentityError && error.reason === 'refresh') {
          forget();
        }
        throw error;
      })
      .finally(() => {
        renewal = null;
      });
    return renewal;
  }

  return {
    state,

    async restore(): Promise<SignedInState> {
      const saved = options.store.load();
      if (!saved) {
        return state();
      }
      email = saved.email;
      try {
        await renew(saved.refreshToken, saved.email);
      } catch (error) {
        if (error instanceof IdentityError && error.reason === 'unavailable') {
          email = null;
        }
      }
      return state();
    },

    async signIn(address: string, password: string): Promise<SignedInState> {
      const fresh = await options.client.login(address, password);
      remember(address, fresh);
      return state();
    },

    async accessToken(): Promise<string | null> {
      if (!tokens || !email) {
        return null;
      }
      if (tokens.accessExpiresAt - now() > renewBefore) {
        return tokens.accessToken;
      }
      try {
        return (await renew(tokens.refreshToken, email)).accessToken;
      } catch {
        return null;
      }
    },

    async signOut(): Promise<SignedInState> {
      const refreshToken = tokens?.refreshToken;
      forget();
      if (refreshToken) {
        await options.client.logout(refreshToken);
      }
      return state();
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
