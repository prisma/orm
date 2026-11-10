/**
 * `this.setDefault` derives its operation class from the migration's start contract, after the renames made earlier in the same migration: widening when the column has a default there, additive otherwise. It carries no postcheck.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import { PostgresMigration } from '../src/core/migrations/postgres-migration';
import {
  boxContract,
  codecControlStack,
  exposedMigration,
  type Op,
  serializedContract,
} from './fixtures/start-contract-migration';

const CHANGED_TO_TWO = {
  schema: 'public',
  table: 'Box',
  column: col('changed', 'int4', { default: lit(2) }),
} as const;

type EarlierRename =
  | { readonly kind: 'table'; readonly to: string }
  | { readonly kind: 'column'; readonly to: string };

async function setDefaultAfterRename(rename: EarlierRename): Promise<Op> {
  const renamed =
    rename.kind === 'table'
      ? { table: rename.to, column: 'changed' }
      : { table: 'Box', column: rename.to };
  const startJson = serializedContract(boxContract({ kind: 'literal', value: 1 }));
  const endJson = serializedContract(boxContract({ kind: 'literal', value: 2 }, 'public', renamed));
  class RenameThenSetDefault extends PostgresMigration {
    override readonly startContractJson = startJson;
    override readonly endContractJson = endJson;
    override get operations(): readonly Promise<Op>[] {
      return [
        ...(rename.kind === 'table'
          ? this.renameTable({ table: 'Box', to: rename.to })
          : this.renameColumn({ table: 'Box', column: 'changed', to: rename.to })),
        this.setDefault({
          schema: 'public',
          table: renamed.table,
          column: col(renamed.column, 'int4', { default: lit(2) }),
        }),
      ];
    }
  }
  const ops = await Promise.all(new RenameThenSetDefault(codecControlStack()).operations);
  const last = ops.at(-1);
  if (last === undefined) throw new Error('the migration has no operations');
  return last;
}

describe('this.setDefault operation class', () => {
  it('is additive and carries no postcheck without a start contract', async () => {
    const op = await exposedMigration(null).callSetDefault(CHANGED_TO_TWO);

    expect({ operationClass: op.operationClass, postcheck: op.postcheck }).toEqual({
      operationClass: 'additive',
      postcheck: [],
    });
  });

  it('is additive and carries no postcheck when the start column has no default', async () => {
    const op = await exposedMigration(boxContract(undefined)).callSetDefault(CHANGED_TO_TWO);

    expect({ operationClass: op.operationClass, postcheck: op.postcheck }).toEqual({
      operationClass: 'additive',
      postcheck: [],
    });
  });

  it('is widening and carries no postcheck when the start column has a different default', async () => {
    const op = await exposedMigration(boxContract({ kind: 'literal', value: 1 })).callSetDefault(
      CHANGED_TO_TWO,
    );

    expect({ operationClass: op.operationClass, postcheck: op.postcheck }).toEqual({
      operationClass: 'widening',
      postcheck: [],
    });
  });

  it('is widening when the start column already has the same default', async () => {
    const op = await exposedMigration(boxContract({ kind: 'literal', value: 2 })).callSetDefault(
      CHANGED_TO_TWO,
    );

    expect(op.operationClass).toBe('widening');
  });

  it('is widening in the unbound namespace when the default namespace start column has a default', async () => {
    const op = await exposedMigration(
      boxContract({ kind: 'literal', value: 1 }, UNBOUND_NAMESPACE_ID),
    ).callSetDefault({ ...CHANGED_TO_TWO, schema: UNBOUND_NAMESPACE_ID });

    expect(op.operationClass).toBe('widening');
  });

  it('is additive when only a same-named table in another schema has a default', async () => {
    const op = await exposedMigration(boxContract({ kind: 'literal', value: 1 })).callSetDefault({
      ...CHANGED_TO_TWO,
      schema: 'auth',
    });

    expect(op.operationClass).toBe('additive');
  });

  it('is widening on a table an earlier renameTable renamed, when the start column has a default', async () => {
    const op = await setDefaultAfterRename({ kind: 'table', to: 'Crate' });

    expect(op.operationClass).toBe('widening');
  });

  it('is widening on a column an earlier renameColumn renamed, when the start column has a default', async () => {
    const op = await setDefaultAfterRename({ kind: 'column', to: 'altered' });

    expect(op.operationClass).toBe('widening');
  });
});
