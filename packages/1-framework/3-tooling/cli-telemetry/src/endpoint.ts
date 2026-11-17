/**
 * Production endpoint pinned to the deployed Prisma Compute backend.
 * Compiled as a build-time constant; not user-configurable.
 */
export const TELEMETRY_BACKEND_URL = 'https://cmpbfbsdp09hr3jf7pojjs5qs.ewr.prisma.build';

/**
 * Path within the backend that accepts telemetry POSTs.
 */
export const TELEMETRY_ENDPOINT_PATH = '/events';

/**
 * Resolve the full POST URL the sender targets. The
 * `PRISMA_TELEMETRY_ENDPOINT` env var is an integration-testing
 * affordance only — it lets the test suite spin up a mock HTTP server
 * on an ephemeral port and point the spawned sender at it. The override
 * is intentionally undocumented in user-facing material.
 *
 * Fail-open: a malformed override (typo in a dev shell, bad CI config)
 * silently falls back to the production backend rather than throwing,
 * matching the telemetry layer's broader silent-on-failure contract.
 */
export function resolveTelemetryEndpoint(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env['PRISMA_TELEMETRY_ENDPOINT'];
  const base = override !== undefined && override.length > 0 ? override : TELEMETRY_BACKEND_URL;
  try {
    return new URL(TELEMETRY_ENDPOINT_PATH, base).toString();
  } catch {
    return new URL(TELEMETRY_ENDPOINT_PATH, TELEMETRY_BACKEND_URL).toString();
  }
}
