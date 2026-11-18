/**
 * An index's options may be a function rendered at lowering, from the storage columns its fields resolve to. A pack helper whose options name columns needs this, because a `.column()` override and the contract's column naming convention are both unknown while the model is being authored.
 */
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlExpression } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { type ContractInput, defineContract, field, model } from '../src/contract-builder';
import type { DeferredIndexColumn, IndexConstraint } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';
import { testIndexPack } from './helpers/test-index-pack';
import { unboundTables } from './unbound-tables';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

function messageIndexes(options: {
  readonly mappedColumn?: string;
  readonly naming?: ContractInput['naming'];
  readonly elements?: 'fields' | 'expression' | 'untyped string expression';
}) {
  const seen: DeferredIndexColumn[][] = [];
  const searchText = options.mappedColumn
    ? field.column(textColumn).column(options.mappedColumn)
    : field.column(textColumn);
  const contract = defineContract({
    ...testTypeLookups,
    family: bareFamilyPack,
    target: postgresTargetPack,
    extensions: { testIndexes: testIndexPack },
    createNamespace: createTestSqlNamespace,
    ...(options.naming !== undefined ? { naming: options.naming } : {}),
    models: {
      Message: model('Message', {
        fields: { id: field.column(int4Column).id(), title: field.column(textColumn), searchText },
      }).sql(({ cols }) => {
        const method = {
          type: 'hash',
          options: (columns: readonly DeferredIndexColumn[]) => {
            seen.push([...columns]);
            return { fields: [columns.map((column) => column.name)] };
          },
          name: 'message_search',
        };
        const untypedStringExpression = 'lower(title)' as unknown as SqlExpression;
        const index: IndexConstraint =
          options.elements === 'untyped string expression'
            ? { kind: 'index', expression: untypedStringExpression, ...method }
            : options.elements === 'expression'
              ? {
                  kind: 'index',
                  expression: {
                    fields: [cols.title, cols.searchText],
                    render: (columns) =>
                      columns.map((column) => `lower("${column.name}")`).join(', '),
                  },
                  ...method,
                }
              : { kind: 'index', fields: ['title', 'searchText'], ...method };
        return { table: 'message', indexes: [index] };
      }),
    },
  });
  return { indexes: unboundTables(contract.storage)['message']!.indexes, seen };
}

describe('deferred index options', () => {
  it('renders the options from the resolved columns, in field order', () => {
    const { indexes, seen } = messageIndexes({ mappedColumn: 'body_text' });

    expect(seen).toEqual([
      [
        { name: 'title', codecId: 'pg/text@1' },
        { name: 'body_text', codecId: 'pg/text@1' },
      ],
    ]);
    expect(indexes[0]).toMatchObject({
      columns: ['title', 'body_text'],
      type: 'hash',
      options: { fields: [['title', 'body_text']] },
      prefix: 'message_search',
    });
  });

  it("renders the options from the columns of a deferred expression's fields", () => {
    const { indexes, seen } = messageIndexes({ mappedColumn: 'body_text', elements: 'expression' });

    expect(seen).toEqual([
      [
        { name: 'title', codecId: 'pg/text@1' },
        { name: 'body_text', codecId: 'pg/text@1' },
      ],
    ]);
    expect(indexes[0]).toMatchObject({
      expression: 'lower("title"), lower("body_text")',
      type: 'hash',
      options: { fields: [['title', 'body_text']] },
      prefix: 'message_search',
    });
  });

  it('refuses a string expression from an untyped caller before rendering options over no fields', () => {
    const what = 'Index "message_search" expression';
    expect(() => messageIndexes({ elements: 'untyped string expression' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: `${what} must be a sql\`...\` value.`,
        meta: { what },
      }),
    );
  });

  it("renders the contract's column naming convention", () => {
    const { indexes } = messageIndexes({ naming: { columns: 'snake_case' } });

    expect(indexes[0]).toMatchObject({
      columns: ['title', 'search_text'],
      options: { fields: [['title', 'search_text']] },
    });
  });
});
