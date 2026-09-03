import { describe, expect, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../_harness/postgres';
import cascadeMapJson from './_fixture/cascade-map/generated/contract.json' with { type: 'json' };
// All variants share the same logical Contract shape (they differ only in the
// storage-hash brand and the FK referential actions carried by the runtime
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
// packages/client/tests/functional/relationMode-in-separate-gh-action/tests_1-to-n.ts
//
// Upstream matrix: provider × relationMode (foreignKeys | prisma) × referential
// action (DEFAULT | Cascade | NoAction | Restrict | SetNull, on BOTH onUpdate and
// onDelete) × isSchemaUsingMap (false | true).
//
// prisma-next uses REAL database foreign keys and has NO client-side
// relationMode="prisma" referential-action emulation:
//   - relationMode="foreignKeys" cases are ported here across every action, both
//     @map variants.
//   - relationMode="prisma" cases → non-ported (see _inbox ledger).
//   - MongoDB cases are relationMode="prisma"-only → non-ported.
//
// Model shape (postgres, id = `String @id`):
//   UserOneToMany { id; posts PostOneToMany[]; postOptionals …[]; enabled Boolean? }
//   PostOneToMany { id; author UserOneToMany @relation(fields:[authorId], references:[id], <action>); authorId }
//   PostOptionalOneToMany { id; author UserOneToMany? @relation(…, <action>); authorId? }
//
// createXUsersWith2Posts(count): for i in 1..count, create User{id:i} plus posts
// `${i}-post-a` and `${i}-post-b`, both authored by user i.
//
// Each `it()` gets a clean contract-matched database via `withPostgresPort`,
// which truncates rows before reuse.

type Variant = { readonly name: string; readonly json: unknown };

function run(variant: Variant, fn: (ctx: PortContext<Contract>) => Promise<void>) {
  return withPostgresPort<Contract>({ contractJson: variant.json }, fn);
}

async function createXUsersWith2Posts(ctx: PortContext<Contract>, count: number) {
  for (let i = 1; i <= count; i++) {
    const id = i.toString();
    await ctx.db.public.UserOneToMany.create({ id });
    await ctx.db.public.PostOneToMany.create({ id: `${id}-post-a`, authorId: id });
    await ctx.db.public.PostOneToMany.create({ id: `${id}-post-b`, authorId: id });
  }
}

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
// The upstream DEFAULT matrix cell is NON-PORTED: Prisma's implicit default
// referential action is `onUpdate: Cascade, onDelete: Restrict`, whereas
// prisma-next's implicit default (relation without `onUpdate`/`onDelete`) is
// raw-DB `NoAction`. The DEFAULT cell exercises Prisma's implicit default, which
// prisma-next does not reproduce; the explicit NoAction cell covers NoAction.
// (See _inbox ledger.)

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

const ON_UPDATE_CASCADE: Variant[] = [CASCADE.plain, CASCADE.map];

const ON_DELETE_SETNULL: Variant[] = [SETNULL.plain, SETNULL.map];
const ON_DELETE_NOACTION: Variant[] = [NOACTION.plain, NOACTION.map];
const ON_DELETE_CASCADE: Variant[] = [CASCADE.plain, CASCADE.map];

describe('ports/prisma/functional/relationMode-1-to-n (foreignKeys)', () => {
  describe('1:n mandatory (explicit)', () => {
    // ── [create] ──────────────────────────────────────────────────────────
    describe('[create]', () => {
      for (const v of ALL_VARIANTS) {
        it(
          `relationMode=foreignKeys [create] child with non existing parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await expect(
                ctx.db.public.PostOneToMany.create({ id: '1', authorId: '1' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.PostOneToMany.where({ authorId: '1' }).all()).toEqual([]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[create] nested child [create] should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await ctx.db.public.UserOneToMany.include('posts').create({
                id: '1',
                posts: (p) => p.create([{ id: '1' }]),
              });

              expect(await ctx.db.public.PostOneToMany.where({ authorId: '1' }).all()).toEqual([
                { id: '1', authorId: '1' },
              ]);
              expect(
                await ctx.db.public.UserOneToMany.where({ id: '1' }).all().firstOrThrow(),
              ).toEqual({ id: '1', enabled: null });
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[create] nested child [createMany] — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await ctx.db.public.UserOneToMany.include('posts').create({
                id: '1',
                posts: (p) => p.create([{ id: '1' }, { id: '2' }]),
              });

              expect(
                await ctx.db.public.PostOneToMany.where({ authorId: '1' })
                  .orderBy((p) => p.id.asc())
                  .all(),
              ).toEqual([
                { id: '1', authorId: '1' },
                { id: '2', authorId: '1' },
              ]);
              expect(
                await ctx.db.public.UserOneToMany.where({ id: '1' }).all().firstOrThrow(),
              ).toEqual({ id: '1', enabled: null });
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // Upstream: `[create] child with undefined parent should throw with type error`
      // (passes `authorId: undefined` behind a `@ts-expect-error`). prisma-next's
      // create input accepts omitting the FK scalar `authorId` at the TYPE level
      // (it can be supplied via the `author`/`posts` relation), so there is no
      // compile-time type error to assert — that half of the upstream subject is
      // not reproducible. The runtime NOT NULL / FK violation IS reproduced.
      it(
        '[create] child with missing required FK throws at runtime',
        () =>
          run(CASCADE.plain, async (ctx) => {
            await expect(ctx.db.public.PostOneToMany.create({ id: '1' })).rejects.toThrow();
          }),
        timeouts.spinUpPpgDev,
      );
    });

    // ── [update] ──────────────────────────────────────────────────────────
    describe('[update]', () => {
      for (const v of ALL_VARIANTS) {
        it(
          `[update] optional boolean field should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.UserOneToMany.where({ id: '1' }).update({ enabled: true });

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: true },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-a', authorId: '1' },
                { id: '1-post-b', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] parent id with existing id should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await expect(
                ctx.db.public.UserOneToMany.where({ id: '1' }).update({ id: '2' }),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[update] child id with non-existing id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).update({
                id: '1-post-c',
              });

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-b', authorId: '1' },
                { id: '1-post-c', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onUpdate: DEFAULT, Cascade — parent-id change propagates to child FK.
      for (const v of ON_UPDATE_CASCADE) {
        it(
          `[update] parent id with non-existing id should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.UserOneToMany.where({ id: '1' }).update({ id: '3' });

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
                { id: '3', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-a', authorId: '3' },
                { id: '1-post-b', authorId: '3' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
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
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).delete();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-b', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `[delete] children and then [delete] parent should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).delete();
              await ctx.db.public.PostOneToMany.where({ id: '1-post-b' }).delete();
              await ctx.db.public.UserOneToMany.where({ id: '1' }).delete();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: SetNull (foreignKeys) — required relation's authorId is NOT NULL,
      // so the DB cannot null it → FK violation on delete.
      for (const v of ON_DELETE_SETNULL) {
        it(
          `onDelete SetNull — [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await expect(
                ctx.db.public.UserOneToMany.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `onDelete SetNull — [delete] a subset of children and then [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).delete();

              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-b', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);

              await expect(
                ctx.db.public.UserOneToMany.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: NoAction — deleting a referenced parent throws.
      for (const v of ON_DELETE_NOACTION) {
        it(
          `onDelete NoAction — [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await expect(
                ctx.db.public.UserOneToMany.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `onDelete NoAction — [delete] a subset of children then [delete] parent should throw — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).delete();

              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-b', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);

              await expect(
                ctx.db.public.UserOneToMany.where({ id: '1' }).delete(),
              ).rejects.toThrow();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '1', enabled: null },
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }

      // onDelete: Cascade — deleting a parent cascades to its children.
      for (const v of ON_DELETE_CASCADE) {
        it(
          `onDelete Cascade — [delete] parent should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.UserOneToMany.where({ id: '1' }).delete();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
              ]);
              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );

        it(
          `onDelete Cascade — [delete] a subset of children then [delete] parent should succeed — ${v.name}`,
          () =>
            run(v, async (ctx) => {
              await createXUsersWith2Posts(ctx, 2);

              await ctx.db.public.PostOneToMany.where({ id: '1-post-a' }).delete();

              expect(await ctx.db.public.PostOneToMany.orderBy((p) => p.id.asc()).all()).toEqual([
                { id: '1-post-b', authorId: '1' },
                { id: '2-post-a', authorId: '2' },
                { id: '2-post-b', authorId: '2' },
              ]);

              await ctx.db.public.UserOneToMany.where({ id: '1' }).delete();

              expect(await ctx.db.public.UserOneToMany.orderBy((u) => u.id.asc()).all()).toEqual([
                { id: '2', enabled: null },
              ]);
            }),
          timeouts.spinUpPpgDev,
        );
      }
    });
  });
});
