import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function detects(audience: keyof typeof GUIDE_PATHS, id: string, content: string): boolean {
  return detectionPatterns(GUIDE_PATHS[audience], id).some((pattern) => pattern.test(content));
}

const prisma8 = (body: string) => `// use prisma-8\n\n${body}`;

describe.each(['app', 'extension'] as const)(
  '%s client-functions-move-from-default-to-on-create detection',
  (audience) => {
    const id = 'client-functions-move-from-default-to-on-create';

    it.each([
      ['uuid', prisma8('model User {\n  id String @id @default(uuid(7))\n}')],
      [
        'the older directive',
        '// use prisma-next\nmodel User {\n  id String @id @default(cuid(2))\n}',
      ],
    ])('finds %s in a Prisma 8 schema', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['a Prisma 7 schema', 'model User {\n  id String @id @default(uuid())\n}'],
      ['the new form', prisma8('model User {\n  id String @id @onCreate(uuid(7))\n}')],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  },
);

describe.each(['app', 'extension'] as const)(
  '%s date-time-interval-and-bytes-defaults-use-tags detection',
  (audience) => {
    const id = 'date-time-interval-and-bytes-defaults-use-tags';

    it.each([
      ['a quoted instant', prisma8('  at DateTime @default("2024-01-01T00:00:00Z")')],
      ['a quoted time', prisma8('  clock Time @default("12:34")')],
      ['an interval in words', prisma8('  span Interval @default("1 day")')],
      ['infinity', prisma8('  until Timestamptz(3) @default("infinity")')],
      ['bytes', prisma8('  payload Bytes @default("AQID")')],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(true);
    });

    it.each([
      ['a Prisma 7 schema', 'model Event {\n  at DateTime @default("2024-01-01T00:00:00Z")\n}'],
      ['a string that looks like a time', prisma8('  label String @default("12:30")')],
      ['a tagged default', prisma8('  at DateTime @default(timestamptz`2024-01-01T00:00:00Z`)')],
    ])('skips %s', (_name, content) => {
      expect(detects(audience, id, content)).toBe(false);
    });
  },
);
