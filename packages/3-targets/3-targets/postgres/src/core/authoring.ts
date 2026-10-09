import {
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '@internal/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  ParsedPslExtensionBlock,
} from '@internal/framework-components/authoring';
import { temporalAuthoringPresets } from '@internal/framework-components/authoring';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type {
  AttributeSpecContext,
  BlockSpecContext,
  InferBlock,
  ModelAttributeSpecFactory,
  ParsedTypedValue,
  PslBlockSpecDescriptor,
} from '@internal/psl-parser';
import {
  blockAttribute,
  bool,
  dataTypeValue,
  entityRef,
  fieldRef,
  identifier,
  leafDiagnostic,
  list,
  mapBlock,
  modelAttribute,
  oneOf,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';
import type {
  EntityHandleLoweringInput,
  LoweredPackEntity,
  ResolvedEntityHandleRef,
  ResolvedPslModelRefs,
  SqlPslEntityPlacementOutput,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import { exactNameBodyWarning } from '@internal/sql-contract/index-naming';
import {
  requireSqlExpression,
  SQL_EXPRESSION_DATA_TYPE_ID,
  type SqlExpression,
  sqlTextFromCanonical,
} from '@internal/sql-contract/sql-expression';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { assertWireNamePrefixLength, normalizeSqlBody } from '@internal/sql-schema-ir/naming';
import { assertDefined, invariant } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import {
  PG_ENUM_CODEC_ID,
  PG_TIMESTAMP_STRING_CODEC_ID,
  PG_TIMESTAMP_TEMPORAL_CODEC_ID,
  PG_TIMESTAMPTZ_DATE_CODEC_ID,
  PG_TIMESTAMPTZ_STRING_CODEC_ID,
  PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
} from './codec-ids';
import { postgresError } from './errors';
import {
  describeFullTextIndexProblem,
  FULL_TEXT_INDEX_TYPE,
  type FullTextIndexProblem,
  fullTextIndexProblems,
} from './full-text-index-definition';
import { type FullTextFieldsInput, weightGroupsOf } from './full-text-weight-groups';
import { postgresNowGeneratorIds } from './now-generators';
import { postgresCodecTraitsOf } from './postgres-codec-traits';
import { PostgresNativeEnum } from './postgres-native-enum';
import { PostgresRlsEnablement, type PostgresRlsEnablementInput } from './postgres-rls-enablement';
import { PostgresRlsPolicy, type RlsPolicyOperation } from './postgres-rls-policy';
import { PostgresRole } from './postgres-role';
import {
  PostgresNativeEnumSchema,
  PostgresRlsEnablementSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';
import { computeContentHash } from './rls/canonicalize';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  type FullTextSearchLanguage,
  POSTGRES_TEXT_SEARCH_LANGUAGES,
} from './text-search-languages';

// Contributed diagnostic codes, declared once as typed consts — the
// `ContributedPslDiagnosticCode` type is the only thing enforcing the
// `PSL_` prefix convention, so the declared-const form (the
// `sql-attribute-specs.ts` convention) is the settled spelling for pack
// codes; inline string literals bypass it.
const PSL_POLICY_INVALID_MAP: ContributedPslDiagnosticCode = 'PSL_POLICY_INVALID_MAP';
const PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS';
const PSL_FULL_TEXT_INDEX_EMPTY_GROUP: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_EMPTY_GROUP';
const PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD';
const PSL_FULL_TEXT_INDEX_REQUIRES_NAME: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_REQUIRES_NAME';
const PSL_FULL_TEXT_INDEX_NAME_XOR_MAP: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_NAME_XOR_MAP';
const PSL_FULL_TEXT_INDEX_TEXT_FIELD: ContributedPslDiagnosticCode =
  'PSL_FULL_TEXT_INDEX_TEXT_FIELD';
const PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE: ContributedPslDiagnosticCode =
  'PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE';
const PSL_NATIVE_ENUM_MISSING_MEMBERS: ContributedPslDiagnosticCode =
  'PSL_NATIVE_ENUM_MISSING_MEMBERS';
const PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE: ContributedPslDiagnosticCode =
  'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE';

/**
 * `pg.enum(<ref>)` registers as an ordinary type constructor whose sole
 * positional argument names a `native_enum` entity instead of carrying a
 * literal value. The interpreter resolves the ref to the `native_enum`
 * entity generically (driven by `entityRefArg`); the `pg/enum@1` codec
 * descriptor's `columnFromEntity` hook (see `codecs.ts`) converts that
 * entity into the column's `typeParams`. The column's type name comes from the
 * `pg/enum` data type, which renders `typeParams.typeName`.
 */
export const postgresAuthoringTypes = {
  BigIntNumber: {
    kind: 'typeConstructor',
    documentation:
      'A PostgreSQL 64-bit integer represented as a JavaScript number within its safe integer range.',
    output: {
      codecId: 'pg/int8number@1',
    },
  },
  UnboundedInt: {
    kind: 'typeConstructor',
    documentation:
      'An arbitrary-precision integer stored as PostgreSQL numeric and represented as bigint.',
    output: {
      codecId: 'pg/unboundedint@1',
    },
  },
  pg: {
    enum: {
      kind: 'typeConstructor',
      inferred: true,
      entityRefArg: { index: 0, entityKind: 'native_enum' },
      output: {
        codecId: PG_ENUM_CODEC_ID,
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const policyTargetParam = {
  type: entityRef({ kind: 'model' }),
  documentation: 'The model protected by this policy; it must declare @@rls.',
};
const policyRolesParam = {
  type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
  documentation: 'The database roles to which this policy applies.',
};
function policyUsingParam(ctx: BlockSpecContext) {
  return {
    type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)),
    documentation: 'A SQL predicate controlling which rows this policy permits.',
  };
}
function policyWithCheckParam(ctx: BlockSpecContext) {
  return {
    type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)),
    documentation: 'A SQL predicate checking rows being written by this policy.',
  };
}
const policyPermissiveParam = {
  type: optional(bool()),
  documentation:
    'Whether the policy is permissive (combined with OR) rather than restrictive (combined with AND).',
};

export function policyUsingOnlySpec(ctx: BlockSpecContext) {
  return structBlock({
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyUsingParam(ctx),
      permissive: policyPermissiveParam,
    },
  });
}

export function policyWithCheckOnlySpec(ctx: BlockSpecContext) {
  return structBlock({
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      withCheck: policyWithCheckParam(ctx),
      permissive: policyPermissiveParam,
    },
  });
}

