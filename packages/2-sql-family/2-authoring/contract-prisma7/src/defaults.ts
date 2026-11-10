import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ExecutionMutationDefaultValue, JsonValue } from '@internal/contract/types';
import {
  type DataTypeSupport,
  entryForTag,
  type WrittenValue,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type { ControlMutationDefaults } from '@internal/framework-components/control';
import { CUID_VERSION } from '@internal/ids';
import {
  type ArgType,
  type AttributeCtx,
  type FieldSymbol,
  generatorFunctionCall,
  mapPslDiagnostics,
  type PslSpan,
  type ResolvedAttribute,
  type TypedFuncCall,
} from '@internal/psl-parser';
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
import { sqlCodecColumnLength } from '@internal/sql-contract/data-type';
import { defaultFunctionCall } from '@internal/sql-contract-psl/attribute-specs';
import { type DefaultRefusal, readDataTypeDefault } from '@internal/sql-contract-psl/resolution';
import type {
  AuthoredColumnDefault,
  AuthoredColumnDefaultLiteralValue,
} from '@internal/sql-contract-ts/contract-builder';
import { InternalError } from '@internal/utils/internal-error';
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
  /** Prisma 7 accepts only a `dbgenerated(...)` default here, as on an `Unsupported(...)` field. */
  readonly onlyDbgenerated: boolean;
  readonly codecId: string;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  /** The name after `@db.` of the field's native type attribute, if it has one. */
  readonly nativeTypeName: string | undefined;
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly literalForm: Prisma7LiteralDefaultForm | undefined;
  /** The SQL expression of a default whose value the column's codec cannot hold exactly; see `Prisma7TargetBinding.literalDefaultExpression`. */
  readonly literalDefaultExpression: (stored: JsonValue) => string;
  /** Storage value per member name when the field is typed by a Prisma 7 enum. */
  readonly enumMembers: ReadonlyMap<string, string> | undefined;
  readonly controlMutationDefaults: ControlMutationDefaults;
  /** The context a default function's arguments are parsed in. */
  readonly argumentContext: () => AttributeCtx;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  /** The stack's data types and the PSL support for them, which this reader maps its syntax onto. */
  readonly dataTypes: DataTypeSupport;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}

/** The default functions of Prisma 7's schema language. */
const PRISMA7_DEFAULT_FUNCTIONS: ReadonlySet<string> = new Set([
  'autoincrement',
  'now',
  'uuid',
  'cuid',
  'nanoid',
  'ulid',
]);

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
  if (input.onlyDbgenerated && call?.path().join('.') !== 'dbgenerated') {
    return unknown(
      'on a field of type Unsupported(...) must be dbgenerated("..."). Prisma 7 refuses this schema too: "Only @default(dbgenerated("...")) can be used for Unsupported types." Write the default as @default(dbgenerated("<sql expression>")), or remove it.',
      attribute.span,
    );
  }
  if (call !== undefined) {
    return lowerFunction(call, expression, input, label, unknown);
  }

  const storage = scalarValue(expression, input, unknown);
  return storage === undefined ? undefined : { storage, onCreate: undefined };
}

/**
 * The stored default of a written value: an enum member resolves through the enum's members, and
 * every other value is read by the authoring entry for its syntax, cast into the column's data type
 * and validated by the column's codec — the same path the current schema language takes. A value
 * the column's type holds but its codec cannot hold exactly, such as a timestamp with digits below
 * a millisecond on a column read as a JavaScript `Date`, is kept as the SQL expression the target
 * writes for it.
 */
function scalarValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  unknown: (reason: string, span: PslSpan) => undefined,
): AuthoredColumnDefault | undefined {
  const literal = scalarLiteral(expression, input, unknown);
  if (literal === undefined || 'expression' in literal) return literal;
  return { kind: 'literal', value: literal.value, inStoredForm: true };
}

