const directives = [
  "default-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

export const cspPlaceholder = '__SIFER_CSP__';

export function contentSecurityPolicy(development: boolean): string {
  const styleSrc = development ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
  return [...directives, styleSrc].join('; ');
}
