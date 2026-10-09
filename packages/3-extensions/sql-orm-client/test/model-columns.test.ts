import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import {
  type AnyQueryAst,
  DerivedTableSource,
  type ProjectionItem,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Collection } from '../src/collection';
import { resolveModelColumns, resolveTableColumns } from '../src/query-plan-meta';
import {
  compileDeleteReturning,
  compileInsertReturning,
  compileUpdateReturning,
  compileUpsertReturning,
} from '../src/query-plan-mutations';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { field, model, rel } from './contract-builder';
import { defineContractWithTables } from './contract-with-tables';
import {
  buildMixedPolyContract,
  buildStiPolyContract,
  buildTestContextFromContract,
  createMockRuntime,
} from './helpers';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
    email: field.column(textColumn),
  },
}).sql({ table: 'users' });

const Post = model('Post', {
  fields: {
    id: field.column(int4Column).id(),
    title: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
}).sql({ table: 'posts' });

const User = UserBase.relations({
  posts: rel.hasMany(() => Post, { by: 'userId' }),
}).sql({ table: 'users' });

const extraText = { descriptor: { codecId: 'pg/text@1' }, nullable: true };

const contract = defineContractWithTables({ User, Post }, [
  { tableName: 'users', columns: [{ columnName: 'legacy_key', ...extraText }] },
  { tableName: 'posts', columns: [{ columnName: 'internal_note', ...extraText }] },
]);
const context = buildTestContextFromContract(contract);

interface LooseCollection {
  include(
    relation: string,
    refine?: (related: LooseCollection) => LooseCollection,
  ): LooseCollection;
  distinct(...fields: string[]): LooseCollection;
  readonly state: CollectionState;
}

function collection(modelName: 'User' | 'Post'): LooseCollection {
  return new Collection({ runtime: createMockRuntime(), context } as never, modelName, {
    namespaceId: 'public',
  }) as unknown as LooseCollection;
}

function projectedColumns(items: readonly ProjectionItem[] | undefined): string[] {
  return (items ?? []).map((item) => item.alias);
}

function selectAstOf(ast: AnyQueryAst): SelectAst {
  expect(ast).toBeInstanceOf(SelectAst);
  return ast as SelectAst;
}

function childRowsOf(ast: SelectAst, alias: string): SelectAst {
  const expr = ast.projection.find((projection) => projection.alias === alias)?.expr;
  if (!(expr instanceof SubqueryExpr)) throw new TypeError(`No subquery projected as ${alias}`);
  const subquery = expr.query;
  const source = subquery.from;
  return source instanceof DerivedTableSource ? source.query : subquery;
}

function returningOf(ast: AnyQueryAst): string[] {
  return projectedColumns((ast as unknown as { returning?: readonly ProjectionItem[] }).returning);
}

describe('resolveModelColumns', () => {
  it('reads the columns a model maps, not a column no field maps', () => {
    expect(resolveTableColumns(contract, 'public', 'users')).toContain('legacy_key');
    expect(resolveModelColumns(contract, 'public', 'User', 'users')).toEqual(['id', 'email']);
  });

  it('reads a single-table base model and every variant on its table', () => {
    const poly = buildStiPolyContract();
    expect(resolveModelColumns(poly, 'public', 'User', 'users')).toEqual(
      resolveTableColumns(poly, 'public', 'users'),
    );
  });

  it('reads a single-table variant and its base, not a sibling variant', () => {
    const poly = buildStiPolyContract();
    const columns = resolveModelColumns(poly, 'public', 'Admin', 'users');
    expect(columns).toContain('role');
    expect(columns).not.toContain('plan');
  });

  it('reads the key a multi-table variant inherits on its own table', () => {
    const poly = buildMixedPolyContract();
    expect(resolveModelColumns(poly, 'public', 'Feature', 'features')).toEqual(
      expect.arrayContaining(['id', 'priority']),
    );
  });
});

describe('a query with no select reads only the model columns', () => {
  it('in the default projection', () => {
    const plan = compileSelect(contract, 'public', 'users', collection('User').state, 'User');
    expect(projectedColumns(selectAstOf(plan.ast).projection)).not.toContain('legacy_key');
  });

  it('in an include child projection', () => {
    const state = collection('User').include('posts').state;
    const plan = compileSelectWithIncludes(
      contract,
      context.aggregateDescriptors,
      'public',
      'users',
      state,
      'User',
    );
    const ast = selectAstOf(plan.ast);
    expect(projectedColumns(ast.projection)).not.toContain('legacy_key');
    expect(projectedColumns(childRowsOf(ast, 'posts').projection)).not.toContain('internal_note');
  });

  it('in an include with distinct', () => {
    const state = collection('User').include('posts', (posts) =>
      posts.distinct('title').include('author'),
    ).state;
    const plan = compileSelectWithIncludes(
      contract,
      context.aggregateDescriptors,
      'public',
      'users',
      state,
      'User',
    );
    expect(JSON.stringify(plan.ast)).not.toContain('internal_note');
  });

  it('in RETURNING', () => {
    const insert = compileInsertReturning(
      contract,
      'public',
      'Post',
      'posts',
      [{ id: 1, title: 'A', user_id: 1 }],
      undefined,
    );
    const update = compileUpdateReturning(
      contract,
      'public',
      'Post',
      'posts',
      { title: 'B' },
      [],
      undefined,
    );
    const del = compileDeleteReturning(contract, 'public', 'Post', 'posts', [], undefined);
    const upsert = compileUpsertReturning(
      contract,
      'public',
      'Post',
      'posts',
      { id: 1, title: 'A', user_id: 1 },
      { title: 'B' },
      ['id'],
      undefined,
    );
    for (const plan of [insert, update, del, upsert]) {
      expect(returningOf(plan.ast)).toEqual(['id', 'title', 'user_id']);
    }
  });
});
