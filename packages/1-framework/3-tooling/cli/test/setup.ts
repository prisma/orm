import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach } from 'vitest';
import { createNetworkGuard } from './utils/network-guard';

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
 * Replaces `fetch` with one that refuses any host but this machine, and fails the test that tried,
 * even when the code under test catches the refusal (for example `init` turning a failed registry
 * read into a refusal). A test that needs `fetch` stubs it with `vi.stubGlobal`.
 */
process.stdout.isTTY = true;

if (process.env['XDG_CONFIG_HOME'] === undefined) {
  process.env['XDG_CONFIG_HOME'] = mkdtempSync(join(tmpdir(), 'prisma-8-cli-test-xdg-'));
}

// Setup runs once per test file in the same process, so the guard wraps the real `fetch`, not the
// guard an earlier file installed.
const REAL_FETCH = Symbol.for('prisma-cli-test.real-fetch');
const realFetch: typeof fetch = Reflect.get(globalThis, REAL_FETCH) ?? globalThis.fetch;
Reflect.set(globalThis, REAL_FETCH, realFetch);
const networkGuard = createNetworkGuard(realFetch);
globalThis.fetch = networkGuard.fetch;

afterEach(() => {
  const blocked = networkGuard.takeBlocked();
  if (blocked.length > 0) {
    throw new Error(`the test tried to reach the network: ${blocked.join(', ')}`);
  }
});
