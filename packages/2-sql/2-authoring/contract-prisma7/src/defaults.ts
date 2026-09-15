import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
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
import { storedTemporalText, type TemporalNativeType } from './temporal-literals';

export interface LoweredPrisma7Default {
  readonly storage: ColumnDefault | undefined;
  readonly onCreate: ExecutionMutationDefaultValue | undefined;
}

export interface LowerPrisma7DefaultInput {
  readonly attribute: ResolvedAttribute;
  readonly field: FieldSymbol;
  readonly modelName: string;
  readonly nativeType: string;
  readonly typeParams: Readonly<Record<string, unknown>> | undefined;
  readonly codecId: string;
  /** Storage value per member name when the field is typed by a Prisma 7 enum. */
  readonly enumMembers: ReadonlyMap<string, string> | undefined;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}

type LiteralValue = string | number | boolean;

function base64ToHex(base64: string): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return undefined;
  return `\\x${Buffer.from(base64, 'base64').toString('hex')}`;
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

  const rawLiteral = rawSqlLiteral(expression, input);
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
  const isJson = input.nativeType === 'json' || input.nativeType === 'jsonb';
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
          nonIntegerBigintReason(element, input) ?? 'lists may only hold literals or enum members.',
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
  const bigintReason = nonIntegerBigintReason(expression, input);
  if (bigintReason !== undefined) return unknown(bigintReason, span);
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

const TEMPORAL_NATIVE_TYPES: ReadonlySet<string> = new Set<TemporalNativeType>([
  'timestamp',
  'timestamptz',
  'date',
  'time',
  'timetz',
]);

function isTemporalNativeType(nativeType: string): nativeType is TemporalNativeType {
  return TEMPORAL_NATIVE_TYPES.has(nativeType);
}

function rawSqlText(text: string, nativeType: 'bytea' | TemporalNativeType): string | undefined {
  const value = nativeType === 'bytea' ? base64ToHex(text) : storedTemporalText(text, nativeType);
  return value === undefined ? undefined : `'${value.replace(/'/g, "''")}'`;
}

/**
 * A `Bytes` or `DateTime` default is carried as the SQL literal of the default
 * Postgres stores (`'\x68656c6c6f'`, `'2024-01-02 03:04:05'`), and a list default
 * as an `ARRAY[...]` of those literals cast to the column type, rather than
 * through the column codec, whose JSON form (base64, a Temporal value) is not
 * what introspection reads back; verify parses both sides with the same parser.
 */
function rawSqlLiteral(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): { readonly expression: string } | 'unreadable' | undefined {
  const { nativeType } = input;
  if (nativeType !== 'bytea' && !isTemporalNativeType(nativeType)) return undefined;
  const array = input.field.list ? ArrayLiteralAst.cast(expression.syntax) : undefined;
  if (array === undefined) {
    const text = StringLiteralExprAst.cast(expression.syntax)?.value();
    if (text === undefined) return undefined;
    const literal = rawSqlText(text, nativeType);
    return literal === undefined ? 'unreadable' : { expression: literal };
  }
  const literals: string[] = [];
  for (const element of array.elements()) {
    const text = StringLiteralExprAst.cast(element.syntax)?.value();
    const literal = text === undefined ? undefined : rawSqlText(text, nativeType);
    if (literal === undefined) return 'unreadable';
    literals.push(literal);
  }
  const precision = input.typeParams?.['precision'];
  const typeName = `${nativeType.toUpperCase()}${typeof precision === 'number' ? `(${precision})` : ''}`;
  return { expression: `ARRAY[${literals.join(', ')}]::${typeName}[]` };
}

function blindListValue(
  values: readonly ColumnDefaultLiteralInputValue[],
): ColumnDefaultLiteralInputValue {
  return blindCast<
    ColumnDefaultLiteralInputValue,
    'a list of literal default values is itself a literal default value'
  >(values);
}

const INTEGER_TEXT = /^-?\d+$/;

/** The number token of an `int8` default that `BigInt()` would reject: Prisma 7 rejects it too ("is not a valid integer"). */
function nonIntegerBigintReason(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): string | undefined {
  if (input.nativeType !== 'int8') return undefined;
  const text = NumberLiteralExprAst.cast(expression.syntax)?.token()?.text;
  if (text === undefined || INTEGER_TEXT.test(text)) return undefined;
  return `holds ${text}, which is not an integer; a BigInt default must be a whole number.`;
}

function elementValue(
  expression: ExpressionAst,
  input: LowerPrisma7DefaultInput,
): ColumnDefaultLiteralInputValue | undefined {
  const member = IdentifierAst.cast(expression.syntax)?.name();
  if (member !== undefined) return input.enumMembers?.get(member);
  const number = NumberLiteralExprAst.cast(expression.syntax);
  if (number !== undefined) {
    // int8 goes through its codec as a bigint built from the source text: a JS
    // number would round past 2^53.
    if (input.nativeType === 'int8') {
      const text = number.token()?.text;
      return text === undefined || !INTEGER_TEXT.test(text)
        ? undefined
        : blindCast<ColumnDefaultLiteralInputValue, 'the int8 codec encodes a bigint to JSON'>(
            BigInt(text),
          );
    }
    return number.value();
  }
  const text = StringLiteralExprAst.cast(expression.syntax)?.value();
  if (text !== undefined) {
    if (input.nativeType === 'json' || input.nativeType === 'jsonb') {
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
