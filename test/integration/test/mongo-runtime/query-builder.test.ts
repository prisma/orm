// Intentionally uses verbose mongo-contract-ts import: @internal/mongo/contract-builder's
// defineContract wrap loses inline-model inference precision when consumers use
// mongoQuery<typeof contract> chains (PlanRow row shapes collapse to _id: never / count: never).
// Tracked at https://linear.app/prisma-company/issue/TML-2633 — migrate to the facade form
// once TML-2633 lands.

import { crossRef, type NamespaceId } from '@internal/contract/types';
import mongoFamilyPack from '@internal/family-mongo/pack';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import { defineContract, field, model, rel } from '@internal/mongo-contract-ts/contract-builder';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { acc, fn, mongoQuery } from '@internal/mongo-query-builder';
import mongoTargetPack from '@internal/target-mongo/pack';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { withMongod } from '../mongo/setup';

type ScalarField<TCodecId extends string> = {
  readonly type: { readonly kind: 'scalar'; readonly codecId: TCodecId };
  readonly nullable: false;
  readonly many: false;
};

type TestContract = MongoContract & {
  readonly models: {
    readonly Order: {
      readonly fields: {
        readonly _id: ScalarField<'mongo/objectId@1'>;
        readonly department: ScalarField<'mongo/string@1'>;
        readonly amount: ScalarField<'mongo/double@1'>;
        readonly status: ScalarField<'mongo/string@1'>;
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'orders' };
    };
    readonly User: {
      readonly fields: {
        readonly _id: ScalarField<'mongo/objectId@1'>;
        readonly firstName: ScalarField<'mongo/string@1'>;
        readonly lastName: ScalarField<'mongo/string@1'>;
        readonly orderId: ScalarField<'mongo/objectId@1'>;
      };
      readonly relations: Record<string, never>;
      readonly storage: { readonly collection: 'users' };
    };
  };
  readonly roots: {
    readonly orders: { readonly namespace: NamespaceId; readonly model: 'Order' };
    readonly users: { readonly namespace: NamespaceId; readonly model: 'User' };
  };
};

type TContract = MongoContractWithTypeMaps<TestContract, AnyMongoTypeMaps>;
type PlanRow<TPlan> = TPlan extends MongoQueryPlan<infer Row> ? Row : never;

const scalarField = <TCodecId extends string>(codecId: TCodecId) => ({
  type: { kind: 'scalar' as const, codecId },
  nullable: false,
  many: false,
});

const contractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { orders: crossRef('Order'), users: crossRef('User') },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Order: {
            fields: {
              _id: scalarField('mongo/objectId@1'),
              department: scalarField('mongo/string@1'),
              amount: scalarField('mongo/double@1'),
              status: scalarField('mongo/string@1'),
            },
            relations: {},
            storage: { collection: 'orders' },
          },
          User: {
            fields: {
              _id: scalarField('mongo/objectId@1'),
              firstName: scalarField('mongo/string@1'),
              lastName: scalarField('mongo/string@1'),
              orderId: scalarField('mongo/objectId@1'),
            },
            relations: {},
            storage: { collection: 'users' },
          },
        },
      },
    },
  },
  storage: {
    storageHash: 'test-hash',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'mongo-namespace',
        entries: {
          collection: {
            orders: { kind: 'mongo-collection' },
            users: { kind: 'mongo-collection' },
          },
        },
      },
    },
  },
  capabilities: {},
  extensions: {},
  profileHash: 'test-profile',
  meta: {},
};

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    name: field.string(),
    email: field.string(),
  },
});

const Task = model('Task', {
  collection: 'tasks',
  fields: {
    _id: field.objectId(),
    title: field.string(),
    type: field.string(),
    assigneeId: field.objectId(),
  },
  relations: {
    assignee: rel.belongsTo(User, {
      from: 'assigneeId',
      to: User.ref('_id'),
    }),
  },
});

const contract = defineContract({
  family: mongoFamilyPack,
  target: mongoTargetPack,
  models: { User, Task },
});

