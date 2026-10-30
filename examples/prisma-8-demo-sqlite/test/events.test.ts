import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ormClientCreateEvent } from '../src/orm-client/create-event';
import { ormClientGetEventsOn } from '../src/orm-client/get-events-on';
import { db } from '../src/prisma/db';
import { copyProject, type ProjectCopy, prisma } from './cli';

describe('events with DateTime, Date and Time fields', () => {
  let project: ProjectCopy;

  beforeAll(async () => {
    project = await copyProject();
    expect(await prisma(project, ['db', 'init'])).toBe(0);
    await db.connect({ path: project.databasePath });
  });

  afterAll(async () => {
    await db.close();
    await project?.remove();
  });

  it('writes each field and reads back a Date and the text SQLite stores', async () => {
    const created = await ormClientCreateEvent({
      title: 'Launch',
      startsAt: new Date('2024-02-29T16:00:00.000Z'),
      day: '2024-02-29',
      opensAt: '09:30',
    });
    expect(created).toEqual({
      id: expect.any(String),
      title: 'Launch',
      startsAt: new Date('2024-02-29T16:00:00.000Z'),
      day: '2024-02-29',
      opensAt: '09:30:00.000',
      bookedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it('filters by a date and orders by a time of day', async () => {
    await ormClientCreateEvent({
      title: 'Breakfast',
      startsAt: new Date('2024-02-29T07:00:00.000Z'),
      day: '2024-02-29',
      opensAt: '07:00:00.5',
    });
    await ormClientCreateEvent({
      title: 'Next day',
      startsAt: new Date('2024-03-01T09:00:00.000Z'),
      day: '2024-03-01',
      opensAt: '08:00',
    });
    expect(await ormClientGetEventsOn('2024-02-29')).toEqual([
      {
        title: 'Breakfast',
        startsAt: new Date('2024-02-29T07:00:00.000Z'),
        day: '2024-02-29',
        opensAt: '07:00:00.500',
      },
      {
        title: 'Launch',
        startsAt: new Date('2024-02-29T16:00:00.000Z'),
        day: '2024-02-29',
        opensAt: '09:30:00.000',
      },
    ]);
  });

  it('stores each value as ISO 8601 text', () => {
    const database = new DatabaseSync(project.databasePath);
    try {
      expect(
        database
          .prepare(`SELECT "startsAt", "day", "opensAt" FROM "event" WHERE "title" = 'Launch'`)
          .get(),
      ).toEqual({
        startsAt: '2024-02-29T16:00:00.000Z',
        day: '2024-02-29',
        opensAt: '09:30:00.000',
      });
    } finally {
      database.close();
    }
  });
});
