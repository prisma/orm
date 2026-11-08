import { defineContract, field, model, nativeEnum, pg } from '@internal/postgres/contract-builder';
import postgresStatic from '@internal/postgres/static';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './sql-orm-client/integration-helpers';

const Status = nativeEnum('Status', 'draft', 'published').map('sample_status');
const contract = defineContract({
  models: {
    Sample: model('Sample', {
      fields: {
        id: field.column({ codecId: 'pg/int4@1' }).id(),
        status: field.column(pg.enum(Status)),
        tags: field.column({ codecId: 'pg/text@1' }).many({ elementsNullable: true }).optional(),
      },
    }).sql({ table: 'samples' }),
  },
});

describe('raw column codec metadata through Postgres', () => {
  it(
    'decodes parameterized codecs and nullable arrays through inherited row specs',
    async () => {
      await withPushedContractRuntime(contract, async (runtime) => {
        const db = postgresStatic({ contract });
        const table = db.sql.public.samples;
        const inner = db.raw.sql`
          SELECT 'draft'::sample_status AS status,
                 ARRAY['one,two', NULL, 'three']::text[] AS tags
        `.returnsRow({ status: table.columns.status, tags: table.columns.tags });
        const plan = db.raw.sql`WITH sample AS (${inner}) SELECT status, tags FROM sample`
          .returnsRow({ status: inner.returns.status, tags: inner.returns.tags })
          .build();
        const nullArray = db.raw.sql`SELECT NULL::text[] AS tags`
          .returnsRow({ tags: table.columns.tags })
          .build();

        expect(await runtime.query(plan)).toEqual([
          { status: 'draft', tags: ['one,two', null, 'three'] },
        ]);
        expect(await runtime.query(nullArray)).toEqual([{ tags: null }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
