import { defineContract, postgres18, postgresDriver } from '@internal/postgres/contract-builder';
import postgresStatic from '@internal/postgres/static';
import { deriveParamMetadata, encodeParamsWithMetadata } from '@internal/sql-runtime';
import { describe, expect, it } from 'vitest';
import { vector } from '../src/exports/column-types';
import pgvector from '../src/exports/pack';
import pgvectorRuntime from '../src/exports/runtime';

const contract = defineContract(
  { requiredCapabilities: [...postgres18, ...postgresDriver], extensions: { pgvector } },
  ({ field, model, type }) => ({
    models: {
      Doc: model('Doc', {
        fields: {
          id: field.column(type.Char(36)).id(),
          anyLength: field.column(vector()),
          fixed: field.column(vector(3)),
        },
      }),
    },
  }),
);

function encodeInsert(row: { anyLength: number[]; fixed: number[] }) {
  const { sql, context } = postgresStatic({ contract, extensions: [pgvectorRuntime] });
  const plan = sql.public.Doc.insert([{ id: 'a', ...row }]).build();
  const metadata = deriveParamMetadata(plan.ast);
  return {
    codecs: metadata.map((param) => param.codec),
    encoded: encodeParamsWithMetadata(plan.params, metadata, {}, context.contractCodecs),
  };
}

describe('a vector() column beside a vector(3) column in one query', () => {
  it('binds each value to its own column codec', async () => {
    const { codecs, encoded } = encodeInsert({ anyLength: [1, 2], fixed: [1, 2, 3] });
    expect(codecs).toEqual([
      { codecId: 'sql/char@1', typeParams: { length: 36 } },
      { codecId: 'pg/vector@1' },
      { codecId: 'pg/vector@1', typeParams: { length: 3 } },
    ]);
    expect(await encoded).toEqual(['a', '[1,2]', '[1,2,3]']);
  });

  it('checks the length of the vector(3) value only', async () => {
    await expect(encodeInsert({ anyLength: [1, 2, 3, 4], fixed: [1, 2] }).encoded).rejects.toThrow(
      'Vector length mismatch: expected 3, got 2',
    );
  });
});
