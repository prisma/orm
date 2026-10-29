import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

function patternsOf(id: string): readonly RegExp[] {
  const guide = readFileSync(
    join(
      repoRoot,
      'upgrade-instructions/pending/tools-write-convenience-types/app/instructions.md',
    ),
    'utf-8',
  );
  const block = guide.split(/\n {2}- id: /).find((entry) => entry.startsWith(`${id}\n`)) ?? '';
  return [...block.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

const matches = (id: string, content: string) =>
  patternsOf(id).some((pattern) => pattern.test(content));

describe('the detection of the changes the tools writing convenience types make', () => {
  it('matches a config that reads a Prisma 7 schema, and no other', () => {
    expect({
      prisma7: matches(
        'prisma7-schema-reads-dates',
        "export default defineConfig({ contract: prisma7Schema('prisma/schema.prisma') });",
      ),
      prisma8: matches(
        'prisma7-schema-reads-dates',
        "export default defineConfig({ contract: prismaSchema('prisma/schema.prisma') });",
      ),
    }).toEqual({ prisma7: true, prisma8: false });
  });

  it('matches each created-at and updated-at alias in PSL and TypeScript, and not the presets', () => {
    const detects = (content: string) => matches('temporal-type-aliases-on-datetime', content);
    expect({
      createdAt: detects('  createdAt temporal.CreatedAt\n'),
      updatedAtString: detects('  updatedAt temporal.UpdatedAtString\n'),
      createdAtJsDate: detects('createdAt: field.column(type.temporal.CreatedAtJsDate()),'),
      preset: detects('  updatedAt temporal.updatedAtString()\n'),
      longerName: detects('  updatedAt temporal.UpdatedAtStringly\n'),
      otherNamespace: detects('  updatedAt mytemporal.UpdatedAt\n'),
    }).toEqual({
      createdAt: true,
      updatedAtString: true,
      createdAtJsDate: true,
      preset: false,
      longerName: false,
      otherNamespace: false,
    });
  });

  it('matches a timestamp default with digits below a millisecond, and not one without', () => {
    const detects = (content: string) => matches('date-default-below-a-millisecond', content);
    expect({
      micro: detects(
        '  at DateTime(precision: 6) @default(timestamptz`2024-01-01T01:00:00.123456Z`)\n',
      ),
      local: detects(
        '  at DateTime(storage: timestamp) @default(timestamp`2024-01-01T01:00:00.1234`)\n',
      ),
      mysql: detects('  at DateTime(6) @default(datetime`2024-01-01T01:00:00.123456`)\n'),
      milli: detects('  at DateTime @default(timestamptz`2024-01-01T01:00:00.123Z`)\n'),
      zeros: detects('  at DateTime @default(timestamptz`2024-01-01T01:00:00.123000Z`)\n'),
    }).toEqual({ micro: true, local: true, mysql: true, milli: false, zeros: false });
  });

  it('matches a client now generator or a Prisma 7 config, and not a database default', () => {
    const detects = (content: string) => matches('date-now-takes-column-precision', content);
    expect({
      prisma7: detects(
        "export default defineConfig({ contract: prisma7Schema('schema.prisma') });",
      ),
      attribute: detects('  updatedAt DateTime @onCreate(now()) @onUpdate(now())\n'),
      alias: detects('  createdAt temporal.CreatedAt\n'),
      typescript: detects('createdAt: field.column(type.DateTime()).onCreate(gen.now()),'),
      temporalPreset: detects('  createdAt temporal.timestamptz(0, onCreate: now)\n'),
      jsDatePreset: detects("createdAt: field.temporal.timestamptzJsDate(3, 'now'),"),
      jsDatePresetPsl: detects('  createdAt temporal.timestamptzJsDate(3, onCreate: now)\n'),
      stringPreset: detects('  createdAt temporal.timestamptzString(0)\n'),
      databaseDefault: detects('  createdAt DateTime @default(now())\n'),
    }).toEqual({
      prisma7: true,
      attribute: true,
      alias: true,
      typescript: true,
      temporalPreset: true,
      jsDatePreset: true,
      jsDatePresetPsl: true,
      stringPreset: false,
      databaseDefault: false,
    });
  });
});