export function policyBothPredicatesSpec(ctx: BlockSpecContext) {
  return structBlock({
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyUsingParam(ctx),
      withCheck: policyWithCheckParam(ctx),
      permissive: policyPermissiveParam,
    },
  });
}

type PolicyBlockValues = InferBlock<ReturnType<typeof policyBothPredicatesSpec>>;

export interface RlsPolicyExtensionBlock extends ParsedPslExtensionBlock<PolicyBlockValues> {
  readonly namespaceId: string;
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}

export function roleSpec() {
  return structBlock({ parameters: {} });
}

export function nativeEnumSpec() {
  return mapBlock({
    value: { type: str(), documentation: 'The member value stored in the database enum type.' },
  });
}

type NativeEnumValues = InferBlock<ReturnType<typeof nativeEnumSpec>>;

/** A parsed `role` block annotated with its lexical namespace id by the interpreter. */
export interface RoleExtensionBlock extends ParsedPslExtensionBlock {
  readonly namespaceId: string;
}

/**
 * The block keyword that authors each row-level security operation. The keyword is the operation, so
 * a policy block has no `operation` parameter. The reader looks a block's operation up here, and
 * `contract infer` and `contract print` look up the keyword to write.
 */
export const POLICY_BLOCK_KEYWORDS = {
  select: 'policy_select',
  insert: 'policy_insert',
  update: 'policy_update',
  delete: 'policy_delete',
  all: 'policy_all',
} as const satisfies Readonly<Record<RlsPolicyOperation, string>>;

function isRlsPolicyOperation(value: string): value is RlsPolicyOperation {
  return Object.hasOwn(POLICY_BLOCK_KEYWORDS, value);
}

/** The operation a `policy_<operation>` block keyword authors, or `undefined` for another keyword. */
function policyOperationOfKeyword(keyword: string): RlsPolicyOperation | undefined {
  return Object.keys(POLICY_BLOCK_KEYWORDS)
    .filter(isRlsPolicyOperation)
    .find((operation) => POLICY_BLOCK_KEYWORDS[operation] === keyword);
}

/**
 * Assembles a {@link PostgresRlsPolicy} from lowered inputs: normalizes the
 * predicates, computes the content-hash wire name, and constructs the frozen
 * entity. The single hash-assembly body shared by the PSL block lowering
 * ({@link lowerRlsPolicyFromBlock}) and the TS entity-handle lowering
 * ({@link postgresLowerEntityHandles}) so the two surfaces cannot drift.
 */
function buildRlsPolicyEntity(input: {
  readonly prefix: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
  /** Defaults to PERMISSIVE — the hash tuple slot already existed. */
  readonly permissive?: boolean;
}): PostgresRlsPolicy {
  const permissive = input.permissive ?? true;
  const wireHash = computeContentHash({
    ...ifDefined('using', input.using !== undefined ? normalizeSqlBody(input.using) : undefined),
    ...ifDefined(
      'withCheck',
      input.withCheck !== undefined ? normalizeSqlBody(input.withCheck) : undefined,
    ),
    roles: input.roles,
    operation: input.operation,
    permissive,
  });

  return new PostgresRlsPolicy({
    naming: { kind: 'wire', prefix: input.prefix, hash: wireHash },
    tableName: input.tableName,
    namespaceId: input.namespaceId,
    operation: input.operation,
    roles: input.roles,
    using: input.using,
    withCheck: input.withCheck,
    permissive,
  });
}

