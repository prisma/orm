import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from '../../../../../../examples/prisma-8-postgis-demo/src/prisma/contract.js';
import contractJson from '../../../../../../examples/prisma-8-postgis-demo/src/prisma/contract.json' with {
  type: 'json',
};

const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: 'postgres://localhost/app',
});

export const firstCafe = () => db.orm.public.Cafe.first();
