import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/4004
// (postgres matrix entry).
//
// The test verifies that updateMany on a many-to-many join table does not
// throw when the FK fields (studentId, classId) are updated. Upstream uses
// an implicit join table; here the explicit StudentClass model exposes those
// fields directly so ORM updateAll can target them.
//
// Upstream calls `updateMany({ data: { studentId } })` with no where clause
// (update every row). prisma-next updateAll requires .where(); we use
// .where((sc) => sc.studentId.isNotNull()) which matches all rows because
// every StudentClass must have a studentId.

function withIssue4004(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-4004', () => {
  it(
    'should not throw error when updating fields on a many to many join table',
    () =>
      withIssue4004(async ({ db }) => {
        const student1 = await db.public.Student.create({ id: 'student-1', name: 'student1' });
        const student2 = await db.public.Student.create({ id: 'student-2', name: 'student2' });
        const class1 = await db.public.Class.create({ id: 'class-1', name: 'class1' });
        const class2 = await db.public.Class.create({ id: 'class-2', name: 'class2' });

        await db.public.StudentClass.create({ studentId: student1.id, classId: class1.id });
        await db.public.StudentClass.create({ studentId: student2.id, classId: class2.id });

        // updateMany with no where — update all rows to point to student1.
        // prisma-next updateAll requires where; match all rows via isNotNull().
        await db.public.StudentClass.where((sc) => sc.studentId.isNotNull()).updateAll({
          studentId: student1.id,
        });

        const studentClasses = await db.public.StudentClass.include('student', (s) =>
          s.select('id'),
        )
          .include('class', (c) => c.select('id'))
          .select('studentId', 'classId')
          .all();

        studentClasses.forEach((sc) => {
          expect(sc.student.id).toEqual(student1.id);
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
