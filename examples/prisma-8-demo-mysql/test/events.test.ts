import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getEventsOn } from '../src/orm-client/get-events-on';
import { createDb, type Db } from '../src/prisma/db';
import { createEvent } from '../src/raw/create-event';
import { copyProject, prisma } from './cli';
import { createTestDatabase, type TestDatabase } from './database';

const serverUrl = process.env['MYSQL_URL'];

describe.skipIf(serverUrl === undefined)('events with DateTime, Date and Time fields', () => {
  let database: TestDatabase;
  let db: Db;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl ?? '');
    const project = await copyProject();
    try {
      const migrate = await prisma(project.dir, database.url, ['db', 'migrate']);
      expect(migrate.exitCode).toBe(0);
    } finally {
      await project.remove();
    }
    db = createDb(database.url);
  });

  afterAll(async () => {
    await db?.close();
    await database?.drop();
  });

  it('writes each value through its codec and reads it back, with the createdAt the database fills', async () => {
    const before = Date.now() - 1000;
    await createEvent(db, {
      title: 'Leap day standup',
      startsAt: new Date('2024-02-29T09:30:00.123Z'),
      day: '2024-02-29',
      opensAt: '09:15',
    });
    await createEvent(db, {
      title: 'Leap day retro',
      startsAt: new Date('2024-02-29T16:00:00.000Z'),
      day: '2024-02-29',
      opensAt: '15:45:30.5',
    });
    await createEvent(db, {
      title: 'The day after',
      startsAt: new Date('2024-03-01T09:30:00.000Z'),
      day: '2024-03-01',
      opensAt: '09:15',
    });

    const events = await getEventsOn(db, '2024-02-29');

    expect(events).toEqual([
      {
        title: 'Leap day standup',
        startsAt: new Date('2024-02-29T09:30:00.123Z'),
        day: '2024-02-29',
        opensAt: '09:15:00',
        createdAt: expect.any(Date),
      },
      {
        title: 'Leap day retro',
        startsAt: new Date('2024-02-29T16:00:00.000Z'),
        day: '2024-02-29',
        opensAt: '15:45:30.5',
        createdAt: expect.any(Date),
      },
    ]);
    for (const { createdAt } of events) {
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
  });
});
