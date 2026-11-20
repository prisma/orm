import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';

/**
 * Vitest setup file for CLI package unit tests.
 *
 * Simulates an interactive terminal by setting `process.stdout.isTTY = true`.
 * Without this, vitest's forked worker process has piped stdout (isTTY is undefined),
 * which would trigger auto-JSON detection in `parseGlobalFlags()` and change the
 * behavior of unit tests that call it directly (without `setupCommandMocks`).
 *
 * Integration/journey tests use `setupCommandMocks()` which handles this independently.
 *
 * Also sandboxes `$XDG_CONFIG_HOME` to a per-worker tempdir so any test
 * that ends up calling `writeUserConfig` (e.g. the `init` consent
 * prompt path under a mocked `clack.confirm`) writes to a throwaway
 * directory instead of the developer's real user-level config file.
 *
 * Replaces `fetch` with one that fails for any host but this machine, so a test that would reach the network (for example `init`
 * asking the registry for an unlisted package's keywords) fails instead. A test that needs `fetch`
 * stubs it with `vi.stubGlobal`.
 */
process.stdout.isTTY = true;

if (process.env['XDG_CONFIG_HOME'] === undefined) {
  process.env['XDG_CONFIG_HOME'] = mkdtempSync(join(tmpdir(), 'prisma-8-cli-test-xdg-'));
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`a test tried to reach the network: ${url.href}`);
  }
  return realFetch(input, init);
};
