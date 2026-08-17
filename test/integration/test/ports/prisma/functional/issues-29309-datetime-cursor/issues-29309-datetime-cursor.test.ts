import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/29309-datetime-cursor
// (postgres matrix entry; sqlProviders minus sqlite — we port postgres).
//
// Subject: pagination cursor against a DATE column (pg/date-temporal@1) works correctly.
//
// Cursor semantics gap:
//   Prisma cursor is INCLUSIVE (starts FROM the cursor row).
//   prisma-next cursor is EXCLUSIVE (starts AFTER the cursor row).
//
//   Upstream: cursor at Jan 3, skip=1, take=3.
//     Prisma: starts FROM Jan 3, skip 1 (Jan 3 itself), take 3 → Jan 4, 5, 6 ✓
//     prisma-next: starts AFTER Jan 3, skip 1 (skips Jan 4), take 3 → Jan 5, 6, 7 ✗
//
// A faithful port using `.orderBy().cursor().skip(1).take(3).all()` runs but
// returns different rows → it.fails (genuine prisma-next gap).
//
// Dispositions:
//   'retrieves a cursor against a DATE column' → it.fails (exclusive vs inclusive cursor)

describe('ports/prisma/functional/issues-29309-datetime-cursor', () => {
  it.fails(
    'retrieves a cursor against a DATE column',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const rows = [];
        for (let day = 1; day <= 10; day++) {
          rows.push({
            appId: 1,
            createdAt: new Date(`2025-01-${String(day).padStart(2, '0')}Z`),
            value: day * 100,
          });
        }
        await db.public.Event.createAll(rows);

        const firstThree = await db.public.Event.where({ appId: 1 })
          .orderBy((e) => e.createdAt.asc())
          .take(3)
          .all();
        const cursorRow = firstThree[2]!; // 2025-01-03

        // Faithful port: composite @@id([appId, createdAt]) → cursor on both columns.
        // Prisma (inclusive cursor + skip=1): Jan 4, 5, 6.
        // prisma-next (exclusive cursor + skip=1): Jan 5, 6, 7 → assertion fails.
        const withCursor = await db.public.Event.where({ appId: 1 })
          .orderBy((e) => e.createdAt.asc())
          .cursor({ appId: cursorRow.appId, createdAt: cursorRow.createdAt })
          .skip(1)
          .take(3)
          .all();

        expect(withCursor).toEqual([
          {
            appId: 1,
            createdAt: new Date('2025-01-04T00:00:00.000Z'),
            value: 400,
          },
          {
            appId: 1,
            createdAt: new Date('2025-01-05T00:00:00.000Z'),
            value: 500,
          },
          {
            appId: 1,
            createdAt: new Date('2025-01-06T00:00:00.000Z'),
            value: 600,
          },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
