import {
  type ContractSourceFormat,
  DEFAULT_CONTRACT_SOURCE_DIR,
} from '@internal/config/config-types';

export function defaultSchemaPath(authoring: ContractSourceFormat): string {
  if (authoring === 'typescript') {
    return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.ts`;
  }
  return `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.prisma`;
}

export function configFile(contractPath: string, configModule: string): string {
  return `import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '${configModule}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: ${JSON.stringify(contractPath)},
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}

/**
 * The config for a project whose contract source is its Prisma 7 schema:
 * `prisma7Schema` beside `defineConfig`, from the same module, with the
 * schema path as the user gave it and the emitted artifacts under Prisma 8's
 * own directory (`output` is the directory; the target package names `contract.json`).
 */
export function prisma7ConfigFile(
  schemaPath: string,
  outputDir: string,
  configModule: string,
): string {
  return `import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig, prisma7Schema } from '${configModule}';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema(${JSON.stringify(schemaPath)}),
    output: ${JSON.stringify(outputDir)},
    db: {
      connection: process.env['DATABASE_URL']!,
    },
  }),
});
`;
}
