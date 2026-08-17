import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
import type { Contract, JsonValue } from '@internal/contract/types';
import {
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
} from '@internal/contract/types';
import {
  type AuthoringContributions,
  type AuthoringEntityContext,
  type AuthoringEntityTypeNamespace,
  type AuthoringFieldPresetDescriptor,
  type AuthoringPslBlockDescriptorNamespace,
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
  type PslExtensionBlock,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
  DefaultFunctionLoweringContext,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import type { FuncCallSig, SymbolTable } from '@internal/psl-parser';
import {
  buildSymbolTable,
  int,
  num,
  oneOf,
  optional,
  rangeToPslSpan,
  str,
} from '@internal/psl-parser';
import type { SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { type EnumTypeHandle, enumType } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';

function testEnumFactory(
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): EnumTypeHandle | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const resolved = resolveEnumCodecId(block, ctx);
  if (resolved === undefined) {
    return undefined;
  }
  const { codecId, codecSpan } = resolved;

  const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
  if (nativeType === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
      sourceId,
      span: codecSpan,
    });
    return undefined;
  }

  const codec = ctx.codecLookup?.get(codecId);
  if (codec === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type codec "${codecId}" resolves in targetTypesFor but is absent from codecLookup.get`,
      sourceId,
      span: codecSpan,
    });
    return undefined;
  }
  const members: { name: string; value: unknown }[] = [];
  let memberError = false;
  const seenValues = new Set<string>();

  for (const [memberName, paramValue] of Object.entries(block.parameters)) {
    let value: unknown;
    if (paramValue.kind === 'bare') {
      try {
        value = codec.decodeJson(memberName as unknown as JsonValue);
      } catch {
        diagnostics?.push({
          code: 'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
          message: `enum "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
    } else if (paramValue.kind === 'value') {
      let jsonValue: unknown;
      try {
        jsonValue = JSON.parse(paramValue.raw);
      } catch {
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
      try {
        value = codec.decodeJson(
          blindCast<JsonValue, 'JSON.parse returns JsonValue-compatible value'>(jsonValue),
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${reason}`,
          sourceId,
          span: paramValue.span,
        });
        memberError = true;
        continue;
      }
    } else {
      continue;
    }
    const valueKey = String(value);
    if (seenValues.has(valueKey)) {
      diagnostics?.push({
        code: 'PSL_ENUM_DUPLICATE_MEMBER_VALUE',
        message: `enum "${block.name}": duplicate member value "${valueKey}"`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    seenValues.add(valueKey);
    members.push({ name: memberName, value });
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: 'PSL_ENUM_MISSING_TYPE',
      message: `enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  return enumType(
    block.name,
    { codecId, nativeType },
    ...members.map((m) => ({ name: m.name, value: m.value })),
  );
}

export const testEnumEntityContributions = {
  enum: {
    kind: 'entity' as const,
    discriminator: 'enum',
    output: { factory: testEnumFactory },
  },
} as const satisfies AuthoringEntityTypeNamespace;

function invalidArgumentDiagnostic(input: {
  readonly context: DefaultFunctionLoweringContext;
  readonly span: TypedDefaultFunctionCall['span'];
  readonly message: string;
}) {
  return {
    ok: false as const,
    diagnostic: {
      code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
      message: input.message,
      sourceId: input.context.sourceId,
      span: input.span,
    },
  };
}

function executionGenerator(id: string, params?: Record<string, unknown>) {
  return {
    ok: true as const,
    value: {
      kind: 'execution' as const,
      generated: {
        kind: 'generator' as const,
        id,
        ...(params ? { params } : {}),
      },
    },
  };
}

export const postgresEnumInferenceCodecs = {
  text: 'pg/text@1',
  int: 'pg/int@1',
} as const;

export const sqliteEnumInferenceCodecs = {
  text: 'sqlite/text@1',
  int: 'sqlite/integer@1',
} as const;

/**
 * Stands in for the Postgres pack's `renderCheckExpressions`, reproducing the
 * predicate forms it emits. Check emission is hook-conditional, so a target
 * fixture without one emits no checks at all and every assertion about checks
 * would hold vacuously — the PSL/TS parity test in particular.
 */
export function testRenderCheckExpressions(input: {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly memberValues: readonly string[] | undefined;
}): ReadonlyArray<{
  readonly kind: 'membership' | 'elementNotNull';
  readonly columnName: string;
  readonly expression: string;
}> {
  const candidates: Array<{
    kind: 'membership' | 'elementNotNull';
    columnName: string;
    expression: string;
  }> = [];
  const column = `"${input.columnName}"`;
  if (input.memberValues !== undefined) {
    const members = input.memberValues.map((v) => `'${v}'`).join(', ');
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: input.many
        ? `${column}::text[] <@ ARRAY[${members}]::text[]`
        : `${column} IN (${members})`,
    });
  }
  if (input.many) {
    candidates.push({
      kind: 'elementNotNull',
      columnName: input.columnName,
      expression: `array_position(${column}, NULL) IS NULL`,
    });
  }
  return candidates;
}

export const postgresTarget: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

/**
 * `postgresTarget` plus the check-rendering hook. Kept separate because
 * rendering a membership check for an int-backed enum throws
 * `CONTRACT.ENUM_INVALID` (numeric enums are not supported), and several tests
 * here author int-backed enums deliberately.
 *
 * Not annotated `TargetPackRef`: `AuthoringContributions` deliberately does not
 * name the duck-typed hooks, so an annotated literal would reject the extra
 * key. The real `postgresTargetDescriptorMeta` is not annotated either.
 */
export const postgresTargetRenderingChecks = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { field: {}, renderCheckExpressions: testRenderCheckExpressions },
} as const;

