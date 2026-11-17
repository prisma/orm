import postgresServerless from '@prisma/orm-postgres/serverless';
import type { Contract } from './prisma/contract.d';
import contractJson from './prisma/contract.json' with { type: 'json' };

const postgres = postgresServerless<Contract>({ contractJson });
const streaming = postgresServerless<Contract>({ contractJson, cursor: { batchSize: 100 } });

export default {
  async fetch(_request: Request, env: { readonly URL: string }): Promise<Response> {
    await using db = await (env.URL ? postgres : streaming).connect({ url: env.URL });
    return Response.json(await db.orm.public.User.all());
  },
};