describe('pipeline builder integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  const p = mongoQuery<TContract>({ contractJson });

  it('match → group → sort → limit analytics query', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'eng', amount: 50, status: 'pending' },
        { department: 'sales', amount: 150, status: 'completed' },
        { department: 'sales', amount: 300, status: 'completed' },
        { department: 'hr', amount: 75, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .match((f) => f['status']!.eq('completed'))
        .group((f) => ({
          _id: f['department']!,
          total: acc.sum(f['amount']!),
          orderCount: acc.count(),
        }))
        .sort({ total: -1 })
        .limit(2)
        .build();

      expect(plan.meta.lane).toBe('mongo-query');
      const rows = await ctx.runtime.query(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ _id: string; total: number; orderCount: number }>;
      expect(typed[0]).toMatchObject({ _id: 'sales', total: 450 });
      expect(typed[1]).toMatchObject({ _id: 'eng', total: 300 });
    });
  });

  it('addFields → assert computed field is present', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'sales', amount: 50, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .addFields((f) => ({
          isHighValue: fn.cond(
            fn.add(f['amount']!, fn.literal(0)).node,
            fn.literal<{ readonly codecId: 'mongo/bool@1'; readonly nullable: false }>(true),
            fn.literal<{ readonly codecId: 'mongo/bool@1'; readonly nullable: false }>(false),
          ),
        }))
        .sort({ amount: -1 })
        .limit(2)
        .build();

      const rows = await ctx.runtime.query(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<{ department: string; amount: number; isHighValue: boolean }>;
      expect(typed[0]).toMatchObject({ amount: 200, isHighValue: true });
      expect(typed[1]).toMatchObject({ amount: 100, isHighValue: true });
    });
  });

  it('group with _id: null for whole-collection aggregation', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'eng', amount: 200, status: 'completed' },
        { department: 'sales', amount: 300, status: 'completed' },
      ]);

      const plan = p
        .from('orders')
        .group((_f) => ({
          _id: null,
          totalRevenue: acc.sum(_f['amount']!),
          count: acc.count(),
        }))
        .build();

      const rows = await ctx.runtime.query(plan);
      expect(rows).toHaveLength(1);

      const typed = rows as Array<{ _id: null; totalRevenue: number; count: number }>;
      expect(typed[0]).toMatchObject({ _id: null, totalRevenue: 600, count: 3 });
    });
  });

  it('lookup → unwind → project joins and flattens', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      const orderId = (
        await db
          .collection('orders')
          .insertOne({ department: 'eng', amount: 500, status: 'completed' })
      ).insertedId;
      await db.collection('users').insertMany([
        { firstName: 'Alice', lastName: 'A', orderId },
        { firstName: 'Bob', lastName: 'B', orderId },
      ]);

      const plan = p
        .from('orders')
        .lookup((from) =>
          from('users')
            .on((local, foreign) => ({
              local: local['_id']!,
              foreign: foreign['orderId']!,
            }))
            .as('assignees'),
        )
        .unwind('assignees')
        .project((f) => ({
          department: 1 as const,
          assignee: f['assignees']!,
        }))
        .build();

      const rows = await ctx.runtime.query(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<Record<string, unknown>>;
      expect(typed[0]).toHaveProperty('department', 'eng');
      expect(typed[0]).toHaveProperty('assignee');
      expect(typed[1]).toHaveProperty('department', 'eng');
    });
  });

  it('project narrows to selected fields', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      await db.collection('orders').insertMany([
        { department: 'eng', amount: 100, status: 'completed' },
        { department: 'sales', amount: 200, status: 'pending' },
      ]);

      const plan = p.from('orders').project('department', 'amount').sort({ amount: 1 }).build();

      const rows = await ctx.runtime.query(plan);
      expect(rows).toHaveLength(2);

      const typed = rows as Array<Record<string, unknown>>;
      expect(typed[0]).toHaveProperty('department', 'eng');
      expect(typed[0]).toHaveProperty('amount', 100);
      expect(typed[0]).not.toHaveProperty('status');
    });
  });

  it('executes with a builder-authored contract directly', async () => {
    await withMongod(async (ctx) => {
      const db = ctx.client.db(ctx.dbName);
      const userId = new ObjectId();

      await db.collection('users').insertOne({
        _id: userId,
        name: 'Alice',
        email: 'alice@example.com',
      });
      await db.collection('tasks').insertMany([
        {
          _id: new ObjectId(),
          title: 'Fix crash',
          type: 'bug',
          assigneeId: userId,
        },
        {
          _id: new ObjectId(),
          title: 'Fix typo',
          type: 'bug',
          assigneeId: userId,
        },
      ]);

      const plan = mongoQuery<typeof contract>({ contractJson: contract })
        .from('tasks')
        .group((f) => ({
          _id: f.type,
          count: acc.count(),
        }))
        .build();

      expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
        _id: string;
        count: number;
      }>();

      const results = await ctx.runtime.query(plan);

      expect(results).toEqual([
        {
          _id: 'bug',
          count: 2,
        },
      ]);
    });
  });
});
