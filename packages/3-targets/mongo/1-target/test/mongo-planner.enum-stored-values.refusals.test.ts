import { describe, expect, it } from 'vitest';
import { flags, live, refused, STATUS, users } from './mongo-enum-fixtures';
import { plan, planned, schemaCollection } from './mongo-statement-fixtures';

describe('MongoMigrationPlanner, enum values that keep their names and trade or take stored values', () => {
  it('refuses two values that trade places', () => {
    expect(
      refused(
        plan({
          from: users('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
          to: users('to', { ACTIVE: 'archived', ARCHIVED: 'active' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.ACTIVE" and "Status.ARCHIVED" move stored values in a cycle, "active" to "archived" and "archived" to "active", and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every document that holds it, one value after another, and no order of the rewrites moves values in a cycle. Make the change in two plans: first give "Status.ACTIVE" a stored value no member stores, such as "prisma_swap" and "Status.ARCHIVED" a stored value no member stores, such as "prisma_swap_", and plan and apply that; then give "Status.ACTIVE" the stored value "archived" and "Status.ARCHIVED" the stored value "active", and plan again.',
      },
    ]);
  });

  it('refuses a chain of stored values', () => {
    expect(
      refused(
        plan({
          from: users('from', { A: 'a', B: 'b' }),
          to: users('to', { A: 'b', B: 'c' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.A" and "Status.B" move stored values along a chain, "a" to "b" and "b" to "c", and a rewrite of one would write a value another still has to read',
        why: 'MongoDB applies a migration\'s operations one at a time, without a transaction, and knows that an operation already ran only from the documents, so a rewrite of a value that another rewrite of the same migration writes would act on what that one wrote when the migration runs again after a later operation stops. Make the change in two plans: first give "Status.A" a stored value no member stores, such as "prisma_swap" and "Status.B" the stored value "c", and plan and apply that; then give "Status.A" the stored value "b", and plan again.',
      },
    ]);
  });

  it('refuses a value that another member of the origin holds, which the destination removes', () => {
    expect(
      refused(
        plan({
          from: users('from', { A: 'a', X: 'x' }),
          to: users('to', { A: 'x' }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored value of enum value "Status.A" from "a" to "x": the origin enum stores "x" as enum value "Status.X"',
        why: 'A changed stored value is rewritten in every document that holds it, so the documents of "Status.A" would hold "x" as the documents of "Status.X" do, and their data would merge. Make the change in two plans: first remove enum value "Status.X", and plan and apply that; then give "Status.A" the stored value "x", and plan again. The first plan asks about the documents that hold "x". If you answer it with --delete Status.X, a required field cannot lose its value: before that plan applies, delete those documents in the database, or set them to "a" there to merge their data with the data of "Status.A" on purpose.',
      },
    ]);
  });

  it('refuses a boolean enum whose values trade places, with the route through plain booleans', () => {
    expect(
      refused(
        plan({
          from: flags('from', { YES: true, NO: false }),
          to: flags('to', { YES: false, NO: true }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot change the stored values of enum "Status": enum values "Status.YES" and "Status.NO" move stored values in a cycle, true to false and false to true, and a rewrite of one would overwrite the other before it is read',
        why: 'The plan rewrites a changed stored value in every document that holds it, one value after another, and no order of the rewrites moves values in a cycle. A boolean enum has no third value to move a stored value to, so the change cannot be split into two steps. Make it in three steps instead, with migration plan or db update: first remove the enum and type the fields that hold it as plain booleans, and apply that; then swap their values in the database yourself, touching only boolean values so that missing and null values stay as they are, in mongosh: db.getCollection("users").updateMany({ "flag": { $type: "bool" } }, [{ $set: { "flag": { $not: ["$flag"] } } }]); db.getCollection("users").updateMany({ "flags": { $type: "array" } }, [{ $set: { "flags": { $map: { input: "$flags", in: { $cond: [{ $eq: [{ $type: "$$this" }, "bool"] }, { $not: ["$$this"] }, "$$this"] } } } } }]); then add the enum back with its new stored values, type the fields by it again, and apply that.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, an enum value change with no statement that a collection refuses', () => {
  it('is refused in a time-series collection, naming the change and no statement', () => {
    const readings = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, members, {
        types: { at: { codecId: 'mongo/date@1' }, status: { ...STATUS, nullable: true } },
        collection: { timeField: 'at' },
      });
    expect(
      refused(
        plan({
          from: readings('from', { ACTIVE: 'active', ARCHIVED: 'archived' }),
          to: readings('to', { ACTIVE: 'active', ARCHIVED: 'retired' }),
          schema: [schemaCollection('users', { timeseries: true })],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot replace enum value "Status.ARCHIVED" inside field "status" in collection "users": it is a time-series collection',
        why: "MongoDB updates the documents of a time-series collection only through its metaField, so the stored value cannot be replaced in the documents. Keep the enum value's stored value in the contract, then run this command again.",
      },
    ]);
  });
});

describe('MongoMigrationPlanner, the routes enum value refusals give, followed', () => {
  const step = (from: Readonly<Record<string, unknown>>, to: Readonly<Record<string, unknown>>) => {
    const result = plan({
      from: users('from', from, { types: { status: { ...STATUS, nullable: true } } }),
      to: users('to', to, { types: { status: { ...STATUS, nullable: true } } }),
      schema: live,
    });
    return { labels: planned(result).labels, dataLoss: planned(result).dataLoss.length };
  };
  const replace = (from: string, to: string) =>
    `Replace value "${from}" with "${to}" in field status of collection users`;

  it('swaps two values through values no member stores', () => {
    const through = { ACTIVE: 'prisma_swap', ARCHIVED: 'prisma_swap_' };
    expect([
      step({ ACTIVE: 'active', ARCHIVED: 'archived' }, through),
      step(through, { ACTIVE: 'archived', ARCHIVED: 'active' }),
    ]).toEqual([
      {
        labels: [replace('active', 'prisma_swap'), replace('archived', 'prisma_swap_')],
        dataLoss: 0,
      },
      {
        labels: [replace('prisma_swap', 'archived'), replace('prisma_swap_', 'active')],
        dataLoss: 0,
      },
    ]);
  });

  it('moves a chain through a value no member stores', () => {
    expect([
      step({ A: 'a', B: 'b' }, { A: 'prisma_swap', B: 'c' }),
      step({ A: 'prisma_swap', B: 'c' }, { A: 'b', B: 'c' }),
    ]).toEqual([
      { labels: [replace('a', 'prisma_swap'), replace('b', 'c')], dataLoss: 0 },
      { labels: [replace('prisma_swap', 'b')], dataLoss: 0 },
    ]);
  });

  it('removes the member whose value the other takes, then gives it that value', () => {
    expect([step({ A: 'a', X: 'x' }, { A: 'a' }), step({ A: 'a' }, { A: 'x' })]).toEqual([
      { labels: ['Remove value "x" from field status of collection users'], dataLoss: 1 },
      { labels: [replace('a', 'x')], dataLoss: 0 },
    ]);
  });
});

describe('MongoMigrationPlanner, the route of a boolean enum swap, followed', () => {
  it('plans no rewrite when the enum leaves the fields, nor when it comes back with its values swapped', () => {
    expect([
      planned(plan({ from: flags('s0', { YES: true, NO: false }), to: flags('s1'), schema: live })),
      planned(plan({ from: flags('s1'), to: flags('s2', { YES: false, NO: true }), schema: live })),
    ]).toEqual([
      { labels: [], classes: [], applied: [], dataLoss: [] },
      { labels: [], classes: [], applied: [], dataLoss: [] },
    ]);
  });
});
