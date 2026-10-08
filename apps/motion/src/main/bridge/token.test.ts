import { describe, expect, it, vi } from 'vitest';
import type { Cipher, SecretFile } from '../secrets';
import { createTokenStore } from './token';

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
  return { cipher, file, peek: () => contents };
}

describe('createTokenStore', () => {
  it('issues a 32 byte token and stores only ciphertext', () => {
    const { cipher, file, peek } = harness();
    const store = createTokenStore(cipher, file);
    expect(store.paired).toBe(false);
    const token = store.issue();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(peek()?.toString()).toBe(`dpapi:${token}`);
    expect(store.paired).toBe(true);
    expect(store.matches(token!)).toBe(true);
    expect(store.matches('B'.repeat(43))).toBe(false);
  });

  it('survives a restart', () => {
    const first = harness();
    const token = createTokenStore(first.cipher, first.file).issue()!;
    const second = harness(true, first.peek());
    expect(createTokenStore(second.cipher, second.file).matches(token)).toBe(true);
  });

  it('replaces the old token when paired again', () => {
    const { cipher, file } = harness();
    const store = createTokenStore(cipher, file);
    const old = store.issue()!;
    store.issue();
    expect(store.matches(old)).toBe(false);
  });

  it('forgets a file it cannot decrypt', () => {
    const { cipher, file } = harness(true, Buffer.from('copied from another machine'));
    const store = createTokenStore(cipher, file);
    expect(store.paired).toBe(false);
    expect(file.remove).toHaveBeenCalled();
  });

  it('never issues a token when the system cannot encrypt', () => {
    const { cipher, file } = harness(false);
    const store = createTokenStore(cipher, file);
    expect(store.issue()).toBeNull();
    expect(file.write).not.toHaveBeenCalled();
  });

  it('revokes the token', () => {
    const { cipher, file } = harness();
    const store = createTokenStore(cipher, file);
    const token = store.issue()!;
    store.revoke();
    expect(store.matches(token)).toBe(false);
    expect(file.remove).toHaveBeenCalled();
  });
});