export const sqliteTarget: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: '__unbound__',
};

export const pgvectorExtensionPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'pgvector',
  version: '1.2.3-test',
};

export const postgresBaseScalarAuthoringTypes: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'pg/bool@1', nativeType: 'bool' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  BigInt: { kind: 'typeConstructor', output: { codecId: 'pg/int8@1', nativeType: 'int8' } },
  Float: { kind: 'typeConstructor', output: { codecId: 'pg/float8@1', nativeType: 'float8' } },
  Decimal: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
  },
  DateTime: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1', nativeType: 'json' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } },
  Bytes: { kind: 'typeConstructor', output: { codecId: 'pg/bytea@1', nativeType: 'bytea' } },
};

export const postgresScalarTypeDescriptors = collectScalarTypeConstructors(
  postgresBaseScalarAuthoringTypes,
);

export const postgresScalarAuthoringTypes: AuthoringTypeNamespace = {
  ...postgresBaseScalarAuthoringTypes,
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'pg/inet@1', nativeType: 'inet' } },
  SmallInt: { kind: 'typeConstructor', output: { codecId: 'pg/int2@1', nativeType: 'int2' } },
  Real: { kind: 'typeConstructor', output: { codecId: 'pg/float4@1', nativeType: 'float4' } },
  Date: { kind: 'typeConstructor', output: { codecId: 'pg/date-temporal@1', nativeType: 'date' } },
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Char: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
    output: {
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'number', name: 'precision', integer: true, minimum: 1, optional: true },
      { kind: 'number', name: 'scale', integer: true, minimum: 0, optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  Timestamp: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timestamptz: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Time: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/time-temporal@1',
      nativeType: 'time',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timetz: {
    kind: 'typeConstructor',
    args: [{ kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true }],
    output: {
      codecId: 'pg/timetz@1',
      nativeType: 'timetz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
};

export const postgresNativeScalarTypeDescriptors = collectScalarTypeConstructors(
  postgresScalarAuthoringTypes,
);

/**
 * Controlled test-only descriptor — intentionally uses pg/vector@1 with maximum: 2000 rather than importing the real pgvector pack, so interpreter unit tests stay layer-isolated. Real-pack parity is covered by `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`.
 */
export const pgvectorAuthoringContributions = {
  entityTypes: {},
  field: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: {
    ...postgresScalarAuthoringTypes,
    pgvector: {
      Vector: {
        kind: 'typeConstructor',
        args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 2000 }],
        output: {
          codecId: 'pg/vector@1',
          nativeType: 'vector',
          typeParams: {
            length: { kind: 'arg', index: 0 },
          },
        },
      },
    },
  },
} satisfies AuthoringContributions;

export function buildSymbolTableInput(
  schema: string,
  options?: {
    readonly sourceId?: string;
    readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  },
): {
  symbolTable: SymbolTable;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  const sourceId = options?.sourceId ?? 'schema.prisma';
  const pslBlockDescriptors = options?.pslBlockDescriptors ?? {};
  const { document, sourceFile } = parse(schema);
  const { table, diagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors,
  });
  const seedDiagnostics: ContractSourceDiagnostic[] = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
  return {
    symbolTable: table,
    sourceFile,
    sourceId,
    seedDiagnostics,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
  };
}

