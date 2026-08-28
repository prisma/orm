import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { composeCoverageConfig } from './scripts/coverage-config';

const coveragePolicy = composeCoverageConfig(import.meta.dirname);
const coverageShard = process.env['VITEST_COVERAGE_SHARD'];

export default defineConfig({
  test: {
    projects: ['packages/**/vitest.config.ts'],
    // Cap fork concurrency on CI so the PGlite-WASM-heavy package suites
    // (cli, sql runtime, postgres/supabase extensions, postgres adapter +
    // driver) don't all peak at once. Uncapped, vitest runs ~one fork per
    // core; several CPU-hungry PGlite forks plus the postgres service
    // container then oversubscribe the runner, stalling a fork's event loop
    // long enough to drop its postgres socket ("Client ... is not
    // queryable"). 50% leaves cores for the container and orchestrator.
    maxWorkers: process.env['CI'] ? '50%' : undefined,
    // Hard-suppress telemetry across every package test suite. The CLI's
    // `program.hook('preAction', …)` would otherwise fork the sender
    // child every time a test invokes the CLI in-process.
    // `PRISMA_NEXT_DISABLE_TELEMETRY=1` is the documented opt-out the CLI
    // honours in production; reusing it in test env keeps a single source
    // of truth instead of adding a test-only env var.
    env: {
      PRISMA_NEXT_DISABLE_TELEMETRY: '1',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(import.meta.dirname, 'coverage'),
      reporter: coverageShard ? [] : ['text', 'json'],
      reportOnFailure: true,
      ...coveragePolicy,
      thresholds: coverageShard ? {} : coveragePolicy.thresholds,
    },
  },
});
