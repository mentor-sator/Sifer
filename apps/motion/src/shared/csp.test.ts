import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from './csp';

describe('contentSecurityPolicy', () => {
  it('is strict in a packaged build', () => {
    expect(contentSecurityPolicy(false)).toBe(
      "default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; style-src 'self'",
    );
  });

  it('allows inline styles only for the dev server, which Vite injects', () => {
    const development = contentSecurityPolicy(true);
    expect(development).toContain("style-src 'self' 'unsafe-inline'");
    expect(development.replace("style-src 'self' 'unsafe-inline'", '')).not.toContain(
      'unsafe-inline',
    );
  });

  it('never allows inline or evaluated scripts', () => {
    for (const policy of [contentSecurityPolicy(true), contentSecurityPolicy(false)]) {
      expect(policy).toContain("script-src 'self'");
      expect(policy).not.toContain('unsafe-eval');
      expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    }
  });
});
