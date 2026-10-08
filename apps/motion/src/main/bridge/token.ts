import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Cipher, SecretFile } from '../secrets';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function createTokenStore(cipher: Cipher, file: SecretFile) {
  const load = (): string | null => {
    if (!cipher.isEncryptionAvailable()) {
      return null;
    }
    const contents = file.read();
    if (!contents || contents.length === 0) {
      return null;
    }
    try {
      return cipher.decryptString(contents);
    } catch {
      file.remove();
      return null;
    }
  };

  let current = load();

  return {
    get paired(): boolean {
      return current !== null;
    },
    issue(): string | null {
      if (!cipher.isEncryptionAvailable()) {
        return null;
      }
      const token = randomBytes(32).toString('base64url');
      file.write(cipher.encryptString(token));
      current = token;
      return token;
    },
    matches(candidate: string): boolean {
      return current !== null && timingSafeEqual(digest(candidate), digest(current));
    },
    revoke(): void {
      current = null;
      file.remove();
    },
  };
}

export type TokenStore = ReturnType<typeof createTokenStore>;
