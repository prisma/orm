import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import {
  afterHookNames,
  createSetup,
  meta,
  names,
  rawPlan,
  type Setup,
  testContract,
  transactionCases,
} from './after-transaction-fixtures';
import { stubAst } from './utils';

describe('afterTransaction outside a transaction', () => {
  const scopes = {
    runtime: async (setup: Setup) => setup.runtime,
    connection: async (setup: Setup) => setup.runtime.connection(),
  };

  describe.each(Object.entries(scopes))('in %s scope', (_scope, queryableOf) => {
    it('fires committed right after afterQuery', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.query(rawPlan('select 1')).toArray();

      expect(afterHookNames(setup.events)).toEqual(['afterQuery', 'afterTransaction:committed']);
    });

    it('fires committed right after afterExecute', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.execute(rawPlan('update t set x = 1'));

      expect(afterHookNames(setup.events)).toEqual(['afterExecute', 'afterTransaction:committed']);
    });

    it('fires unknown after afterQuery when the driver throws', async () => {
      const setup = createSetup({ failures: { query: new Error('query failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow('query failed');

      expect(afterHookNames(setup.events)).toEqual(['afterQuery', 'afterTransaction:unknown']);
    });

    it('fires unknown after afterExecute when the driver throws', async () => {
      const setup = createSetup({ failures: { execute: new Error('execute failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'execute failed',
      );

      expect(afterHookNames(setup.events)).toEqual(['afterExecute', 'afterTransaction:unknown']);
    });

    it('fires unknown once when the caller stops reading the rows', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      for await (const _row of queryable.query(rawPlan('select 1'))) {
        break;
      }

      expect(afterHookNames(setup.events)).toEqual(['afterTransaction:unknown']);
    });

    it('fires unknown once when the signal aborts between rows', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);
      const controller = new AbortController();

      await expect(
        (async () => {
          for await (const _row of queryable.query(rawPlan('select 1'), {
            signal: controller.signal,
          })) {
            controller.abort();
          }
        })(),
      ).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });

      expect(afterHookNames(setup.events)).toEqual(['afterTransaction:unknown']);
    });

    it('fires nothing for a query whose before-hook throws before its plan is encoded', async () => {
      const setup = createSetup({ beforeHookFailure: new Error('before-hook failed') });
      const queryable = await queryableOf(setup);

      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow(
        'before-hook failed',
      );
      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'before-hook failed',
      );

      expect(names(setup.events)).toEqual(['beforeQuery', 'beforeExecute']);
    });

    it('fires committed after a prepared query and a prepared execute', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);
      const rows = await setup.runtime.prepare({}, () => ({ ast: stubAst(), params: [], meta }));
      const count = await setup.runtime.prepare({}, () =>
        planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update t set x = 1']), testContract),
      );

      await rows.query(queryable, {}).toArray();
      await count.execute(queryable, {});

      expect(afterHookNames(setup.events)).toEqual([
        'afterQuery',
        'afterTransaction:committed',
        'afterExecute',
        'afterTransaction:committed',
      ]);
    });
  });

  it('passes the plan and planExecutionId the after-hook saw', async () => {
    const { runtime, events } = createSetup();

    await runtime.query(rawPlan('select 1')).toArray();

    const [afterQuery, afterTransaction] = events.filter((event) => event.name.startsWith('after'));
    expect(afterTransaction?.plan).toBe(afterQuery?.plan);
    expect(afterTransaction?.planExecutionId).toBe(afterQuery?.planExecutionId);
  });
});

describe('a runtime whose middleware do not declare afterTransaction', () => {
  function createSetupThatDeclaresAfterTransactionLate(
    failures: (typeof transactionCases)[number]['failures'] = {},
  ) {
    const setup = createSetup({ failures, declaresAfterTransaction: false });
    setup.middleware.afterTransaction = setup.afterTransaction;
    return setup;
  }

  it.each([
    { scope: 'runtime', queryableOf: async (setup: Setup) => setup.runtime },
    { scope: 'connection', queryableOf: async (setup: Setup) => setup.runtime.connection() },
  ])('runs the after-hooks and no stage in $scope scope', async ({ queryableOf }) => {
    const setup = createSetupThatDeclaresAfterTransactionLate();
    const queryable = await queryableOf(setup);

    await queryable.query(rawPlan('select 1')).toArray();
    await queryable.execute(rawPlan('update t set x = 1'));

    expect(afterHookNames(setup.events)).toEqual(['afterQuery', 'afterExecute']);
  });

  it.each(transactionCases)(
    'runs the after-hooks and no stage in withTransaction when $title',
    async (testCase) => {
      const setup = createSetupThatDeclaresAfterTransactionLate(testCase.failures);

      const run = withTransaction(setup.runtime, async (tx) => {
        await tx.query(rawPlan('select 1')).toArray();
        await tx.execute(rawPlan('update t set x = 1'));
        if (testCase.callbackFails) throw new Error('callback failed');
      });

      if (testCase.error === undefined) {
        await run;
      } else {
        await expect(run).rejects.toThrow(testCase.error);
      }
      expect(names(setup.events).filter((name) => name.startsWith('after'))).toEqual([
        'afterQuery',
        'afterExecute',
      ]);
    },
  );
});
