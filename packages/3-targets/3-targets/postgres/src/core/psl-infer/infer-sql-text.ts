import { canonicalSqlText, sqlTextsReadBack } from '@internal/sql-contract/sql-expression';
import { detectIndexNaming, type IndexAttributeSource } from '../psl-build/index-attributes';

/** Why `contract infer` skips an exact-named object whose SQL a `sql` literal would change. */
export const SQL_DOES_NOT_READ_BACK =
  'its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.';

/** The note on a model whose column default `contract infer` printed as a `sql` literal that reads back as different text. */
export function defaultDoesNotReadBackNote(column: string): string {
  return `// prisma: default of "${column}" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration`;
}

/**
 * The index as `contract infer` prints it, or `undefined` when it is skipped. An exact-named index
 * is compared byte for byte, so its SQL must read back unchanged. A wire-named index is compared by
 * name, and its canonical SQL hashes to the same name, so it is printed with that text.
 */
export function printableIndex<Index extends IndexAttributeSource>(
  index: Index,
): Index | undefined {
  if (sqlTextsReadBack([index.expression, index.where])) return index;
  const expression =
    index.expression === undefined ? undefined : canonicalSqlText(index.expression);
  const where = index.where === undefined ? undefined : canonicalSqlText(index.where);
  if (expression === undefined && index.expression !== undefined) return undefined;
  if (where === undefined && index.where !== undefined) return undefined;
  const canonical: Index = {
    ...index,
    ...(expression !== undefined ? { expression } : {}),
    ...(where !== undefined ? { where } : {}),
  };
  return detectIndexNaming(canonical).kind === 'wire' ? canonical : undefined;
}
