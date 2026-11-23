import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { assembleDataTypes } from '@internal/framework-components/codec';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  autoincrement,
  buildSqlContractFromDefinition,
  type ModelNode,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import {
  POLYMORPHIC_DISCRIMINATOR_ALIAS,
  resolvePolymorphismInfo,
} from '../../src/collection-contract';
import { createPolymorphicRowMapper, mapPolymorphicRow } from '../../src/collection-runtime';
import { createCollectionTables } from '../../src/collection-tables';
import { upsertGraph } from '../../src/statement-graph/collection-graphs';
import { rowThatCannotConflict } from '../../src/statement-graph/conflict-keys';
import { mappedUpdateRow } from '../../src/statement-graph/storage-rows';
import { emptyState } from '../../src/types';
import { generatedKeyColumn } from '../../src/written-keys';
import { defineContract, field, model } from '../contract-builder';
import { buildTestContextFromContract } from '../helpers';

const Tag = model('Tag', {
  fields: {
    constructor: field.column(int4Column).default(autoincrement()).id(),
    label: field.column(textColumn),
    slug: field.column(textColumn).unique(),
  },
}).sql({ table: 'tags' });

const withoutReturning: Contract<SqlStorage> = {
  ...defineContract({ models: { Tag } }),
  capabilities: { sql: { defaultInInsert: true } },
};
const context = { ...buildTestContextFromContract(withoutReturning), contract: withoutReturning };

function targetOf(contract: Contract<SqlStorage>, modelName: string) {
  return {
    context: { ...buildTestContextFromContract(contract), contract },
    state: emptyState(createCollectionTables(contract, 'public', modelName)),
    modelName,
    namespaceId: 'public',
  };
}

function polymorphicContract(): Contract<SqlStorage> {
  const dataTypeLookup = assembleDataTypes([postgresPack]).lookup;
  const codecLookup = assemblePostgresCodecRegistryWithBuiltins([], dataTypeLookup);
  const int4 = { codecId: 'pg/int4@1' } as const;
  const text = { codecId: 'pg/text@1' } as const;
  const models: readonly ModelNode[] = [
    {
      modelName: 'Task',
      tableName: 'task',
      namespaceId: 'public',
      fields: [
        { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
        { fieldName: 'title', columnName: 'title', descriptor: text, nullable: false },
        { fieldName: 'constructor', columnName: 'constructor', descriptor: text, nullable: false },
      ],
      id: { columns: ['id'] },
      discriminator: { field: 'constructor' },
      variants: { bug: crossRef('Bug', 'public') },
    },
    {
      modelName: 'Bug',
      tableName: 'bug',
      namespaceId: 'public',
      fields: [
        { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false },
        { fieldName: 'severity', columnName: 'severity', descriptor: text, nullable: false },
      ],
      id: { columns: ['id'] },
      base: crossRef('Task', 'public'),
    },
  ];
  return buildSqlContractFromDefinition(
    { warnings: undefined, target: postgresPack, createNamespace: postgresCreateNamespace, models },
    codecLookup,
    dataTypeLookup,
  );
}

describe('a key or discriminator column named constructor that the data leaves out', () => {
  it('is the generated key of an insert that gives it no value', () => {
    expect(
      generatedKeyColumn({
        context,
        namespaceId: 'public',
        tableName: 'tags',
        modelName: 'Tag',
        rows: [{ label: 'a', slug: 'a' }],
        method: 'create()',
        columns: ['constructor'],
      }),
    ).toBe('constructor');
  });

  it('makes a row that gives it no value one that cannot conflict on it', () => {
    expect(rowThatCannotConflict([{ label: 'a' }], [['constructor']], new Set())).toBe(0);
  });

  it('is no other unique key an upsert without insertOnConflictTarget can collide on', () => {
    expect(() =>
      upsertGraph(targetOf(withoutReturning, 'Tag'), { label: 'a', slug: 'a' }, { label: 'b' }, [
        'slug',
      ]),
    ).not.toThrow();
  });

  it('lets an update that leaves out the discriminator through', () => {
    const contract = polymorphicContract();
    expect(mappedUpdateRow(targetOf(contract, 'Task'), { title: 'b' })).toEqual({ title: 'b' });
  });

  it('reads the variant from the discriminator alias when the row leaves the column out', () => {
    const contract = polymorphicContract();
    const map = createPolymorphicRowMapper(
      contract,
      'public',
      'Task',
      resolvePolymorphismInfo(contract, 'public', 'Task')!,
      createCollectionTables(contract, 'public', 'Task'),
    );
    const row = {
      id: 1,
      title: 'a',
      [POLYMORPHIC_DISCRIMINATOR_ALIAS]: 'bug',
      bug__severity: 'high',
    };
    const polyInfo = resolvePolymorphismInfo(contract, 'public', 'Task')!;
    const tables = createCollectionTables(contract, 'public', 'Task');
    expect({
      mapper: map(row),
      mapped: mapPolymorphicRow(contract, 'public', 'Task', polyInfo, tables, row),
    }).toEqual({
      mapper: { id: 1, title: 'a', severity: 'high' },
      mapped: { id: 1, title: 'a', severity: 'high' },
    });
  });
});