export function symbolTableInputFromParseArgs(args: {
  readonly schema: string;
  readonly sourceId?: string;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
}): {
  symbolTable: SymbolTable;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  return buildSymbolTableInput(args.schema, {
    ...(args.sourceId !== undefined ? { sourceId: args.sourceId } : {}),
    ...(args.pslBlockDescriptors !== undefined
      ? { pslBlockDescriptors: args.pslBlockDescriptors }
      : {}),
  });
}

export const sqliteScalarAuthoringTypes: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'sqlite/text@1', nativeType: 'text' } },
  Boolean: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/integer@1', nativeType: 'integer' },
  },
  Int: { kind: 'typeConstructor', output: { codecId: 'sqlite/integer@1', nativeType: 'integer' } },
  BigInt: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
  },
  Float: { kind: 'typeConstructor', output: { codecId: 'sqlite/real@1', nativeType: 'real' } },
  Decimal: { kind: 'typeConstructor', output: { codecId: 'sqlite/text@1', nativeType: 'text' } },
  DateTime: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/datetime@1', nativeType: 'text' },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'sqlite/json@1', nativeType: 'text' } },
  Bytes: { kind: 'typeConstructor', output: { codecId: 'sqlite/blob@1', nativeType: 'blob' } },
};

export const sqliteScalarColumnDescriptors = collectScalarTypeConstructors(
  sqliteScalarAuthoringTypes,
);

const targetTypesByCodecId: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/int@1': ['int4'],
  'pg/bool@1': ['bool'],
  'pg/int4@1': ['int4'],
  'pg/int8@1': ['int8'],
  'pg/float8@1': ['float8'],
  'pg/numeric@1': ['numeric'],
  'pg/timestamptz-temporal@1': ['timestamptz'],
  'pg/jsonb@1': ['jsonb'],
  'pg/bytea@1': ['bytea'],
  'sql/char@1': ['character'],
  'sql/varchar@1': ['character varying'],
  'pg/int2@1': ['int2'],
  'pg/float4@1': ['float4'],
  'pg/timestamp-temporal@1': ['timestamp'],
  'pg/date-temporal@1': ['date'],
  'pg/time-temporal@1': ['time'],
  'pg/timetz@1': ['timetz'],
  'pg/json@1': ['json'],
  'pg/vector@1': ['vector'],
};

export const postgresCodecLookup: CodecLookup = {
  get: (id: string) => {
    if (!targetTypesByCodecId[id]) return undefined;
    return { id } as ReturnType<CodecLookup['get']>;
  },
  targetTypesFor: (id: string) => targetTypesByCodecId[id],
  renderOutputTypeFor: () => undefined,
};

export function createPostgresTestContext(
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      field: {},
      type: postgresScalarAuthoringTypes,
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      valueObjectStorageType: 'Jsonb',
    },
    codecLookup: postgresCodecLookup,
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    resolvedInputs: [],
    capabilities: { sql: { scalarList: true } },
    ...overrides,
  };
}

const nowSig: FuncCallSig = {};
const autoincrementSig: FuncCallSig = {};
const ulidSig: FuncCallSig = {};
const uuidSig: FuncCallSig = {
  positional: [{ key: 'version', type: optional(oneOf(num(4), num(7))) }],
};
const cuidSig: FuncCallSig = { positional: [{ key: 'version', type: num(2) }] };
const nanoidSig: FuncCallSig = {
  positional: [{ key: 'size', type: optional(int({ min: 2, max: 255 })) }],
};
const dbgeneratedSig: FuncCallSig = { positional: [{ key: 'expression', type: str() }] };

