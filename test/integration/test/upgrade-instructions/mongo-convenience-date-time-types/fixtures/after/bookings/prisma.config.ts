import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-mongo/config';

export default definePrismaConfig({
  orm: ormConfig({ contract: './schema', db: { connection: 'mongodb://localhost/bookings' } }),
});
