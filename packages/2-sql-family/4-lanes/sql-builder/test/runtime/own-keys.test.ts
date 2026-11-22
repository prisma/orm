import { validateSqlContractFully } from '@internal/sql-contract/validators';
import type { InsertAst } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { mergeScopes } from '../../src/runtime/builder-base';
import { sql } from '../../src/runtime/sql';
import type { ScopeField } from '../../src/scope';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

const sqlContract = validateSqlContractFully<Contract>(contractJson);

function db() {
  return sql({
    context: {
      operations: {},
      codecs: {},
      queryOperations: { entries: () => ({}) },
      aggregateDescriptors: { resolve: () => undefined, values: function* () {} },
      types: {},
      applyMutationDefaults: () => [],
      contract: sqlContract,
    } as unknown as ExecutionContext<typeof sqlContract>,
    rawCodecInferer: { inferCodec: () => 'pg/text@1' },
  });
}

type Untyped = Record<
  'select' | 'orderBy' | 'groupBy' | 'distinctOn' | 'returning',
  (...args: unknown[]) => Untyped
> & { buildAst(): unknown };

function untyped(query: unknown): Untyped {
  return query as Untyped;
}

function unknownColumnCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

const text: ScopeField = { codecId: 'pg/text@1', nullable: false };

describe('a column name every object has as a property', () => {
  it('is an unknown column to select, orderBy, groupBy, distinctOn and returning', () => {
    const users = () => untyped(db().public.users);
    expect({
      select: unknownColumnCode(() => users().select('constructor')),
      orderBy: unknownColumnCode(() => users().select('id').orderBy('constructor')),
      groupBy: unknownColumnCode(() => users().select('id').groupBy('constructor')),
      distinctOn: unknownColumnCode(() => users().select('id').distinctOn('toString')),
      returning: unknownColumnCode(() =>
        untyped(db().public.users.insert([{ id: 1, name: 'A', email: 'a@b.com' }])).returning(
          'constructor',
        ),
      ),
    }).toEqual({
      select: 'ORM.COLUMN_UNKNOWN',
      orderBy: 'ORM.COLUMN_UNKNOWN',
      groupBy: 'ORM.COLUMN_UNKNOWN',
      distinctOn: 'ORM.COLUMN_UNKNOWN',
      returning: 'ORM.COLUMN_UNKNOWN',
    });
  });

  it('stays in the merged scope when only one side has it', () => {
    const merged = mergeScopes(
      { topLevel: { constructor: text, a: text }, namespaces: {} },
      { topLevel: { a: text }, namespaces: {} },
    );
    expect(Object.keys(merged.topLevel)).toEqual(['constructor']);
  });

  it('orders by a selected alias named __proto__', () => {
    const query = untyped(db().public.users)
      .select('__proto__', (f: { id: unknown }) => f.id)
      .orderBy('__proto__');
    expect(query.buildAst()).toMatchObject({
      orderBy: [{ expr: { kind: 'identifier-ref', name: '__proto__' } }],
    });
  });

  it('keeps an insert value keyed __proto__ as an own key', () => {
    const row = Object.fromEntries([
      ['id', 1],
      ['__proto__', 2],
    ]);
    const ast = untyped(db().public.users.insert([row as never])).buildAst() as InsertAst;
    const [built] = ast.rows;
    expect({
      keys: Object.keys(built ?? {}),
      prototypeIsPlain: Object.getPrototypeOf(built) === Object.prototype,
    }).toEqual({ keys: ['id', '__proto__'], prototypeIsPlain: true });
  });

  it('carries no codec for an insert value keyed constructor', () => {
    const ast = untyped(
      db().public.users.insert([{ id: 1, constructor: 'x' } as never]),
    ).buildAst() as InsertAst;
    expect(ast.rows[0]?.['constructor']).toMatchObject({ kind: 'param-ref', codec: undefined });
  });
});
