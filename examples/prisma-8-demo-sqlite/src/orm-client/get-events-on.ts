import { db } from '../prisma/db';

export async function ormClientGetEventsOn(day: string) {
  return db.orm.Event.select('title', 'startsAt', 'day', 'opensAt')
    .where({ day })
    .orderBy((event) => event.opensAt.asc())
    .all();
}
