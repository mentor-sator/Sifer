export interface SavedSession {
  email: string;
  refreshToken: string;
}

export interface Cipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretFile {
  read(): Buffer | null;
  write(contents: Buffer): void;
  remove(): void;
}

export function createSessionStore(cipher: Cipher, file: SecretFile) {
  return {
    get available(): boolean {
      return cipher.isEncryptionAvailable();
    },

    save(session: SavedSession): boolean {
      if (!cipher.isEncryptionAvailable()) {
        return false;
      }
      file.write(cipher.encryptString(JSON.stringify(session)));
      return true;
    },

    load(): SavedSession | null {
      if (!cipher.isEncryptionAvailable()) {
        return null;
      }
      const contents = file.read();
      if (!contents || contents.length === 0) {
        return null;
      }
      try {
        const parsed: unknown = JSON.parse(cipher.decryptString(contents));
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as SavedSession).email === 'string' &&
          typeof (parsed as SavedSession).refreshToken === 'string'
        ) {
          return {
            email: (parsed as SavedSession).email,
            refreshToken: (parsed as SavedSession).refreshToken,
          };
        }
      } catch {
        // an unreadable file means a new machine, a new Windows account, or tampering
      }
      file.remove();
      return null;
    },

    clear(): void {
      file.remove();
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