function lowerRlsPolicyFromBlock(
  block: RlsPolicyExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresRlsPolicy | undefined {
  const prefix = block.name;
  const operation = policyOperationOfKeyword(block.keyword) ?? 'select';
  const target = block.resolvedModelRefs?.['target'];
  assertDefined(
    target,
    `lowerRlsPolicyFromBlock: policy "${block.name}" reached the factory without a projected \`target\` coordinate; the interpreter projects checked model references before invoking entity factories.`,
  );
  const roles =
    block.values.roles === undefined
      ? []
      : block.values.roles
          .map((role) => (typeof role === 'string' ? role : role.declaration.name))
          .sort();
  const using =
    block.values.using === undefined ? undefined : sqlTextFromCanonical(block.values.using.value);
  const withCheck =
    block.values.withCheck === undefined
      ? undefined
      : sqlTextFromCanonical(block.values.withCheck.value);
  const permissive = block.values.permissive ?? true;

  // `@@map("physical name")` adopts an EXACT-named policy: the lowered
  // entity's name is the map value verbatim — no prefix, no content hash,
  // and no wire-prefix length cap (exact names are verbatim physical names,
  // same stance as index `map:`). The block head stays the source-level
  // logical identifier, so head-keyed duplicate checking is unchanged.
  const mapAttr = block.attributes['map'];
  if (mapAttr !== undefined) {
    const exactName = mapAttr.args['name'];
    invariant(typeof exactName === 'string', '@@map on a policy block parses one string argument');
    ctx.warnings?.push(exactNameBodyWarning('policy', exactName));
    return new PostgresRlsPolicy({
      naming: { kind: 'exact', name: exactName },
      tableName: target.tableName,
      namespaceId: target.namespaceId,
      operation,
      roles,
      using,
      withCheck,
      permissive,
    });
  }

  return buildRlsPolicyEntity({
    prefix,
    tableName: target.tableName,
    namespaceId: target.namespaceId,
    operation,
    roles,
    ...ifDefined('using', using),
    ...ifDefined('withCheck', withCheck),
    permissive,
  });
}

const policyEntityTypeOutput = {
  factory: lowerRlsPolicyFromBlock,
  pslPlacement: (entity: PostgresRlsPolicy) => ({ namespaceId: entity.namespaceId }),
} satisfies AuthoringEntityTypeFactoryOutput<
  RlsPolicyExtensionBlock,
  PostgresRlsPolicy | undefined
> &
  SqlPslEntityPlacementOutput;

function lowerNativeEnumFromBlock(
  block: ParsedPslExtensionBlock<NativeEnumValues>,
  ctx: AuthoringEntityContext,
): PostgresNativeEnum | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const mapAttr = block.attributes['map'];
  let typeName = block.name;
  if (mapAttr !== undefined) {
    const mapped = mapAttr.args['name'];
    invariant(
      typeof mapped === 'string',
      '@@map on a native_enum block parses one string argument',
    );
    typeName = mapped;
  }

  let memberError = false;
  const seenValues = new Set<string>();
  const members: string[] = [];
  for (const [memberName, value] of Object.entries(block.values)) {
    if (seenValues.has(value)) {
      diagnostics?.push({
        code: PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE,
        message: `native_enum "${block.name}": duplicate member value "${value}"`,
        sourceId,
        span: block.parameterSpans[memberName] ?? block.span,
      });
      memberError = true;
      continue;
    }
    seenValues.add(value);
    members.push(value);
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: PSL_NATIVE_ENUM_MISSING_MEMBERS,
      message: `native_enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  // `control` stays unset — the effective grade is resolved at read time via `effectiveControlPolicy`, like `StorageTable`/`StorageColumn`.
  return new PostgresNativeEnum({ typeName, members });
}

/**
 * `native_enum`'s entity-type factory output, checked separately from the assembled
 * `postgresAuthoringEntityTypes` map below: `deriveValueSet` is SQL-family surface
 * ({@link SqlValueSetDerivingEntityTypeOutput}), not part of the framework
 * `AuthoringEntityTypeFactoryOutput` shape, so folding it directly into the map's single
 * `satisfies AuthoringEntityTypeNamespace` check would trip an excess-property error. Checking it
 * here against the intersection of both shapes keeps it structurally valid against each without
 * widening the map's own check.
 */
const nativeEnumEntityTypeOutput = {
  factory: lowerNativeEnumFromBlock,
  deriveValueSet: (entity: PostgresNativeEnum) => ({
    kind: 'valueSet' as const,
    values: [...entity.members],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<
  ParsedPslExtensionBlock<NativeEnumValues>,
  PostgresNativeEnum | undefined
> &
  SqlValueSetDerivingEntityTypeOutput;

/**
 * Lowers a `role <name> {}` block into a {@link PostgresRole}. Roles are
 * cluster-scoped in Postgres, so the block must be declared inside
 * `namespace unbound { … }` — any other lexical namespace (a named schema,
 * or the default bucket top-level declarations resolve to) is a load-time
 * diagnostic. The lowered entity carries the unbound coordinate.
 */
function lowerRoleFromBlock(
  block: RoleExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresRole | undefined {
  if (block.namespaceId !== UNBOUND_NAMESPACE_ID) {
    ctx.diagnostics?.push({
      code: PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE,
      message: `\`role\` block "${block.name}" must be declared inside \`namespace unbound { }\`, not in namespace "${block.namespaceId}"`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.span,
    });
    return undefined;
  }
  return new PostgresRole({ name: block.name, namespaceId: UNBOUND_NAMESPACE_ID });
}

