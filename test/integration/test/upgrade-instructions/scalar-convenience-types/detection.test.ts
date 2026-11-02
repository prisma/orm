import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

const GUIDES = [
  'upgrade-instructions/pending/scalar-convenience-types/app/instructions.md',
  'upgrade-instructions/pending/scalar-convenience-types/extension/instructions.md',
];

function patternsOf(guidePath: string, id: string): readonly RegExp[] {
  const guide = readFileSync(join(repoRoot, guidePath), 'utf-8');
  const block = guide.split(/\n {2}- id: /).find((entry) => entry.startsWith(`${id}\n`)) ?? '';
  return [...block.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
}

describe.each(GUIDES)('the renamed PostgreSQL scalar type detection in %s', (guidePath) => {
  const matches = (id: string, content: string) =>
    patternsOf(guidePath, id).some((pattern) => pattern.test(content));

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
});
