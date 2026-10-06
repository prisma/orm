import { crossRef, type NamespaceId } from '@internal/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import {
  MongoAggAccumulator,
  MongoAggCond,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  MongoCountStage,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  MongoRedactStage,
  MongoSortStage,
} from '@internal/mongo-query-ast/execution';
import { acc, fn, mongoQuery } from '@internal/mongo-query-builder';
import { describe, expect, it } from 'vitest';
import { describeWithMongoDB } from './setup';

// ---------------------------------------------------------------------------
// Contract fixture — Products + Orders, purpose-built for pipeline testing
// ---------------------------------------------------------------------------

type ScalarField<TCodecId extends string> = {
  readonly type: { readonly kind: 'scalar'; readonly codecId: TCodecId };
  readonly nullable: false;
  readonly many: false;
};

type PipelineContract = MongoContract & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: {
          readonly Product: {
            readonly fields: {
              readonly _id: ScalarField<'mongo/objectId@1'>;
              readonly name: ScalarField<'mongo/string@1'>;
              readonly category: ScalarField<'mongo/string@1'>;
              readonly price: ScalarField<'mongo/double@1'>;
              readonly tags: ScalarField<'mongo/array@1'>;
              readonly createdAt: ScalarField<'mongo/date@1'>;
            };
            readonly relations: Record<string, never>;
            readonly storage: { readonly collection: 'products' };
          };
          readonly Order: {
            readonly fields: {
              readonly _id: ScalarField<'mongo/objectId@1'>;
              readonly productName: ScalarField<'mongo/string@1'>;
              readonly quantity: ScalarField<'mongo/double@1'>;
              readonly status: ScalarField<'mongo/string@1'>;
            };
            readonly relations: Record<string, never>;
            readonly storage: { readonly collection: 'orders' };
          };
        };
      };
    };
  };
  readonly roots: {
    readonly products: { readonly namespace: NamespaceId; readonly model: 'Product' };
    readonly orders: { readonly namespace: NamespaceId; readonly model: 'Order' };
  };
};

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/array@1': { readonly output: unknown[] };
  readonly 'mongo/date@1': { readonly output: Date };
  readonly 'mongo/bool@1': { readonly output: boolean };
};

type TestFieldOutputTypes = {
  readonly __unbound__: {
    readonly Product: {
      readonly _id: string;
      readonly name: string;
      readonly category: string;
      readonly price: number;
      readonly tags: unknown[];
      readonly createdAt: Date;
    };
    readonly Order: {
      readonly _id: string;
      readonly productName: string;
      readonly quantity: number;
      readonly status: string;
    };
  };
};

type TestTypeMaps = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldOutputTypes>;
type TContract = MongoContractWithTypeMaps<PipelineContract, TestTypeMaps>;

const scalarField = <TCodecId extends string>(codecId: TCodecId) => ({
  type: { kind: 'scalar' as const, codecId },
  nullable: false,
  many: false,
});

