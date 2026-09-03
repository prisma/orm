import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../_harness/postgres';
import cascadeMapJson from './_fixture/cascade-map/generated/contract.json' with { type: 'json' };
// All variants share the same logical Contract shape (they differ only in the
// storage-hash brand and in the FK referential actions carried by the runtime
// contract JSON). We import ONE representative Contract type and pair it with
// each variant's own contract.json at runtime — the harness deserializes the
// JSON (correct FK actions + DDL) while the type only drives the `db.*` surface.
import type { Contract } from './_fixture/cascade-plain/generated/contract';
import cascadePlainJson from './_fixture/cascade-plain/generated/contract.json' with {
  type: 'json',
};
import noactionMapJson from './_fixture/noaction-map/generated/contract.json' with { type: 'json' };
import noactionPlainJson from './_fixture/noaction-plain/generated/contract.json' with {
  type: 'json',
};
import restrictMapJson from './_fixture/restrict-map/generated/contract.json' with { type: 'json' };
import restrictPlainJson from './_fixture/restrict-plain/generated/contract.json' with {
  type: 'json',
};
import setnullMapJson from './_fixture/setnull-map/generated/contract.json' with { type: 'json' };
import setnullPlainJson from './_fixture/setnull-plain/generated/contract.json' with {
  type: 'json',
};

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-1.ts
//
// Upstream matrix: provider × relationMode (foreignKeys | prisma) × referential
// action (DEFAULT | Cascade | NoAction | Restrict | SetNull, applied to BOTH
// onUpdate and onDelete) × isSchemaUsingMap (false | true).
//
// prisma-next uses REAL database foreign keys and has NO client-side
// relationMode="prisma" referential-action emulation. So:
//   - relationMode="foreignKeys" cases are ported here (the DB enforces the FK
//     action), across every referential action, both @map variants.
//   - relationMode="prisma" cases are non-ported (see _inbox ledger).
//   - MongoDB cases are relationMode="prisma"-only in this suite → non-ported.
//
// The referential action lives in the schema's `@relation(onUpdate:…, onDelete:…)`.
// One PSL fixture is authored per action per @map variant under `_fixture/`.
//
// Model shape (postgres, id = `String @id`):
//   UserOneToOne { id; profile ProfileOneToOne?; profileOptional …?; enabled Boolean? }
//   ProfileOneToOne { id; user UserOneToOne @relation(fields:[userId], references:[id], <action>); userId @unique; enabled }
//   ProfileOptionalOneToOne { id; user UserOneToOne? @relation(…, <action>); userId? @unique; enabled }
//
// API mapping:
//   prisma[model].create({data})                        → db.public.Model.create(data)
//   prisma[model].findMany({orderBy})                   → db.public.Model.orderBy(...).all()
//   prisma[model].findUniqueOrThrow({where})            → db.public.Model.where(where).all().firstOrThrow()
//   prisma[model].findUnique({where})                   → db.public.Model.first(where)
//   prisma[model].update({where:{id}, data})            → db.public.Model.where({id}).update(data)
//   prisma[model].updateMany({where, data})             → db.public.Model.where(where).updateAll(data)
//   prisma[model].delete({where})                       → db.public.Model.where(where).delete()
//   prisma[model].deleteMany()  (all rows)              → db.public.Model.where(id.like('%')).deleteAll()
//   prisma[model].upsert({where, create, update})       → db.public.Model.where(where).upsert({create, update})
//   nested { profile: { create } / { connect } }        → profile: (p) => p.create(...) / p.connect(...)
//
// Each `it()` gets a clean contract-matched database via `withPostgresPort`,
// which truncates rows before reuse (upstream's beforeEach deleteMany is unnecessary).

type Variant = {
  readonly name: string;
  readonly json: unknown;
};

function run(variant: Variant, fn: (ctx: PortContext<Contract>) => Promise<void>) {
  return withPostgresPort<Contract>({ contractJson: variant.json }, fn);
}

// 1:1 helper mirroring upstream createXUsersWithAProfile (nested create).
async function createXUsersWithAProfile(ctx: PortContext<Contract>, count: number) {
  for (let i = 1; i <= count; i++) {
    const id = i.toString();
    await ctx.db.public.UserOneToOne.create({
      id,
      profile: (p) => p.create({ id }),
    });
  }
}

// ─── Cascade / NoAction / Restrict / SetNull matrix (foreignKeys) ───
//
// The upstream DEFAULT matrix cell is NON-PORTED: Prisma's implicit default
// referential action is `onUpdate: Cascade, onDelete: Restrict`, whereas
// prisma-next's implicit default (no `onUpdate`/`onDelete` on the relation) is
// raw-DB `NoAction`. The DEFAULT cell exercises Prisma's implicit default, which
// prisma-next does not reproduce. The explicit NoAction cell below covers the
// NoAction behaviour faithfully. (See _inbox ledger.)

