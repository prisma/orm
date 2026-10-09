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
import { mapSelectedFieldsToColumns } from '../src/collection-column-mapping';
import {
  columnOfCallerField,
  getAllTableColumns,
  getColumnsReadOnTable,
  getModelFieldColumns,
} from '../src/collection-contract';
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
  columnPassedForField,
  createMockRuntime,
  fieldUnknown,
  unmappedColumnPassed,
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
  orderBy(order: (model: Record<string, { desc(): unknown }>) => unknown): LooseCollection;
  select(...fields: string[]): LooseCollection;
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

describe('getColumnsReadOnTable', () => {
  it('reads the columns a model maps, not a column no field maps', () => {
    expect(getAllTableColumns(contract, 'public', 'users')).toContain('legacy_key');
    expect(getColumnsReadOnTable(contract, 'public', 'User', 'users')).toEqual(['id', 'email']);
  });

  it('reads a single-table base model and every variant on its table', () => {
    const poly = buildStiPolyContract();
    expect(getColumnsReadOnTable(poly, 'public', 'User', 'users')).toEqual(
      getAllTableColumns(poly, 'public', 'users'),
    );
  });

  it('reads a single-table variant and its base, not a sibling variant', () => {
    const poly = buildStiPolyContract();
    const columns = getColumnsReadOnTable(poly, 'public', 'Admin', 'users');
    expect(columns).toContain('role');
    expect(columns).not.toContain('plan');
  });

  it('reads the key a multi-table variant inherits on its own table', () => {
    const poly = buildMixedPolyContract();
    expect(getColumnsReadOnTable(poly, 'public', 'Feature', 'features')).toEqual(
      expect.arrayContaining(['id', 'priority']),
    );
  });
});

describe('the refusal of a name that is not a field', () => {
  const resolve = (c: typeof contract, model: string, name: string) =>
    columnOfCallerField(c, 'public', getModelFieldColumns(c, 'public', model), model, name);

  it('names the field when the name is the column of a field of the model', () => {
    expect(() => collection('Post').select('user_id')).toThrow(
      columnPassedForField('Post', 'user_id', 'userId'),
    );
  });

  it('says no field maps the name when it is a column of the model table', () => {
    expect(() => collection('User').select('legacy_key')).toThrow(
      unmappedColumnPassed('User', 'users', 'legacy_key'),
    );
  });

  it('names the variant table that holds a column no field maps', () => {
    const poly = buildMixedPolyContract();
    expect(() => resolve(poly, 'Task', 'internal_note')).toThrow(
      unmappedColumnPassed('Task', 'features', 'internal_note'),
    );
    expect(() =>
      mapSelectedFieldsToColumns(poly, 'public', 'Task', undefined, ['internal_note']),
    ).toThrow(unmappedColumnPassed('Task', 'features', 'internal_note'));
    expect(() => resolve(poly, 'Bug', 'internal_note')).toThrow(
      unmappedColumnPassed('Bug', 'features', 'internal_note'),
    );
  });

  it('adds nothing when the name is neither a column of a field nor of the table', () => {
    expect(() => resolve(contract, 'User', 'nickname')).toThrow(fieldUnknown('User', 'nickname'));
  });

  it('adds nothing for a column another table holds', () => {
    expect(() => resolve(contract, 'User', 'internal_note')).toThrow(
      fieldUnknown('User', 'internal_note'),
    );
  });

  it('adds nothing for a column a sibling variant maps', () => {
    const poly = buildStiPolyContract();
    expect(() => resolve(poly, 'Admin', 'plan')).toThrow(fieldUnknown('Admin', 'plan'));
  });
});

describe('a query with no select reads only the model columns', () => {
  it('in the default projection', () => {
    const plan = compileSelect(contract, 'public', 'User', 'users', collection('User').state);
    expect(projectedColumns(selectAstOf(plan.ast).projection)).not.toContain('legacy_key');
  });

  it('in an include child projection', () => {
    const state = collection('User').include('posts').state;
    const plan = compileSelectWithIncludes(
      contract,
      context.aggregateDescriptors,
      'public',
      'User',
      'users',
      state,
    );
    const ast = selectAstOf(plan.ast);
    expect(projectedColumns(ast.projection)).not.toContain('legacy_key');
    expect(projectedColumns(childRowsOf(ast, 'posts').projection)).not.toContain('internal_note');
  });

  it('in the ranked subquery of distinct', () => {
    const state = collection('User')
      .distinct('email')
      .orderBy((user) => user['id']!.desc()).state;
    const plan = compileSelect(contract, 'public', 'User', 'users', state);
    const ast = selectAstOf(plan.ast);
    const source = ast.from;
    if (!(source instanceof DerivedTableSource)) throw new TypeError('No ranked subquery');
    expect(projectedColumns(selectAstOf(source.query).projection)).toEqual([
      'id',
      'email',
      '__prisma_distinct_rn',
    ]);
  });

  it('in an include with distinct', () => {
    const state = collection('User').include('posts', (posts) =>
      posts.distinct('title').include('author'),
    ).state;
    const plan = compileSelectWithIncludes(
      contract,
      context.aggregateDescriptors,
      'public',
      'User',
      'users',
      state,
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

describe('a query pinned to a variant reads the base fields and that variant fields only', () => {
  function pinned(contractToUse: typeof contract, baseModel: string, variant: string) {
    const base = new Collection(
      {
        runtime: createMockRuntime(),
        context: buildTestContextFromContract(contractToUse),
      } as never,
      baseModel,
      { namespaceId: 'public' },
    ) as unknown as { variant(name: string): { state: CollectionState } };
    return base.variant(variant).state;
  }

  it('leaves out a sibling single-table variant column', () => {
    const poly = buildStiPolyContract();
    const plan = compileSelect(poly, 'public', 'User', 'users', pinned(poly, 'User', 'admin'));
    const columns = projectedColumns(selectAstOf(plan.ast).projection);
    expect(columns).toContain('role');
    expect(columns).not.toContain('plan');
  });

  it('leaves out a single-table variant column when pinned to a multi-table variant', () => {
    const poly = buildMixedPolyContract();
    const plan = compileSelect(poly, 'public', 'Task', 'tasks', pinned(poly, 'Task', 'feature'));
    const columns = projectedColumns(selectAstOf(plan.ast).projection);
    expect(columns).toContain('title');
    expect(columns).not.toContain('severity');
  });
});
