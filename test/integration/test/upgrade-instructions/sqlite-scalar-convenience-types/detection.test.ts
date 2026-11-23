import { describe, expect, it } from 'vitest';
import { detectionPatterns, guideChange } from '../guide-detections';

const GUIDES = [
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
];

describe.each(GUIDES)('the renamed SQLite column helpers detection in %s', (guidePath) => {
  const matches = (content: string) =>
    detectionPatterns(guidePath, 'ts-renamed-sqlite-column-helpers').some((pattern) =>
      pattern.test(content),
    );

  it('matches only files that import, re-export or read a renamed helper from a SQLite package', () => {
    expect({
      published: matches(
        "import { integerColumn } from '@prisma/orm-sqlite/adapter/column-types';",
      ),
      target: matches(
        "import { bigintColumn } from '@prisma/orm-target-sqlite/adapter/column-types';",
      ),
      internal: matches(
        "import {\n  textColumn,\n  jsonColumn,\n} from '@internal/adapter-sqlite/column-types';",
      ),
      typeOnly: matches(
        "import type { integerColumn } from '@internal/adapter-sqlite/column-types';",
      ),
      aliased: matches(
        "import { jsonColumn as jc } from '@prisma/orm-sqlite/adapter/column-types';",
      ),
      reExport: matches("export { bigintColumn } from '@prisma/orm-sqlite/adapter/column-types';"),
      namespace: matches(
        "import * as columns from '@prisma/orm-sqlite/adapter/column-types';\n\nfield.column(columns.integerColumn);",
      ),
      namespaceOtherHelper: matches(
        "import * as columns from '@prisma/orm-sqlite/adapter/column-types';\n\nfield.column(columns.textColumn);",
      ),
      renamed: matches(
        "import { integerNumberColumn, integerBigIntColumn, plainJsonColumn } from '@prisma/orm-sqlite/adapter/column-types';",
      ),
      unrenamed: matches(
        "import { textColumn, realColumn, blobColumn } from '@prisma/orm-sqlite/adapter/column-types';",
      ),
      postgres: matches(
        "import { jsonColumn } from '@prisma/orm-postgres/adapter/column-types';\n\nfield.column(jsonColumn);",
      ),
      postgresNamespace: matches(
        "import * as columns from '@internal/adapter-postgres/column-types';\n\nfield.column(columns.jsonColumn);",
      ),
      localHelper: matches("const integerColumn = { codecId: 'sqlite/integer@1' };"),
    }).toEqual({
      published: true,
      target: true,
      internal: true,
      typeOnly: true,
      aliased: true,
      reExport: true,
      namespace: true,
      namespaceOtherHelper: false,
      renamed: false,
      unrenamed: false,
      postgres: false,
      postgresNamespace: false,
      localHelper: false,
    });
  });
});

describe.each(GUIDES)(
  'the SQLite Decimal, BigIntNumber and integer range detections in %s',
  (guidePath) => {
    const matcher = (id: string) => (content: string) =>
      detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));

    it('match a schema with a Decimal field or alias, and not one that only names Decimal otherwise', () => {
      const matches = matcher('sqlite-decimal-codec');
      expect({
        field: matches('model Product {\n  id    Int     @id\n  price Decimal\n}'),
        optional: matches('model Product {\n  price Decimal? @default("1.50")\n}'),
        convenienceCall: matches('model Product {\n  price Decimal(storage: text)\n}'),
        alias: matches('types {\n  Money = Decimal\n}'),
        explicit: matches('model Product {\n  price DecimalString\n}'),
        comment: matches('// a Decimal would be better here\nmodel Product {\n  price String\n}'),
        otherType: matches('model Product {\n  price DecimalValue\n}'),
      }).toEqual({
        field: true,
        optional: true,
        convenienceCall: true,
        alias: true,
        explicit: false,
        comment: false,
        otherType: false,
      });
    });

    it('match a SQLite TypeScript contract that calls type.Decimal, and not a PostgreSQL one', () => {
      const matches = matcher('ts-sqlite-decimal-codec');
      const sqlite = "import { defineContract } from '@prisma/orm-sqlite/contract-builder';\n";
      expect({
        published: matches(`${sqlite}field.column(type.Decimal());`),
        internal: matches(
          "import { defineContract } from '@internal/sqlite/contract-builder';\nfield.column(type.Decimal({ storage: 'text' }));",
        ),
        explicit: matches(`${sqlite}field.column(type.DecimalString());`),
        postgres: matches(
          "import { defineContract } from '@prisma/orm-postgres/contract-builder';\nfield.column(type.Decimal());",
        ),
      }).toEqual({ published: true, internal: true, explicit: false, postgres: false });
    });

    it('match BigIntNumber in a schema or a TypeScript contract, and not a longer name', () => {
      const matches = matcher('sqlite-bigintnumber-deprecated');
      expect({
        field: matches('model Post {\n  views BigIntNumber\n}'),
        alias: matches('types {\n  Views = BigIntNumber\n}'),
        typescript: matches('field.column(type.BigIntNumber());'),
        replacement: matches('model Post {\n  views BigInt(as: number)\n}'),
        longerName: matches('model Post {\n  views BigIntNumberish\n}'),
        codecId: matches("const id = 'sqlite/bigintnumber@1';"),
      }).toEqual({
        field: true,
        alias: true,
        typescript: true,
        replacement: false,
        longerName: false,
        codecId: false,
      });
    });

    it('match a project that depends on or configures the SQLite package, and not a PostgreSQL one', () => {
      const matches = matcher('sqlite-integer-safe-range');
      expect({
        glob: guideChange(guidePath, 'sqlite-integer-safe-range').detection?.glob,
        dependency: matches(
          '{\n  "dependencies": {\n    "@prisma/orm-sqlite": "8.0.0-rc.25"\n  }\n}',
        ),
        targetDependency: matches(
          '{\n  "peerDependencies": {\n    "@prisma/orm-target-sqlite": "8.0.0-rc.25"\n  }\n}',
        ),
        config: matches("import { defineConfig } from '@prisma/orm-sqlite/config';"),
        postgresDependency: matches(
          '{\n  "dependencies": {\n    "@prisma/orm-postgres": "8.0.0-rc.25"\n  }\n}',
        ),
        postgresConfig: matches("import { defineConfig } from '@prisma/orm-postgres/config';"),
        otherPackage: matches(
          '{\n  "dependencies": {\n    "@prisma/orm-sqlite-tools": "1.0.0"\n  }\n}',
        ),
      }).toEqual({
        glob: '**/{package.json,prisma.config.{ts,mts,cts,js,mjs}}',
        dependency: true,
        targetDependency: true,
        config: true,
        postgresDependency: false,
        postgresConfig: false,
        otherPackage: false,
      });
    });
  },
);
