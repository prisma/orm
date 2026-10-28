import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
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
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  collectScalarTypeConstructors,
  type ParsedPslExtensionBlock,
  readEnumBlockMembers,
  resolveEnumCodecId,
} from '@internal/framework-components/authoring';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import type {
  ControlMutationDefaultEntry,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import type { FuncCallSig, PslBlockSpecDescriptor, SymbolTable } from '@internal/psl-parser';
import {
  blockAttribute,
  buildSymbolTable,
  enumMemberValue,
  mapBlock,
  str,
} from '@internal/psl-parser';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import type { DocumentAst, PslSources, SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { type EnumTypeHandle, enumType } from '@internal/sql-contract-ts/contract-builder';
import type { Result } from '@internal/utils/result';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { InterpretPslDocumentToSqlContractInput } from '../src/interpreter';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { describeUnsupportedSqlAttribute } from '../src/psl-field-resolution';
import { sqlAttributeSpecs } from '../src/sql-attribute-specs';
import { sqlContextInput } from '../src/test';
import { describeUnresolvedSqlType } from '../src/unresolved-type';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import { fixtureGeneratorFunctions } from './fixture-generator-functions';

function testEnumFactory(
  block: ParsedPslExtensionBlock<Readonly<Record<string, JsonValue | undefined>>>,
  ctx: AuthoringEntityContext,
): EnumTypeHandle | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const resolved = resolveEnumCodecId(block, ctx);
  if (resolved === undefined) {
    return undefined;
  }
  const { codecId, codecSpan } = resolved;

  const descriptor = ctx.codecLookup.descriptorFor(codecId);
  const codec = ctx.codecLookup.get(codecId);
  if (descriptor === undefined || codec === undefined) {
    diagnostics?.push({
      code: 'PSL_EXTENSION_INVALID_VALUE',
      message: `enum "${block.name}" @@type references unknown codec "${codecId}"`,
      sourceId,
      span: codecSpan,
    });
    return undefined;
  }
  const members = readEnumBlockMembers(block, codecId, codec, ctx);
  if (members === undefined) return undefined;

  return enumType(block.name, { codecId }, ...members);
}

export const testEnumPslBlockDescriptor = {
  kind: 'pslBlock' as const,
  keyword: 'enum',
  discriminator: 'enum',
  name: { required: true },
  spec: () =>
    mapBlock({
      value: { type: enumMemberValue(), documentation: 'The explicit member value.' },
      allowBare: true,
    }),
  attributes: {
    type: () =>
      blockAttribute('type', {
        documentation: 'Selects the storage codec for this enum.',
        positional: [
          {
            key: 'codecId',
            type: str(),
            documentation: 'The fully qualified codec identifier for enum values.',
          },
        ],
      }),
  },
} satisfies PslBlockSpecDescriptor;

export const testEnumEntityContributions = {
  enum: {
    kind: 'entity' as const,
    discriminator: 'enum',
    output: { factory: testEnumFactory },
  },
} as const satisfies AuthoringEntityTypeNamespace;

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
  readonly elementNullable: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
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
    const members = input.memberValues
      .map((v) => (typeof v === 'number' ? String(v) : `'${v}'`))
      .join(', ');
    const elements = input.memberValues
      .map((v) => (typeof v === 'number' ? String(v) : `"${v}"`))
      .join(',');
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: input.many
        ? `array_remove(${column}, NULL) <@ '{${elements}}'`
        : `${column} IN (${members})`,
    });
  }
  if (input.many && !input.elementNullable) {
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
 * `postgresTarget` plus the check-rendering hook for check emission tests.
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
  authoring: { type: {}, renderCheckExpressions: testRenderCheckExpressions },
} as const;

export const sqliteTarget: TargetPackRef<'sql', 'sqlite'> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'sqlite',
  id: 'sqlite',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: '__unbound__',
  supportsNamespaces: false,
  displayName: 'SQLite',
};

export const pgvectorExtensionPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'pgvector',
  version: '1.2.3-test',
};

export const postgresBaseScalarAuthoringTypes: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'pg/bool@1' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1' } },
  BigInt: { kind: 'typeConstructor', output: { codecId: 'pg/int8@1' } },
  Float: { kind: 'typeConstructor', output: { codecId: 'pg/float8@1' } },
  Decimal: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/numeric@1' },
  },
  DateTime: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/timestamptz-temporal@1' },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1' } },
  Bytes: { kind: 'typeConstructor', output: { codecId: 'pg/bytea@1' } },
};

