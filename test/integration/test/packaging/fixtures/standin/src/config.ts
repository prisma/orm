import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import type { ControlExtensionDescriptor } from '@prisma/orm-framework/components/control';
import {
  defineConfig as defineFrameworkConfig,
  type PrismaNextConfig,
} from '@prisma/orm-framework/config/config-types';
import postgresPack from '@prisma/orm-target-postgres/target/pack';
import { postgresCreateNamespace } from '@prisma/orm-target-postgres/target/types';
import { adapter, driver, family, migrationModule, target, typesModule } from './components';

export interface StandinConfigOptions {
  /** The Prisma schema the contract is written in. */
  readonly contract: string;
  /** Where `contract.json` and `contract.d.ts` are written. */
  readonly output: string;
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
}

export function defineConfig(options: StandinConfigOptions): PrismaNextConfig<'sql', 'postgres'> {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    extensions: options.extensions ?? [],
    contract: {
      ...prismaContract(options.contract, {
        output: options.output,
        target: postgresPack,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule,
    },
    migrations: { module: migrationModule },
  });
}