export const postgresAuthoringEntityTypes = {
  role: {
    kind: 'entity',
    discriminator: 'role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: lowerRoleFromBlock,
    },
  },
  rls: {
    kind: 'entity',
    discriminator: 'rls',
    validatorSchema: PostgresRlsEnablementSchema,
    output: {
      factory: (input: PostgresRlsEnablementInput): PostgresRlsEnablement =>
        new PostgresRlsEnablement(input),
    },
  },
  policy: {
    kind: 'entity',
    discriminator: 'policy',
    validatorSchema: PostgresRlsPolicySchema,
    output: policyEntityTypeOutput,
  },
  native_enum: {
    kind: 'entity',
    discriminator: 'native_enum',
    validatorSchema: PostgresNativeEnumSchema,
    output: nativeEnumEntityTypeOutput,
  },
} as const satisfies AuthoringEntityTypeNamespace;

/**
 * Field presets contributed by the Postgres target pack.
 *
 * These mirror the PSL scalar-to-codec mapping used by the Postgres adapter
 * (see `createPostgresPslScalarTypeDescriptors`), so that authoring a field
 * via the TS callback surface (e.g. `field.int()`) and via the PSL scalar
 * surface (e.g. `Int`) lowers to byte-identical contracts.
 *
 * The `uuidNative` / `id.uuidv4Native` / `id.uuidv7Native` presets use the
 * native Postgres `uuid` type (codecId `pg/uuid@1`). For cross-target
 * portability use `uuidString` / `id.uuidv4String` / `id.uuidv7String` from
 * the family pack instead.
 */
// A policy may only target an RLS-controlled model: the model named by
// `target` must declare `@@rls`, or the load fails with a diagnostic naming
// the model and the policy prefix.
const policyRequiresRls = { parameter: 'target', attribute: 'rls' } as const;

const policyMapAttribute = blockAttribute('map', {
  documentation: 'Maps this row-level security policy to its PostgreSQL policy name.',
  positional: [{ key: 'name', type: str(), documentation: 'The nonempty PostgreSQL policy name.' }],
  refine: (parsed, ctx, attributeNode) =>
    parsed.name === ''
      ? [
          leafDiagnostic(
            ctx,
            attributeNode,
            '@@map policy name must be a non-empty string',
            PSL_POLICY_INVALID_MAP,
          ),
        ]
      : [],
});

const policyBlockAttributes = { map: () => policyMapAttribute };

const nativeEnumMapAttribute = blockAttribute('map', {
  documentation: 'Maps this native enum to its PostgreSQL type name.',
  positional: [{ key: 'name', type: str(), documentation: 'The PostgreSQL enum type name.' }],
});

