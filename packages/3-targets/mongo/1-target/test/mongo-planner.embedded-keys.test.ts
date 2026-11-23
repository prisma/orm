import type { ControlPolicy } from '@internal/contract/types';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  contract,
  type FieldTypeSpec,
  NS,
  plan,
  planned,
  renameField,
  schemaCollection,
} from './mongo-statement-fixtures';

const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OPTIONAL: FieldTypeSpec = { codecId: 'mongo/string@1', nullable: true };

/** Orders and quotes that both embed lines, whose fields are stored under the names given. */
function orders(
  seed: string,
  storedAs: Readonly<Record<string, string>>,
  options: { readonly control?: ControlPolicy; readonly linesField?: string } = {},
) {
  const lines = { field: options.linesField ?? 'lines', model: 'Line' };
  return contract(
    seed,
    {
      Order: { collection: 'orders', fields: ['_id'], embeds: { lines } },
      Quote: { collection: 'quotes', fields: ['_id'], embeds: { lines } },
      Line: {
        owner: 'Order',
        fields: Object.keys(storedAs),
        types: Object.fromEntries(Object.keys(storedAs).map((field) => [field, STRING])),
        storedAs,
      },
    },
    {
      orders: options.control === undefined ? {} : { control: options.control },
      quotes: {},
    },
  );
}

const live = [schemaCollection('orders'), schemaCollection('quotes')];

