import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAppConfig } from './app-config';
import { AppConfigError } from './errors';

describe('loadAppConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the database url when DATABASE_URL is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgres://example');
    expect(loadAppConfig()).toEqual({ databaseUrl: 'postgres://example' });
  });

  it('throws AppConfigError when DATABASE_URL is missing', () => {
    vi.stubEnv('DATABASE_URL', undefined);
    expect(() => loadAppConfig()).toThrow(AppConfigError);
    expect(() => loadAppConfig()).toThrow(/Invalid app configuration/);
  });
});