export function createBuiltinLikeControlMutationDefaults(): ControlMutationDefaults {
  return {
    defaultFunctionRegistry: new Map<string, ControlMutationDefaultEntry>([
      [
        'autoincrement',
        {
          signature: autoincrementSig,
          lower: () => ({
            ok: true as const,
            value: {
              kind: 'storage' as const,
              defaultValue: { kind: 'function' as const, expression: 'autoincrement()' },
            },
          }),
          usageSignatures: ['autoincrement()'],
        },
      ],
      [
        'now',
        {
          signature: nowSig,
          lower: () => ({
            ok: true as const,
            value: {
              kind: 'storage' as const,
              defaultValue: { kind: 'function' as const, expression: 'now()' },
            },
          }),
          usageSignatures: ['now()'],
        },
      ],
      [
        'uuid',
        {
          signature: uuidSig,
          lower: ({ call }) =>
            call.args['version'] === 7
              ? executionGenerator('uuidv7')
              : executionGenerator('uuidv4'),
          usageSignatures: ['uuid()', 'uuid(4)', 'uuid(7)'],
        },
      ],
      [
        'cuid',
        {
          signature: cuidSig,
          lower: () => executionGenerator('cuid2'),
          usageSignatures: ['cuid(2)'],
        },
      ],
      [
        'ulid',
        {
          signature: ulidSig,
          lower: () => executionGenerator('ulid'),
          usageSignatures: ['ulid()'],
        },
      ],
      [
        'nanoid',
        {
          signature: nanoidSig,
          lower: ({ call }) => {
            const size = call.args['size'];
            return typeof size === 'number'
              ? executionGenerator('nanoid', { size })
              : executionGenerator('nanoid');
          },
          usageSignatures: ['nanoid()', 'nanoid(<2-255>)'],
        },
      ],
      [
        'dbgenerated',
        {
          signature: dbgeneratedSig,
          lower: ({ call, context }) => {
            const expression = call.args['expression'];
            if (typeof expression !== 'string' || expression.trim().length === 0) {
              return invalidArgumentDiagnostic({
                context,
                span: call.span,
                message: 'Default function "dbgenerated" argument cannot be empty.',
              });
            }
            return {
              ok: true as const,
              value: {
                kind: 'storage' as const,
                defaultValue: { kind: 'function' as const, expression },
              },
            };
          },
          usageSignatures: ['dbgenerated("...")'],
        },
      ],
    ]),
    generatorDescriptors: [
      {
        id: 'uuidv4',
        applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
      },
      {
        id: 'uuidv7',
        applicableCodecIds: ['pg/text@1', 'sql/char@1', 'pg/uuid@1'],
      },
      {
        id: 'cuid2',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
      },
      {
        id: 'ulid',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
      },
      {
        id: 'nanoid',
        applicableCodecIds: ['pg/text@1', 'sql/char@1'],
      },
      {
        id: 'timestampNow',
        applicableCodecIds: [
          'pg/timestamp-temporal@1',
          'pg/timestamptz-temporal@1',
          'sqlite/datetime@1',
        ],
        buildPhases: () => ({
          onCreate: { kind: 'generator', id: 'timestampNow' },
          onUpdate: { kind: 'generator', id: 'timestampNow' },
        }),
      },
    ],
  };
}

export function modelsOf(contract: Contract) {
  return domainModelsAtDefaultNamespace(contract.domain);
}

export function valueObjectsOf(contract: Contract) {
  return domainValueObjectsAtDefaultNamespace(contract.domain);
}

export function documentScopedTypes(contract: { readonly storage?: unknown }) {
  return (contract.storage as { readonly types?: Record<string, unknown> } | undefined)?.types;
}

/**
 * Returns a `createNamespace` factory that captures enum types keyed by namespace id,
 * plus the accumulated map. Useful for asserting on postgres enum routing without
 * depending on the postgres target pack's concrete namespace class.
 */
export function buildEnumCapturingFactory(): {
  createNamespace: (
    input: SqlNamespaceInput,
    enumTypes?: Readonly<Record<string, unknown>>,
  ) => SqlNamespaceBase;
  capturedEnumTypes: Record<string, Record<string, unknown>>;
} {
  const capturedEnumTypes: Record<string, Record<string, unknown>> = {};
  const createNamespace = (
    input: SqlNamespaceInput,
    enumTypes?: Readonly<Record<string, unknown>>,
  ): SqlNamespaceBase => {
    if (enumTypes && Object.keys(enumTypes).length > 0) {
      capturedEnumTypes[input.id] = { ...(capturedEnumTypes[input.id] ?? {}), ...enumTypes };
    }
    return createTestSqlNamespace(input);
  };
  return { createNamespace, capturedEnumTypes };
}