export const postgresAuthoringPslBlockDescriptors = {
  [POLICY_BLOCK_KEYWORDS.select]: {
    kind: 'pslBlock',
    keyword: POLICY_BLOCK_KEYWORDS.select,
    documentation: 'Defines a row-level security policy controlling which rows can be selected.',
    discriminator: 'policy',
    name: { required: true },
    spec: policyUsingOnlySpec,
    requiresModelAttribute: policyRequiresRls,
    attributes: policyBlockAttributes,
  } satisfies PslBlockSpecDescriptor,
  [POLICY_BLOCK_KEYWORDS.delete]: {
    kind: 'pslBlock',
    keyword: POLICY_BLOCK_KEYWORDS.delete,
    documentation: 'Defines a row-level security policy controlling which rows can be deleted.',
    discriminator: 'policy',
    name: { required: true },
    spec: policyUsingOnlySpec,
    requiresModelAttribute: policyRequiresRls,
    attributes: policyBlockAttributes,
  } satisfies PslBlockSpecDescriptor,
  [POLICY_BLOCK_KEYWORDS.insert]: {
    kind: 'pslBlock',
    keyword: POLICY_BLOCK_KEYWORDS.insert,
    documentation: 'Defines a row-level security policy checking rows being inserted.',
    discriminator: 'policy',
    name: { required: true },
    spec: policyWithCheckOnlySpec,
    requiresModelAttribute: policyRequiresRls,
    attributes: policyBlockAttributes,
  } satisfies PslBlockSpecDescriptor,
  [POLICY_BLOCK_KEYWORDS.update]: {
    kind: 'pslBlock',
    keyword: POLICY_BLOCK_KEYWORDS.update,
    documentation:
      'Defines a row-level security policy controlling row visibility and checks for updates.',
    discriminator: 'policy',
    name: { required: true },
    spec: policyBothPredicatesSpec,
    requiresModelAttribute: policyRequiresRls,
    attributes: policyBlockAttributes,
  } satisfies PslBlockSpecDescriptor,
  [POLICY_BLOCK_KEYWORDS.all]: {
    kind: 'pslBlock',
    keyword: POLICY_BLOCK_KEYWORDS.all,
    documentation: 'Defines a row-level security policy applying to all operations.',
    discriminator: 'policy',
    name: { required: true },
    spec: policyBothPredicatesSpec,
    requiresModelAttribute: policyRequiresRls,
    attributes: policyBlockAttributes,
  } satisfies PslBlockSpecDescriptor,
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    documentation: 'Defines a PostgreSQL enum type with named string-valued members.',
    discriminator: 'native_enum',
    name: { required: true },
    spec: nativeEnumSpec,
    nameIsStorageName: true,
    attributes: { map: () => nativeEnumMapAttribute },
  } satisfies PslBlockSpecDescriptor,
  /**
   * PSL block descriptor for `role` (e.g. `role anon {}`). Name-only, no
   * parameters and no body content. Declared inside `namespace unbound { }`
   * — see {@link lowerRoleFromBlock} for the placement check and the
   * coordinate the lowered entity carries.
   */
  role: {
    kind: 'pslBlock',
    keyword: 'role',
    documentation:
      'Declares an existing database role in namespace unbound for use in security policies.',
    discriminator: 'role',
    name: { required: true },
    spec: roleSpec,
  } satisfies PslBlockSpecDescriptor,
} as const satisfies AuthoringPslBlockDescriptorNamespace;

const postgresRlsSpec = modelAttribute('rls', {
  documentation: 'Enables PostgreSQL row-level security on this model’s table.',
});

const postgresRlsSpecFactory: ModelAttributeSpecFactory = () => postgresRlsSpec;

const [firstLanguage, ...remainingLanguages] = POSTGRES_TEXT_SEARCH_LANGUAGES;

const fullTextField = fieldRef();

function postgresFullTextIndexSpec(ctx: AttributeSpecContext) {
  return modelAttribute('fullTextIndex', {
    documentation:
      "Indexes text fields for full-text search. Each item of the list is a weight group, strongest first; a nested list puts several fields in one group. Pass the index from the table's `indexes` to `fullTextMatches` and `fullTextRank` to search the same document.",
    positional: [
      {
        key: 'fields',
        type: oneOf(
          fullTextField,
          list(oneOf(fullTextField, list(fullTextField)), {
            allowEmpty: false,
            label: '(field name | field name[])[]',
          }),
        ),
        documentation:
          'The fields to index: one field, or a list of fields and lists of fields. Each top-level item is a weight group, from A down to D.',
      },
    ],
    named: {
      language: {
        type: optional(
          oneOf(str(firstLanguage), ...remainingLanguages.map((language) => str(language))),
        ),
        documentation:
          'The text-search configuration. Defaults to `english`, and must match the language the query operations are given.',
      },
      name: {
        type: optional(str()),
        documentation: 'The index name. Mutually exclusive with `map`.',
      },
      map: {
        type: optional(str()),
        documentation: 'The database index name. Mutually exclusive with `name`.',
      },
      where: {
        type: optional(dataTypeValue(SQL_EXPRESSION_DATA_TYPE_ID, ctx.dataTypes)),
        documentation: 'The SQL predicate restricting rows included in a partial index.',
      },
    },
    refine: (value, ctx, attributeNode) => {
      const problems = fullTextIndexProblems({
        weightGroups: weightGroupsOf(value.fields, isFieldName),
      });
      const diagnostics = problems
        .filter(isPslFullTextIndexProblem)
        .map((problem) =>
          leafDiagnostic(
            ctx,
            attributeNode,
            describeFullTextIndexProblem('`@@fullTextIndex`', problem),
            FULL_TEXT_INDEX_PROBLEM_CODES[problem.kind],
          ),
        );
      if (value.name === undefined && value.map === undefined) {
        diagnostics.push(
          leafDiagnostic(
            ctx,
            attributeNode,
            '`@@fullTextIndex` requires a `name` or `map` argument',
            PSL_FULL_TEXT_INDEX_REQUIRES_NAME,
          ),
        );
      }
      if (value.name !== undefined && value.map !== undefined) {
        diagnostics.push(
          leafDiagnostic(
            ctx,
            attributeNode,
            '`@@fullTextIndex` takes at most one of `name` and `map`',
            PSL_FULL_TEXT_INDEX_NAME_XOR_MAP,
          ),
        );
      }
      return diagnostics;
    },
  });
}

