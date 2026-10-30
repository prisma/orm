import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = {
  app: 'upgrade-instructions/pending/mongo-convenience-date-time-types/app/instructions.md',
  extension:
    'upgrade-instructions/pending/mongo-convenience-date-time-types/extension/instructions.md',
} as const;

const mongoSchema = (field: string) =>
  `// use prisma-8\n\nmodel Post {\n  id ObjectId @id @map("_id")\n  ${field}\n}\n`;
const builderImport = "import { defineContract } from '@prisma/orm-mongo/contract-builder';\n";

describe.each(Object.entries(GUIDES))(
  'the %s mongo-date-is-a-calendar-date detection',
  (_, guide) => {
    const matches = (content: string) =>
      detectionPatterns(guide, 'mongo-date-is-a-calendar-date').some((pattern) =>
        pattern.test(content),
      );

    it('matches a MongoDB schema field or alias typed Date, and a MongoDB contract calling Date', () => {
      expect([
        matches(mongoSchema('at Date')),
        matches(mongoSchema('at Date? @map("a")')),
        matches(`types {\n  Stamp = Date\n}\n${mongoSchema('at Stamp')}`),
        matches(`${builderImport}field.scalar(type.Date());`),
        matches(`${builderImport}defineContract({}, ({ type: t }) => t.Date());`),
        matches(`${builderImport}mongo.type.Date();`),
      ]).toEqual([true, true, true, true, true, true]);
    });

    it('matches a MongoDB schema whose ids are strings, which names no ObjectId', () => {
      expect(
        matches('// use prisma-8\n\nmodel Post {\n  id String @id @map("_id")\n  at Date\n}\n'),
      ).toBe(true);
    });

    it('matches a MongoDB config whose contract is a schema, so the script finds every MongoDB schema', () => {
      const config = (entry: string, contract: string) =>
        `import { defineConfig } from '${entry}';\nexport default defineConfig({ contract: '${contract}' });\n`;
      expect({
        mongo: matches(config('@prisma/orm-mongo/config', './prisma/schema.prisma')),
        mongoTypeScript: matches(config('@prisma/orm-mongo/config', './prisma/contract.ts')),
        postgres: matches(config('@prisma/orm-postgres/config', './prisma/schema.prisma')),
      }).toEqual({ mongo: true, mongoTypeScript: false, postgres: false });
    });

    it('does not match a rewritten source, a SQL or Prisma 6 schema, or new Date()', () => {
      expect([
        matches(mongoSchema('at DateTime')),
        matches('// use prisma-8\n\nmodel Person {\n  id  Int  @id\n  day Date\n}\n'),
        matches(
          `datasource db {\n  provider = "mongodb"\n}\n${mongoSchema('at DateTime @db.Date')}`,
        ),
        matches(`${builderImport}field.scalar(type.DateTime()); const now = new Date();`),
        matches(
          "import { defineContract } from '@prisma/orm-postgres/contract-builder';\ntype.Date();",
        ),
      ]).toEqual([false, false, false, false, false]);
    });
  },
);