export const postgresScalarTypeDescriptors = collectScalarTypeConstructors(
  postgresBaseScalarAuthoringTypes,
);

export const postgresScalarAuthoringTypes: AuthoringTypeNamespace = {
  ...postgresBaseScalarAuthoringTypes,
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'pg/inet@1' } },
  SmallInt: { kind: 'typeConstructor', output: { codecId: 'pg/int2@1' } },
  Real: { kind: 'typeConstructor', output: { codecId: 'pg/float4@1' } },
  Date: { kind: 'typeConstructor', output: { codecId: 'pg/date-temporal@1' } },
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'length', optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Char: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'length', optional: true }],
    output: {
      codecId: 'sql/char@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      { kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true },
      { kind: 'value', dataType: 'pg/int4', name: 'scale', optional: true },
    ],
    output: {
      codecId: 'pg/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  TimestampTemporal: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  TimestamptzTemporal: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Time: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: {
      codecId: 'pg/time-temporal@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
  Timetz: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: {
      codecId: 'pg/timetz@1',
      typeParams: { precision: { kind: 'arg', index: 0 } },
    },
  },
};

export const postgresNativeScalarTypeDescriptors = collectScalarTypeConstructors(
  postgresScalarAuthoringTypes,
);

/**
 * Controlled test-only descriptor — intentionally uses pg/vector@1, bounded at 2000 by the fixture data type, rather than importing the real pgvector pack, so interpreter unit tests stay layer-isolated. Real-pack parity is covered by `test/integration/test/authoring/parity/ts-psl-parity.real-packs.test.ts`.
 */
export const pgvectorAuthoringContributions = {
  dataTypes: {},
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  attributeSpecs: sqlAttributeSpecs,
  type: {
    ...postgresScalarAuthoringTypes,
    pgvector: {
      Vector: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
        output: {
          codecId: 'pg/vector@1',
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
    readonly defaultNamespaceId?: string;
  },
): {
  documents: readonly DocumentAst[];
  symbolTable: SymbolTable;
  sources: PslSources;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  const sourceId = options?.sourceId ?? 'schema.prisma';
  const { document, sources } = parse(schema, sourceId);
  const sourceFile = sources.sourceFileFor(document.syntax);
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    defaultNamespaceId: options?.defaultNamespaceId ?? postgresTarget.defaultNamespaceId,
  });
  const seedDiagnostics: ContractSourceDiagnostic[] = diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: sourceFile.rangeToPslSpan(diagnostic.range),
  }));
  return {
    documents: [document],
    symbolTable,
    sources,
    sourceFile,
    sourceId,
    seedDiagnostics,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
  };
}

export function symbolTableInputFromParseArgs(args: {
  readonly schema: string;
  readonly sourceId?: string;
}): {
  documents: readonly DocumentAst[];
  symbolTable: SymbolTable;
  sources: PslSources;
  sourceFile: SourceFile;
  sourceId: string;
  seedDiagnostics: ContractSourceDiagnostic[];
  enumInferenceCodecs: { readonly text: string; readonly int: string };
} {
  return buildSymbolTableInput(args.schema, {
    ...(args.sourceId !== undefined ? { sourceId: args.sourceId } : {}),
  });
}

type InterpretOptions = Omit<
  InterpretPslDocumentToSqlContractInput,
  'documents' | 'sources' | 'symbolTable' | 'binder' | 'generatorFunctions'
> &
  Partial<Pick<InterpretPslDocumentToSqlContractInput, 'generatorFunctions'>>;