function isFieldName(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * `@@fullTextIndex` has no `unique` argument, so it never writes a unique index, and its spec
 * refuses an empty field list before these rules run.
 */
type PslFullTextIndexProblem = Exclude<
  FullTextIndexProblem,
  { readonly kind: 'unique' | 'no-fields' }
>;

function isPslFullTextIndexProblem(
  problem: FullTextIndexProblem,
): problem is PslFullTextIndexProblem {
  return problem.kind !== 'unique' && problem.kind !== 'no-fields';
}

const FULL_TEXT_INDEX_PROBLEM_CODES: Record<
  PslFullTextIndexProblem['kind'],
  ContributedPslDiagnosticCode
> = {
  'too-many-groups': PSL_FULL_TEXT_INDEX_TOO_MANY_GROUPS,
  'empty-group': PSL_FULL_TEXT_INDEX_EMPTY_GROUP,
  'duplicate-field': PSL_FULL_TEXT_INDEX_DUPLICATE_FIELD,
  'not-text': PSL_FULL_TEXT_INDEX_TEXT_FIELD,
};

const postgresFullTextIndexSpecFactory: ModelAttributeSpecFactory = (ctx) =>
  postgresFullTextIndexSpec(ctx);

type PostgresFullTextIndexParsed = {
  readonly fields: FullTextFieldsInput<string>;
  readonly language?: FullTextSearchLanguage;
  readonly name?: string;
  readonly map?: string;
  readonly where?: ParsedTypedValue;
};

/**
 * `@@` model attributes contributed by the Postgres target pack.
 *
 * `@@rls` is argument-less: presence marks the model's table
 * RLS-controlled. It lowers to a {@link PostgresRlsEnablement} marker in
 * the namespace's `entries.rls`, keyed by the model's table name — the
 * marker (never the policy set) is what drives
 * `ENABLE`/`DISABLE ROW LEVEL SECURITY` planning.
 */
export const postgresAuthoringModelAttributes = {
  rls: {
    kind: 'modelAttribute',
    attribute: 'rls',
    spec: postgresRlsSpecFactory,
    lower: (_parsed: Record<never, never>, ctx: AuthoringModelAttributeContext) => ({
      key: ctx.storageName,
      entity: new PostgresRlsEnablement({
        tableName: ctx.storageName,
        namespaceId: ctx.namespaceId,
      }),
    }),
  },
  fullTextIndex: {
    kind: 'modelAttribute',
    attribute: 'fullTextIndex',
    spec: postgresFullTextIndexSpecFactory,
    repeatable: true,
    lower: (parsed: PostgresFullTextIndexParsed, ctx: AuthoringModelAttributeContext) => {
      const fieldGroups = weightGroupsOf(parsed.fields, isFieldName);
      const problems = fullTextIndexProblems({
        weightGroups: fieldGroups,
        codecs: {
          // A relation field parses as a field reference but stores no value, so it has no column.
          codecIdOf: (fieldName) =>
            ctx.fieldStorageName(fieldName) === undefined ? undefined : ctx.fieldCodecId(fieldName),
          traitsOf: postgresCodecTraitsOf,
        },
      }).filter(isPslFullTextIndexProblem);
      for (const problem of problems) {
        ctx.diagnostics?.push({
          code: FULL_TEXT_INDEX_PROBLEM_CODES[problem.kind],
          message: describeFullTextIndexProblem(
            '`@@fullTextIndex`',
            problem,
            (fieldName) => `${ctx.modelName}.${fieldName}`,
          ),
          sourceId: ctx.sourceId ?? 'unknown',
        });
      }
      if (problems.length > 0) return undefined;
      const weightGroups = fieldGroups.map((group) =>
        group.map((fieldName) => {
          const columnName = ctx.fieldStorageName(fieldName);
          assertDefined(columnName, `@@fullTextIndex field "${fieldName}" has no storage column`);
          return columnName;
        }),
      );
      return {
        index: {
          columns: weightGroups.flat(),
          type: FULL_TEXT_INDEX_TYPE,
          options: {
            weightGroups,
            language: parsed.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
          },
          where: parsed.where === undefined ? undefined : sqlTextFromCanonical(parsed.where.value),
          unique: undefined,
          name: parsed.name,
          map: parsed.map,
        },
      };
    },
  },
} as const satisfies AuthoringModelAttributeDescriptorNamespace;

export const postgresAuthoringFieldPresets = {
  text: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/text@1',
    },
  },
  int: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int4@1',
    },
  },
  bigint: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int8@1',
    },
  },
  float: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/float8@1',
    },
  },
  decimal: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/numeric@1',
    },
  },
  boolean: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bool@1',
    },
  },
  json: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/jsonb@1',
    },
  },
  bytes: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bytea@1',
    },
  },
  dateTime: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/timestamptz-temporal@1',
    },
  },
  temporal: {
    createdAtJsDate: /* @__PURE__ */ temporalAuthoringPresets({
      codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_DATE_CODEC_ID],
    }).createdAt,
    updatedAtJsDate: /* @__PURE__ */ temporalAuthoringPresets({
      codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_DATE_CODEC_ID],
    }).updatedAt,
    timestamptzJsDate: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: PG_TIMESTAMPTZ_DATE_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_DATE_CODEC_ID],
    }),
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID],
    }),
    .../* @__PURE__ */ temporalStringAuthoringPresets({
      codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_STRING_CODEC_ID],
    }),
    timestamp: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: PG_TIMESTAMP_TEMPORAL_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMP_TEMPORAL_CODEC_ID],
    }),
    timestamptz: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_TEMPORAL_CODEC_ID],
    }),
    timestampString: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: PG_TIMESTAMP_STRING_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMP_STRING_CODEC_ID],
    }),
    timestamptzString: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: PG_TIMESTAMPTZ_STRING_CODEC_ID,
      generatorId: postgresNowGeneratorIds[PG_TIMESTAMPTZ_STRING_CODEC_ID],
    }),
  },
  uuidNative: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/uuid@1',
    },
  },
  id: {
    uuidv4Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv4',
          },
        },
        id: true,
      },
    },
    uuidv7Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv7',
          },
        },
        id: true,
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;

