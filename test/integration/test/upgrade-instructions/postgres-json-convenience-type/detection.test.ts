import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.24-to-8.0.0-rc.25/instructions.md',
];

describe.each(GUIDES)('the renamed PostgreSQL JSON column helper detection in %s', (guidePath) => {
  const matches = (content: string) =>
    detectionPatterns(guidePath, 'ts-renamed-postgres-json-column-helper').some((pattern) =>
      pattern.test(content),
    );

  it('matches only files that import, re-export or read jsonColumn from a PostgreSQL package', () => {
    expect({
      published: matches("import { jsonColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      target: matches(
        "import { jsonColumn } from '@prisma/orm-target-postgres/adapter/column-types';",
      ),
      internal: matches(
        "import {\n  textColumn,\n  jsonColumn,\n} from '@internal/adapter-postgres/column-types';",
      ),
      typeOnly: matches(
        "import type { jsonColumn } from '@internal/adapter-postgres/column-types';",
      ),
      aliased: matches(
        "import { jsonColumn as jc } from '@prisma/orm-postgres/adapter/column-types';",
      ),
      reExport: matches("export { jsonColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      namespace: matches(
        "import * as columns from '@prisma/orm-postgres/adapter/column-types';\n\nfield.column(columns.jsonColumn);",
      ),
      namespaceOtherHelper: matches(
        "import * as columns from '@prisma/orm-postgres/adapter/column-types';\n\nfield.column(columns.jsonbColumn);",
      ),
      sqliteReExport: matches(
        "export { jsonColumn } from '@prisma/orm-sqlite/adapter/column-types';",
      ),
      sqliteNamespace: matches(
        "import * as columns from '@prisma/orm-sqlite/adapter/column-types';\n\nfield.column(columns.jsonColumn);",
      ),
      renamed: matches(
        "import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';",
      ),
      jsonb: matches("import { jsonbColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      sqlite: matches(
        "import { jsonColumn, textColumn } from '@prisma/orm-sqlite/adapter/column-types';\n\nfield.column(jsonColumn);",
      ),
      sqliteTarget: matches(
        "import { jsonColumn } from '@prisma/orm-target-sqlite/adapter/column-types';",
      ),
      sqliteInternal: matches(
        "import { jsonColumn } from '@internal/adapter-sqlite/column-types';",
      ),
      localHelper: matches("const jsonColumn = { codecId: 'pg/json@1' };"),
    }).toEqual({
      published: true,
      target: true,
      internal: true,
      typeOnly: true,
      aliased: true,
      reExport: true,
      namespace: true,
      namespaceOtherHelper: false,
      sqliteReExport: false,
      sqliteNamespace: false,
      renamed: false,
      jsonb: false,
      sqlite: false,
      sqliteTarget: false,
      sqliteInternal: false,
      localHelper: false,
    });
  });
});

describe('the PostgreSQL json type lookup detection in the extension guide', () => {
  const matches = (content: string) =>
    detectionPatterns(GUIDES[1] ?? '', 'ts-postgres-explicit-json-type').some((pattern) =>
      pattern.test(content),
    );

  it('matches a lookup of Json in the PostgreSQL type groupings only', () => {
    expect({
      explicit: matches('postgresExplicitTypes.Json.output.codecId'),
      scalar: matches("postgresScalarTypes['Json']"),
      jsonb: matches('postgresExplicitTypes.Jsonb'),
      plainJson: matches('postgresExplicitTypes.PlainJson'),
      sqlite: matches('sqliteScalarTypes.Json'),
    }).toEqual({ explicit: true, scalar: true, jsonb: false, plainJson: false, sqlite: false });
  });
});

describe.each(GUIDES)('the renamed sql.String detections in %s', (guidePath) => {
  const matches = (id: string, content: string) =>
    detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));
  const psl = (content: string) => matches('psl-renamed-sql-string', content);
  const ts = (content: string) => matches('ts-renamed-sql-string', content);

  it('matches sql.String calls in a schema only', () => {
    expect({
      field: psl('model A {\n  name sql.String(50)\n}'),
      spaced: psl('model A {\n  name sql . String (50)\n}'),
      alias: psl('types {\n  Name = sql.String(10)\n}'),
      varchar: psl('model A {\n  name sql.Varchar(50)\n}'),
      convenience: psl('model A {\n  name String\n}'),
      char: psl('model A {\n  code sql.Char(3)\n}'),
    }).toEqual({
      field: true,
      spaced: true,
      alias: true,
      varchar: false,
      convenience: false,
      char: false,
    });
  });

  it('matches sql.String calls in TypeScript only', () => {
    expect({
      builder: ts('field.column(type.sql.String(64))'),
      destructured: ts('const { sql } = type;\nfield.column(sql.String(64));'),
      multiLine: ts('field.column(\n  type.sql\n    .String(64),\n)'),
      varchar: ts('field.column(type.sql.Varchar(64))'),
      convenience: ts('field.column(type.String())'),
      mysql: ts('mysql.String(64)'),
      mysqlMultiLine: ts('mysql\n  .String(64)'),
    }).toEqual({
      builder: true,
      destructured: true,
      multiLine: true,
      varchar: false,
      convenience: false,
      mysql: false,
      mysqlMultiLine: false,
    });
  });
});
