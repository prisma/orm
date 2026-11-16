import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../../src/collection-tables';
import type { ColumnMapping } from '../../src/mutation-graph/edge';
import { JunctionFilterData } from '../../src/mutation-graph/junction-filter-data';
import { projectTableColumns } from '../../src/mutation-statements';
import { getTestContext } from '../helpers';
import { printExpression } from './print-expression';
import { positions } from './statements';

const { contract } = getTestContext();
const [from] = positions();

function tableOf(tableName: string) {
  return createStatementTables({ namespaceId: 'public', tableName }).root;
}

const users = tableOf('users');
const userTags = tableOf('user_tags');
const tags = tableOf('tags');

function mappings(
  source: typeof users,
  target: typeof users,
  names: readonly (readonly [string, string])[],
): ColumnMapping[] {
  const sources = projectTableColumns(
    contract,
    source,
    names.map(([column]) => column),
  );
  const targets = projectTableColumns(
    contract,
    target,
    names.map(([, column]) => column),
  );
  return sources.flatMap((item, index) => {
    const targetItem = targets[index];
    return targetItem === undefined ? [] : [[item, targetItem] as const];
  });
}

function edgeOf(targets: readonly (readonly [string, string])[]): JunctionFilterData {
  return new JunctionFilterData(
    from,
    mappings(users, userTags, [['id', 'user_id']]),
    userTags.tableSource(contract),
    mappings(userTags, tags, targets),
  );
}

describe('JunctionFilterData', () => {
  it('is frozen', () => {
    const edge = edgeOf([['tag_id', 'id']]);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
    expect(Object.isFrozen(edge.targets)).toBe(true);
  });

  it('gives the targets whose key the junction rows of the source row hold', () => {
    const condition = edgeOf([['tag_id', 'id']]).output({ id: 7, name: 'Ada' });

    expect(printExpression(condition, 'tags')).toBe(
      'id in (select tag_id from user_tags where user_id = 7)',
    );
  });

  it('compares a key of several columns as a row value', () => {
    const condition = edgeOf([
      ['tag_id', 'id'],
      ['user_id', 'name'],
    ]).output({ id: 7 });

    expect(printExpression(condition, 'tags')).toBe(
      '(id, name) in (select tag_id, user_id from user_tags where user_id = 7)',
    );
  });
});
