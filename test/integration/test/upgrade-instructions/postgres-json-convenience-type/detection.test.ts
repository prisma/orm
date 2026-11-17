import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'upgrade-instructions/pending/postgres-json-convenience-type/app/instructions.md',
  'upgrade-instructions/pending/postgres-json-convenience-type/extension/instructions.md',
];

describe.each(GUIDES)('the renamed PostgreSQL JSON column helper detection in %s', (guidePath) => {
  const matches = (content: string) =>
    detectionPatterns(guidePath, 'ts-renamed-postgres-json-column-helper').some((pattern) =>
      pattern.test(content),
    );

  it('matches only files that import jsonColumn from a PostgreSQL package', () => {
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
