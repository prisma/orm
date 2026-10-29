import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

function patternsOf(id: string): readonly RegExp[] {
  const guide = readFileSync(
    join(repoRoot, 'upgrade-instructions/pending/convenience-date-time-types/app/instructions.md'),
    'utf-8',
  );
  const block = guide.split(/\n {2}- id: /).find((entry) => entry.startsWith(`${id}\n`)) ?? '';
  return [...block.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

const matches = (id: string, content: string) =>
  patternsOf(id).some((pattern) => pattern.test(content));

describe('the convenience date and time type detection', () => {
  it('matches a Prisma 8 field or alias typed DateTime, Date or Time on any target, and nothing else', () => {
    const psl = (body: string) =>
      matches('psl-date-time-types-are-convenience-types', `// use prisma-8\n\n${body}\n`);
    expect({
      dateTime: psl('model A {\n  at DateTime\n}'),
      date: psl('model A {\n  day Date?\n}'),
      time: psl('model A {\n  opens Time(3)\n}'),
      list: psl('model A {\n  days Date[]\n}'),
      alias: psl('types {\n  Stamp = DateTime @onCreate(now())\n}'),
      explicit: psl('model A {\n  at TimestamptzTemporal\n  day DateTemporal\n}'),
      stringType: psl('model A {\n  day DateString\n}'),
      comment: psl('// a DateTime field\nmodel A {\n  id Int @id\n}'),
      modelName: psl('model Date {\n  id Int @id\n}'),
      sqliteDateTime: psl('model A {\n  at DateTime @default(datetime`2024-01-01T00:00:00Z`)\n}'),
      mysqlDateTime: psl('model A {\n  id Int @id\n  at DateTime @onCreate(now())\n}'),
      mongoDate: psl('model A {\n  id ObjectId @id @map("_id")\n  at Date\n}'),
      prisma7: psl(
        'datasource db {\n  provider = "postgresql"\n}\nmodel A {\n  at DateTime @db.Timestamptz(3)\n}',
      ),
    }).toEqual({
      dateTime: true,
      date: true,
      time: true,
      list: true,
      alias: true,
      explicit: false,
      stringType: false,
      comment: false,
      modelName: false,
      sqliteDateTime: true,
      mysqlDateTime: true,
      mongoDate: true,
      prisma7: false,
    });
  });

  it('matches the TypeScript helpers of the three names only', () => {
    const ts = (content: string) => matches('ts-date-time-helpers-are-convenience-types', content);
    expect({
      dateTime: ts('field.column(type.DateTime())'),
      date: ts('field.column(type.Date())'),
      time: ts('field.column(type.Time(3))'),
      explicit: ts('field.column(type.TimeTemporal(3))'),
      sqliteDateTime: ts('field.column(type.DateTime())'),
      jsDate: ts('const at = new Date()'),
    }).toEqual({
      dateTime: true,
      date: true,
      time: true,
      explicit: false,
      sqliteDateTime: true,
      jsDate: false,
    });
  });
});
