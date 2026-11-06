import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import {
  AggregateCommand,
  DeleteManyCommand,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoSkipStage,
  RawAggregateCommand,
  UpdateManyCommand,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it, vi } from 'vitest';
import { flattenMongoDraftLeaves } from '../src/draft-leaves';
import type { MongoMiddleware } from '../src/mongo-middleware';
import { baseMeta, createMockDriver } from './mongo-middleware-fixtures';
import { preparedRuntime } from './prepare-fixtures';

function aggregatePlan(...stages: ConstructorParameters<typeof AggregateCommand>[1]) {
  return { collection: 'users', command: new AggregateCommand('users', stages), meta: baseMeta };
}

function byEmail(p: { readonly email: MongoPreparedParamRef }) {
  return aggregatePlan(new MongoMatchStage(MongoFieldFilter.eq('email', p.email)));
}

function draftMissing(): never {
  throw new Error('expected a resolved draft');
}

function pipelineOf(draft: MongoLoweredDraft | undefined): ReadonlyArray<Record<string, unknown>> {
  if (draft?.kind !== 'aggregate') throw new Error('expected an aggregate draft');
  return draft.pipeline;
}

describe('runtime.prepare', () => {
  it('runs the callback and structural lowering once, and does no driver I/O', async () => {
    const { runtime, adapter, driver } = preparedRuntime();
    const callback = vi.fn(byEmail);
    const statement = await runtime.prepare({ email: 'test/string@1' }, callback);

    expect(driver.execute).not.toHaveBeenCalled();
    await statement.query(runtime, { email: 'a' }).toArray();
    await statement.query(runtime, { email: 'b' }).toArray();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(adapter.structuralLower).toHaveBeenCalledTimes(1);
  });

  it('gives the callback one frozen placeholder per declared name', async () => {
    const { runtime } = preparedRuntime();
    let received: unknown;
    await runtime.prepare(
      { email: 'test/string@1', nickname: { codecId: 'test/string@1', nullable: true } },
      (p) => {
        received = p;
        return aggregatePlan(
          new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
          new MongoMatchStage(MongoFieldFilter.eq('nickname', p.nickname)),
        );
      },
    );
    expect(received).toEqual({
      email: new MongoPreparedParamRef('email', 'test/string@1', false),
      nickname: new MongoPreparedParamRef('nickname', 'test/string@1', true),
    });
    expect(Object.isFrozen(received)).toBe(true);
  });

  it('returns a frozen statement handle with query and no execute for a read', async () => {
    const { runtime } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    expect(Object.isFrozen(statement)).toBe(true);
    expect(typeof statement.query).toBe('function');
    expect('execute' in statement).toBe(false);
    expect(statement.meta).toBe(baseMeta);
  });

  it('returns an execution handle with query and execute for updateMany and deleteMany', async () => {
    const { runtime } = preparedRuntime();
    const update = await runtime.prepare({ status: 'test/string@1' }, (p) => ({
      collection: 'users',
      command: new UpdateManyCommand('users', MongoFieldFilter.eq('status', p.status), {
        $set: { seen: true },
      }),
      meta: baseMeta,
    }));
    const remove = await runtime.prepare({ status: 'test/string@1' }, (p) => ({
      collection: 'users',
      command: new DeleteManyCommand('users', MongoFieldFilter.eq('status', p.status)),
      meta: baseMeta,
    }));
    for (const handle of [update, remove]) {
      expect(Object.isFrozen(handle)).toBe(true);
      expect(typeof handle.query).toBe('function');
      expect(typeof handle.execute).toBe('function');
    }
  });

  it('refuses an unknown codec id before calling the callback', async () => {
    const { runtime } = preparedRuntime();
    const callback = vi.fn(byEmail);
    await expect(runtime.prepare({ email: 'test/missing@1' }, callback)).rejects.toMatchObject({
      code: 'RUNTIME.CODEC_DESCRIPTOR_MISSING',
      details: { codecId: 'test/missing@1' },
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it('refuses a placeholder in a raw command', async () => {
    const { runtime } = preparedRuntime();
    await expect(
      runtime.prepare({ email: 'test/string@1' }, (p) => ({
        collection: 'users',
        command: new RawAggregateCommand('users', [{ $match: { email: p.email } }]),
        meta: baseMeta,
      })),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_RAW_PLACEHOLDER',
      details: { name: 'email' },
    });
  });

  it('prepares and runs a raw command with no placeholders', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare({}, () => ({
      collection: 'users',
      command: new RawAggregateCommand('users', [{ $match: { active: true } }]),
      meta: baseMeta,
    }));
    await statement.query(runtime, {}).toArray();
    expect(resolvedDrafts).toEqual([
      { kind: 'rawAggregate', collection: 'users', pipeline: [{ $match: { active: true } }] },
    ]);
  });

  it('refuses a declared name the plan does not use', async () => {
    const { runtime } = preparedRuntime();
    await expect(
      runtime.prepare({ email: 'test/string@1', take: 'test/int@1' }, byEmail),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNUSED_PARAM',
      details: { unused: ['take'] },
    });
  });
});

describe('running a prepared statement', () => {
  it('binds each placeholder to a parameter holding the run value', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare(
      { email: 'test/string@1', take: { codecId: 'test/int@1', nullable: false } },
      (p) =>
        aggregatePlan(
          new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
          new MongoLimitStage(p.take),
        ),
    );
    await statement.query(runtime, { email: 'a@example.com', take: 5 }).toArray();
    expect(pipelineOf(resolvedDrafts[0])).toEqual([
      {
        $match: {
          email: {
            $eq: new MongoParamRef('a@example.com', {
              name: 'email',
              codecId: 'test/string@1',
              nullable: false,
            }),
          },
        },
      },
      { $limit: new MongoParamRef(5, { name: 'take', codecId: 'test/int@1', nullable: false }) },
    ]);
  });

  it('binds a placeholder used twice to one parameter at both positions', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, (p) =>
      aggregatePlan(
        new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
        new MongoMatchStage(MongoFieldFilter.neq('backupEmail', p.email)),
      ),
    );
    await statement.query(runtime, { email: 'a' }).toArray();
    const [first, second] = [...flattenMongoDraftLeaves(resolvedDrafts[0] ?? draftMissing())];
    expect(first).toBe(second);
    expect(first).toEqual(
      new MongoParamRef('a', { name: 'email', codecId: 'test/string@1', nullable: false }),
    );
  });

  it('gives two runs independent values and ignores extra params', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await statement.query(runtime, { email: 'a', extra: 1 } as { email: string }).toArray();
    await statement.query(runtime, { email: 'b' }).toArray();
    expect(resolvedDrafts.map((draft) => pipelineOf(draft)[0])).toEqual([
      { $match: { email: { $eq: expect.objectContaining({ value: 'a' }) } } },
      { $match: { email: { $eq: expect.objectContaining({ value: 'b' }) } } },
    ]);
  });

  it('refuses a missing param before the activity starts', async () => {
    const activityStarted = vi.fn(async () => {});
    const { runtime, driver } = preparedRuntime({
      middleware: [{ name: 'observer', activityStarted }],
    });
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await expect(statement.query(runtime, {} as { email: string }).toArray()).rejects.toMatchObject(
      { code: 'RUNTIME.PREPARE_MISSING_PARAM', details: { name: 'email' } },
    );
    expect(activityStarted).not.toHaveBeenCalled();
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('refuses params that are not an object', async () => {
    const { runtime } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await expect(
      statement.query(runtime, null as unknown as { email: string }).toArray(),
    ).rejects.toMatchObject({ code: 'RUNTIME.PREPARE_MISSING_PARAM' });
  });

  it('starts the activity with the handle as its plan', async () => {
    const plans: unknown[] = [];
    const { runtime } = preparedRuntime({
      middleware: [
        {
          name: 'observer',
          async activityStarted(activity) {
            if (activity.kind === 'statement') plans.push(activity.plan);
          },
        },
      ],
    });
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await statement.query(runtime, { email: 'a' }).toArray();
    expect(plans).toEqual([statement]);
  });

  it('shows beforeEncode the declared names and sends its replacements, including null', async () => {
    const seen: unknown[] = [];
    const middleware: MongoMiddleware = {
      name: 'rewriter',
      async beforeEncode(_plan, _ctx, params) {
        const entries = [...(params?.entries() ?? [])];
        for (const entry of entries) seen.push({ value: entry.value, codecId: entry.codecId });
        params?.replaceValues([{ ref: entries[0]!.ref, newValue: null }]);
      },
    };
    const { runtime, resolvedDrafts } = preparedRuntime({ middleware: [middleware] });
    const statement = await runtime.prepare(
      { email: { codecId: 'test/string@1', nullable: true } },
      (p) =>
        aggregatePlan(
          new MongoMatchStage(MongoFieldFilter.eq('email', p.email)),
          new MongoMatchStage(MongoFieldFilter.neq('backupEmail', p.email)),
        ),
    );
    await statement.query(runtime, { email: 'a' }).toArray();
    expect(seen).toEqual([
      { value: 'a', codecId: 'test/string@1' },
      { value: 'a', codecId: 'test/string@1' },
    ]);
    const nullRef = new MongoParamRef(null, {
      name: 'email',
      codecId: 'test/string@1',
      nullable: true,
    });
    expect(pipelineOf(resolvedDrafts[0])).toEqual([
      { $match: { email: { $eq: nullRef } } },
      { $match: { backupEmail: { $ne: nullRef } } },
    ]);
  });

  it('refuses a limit that middleware replaced with a negative number', async () => {
    const { runtime, driver } = preparedRuntime({
      middleware: [
        {
          name: 'breaker',
          async beforeEncode(_plan, _ctx, params) {
            for (const entry of params?.entries() ?? []) {
              params?.replaceValues([{ ref: entry.ref, newValue: -1 }]);
            }
          },
        },
      ],
    });
    const statement = await runtime.prepare({ take: 'test/int@1' }, (p) =>
      aggregatePlan(new MongoLimitStage(p.take)),
    );
    await expect(statement.query(runtime, { take: 5 }).toArray()).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
    });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['a negative skip', { skip: -1, take: 1 }],
    ['a fractional limit', { skip: 0, take: 2.5 }],
    ['a string limit', { skip: 0, take: '3' }],
  ])('refuses %s', async (_label, params) => {
    const { runtime } = preparedRuntime();
    const statement = await runtime.prepare({ skip: 'test/int@1', take: 'test/int@1' }, (p) =>
      aggregatePlan(new MongoSkipStage(p.skip), new MongoLimitStage(p.take)),
    );
    await expect(
      statement.query(runtime, params as { skip: number; take: number }).toArray(),
    ).rejects.toMatchObject({ code: 'ORM.ARGUMENT_INVALID' });
  });

  it('fills in and checks a limit inside a $lookup sub-pipeline', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare({ take: 'test/int@1' }, (p) =>
      aggregatePlan(
        new MongoLookupStage({
          from: 'posts',
          as: 'posts',
          pipeline: [new MongoLimitStage(p.take)],
        }),
      ),
    );
    await statement.query(runtime, { take: 3 }).toArray();
    expect(pipelineOf(resolvedDrafts[0])).toEqual([
      {
        $lookup: {
          from: 'posts',
          as: 'posts',
          pipeline: [
            {
              $limit: new MongoParamRef(3, {
                name: 'take',
                codecId: 'test/int@1',
                nullable: false,
              }),
            },
          ],
        },
      },
    ]);
    await expect(statement.query(runtime, { take: -3 }).toArray()).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
    });
  });

  it('executes an update handle and returns its statistics', async () => {
    const { runtime } = preparedRuntime({
      driver: createMockDriver([{ matchedCount: 2, modifiedCount: 2 }]),
    });
    const update = await runtime.prepare({ status: 'test/string@1' }, (p) => ({
      collection: 'users',
      command: new UpdateManyCommand('users', MongoFieldFilter.eq('status', p.status), {
        $set: { seen: true },
      }),
      meta: baseMeta,
    }));
    await expect(update.execute(runtime, { status: 'new' })).resolves.toEqual({ affectedRows: 2 });
    await expect(update.query(runtime, { status: 'new' }).toArray()).resolves.toEqual([
      { matchedCount: 2, modifiedCount: 2 },
    ]);
  });

  describe('execute', () => {
    async function preparedUpdate() {
      const fixture = preparedRuntime({
        driver: createMockDriver([{ matchedCount: 1, modifiedCount: 1 }]),
      });
      const update = await fixture.runtime.prepare({ status: 'test/string@1' }, (p) => ({
        collection: 'users',
        command: new UpdateManyCommand('users', MongoFieldFilter.eq('status', p.status), {
          $set: { seen: true },
        }),
        meta: baseMeta,
      }));
      return { ...fixture, update };
    }

    it('refuses a missing param before the driver', async () => {
      const { runtime, driver, update } = await preparedUpdate();
      await expect(update.execute(runtime, {} as { status: string })).rejects.toMatchObject({
        code: 'RUNTIME.PREPARE_MISSING_PARAM',
        details: { name: 'status' },
      });
      expect(driver.execute).not.toHaveBeenCalled();
    });

    it('refuses a run whose signal is already aborted', async () => {
      const { runtime, driver, update } = await preparedUpdate();
      await expect(
        update.execute(runtime, { status: 'new' }, { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });
      expect(driver.execute).not.toHaveBeenCalled();
    });

    it('refuses a target without the prepared statement execute bridge', async () => {
      const { runtime, update } = await preparedUpdate();
      const target = { query: runtime.query.bind(runtime), execute: runtime.execute.bind(runtime) };
      expect(() => update.execute(target, { status: 'new' })).toThrow(
        'MongoQueryExecutor is missing the prepared statement execute bridge',
      );
    });
  });

  it('refuses a target without the prepared statement bridge', async () => {
    const { runtime } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    const target = { query: runtime.query.bind(runtime), execute: runtime.execute.bind(runtime) };
    expect(() => statement.query(target, { email: 'a' })).toThrow(
      'MongoQueryExecutor is missing the prepared statement query bridge',
    );
  });

  it('refuses a run whose signal is already aborted', async () => {
    const { runtime, driver } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await expect(
      statement.query(runtime, { email: 'a' }, { signal: AbortSignal.abort() }).toArray(),
    ).rejects.toMatchObject({ code: 'RUNTIME.ABORTED' });
    expect(driver.execute).not.toHaveBeenCalled();
  });

  it('fails in the driver step on a closed runtime, after beforeEncode', async () => {
    const beforeEncode = vi.fn(async () => {});
    const { runtime } = preparedRuntime({ middleware: [{ name: 'observer', beforeEncode }] });
    const statement = await runtime.prepare({ email: 'test/string@1' }, byEmail);
    await runtime.close();
    await expect(statement.query(runtime, { email: 'a' }).toArray()).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
      message: 'Runtime is closed',
    });
    expect(beforeEncode).toHaveBeenCalledTimes(1);
  });
});