const contractJson = {
  target: 'mongo',
  targetFamily: 'mongo',
  roots: { products: crossRef('Product'), orders: crossRef('Order') },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          Product: {
            fields: {
              _id: scalarField('mongo/objectId@1'),
              name: scalarField('mongo/string@1'),
              category: scalarField('mongo/string@1'),
              price: scalarField('mongo/double@1'),
              tags: scalarField('mongo/array@1'),
              createdAt: scalarField('mongo/date@1'),
            },
            relations: {},
            storage: { collection: 'products' },
          },
          Order: {
            fields: {
              _id: scalarField('mongo/objectId@1'),
              productName: scalarField('mongo/string@1'),
              quantity: scalarField('mongo/double@1'),
              status: scalarField('mongo/string@1'),
            },
            relations: {},
            storage: { collection: 'orders' },
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
            products: { kind: 'mongo-collection' },
            orders: { kind: 'mongo-collection' },
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const query = mongoQuery<TContract>({ contractJson });

function products() {
  return query.from('products');
}

function orders() {
  return query.from('orders');
}

type Row = Record<string, unknown>;

const PRODUCTS = [
  {
    name: 'Laptop',
    category: 'electronics',
    price: 999,
    tags: ['tech', 'portable'],
    createdAt: new Date('2024-01-15T00:00:00Z'),
  },
  {
    name: 'Phone',
    category: 'electronics',
    price: 699,
    tags: ['tech', 'mobile'],
    createdAt: new Date('2024-03-20T00:00:00Z'),
  },
  {
    name: 'Desk',
    category: 'furniture',
    price: 250,
    tags: ['office'],
    createdAt: new Date('2024-02-10T00:00:00Z'),
  },
  {
    name: 'Chair',
    category: 'furniture',
    price: 150,
    tags: ['office', 'ergonomic'],
    createdAt: new Date('2024-06-01T00:00:00Z'),
  },
  {
    name: 'Notebook',
    category: 'stationery',
    price: 5,
    tags: ['paper'],
    createdAt: new Date('2024-12-25T00:00:00Z'),
  },
];

const ORDERS = [
  { productName: 'Laptop', quantity: 2, status: 'shipped' },
  { productName: 'Laptop', quantity: 1, status: 'pending' },
  { productName: 'Phone', quantity: 3, status: 'shipped' },
  { productName: 'Desk', quantity: 1, status: 'delivered' },
  { productName: 'Chair', quantity: 4, status: 'shipped' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeWithMongoDB('Pipeline builder integration (mongoQuery DSL)', (ctx) => {
  async function seed() {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('products').insertMany(PRODUCTS.map((p) => ({ ...p })));
    await db.collection('orders').insertMany(ORDERS.map((o) => ({ ...o })));
  }

  async function exec(plan: MongoQueryPlan): Promise<Row[]> {
    const rows = await ctx.runtime.query(plan).toArray();
    return rows as Row[];
  }

  // ---------- Basic pipeline flow ----------

  describe('match + sort + limit + skip', () => {
    it('filters, sorts, and paginates', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .sort({ price: -1 })
        .limit(1)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop', price: 999 });
    });

    it('skips documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .sort({ price: 1 })
        .skip(1)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop' });
    });
  });

  // ---------- Aggregation ----------

  describe('group with accumulators', () => {
    it('groups by category and sums prices', async () => {
      await seed();

      const plan = products()
        .group((f) => ({
          _id: f.category,
          totalPrice: acc.sum(f.price),
          count: acc.count(),
        }))
        .sort({ _id: 1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({ _id: 'electronics', totalPrice: 1698, count: 2 });
      expect(results[1]).toMatchObject({ _id: 'furniture', totalPrice: 400, count: 2 });
      expect(results[2]).toMatchObject({ _id: 'stationery', totalPrice: 5, count: 1 });
    });

    it('whole-collection grouping with _id: null', async () => {
      await seed();

      const plan = products()
        .group((_f) => ({
          _id: null,
          maxPrice: acc.max(_f.price),
          minPrice: acc.min(_f.price),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ _id: null, maxPrice: 999, minPrice: 5 });
    });
  });

  // ---------- Computed fields ----------

  describe('addFields', () => {
    it('adds computed fields to documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .addFields((f) => ({
          discountedPrice: fn.multiply(f.price, fn.literal(0.9)),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop' });
      expect((results[0] as Row)['discountedPrice']).toBeCloseTo(899.1);
    });
  });

  // ---------- Field selection ----------

  describe('project', () => {
    it('includes only specified fields', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .project('name', 'price')
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      const keys = Object.keys(results[0]!);
      expect(keys).toContain('name');
      expect(keys).toContain('price');
      expect(keys).not.toContain('category');
      expect(keys).not.toContain('tags');
    });

    it('computed projection with expressions', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .project((f) => ({
          name: 1 as const,
          upperCategory: fn.toUpper(f.category),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ name: 'Laptop', upperCategory: 'ELECTRONICS' });
    });

    it('decodes codec-mapped fields through a reshaping $project stage', async () => {
      await seed();

      const plan = products().project('_id', 'name').build();

      const results = await exec(plan);
      expect(results).toHaveLength(5);
      const laptop = results.find((r) => r['name'] === 'Laptop')!;
      expect(typeof laptop['_id']).toBe('string');
      expect(laptop['_id']).not.toHaveProperty('_bsontype');
      expect(typeof laptop['name']).toBe('string');
      expect(laptop['name']).toBe('Laptop');
    });
  });

  // ---------- Count ----------

  describe('count', () => {
    it('counts matching documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .count('total')
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ total: 2 });
    });
  });

  // ---------- Array flattening ----------

  describe('unwind', () => {
    it('flattens array field into separate documents', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Chair'))
        .unwind('tags')
        .sort({ tags: 1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ name: 'Chair', tags: 'ergonomic' });
      expect(results[1]).toMatchObject({ name: 'Chair', tags: 'office' });
    });
  });

  // ---------- Cross-collection join ----------

  describe('lookup', () => {
    it('joins orders with products by name', async () => {
      await seed();

      const plan = orders()
        .match((f) => f.productName.eq('Laptop'))
        .lookup((from) =>
          from('products')
            .on((local, foreign) => ({
              local: local.productName,
              foreign: foreign.name,
            }))
            .as('productDetails'),
        )
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      for (const row of results) {
        const details = (row as Row)['productDetails'] as Row[];
        expect(details).toHaveLength(1);
        expect(details[0]).toMatchObject({ name: 'Laptop', category: 'electronics' });
      }
    });
  });

  // ---------- Multi-pipeline ----------

  describe('facet', () => {
    it('runs multiple sub-pipelines in parallel', async () => {
      await seed();

      const plan = products()
        .facet({
          totalCount: [new MongoCountStage('count')],
          cheapest: [new MongoSortStage({ price: 1 }), new MongoLimitStage(2)],
          byCategory: [
            new MongoMatchStage(MongoFieldFilter.eq('category', 'electronics')),
            new MongoCountStage('count'),
          ],
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      const facets = results[0] as Record<string, Row[]>;
      expect(facets['totalCount']).toEqual([{ count: 5 }]);
      expect(facets['cheapest']).toHaveLength(2);
      expect(facets['cheapest']![0]).toMatchObject({ name: 'Notebook', price: 5 });
      expect(facets['byCategory']).toEqual([{ count: 2 }]);
    });
  });

  // ---------- Bucketing ----------

  describe('bucket', () => {
    it('groups documents into price ranges', async () => {
      await seed();

      const plan = products()
        .bucket({
          groupBy: MongoAggFieldRef.of('price'),
          boundaries: [0, 100, 500, 1000],
          default_: 'Other',
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      const buckets = results.map((r) => ({ _id: (r as Row)['_id'], count: (r as Row)['count'] }));
      expect(buckets).toContainEqual({ _id: 0, count: 1 });
      expect(buckets).toContainEqual({ _id: 100, count: 2 });
      expect(buckets).toContainEqual({ _id: 500, count: 2 });
    });
  });

  // ---------- Union ----------

  describe('unionWith', () => {
    it('combines documents from two collections', async () => {
      await seed();

      const plan = products()
        .project('name')
        .unionWith('orders', [new MongoMatchStage(MongoFieldFilter.eq('status', 'delivered'))])
        .build();

      const results = await exec(plan);
      // 5 products + 1 delivered order
      expect(results).toHaveLength(6);
    });
  });

  // ---------- Frequency ----------

  describe('sortByCount', () => {
    it('counts and sorts by category frequency', async () => {
      await seed();

      const plan = products()
        .sortByCount((f) => f.category)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      // First two have count=2 (order among ties is non-deterministic)
      const topTwo = results
        .slice(0, 2)
        .map((r) => r['_id'])
        .sort();
      expect(topTwo).toEqual(['electronics', 'furniture']);
      expect(results[2]).toMatchObject({ _id: 'stationery', count: 1 });
    });
  });

  // ---------- Random sampling ----------

  describe('sample', () => {
    it('returns requested number of random documents', async () => {
      await seed();

      const plan = products().sample(3).build();
      const results = await exec(plan);
      expect(results).toHaveLength(3);
    });
  });

  // ---------- Output stages ----------

  describe('out', () => {
    it('writes pipeline results to a new collection', async () => {
      await seed();

      const plan = products()
        .match((f) => f.category.eq('electronics'))
        .out('electronics');

      await exec(plan);

      const db = ctx.client.db(ctx.dbName);
      const docs = await db.collection('electronics').find().toArray();
      expect(docs).toHaveLength(2);
      const names = docs.map((d) => d['name']).sort();
      expect(names).toEqual(['Laptop', 'Phone']);
    });
  });

  describe('merge', () => {
    it('merges pipeline results into target collection', async () => {
      await seed();

      const db = ctx.client.db(ctx.dbName);
      await db.collection('summary').insertOne({ _id: 'placeholder' as never, source: 'old' });

      const plan = products()
        .group((f) => ({
          _id: f.category,
          total: acc.sum(f.price),
        }))
        .merge({ into: 'summary', whenNotMatched: 'insert' });

      await exec(plan);

      const docs = await db.collection('summary').find().toArray();
      expect(docs.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ---------- Bucketing (auto) ----------

  describe('bucketAuto', () => {
    it('distributes documents into equal-sized buckets', async () => {
      await seed();

      const plan = products()
        .bucketAuto({
          groupBy: MongoAggFieldRef.of('price'),
          buckets: 3,
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      for (const bucket of results) {
        expect(bucket).toHaveProperty('_id');
        expect(bucket).toHaveProperty('count');
      }
    });
  });

  // ---------- Redact ----------

  describe('redact', () => {
    it('prunes documents not matching condition', async () => {
      await seed();

      const plan = products()
        .pipe(
          new MongoRedactStage(
            new MongoAggCond(
              MongoAggOperator.of('$eq', [
                MongoAggFieldRef.of('category'),
                MongoAggLiteral.of('electronics'),
              ]),
              MongoAggFieldRef.of('$KEEP'),
              MongoAggFieldRef.of('$PRUNE'),
            ),
          ),
        )
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      for (const row of results) {
        expect(row).toMatchObject({ category: 'electronics' });
      }
    });
  });

  // ---------- Graph traversal ----------

  describe('graphLookup', () => {
    it('self-joins orders by productName', async () => {
      await seed();

      const plan = orders()
        .match((f) => f.productName.eq('Laptop'))
        .graphLookup({
          from: 'orders',
          startWith: MongoAggFieldRef.of('productName'),
          connectFromField: 'productName',
          connectToField: 'productName',
          as: 'relatedOrders',
          maxDepth: 0,
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      for (const row of results) {
        const related = (row as Row)['relatedOrders'] as Row[];
        expect(related).toHaveLength(2);
      }
    });
  });

  // ---------- Window functions ----------

  describe('setWindowFields', () => {
    it('computes running total over sorted documents', async () => {
      await seed();

      const plan = products()
        .setWindowFields({
          sortBy: { price: 1 },
          output: {
            runningTotal: {
              operator: MongoAggAccumulator.sum(MongoAggFieldRef.of('price')),
              window: { documents: ['unbounded' as unknown as number, 0] as [number, number] },
            },
          },
        })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(5);
      expect((results[0] as Row)['runningTotal']).toBe(5);
      const lastRow = results[results.length - 1] as Row;
      expect(lastRow['runningTotal']).toBe(5 + 150 + 250 + 699 + 999);
    });
  });

  // ---------- Complex multi-stage pipeline ----------

  describe('complex pipeline', () => {
    it('chains match → group → sort → limit end-to-end', async () => {
      await seed();

      const plan = orders()
        .match((f) => f.status.eq('shipped'))
        .group((f) => ({
          _id: f.productName,
          totalQty: acc.sum(f.quantity),
        }))
        .sort({ totalQty: -1 })
        .limit(2)
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ _id: 'Chair', totalQty: 4 });
      expect(results[1]).toMatchObject({ _id: 'Phone', totalQty: 3 });
    });

    it('lookup → pipe(match): orders enriched with product info', async () => {
      await seed();

      const plan = orders()
        .lookup((from) =>
          from('products')
            .on((local, foreign) => ({
              local: local.productName,
              foreign: foreign.name,
            }))
            .as('product'),
        )
        .pipe(new MongoMatchStage(MongoFieldFilter.eq('status', 'shipped')))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      for (const row of results) {
        const product = ((row as Row)['product'] as Row[])[0];
        expect(product).toBeDefined();
        expect(product).toHaveProperty('category');
      }
    });
  });

  // ---------- Named-args expression helpers ----------

  describe('named-args expression helpers', () => {
    it('fn.dateToString formats a date field', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .addFields((f) => ({
          dateStr: fn.dateToString({
            date: f['createdAt'] as Parameters<typeof fn.dateToString>[0]['date'],
            format: fn.literal('%Y-%m-%d'),
          }),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]!['dateStr']).toBe('2024-01-15');
    });

    it('fn.trim removes whitespace via named-args string operator', async () => {
      await seed();

      const plan = products()
        .match((f) => f.name.eq('Laptop'))
        .addFields((_f) => ({
          trimmed: fn.trim({ input: fn.literal('  electronics  ') }),
        }))
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(1);
      expect(results[0]!['trimmed']).toBe('electronics');
    });

    it('fn.gt in a $cond labels products by price', async () => {
      await seed();

      const plan = products()
        .addFields((f) => ({
          priceLabel: fn.cond(
            fn.gt(f.price, fn.literal(500)).node,
            fn.literal('expensive'),
            fn.literal('affordable'),
          ),
        }))
        .sort({ price: -1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(5);
      expect(results[0]).toMatchObject({ name: 'Laptop', priceLabel: 'expensive' });
      expect(results[1]).toMatchObject({ name: 'Phone', priceLabel: 'expensive' });
      expect(results[2]).toMatchObject({ name: 'Desk', priceLabel: 'affordable' });
    });
  });

  // ---------- Named-args accumulator helpers ----------

  describe('named-args accumulator helpers', () => {
    it('acc.firstN returns first N items per group', async () => {
      await seed();

      const plan = products()
        .sort({ name: 1 })
        .group((f) => ({
          _id: f.category,
          firstTwo: acc.firstN({ input: f.name, n: fn.literal(2) }),
        }))
        .sort({ _id: 1 })
        .build();

      const results = await exec(plan);
      expect(results).toHaveLength(3);
      const electronics = results.find((r) => r['_id'] === 'electronics');
      expect(electronics!['firstTwo']).toEqual(['Laptop', 'Phone']);
      const furniture = results.find((r) => r['_id'] === 'furniture');
      expect(furniture!['firstTwo']).toEqual(['Chair', 'Desk']);
    });
  });
});
