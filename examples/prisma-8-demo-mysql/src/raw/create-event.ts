import { param } from '@prisma/orm-mysql/relational-core/expression';
import type { Db } from '../prisma/db';

export interface NewEvent {
  readonly title: string;
  readonly startsAt: Date;
  readonly day: string;
  readonly opensAt: string;
}

/**
 * Inserts an event through the raw SQL lane, since the ORM cannot write to MySQL yet. Each value is a parameter its column's codec encodes, so `startsAt` is written in UTC, and `createdAt` takes the database's `now()` default.
 */
export async function createEvent(db: Db, event: NewEvent): Promise<void> {
  await db.execute(
    db.raw.sql`INSERT INTO Event (title, startsAt, day, opensAt) VALUES (
      ${event.title},
      ${param(event.startsAt, { codecId: 'mysql/datetime@1' })},
      ${param(event.day, { codecId: 'mysql/date-string@1' })},
      ${param(event.opensAt, { codecId: 'mysql/time-string@1' })}
    )`
      .affectedCount()
      .build(),
  );
}
