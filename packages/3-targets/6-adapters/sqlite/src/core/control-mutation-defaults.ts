import type { ExecutionMutationDefaultValue } from '@internal/contract/types';
import {
  sqlDefaultLiteralTagEntry,
  timestampNowControlDescriptor,
} from '@internal/family-sql/control';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type {
  ControlDefaultLiteralTagEntry,
  ControlMutationDefaultEntry,
  DefaultFunctionLoweringContext,
  LoweredDefaultResult,
  MutationDefaultGeneratorDescriptor,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import { builtinGeneratorRegistryMetadata } from '@internal/ids';
import type { FuncCallSig } from '@internal/psl-parser';
import { int, num, oneOf, optional, str } from '@internal/psl-parser';
import {
  SQLITE_BIGINT_CODEC_ID,
  SQLITE_BLOB_CODEC_ID,
  SQLITE_DATETIME_CODEC_ID,
  SQLITE_INTEGER_CODEC_ID,
  SQLITE_JSON_CODEC_ID,
  SQLITE_REAL_CODEC_ID,
  SQLITE_TEXT_CODEC_ID,
} from '@internal/target-sqlite/codec-ids';

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: TypedDefaultFunctionCall['span'];
  readonly message: string;
}): LoweredDefaultResult {
  return {
    ok: false,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(
  id: ExecutionMutationDefaultValue['id'],
  params?: Record<string, unknown>,
): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

/**
 * SQLite spellings that all denote the same wall-clock-now value. Anything
 * matching this set when passed through `dbgenerated("...")` is rewritten
 * to the canonical `now()` form before entering the contract — symmetric
 * with `parseSqliteDefault` on the introspection side, so the verifier
 * compares canonical-vs-canonical and a contract using
 * `dbgenerated("CURRENT_TIMESTAMP")` doesn't drift against the schema it
 * just produced.
 */
const NOW_SYNONYMS = new Set(['current_timestamp', "datetime('now')", 'datetime("now")', 'now()']);

function lowerAutoincrement(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'autoincrement()' },
    },
  };
}

function lowerNow(): LoweredDefaultResult {
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression: 'now()' },
    },
  };
}

function lowerUlid(): LoweredDefaultResult {
  return executionGenerator('ulid');
}

function lowerUuid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  return input.call.args['version'] === 7
    ? executionGenerator('uuidv7')
    : executionGenerator('uuidv4');
}

function lowerCuid(): LoweredDefaultResult {
  return executionGenerator('cuid2');
}

function lowerNanoid(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const size = input.call.args['size'];
  return typeof size === 'number'
    ? executionGenerator('nanoid', { size })
    : executionGenerator('nanoid');
}

function lowerDbgenerated(input: {
  readonly call: TypedDefaultFunctionCall;
  readonly context: DefaultFunctionLoweringContext;
}): LoweredDefaultResult {
  const raw = input.call.args['expression'];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return invalidArgumentDiagnostic({
      context: input.context,
      span: input.call.span,
      message: 'Default function "dbgenerated" argument cannot be empty.',
    });
  }
  const trimmed = raw.trim();
  const expression = NOW_SYNONYMS.has(trimmed.toLowerCase()) ? 'now()' : trimmed;
  return {
    ok: true,
    value: {
      kind: 'storage',
      defaultValue: { kind: 'function', expression },
    },
  };
}

const nowSig: FuncCallSig = {
  documentation: 'Uses the current database timestamp as the default value.',
};
const autoincrementSig: FuncCallSig = {
  documentation: 'Generates an increasing integer value in the database.',
};
const ulidSig: FuncCallSig = { documentation: 'Generates a ULID when a value is not supplied.' };
const uuidSig: FuncCallSig = {
  documentation: 'Generates a UUID when a value is not supplied.',
  positional: [
    {
      key: 'version',
      type: optional(oneOf(num(4), num(7))),
      documentation: 'The UUID version: `4` or `7`. Defaults to `4`.',
    },
  ],
};
const cuidSig: FuncCallSig = {
  documentation: 'Generates a CUID2 identifier when a value is not supplied.',
  positional: [
    { key: 'version', type: num(2), documentation: 'The CUID version. Only `2` is supported.' },
  ],
};
const nanoidSig: FuncCallSig = {
  documentation: 'Generates a Nano ID when a value is not supplied.',
  positional: [
    {
      key: 'size',
      type: optional(int({ min: 2, max: 255 })),
      documentation:
        'The identifier length, from `2` through `255`. Omit to use the generator default.',
    },
  ],
};
const dbgeneratedSig: FuncCallSig = {
  documentation: 'Uses a database SQL expression as the default value.',
  positional: [
    {
      key: 'expression',
      type: str(),
      documentation: 'The nonempty SQL expression evaluated by the database.',
    },
  ],
};

