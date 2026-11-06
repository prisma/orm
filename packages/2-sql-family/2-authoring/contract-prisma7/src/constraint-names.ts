import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ResolvedAttribute } from '@internal/psl-parser';
import { ModelAttributeAst, StringLiteralExprAst } from '@internal/psl-parser/syntax';
import { utf8ByteLength } from '@internal/utils/text';
import { prisma7Diagnostic } from './diagnostics';
import { prisma7ConstraintName } from './indexes';

/** Prisma 7's primary key name: `map`, or `{table}_pkey` cut to `maxBytes`. */
export function prisma7PrimaryKeyName(
  tableName: string,
  map: string | undefined,
  maxBytes: number,
): string {
  return map ?? prisma7ConstraintName(tableName, '_pkey', maxBytes);
}

/** Prisma 7's foreign key name: `map`, or `{table}_{columns}_fkey` cut to `maxBytes`. */
export function prisma7ForeignKeyName(
  tableName: string,
  columns: readonly string[],
  map: string | undefined,
  maxBytes: number,
): string {
  return map ?? prisma7ConstraintName(`${tableName}_${columns.join('_')}`, '_fkey', maxBytes);
}

/** Prisma 7's primary key name for the junction table of an implicit many-to-many relation. */
export function prisma7JunctionPrimaryKeyName(relationName: string, maxBytes: number): string {
  return prisma7ConstraintName(`_${relationName}`, '_AB_pkey', maxBytes);
}

/** Prisma 7's name for the junction foreign key on column `A` or `B`. */
export function prisma7JunctionForeignKeyName(
  relationName: string,
  column: 'A' | 'B',
  maxBytes: number,
): string {
  return prisma7ConstraintName(`_${relationName}`, `_${column}_fkey`, maxBytes);
}

/**
 * The name a contract states for a constraint Prisma 7 named `prisma7Name`: the name itself where the target would derive a different one, and `undefined` where the two agree, so the contract stays unnamed there and a table rename keeps deriving it.
 */
export function statedConstraintName(prisma7Name: string, derivedName: string): string | undefined {
  return prisma7Name === derivedName ? undefined : prisma7Name;
}

/**
 * Refuses a `map` on `@id`, `@@id`, `@unique`, `@@unique`, `@@index` or `@relation` longer than the database keeps, as Prisma 7 does. The database would store the name cut short, so a contract holding it whole would rename or drop a constraint the database does not have.
 */
export function checkStatedConstraintNameLength(input: {
  readonly attribute: ResolvedAttribute;
  readonly owner: string;
  readonly maxBytes: number;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): void {
  const { attribute, maxBytes } = input;
  const mapArgument = attribute.args.find((arg) => arg.kind === 'named' && arg.name === 'map');
  const expression = mapArgument?.expression;
  const name =
    expression === undefined ? undefined : StringLiteralExprAst.cast(expression.syntax)?.value();
  if (mapArgument === undefined || name === undefined) return;
  const bytes = utf8ByteLength(name);
  if (bytes <= maxBytes) return;
  const spelling = `${attribute.node instanceof ModelAttributeAst ? '@@' : '@'}${attribute.name}`;
  input.diagnostics.push(
    prisma7Diagnostic(
      'PSL.PRISMA7_CONSTRAINT_NAME_TOO_LONG',
      `${input.owner}: the name "${name}" in the map argument of ${spelling} is ${bytes} bytes, longer than the ${maxBytes} bytes the database keeps. Shorten the map to ${maxBytes} bytes or fewer; Prisma 7 refuses this name too.`,
      input.sourceId,
      mapArgument.span,
    ),
  );
}
