import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';

const demoContractPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../examples/prisma-8-demo/src/prisma/contract.json',
);

function demoContractWithPostIndexes(
  edit: (index: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  const json = JSON.parse(readFileSync(demoContractPath, 'utf-8'));
  const post = json.storage.namespaces.public.entries.table.post;
  post.indexes = post.indexes.map((index: Record<string, unknown>) =>
    index['prefix'] === 'post_title_search' ? edit(index) : index,
  );
  return json;
}

describe('loading a contract with a full-text index', () => {
  it('loads the emitted contract', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(demoContractWithPostIndexes((i) => i)),
    ).not.toThrow();
  });

  it('refuses a full-text index whose columns are not the fields of its weight groups', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(
        demoContractWithPostIndexes((index) => ({ ...index, columns: ['userId'] })),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
  });

  it('refuses a unique full-text index', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(
        demoContractWithPostIndexes((index) => ({ ...index, unique: true })),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
  });

  it('refuses a full-text index whose options are not a full-text definition', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(
        demoContractWithPostIndexes((index) => ({
          ...index,
          options: { weightGroups: [['title']], language: 'klingon' },
        })),
      ),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.INDEX_INVALID' }));
  });

  it('refuses a full-text index over a column that is not text', () => {
    expect(() =>
      new PostgresContractSerializer().deserializeContract(
        demoContractWithPostIndexes((index) => ({
          ...index,
          columns: ['id'],
          options: { weightGroups: [['id']], language: 'english' },
        })),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INDEX_INVALID',
        message: expect.stringContaining('"id" is stored as `pg/uuid@1`'),
      }),
    );
  });
});