function contextForInterpretOptions(
  options: Pick<
    InterpretOptions,
    | 'authoringContributions'
    | 'controlMutationDefaults'
    | 'generatorFunctions'
    | 'codecLookup'
    | 'dataTypes'
    | 'composedExtensions'
    | 'composedExtensionContracts'
    | 'capabilities'
    | 'scalarColumnDescriptors'
    | 'target'
  >,
): ContractSourceContext {
  const authoring = options.authoringContributions;
  const scalarsFromColumnDescriptors: Record<string, AuthoringTypeConstructorDescriptor> = {};
  for (const [name, descriptor] of options.scalarColumnDescriptors ?? []) {
    scalarsFromColumnDescriptors[name] = {
      kind: 'typeConstructor',
      output: { codecId: descriptor.codecId },
    };
  }
  return {
    composedExtensions: options.composedExtensions ?? [],
    defaultNamespaceId: options.target.defaultNamespaceId,
    composedExtensionContracts: options.composedExtensionContracts,
    authoringContributions: {
      type: { ...scalarsFromColumnDescriptors, ...authoring?.type },
      entityTypes: authoring?.entityTypes ?? {},
      pslBlockDescriptors: authoring?.pslBlockDescriptors ?? {},
      modelAttributes: authoring?.modelAttributes ?? {},
      attributeSpecs: authoring?.attributeSpecs ?? sqlAttributeSpecs,
      dataTypes: authoring?.dataTypes ?? options.dataTypes.entries,
      ...(authoring?.valueObjectStorageType === undefined
        ? {}
        : { valueObjectStorageType: authoring.valueObjectStorageType }),
    },
    pslDiagnostics: {
      describeUnsupportedAttribute: describeUnsupportedSqlAttribute,
      describeUnresolvedType: describeUnresolvedSqlType,
    },
    codecLookup: options.codecLookup,
    dataTypes: options.dataTypes,
    controlMutationDefaults: options.controlMutationDefaults ?? {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
    generatorFunctions: options.generatorFunctions ?? EMPTY_GENERATOR_FUNCTIONS,
    resolvedInputs: [],
    capabilities: options.capabilities,
  };
}

export function interpretSqlContract(
  schema: string,
  options: InterpretOptions,
  sourceId?: string,
): Result<Contract, ContractSourceDiagnostics> {
  const bound = bindPslSchema(schema, {
    sourceId: sourceId ?? 'schema.prisma',
    context: contextForInterpretOptions(options),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: options.target,
      createNamespace: options.createNamespace,
      ...(options.composedExtensionPackRefs?.length
        ? { composedExtensionPackRefs: options.composedExtensionPackRefs }
        : {}),
      enumInferenceCodecs: options.enumInferenceCodecs ?? postgresEnumInferenceCodecs,
    }),
    bound.seedDiagnostics,
  );
}

export const sqliteScalarAuthoringTypes: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'sqlite/text@1' } },
  Boolean: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/integer@1' },
  },
  Int: { kind: 'typeConstructor', output: { codecId: 'sqlite/integer@1' } },
  BigInt: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/bigint@1' },
  },
  Float: { kind: 'typeConstructor', output: { codecId: 'sqlite/real@1' } },
  Decimal: { kind: 'typeConstructor', output: { codecId: 'sqlite/text@1' } },
  DateTime: {
    kind: 'typeConstructor',
    output: { codecId: 'sqlite/datetime@1' },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'sqlite/json@1' } },
  Bytes: { kind: 'typeConstructor', output: { codecId: 'sqlite/blob@1' } },
};

export const sqliteScalarColumnDescriptors = collectScalarTypeConstructors(
  sqliteScalarAuthoringTypes,
);

export { postgresCodecLookup } from './fixture-codec-descriptors';

export function createPostgresTestContext(
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensions: [],
    defaultNamespaceId: 'public',
    composedExtensionContracts: new Map(),
    authoringContributions: {
      dataTypes: fixtureDataTypeSupport.entries,
      type: postgresScalarAuthoringTypes,
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      attributeSpecs: sqlAttributeSpecs,
      valueObjectStorageType: 'Jsonb',
    },
    pslDiagnostics: {
      describeUnsupportedAttribute: describeUnsupportedSqlAttribute,
      describeUnresolvedType: describeUnresolvedSqlType,
    },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    generatorFunctions: fixtureGeneratorFunctions,
    ...fixtureInterpreterTypes,
    resolvedInputs: [],
    capabilities: { sql: { scalarList: true } },
    ...overrides,
  };
}

const nowSig: FuncCallSig = {
  documentation: 'Uses the current database timestamp as the default value.',
};
const autoincrementSig: FuncCallSig = {
  documentation: 'Generates an increasing integer value in the database.',
};
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
    ]),
    generatorDescriptors: [
      ...['uuidv4', 'uuidv7', 'cuid2', 'ulid', 'nanoid', 'ksuid', 'timestampNow'].map((id) => ({
        id,
      })),
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
