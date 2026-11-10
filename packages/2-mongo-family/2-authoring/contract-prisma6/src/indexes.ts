import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { nodePslSpan, type PslSpan, type ResolvedAttribute } from '@internal/psl-parser';
import {
  ArrayLiteralAst,
  type AttributeArgAst,
  type ExpressionAst,
  FunctionCallAst,
  IdentifierAst,
  PathExprAst,
  type PslSources,
  StringLiteralExprAst,
} from '@internal/psl-parser/syntax';
import { prisma6Diagnostic } from './diagnostics';

export type IndexDirection = 1 | -1;

export interface IndexField {
  /** The field's Prisma 6 name. */
  readonly name: string;
  /** The `sort:` the field names; `undefined` when it names none. */
  readonly direction: IndexDirection | undefined;
}

/** `@@index([...])`, `@@unique([...])` or `@@fulltext([...])` as Prisma 6 writes them. */
export interface IndexAttribute {
  readonly kind: 'index' | 'unique' | 'fulltext';
  readonly fields: readonly IndexField[];
  /** The name `map:` gives the index, or `name:` on `@@index`; `undefined` when neither is written. */
  readonly map: string | undefined;
  readonly span: PslSpan;
}

/** Prisma 6's longest MongoDB index name, in bytes (`max_identifier_length` of its MongoDB connector). */
const MAX_INDEX_NAME_BYTES = 127;

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The longest start of `text` whose UTF-8 form is at most `bytes` long, cut between characters. */
function truncateToBytes(text: string, bytes: number): string {
  let out = '';
  for (const char of text) {
    if (utf8Length(out + char) > bytes) break;
    out += char;
  }
  return out;
}

/**
 * The name Prisma 6 gives an index without `map:`, as prisma-engines 6.19.3 `ConstraintNames` builds it: the collection, then the stored field names, joined by `_`, and `_key` for a unique index or `_idx` for any other, the part before the suffix cut to fit 127 bytes.
 */
export function prisma6IndexName(
  collection: string,
  storedFields: readonly string[],
  unique: boolean,
): string {
  const suffix = unique ? '_key' : '_idx';
  const joined = `${collection}_${storedFields.join('_')}`;
  const room = MAX_INDEX_NAME_BYTES - suffix.length;
  return `${utf8Length(joined) >= room ? truncateToBytes(joined, room) : joined}${suffix}`;
}

/** Why Prisma 6 refuses the name `map:` gives an index, or `undefined` when it accepts it. */
export function prisma6IndexNameProblem(name: string): string | undefined {
  if (name === '') return 'The `map` argument cannot be an empty string.';
  if (utf8Length(name) > MAX_INDEX_NAME_BYTES) {
    return `The constraint name '${name}' specified in the \`map\` argument is too long for your chosen provider. The maximum allowed length is ${MAX_INDEX_NAME_BYTES} bytes.`;
  }
  return undefined;
}

interface ParseContext {
  readonly owner: string;
  /** `@` for a field attribute, `@@` for a model attribute. */
  readonly prefix: '@' | '@@';
  readonly sourceId: string;
  readonly sources: PslSources;
  readonly diagnostics: ContractSourceDiagnostic[];
  /** The owner's fields whose type is a composite type; an index path must start at one. */
  readonly compositeFields: ReadonlySet<string>;
}

function unsupported(
  attribute: ResolvedAttribute,
  what: string,
  span: PslSpan,
  ctx: ParseContext,
): undefined {
  ctx.diagnostics.push(
    prisma6Diagnostic(
      'PSL.PRISMA6_MONGO_INDEX_ARGUMENT_UNSUPPORTED',
      `${ctx.owner}: ${ctx.prefix}${attribute.name} ${what}`,
      ctx.sourceId,
      span,
    ),
  );
  return undefined;
}

function sortDirection(expression: ExpressionAst | undefined): IndexDirection | undefined {
  if (expression === undefined) return undefined;
  const token = IdentifierAst.cast(expression.syntax)?.name();
  return token === 'Asc' ? 1 : token === 'Desc' ? -1 : undefined;
}

/**
 * Reads `sort:` from one index element's or `@unique`'s arguments. `length:` and every other argument are refused: a MongoDB index has no prefix length, and Prisma 6 accepts no other argument there on MongoDB.
 */
function readSort(
  attribute: ResolvedAttribute,
  args: Iterable<AttributeArgAst>,
  ctx: ParseContext,
): { readonly direction: IndexDirection | undefined } | undefined {
  let direction: IndexDirection | undefined;
  for (const arg of args) {
    const key = arg.name()?.name();
    const span = nodePslSpan(arg.syntax, ctx.sources);
    if (key !== 'sort') {
      return unsupported(
        attribute,
        key === 'length'
          ? 'argument "length" is not supported: a MongoDB index has no prefix length. Remove it; Prisma 6 ignores it on MongoDB.'
          : `argument "${key ?? ''}" is not supported.`,
        span,
        ctx,
      );
    }
    direction = sortDirection(arg.value());
    if (direction === undefined) {
      return unsupported(attribute, 'sort must be Asc or Desc.', span, ctx);
    }
  }
  return { direction };
}