function scalarLiteral(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  unknown: (reason: string, span: PslSpan) => undefined,
):
  | { readonly value: AuthoredColumnDefaultLiteralValue }
  | { readonly kind: 'function'; readonly expression: string }
  | undefined {
  const span = input.attribute.span;
  const enumValue = enumMemberValue(expression, input);
  if (enumValue !== undefined) return { value: enumValue };

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
    return { value: values };
  }

  const finer = finerThanColumn(elements ?? [expression], elements !== undefined, input);
  if (finer !== undefined) return unknown(finer, span);

  const written = writtenLiteralFor(expression, elements, input);
  if (written === undefined) return unreadableValue(expression, input, unknown);

  const jsonNull = jsonNullDefault(written, expression, input);
  if (jsonNull !== undefined) return { value: jsonNull };

  const read = readDataTypeDefault({
    written,
    isList: input.field.list,
    column: { codecId: input.codecId, typeParams: input.typeParams },
    codecLookup: input.codecLookup,
    dataTypes: input.dataTypes,
    fieldPath: `${input.modelName}.${input.field.name}`,
  });
  if (read.ok) return { value: read.value };
  const { refusal } = read;
  if (refusal.kind === 'refused-by-codec') {
    return { kind: 'function', expression: input.literalDefaultExpression(refusal.stored) };
  }
  return unknown(refusalReason(refusal), span);
}

/**
 * Why a written date and time is refused when it has more fraction digits than the column holds:
 * Prisma 7 let the database round it, so the reason names the value the database stores.
 */
