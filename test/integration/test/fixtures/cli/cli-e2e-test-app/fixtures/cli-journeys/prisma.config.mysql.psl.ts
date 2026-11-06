import { defineConfig as ormConfig } from '@internal/mysql/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './contract.prisma',
    output: '.',
    db: { connection: '{{DB_URL}}' },
    migrations: { dir: 'migrations' },
  }),
});
