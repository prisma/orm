import postgresAdapter from '@internal/adapter-postgres/control';
import type { PrismaConfig } from '@internal/config/config-types';
import postgres from '@internal/target-postgres/control';

// @internal/sql-orm-client copies these generated files and cannot depend on @internal/postgres.
export function packageCopiedConfig(config: PrismaConfig<'sql', 'postgres'>) {
  if (config.contract === undefined) {
    throw new Error('a package-copied fixture config has a contract section');
  }
  return {
    ...config,
    target: postgres,
    adapter: postgresAdapter,
    contract: { ...config.contract, typesModule: '#fixture-contract-types' },
  };
}
