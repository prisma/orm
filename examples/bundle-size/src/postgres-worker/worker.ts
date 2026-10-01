import postgresServerless from '@prisma/orm-postgres/serverless';
import { contract } from '../postgres/contract';

const postgres = postgresServerless({ contract });

interface Env {
  readonly DATABASE_URL: string;
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    await using db = await postgres.connect({ url: env.DATABASE_URL });
    const notes = await db.runtime().query(db.sql.public.Note.select('id').limit(10).build());
    return Response.json({ notes });
  },
};