interface RlsRoleHandleShape {
  readonly entityKind: 'role';
  readonly name: string;
}

interface RlsPolicyHandleShape {
  readonly entityKind: 'policy';
  readonly operation: RlsPolicyOperation;
  readonly name: string;
  readonly roles: readonly { readonly name: string }[];
  readonly using?: SqlExpression;
  readonly withCheck?: SqlExpression;
}

function predicateText(predicate: SqlExpression | undefined, what: string): string | undefined {
  return predicate === undefined ? undefined : requireSqlExpression(predicate, what).text;
}

interface RlsTargetCoordinate {
  readonly namespaceId: string;
  readonly tableName: string;
}

/**
 * Resolves an entity handle's `target` ref to a table coordinate of this
 * contract, or throws the load-time diagnostic naming the handle: a
 * cross-space target is rejected (you cannot CREATE POLICY on a table
 * another space owns) and an unresolved target names the model.
 */
function requireLocalTarget(
  refs: Readonly<Record<string, ResolvedEntityHandleRef>>,
  subject: string,
): RlsTargetCoordinate {
  const target = refs['target'];
  if (target !== undefined && target.kind === 'resolved') {
    return { namespaceId: target.namespaceId, tableName: target.tableName };
  }
  if (target !== undefined && target.kind === 'cross-space') {
    throw postgresError(
      'CONTRACT.POLICY_INVALID',
      `defineContract: ${subject} targets model "${target.modelName ?? target.tableName}", which lives in another contract space. Policies and rlsEnabled entries must target a model declared in this contract.`,
      { meta: { model: target.modelName ?? target.tableName, reason: 'cross-space-target' } },
    );
  }
  throw postgresError(
    'CONTRACT.MODEL_UNKNOWN',
    `defineContract: ${subject} targets model "${target?.modelName ?? '<anonymous>'}", which is not in the contract's models. Add the model to \`models\`.`,
    { meta: { model: target?.modelName ?? '<anonymous>' } },
  );
}

/**
 * The SQL-family entity-handle batch lowering hook for the Postgres pack
 * (`SqlEntityHandleLoweringContribution`). Receives every `entities` handle
 * whose kind this pack registered — batch, so the cross-entity diagnostics
 * (duplicate prefix, policy without rlsEnabled, duplicate role) can see
 * sibling handles — and lowers them with the same keying and hash assembly
 * as the PSL path: `policy` keyed by prefix (wire name via
 * {@link buildRlsPolicyEntity}), `rls` keyed by table name, `role` keyed by
 * name and filed under the default namespace (roles are declared
 * contract-wide; PSL has no role block to set a precedent).
 */
