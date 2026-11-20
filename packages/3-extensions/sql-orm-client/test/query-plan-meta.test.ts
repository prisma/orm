import { describe, expect, it } from 'vitest';
import { getAllTableColumns } from '../src/collection-contract';
import { buildOrmPlanMeta } from '../src/query-plan-meta';
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
});
