import { describe, expect, it } from 'vitest';
import {
  resolveTelemetryEndpoint,
  TELEMETRY_BACKEND_URL,
  TELEMETRY_ENDPOINT_PATH,
} from '../src/endpoint';

describe('resolveTelemetryEndpoint', () => {
  it('defaults to the production backend + events path when no override is set', () => {
    expect(resolveTelemetryEndpoint({})).toBe(`${TELEMETRY_BACKEND_URL}${TELEMETRY_ENDPOINT_PATH}`);
  });

  it('honours PRISMA_TELEMETRY_ENDPOINT when set', () => {
    expect(resolveTelemetryEndpoint({ PRISMA_TELEMETRY_ENDPOINT: 'http://127.0.0.1:54321' })).toBe(
      `http://127.0.0.1:54321${TELEMETRY_ENDPOINT_PATH}`,
    );
  });

  it('treats an empty PRISMA_TELEMETRY_ENDPOINT as unset (falls back to production)', () => {
    expect(resolveTelemetryEndpoint({ PRISMA_TELEMETRY_ENDPOINT: '' })).toBe(
      `${TELEMETRY_BACKEND_URL}${TELEMETRY_ENDPOINT_PATH}`,
    );
  });

  it('preserves a trailing path in the override base (e.g. mock servers using a sub-path)', () => {
    expect(resolveTelemetryEndpoint({ PRISMA_TELEMETRY_ENDPOINT: 'http://127.0.0.1:54321/' })).toBe(
      `http://127.0.0.1:54321${TELEMETRY_ENDPOINT_PATH}`,
    );
  });

  it('falls back to the production backend without throwing when the override is malformed', () => {
    expect(resolveTelemetryEndpoint({ PRISMA_TELEMETRY_ENDPOINT: 'invalid-url' })).toBe(
      `${TELEMETRY_BACKEND_URL}${TELEMETRY_ENDPOINT_PATH}`,
    );
  });
});
