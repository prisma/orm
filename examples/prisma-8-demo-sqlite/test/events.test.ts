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
      title: 'Talk',
      startsAt: new Date('2024-03-10T16:00:00.000Z'),
      day: '2024-03-10',
      opensAt: '09:30',
    });
    await ormClientCreateEvent({
      title: 'Breakfast',
      startsAt: new Date('2024-03-10T07:00:00.000Z'),
      day: '2024-03-10',
      opensAt: '07:00:00.5',
    });
    await ormClientCreateEvent({
      title: 'Next day',
      startsAt: new Date('2024-03-11T09:00:00.000Z'),
      day: '2024-03-11',
      opensAt: '08:00',
    });
    expect(await ormClientGetEventsOn('2024-03-10')).toEqual([
      {
        title: 'Breakfast',
        startsAt: new Date('2024-03-10T07:00:00.000Z'),
        day: '2024-03-10',
        opensAt: '07:00:00.500',
      },
      {
        title: 'Talk',
        startsAt: new Date('2024-03-10T16:00:00.000Z'),
        day: '2024-03-10',
        opensAt: '09:30:00.000',
      },
    ]);
  });

  it('stores each value as ISO 8601 text', async () => {
    await ormClientCreateEvent({
      title: 'Stored',
      startsAt: new Date('2024-04-01T16:00:00.000Z'),
      day: '2024-04-01',
      opensAt: '09:30',
    });
    const database = new DatabaseSync(project.databasePath);
    try {
      expect(
        database
          .prepare(`SELECT "startsAt", "day", "opensAt" FROM "event" WHERE "title" = 'Stored'`)
          .get(),
      ).toEqual({
        startsAt: '2024-04-01T16:00:00.000Z',
        day: '2024-04-01',
        opensAt: '09:30:00.000',
      });
    } finally {
      database.close();
    }
  });
});
