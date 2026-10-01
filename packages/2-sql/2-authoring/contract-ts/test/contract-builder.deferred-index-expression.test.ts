/**
 * An index expression may be deferred: the author names fields and supplies a
 * renderer, and lowering resolves each field to its storage column before
 * rendering. That is the only way an expression index can survive a
 * `.column()` override or a contract-level column naming convention, both of
 * which are unknown while the model is being authored.
 */
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { type ContractInput, defineContract, field, model } from '../src/contract-builder';
import type { DeferredIndexColumn } from '../src/contract-dsl';
import { columnDescriptor } from './helpers/column-descriptor';
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

const render = (columns: readonly DeferredIndexColumn[]) =>
  `to_tsvector('english', "${columns[0]?.name}")`;

function messageIndexes(options: {
  readonly mappedColumn?: string;
  readonly naming?: ContractInput['naming'];
}) {
  const searchText = options.mappedColumn
    ? field.column(textColumn).column(options.mappedColumn)
    : field.column(textColumn);
  const contract = defineContract({
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...(options.naming !== undefined ? { naming: options.naming } : {}),
    models: {
      Message: model('Message', {
        fields: { id: field.column(int4Column).id(), searchText },
      }).sql(({ cols, constraints }) => ({
        table: 'message',
        indexes: [
          constraints.index({
            expression: { fields: [cols.searchText], render },
            name: 'message_text_search',
          }),
        ],
      })),
    },
  });
  return unboundTables(contract.storage)['message']!.indexes;
}

describe('a deferred index expression', () => {
  it('renders the column name the default mapping produces', () => {
    expect(messageIndexes({})[0]).toMatchObject({
      expression: `to_tsvector('english', "searchText")`,
      prefix: 'message_text_search',
    });
  });

  it('renders a .column() override, not the field name', () => {
    expect(messageIndexes({ mappedColumn: 'body_text' })[0]).toMatchObject({
      expression: `to_tsvector('english', "body_text")`,
    });
  });

  it("renders the contract's column naming convention", () => {
    expect(messageIndexes({ naming: { columns: 'snake_case' } })[0]).toMatchObject({
      expression: `to_tsvector('english', "search_text")`,
    });
  });

  it('lowers to exactly what the equivalent string expression lowers to', () => {
    const deferred = messageIndexes({ mappedColumn: 'body_text' });
    const literal = defineContract({
      family: bareFamilyPack,
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      models: {
        Message: model('Message', {
          fields: {
            id: field.column(int4Column).id(),
            searchText: field.column(textColumn).column('body_text'),
          },
        }).sql(({ constraints }) => ({
          table: 'message',
          indexes: [
            constraints.index({
              expression: `to_tsvector('english', "body_text")`,
              name: 'message_text_search',
            }),
          ],
        })),
      },
    });

    expect(deferred).toEqual(unboundTables(literal.storage)['message']!.indexes);
  });
});
