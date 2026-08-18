import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/29331-query-plan-cache-bloat
// (postgres matrix entry; allProviders — we port postgres).
//
// Subject: repeated createMany calls with varying nullable parameter patterns
// (different combinations of which optional DateTime/Int/Float/Boolean fields are
// present) do not error or bloat the query plan cache. The "cache bloat" itself is
// an internal prepared-statement implementation detail unobservable via public API.
// The observable behavior is: the stress loop completes without error and the final
// row count is correct.
//
// `prisma.contactAnalytics.createMany({ data: rows })` → `db.public.ContactAnalytics.createAndCount(rows)`
// `prisma.contactAnalytics.count()` → `db.public.ContactAnalytics.aggregate(a => ({ count: a.count() }))`
//
// Upstream uses `undefined` to omit optional fields; prisma-next's CreateInput types
// optional nullable fields as `field?: Date | null`. We construct each row as a
// partial object and spread only the fields that are present (the varying pattern
// is preserved faithfully — only which fields are included varies per row/iteration).
//
// The upstream stress-mode toggle (PRISMA_CREATE_MANY_STRESS env) is preserved.
//
// Dispositions:
//   'createMany stress test for cache bloat' → PORTED (passing)

function daysBefore(days: number): Temporal.Instant {
  return Temporal.Now.instant().subtract({ hours: days * 24 });
}

type AnalyticsRow = Parameters<typeof withPostgresPort<Contract>>[1] extends (
  ctx: infer Ctx,
) => infer _
  ? Ctx extends {
      db: { public: { ContactAnalytics: { createAndCount(rows: readonly (infer R)[]): unknown } } };
    }
    ? R
    : never
  : never;

describe('ports/prisma/functional/issues-29331-query-plan-cache-bloat', () => {
  const fullStress = process.env['PRISMA_CREATE_MANY_STRESS'] === 'true';
  const iterations = fullStress ? 200 : 5;
  const batchSize = fullStress ? 10000 : 20;
  const testTimeout = fullStress ? 5 * 60 * 1000 : 10 * 1000;

  it(
    'createMany stress test for cache bloat',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        // Seed contacts (auto-generated IDs via @default(cuid(2))).
        const contact1 = await db.public.Contact.create({});
        const contact2 = await db.public.Contact.create({});
        const contact3 = await db.public.Contact.create({});
        const contactId1 = contact1.id;
        const contactId2 = contact2.id;
        const contactId3 = contact3.id;

        // Seed initial ContactAnalytics rows (mirroring upstream beforeEach).
        await db.public.ContactAnalytics.createAll([
          {
            contactId: contactId1,
            date1: daysBefore(180),
            date2: daysBefore(30),
            val1: 50,
            bool1: true,
          },
          { contactId: contactId2, date3: daysBefore(14), date4: daysBefore(7), val2: 100 },
          { contactId: contactId3, date5: daysBefore(3), val3: 10 },
        ]);

        // Stress loop: createAndCount with varying nullable params across many iterations.
        // The varying subset of present fields is the subject (different param patterns
        // each iteration/row). Build partial rows to preserve the varying-field pattern.
        for (let i = 0; i < iterations; i++) {
          const rows: AnalyticsRow[] = Array.from({ length: batchSize }, (_, j) => {
            const contactId = i % 2 === 0 ? contactId1 : j % 2 === 0 ? contactId2 : contactId3;
            return {
              contactId,
              ...(j % 3 === 0 && { date1: daysBefore(Math.floor(Math.random() * 180)) }),
              ...(j % 5 === 0 && { date2: daysBefore(Math.floor(Math.random() * 30)) }),
              ...(j % 7 === 0 && { date3: daysBefore(Math.floor(Math.random() * 14)) }),
              ...(j % 4 === 0 && { date4: daysBefore(Math.floor(Math.random() * 7)) }),
              ...(j % 6 === 0 && { date5: daysBefore(Math.floor(Math.random() * 10)) }),
              ...(j % 8 === 0 && { date6: daysBefore(Math.floor(Math.random() * 5)) }),
              ...(j % 2 === 0 && { date7: daysBefore(Math.floor(Math.random() * 3)) }),
              ...(j % 2 === 0 && { val1: Math.floor(Math.random() * 100) }),
              ...(j % 3 === 0 && { val2: Math.floor(Math.random() * 100) }),
              ...(j % 4 === 0 && { val3: Math.floor(Math.random() * 100) }),
              ...(j % 5 === 0 && { val4: Math.floor(Math.random() * 100) }),
              ...(j % 6 === 0 && { val5: Math.floor(Math.random() * 100) }),
              ...(j % 4 === 0 && { float1: Math.random() * 100 }),
              ...(j % 5 === 0 && { float2: Math.random() * 100 }),
              ...(j % 9 === 0 && { bool1: Math.random() > 0.8 }),
              ...(j % 10 === 0 && { bool2: Math.random() > 0.2 }),
              ...(j % 7 === 0 && { bool3: Math.random() > 0.5 }),
            };
          });

          const count = await db.public.ContactAnalytics.createAndCount(rows);
          expect(count).toBe(batchSize);
        }

        const { total } = await db.public.ContactAnalytics.aggregate((a) => ({
          total: a.count(),
        }));
        expect(total).toBe(iterations * batchSize + 3);
      }),
    testTimeout + timeouts.spinUpPpgDev,
  );
});