const sqliteDefaultFunctionRegistryEntries = [
  [
    'autoincrement',
    {
      signature: autoincrementSig,
      lower: lowerAutoincrement,
      usageSignatures: ['autoincrement()'],
    },
  ],
  ['now', { signature: nowSig, lower: lowerNow, usageSignatures: ['now()'] }],
  [
    'uuid',
    { signature: uuidSig, lower: lowerUuid, usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'] },
  ],
  ['cuid', { signature: cuidSig, lower: lowerCuid, usageSignatures: ['cuid(2)'] }],
  ['ulid', { signature: ulidSig, lower: lowerUlid, usageSignatures: ['ulid()'] }],
  [
    'nanoid',
    { signature: nanoidSig, lower: lowerNanoid, usageSignatures: ['nanoid()', 'nanoid(<2-255>)'] },
  ],
  [
    'dbgenerated',
    { signature: dbgeneratedSig, lower: lowerDbgenerated, usageSignatures: ['dbgenerated("...")'] },
  ],
] satisfies ReadonlyArray<readonly [string, ControlMutationDefaultEntry]>;

/**
 * The base PSL scalars as zero-arg type constructors in the unified authoring
 * channel, with explicit `nativeType` values pinned to the codec manifests
 * (`codecLookup.targetTypesFor(codecId)[0]`).
 *
 * The type position is the only storage decider: a mutation-default generator
 * (`@default(uuid())`) never re-picks a column's storage.
 */
export const sqliteScalarAuthoringTypes = {
  String: {
    kind: 'typeConstructor',
    documentation: 'Variable-length text stored as SQLite text.',
    output: { codecId: SQLITE_TEXT_CODEC_ID, nativeType: 'text' },
  },
  Int: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript number.',
    output: { codecId: SQLITE_INTEGER_CODEC_ID, nativeType: 'integer' },
  },
  BigInt: {
    kind: 'typeConstructor',
    documentation: 'An integer stored as SQLite integer and represented as a JavaScript bigint.',
    output: { codecId: SQLITE_BIGINT_CODEC_ID, nativeType: 'integer' },
  },
  Float: {
    kind: 'typeConstructor',
    documentation: 'A floating-point number stored as SQLite real.',
    output: { codecId: SQLITE_REAL_CODEC_ID, nativeType: 'real' },
  },
  Decimal: {
    kind: 'typeConstructor',
    documentation: 'A decimal value stored and represented as text to preserve precision.',
    output: { codecId: SQLITE_TEXT_CODEC_ID, nativeType: 'text' },
  },
  DateTime: {
    kind: 'typeConstructor',
    documentation: 'A date and time stored as SQLite text.',
    output: { codecId: SQLITE_DATETIME_CODEC_ID, nativeType: 'text' },
  },
  Json: {
    kind: 'typeConstructor',
    documentation: 'A JSON value serialized to SQLite text.',
    output: { codecId: SQLITE_JSON_CODEC_ID, nativeType: 'text' },
  },
  Bytes: {
    kind: 'typeConstructor',
    documentation: 'Binary data stored as a SQLite blob.',
    output: { codecId: SQLITE_BLOB_CODEC_ID, nativeType: 'blob' },
  },
} as const satisfies AuthoringTypeNamespace;

export function createSqliteDefaultFunctionRegistry(): ReadonlyMap<
  string,
  ControlMutationDefaultEntry
> {
  return new Map(sqliteDefaultFunctionRegistryEntries);
}

export function createSqliteDefaultLiteralTagRegistry(): ReadonlyMap<
  string,
  ControlDefaultLiteralTagEntry
> {
  return new Map([
    ['sql', sqlDefaultLiteralTagEntry('sql`...`')],
    ['sqlite.sql', sqlDefaultLiteralTagEntry('sqlite.sql`...`')],
  ]);
}

export function createSqliteMutationDefaultGeneratorDescriptors(): readonly MutationDefaultGeneratorDescriptor[] {
  return [
    ...builtinGeneratorRegistryMetadata.map(
      ({ id, applicableCodecIds }): MutationDefaultGeneratorDescriptor => ({
        id,
        applicableCodecIds,
      }),
    ),
    timestampNowControlDescriptor(),
  ];
}
