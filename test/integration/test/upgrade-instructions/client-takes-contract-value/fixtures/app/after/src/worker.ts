import postgresServerless from '@prisma/orm-postgres/serverless';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

const postgres = postgresServerless({ contract });
const streaming = postgresServerless({ contract, cursor: { batchSize: 100 } });

export default {
  async fetch(_request: Request, env: { readonly URL: string }): Promise<Response> {
    await using db = await (env.URL ? postgres : streaming).connect({ url: env.URL });
    return Response.json(await db.orm.public.User.all());
  },
};