const CASCADE = {
  plain: { name: 'Cascade (@map=false)', json: cascadePlainJson } as Variant,
  map: { name: 'Cascade (@map=true)', json: cascadeMapJson } as Variant,
};
const NOACTION = {
  plain: { name: 'NoAction (@map=false)', json: noactionPlainJson } as Variant,
  map: { name: 'NoAction (@map=true)', json: noactionMapJson } as Variant,
};
const RESTRICT = {
  plain: { name: 'Restrict (@map=false)', json: restrictPlainJson } as Variant,
  map: { name: 'Restrict (@map=true)', json: restrictMapJson } as Variant,
};
const SETNULL = {
  plain: { name: 'SetNull (@map=false)', json: setnullPlainJson } as Variant,
  map: { name: 'SetNull (@map=true)', json: setnullMapJson } as Variant,
};
const ALL_VARIANTS: Variant[] = [
  CASCADE.plain,
  CASCADE.map,
  NOACTION.plain,
  NOACTION.map,
  RESTRICT.plain,
  RESTRICT.map,
  SETNULL.plain,
  SETNULL.map,
];

// onUpdate: Cascade — parent-id change propagates to child FK.
const ON_UPDATE_CASCADE: Variant[] = [CASCADE.plain, CASCADE.map];

// onUpdate: Restrict, NoAction — parent-id change to a non-existing id throws.
const ON_UPDATE_RESTRICT_NOACTION: Variant[] = [
  RESTRICT.plain,
  RESTRICT.map,
  NOACTION.plain,
  NOACTION.map,
];

// onUpdate: Restrict, NoAction, SetNull — parent-id change to an existing id
// throws (unique violation on child / FK). (Cascade excluded.)
const ON_UPDATE_RESTRICT_NOACTION_SETNULL: Variant[] = [
  RESTRICT.plain,
  RESTRICT.map,
  NOACTION.plain,
  NOACTION.map,
  SETNULL.plain,
  SETNULL.map,
];

// onDelete: Restrict, NoAction — deleting a referenced parent throws.
const ON_DELETE_RESTRICT_NOACTION: Variant[] = [
  RESTRICT.plain,
  RESTRICT.map,
  NOACTION.plain,
  NOACTION.map,
];

const ON_DELETE_SETNULL: Variant[] = [SETNULL.plain, SETNULL.map];
const ON_DELETE_CASCADE: Variant[] = [CASCADE.plain, CASCADE.map];

