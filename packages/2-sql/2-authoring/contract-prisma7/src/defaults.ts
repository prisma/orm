import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ExecutionMutationDefaultValue, JsonValue } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { ControlMutationDefaults } from '@internal/framework-components/control';
import type { FieldSymbol, PslSpan, ResolvedAttribute } from '@internal/psl-parser';
import type { ExpressionAst } from '@internal/psl-parser/syntax';
import {
  ArrayLiteralAst,
  type AttributeArgAst,
  BooleanLiteralExprAst,
  FunctionCallAst,
  IdentifierAst,
  NumberLiteralExprAst,
  printSyntax,
  StringLiteralExprAst,
} from '@internal/psl-parser/syntax';
import {
  type DataTypeSupport,
  type DefaultRefusal,
  entryForTag,
  readDataTypeDefault,
  type WrittenValue,
} from '@internal/sql-contract-psl/resolution';
import type {
  AuthoredColumnDefault,
  AuthoredColumnDefaultLiteralValue,
} from '@internal/sql-contract-ts/contract-builder';
import { prisma7Diagnostic } from './diagnostics';
import type { Prisma7LiteralDefaultForm } from './target-binding';

export interface LoweredPrisma7Default {
  readonly storage: AuthoredColumnDefault | undefined;
  readonly onCreate: ExecutionMutationDefaultValue | undefined;
}

export interface LowerPrisma7DefaultInput {
  readonly attribute: ResolvedAttribute;
  readonly field: FieldSymbol;
  readonly modelName: string;
  readonly codecId: string;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  readonly codecLookup: CodecLookup;
  readonly literalForm: Prisma7LiteralDefaultForm | undefined;
  /** Storage value per member name when the field is typed by a Prisma 7 enum. */
  readonly enumMembers: ReadonlyMap<string, string> | undefined;
  readonly controlMutationDefaults: ControlMutationDefaults;
  /** The stack's data types and the PSL support for them, which this reader maps its syntax onto. */
  readonly dataTypeSupport: DataTypeSupport;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}

type LiteralValue = string | number | boolean;

const CLIENT_SIDE_GENERATORS: ReadonlySet<string> = new Set(['uuid', 'cuid', 'ulid', 'nanoid']);

export function givesColumnDefault(attribute: ResolvedAttribute | undefined): boolean {
  const expression = attribute?.args.find((arg) => arg.kind === 'positional')?.expression;
  if (expression === undefined) return false;
  const call = FunctionCallAst.cast(expression.syntax);
  if (call === undefined) return true;
  const fn = call.path().join('.');
  if (CLIENT_SIDE_GENERATORS.has(fn)) return false;
  return fn !== 'dbgenerated' || [...call.args()].length > 0;
}

/** Positional argument keys per Prisma 7 default function, matching the target registry's signatures. */
const FUNCTION_ARGUMENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  uuid: ['version'],
  cuid: ['version'],
  nanoid: ['size'],
  now: [],
  autoincrement: [],
  ulid: [],
};

function literalArgument(expression: ExpressionAst): LiteralValue | undefined {
  const text = StringLiteralExprAst.cast(expression.syntax)?.value();
  if (text !== undefined) return text;
  const number = NumberLiteralExprAst.cast(expression.syntax)?.value();
  if (number !== undefined) return number;
  return BooleanLiteralExprAst.cast(expression.syntax)?.value();
}

export function lowerPrisma7Default(
  input: LowerPrisma7DefaultInput,
): LoweredPrisma7Default | undefined {
  const { attribute, field, sourceId, diagnostics } = input;
  const label = `Field "${input.modelName}.${field.name}"`;
  const unknown = (reason: string, span: PslSpan): undefined => {
    diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_DEFAULT',
        `${label}: @default ${reason}`,
        sourceId,
        span,
      ),
    );
    return undefined;
  };
  const argument = attribute.args.find((arg) => arg.kind === 'positional');
  const expression = argument?.expression;
  if (argument === undefined || expression === undefined) {
    return unknown('needs one value.', attribute.span);
  }

  const call = FunctionCallAst.cast(expression.syntax);
  if (call !== undefined) {
    return lowerFunction(call, input, label, unknown);
  }

  const rawLiteral =
    input.literalForm?.kind === 'sqlExpression'
      ? sqlExpressionDefault(expression, input.literalForm, input.field.list)
      : undefined;
  if (rawLiteral === 'unreadable') {
    return unknown('holds a value this contract source does not read.', attribute.span);
  }
  if (rawLiteral !== undefined) {
    return {
      storage: { kind: 'function', expression: rawLiteral.expression },
      onCreate: undefined,
    };
  }

  const scalar = scalarValue(expression, input, unknown);
  if (scalar === undefined) return undefined;
  return { storage: { kind: 'literal', value: scalar, canonical: true }, onCreate: undefined };
}

/**
 * The stored value of a written default: an enum member resolves through the enum's members, and
 * every other value is read by the authoring entry for its syntax, cast into the column's data type
 * and validated by the column's codec — the same path the current schema language takes.
 */
function scalarValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  unknown: (reason: string, span: PslSpan) => undefined,
): AuthoredColumnDefaultLiteralValue | undefined {
  const span = input.attribute.span;
  const enumValue = enumMemberValue(expression, input);
  if (enumValue !== undefined) return enumValue;

  const array = ArrayLiteralAst.cast(expression.syntax);
  const elements = array === undefined ? undefined : [...array.elements()];
  if (elements?.some((element) => enumMemberValue(element, input) !== undefined) === true) {
    const values: AuthoredColumnDefaultLiteralValue[] = [];
    for (const element of elements) {
      const value = enumMemberValue(element, input);
      if (value === undefined) {
        return unknown('lists may only hold literals or enum members.', span);
      }
      values.push(value);
    }
    return values;
  }

  const written = writtenLiteralFor(expression, elements, input);
  if (written === undefined) return unreadableValue(expression, input, unknown);

  const jsonNull = jsonNullDefault(written, expression, input);
  if (jsonNull !== undefined) return jsonNull;

  const read = readDataTypeDefault({
    written,
    isList: input.field.list,
    column: { codecId: input.codecId, typeParams: input.typeParams },
    codecLookup: input.codecLookup,
    support: input.dataTypeSupport,
    fieldPath: `${input.modelName}.${input.field.name}`,
  });
  return read.ok ? read.value : unknown(refusalReason(read.refusal), span);
}

/** The storage value of an enum member name, when the field is typed by a Prisma 7 enum. */
function enumMemberValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): string | undefined {
  const member = IdentifierAst.cast(expression.syntax)?.name();
  return member === undefined ? undefined : input.enumMembers?.get(member);
}

function writtenLiteralFor(
  expression: ExpressionAst,
  elements: readonly ExpressionAst[] | undefined,
  input: LowerPrisma7DefaultInput,
): WrittenValue | undefined {
  if (elements === undefined) return writtenLiteral(expression, input);
  const written: WrittenValue[] = [];
  for (const element of elements) {
    const elementLiteral = writtenLiteral(element, input);
    if (elementLiteral === undefined) return undefined;
    written.push(elementLiteral);
  }
  return { kind: 'list', elements: written };
}

/**
 * The JSON value null, which the contract cannot tell apart from SQL NULL, reported before the
 * column's codec sees the literal.
 */
function jsonNullDefault(
  written: WrittenValue,
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): undefined {
  if (input.literalForm?.kind !== 'json') return undefined;
  const value = jsonDocumentOf(written, input);
  if (value === undefined) return undefined;
  const isNull = Array.isArray(value) ? value.includes(null) : value === null;
  if (!isNull) return undefined;
  input.diagnostics.push(
    prisma7Diagnostic(
      'PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED',
      `Field "${input.modelName}.${input.field.name}": @default(${printSyntax(expression.syntax).trim()}) ${written.kind === 'list' ? 'holds' : 'is'} the JSON value null, which the contract cannot tell apart from SQL NULL. Remove the @default or give it another JSON value; either changes the column default on Prisma 7's next migration.`,
      input.sourceId,
      input.attribute.span,
    ),
  );
  return undefined;
}

/** A `@default(...)` this contract source cannot read as a literal at all. */
function unreadableValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  unknown: (reason: string, span: PslSpan) => undefined,
): undefined {
  const span = input.attribute.span;
  const identifier = IdentifierAst.cast(expression.syntax)?.name();
  if (identifier !== undefined) {
    return unknown(
      input.enumMembers === undefined
        ? `refers to "${identifier}", but the field is not an enum.`
        : `refers to "${identifier}", which is not a member of the field's enum.`,
      span,
    );
  }
  if (ArrayLiteralAst.cast(expression.syntax) !== undefined) {
    return unknown('lists may only hold literals or enum members.', span);
  }
  return unknown('holds a value this contract source does not read.', span);
}

function sqlExpressionDefault(
  expression: ExpressionAst,
  form: Extract<Prisma7LiteralDefaultForm, { readonly kind: 'sqlExpression' }>,
  isList: boolean,
): { readonly expression: string } | 'unreadable' | undefined {
  const array = isList ? ArrayLiteralAst.cast(expression.syntax) : undefined;
  if (array === undefined) {
    const text = StringLiteralExprAst.cast(expression.syntax)?.value();
    if (text === undefined) return undefined;
    const literal = form.literal(text);
    return literal === undefined ? 'unreadable' : { expression: literal };
  }
  const literals: string[] = [];
  for (const element of array.elements()) {
    const text = StringLiteralExprAst.cast(element.syntax)?.value();
    const literal = text === undefined ? undefined : form.literal(text);
    if (literal === undefined) return 'unreadable';
    literals.push(literal);
  }
  return { expression: form.list(literals) };
}

/** The written literal a Prisma 7 expression is, or `undefined` when it is not a literal at all. */
function writtenLiteral(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): WrittenValue | undefined {
  const text = StringLiteralExprAst.cast(expression.syntax)?.value();
  if (text !== undefined) {
    return input.literalForm?.kind === 'json'
      ? { kind: 'tag', tag: 'json', body: text }
      : { kind: 'string', text };
  }
  const number = NumberLiteralExprAst.cast(expression.syntax)?.token()?.text;
  if (number !== undefined) return { kind: 'number', text: number };
  const boolean = BooleanLiteralExprAst.cast(expression.syntax)?.value();
  return boolean === undefined ? undefined : { kind: 'boolean', value: boolean };
}

