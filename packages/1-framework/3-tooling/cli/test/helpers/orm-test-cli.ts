import { createTestCli } from '@prisma/cli-engine/testing';
import { join } from 'pathe';

type TestCliSpec = Parameters<typeof createTestCli>[0];
type TestCli = ReturnType<typeof createTestCli>;
type RunArgs = Parameters<TestCli['run']>;

/**
 * A test CLI whose config file is `prisma.config.ts` in the run's working
 * directory, holding the given `orm` section as written. The engine validates
 * it against the section schema with that file as provenance, so relative
 * paths in the seed resolve against the run directory and the handler receives
 * the value a real load would produce.
 */
export function createOrmTestCli(spec: Omit<TestCliSpec, 'config'> & { readonly orm: unknown }) {
  const { orm, ...rest } = spec;
  return {
    run: (argv: RunArgs[0], opts?: RunArgs[1]): ReturnType<TestCli['run']> => {
      const path = join(opts?.cwd ?? process.cwd(), 'prisma.config.ts');
      return createTestCli({
        ...rest,
        loadConfig: async () => ({ files: [{ path, sections: { orm } }], diagnostics: [] }),
      }).run(argv, opts);
    },
  };
}
