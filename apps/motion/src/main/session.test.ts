import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdentityError, type IdentityClient, type Tokens } from './identity';
import { createSessionManager, type SignedInState } from './session';
import { createSessionStore, type SavedSession } from './secrets';

const email = 'ninette@example.com';

function memoryStore(initial: SavedSession | null = null) {
  let contents: Buffer | null = initial ? Buffer.from(JSON.stringify(initial)) : null;
  const store = createSessionStore(
    {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(`cipher:${plain}`),
      decryptString: (encrypted) => encrypted.toString().replace(/^cipher:/, ''),
    },
    {
      read: () => contents,
      write: (data) => {
        contents = data;
      },
      remove: () => {
        contents = null;
      },
    },
  );
  return { store, peek: () => contents?.toString() ?? null };
}

function tokensAt(clock: number, suffix: string): Tokens {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    accessExpiresAt: clock + 900_000,
    refreshExpiresAt: clock + 2_592_000_000,
  };
}

describe('createSessionManager', () => {
  let clock: number;
  let client: IdentityClient;
  let login: ReturnType<typeof vi.fn>;
  let refresh: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let changes: SignedInState[];

  beforeEach(() => {
    clock = 1_000_000;
    login = vi.fn(async () => tokensAt(clock, 'one'));
    refresh = vi.fn(async () => tokensAt(clock, 'two'));
    logout = vi.fn(async () => undefined);
    client = { login, refresh, logout } as unknown as IdentityClient;
    changes = [];
  });

  const manager = (store = memoryStore().store) =>
    createSessionManager({
      client,
      store,
      now: () => clock,
      onChange: (state) => changes.push(state),
    });

  it('signs in and keeps only the refresh token on disk', async () => {
    const { store, peek } = memoryStore();
    const session = manager(store);
    expect(await session.signIn(email, 'correct horse battery staple')).toEqual({
      status: 'signed-in',
      email,
    });
    expect(await session.accessToken()).toBe('access-one');
    const saved = peek();
    expect(saved).toContain('refresh-one');
    expect(saved).not.toContain('access-one');
    expect(saved).not.toContain('correct horse battery staple');
    expect(changes.at(-1)).toEqual({ status: 'signed-in', email });
  });

  it('stores the email the way identity stores it', async () => {
    const session = manager();
    expect(await session.signIn('  Ninette@Example.COM ', 'correct horse battery staple')).toEqual({
      status: 'signed-in',
      email,
    });
    expect(login).toHaveBeenCalledWith(email, 'correct horse battery staple');
  });

  it('reports bad credentials without saving anything', async () => {
    const { store, peek } = memoryStore();
    login.mockRejectedValueOnce(new IdentityError('credentials', 'no'));
    await expect(manager(store).signIn(email, 'wrong')).rejects.toThrow(IdentityError);
    expect(peek()).toBeNull();
  });

  it('restores a saved session by rotating the stored refresh token', async () => {
    const { store, peek } = memoryStore({ email, refreshToken: 'refresh-old' });
    const session = manager(store);
    expect(await session.restore()).toEqual({ status: 'signed-in', email });
    expect(refresh).toHaveBeenCalledWith('refresh-old');
    expect(peek()).toContain('refresh-two');
    expect(await session.accessToken()).toBe('access-two');
  });

  it('forgets a rejected refresh token', async () => {
    const { store, peek } = memoryStore({ email, refreshToken: 'stale' });
    refresh.mockRejectedValueOnce(new IdentityError('refresh', 'gone'));
    const session = manager(store);
    expect(await session.restore()).toEqual({ status: 'signed-out' });
    expect(peek()).toBeNull();
  });

  it('keeps the saved session when identity is unreachable', async () => {
    const { store, peek } = memoryStore({ email, refreshToken: 'refresh-old' });
    refresh.mockRejectedValueOnce(new IdentityError('unavailable', 'offline'));
    const session = manager(store);
    expect(await session.restore()).toEqual({ status: 'signed-out' });
    expect(peek()).toContain('refresh-old');
  });

  it('renews the access token shortly before it expires', async () => {
    const session = manager();
    await session.signIn(email, 'correct horse battery staple');
    clock += 899_000;
    expect(await session.accessToken()).toBe('access-two');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('never refreshes twice at once, which would look like token theft', async () => {
    const session = manager();
    await session.signIn(email, 'correct horse battery staple');
    clock += 899_000;
    const [first, second, third] = await Promise.all([
      session.accessToken(),
      session.accessToken(),
      session.accessToken(),
    ]);
    expect([first, second, third]).toEqual(['access-two', 'access-two', 'access-two']);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('signs out, forgets the token and tells identity', async () => {
    const { store, peek } = memoryStore();
    const session = manager(store);
    await session.signIn(email, 'correct horse battery staple');
    expect(await session.signOut()).toEqual({ status: 'signed-out' });
    expect(logout).toHaveBeenCalledWith('refresh-one');
    expect(peek()).toBeNull();
    expect(await session.accessToken()).toBeNull();
  });
});