/**
 * The document a written JSON value holds, read through the same entry the interpreter uses, or
 * `undefined` when the body is not a document.
 */
function jsonDocumentOf(
  written: WrittenValue,
  input: LowerPrisma7DefaultInput,
): JsonValue | undefined {
  const entry = entryForTag(input.dataTypeSupport, 'json');
  if (entry === undefined || entry.entry.written.kind !== 'tag') return undefined;
  const bodies =
    written.kind === 'list'
      ? written.elements.flatMap((element) => (element.kind === 'tag' ? [element.body] : []))
      : written.kind === 'tag'
        ? [written.body]
        : [];
  const parse = entry.entry.written.parse;
  try {
    const documents = bodies.map((body) => parse(body));
    return written.kind === 'list' ? documents : documents[0];
  } catch {
    return undefined;
  }
}

/** Why the column refused the value, as a phrase following `@default `. */
function refusalReason(refusal: DefaultRefusal): string {
  const at = refusal.elementIndex === undefined ? '' : ` at element ${refusal.elementIndex + 1}`;
  switch (refusal.kind) {
    case 'unreadable':
      return `holds text${at} that this contract source does not read: ${refusal.message}`;
    case 'unknown-tag':
      return `holds a ${refusal.tag} literal${at}, which this stack does not register.`;
    case 'unwritable':
      return `holds a ${refusal.syntax} value${at}, which this target has no data type for.`;
    case 'not-a-list':
      return 'holds a single value on a list column, which takes a list literal.';
    case 'no-cast':
      return `holds a ${refusal.valueType} value${at}, which ${refusal.columnType} has no cast from; ${refusal.casts.length === 0 ? 'it casts from nothing' : `it casts from ${refusal.casts.join(', ')}`}.`;
    case 'undecodable':
      return `holds a value${at} that ${refusal.codecId} does not read: ${refusal.message}`;
  }
}

function lowerFunction(
  call: FunctionCallAst,
  input: LowerPrisma7DefaultInput,
  label: string,
  unknown: (reason: string, span: PslSpan) => undefined,
): LoweredPrisma7Default | undefined {
  const fn = call.path().join('.');
  const span = input.attribute.span;
  const callArgs = [...call.args()];
  if (fn === 'dbgenerated') {
    return dbgeneratedDefault(callArgs, unknown, span);
  }
  const keys = FUNCTION_ARGUMENT_KEYS[fn];
  const entry = input.controlMutationDefaults.defaultFunctionRegistry.get(fn);
  if (keys === undefined || entry === undefined) {
    return unknown(
      `function "${fn}()" is not a Prisma 7 default function this target supports.`,
      span,
    );
  }
  const args: Record<string, unknown> = {};
  let index = 0;
  for (const arg of callArgs) {
    const key = arg.name()?.name() ?? keys[index];
    const value = arg.value();
    const literal = value === undefined ? undefined : literalArgument(value);
    if (key === undefined || literal === undefined) {
      return unknown(
        `function "${fn}()" has an argument this contract source does not read.`,
        span,
      );
    }
    args[key] = literal;
    index += 1;
  }
  // Prisma 7's cuid() (version 1) has no Prisma 8 generator; the slice maps it to cuid2.
  if (fn === 'cuid') args['version'] = 2;
  const lowered = entry.lower({
    call: { fn, span, args },
    context: {
      sourceId: input.sourceId,
      modelName: input.modelName,
      fieldName: input.field.name,
      columnCodecId: input.codecId,
    },
  });
  if (!lowered.ok) {
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_DEFAULT',
        `${label}: ${lowered.diagnostic.message}`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
  }
  return lowered.value.kind === 'storage'
    ? { storage: lowered.value.defaultValue, onCreate: undefined }
    : { storage: undefined, onCreate: lowered.value.generated };
}

/**
 * Prisma 7's `dbgenerated("<sql>")` is a raw SQL default, carried as written; the empty form
 * `dbgenerated()` means the column has no default. Prisma 7 refuses a blank string, so this
 * source does too.
 */
function dbgeneratedDefault(
  callArgs: readonly AttributeArgAst[],
  unknown: (reason: string, span: PslSpan) => undefined,
  span: PslSpan,
): LoweredPrisma7Default | undefined {
  if (callArgs.length === 0) return { storage: undefined, onCreate: undefined };
  const [argument] = callArgs;
  const value = argument?.value();
  const expression =
    callArgs.length === 1 && argument?.name() === undefined && value !== undefined
      ? StringLiteralExprAst.cast(value.syntax)?.value()
      : undefined;
  if (expression === undefined || expression.trim() === '') {
    return unknown(
      'function "dbgenerated()" has an argument this contract source does not read.',
      span,
    );
  }
  return { storage: { kind: 'function', expression }, onCreate: undefined };
}
