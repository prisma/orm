import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.20-to-8.0.0-rc.21/instructions.md',
} as const;

/** The published package an application imports from, kept out of literal import text so the import-root lint reads this file as test data. */
const published = ['@prisma', 'orm-postgres'].join('/');

function patternsOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

describe.each(['app', 'extension'] as const)(
  'the %s explicit date and time type detection',
  (audience) => {
    const matches = (id: string, content: string) =>
      patternsOf(audience, id).some((pattern) => pattern.test(content));

    it('has a pattern for each change it detects', () => {
      for (const id of [
        'psl-temporal-type-renames',
        'ts-temporal-type-helpers-renamed',
        'interval-with-precision-typed-as-parts',
        'branded-time-types-removed',
      ]) {
        expect(patternsOf(audience, id).length).toBeGreaterThan(0);
      }
    });

    it('matches a PSL field or alias written with a renamed type, and nothing else', () => {
      const psl = (line: string) => matches('psl-temporal-type-renames', `model A {\n${line}\n}`);
      expect({
        timestamptz: psl('  at Timestamptz(3)'),
        timestamp: psl('  local Timestamp?'),
        interval: psl('  span Interval[]'),
        alias: psl('types {\n  Stamp = Timestamp(3)\n}'),
        prisma7NativeType: psl('  at DateTime @db.Timestamptz(3)'),
        prisma7Timestamp: psl('  at DateTime @db.Timestamp'),
        newName: psl('  at TimestamptzTemporal(3)'),
        stringType: psl('  at TimestampString(3)'),
        tag: psl('  at TimestamptzTemporal @default(timestamptz`2024-01-01T00:00:00Z`)'),
      }).toEqual({
        timestamptz: true,
        timestamp: true,
        interval: true,
        alias: true,
        prisma7NativeType: false,
        prisma7Timestamp: false,
        newName: false,
        stringType: false,
        tag: false,
      });
    });

    it('matches the renamed TypeScript helpers only', () => {
      const ts = (content: string) => matches('ts-temporal-type-helpers-renamed', content);
      expect({
        helper: ts('field.column(type.Timestamptz(3))'),
        interval: ts('field.column(type.Interval())'),
        columnHelper: ts('field.column(intervalColumn(6))'),
        renamedHelper: ts('field.column(type.TimestamptzTemporal(3))'),
        renamedColumnHelper: ts('field.column(intervalPartsColumn(6))'),
      }).toEqual({
        helper: true,
        interval: true,
        columnHelper: true,
        renamedHelper: false,
        renamedColumnHelper: false,
      });
    });

    it('matches an import of a removed branded type, in either type import form', () => {
      const branded = (content: string) => matches('branded-time-types-removed', content);
      const interval = (content: string) =>
        matches('interval-with-precision-typed-as-parts', content);
      const snapshotImport = `import type {\n  CodecTypes as PgTypes,\n  Interval,\n  Time,\n  Timestamp,\n  Timestamptz,\n} from '${published}/target/codec-types';`;
      expect({
        snapshot: branded(snapshotImport),
        inlineType: branded(`import { type Time } from '${published}/target/codec-types';`),
        interval: interval(`import type { Interval } from '${published}/contract-builder';`),
        inlineInterval: interval(
          `import { field, type Interval } from '${published}/contract-builder';`,
        ),
        keptName: branded(
          `import type { TimestampString } from '${published}/target/codec-types';`,
        ),
        otherPackage: branded("import { Timestamp } from 'bson';"),
      }).toEqual({
        snapshot: true,
        inlineType: true,
        interval: true,
        inlineInterval: true,
        keptName: false,
        otherPackage: false,
      });
    });
  },
);

describe.each(['app', 'extension'] as const)('the %s temporal-spec detection', (audience) => {
  const matches = (content: string) =>
    patternsOf(audience, 'temporal-types-from-temporal-spec').some((pattern) =>
      pattern.test(content),
    );

  it('matches a type test that compares with a global Temporal type, until it imports Temporal itself from temporal-spec', () => {
    expect({
      global: matches(
        "import { expectTypeOf } from 'vitest';\n\nexpectTypeOf<Row['at']>().toEqualTypeOf<Temporal.Instant>();",
      ),
      valueForm: matches('expectTypeOf(row.at).toEqualTypeOf<Temporal.Instant>();'),
      importsTemporalSpec: matches(
        "import type { Temporal } from 'temporal-spec';\n\nexpectTypeOf<Row['at']>().toEqualTypeOf<Temporal.Instant>();",
      ),
      importsAfterUse: matches(
        "expectTypeOf<Row['at']>().toEqualTypeOf<Temporal.Instant>();\nimport type { Temporal } from 'temporal-spec';",
      ),
      noComparison: matches('const at: Temporal.Instant = Temporal.Now.instant();'),
      inlineTypeImport: matches(
        "import { type Temporal } from 'temporal-spec';\n\nexpectTypeOf<Row['at']>().toEqualTypeOf<Temporal.Instant>();",
      ),
      aliasedImport: matches(
        "import type { Temporal as TemporalTypes } from 'temporal-spec';\n\nexpectTypeOf<Row['at']>().toEqualTypeOf<Temporal.Instant>();",
      ),
      aliasedImportCompared: matches(
        "import type { Temporal as TemporalTypes } from 'temporal-spec';\n\nexpectTypeOf<Row['at']>().toEqualTypeOf<TemporalTypes.Instant>();",
      ),
    }).toEqual({
      global: true,
      valueForm: true,
      importsTemporalSpec: false,
      importsAfterUse: false,
      noComparison: false,
      inlineTypeImport: false,
      aliasedImport: true,
      aliasedImportCompared: false,
    });
  });
});
