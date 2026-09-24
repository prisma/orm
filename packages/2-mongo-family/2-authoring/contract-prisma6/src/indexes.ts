import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import { nodePslSpan, type PslSpan, type ResolvedAttribute } from '@internal/psl-parser';
import {
  ArrayLiteralAst,
  type AttributeArgAst,
  type ExpressionAst,
  FunctionCallAst,
  IdentifierAst,
  type PslSources,
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
  readonly span: PslSpan;
}

interface ParseContext {
  readonly owner: string;
  /** `@` for a field attribute, `@@` for a model attribute. */
  readonly prefix: '@' | '@@';
  readonly sourceId: string;
  readonly sources: PslSources;
  readonly diagnostics: ContractSourceDiagnostic[];
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
    const [callee, ...rest] = call?.path() ?? [];
    if (call === undefined || callee === undefined || rest.length > 0) {
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

/** Reads `@@index`, `@@unique` or `@@fulltext`. `map:` and `name:` are dropped: MongoDB verify never compares index names. */
export function parseIndexAttribute(
  attribute: ResolvedAttribute & { readonly name: IndexAttribute['kind'] },
  ctx: ParseContext,
): IndexAttribute | undefined {
  let fields: readonly IndexField[] | undefined;
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? 'fields' : arg.name;
    if (key === 'map' || key === 'name') continue;
    if (key !== 'fields') {
      return unsupported(attribute, `argument "${key ?? ''}" is not supported.`, arg.span, ctx);
    }
    fields = readFields(attribute, arg.expression, arg.span, ctx);
    if (fields === undefined) return undefined;
  }
  if (fields === undefined || fields.length === 0) {
    return unsupported(attribute, 'expects a list of field names.', attribute.span, ctx);
  }
  return { kind: attribute.name, fields, span: attribute.span };
}

/** Reads a field's `@unique`: `sort:` sets the key direction; `map:` and `name:` are dropped. */
export function parseFieldUnique(
  attribute: ResolvedAttribute,
  fieldName: string,
  ctx: ParseContext,
): IndexAttribute | undefined {
  let direction: IndexDirection | undefined;
  for (const arg of attribute.args) {
    const key = arg.kind === 'positional' ? undefined : arg.name;
    if (key === 'map' || key === 'name') continue;
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
  return { kind: 'unique', fields: [{ name: fieldName, direction }], span: attribute.span };
}
