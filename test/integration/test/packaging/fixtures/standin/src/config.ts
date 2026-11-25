import { prismaContract } from '@prisma/orm-family-sql/contract-psl/provider';
import type { ControlExtensionDescriptor } from '@prisma/orm-framework/components/control';
import {
  defaultContractOutputPath,
  defineConfig as defineFrameworkConfig,
  type PrismaConfig,
} from '@prisma/orm-framework/config/config-types';
import { postgresContractCapabilities } from '@prisma/orm-postgres/config';
import postgresPack from '@prisma/orm-target-postgres/target/pack';
import { postgresCreateNamespace } from '@prisma/orm-target-postgres/target/types';
import { adapter, driver, family, migrationModule, target, typesModule } from './components';

export interface StandinConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: { readonly connection?: string };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
}

export function defineConfig(options: StandinConfigOptions): PrismaConfig<'sql', 'postgres'> {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    extensions: options.extensions ?? [],
    contract: {
      ...prismaContract(options.contract, {
        capabilities: postgresContractCapabilities({ databaseVersion: 18 }),
        output: options.output ?? defaultContractOutputPath(options.contract),
        target: postgresPack,
        createNamespace: postgresCreateNamespace,
      }),
      typesModule,
    },
    migrations: { module: migrationModule },
    ...(options.db === undefined ? {} : { db: options.db }),
  });
}
