import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'upgrade-instructions/pending/postgres-json-convenience-type/app/instructions.md',
  'upgrade-instructions/pending/postgres-json-convenience-type/extension/instructions.md',
];

describe.each(GUIDES)('the PostgreSQL Json detection in %s', (guidePath) => {
  const matches = (id: string, content: string) =>
    detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));

  it('matches a Prisma 8 field or alias typed with a bare Json, and nothing else', () => {
    const psl = (body: string) =>
      matches('psl-postgres-json-stores-jsonb', `// use prisma-8\n\n${body}\n`);
    expect({
      bare: psl('model A {\n  payload Json\n}'),
      optional: psl('model A {\n  payload Json?\n}'),
      list: psl('model A {\n  payloads Json[]\n}'),
      attribute: psl('model A {\n  payload Json @default(json`{}`)\n}'),
      alias: psl('types {\n  Payload = Json\n}'),
      call: psl('model A {\n  payload Json(storage: json)\n}'),
      jsonb: psl('model A {\n  payload Jsonb\n}'),
      plainJson: psl('model A {\n  payload PlainJson\n}'),
      comment: psl('// a Json field\nmodel A {\n  id Int @id\n}'),
      prisma7: psl('datasource db {\n  provider = "postgresql"\n}\nmodel A {\n  payload Json\n}'),
    }).toEqual({
      bare: true,
      optional: true,
      list: true,
      attribute: true,
      alias: true,
      call: false,
      jsonb: false,
      plainJson: false,
      comment: false,
      prisma7: false,
    });
  });

  it('matches the TypeScript Json helper called with no storage only', () => {
    const ts = (content: string) => matches('ts-postgres-json-stores-jsonb', content);
    expect({
      bare: ts('field.column(type.Json())'),
      spaced: ts('field.column(type.Json( ))'),
      storage: ts("field.column(type.Json({ storage: 'json' }))"),
      jsonb: ts('field.column(type.Jsonb())'),
      plainJson: ts('field.column(type.PlainJson())'),
    }).toEqual({ bare: true, spaced: true, storage: false, jsonb: false, plainJson: false });
  });

  it('matches only files that import jsonColumn from the PostgreSQL package', () => {
    const ts = (content: string) => matches('ts-renamed-postgres-json-column-helper', content);
    expect({
      published: ts("import { jsonColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      internal: ts(
        "import {\n  textColumn,\n  jsonColumn,\n} from '@internal/adapter-postgres/column-types';",
      ),
      renamed: ts("import { plainJsonColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      jsonb: ts("import { jsonbColumn } from '@prisma/orm-postgres/adapter/column-types';"),
      sqlite: ts("import { jsonColumn } from '@prisma/orm-sqlite/adapter/column-types';"),
    }).toEqual({ published: true, internal: true, renamed: false, jsonb: false, sqlite: false });
  });
});

describe('the Json type choice detection in the extension guide', () => {
  const matches = (content: string) =>
    detectionPatterns(GUIDES[1] ?? '', 'ts-postgres-json-type-choice').some((pattern) =>
      pattern.test(content),
    );

  it('matches a lookup of Json in the PostgreSQL type groupings only', () => {
    expect({
      explicit: matches('postgresExplicitTypes.Json.output.codecId'),
      scalar: matches("postgresScalarTypes['Json']"),
      jsonb: matches('postgresExplicitTypes.Jsonb'),
      plainJson: matches('postgresExplicitTypes.PlainJson'),
    }).toEqual({ explicit: true, scalar: true, jsonb: false, plainJson: false });
  });
});
