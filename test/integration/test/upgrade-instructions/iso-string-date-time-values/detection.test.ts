import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const APP_GUIDE =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md';

const matches = (content: string) =>
  detectionPatterns(APP_GUIDE, 'date-style-iso-required').some((pattern) => pattern.test(content));

describe('the date-style-iso-required detection', () => {
  it('finds a pool or client the application creates and every way it can set DateStyle', () => {
    expect([
      matches("const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });"),
      matches('const client = new pg.Client(url);'),
      matches("await client.query('SET DateStyle = SQL, DMY');"),
      matches("await client.query('set session datestyle to german');"),
      matches('ALTER ROLE app SET datestyle TO postgres;'),
      matches("options: '-c datestyle=SQL'"),
      matches('PGDATESTYLE=German'),
    ]).toEqual([true, true, true, true, true, true, true]);
  });

  it('does not match code that never touches a pool, a client or DateStyle', () => {
    expect([
      matches("const db = postgres({ contract, url: process.env['DATABASE_URL'] });"),
      matches('const style = dateStyles.pick();'),
    ]).toEqual([false, false]);
  });
});
