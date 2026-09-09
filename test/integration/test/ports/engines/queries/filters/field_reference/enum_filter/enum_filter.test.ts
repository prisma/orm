import postgresAdapter from '@internal/adapter-postgres/runtime';
import postgresDriver from '@internal/driver-postgres/runtime';
import { orm } from '@internal/sql-orm-client';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { ColumnRef } from '@internal/sql-relational-core/ast';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
// pi-lens-ignore: 2307
import postgresTarget, { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import { withPushedContractRuntime } from '../../../../../../sql-orm-client/integration-helpers';
import type { PgIntegrationRuntime } from '../../../../../../sql-orm-client/runtime-helpers';
import type { Contract } from '../_fixture/enum/generated/contract';
import contractJson from '../_fixture/enum/generated/contract.json' with { type: 'json' };
import { referencedScalarInList } from '../postgres-list-field-reference';

const column = (name: string) => ColumnRef.of('testModel', name);

const serializer = new PostgresContractSerializer();
const baseContract = serializer.deserializeContract(contractJson) as Contract;
const returningContract: Contract & {
  readonly capabilities: Contract['capabilities'] & {
    readonly returning: { readonly enabled: true };
  };
} = {
  ...baseContract,
  capabilities: {
    ...baseContract.capabilities,
    returning: { enabled: true },
  },
};

function withEnumFieldReference(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAndCount([
      { id: 1, enum: 'a', enum2: ['a', 'b'] },
      { id: 2, enum: 'b', enum2: ['a', 'c'] },
      { id: 3, enum2: [] },
    ]);
    await fn(ctx);
  });
}

function createEnumFieldReferenceDb(runtime: PgIntegrationRuntime) {
  const context = createExecutionContext<typeof returningContract>({
    contract: returningContract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      driver: postgresDriver,
      extensions: [],
    }),
  });

  return orm({ runtime, context });
}

describe('ports/engines/queries/filters/field-reference/enum-filter', () => {
  it(
    'returns native enum arrays through create() RETURNING',
    () =>
      withPushedContractRuntime(returningContract, async (runtime: PgIntegrationRuntime) => {
        const db = createEnumFieldReferenceDb(runtime);

        runtime.resetExecutions();
        const created = await db.public.TestModel.create({ id: 4, enum: 'a', enum2: ['a', 'b'] });

        expect(created).toEqual({ id: 4, enum: 'a', enum2: ['a', 'b'] });
        expect(runtime.executions).toHaveLength(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'reads native enum arrays without a projection cast',
    () =>
      withPushedContractRuntime(returningContract, async (runtime: PgIntegrationRuntime) => {
        const db = createEnumFieldReferenceDb(runtime);

        await db.public.TestModel.createAndCount([
          { id: 1, enum: 'a', enum2: ['a', 'b'] },
          { id: 2, enum: 'b', enum2: ['a', 'c'] },
          { id: 3, enum2: [] },
        ]);

        runtime.resetExecutions();
        const rows = await db.public.TestModel.select('id', 'enum2').all();

        expect(rows).toEqual([
          { id: 1, enum2: ['a', 'b'] },
          { id: 2, enum2: ['a', 'c'] },
          { id: 3, enum2: [] },
        ]);
        expectTypeOf(rows[0]!.enum2).toEqualTypeOf<ReadonlyArray<'a' | 'b' | 'c'>>();
        expect(runtime.executions).toHaveLength(1);
        const sql = runtime.executions[0]?.sql;
        if (!sql) throw new Error('no SQL captured');
        expect(sql).not.toContain('::text[]');
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withEnumFieldReference(async ({ db }) => {
        const scalar = column('enum');
        const list = column('enum2');
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(referencedScalarInList(scalar, list, true)), 'notIn').toEqual([{ id: 2 }]);
        expect(await ids(referencedScalarInList(scalar, list, true)), 'not: { in }').toEqual([
          { id: 2 },
        ]);
        expect(
          await db.public.TestModel.where(referencedScalarInList(scalar, list))
            .orderBy((row) => row.id.asc())
            .select('id', 'enum', 'enum2')
            .all(),
          'in',
        ).toEqual([{ id: 1, enum: 'a', enum2: ['a', 'b'] }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
