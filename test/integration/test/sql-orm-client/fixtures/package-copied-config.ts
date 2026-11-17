import postgresAdapter from '@internal/adapter-postgres/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import postgres from '@internal/target-postgres/control';

/**
 * The config of a fixture whose generated files `@internal/sql-orm-client` copies into its own tests. That package cannot depend on `@internal/postgres`, so the target and adapter keep their own type declarations instead of the ones `@internal/postgres`'s `defineConfig` restates with its `generated-types` module, and the generated `contract.d.ts` imports the framework and family types from `fixtures/generated-types.ts`, which both trees hold.
 */
export function packageCopiedConfig(config: PrismaNextConfig<'sql', 'postgres'>) {
  if (config.contract === undefined) {
    throw new Error('a package-copied fixture config has a contract section');
  }
  return {
    ...config,
    target: postgres,
    adapter: postgresAdapter,
    contract: { ...config.contract, typesModule: '../../generated-types' },
  };
}
