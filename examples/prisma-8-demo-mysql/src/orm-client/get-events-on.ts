import type { Db } from '../prisma/db';

/** The events on a calendar date, written as "2024-02-29", in the order they start. */
export function getEventsOn(db: Db, day: string) {
  return db.orm.Event.select('title', 'startsAt', 'day', 'opensAt', 'createdAt')
    .where({ day })
    .orderBy((e) => e.startsAt.asc())
    .all();
}
