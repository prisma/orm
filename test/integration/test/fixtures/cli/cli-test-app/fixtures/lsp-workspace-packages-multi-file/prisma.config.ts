// The workspace name of `@prisma/orm-postgres/config`: the language server runs
// from the workspace packages here, so the project names them too.
import { defineConfig as ormConfig, postgres18, postgresDriver } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: { path: './*.prisma', requiredCapabilities: [...postgres18, ...postgresDriver] },
  }),
});
