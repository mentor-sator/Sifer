import { describe, expect, it } from 'vitest';
import { readConfig } from './config';

describe('readConfig', () => {
  it('talks to identity on loopback by default', () => {
    expect(readConfig({})).toEqual({ identityUrl: 'http://127.0.0.1:8081' });
    expect(readConfig({ SIFER_IDENTITY_URL: '  ' })).toEqual({
      identityUrl: 'http://127.0.0.1:8081',
    });
  });

  it('accepts an override and keeps only the origin', () => {
    expect(readConfig({ SIFER_IDENTITY_URL: 'https://identity.sifer.test/v1/ignored' })).toEqual({
      identityUrl: 'https://identity.sifer.test',
    });
  });

  it('refuses anything that is not http or https', () => {
    for (const value of ['file:///etc/passwd', 'identity:8081', 'ftp://x.test']) {
      expect(() => readConfig({ SIFER_IDENTITY_URL: value })).toThrow();
    }
  });
});
