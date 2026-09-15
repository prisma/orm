import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultValue,
  JsonValue,
} from '@internal/contract/types';
import type { Codec } from '@internal/framework-components/codec';
import type { ControlMutationDefaults } from '@internal/framework-components/control';
import type { FieldSymbol, PslSpan, ResolvedAttribute } from '@internal/psl-parser';
import type { ExpressionAst } from '@internal/psl-parser/syntax';
import {
  ArrayLiteralAst,
  BooleanLiteralExprAst,
  FunctionCallAst,
  IdentifierAst,
  NumberLiteralExprAst,
  printSyntax,
  StringLiteralExprAst,
} from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { prisma7Diagnostic } from './diagnostics';
import type { Prisma7LiteralDefaultForm } from './target-binding';

export interface LoweredPrisma7Default {
  readonly storage: ColumnDefault | undefined;
  readonly onCreate: ExecutionMutationDefaultValue | undefined;
}

export interface LowerPrisma7DefaultInput {
  readonly attribute: ResolvedAttribute;
  readonly field: FieldSymbol;
  readonly modelName: string;
  readonly codecId: string;
  /** The column's codec, which decides how a number literal is carried. */
  readonly codec: Codec | undefined;
  readonly literalForm: Prisma7LiteralDefaultForm | undefined;
  /** Storage value per member name when the field is typed by a Prisma 7 enum. */
  readonly enumMembers: ReadonlyMap<string, string> | undefined;
  readonly controlMutationDefaults: ControlMutationDefaults;
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
  dbgenerated: ['expression'],
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
      prisma7Diagnostic('PRISMA7_UNKNOWN_DEFAULT', `${label}: @default ${reason}`, sourceId, span),
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
  return { storage: { kind: 'literal', value: scalar }, onCreate: undefined };
}

function scalarValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
  unknown: (reason: string, span: PslSpan) => undefined,
): ColumnDefaultLiteralInputValue | undefined {
  const span = input.attribute.span;
  const isJson = input.literalForm?.kind === 'json';
  const jsonNull = (holds: string): undefined => {
    input.diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED',
        `Field "${input.modelName}.${input.field.name}": @default(${printSyntax(expression.syntax).trim()}) ${holds} the JSON value null, which the contract cannot tell apart from SQL NULL. Remove the @default or give it another JSON value; either changes the column default on Prisma 7's next migration.`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
  };
  const array = ArrayLiteralAst.cast(expression.syntax);
  if (array !== undefined) {
    const values: ColumnDefaultLiteralInputValue[] = [];
    for (const element of array.elements()) {
      const value = elementValue(element, input);
      if (value === undefined) {
        return unknown(
          rejectedNumberReason(element, input) ?? 'lists may only hold literals or enum members.',
          span,
        );
      }
      values.push(value);
    }
    if (isJson && values.includes(null)) return jsonNull('holds');
    return blindListValue(values);
  }
  const value = elementValue(expression, input);
  if (isJson && value === null) return jsonNull('is');
  if (value !== undefined) return value;
  const numberReason = rejectedNumberReason(expression, input);
  if (numberReason !== undefined) return unknown(numberReason, span);
  const identifier = IdentifierAst.cast(expression.syntax)?.name();
  if (identifier !== undefined) {
    return unknown(
      input.enumMembers === undefined
        ? `refers to "${identifier}", but the field is not an enum.`
        : `refers to "${identifier}", which is not a member of the field's enum.`,
      span,
    );
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

function blindListValue(
  values: readonly ColumnDefaultLiteralInputValue[],
): ColumnDefaultLiteralInputValue {
  return blindCast<
    ColumnDefaultLiteralInputValue,
    'a list of literal default values is itself a literal default value'
  >(values);
}

function tryDecodeJson(codec: Codec, json: JsonValue): { readonly value: unknown } | undefined {
  try {
    return { value: codec.decodeJson(json) };
  } catch {
    return undefined;
  }
}

/**
 * A number literal is carried as the value its column codec reads. A codec that
 * reads a JSON number gets the number. A codec that reads only text, because a
 * JS number would round the digits, gets what it decodes from the literal
 * exactly as written.
 */
function numberDefault(
  text: string,
  codec: Codec | undefined,
): { readonly value: ColumnDefaultLiteralInputValue } | undefined {
  const number = Number(text);
  if (codec === undefined || tryDecodeJson(codec, number) !== undefined) return { value: number };
  const fromText = tryDecodeJson(codec, text);
  return fromText === undefined
    ? undefined
    : {
        value: blindCast<
          ColumnDefaultLiteralInputValue,
          'the contract build passes a literal default to the codec encodeJson, which takes the value the codec decodes'
        >(fromText.value),
      };
}

/** The number literal the column codec reads neither as a number nor as text, such as `1.5` for a `BigInt`, which Prisma 7 rejects too. */
function rejectedNumberReason(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): string | undefined {
  const text = NumberLiteralExprAst.cast(expression.syntax)?.token()?.text;
  if (text === undefined || numberDefault(text, input.codec) !== undefined) return undefined;
  return `holds ${text}, which is not a valid ${input.field.typeName} value.`;
}

function elementValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): ColumnDefaultLiteralInputValue | undefined {
  const member = IdentifierAst.cast(expression.syntax)?.name();
  if (member !== undefined) return input.enumMembers?.get(member);
  const number = NumberLiteralExprAst.cast(expression.syntax)?.token()?.text;
  if (number !== undefined) return numberDefault(number, input.codec)?.value;
  const text = StringLiteralExprAst.cast(expression.syntax)?.value();
  if (text !== undefined) {
    if (input.literalForm?.kind === 'json') {
      try {
        return blindCast<ColumnDefaultLiteralInputValue, 'JSON.parse yields a JSON value'>(
          JSON.parse(text),
        );
      } catch {
        return undefined;
      }
    }
    return text;
  }
  return BooleanLiteralExprAst.cast(expression.syntax)?.value();
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
  if (fn === 'dbgenerated' && callArgs.length === 0) {
    if (input.field.optional || input.field.list) {
      return { storage: undefined, onCreate: undefined };
    }
    input.diagnostics.push(
      prisma7Diagnostic(
        'PRISMA7_UNKNOWN_DEFAULT',
        `${label}: @default(dbgenerated()) with no expression is not supported yet on a required field, because without a column default Prisma 8 requires the value on create. Either remove the @default, which makes Prisma 7's next migration drop the column default (ALTER COLUMN ... DROP DEFAULT) and both clients require the value on create, or write the column's database default as @default(dbgenerated("<expression>")), which Prisma 7's next migration sets on the column.`,
        input.sourceId,
        span,
      ),
    );
    return undefined;
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
        'PRISMA7_UNKNOWN_DEFAULT',
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
