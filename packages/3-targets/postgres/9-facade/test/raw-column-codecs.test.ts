import { describe, expect, it } from 'vitest';
import { defineContract, field, model, nativeEnum, pg } from '../src/exports/contract-builder';
import postgresStatic from '../src/static/postgres-static';

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

const db = postgresStatic({ contract });
const columns = {
  status: {
    codecId: 'pg/enum@1',
    nullable: false,
    codec: { codecId: 'pg/enum@1', typeParams: { typeName: 'sample_status' } },
  },
  tags: {
    codecId: 'pg/text@1',
    nullable: true,
    codec: { codecId: 'pg/text@1', many: true },
  },
};

describe('raw contract-column codec bindings', () => {
  it('carries parameterized and array metadata from an aliased table', () => {
    const table = db.sql.public.samples.as('s');

    expect({ status: table.columns.status, tags: table.columns.tags }).toEqual(columns);
  });

  it('preserves the bindings through row specs and inherited result references', () => {
    const table = db.sql.public.samples;
    const inner = db.raw.sql`SELECT status, tags FROM samples`.returnsRow({
      status: table.columns.status,
      tags: table.columns.tags,
    });
    const outer = db.raw.sql`WITH sample AS (${inner}) SELECT status, tags FROM sample`.returnsRow({
      status: inner.returns.status,
      tags: inner.returns.tags,
    });

    expect({ inner: inner.buildAst().result, outer: outer.buildAst().result }).toEqual({
      inner: { kind: 'rows', columns },
      outer: { kind: 'rows', columns },
    });
  });
});