function readFields(
  attribute: ResolvedAttribute,
  expression: ExpressionAst | undefined,
  span: PslSpan,
  ctx: ParseContext,
): readonly IndexField[] | undefined {
  const array = expression === undefined ? undefined : ArrayLiteralAst.cast(expression.syntax);
  if (array === undefined)
    return unsupported(attribute, 'expects a list of field names.', span, ctx);
  const fields: IndexField[] = [];
  for (const element of array.elements()) {
    const name = IdentifierAst.cast(element.syntax)?.name();
    if (name !== undefined) {
      fields.push({ name, direction: undefined });
      continue;
    }
    const call = FunctionCallAst.cast(element.syntax);
    const path = PathExprAst.cast(element.syntax)?.path() ?? call?.path() ?? [];
    const [callee] = path;
    if (path.length > 1 && (callee === undefined || !ctx.compositeFields.has(callee))) {
      return unsupported(
        attribute,
        `lists the dotted path "${path.join('.')}", but "${callee ?? ''}" is not a composite-type field of the model, and Prisma 6 refuses the path as an unknown field. List fields of the model by name.`,
        nodePslSpan(element.syntax, ctx.sources),
        ctx,
      );
    }
    if (path.length > 1) {
      ctx.diagnostics.push(
        prisma6Diagnostic(
          'PSL.PRISMA6_MONGO_COMPOSITE_INDEX_PATH_UNSUPPORTED',
          `Index path "${path.join('.')}" reaches into a composite type; indexes on composite-type fields are not supported yet. Index a top-level field or remove the index. Either change also reaches the Prisma 6 app, whose \`db push\` builds its indexes from this schema.`,
          ctx.sourceId,
          nodePslSpan(element.syntax, ctx.sources),
        ),
      );
      return undefined;
    }
    if (call === undefined || callee === undefined) {
      return unsupported(
        attribute,
        'expects a list of field names.',
        nodePslSpan(element.syntax, ctx.sources),
        ctx,
      );
    }
    const sort = readSort(attribute, call.args(), ctx);
    if (sort === undefined) return undefined;
    fields.push({ name: callee, direction: sort.direction });
  }
  return fields;
}

function readName(
  attribute: ResolvedAttribute,
  expression: ExpressionAst | undefined,
  span: PslSpan,
  ctx: ParseContext,
): { readonly name: string } | undefined {
  const name =
    expression === undefined ? undefined : StringLiteralExprAst.cast(expression.syntax)?.value();
  return name === undefined
    ? unsupported(attribute, 'expects a string name.', span, ctx)
    : { name };
}

/**
 * Reads `@@index`, `@@unique` or `@@fulltext`. `map:` names the index; on `@@index`, `name:` does too, as Prisma 6 reads it, and the two together are refused. `name:` on `@@unique` names the Prisma 6 client field, not the index, and is dropped.
 */
export function parseIndexAttribute(
  attribute: ResolvedAttribute & { readonly name: IndexAttribute['kind'] },
  ctx: ParseContext,
): IndexAttribute | undefined {
  let fields: readonly IndexField[] | undefined;
  let map: string | undefined;
  let legacyName: string | undefined;
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? 'fields' : arg.name;
    if (key === 'name' && attribute.name !== 'index') continue;
    if (key === 'map' || key === 'name') {
      const read = readName(attribute, arg.expression, arg.span, ctx);
      if (read === undefined) return undefined;
      if (key === 'map') map = read.name;
      else legacyName = read.name;
      continue;
    }
    if (key !== 'fields') {
      return unsupported(attribute, `argument "${key ?? ''}" is not supported.`, arg.span, ctx);
    }
    fields = readFields(attribute, arg.expression, arg.span, ctx);
    if (fields === undefined) return undefined;
  }
  if (map !== undefined && legacyName !== undefined) {
    return unsupported(
      attribute,
      'gives both `map` and `name`. Prisma 6 refuses this: "The `@@index` attribute accepts the `name` argument as an alias for the `map` argument for legacy reasons. It does not accept both though." Remove `name`.',
      attribute.span,
      ctx,
    );
  }
  if (fields === undefined || fields.length === 0) {
    return unsupported(attribute, 'expects a list of field names.', attribute.span, ctx);
  }
  return { kind: attribute.name, fields, map: map ?? legacyName, span: attribute.span };
}

/** Reads a field's `@unique`: `sort:` sets the key direction and `map:` the index name. */
export function parseFieldUnique(
  attribute: ResolvedAttribute,
  fieldName: string,
  ctx: ParseContext,
): IndexAttribute | undefined {
  let direction: IndexDirection | undefined;
  let map: string | undefined;
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? undefined : arg.name;
    if (key === 'name') continue;
    if (key === 'map') {
      const read = readName(attribute, arg.expression, arg.span, ctx);
      if (read === undefined) return undefined;
      map = read.name;
      continue;
    }
    if (key === 'sort') {
      direction = sortDirection(arg.expression);
      if (direction === undefined) {
        return unsupported(attribute, 'sort must be Asc or Desc.', arg.span, ctx);
      }
      continue;
    }
    return unsupported(
      attribute,
      key === 'length'
        ? 'argument "length" is not supported: a MongoDB index has no prefix length. Remove it; Prisma 6 ignores it on MongoDB.'
        : `argument "${key ?? ''}" is not supported.`,
      arg.span,
      ctx,
    );
  }
  return { kind: 'unique', fields: [{ name: fieldName, direction }], map, span: attribute.span };
}
