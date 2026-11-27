import { defineConfig as ormConfig, postgres18 } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    contract: {
      path: './contract.prisma',
      requiredCapabilities: postgres18.filter(
        (capability) => capability !== 'sql.insertOnConflictTarget',
      ),
    },
    output: 'generated',
  }),
});