function finerThanColumn(
  values: readonly ExpressionAst[],
  isList: boolean,
  input: LowerPrisma7DefaultInput,
): string | undefined {
  const form = input.literalForm;
  if (form?.kind !== 'tag' || form.finerThanColumn === undefined) return undefined;
  for (const [index, value] of values.entries()) {
    const text = StringLiteralExprAst.cast(value.syntax)?.value();
    const finer = text === undefined ? undefined : form.finerThanColumn(text);
    if (text === undefined || finer === undefined) continue;
    const at = isList ? ` at element ${index + 1}` : '';
    const writtenDigits = /\.(\d+)/.exec(text)?.[1]?.length ?? 0;
    const held = finer.heldDigits === 0 ? 'none' : String(finer.heldDigits);
    return `holds "${text}"${at}, with ${writtenDigits} ${writtenDigits === 1 ? 'digit' : 'digits'} after the decimal point, but the column holds ${held}. PostgreSQL stores it as "${finer.stored}"; write that instead.`;
  }
  return undefined;
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

/** The written literal a Prisma 7 expression is, or `undefined` when it is not a literal at all. */
function writtenLiteral(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): WrittenValue | undefined {
  const text = StringLiteralExprAst.cast(expression.syntax)?.value();
  if (text !== undefined) {
    const form = input.literalForm;
    if (form?.kind === 'json') return { kind: 'tag', tag: 'json', text };
    if (form?.kind === 'tag') {
      const body = form.body(text);
      return body === undefined ? undefined : { kind: 'tag', tag: form.tag, text: body };
    }
    return { kind: 'string', text };
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
  const entry = entryForTag(input.dataTypes, 'json');
  if (entry === undefined || entry.entry.written.kind !== 'tag') return undefined;
  const bodies =
    written.kind === 'list'
      ? written.elements.flatMap((element) => (element.kind === 'tag' ? [element.text] : []))
      : written.kind === 'tag'
        ? [written.text]
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
      return `holds a ${refusal.valueType} value${at}, which ${refusal.receivingType} has no cast from; ${describeCasts(refusal.casts)}.`;
    case 'no-list-cast':
      return `holds a list, which ${refusal.receivingType} has no cast from; ${describeCasts(refusal.casts)}.`;
    case 'no-element-cast':
      return `holds a ${refusal.valueType} value${at}, which the list cast of ${refusal.receivingType} does not take; it takes ${refusal.elementTypes.join(', ')}.`;
    case 'refused-by-column':
    case 'refused-by-codec':
      return `holds a value${at} that ${refusal.codecId} does not read: ${refusal.message}`;
  }
}

function describeCasts(casts: readonly string[]): string {
  return casts.length === 0 ? 'it casts from nothing' : `it casts from ${casts.join(', ')}`;
}

function lowerFunction(
  call: FunctionCallAst,
  expression: ExpressionAst,
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
  const entry = input.controlMutationDefaults.defaultFunctionRegistry.get(fn);
  const generator =
    entry === undefined
      ? input.generatorFunctions.functionsFor(input.codecId).find(({ name }) => name === fn)
      : undefined;
  if (
    !PRISMA7_DEFAULT_FUNCTIONS.has(fn) ||
    (entry === undefined && !input.generatorFunctions.has(fn))
  ) {
    return unknown(
      `function "${fn}()" is not a Prisma 7 default function this target supports.`,
      span,
    );
  }
  if (input.field.list) {
    const written = `@default(${printSyntax(expression.syntax).trim()})`;
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_DEFAULT',
        `${label}: ${written} cannot fill a list field. Write a list literal, such as @default([]), or remove ${written}.`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
  }
  if (entry === undefined) {
    if (generator === undefined) {
      return unknown(`function "${fn}()" cannot fill a column of codec "${input.codecId}".`, span);
    }
    const args =
      fn === 'cuid' && callArgs.length === 0
        ? { version: CUID_VERSION }
        : boundArguments(
            generatorFunctionCall(fn, generator.signature, input.dataTypes),
            expression,
            input,
            label,
          );
    if (args === undefined) return undefined;
    const onCreate = resolveGenerator(fn, args, input, label, unknown);
    return onCreate === undefined ? undefined : { storage: undefined, onCreate };
  }
  const args = boundArguments(
    defaultFunctionCall(fn, entry, input.dataTypes),
    expression,
    input,
    label,
  );
  if (args === undefined) return undefined;
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
  const storage = lowered.value.defaultValue;
  if (fn !== 'now') return { storage, onCreate: undefined };
  if (!input.generatorFunctions.functionsFor(input.codecId).some(({ name }) => name === fn)) {
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_DEFAULT',
        `${label}: ${nowOnAColumnThatIsNotADateOrTime(input)}`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
  }
  const onCreate = resolveGenerator(fn, {}, input, label, unknown);
  return onCreate === undefined ? undefined : { storage, onCreate };
}

/** Why Prisma 7 refuses `@default(now())` on a field whose column is not a date or time. */
function nowOnAColumnThatIsNotADateOrTime(input: LowerPrisma7DefaultInput): string {
  if (input.field.typeName !== 'DateTime') {
    return `@default(now()) needs a DateTime field, but the field has type "${input.field.typeName}". Prisma 7 refuses this schema too. Remove @default(now()), or change the field's type to DateTime.`;
  }
  const nativeType = input.nativeTypeName;
  if (nativeType === undefined) {
    throw new InternalError(
      `The Prisma 7 target binding has no "now" generator for codec "${input.codecId}", which the DateTime scalar maps to.`,
    );
  }
  return `@default(now()) needs a date or time column, but "@db.${nativeType}" makes it a column that is not a date or time. Prisma 7 refuses this schema too: "Native type ${nativeType} is not compatible with declared field type DateTime". Remove @default(now()), or use a date or time native type such as @db.Timestamp.`;
}

/** The generator a client function resolves to for the field's column, or `undefined` after reporting why it cannot fill it. */
function resolveGenerator(
  fn: string,
  args: Readonly<Record<string, unknown>>,
  input: LowerPrisma7DefaultInput,
  label: string,
  unknown: (reason: string, span: PslSpan) => undefined,
): ExecutionMutationDefaultValue | undefined {
  const span = input.attribute.span;
  const resolution = input.generatorFunctions.resolve(
    { name: fn, args },
    {
      codecId: input.codecId,
      typeParams: input.typeParams,
      length: sqlCodecColumnLength(input.dataTypes, input.codecId, input.typeParams),
    },
  );
  if (resolution.ok) return resolution.generator;
  if (resolution.reason === 'refused') {
    const written =
      input.attribute.args.find((arg) => arg.kind === 'positional')?.value.trim() ?? `${fn}()`;
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_GENERATOR_REFUSED',
        `${label}: @default(${written}) cannot fill its column: ${resolution.message}`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
  }
  return unknown(`function "${fn}()" cannot fill a column of codec "${input.codecId}".`, span);
}

/**
 * The arguments of a call, bound and checked through its function's signature as Prisma 8 PSL binds them, or `undefined` after reporting each refusal at its argument.
 */
function boundArguments(
  arm: ArgType<TypedFuncCall, AttributeCtx>,
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  label: string,
): Readonly<Record<string, unknown>> | undefined {
  const ctx = input.argumentContext();
  const bound = arm.parse(expression, ctx);
  if (bound.ok) return bound.value.args;
  for (const diagnostic of mapPslDiagnostics(bound.failure, ctx.sources)) {
    input.diagnostics.push(
      prisma7Diagnostic(
        'PSL.PRISMA7_UNKNOWN_DEFAULT',
        `${label}: ${diagnostic.message}`,
        input.sourceId,
        diagnostic.span,
      ),
    );
  }
  return undefined;
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
