import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import {
  autoincrement,
  check,
  defineContract,
  field,
  model,
  rel,
  sql,
} from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { contract as coreSurface } from '../authoring/parity/core-surface/contract';
import { contract as mapAttributes } from '../authoring/parity/map-attributes/contract';
import { contract as nativeEnum } from '../authoring/parity/native-enum/contract';
import { contract as relationBackrelationList } from '../authoring/parity/relation-backrelation-list/contract';
import {
  printAndReadBack,
  printContract,
  serializedWithoutCapabilities,
} from './print-and-read-back';

const Account = model('Account', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    email: field.column(textColumn),
  },
}).sql({
  table: 'account',
  checks: [
    check({ expression: sql`length(email) > 0`, name: 'account_email_not_blank' }),
    check({ expression: sql`id > 0`, map: 'account_id_positive' }),
  ],
});

const Session = model('Session', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    accountId: field.column(int4Column),
  },
  relations: {
    account: rel.belongsTo(Account, { from: 'accountId', to: 'id' }).sql({
      fk: { onDelete: 'cascade' },
    }),
  },
}).sql(({ cols, constraints }) => ({
  table: 'session',
  indexes: [constraints.index([cols.accountId])],
}));

const checksAndRelations = defineContract({ models: { Account, Session } });

const Author = model('Author', {
  fields: { id: field.column(int4Column).default(autoincrement()).id() },
  relations: { articles: rel.hasMany(() => Article, { by: 'authorId' }) },
}).sql({ table: 'author' });

const Article = model('Article', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    authorId: field.column(int4Column),
  },
}).sql({ table: 'article' });

const oneSidedRelation = defineContract({ models: { Author, Article } });

const cases: ReadonlyArray<{ readonly name: string; readonly contract: Contract<SqlStorage> }> = [
  {
    name: 'checks named by prefix and by exact name, a relation and an index',
    contract: checksAndRelations,
  },
  { name: 'the core surface: named types, enums, defaults, relations', contract: coreSurface },
  { name: 'mapped tables and columns', contract: mapAttributes },
  { name: 'a native enum', contract: nativeEnum },
  { name: 'a relation with a list back-relation', contract: relationBackrelationList },
];

describe('a TypeScript-authored contract printed as PSL reads back as the same contract', () => {
  it.each(cases)('$name', async ({ contract }) => {
    const printed = await printAndReadBack(contract);

    expect(serializedWithoutCapabilities(printed)).toEqual(serializedWithoutCapabilities(contract));
    expect(printed.storage.storageHash).toBe(contract.storage.storageHash);
  });

  it('refuses a hasMany relation when the other model declares no belongsTo', () => {
    expect(() => printContract(oneSidedRelation)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PRINT_UNSUPPORTED',
        meta: { model: 'Author', field: 'articles' },
      }),
    );
  });
});
