import { resolveConfigPaths } from '@internal/config/config-resolve';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { createTestCli } from '@prisma/cli-engine/testing';

type TestCliSpec = Parameters<typeof createTestCli>[0];
type TestCli = ReturnType<typeof createTestCli>;
type RunArgs = Parameters<TestCli['run']>;

/**
 * A test CLI seeded with an `orm` section as the engine's loader hands it
 * over for a config discovered in the run's working directory: resolved
 * against that directory, with `baseDir` recorded (ADR 253).
 */
export function createOrmTestCli(spec: Omit<TestCliSpec, 'config'> & { readonly orm: unknown }) {
  const { orm, ...rest } = spec;
  return {
    run: (argv: RunArgs[0], opts?: RunArgs[1]): ReturnType<TestCli['run']> => {
      const baseDir = opts?.cwd ?? process.cwd();
      const section = resolveConfigPaths(orm as PrismaNextConfig, baseDir);
      return createTestCli({ ...rest, config: { orm: section } }).run(argv, opts);
    },
  };
}
