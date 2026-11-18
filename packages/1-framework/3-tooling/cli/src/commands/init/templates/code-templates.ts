import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import type { AuthoringMode } from '../init-contribution';

export function defaultSchemaPath(authoring: AuthoringMode): string {
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
