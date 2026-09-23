import { describe, expect, it, vi } from 'vitest';
import { createSessionStore, type Cipher, type SecretFile } from './secrets';

const session = { email: 'ninette@example.com', refreshToken: 'r'.repeat(43) };

function harness(available = true, initial: Buffer | null = null) {
  let contents = initial;
  const cipher: Cipher = {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from(`dpapi:${plain}`),
    decryptString: (encrypted) => {
      const text = encrypted.toString();
      if (!text.startsWith('dpapi:')) {
        throw new Error('cannot decrypt');
      }
      return text.slice('dpapi:'.length);
    },
  };
  const file: SecretFile = {
    read: () => contents,
    write: vi.fn((data: Buffer) => {
      contents = data;
    }),
    remove: vi.fn(() => {
      contents = null;
    }),
  };
  return { store: createSessionStore(cipher, file), file, peek: () => contents };
}

describe('createSessionStore', () => {
  it('writes the session only as ciphertext', () => {
    const { store, peek } = harness();
    expect(store.save(session)).toBe(true);
    const written = peek()?.toString() ?? '';
    expect(written.startsWith('dpapi:')).toBe(true);
    expect(store.load()).toEqual(session);
  });

  it('saves nothing when the operating system cannot encrypt', () => {
    const { store, file, peek } = harness(false);
    expect(store.available).toBe(false);
    expect(store.save(session)).toBe(false);
    expect(file.write).not.toHaveBeenCalled();
    expect(peek()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('returns nothing when there is no file yet', () => {
    expect(harness().store.load()).toBeNull();
    expect(harness(true, Buffer.alloc(0)).store.load()).toBeNull();
  });

  it('discards a file it cannot decrypt, such as one copied from another machine', () => {
    const { store, file } = harness(true, Buffer.from('someone elses bytes'));
    expect(store.load()).toBeNull();
    expect(file.remove).toHaveBeenCalled();
  });

  it('discards a decrypted file that is not a session', () => {
    const { store, file } = harness(true, Buffer.from('dpapi:{"email":"a@b.co"}'));
    expect(store.load()).toBeNull();
    expect(file.remove).toHaveBeenCalled();
  });

  it('clears on request', () => {
    const { store, file, peek } = harness();
    store.save(session);
    store.clear();
    expect(file.remove).toHaveBeenCalled();
    expect(peek()).toBeNull();
  });
});