describe('ports/prisma/functional/relationMode-1-to-1 (foreignKeys)', () => {
  describe('1:1 mandatory (explicit)', () => {
    // ── [create] ──────────────────────────────────────────────────────────
    describe('[create]', () => {
      for (const v of ALL_VARIANTS) {
        it(
          `relationMode=foreignKeys [create] child with non existing parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await expect(
                ctx.db.public.ProfileOneToOne.create({ id: '1', userId: '1' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual(
                [],
              );
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[create] nested child [create] should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await ctx.db.public.UserOneToOne.create({
                id: '1',
                profile: (p) => p.create({ id: '1' }),
              });

              expect(
                await ctx.db.public.UserOneToOne.where({ id: '1' }).all().firstOrThrow(),
              ).toEqual({ id: '1', enabled: null });
              expect(
                await ctx.db.public.ProfileOneToOne.where({ userId: '1' }).all().firstOrThrow(),
              ).toEqual({ id: '1', userId: '1', enabled: null });
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // Upstream: `[create] child with undefined parent should throw with type error`.
      // Upstream passes `userId: undefined` (a `@ts-expect-error`) and asserts a
      // runtime throw "Argument `user` is missing". prisma-next's create input
      // accepts omitting the FK scalar `userId` at the TYPE level (it can be
      // supplied instead via the `user`/`profile` relation), so there is no
      // compile-time type error to assert — that half of the upstream subject is
      // not reproducible. The runtime NOT NULL / FK violation IS reproduced.
      it(
        '[create] child with missing required FK throws at runtime',
        () =>
          run(CASCADE.plain, async (ctx) => {
            await expect(ctx.db.public.ProfileOneToOne.create({ id: '1' })).rejects.toThrow();

            expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual(
              [],
            );
          }),
        timeouts.spinUpPpgDev,
      );
    });

    // ── [update] ──────────────────────────────────────────────────────────
    describe('[update]', () => {
      for (const v of ALL_VARIANTS) {
        it(
          `[update] (user) optional boolean field should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.where({ id: '1' }).update({ enabled: true });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: true },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', userId: '1', enabled: null },
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] (profile) optional boolean field should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.ProfileOneToOne.where({ id: '1' }).update({ enabled: true });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', userId: '1', enabled: true },
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[upsert] child id with non-existing id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              // Upstream `upsert({where:{id:'1'}, create:{id:'3',userId:'1'}, update:{id:'3'}})`:
              // row id=1 EXISTS, so the `where` selects it and the UPDATE branch runs
              // (id 1→3, keeping userId=1). prisma-next's upsert is INSERT … ON CONFLICT
              // keyed on the create's primary key, so the conflict target is expressed
              // by making the create's `id` the existing `1`; the row is found on
              // conflict and the UPDATE branch (id→3) fires — same observable result.
              await ctx.db.public.ProfileOneToOne.upsert({
                create: { id: '1', userId: '1' },
                update: { id: '3' },
              });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2', userId: '2', enabled: null },
                { id: '3', userId: '1', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] child id with non-existing id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.ProfileOneToOne.where({ id: '1' }).update({ id: '3' });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2', userId: '2', enabled: null },
                { id: '3', userId: '1', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] nested child [connect] child should succeed if the relationship didn't exist — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.create({ id: '3' });

              await ctx.db.public.UserOneToOne.where({ id: '3' }).update({
                profile: (p) => p.connect({ id: '2' }),
              });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
                { id: '3', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', userId: '1', enabled: null },
                { id: '2', userId: '3', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] nested child [connect] should succeed if the relationship already existed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.where({ id: '1' }).update({
                profile: (p) => p.connect({ id: '1' }),
              });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', enabled: null, userId: '1' },
                { id: '2', enabled: null, userId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onUpdate: DEFAULT, Cascade
      for (const v of ON_UPDATE_CASCADE) {
        it(
          `[update] parent id with non-existing id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.where({ id: '1' }).update({ id: '3' });

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
                { id: '3', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', userId: '3', enabled: null },
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[updateMany] parent id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.where({ id: '1' }).updateAll({ id: '3' });

              expect(await ctx.db.public.UserOneToOne.first({ id: '1' })).toEqual(null);

              expect(
                await ctx.db.public.UserOneToOne.where({ id: '3' }).all().firstOrThrow(),
              ).toEqual({ id: '3', enabled: null });
              expect(
                await ctx.db.public.ProfileOneToOne.where({ userId: '3' }).all().firstOrThrow(),
              ).toEqual({ id: '1', userId: '3', enabled: null });
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onUpdate: Restrict, NoAction
      for (const v of ON_UPDATE_RESTRICT_NOACTION) {
        it(
          `[update] parent id with non-existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).update({ id: '3' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[updateMany] parent id with non-existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).updateAll({ id: '3' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onUpdate: DEFAULT, Restrict, NoAction, SetNull
      for (const v of ON_UPDATE_RESTRICT_NOACTION_SETNULL) {
        it(
          `[update] parent id with existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).update({ id: '2' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[updateMany] parent id with existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).updateAll({ id: '2' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] child id with existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.ProfileOneToOne.where({ id: '1' }).update({ id: '2' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1', userId: '1', enabled: null },
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] nested child [disconnect] should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).update({
                  profile: (p) => p.disconnect([{ id: '1' }]),
                }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }
    });

    // ── [delete] ──────────────────────────────────────────────────────────
    describe('[delete]', () => {
      for (const v of ALL_VARIANTS) {
        it(
          `[delete] child should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.ProfileOneToOne.where({ id: '1' }).delete();

              expect(
                await ctx.db.public.UserOneToOne.include('profile')
                  .orderBy((u) => u.id.asc())
                  .all(),
              ).toEqual([
                { id: '1', enabled: null, profile: null },
                { id: '2', enabled: null, profile: { id: '2', userId: '2', enabled: null } },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[delete] child and then [delete] parent should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.ProfileOneToOne.where({ id: '1' }).delete();
              await ctx.db.public.UserOneToOne.where({ id: '1' }).delete();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: DEFAULT, Restrict, NoAction
      for (const v of ON_DELETE_RESTRICT_NOACTION) {
        it(
          `onDelete Restrict/NoAction — [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `onDelete Restrict/NoAction — [deleteMany] parents should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where((u) => u.id.like('%')).deleteAll(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: SetNull (foreignKeys) — required relation's userId is NOT NULL,
      // so the DB cannot set it to null → FK violation on delete.
      for (const v of ON_DELETE_SETNULL) {
        it(
          `onDelete SetNull — [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `onDelete SetNull — [deleteMany] parents should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await expect(
                ctx.db.public.UserOneToOne.where((u) => u.id.like('%')).deleteAll(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: Cascade
      for (const v of ON_DELETE_CASCADE) {
        it(
          `onDelete Cascade — [delete] parent should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWithAProfile(ctx, 2);

              await ctx.db.public.UserOneToOne.where({ id: '1' }).delete();

              expect(await ctx.db.public.UserOneToOne.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.ProfileOneToOne.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2', userId: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }
    });
  });
});