/** The key calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/(?:renameStoredKey|removeStoredKey)\((?:[^()]|\([^()]*\))*\)/g) ?? [];
}

describe('MongoMigrationPlanner, a field of an embedded model whose name both contracts keep', () => {
  it('renames its key wherever the type is stored when its @map changes, and asks nothing', () => {
    const result = plan({
      from: orders('from', { sku: 'sku' }),
      to: orders('to', { sku: 'code' }),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Rename key "sku" to "code" at path "$[*]" in field lines of collection orders',
        'Rename key "sku" to "code" at path "$[*]" in field lines of collection quotes',
      ],
      classes: ['widening', 'widening'],
      applied: [],
      dataLoss: [],
      rendered: [
        'renameStoredKey({collection:"orders",field:"lines",path:"$[*].sku",to:"code"})',
        'renameStoredKey({collection:"quotes",field:"lines",path:"$[*].sku",to:"code"})',
      ],
    });
  });

  it('renames one key and removes another of a removed field', () => {
    const result = plan({
      from: orders('from', { sku: 'sku', note: 'note' }),
      to: orders('to', { sku: 'code' }),
      schema: [schemaCollection('orders')],
    });
    expect(rendered(result)).toEqual([
      'renameStoredKey({collection:"orders",field:"lines",path:"$[*].sku",to:"code"})',
      'removeStoredKey({collection:"orders",field:"lines",path:"$[*].note"})',
    ]);
  });

  it('leaves the rename out in a collection that is not managed, with a warning, and renames it where the collection is managed', () => {
    const result = plan({
      from: orders('from', { sku: 'sku' }, { control: 'external' }),
      to: orders('to', { sku: 'code' }, { control: 'external' }),
      schema: live,
    });
    if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
    expect({
      ...planned(result),
      warnings: (result.warnings ?? []).map(({ kind, summary }) => ({ kind, summary })),
    }).toEqual({
      labels: ['Rename key "sku" to "code" at path "$[*]" in field lines of collection quotes'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
      warnings: [
        {
          kind: 'controlPolicySuppressedCall',
          summary:
            'control policy suppressed: Rename key "sku" to "code" at path "$[*]" in field lines of collection orders — collection "orders" has effective control \'external\'',
        },
      ],
    });
  });

  it('refuses the rename to a key MongoDB cannot write, naming the contract change and no statement', () => {
    expect(
      plan({
        from: orders('from', { sku: 'sku' }),
        to: orders('to', { sku: 'item.code' }),
        schema: live,
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename key "sku" to "item.code" of field "Line.sku": the stored name "item.code" cannot be written',
          why: 'The stored name of field "Line.sku" changes from "sku" to "item.code". MongoDB reads a name containing "." as a path into embedded documents. Give the field a stored name without "." that does not start with "$", or keep the stored name "sku" in the contract.',
        },
      ],
    });
  });

  it('refuses the rename onto the key of a removed field, with the route that names it', () => {
    expect(
      plan({
        from: orders('from', { sku: 'sku', note: 'code' }),
        to: orders('to', { sku: 'code' }),
        schema: [schemaCollection('orders')],
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename key "sku" to "code" of embedded model "Line": the objects of embedded model "Line" already hold key "code"',
          why: 'The stored name of field "Line.sku" changes from "sku" to "code", and the objects of embedded model "Line" already hold key "code", the stored name of field "Line.note". Without the rename the plan would read the values of key "code" as values of field "Line.sku". Make the change in two plans: first remove field "Line.note", or keep it and change its key to a name nothing uses, such as "prisma_swap_code", and plan and apply that; then make this change and plan again.',
        },
      ],
    });
  });

  it('refuses two keys that swap stored names', () => {
    expect(
      plan({
        from: orders('from', { a: 'x', b: 'y' }),
        to: orders('to', { a: 'y', b: 'x' }),
        schema: [schemaCollection('orders')],
      }),
    ).toEqual({
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename key "x" to "y" of embedded model "Line": key "y" is renamed in the same plan',
          why: 'The stored name of field "Line.a" changes from "x" to "y", and the stored name of field "Line.b" changes from "y" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of key "y" as values of field "Line.a". Make the change in two plans: first give field "Line.a" the key "prisma_swap_y" and field "Line.b" the key "prisma_swap_x", keys nothing uses, and plan and apply that; then give field "Line.a" the key "y" and field "Line.b" the key "x", and plan again.',
        },
      ],
      kind: 'failure',
    });
  });

  it('names the field a statement renames an embedded key to, when that rename frees the key another change takes', () => {
    const statement = renameField('Line', 'b', 'Line', 'c');
    expect(
      plan({
        from: orders('from', { a: 'x', b: 'y' }),
        to: orders('to', { a: 'y', c: 'z' }),
        schema: [schemaCollection('orders')],
        statements: [statement],
      }),
    ).toEqual({
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename key "x" to "y" of embedded model "Line": key "y" is renamed in the same plan',
          why: 'The stored name of field "Line.a" changes from "x" to "y", and field "Line.b" is renamed to "Line.c", which renames key "y" to "z" of embedded model "Line". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of key "y" as values of field "Line.a". Make the change in two plans: first give field "Line.a" the key "prisma_swap_y" and field "Line.c" the key "prisma_swap_z", keys nothing uses, and plan and apply that with the same statements; then give field "Line.a" the key "y" and field "Line.c" the key "z", and plan again without them.',
        },
      ],
      kind: 'failure',
    });
  });

  it('follows the route of the swap refusal through keys nothing uses', () => {
    const one = [schemaCollection('orders', {})];
    const through = { a: 'prisma_swap_y', b: 'prisma_swap_x' };
    const key = (from: string, to: string) =>
      `Rename key "${from}" to "${to}" at path "$[*]" in field lines of collection orders`;
    expect([
      planned(
        plan({ from: orders('s0', { a: 'x', b: 'y' }), to: orders('s1', through), schema: one }),
      ),
      planned(
        plan({ from: orders('s1', through), to: orders('s2', { a: 'y', b: 'x' }), schema: one }),
      ),
    ]).toEqual([
      {
        labels: ['Create collection quotes', key('x', 'prisma_swap_y'), key('y', 'prisma_swap_x')],
        classes: ['additive', 'widening', 'widening'],
        applied: [],
        dataLoss: [],
      },
      {
        labels: ['Create collection quotes', key('prisma_swap_y', 'y'), key('prisma_swap_x', 'x')],
        classes: ['additive', 'widening', 'widening'],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('follows the route of that refusal: removes the field first, then renames', () => {
    const one = [schemaCollection('orders')];
    expect([
      rendered(
        plan({
          from: orders('s0', { sku: 'sku', note: 'code' }),
          to: orders('s1', { sku: 'sku' }),
          schema: one,
        }),
      ),
      rendered(
        plan({
          from: orders('s1', { sku: 'sku' }),
          to: orders('s2', { sku: 'code' }),
          schema: one,
        }),
      ),
    ]).toEqual([
      ['removeStoredKey({collection:"orders",field:"lines",path:"$[*].code"})'],
      ['renameStoredKey({collection:"orders",field:"lines",path:"$[*].sku",to:"code"})'],
    ]);
  });

  it('plans nothing without an origin contract', () => {
    expect(
      planned(plan({ from: null, to: orders('to', { sku: 'code' }), schema: live })).labels,
    ).toEqual([]);
  });

  it('asks about nothing for an optional field whose @map changes', () => {
    const optional = (seed: string, stored: string) =>
      contract(
        seed,
        {
          Order: {
            collection: 'orders',
            fields: ['_id'],
            embeds: { lines: { field: 'lines', model: 'Line' } },
          },
          Line: {
            owner: 'Order',
            fields: ['sku'],
            types: { sku: OPTIONAL },
            storedAs: { sku: stored },
          },
        },
        { orders: {} },
      );
    expect(
      planned(
        plan({
          from: optional('from', 'sku'),
          to: optional('to', 'code'),
          schema: [schemaCollection('orders')],
        }),
      ),
    ).toEqual({
      labels: ['Rename key "sku" to "code" at path "$[*]" in field lines of collection orders'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('names the field by the origin model and field in a removal', () => {
    expect(
      planned(
        plan({
          from: orders('from', { sku: 'sku', note: 'note' }),
          to: orders('to', { sku: 'sku' }),
          schema: [schemaCollection('orders')],
        }),
      ).dataLoss.map(({ subject }) => subject),
    ).toEqual([{ kind: 'field', namespaceId: NS, model: 'Line', field: 'note' }]);
  });
});

describe('MongoMigrationPlanner, embedded keys that swap in a collection the plan does not rewrite', () => {
  it('plans nothing in a collection that is not managed', () => {
    const result = plan({
      from: orders('from', { a: 'x', b: 'y' }, { control: 'external' }),
      to: orders('to', { a: 'y', b: 'x' }, { control: 'external' }),
      schema: [schemaCollection('orders')],
    });
    expect(planned(result)).toEqual({
      applied: [],
      classes: ['additive'],
      dataLoss: [],
      labels: ['Create collection quotes'],
    });
  });

  it('plans nothing when the database lacks the collection', () => {
    expect(
      planned(
        plan({
          from: orders('from', { a: 'x', b: 'y' }),
          to: orders('to', { a: 'y', b: 'x' }),
          schema: [],
        }),
      ),
    ).toEqual({
      applied: [],
      classes: ['additive', 'additive'],
      dataLoss: [],
      labels: ['Create collection orders', 'Create collection quotes'],
    });
  });
});
