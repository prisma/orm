import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { relatedReadsOf } from '../src/collection-dispatch';
import { type CollectionTables, createIncludeTables } from '../src/collection-tables';
import { createTableScope } from '../src/table-scope';
import { emptyState, type IncludeExpr } from '../src/types';
import { baseContract } from './collection-fixtures';

function combinedInclude(relationName: string, branchName: string): IncludeExpr {
  const scope = createTableScope();
  const tables: CollectionTables = {
    scope,
    root: scope.aliasTable({ namespaceId: 'public', tableName: 'users' }),
    variants: new Map(),
  };
  const relation = resolveIncludeRelation(baseContract, 'public', 'User', 'posts');
  const state = emptyState(createIncludeTables(baseContract, tables, relation).tables);
  return {
    ...relation,
    relationName,
    nested: state,
    scalar: undefined,
    combine: { [branchName]: { kind: 'rows', state } },
  };
}

describe('relatedReadsOf', () => {
  it('names an include without combine() by its relation', () => {
    const include: IncludeExpr = { ...combinedInclude('posts', 'rows'), combine: undefined };

    expect(relatedReadsOf(include).map((read) => read.name)).toEqual(['posts']);
  });

  it('gives branches of different relations different names when their joined names are equal', () => {
    const [first] = relatedReadsOf(combinedInclude('posts', 'recent__rows'));
    const [second] = relatedReadsOf(combinedInclude('posts__recent', 'rows'));

    expect(first?.name).not.toBe(second?.name);
  });
});
