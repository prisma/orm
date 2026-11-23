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

  it('refuses the rename in a collection that is not managed, naming the contract change and no statement', () => {
    expect(
      plan({
        from: orders('from', { sku: 'sku' }, { control: 'external' }),
        to: orders('to', { sku: 'code' }, { control: 'external' }),
        schema: live,
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename key "sku" to "code" of field "Line.sku": collection "orders" has control policy "external"',
          why: 'The stored name of field "Line.sku" changes from "sku" to "code". The plan rewrites keys only in collections whose control policy is "managed". Make the change in the database yourself, or keep the stored name "sku" in the contract.',
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

  it('refuses the rename onto the key of a removed field', () => {
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
            'Cannot plan the migration: the migration writes a key that another of its operations reads (Rename key "sku" to "code" at path "$[*]" in field lines of collection orders; Remove key "code" at path "$[*]" in field lines of collection orders)',
          why: "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a key another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first remove the key whose name the rename takes; then make the rename.",
        },
      ],
    });
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
