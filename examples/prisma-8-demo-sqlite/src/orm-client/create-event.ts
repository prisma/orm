import { db } from '../prisma/db';

export interface OrmClientCreateEventInput {
  readonly title: string;
  readonly startsAt: Date;
  readonly day: string;
  readonly opensAt: string;
}

export async function ormClientCreateEvent(data: OrmClientCreateEventInput) {
  return db.orm.Event.select('id', 'title', 'startsAt', 'day', 'opensAt', 'bookedOn').create(data);
}
