import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'upgrade-instructions/pending/sqlite-scalar-convenience-types/app/instructions.md',
  'upgrade-instructions/pending/sqlite-scalar-convenience-types/extension/instructions.md',
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