export function postgresLowerEntityHandles(
  input: EntityHandleLoweringInput,
): readonly LoweredPackEntity[] {
  const enablements = new Map<
    string,
    { coordinate: RlsTargetCoordinate; entity: PostgresRlsEnablement }
  >();
  const roles = new Map<string, PostgresRole>();
  const policies: {
    readonly handle: RlsPolicyHandleShape;
    readonly refs: Readonly<Record<string, ResolvedEntityHandleRef>>;
  }[] = [];
  const coordinateKey = (coordinate: RlsTargetCoordinate): string =>
    `${coordinate.namespaceId} ${coordinate.tableName}`;

  for (const { handle, refs } of input.handles) {
    switch (handle.entityKind) {
      case 'rls': {
        const coordinate = requireLocalTarget(refs, 'an rlsEnabled entry');
        const key = coordinateKey(coordinate);
        if (!enablements.has(key)) {
          enablements.set(key, {
            coordinate,
            entity: new PostgresRlsEnablement({
              tableName: coordinate.tableName,
              namespaceId: coordinate.namespaceId,
            }),
          });
        }
        break;
      }
      case 'role': {
        const roleHandle = blindCast<
          RlsRoleHandleShape,
          'role handles are constructed only by the postgres contract-builder role() constructor, which enforces this shape'
        >(handle);
        if (roles.has(roleHandle.name)) {
          throw postgresError(
            'CONTRACT.ROLE_INVALID',
            `defineContract: role "${roleHandle.name}" is declared more than once in the entities list.`,
            { meta: { role: roleHandle.name, reason: 'duplicate' } },
          );
        }
        // Roles are cluster-scoped in Postgres, so they always land in the
        // `__unbound__` namespace — identical to a PSL `role` block
        // (`lowerRoleFromBlock`) and matching the `PostgresRole` class's own
        // contract. The declaring surface (TS entities vs PSL) does not move
        // the slot.
        roles.set(
          roleHandle.name,
          new PostgresRole({ name: roleHandle.name, namespaceId: UNBOUND_NAMESPACE_ID }),
        );
        break;
      }
      case 'policy': {
        const policyHandle = blindCast<
          RlsPolicyHandleShape,
          'policy handles are constructed only by the postgres contract-builder policy*() constructors, which enforce this shape'
        >(handle);
        policies.push({ handle: policyHandle, refs });
        break;
      }
      default:
        throw postgresError(
          'CONTRACT.ENTITY_KIND_INVALID',
          `defineContract: the postgres pack does not lower "${handle.entityKind}" handles from the entities list.`,
          { meta: { entityKind: handle.entityKind } },
        );
    }
  }

  const rows: LoweredPackEntity[] = [];
  const seenPrefixes = new Set<string>();

  for (const { handle: policy, refs } of policies) {
    const prefix = policy.name;
    assertWireNamePrefixLength(prefix, 'defineContract: policy prefix');
    const coordinate = requireLocalTarget(refs, `policy "${prefix}"`);
    if (!enablements.has(coordinateKey(coordinate))) {
      const target = refs['target'];
      throw postgresError(
        'CONTRACT.POLICY_INVALID',
        `defineContract: policy "${prefix}" targets model "${target?.modelName ?? coordinate.tableName}", whose table is not RLS-enabled. Add rlsEnabled(<model>) to the entities list.`,
        {
          meta: {
            prefix,
            model: target?.modelName ?? coordinate.tableName,
            reason: 'target-not-rls-enabled',
          },
        },
      );
    }
    const prefixKey = `${coordinate.namespaceId} ${prefix}`;
    if (seenPrefixes.has(prefixKey)) {
      throw postgresError(
        'CONTRACT.POLICY_INVALID',
        `defineContract: policy prefix "${prefix}" is declared more than once in namespace "${coordinate.namespaceId}". Policy prefixes must be unique per namespace.`,
        { meta: { prefix, namespaceId: coordinate.namespaceId, reason: 'duplicate-prefix' } },
      );
    }
    seenPrefixes.add(prefixKey);

    const roleNames = [...new Set(policy.roles.map((roleHandle) => roleHandle.name))].sort();
    rows.push({
      namespaceId: coordinate.namespaceId,
      entityKind: 'policy',
      key: prefix,
      entity: buildRlsPolicyEntity({
        prefix,
        tableName: coordinate.tableName,
        namespaceId: coordinate.namespaceId,
        operation: policy.operation,
        roles: roleNames,
        ...ifDefined('using', predicateText(policy.using, `Policy "${prefix}" using`)),
        ...ifDefined('withCheck', predicateText(policy.withCheck, `Policy "${prefix}" withCheck`)),
      }),
    });
  }

  for (const { coordinate, entity } of enablements.values()) {
    rows.push({
      namespaceId: coordinate.namespaceId,
      entityKind: 'rls',
      key: coordinate.tableName,
      entity,
    });
  }
  for (const [name, entity] of roles) {
    rows.push({ namespaceId: UNBOUND_NAMESPACE_ID, entityKind: 'role', key: name, entity });
  }
  return rows;
}
