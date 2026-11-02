import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDES = [
  'upgrade-instructions/pending/scalar-convenience-types/app/instructions.md',
  'upgrade-instructions/pending/scalar-convenience-types/extension/instructions.md',
];

describe.each(GUIDES)('the renamed PostgreSQL scalar type detection in %s', (guidePath) => {
  const matches = (id: string, content: string) =>
    detectionPatterns(guidePath, id).some((pattern) => pattern.test(content));

  it('matches a Prisma 8 field or alias typed with a renamed name, and nothing else', () => {
    const psl = (body: string) =>
      matches('psl-renamed-postgres-scalar-types', `// use prisma-8\n\n${body}\n`);
    expect({
      smallInt: psl('model A {\n  visits SmallInt\n}'),
      bigIntNumber: psl('model A {\n  rank BigIntNumber?\n}'),
      numeric: psl('model A {\n  price Numeric(10, 2)\n}'),
      unboundedInt: psl('model A {\n  huge UnboundedInt[]\n}'),
      real: psl('model A {\n  ratio Real @default(1.5)\n}'),
      varChar: psl('model A {\n  code VarChar(12)\n}'),
      alias: psl('types {\n  Slug = VarChar(64)\n}'),
      convenience: psl('model A {\n  code String(storage: varchar, length: 12)\n  n Int\n}'),
      explicit: psl('model A {\n  code Varchar(12)\n  price NumericString(10, 2)\n}'),
      comment: psl('// a SmallInt field\nmodel A {\n  id Int @id\n}'),
      prisma7: psl(
        'datasource db {\n  provider = "postgresql"\n}\nmodel A {\n  code String @db.VarChar(12)\n}',
      ),
    }).toEqual({
      smallInt: true,
      bigIntNumber: true,
      numeric: true,
      unboundedInt: true,
      real: true,
      varChar: true,
      alias: true,
      convenience: false,
      explicit: false,
      comment: false,
      prisma7: false,
    });
  });

  it('matches the TypeScript helpers of the renamed names only', () => {
    const ts = (content: string) => matches('ts-renamed-postgres-scalar-helpers', content);
    expect({
      varChar: ts('field.column(type.VarChar(64))'),
      numeric: ts('field.column(type.Numeric(10, 2))'),
      bigIntNumber: ts('field.column(type.BigIntNumber())'),
      varchar: ts('field.column(type.Varchar(64))'),
      sqlString: ts('field.column(type.sql.String(64))'),
      convenience: ts("field.column(type.String({ storage: 'varchar', length: 64 }))"),
    }).toEqual({
      varChar: true,
      numeric: true,
      bigIntNumber: true,
      varchar: false,
      sqlString: false,
      convenience: false,
    });
  });

  it('matches the renamed column helpers only', () => {
    const ts = (content: string) => matches('ts-renamed-postgres-column-helpers', content);
    expect({
      int8: ts("import { int8Column } from '@prisma/orm-postgres/adapter/column-types';"),
      numeric: ts('field.column(numericColumn(10, 2))'),
      int8BigInt: ts('field.column(int8BigIntColumn)'),
      numericString: ts('field.column(numericStringColumn(10, 2))'),
      int4: ts('field.column(int4Column)'),
    }).toEqual({
      int8: true,
      numeric: true,
      int8BigInt: false,
      numericString: false,
      int4: false,
    });
  });
});

describe('the renamed PostgreSQL type grouping detection in the extension guide', () => {
  const matches = (content: string) =>
    detectionPatterns(GUIDES[1] ?? '', 'ts-renamed-postgres-type-groupings').some((pattern) =>
      pattern.test(content),
    );

  it('matches the removed exports only', () => {
    expect({
      scalar: matches(
        "import { postgresScalarAuthoringTypes } from '@internal/target-postgres/control';",
      ),
      native: matches('collectScalarTypeConstructors(postgresNativeAuthoringTypes)'),
      aggregate: matches('{ ...postgresScalarAndNativeTypeConstructors }'),
      explicit: matches('collectScalarTypeConstructors(postgresExplicitTypes)'),
      namespace: matches('{ ...postgresTypeNamespace }'),
    }).toEqual({ scalar: true, native: true, aggregate: true, explicit: false, namespace: false });
  });
});
