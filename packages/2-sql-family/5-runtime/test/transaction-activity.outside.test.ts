import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import {
  afterHookNames,
  createSetup,
  failingDecodePlan,
  meta,
  names,
  rawPlan,
  type Setup,
  testContract,
} from './transaction-activity-fixtures';
import { stubAst } from './utils';

describe('a statement outside a transaction', () => {
  const scopes = {
    runtime: async (setup: Setup) => setup.runtime,
    connection: async (setup: Setup) => setup.runtime.connection(),
  };

  describe.each(Object.entries(scopes))('in %s scope', (_scope, queryableOf) => {
    it('finalizes a query committed right after it ends, with no parent', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.query(rawPlan('select 1')).toArray();

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:succeeded',
        'finalized:statement:committed',
      ]);
      const [started] = setup.events;
      expect(started?.ctx?.parent).toBeUndefined();
      expect(started?.ctx?.inTransaction()).toBe(false);
    });

    it('finalizes an execute committed right after it ends', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await queryable.execute(rawPlan('update t set x = 1'));

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:succeeded',
        'finalized:statement:committed',
      ]);
    });

    it('finalizes a query unknown when the driver throws', async () => {
      const setup = createSetup({ failures: { query: new Error('query failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow('query failed');

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('finalizes an execute unknown when the driver throws', async () => {
      const setup = createSetup({ failures: { execute: new Error('execute failed') } });
      const queryable = await queryableOf(setup);

      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'execute failed',
      );

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('ends stopped and finalizes unknown once when the caller stops reading the rows', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      for await (const _row of queryable.query(rawPlan('select 1'))) {
        break;
      }

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:stopped',
        'finalized:statement:unknown',
      ]);
    });

    it('ends failed and finalizes unknown once when the signal aborts between rows', async () => {
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

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('ends failed and finalizes unknown once when a row fails to decode', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);

      await expect(queryable.query(failingDecodePlan()).toArray()).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
      });

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('ends failed and finalizes unknown when the signal aborts during the marker read', async () => {
      const controller = new AbortController();
      const setup = createSetup({
        readMarker: async () => {
          controller.abort();
          return { kind: 'absent' };
        },
      });
      const queryable = await queryableOf(setup);

      await expect(
        queryable.execute(rawPlan('update t set x = 1'), { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('ends failed and finalizes unknown when the marker read fails', async () => {
      const setup = createSetup({
        readMarker: async () => {
          throw new Error('marker read failed');
        },
      });
      const queryable = await queryableOf(setup);

      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'marker read failed',
      );
      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow(
        'marker read failed',
      );

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:failed',
        'finalized:statement:unknown',
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('ends failed and finalizes unknown a statement whose beforeEncode throws', async () => {
      const setup = createSetup({ beforeHookFailure: new Error('before-hook failed') });
      const queryable = await queryableOf(setup);

      await expect(queryable.query(rawPlan('select 1')).toArray()).rejects.toThrow(
        'before-hook failed',
      );
      await expect(queryable.execute(rawPlan('update t set x = 1'))).rejects.toThrow(
        'before-hook failed',
      );

      expect(names(setup.events)).toEqual([
        'started:statement',
        'beforeEncode',
        'ended:statement:failed',
        'finalized:statement:unknown',
        'started:statement',
        'beforeEncode',
        'ended:statement:failed',
        'finalized:statement:unknown',
      ]);
    });

    it('finalizes a prepared query and a prepared execute committed', async () => {
      const setup = createSetup();
      const queryable = await queryableOf(setup);
      const rows = await setup.runtime.prepare({}, () => ({ ast: stubAst(), params: [], meta }));
      const count = await setup.runtime.prepare({}, () =>
        planFromAst<AffectedCount>(RawQueryAst.affectedCount(['update t set x = 1']), testContract),
      );

      await rows.query(queryable, {}).toArray();
      await count.execute(queryable, {});

      expect(afterHookNames(setup.events)).toEqual([
        'ended:statement:succeeded',
        'finalized:statement:committed',
        'ended:statement:succeeded',
        'finalized:statement:committed',
      ]);
    });
  });

  it('passes the same activity and context to every hook of a statement', async () => {
    const { runtime, events } = createSetup();

    await runtime.query(rawPlan('select 1')).toArray();

    expect(names(events)).toEqual([
      'started:statement',
      'beforeEncode',
      'ended:statement:succeeded',
      'finalized:statement:committed',
    ]);
    expect(new Set(events.map((event) => event.ctx)).size).toBe(1);
    expect(new Set(events.flatMap((event) => event.activity ?? [])).size).toBe(1);
  });
});
