import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { getAllTableColumns } from '../src/collection-contract';
import { buildOrmPlanMeta, buildOrmQueryPlan, deriveParamsFromAst } from '../src/query-plan-meta';
import { baseContract } from './collection-fixtures';
import { unboundTables } from './unbound-tables';

describe('query plan meta', () => {
  it('resolves table columns and rejects unknown tables', () => {
    expect(getAllTableColumns(baseContract, 'public', 'users')).toEqual(
      Object.keys(unboundTables(baseContract.storage)['users']!.columns),
    );
    expect(() => getAllTableColumns(baseContract, 'public', 'missing')).toThrow(
      'Unknown table "missing" in SQL ORM query planner',
    );
  });

  it('includes profileHash in plan meta and carries no sidecars', () => {
    expect(buildOrmPlanMeta(baseContract)).toEqual({
      target: baseContract.target,
      targetFamily: baseContract.targetFamily,
      storageHash: baseContract.storage.storageHash,
      profileHash: baseContract.profileHash,
      lane: 'orm-client',
    });
  });

  it('omits profileHash from plan meta when the contract carries none', () => {
    const { profileHash: _omit, ...rest } = baseContract;
    const noProfileContract = rest as typeof baseContract;
    const meta = buildOrmPlanMeta(noProfileContract);
    expect(meta).not.toHaveProperty('profileHash');
    expect(meta).toMatchObject({ lane: 'orm-client' });
  });

  it('produces a plan whose meta carries no execution-metadata sidecars', () => {
    const ast = SelectAst.from(TableSource.named('users'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
        ProjectionItem.of('email', ColumnRef.of('users', 'email'), { codecId: 'pg/text@1' }),
      ])
      .withLimit(5);

    const { params } = deriveParamsFromAst(ast);
    const plan = buildOrmQueryPlan(baseContract, ast, params);

    expect(plan.meta).not.toHaveProperty('paramDescriptors');
    expect(plan.meta).not.toHaveProperty('projectionTypes');
    expect(plan.meta).not.toHaveProperty('refs');
    expect(plan.meta.annotations?.['codecs']).toBeUndefined();
  });

  it('codecIds for projections live on ProjectionItem, not the meta', () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('users', 'id'), { codecId: 'pg/int4@1' }),
      ProjectionItem.of('email', ColumnRef.of('users', 'email'), { codecId: 'pg/text@1' }),
    ]);

    const plan = buildOrmQueryPlan(baseContract, ast, []);

    expect(plan.ast.kind).toBe('select');
    if (plan.ast.kind !== 'select') return;
    expect(plan.ast.projection.map((item) => [item.alias, item.codec?.codecId])).toEqual([
      ['id', 'pg/int4@1'],
      ['email', 'pg/text@1'],
    ]);
  });
});