/**
 * Hand-written mirrors of family-sql's temporal authoring factories —
 * `temporalCodecPresetWithPrecision` / `temporalCodecPreset` below, and
 * `temporalAuthoringPresets` (the `createdAt`/`updatedAt` convenience pair)
 * further down.
 *
 * They are hand-written because this package cannot import family-sql:
 * family-sql declares `@internal/sql-contract-psl` as a devDependency, so
 * the reverse import would be a cycle.
 *
 * They are kept honest by `family-sql/test/temporal-codec-presets.test.ts`,
 * which imports each mirror below and asserts it deep-equals the factory
 * output. That assertion — not the target-pack registration tests, whose two
 * sides both derive from the factory — is what fails if a factory change
 * leaves these stale.
 */
const TEMPORAL_MIRROR_PRECISION_ARG = {
  name: 'precision',
  kind: 'number',
  optional: true,
  integer: true,
  minimum: 0,
} as const;
const TEMPORAL_MIRROR_ON_CREATE_ARG = {
  name: 'onCreate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;
const TEMPORAL_MIRROR_ON_UPDATE_ARG = {
  name: 'onUpdate',
  kind: 'option',
  values: ['now'],
  optional: true,
} as const;
const TEMPORAL_MIRROR_NOW_PHASE = { kind: 'generator', id: 'timestampNow' } as const;

export const temporalCodecPresetMirrors = {
  pgTimestamp: {
    kind: 'fieldPreset',
    args: [
      TEMPORAL_MIRROR_PRECISION_ARG,
      TEMPORAL_MIRROR_ON_CREATE_ARG,
      TEMPORAL_MIRROR_ON_UPDATE_ARG,
    ],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: { kind: 'select', index: 1, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
        onUpdate: { kind: 'select', index: 2, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
      },
    },
  },
  pgTimestamptz: {
    kind: 'fieldPreset',
    args: [
      TEMPORAL_MIRROR_PRECISION_ARG,
      TEMPORAL_MIRROR_ON_CREATE_ARG,
      TEMPORAL_MIRROR_ON_UPDATE_ARG,
    ],
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: { precision: { kind: 'arg', index: 0 } },
      executionDefaults: {
        onCreate: { kind: 'select', index: 1, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
        onUpdate: { kind: 'select', index: 2, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
      },
    },
  },
  sqliteDatetime: {
    kind: 'fieldPreset',
    args: [TEMPORAL_MIRROR_ON_CREATE_ARG, TEMPORAL_MIRROR_ON_UPDATE_ARG],
    output: {
      codecId: 'sqlite/datetime@1',
      nativeType: 'text',
      executionDefaults: {
        onCreate: { kind: 'select', index: 0, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
        onUpdate: { kind: 'select', index: 1, cases: { now: TEMPORAL_MIRROR_NOW_PHASE } },
      },
    },
  },
} as const satisfies Record<string, AuthoringFieldPresetDescriptor>;

/**
 * Mirrors of `temporalAuthoringPresets(...)` — the `createdAt`/`updatedAt`
 * convenience pair — per target codec. Anchored by the same family-sql test as
 * {@link temporalCodecPresetMirrors}.
 *
 * The slice's headline guarantee (`temporal.updatedAt()` is byte-identical to
 * `temporal.timestamptz(onCreate: now, onUpdate: now)`) is asserted through
 * these, so an unanchored mirror here would let the parity tests prove a
 * fiction of `updatedAt` identical to the real `timestamptz`.
 */
export const temporalConvenienceMirrors = {
  postgres: {
    createdAt: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
        default: { kind: 'function', expression: 'now()' },
      },
    },
    updatedAt: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/timestamptz-temporal@1',
        nativeType: 'timestamptz',
        executionDefaults: {
          onCreate: TEMPORAL_MIRROR_NOW_PHASE,
          onUpdate: TEMPORAL_MIRROR_NOW_PHASE,
        },
      },
    },
  },
  sqlite: {
    createdAt: {
      kind: 'fieldPreset',
      output: {
        codecId: 'sqlite/datetime@1',
        nativeType: 'text',
        default: { kind: 'function', expression: 'now()' },
      },
    },
    updatedAt: {
      kind: 'fieldPreset',
      output: {
        codecId: 'sqlite/datetime@1',
        nativeType: 'text',
        executionDefaults: {
          onCreate: TEMPORAL_MIRROR_NOW_PHASE,
          onUpdate: TEMPORAL_MIRROR_NOW_PHASE,
        },
      },
    },
  },
} as const satisfies Record<string, Record<string, AuthoringFieldPresetDescriptor>>;
