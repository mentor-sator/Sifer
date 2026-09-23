export interface MotionConfig {
  identityUrl: string;
}

const defaultIdentityUrl = 'http://127.0.0.1:8081';

export function readConfig(environment: NodeJS.ProcessEnv = process.env): MotionConfig {
  return { identityUrl: httpUrl(environment['SIFER_IDENTITY_URL'], defaultIdentityUrl) };
}

function httpUrl(value: string | undefined, fallback: string): string {
  const candidate = value?.trim() ? value.trim() : fallback;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`SIFER_IDENTITY_URL ${candidate} is not a URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SIFER_IDENTITY_URL ${candidate} must be http or https`);
  }
  return parsed.origin;
}
